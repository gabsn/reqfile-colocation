# COLOCATION as a blocking check: design

Goal: a check CI can block on, whose success means every required rule ran on
every file and found nothing, and whose findings are true by construction
rather than by a probability. The principle: each feature owns what belongs to
it, exposes an interface, and can be deleted without leaving its
implementation scattered; inside a feature, any split (pure/I-O,
public/private, models/services) is free.

## What the 0.2.0 checker could not guarantee

It reads imports with regular expressions and decides with heuristics over the
import graph and folder names. Three defects reproduced on it show the limit:

| Case | 0.2.0 verdict | Cause |
|---|---|---|
| `billing.rs` calling its own `pub mod tax` (`billing/tax.rs`) | "reaches past its interface" on `billing.rs` | the interface file was treated as outside its own module |
| Python `from billing import tax`, `tax` re-exported by `billing/__init__.py` | "reaches past its interface" | the regex resolver sees `tax.py`, not the name the package exports |
| `billing/` with one interface and its own `models/`, `services/` | "split across layer folders" | the folder names `models`, `services` decided |

More generally, an import graph shows dependencies, not business boundaries:
two files using a helper are not necessarily two features, and the number of
importers or a folder's name cannot say who owns what.

## Approaches compared

| | A. Heuristics (0.2.0) | B. Native boundaries + real resolution | C. Full architecture manifest | D. Compiler / language server | E. Model judgment (Jev) |
|---|---|---|---|---|---|
| Idea | regex imports, graph and name signals, probabilities | real parsers and each language's resolution rules; a feature boundary is what the language already declares (interface file, `pub`, `__all__`/re-exports); deterministic rules | a file listing every feature, the files it owns, its public interface and allowed dependencies (Nx tags, tach.toml, import-linter, dependency-cruiser) | type-checker programs (tsc with types, rust-analyzer, pyright) resolve every symbol to its definition | ask a model, per unit, whether it is placed right |
| Information needed | none | the code; an optional `colocation.yaml` for exceptions, declared features where the language has no interface, declared shared modules | a second, complete description of the code | full toolchains, dependencies installed, a building project | none |
| Cost | ~60 ms, no deps | ~1 s on mid-size repos; deps: TypeScript 6 (JS API), web-tree-sitter + Rust grammar, python3 | low runtime, high upkeep: the manifest drifts from the code | slow (seconds to minutes), heavy CI setup | money, latency, variance |
| Guarantees | none: a probability | per rule, deterministic: a finding is a fact about resolved code; an unresolvable local import is reported, never ignored | strongest on feature identity, but only as true as the manifest | symbol-level precision (which definition, type-only uses) | none: advisory |
| Fails on | aliases, re-exports, visibility, generated code, names | feature identity the code does not express (which files form one feature) | drift; nobody maintains it | environment, speed | non-determinism |

**Retained: B for the blocking check, with the smallest part of C that removes
B's one blind spot, and A kept as an advisory second check.** D brings symbol
precision this rule does not need (placement is decided per module, and B
resolves modules exactly); E stays a possible future advisory check for
feature identity.

## B in detail

### Boundaries from the languages themselves

- **TypeScript/JavaScript**: a folder with `index.(ts|tsx|js|mjs)` is a
  boundary; that file is its interface. A package with `exports` in
  package.json is one too.
- **Rust**: every module is a boundary, and rustc already enforces it: a path
  from outside module `m` into `m::sub` compiles only if `m` declares `sub`
  visible (`pub`, `pub(crate)`, `pub(in …)`). Whatever compiles goes through a
  declaration of the module file, so the interface rule holds by construction;
  the checker reads `mod` declarations to build the module tree and attribute
  edges, and never reports a module for using its own submodules.
- **Python**: a package is a boundary when its `__init__.py` declares an
  interface: `__all__`, or re-exports (`from .x import y`, `from . import x`).
  Importing a name the interface exports (`from billing import tax` when
  `tax` is re-exported) goes through it; importing a module it does not export
  (`from billing.ledger import post`, `from billing import ledger` when
  `ledger` is not re-exported) bypasses it. A package without an interface is
  open: its submodules are public, as Python convention has it.

### Resolution

- **TypeScript**: `ts.resolveModuleName` with the nearest tsconfig parsed by
  TypeScript itself (`extends`, `paths`, `baseUrl`, `moduleResolution`, package
  `exports`); imports, re-exports and dynamic imports read from TypeScript's
  syntax tree. Non-code assets (`./x.css`) resolve to the file.
- **Python**: python3's `ast` (imports, `__all__`, re-exports, defined names),
  resolution by Python's rules from the package roots (repository root,
  pyproject folders, their `src/`): relative imports from the package, absolute
  imports whose first package exists in the repository.
- **Rust**: tree-sitter's Rust grammar; the module tree from each crate root
  (`src/lib.rs`, `src/main.rs`, `src/bin/*`, `tests/*`, `benches/*`,
  `examples/*`), `mod` declarations with `#[path]`; `use` trees and qualified
  paths in expressions starting from `crate`, `self`, `super`, the crate name or
  a declared child module.
- **Paths outside imports**: commands of workflow steps, shell scripts,
  package.json scripts, `mise.toml` tasks, and string literals of Python and
  TS/JS code are scanned for paths that exist in the repository, resolved from
  the repository root and from the file's folder. A path to a manifest
  (Cargo.toml, package.json, pyproject.toml) or a folder references the whole
  package or folder.
- **Unresolvable is an error, not a pass**: a relative or aliased import that
  resolves to nothing, an absolute Python import into a repository package that
  does not have the module or name, a `mod x;` without its file, a file the
  parser rejects, or Python files without python3 make the run *unverifiable*
  (exit 2), listed by file and line. External packages and the standard
  library are recognized and skipped.

