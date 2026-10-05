# Labels: how they were checked, what changed, what is still open

The examples in `.reqfile/COLOCATION/examples/` are the requirement in cases.
This file records how their labels were verified, every label that changed
and why, and the boundary questions independent readers disagree on. A
disagreement means the `must` allows two readings: it is settled by the
author, by rewording, or by a declaration that makes it checkable, never by
tuning the checker to one reading.

## How labels were checked

- **Corpus v1** (tag `corpus-v1`, 54 examples, then 56 with the declared-root
  pair): development examples written by the checker's author; 16
  confirmation examples (`split: holdout`) written by an independent author
  from the requirement alone, before the 0.3.0 checker existed.
- **Blind relabel, round 1** (28 examples, before corpus v1): an independent
  reviewer labeled every case from the `must` alone, without labels or checker
  output; 26 of 28 agreed.
- **Blind relabel, round 2** (all 56): cases shuffled and renamed, no labels,
  no checker verdicts; 52 of 56 agreed. The four disagreements are listed
  below.
- Every program compiles, runs or parses (Rust `cargo check`, Python
  `py_compile` and runs, TS transpiled and run with Bun, YAML parsed); near
  pairs produce the same output.

## Labels changed

| Example | Was | Now | Why |
|---|---|---|---|
| `violation-python-submodule-past-reexporting-init` (was `ok-python-submodule-import`) | ok | violation | The author's spec: an `__init__.py` that re-exports names is the package's interface, so `from voice.models.loaders import load` reaches past it although `voice.models` exports `load`. The earlier `ok` followed my reading (only `__all__` declares an interface). |
| `violation-product-split-by-visibility` | finding `oss/widget/src/lib.rs`, `known: miss` | finding `oss/widget/Cargo.toml` | Location convention, not label: the misplaced unit is the package, reported on its manifest. |
| `ok-python-imports-a-reexported-submodule` and its twin | billing used by `app/` only | billing also used by `reports/` | With one user, billing would break "a domain used by one feature lives inside it", a different rule from the one the pair isolates. |
| `violation-crate-split-core-shell`, `violation-package-by-layer` | findings narrowed / widened | | `findings` list every file a correct checker must flag (all are required by reqfile). |

## Open boundary questions (for the author)

| Example | Labeled | Other reading | What would settle it |
|---|---|---|---|
| `violation-feature-loose-in-flat-folder` | violation (author's decision) | `add.rs` and `update.rs` are two features sharing `sources.rs`, a module beside them (blind reviewer, twice) | Which files form one feature is not in the code; `colocation.yaml` `roots` with `shared` declares it, and `violation-undeclared-helper-under-declared-root` shows the declared form. |
| `violation-undeclared-helper-under-declared-root` | violation | `sources.rs` sits beside its two users, fine (blind reviewer) | The meaning of a declared root: every module several features use must be listed under `shared`. Written in the README; confirm. |
| `ok-generated-code-reaches-in` | ok | importing `__generated__/graphql.ts` past its generated `index.ts` bypasses an interface (blind reviewer) | Whether generated code's layout counts. The checker exempts it (its tool decides the layout). |
| `violation-py-public-and-private-top-folders` (confirmation) | violation (its author) | `public/` and `private/` inside `atlas/` are layering inside one module, which is free (blind reviewer) | Whether `atlas/` is one module or a folder of features. |
| `violation-rs-polygon-tests-and-fixture-in-tests-dir` (confirmation) vs `ok-rust-tool-imposed-tests` (development) | violation vs ok | Rust integration tests in `tests/` are a tool-required location and may hold test code | Whether "a tool-required location holds only a thin entry point" applies to Rust `tests/`. The two examples contradict each other; one must change. |
| `ok-ts-rank-unit-test-beside-search-e2e-at-root` (confirmation) | ok | an end-to-end test of the whole app in a root `tests/` is still a test away from its subject | Where tests of a whole program live. The checker accepts a test whose subjects are all entry points anywhere in its package. |
| `violation-py-business-days-inside-invoicing-used-by-payroll` (confirmation) | violation (its author) | payroll uses `is_business_day` through invoicing's interface, which is allowed | Whether a domain re-exported by one feature for another is still that feature's. |

## Disagreements of the checker with real code, decided by reviewers

Independent reviewers judged the checker's findings on six real repositories
(see the README's measures). Ownership read from importers (`owner`) was
right once in 18 samples: a domain used by a single surface or composition
root is not that surface's. It is advisory; with `roots` declared, ownership
becomes checkable.
