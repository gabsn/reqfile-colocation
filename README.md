# reqfile-colocation

A shareable [reqfile](https://reqfile.dev) requirement: **COLOCATION**, each
feature owns its code, exposes an interface, and can be deleted on its own.

This is a spike of what a community requirement package looks like: the
requirement, its checker and its labeled benchmark, in one repository with the
same layout as a requirement inside any project.

```
Reqfile.yaml                      # the requirement, same format as a local one
.reqfile/COLOCATION/examples/     # labeled benchmark: example.yaml (label, expected findings, rationale) + files/
src/                              # the checker, in TypeScript, published to npm
```

## Use it

Try it, then adopt it (reqfile 0.3 or later, with [Bun](https://bun.sh) installed):

```sh
reqfile eval --use gabsn/reqfile-colocation@v0.3.0    # its score on its examples
reqfile check --use gabsn/reqfile-colocation@v0.3.0   # its findings on your code
reqfile add gabsn/reqfile-colocation@v0.3.0           # writes the line below
```

which writes:

```yaml
code:
  - { id: COLOCATION, use: gabsn/reqfile-colocation@<commit> }  # v0.3.0
```

The checks run `bunx @g48in/reqfile-colocation@0.3.0 verify` (blocking) and
`... suggest` (advisory): Bun fetches the checker and its dependencies
(TypeScript 6, web-tree-sitter, yaml) from npm once and caches them. Python
repositories need python3. With Node only, use `npx -y` instead of `bunx`.

## The checker

`reqfile-colocation` runs from the repository root and reads the whole
repository (respecting .gitignore). It has two commands, declared as two
checks of COLOCATION:

- **`verify`, blocking.** Rules that are facts about the resolved dependency
  graph, so a finding is true by construction. Every judged file ends in one
  of three states, counted on stderr:
  - **compliant**: a SARIF `pass` result;
  - **violation**: a SARIF `fail` result naming its rule, file and line;
  - **unverifiable**: a local import that resolves to nothing, a file that
    does not parse, a `mod x;` without its file, a stale exception, Python
    files without python3. Listed on stderr; the run exits 2, which reqfile
    reports as an error that fails the run.

  Exit 0 only when every file was verified and no rule is broken; 1 when
  there are violations and everything was verified; 2 when anything was not.
- **`suggest`, advisory.** Heuristics that need to know which files form one
  feature, which the code does not say: ownership read from importers, items
  used only below their file, grab-bag files, features loose in a folder,
  layer-named folders. Each finding carries a probability; none blocks.

### How it reads code

| Language | Parser | Resolution | Boundary (interface) |
|---|---|---|---|
| TypeScript, JavaScript | TypeScript 6's syntax tree | TypeScript's module resolution with the nearest tsconfig/jsconfig (`extends`, `paths`, `baseUrl`); workspace packages by their package.json `name`, `exports`, `main`; assets through aliases | a folder whose `index.*` exports |
| Python | python3's `ast` | the importer's folder, pyproject/setup roots and their `src/`, the repository root; a regular package wins over a namespace folder; names bound under `if`/`try` count | a package whose `__init__.py` re-exports or defines `__all__`; a name it exports goes through it |
| Rust | tree-sitter's Rust grammar | the module tree from every crate root through `mod` (with `#[path]`); `use` trees, qualified paths, paths inside macro arguments | rustc enforces visibility, so no path that compiles is a bypass |

Dependencies outside imports count too: paths in workflow steps, shell
scripts, package.json scripts/`bin`/`exports`, task and runner files
(mise.toml, Makefile, Dockerfile, wrangler.toml...), manifests and string
literals. A path into another package depends on that package.

### Blocking rules

| Rule | Breaks when |
|---|---|
| `interface` | an import from outside a boundary lands on an implementation file instead of its interface (a package's own files may reach past its root index; generated code is exempt) |
| `tests` | a test lives outside the folder of the code it tests (its namesake, else the production code it imports); Rust `tests/`, `benches/`, `examples/` and migrations are tool-required |
| `entry` | a workflow step runs 8 or more lines of shell on the repository's folders instead of calling a script there |
| `split` | one feature `N` is in two tier or visibility folders under one parent, one depending on the other: `A/N` on `B/N` (app/garden and infra/garden), or `N/` on `A/N` (widget/evals on oss/widget); structural names (src, lib, tests...) and names repeated under more than three folders (a layer every feature has) are not features |
| `roots` | under a root declared in colocation.yaml, a file several of its features use is neither declared shared nor inside one feature |

### colocation.yaml (optional, strict)

```yaml
roots:                       # make ownership checkable where it matters
  - path: src                # each direct file or folder of src/ is a feature
    shared: [src/format.rs]  # the modules several features share, by decision
exceptions:                  # explicit, limited, reported in every run
  - path: test/**
    rule: tests
    reason: the deployment image runs test/ only
```

An unknown key, a declared path that does not exist, or an exception that
matches no finding fails the run (exit 2): exceptions cannot outlive the code
they excuse. Excepted findings stay in the SARIF as accepted suppressions.

## Measures

All versions on the same frozen corpus (`corpus-v3`, 68 examples): 40
development examples, 16 + 12 confirmation examples written by two
independent authors from the requirement alone, never used for tuning (two of
them relabeled ok by the author's decision on cargo's tests/, see LABELS.md).
Caught violations / false alarms on correct examples:

| Version | Development | Confirmation 1 | Confirmation 2 |
|---|---|---|---|
| 0.1.3 | 9/19, 1/21 | 0/7, 4/9 | 1/5, 0/7 |
| 0.2.0 | 16/19, 2/21 | 1/7, 3/9 | 1/5, 2/7 |
| **0.3.0 `verify` (blocking)** | 8/19, **0/21** | 1/7, **0/9** | 1/5, **0/7** |
| 0.3.0 `verify` + `suggest` | 19/19, 0/21 | 2/7, 2/9 | 2/5, 2/7 |

Confirmation 2 was first measured once with the frozen candidate (0 caught,
0 false alarms). Its miss `violation-ts-monorepo-emails` showed that workspace
packages were not resolved without node_modules; the fix that followed
catches it, so the 1/5 above is contaminated by having seen the case.

What the numbers say: on cases nobody tuned it on, the blocking check raised
no false alarm on 37 correct examples, and catches few violations: most
violations in the corpus are about ownership (which files form one feature),
which the code alone does not decide. 0.2.0's 16/19 in development fell to
2/12 on independent cases: its heuristics fitted their own examples.

### On real repositories

`verify` on eight repositories (arkadia, reqfile-colocation, voxrouter,
platform, skoolradar, brain, mini, focustree): 0.3 s to 2 s each; every
unverifiable import left is a real broken import (3 in voxrouter). Independent
reviewers opened the code behind random samples of findings:

| Rule | True | False | Unsure |
|---|---|---|---|
| tests | 14 | 0 | 2 |
| interface (two rounds) | 14 | 1 | 3 |
| entry | 4 | 1 (then fixed: 8-line threshold) | 1 |
| split | 9 | 1 | 2 |
| owner, read from importers | 1 | 16 | 1 → moved to `suggest` |

A reviewer also searched 36 random unflagged files for missed violations and
found 17, most needing feature knowledge (tiers named alike, file-name
prefixes) or links only an import back into src/ shows; interface bypasses by
tests and test-tree support files were fixed afterwards. Details:
[LABELS.md](LABELS.md) and [DESIGN.md](DESIGN.md).

### Limits

- Ownership is not in the code: a domain used by one surface may be that
  surface's, or a domain the surface merely uses. `verify` decides it only
  under declared `roots`; elsewhere `suggest` points at it.
- A split between files of different names (`src/public/wrap.ts` and
  `src/internal/break-words.ts`) is not seen; `split` compares folder names.
- Path references are read from literal paths: a path computed at run time,
  and fixtures only tests name by path, are not seen.
- A shared tool and one of its users named alike (`platform/agent-evals`,
  `voxrouter/agent-evals`) reads as a split when no other code uses the tool.
- Python dynamic imports and Rust items generated by macros are not read.
- Inline logic in a workflow that names no repository path is not counted.

## Adopting it as a blocking check

Make the `verify` check `mode: blocking` (the default) in a repository when:

1. on the frozen corpus its rules raise no false alarm, development and
   confirmation alike (met by 0.3.0: 0/35);
2. on that repository it exits 0 or 1, never 2: every local import resolves,
   or an exception says why not;
3. every finding there has been reviewed as true, fixed, or excepted with a
   reason;
4. a sample of unflagged files reviewed by hand shows no miss of a blocking
   rule;
5. it runs in under 10 s there.

Keep `suggest` advisory. Ownership becomes blocking only through `roots`.

## Measure it

```sh
bun install && bun test          # unit and end-to-end tests of the checker
reqfile eval                     # the labeled corpus, as published
```

Each violation names in `findings` every file a correct checker must flag
(reqfile requires all of them). `split: holdout` marks the confirmation
examples, written by independent authors and never used for tuning.
`reqfile eval` runs the version named in Reqfile.yaml; to measure the working
copy, `bun run build` and point the checks at `node dist/main.js`.

## Release

Bump `version` in package.json and in the `run:` of Reqfile.yaml, then push a
tag `vX.Y.Z`. CI tests, builds and publishes to npm through trusted
publishing, without a stored token.