### Owners, users, consumers

- An edge's user is the importing or referencing file. **Consumers** are
  excluded when deciding where something belongs: repository-level files (at
  the root, `.github/`, `.claude/`, CI configuration). A workflow running a
  tool over the whole repository uses the tool; it does not make the tool's
  code belong at the root.
- **Coordinators** (entry points that wire features: `main.*`, a crate root, a
  CLI) are ordinary users: they must go through interfaces like anyone.
- Tests are users of what they test only for the tests rule.

### Blocking rules (as proposed; see Outcome for what review changed)

1. **interface** — an import from outside a boundary lands on its interface or
   on a name the interface exports (Python), never on an implementation file.
   Generated code is exempt, as importer or target.
2. **owner** — a file, or a package referenced as a whole, whose production
   users (imports and path references, consumers excluded) all live in one
   folder lives in that folder. This is what catches a feature split across
   layer folders (a `core/` file used only from `shell/`) and a product split by
   visibility (`oss/widget/` referenced only from `widget/evals/`).
3. **tests** — a test lives in the folder of the code it tests, except where a
   tool requires otherwise (Rust `tests/`, `benches/`, `examples/` next to
   Cargo.toml).
4. **entry** — a workflow step in a required location is a thin entry point:
   5 or more non-blank lines of shell on a top-level folder's files is that
   folder's logic, which belongs in a script there.

### What still needs a person, and how to make it checkable

Which files form one feature is not in the code. Two cases depend on it:

- **Several files of one feature loose among others** (`add.rs`, `update.rs`
  and the `sources.rs` they share, beside `check.rs`): `sources.rs` is either
  a private helper of one "pins" feature or a module shared by two features.
- **Layer folders whose files serve several features** (`models/invoice.py`
  used from `repositories/` and `services/`): the owner rule needs one using
  folder; here there are two.

The missing information is the partition into features. It becomes checkable
with one declaration per root, in `colocation.yaml`:

```yaml
roots:
  - path: src
    shared: [src/format.rs]   # modules several features share, by decision
```

Under a declared root, every file that is neither an entry point, a feature
(a file or a folder with an interface), nor a declared shared module must live
inside the one feature that uses it; a helper used by two features that is not
declared shared is a violation. Without the declaration these cases stay with
the advisory check.

### Output and exit codes

Each judged file is one of: **compliant**, **violation** (rule, location,
fix), **unverifiable** (why). SARIF results carry the rule id; exit 0 only when
every rule ran on every file and found nothing; 1 when there are violations
and everything was verifiable; 2 when anything was unverifiable (reqfile
reports a tool error, which fails the run). A summary on stderr counts the
three.

### Exceptions

`colocation.yaml` `exceptions:` entries name a path glob, a rule and a reason.
An exception that matches no finding is an error, so exceptions cannot
outlive the code they excuse. They are listed in every run's summary.

### Advisory check

The 0.2.0 heuristics (items used only below their file, grab-bag files at a
root, loose features, layer-named folders) run as a second, advisory check
with probabilities: they point at likely problems that need the feature
partition to be certain.

## Validation before blocking

- Freeze the corpus (tag `corpus-v1`) and run every checker version on the
  same cases: 0.1.3, 0.2.0 (PR #2), the candidate.
- Development set: every existing example, old false alarms included; the
  three reproduced defects and their violating twins added; near pairs with the
  same behavior, programs compiled or run.
- Confirmation set: written by an independent author from the requirement
  alone, before the candidate existed, never used for tuning, measured once.
- Labels re-checked blind (no checker verdicts shown); disagreements on feature
  boundaries documented in `LABELS.md`.
- Real repositories: every blocking finding reviewed; a sample of unflagged
  files reviewed for missed violations.

## Criteria for blocking adoption

COLOCATION's verification check becomes `mode: blocking` in a repository when:

1. On the frozen corpus, the blocking rules raise no false alarm, on
   development and confirmation sets alike, and every remaining miss is
   attributed to a rule that is not blocking (documented, not hidden).
2. On that repository, `reqfile-colocation verify` exits 0 or 1, never 2:
   every local import resolves, or an explicit exception says why not.
3. Every blocking finding on that repository has been reviewed as a true
   violation, or fixed, or excepted with a reason.
4. A sample of unflagged files reviewed by hand shows no blocking-rule miss.
5. The run time stays under 10 s on the repository.

## Outcome

What independent review of real findings changed in the proposal:

- **owner is advisory.** Ownership read from importers was right in 1 of 18
  reviewed findings on real repositories: a domain used by one surface or
  composition root (an MCP worker, a GraphQL stack, an app using a design
  system) is not that surface's. Without declared features the graph shows
  who uses what, not who owns it. `roots` in colocation.yaml is the
  verifiable form; `suggest` keeps the heuristic.
- **split is new and blocking.** The layer splits the reviewers found missed
  (app/<feature> and infra/<feature>, routes/components/lib for one feature,
  oss/widget beside widget/evals) share a signature that does not depend on a
  name alone: the same feature name in two sibling tier folders and a real
  dependency between them, excluding structural names and names repeated as a
  layer in more than three folders. Reviewed: 9 true, 1 false, 2 unsure of 12.
- **entry** counts 8 lines, not 5 (a 5-line branch on the CI event was a false
  alarm); **interface** judges tests too, and lets a package's own files
  reach past its root index.
- Resolution gaps found on real code and fixed: Vite query suffixes, aliases
  onto installed packages and onto assets, Python names bound under `if`/`try`,
  regular packages before namespace folders, paths in Rust macro arguments,
  entry points declared in package.json `exports`, runner files
  (wrangler.toml, Dockerfile...), workspace packages without node_modules.

Measures, limits and the adoption criteria with their status are in the
README; label decisions in LABELS.md.
