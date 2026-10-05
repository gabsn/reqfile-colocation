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

## Boundary questions, decided by the author (2026-10-05)

| Question | Decision | Effect on labels |
|---|---|---|
| Rust integration tests in cargo's `tests/`, even of one module, with fixtures | Conforming: the tool imposes the place, with no alternative | `violation-rust-cronlite` and `violation-rs-polygon-tests-and-fixture-in-tests-dir` (confirmation) relabeled ok and renamed `ok-rust-cronlite-module-tests-in-cargo-tests`, `ok-rs-polygon-tests-and-fixture-in-cargo-tests` |
| A package-level `tests/` (pytest, mirror trees) | Scope by placement: `tests/` at a package root holds package-wide tests only; a test of one feature lives with it, except where a tool imposes the place | unchanged |
| Scope by placement ("emboîtement") | Part of COLOCATION, now in the `must`: a folder's place says whom it serves (`infra/` serves all, `billing/infra/` serves billing) | none |
| A parent entering its subfolder past the subfolder's interface | A subfolder with an interface is a black box for all code outside it, parent included | `violation-python-submodule-past-reexporting-init` stays a violation |
| A package and a folder named alike (`platform/agent-evals`, `voxrouter/agent-evals`) | Conforming when the package is shared, i.e. code of another feature uses it (CI and root configuration are consumers); a tool can be declared `shared` in colocation.yaml | none |
| Generated code's `index.ts` | Not an interface: generated layout is the tool's | `ok-generated-code-reaches-in` stays ok |
| `atlas/public/` + `atlas/private/` across two features | Violation: visibility layering is free only inside one feature | stays a violation |
| A domain one feature re-exports for another (`business_days`) | Violation: what serves several features lives at their common level | stays a violation |
| Several files of one feature loose among others (pins) | Violation (earlier decision); checkable under declared `roots` | unchanged |

When a detail is still open, the rule that applies is the one that keeps the
requirement simplest and most coherent for an agent applying it.

## Disagreements of the checker with real code, decided by reviewers

Independent reviewers judged the checker's findings on six real repositories
(see the README's measures). Ownership read from importers (`owner`) was
right once in 18 samples: a domain used by a single surface or composition
root is not that surface's. It is advisory; with `roots` declared, ownership
becomes checkable.
