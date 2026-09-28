# COLOCATION benchmark

Ten small repositories under `examples/`, five violations and five correct
ones, to measure a COLOCATION checker before writing it:

```sh
reqfile test --only COLOCATION
```

The labels live in the folder names; the rationale lives here, outside the
cases, so a checker reading a case cannot see it.

| Case | Language | Why |
|---|---|---|
| violation-utils-single-users | TS | `src/utils/` holds two helpers, each imported by one feature only (billing, cart). |
| violation-package-by-layer | Python | Invoices and customers are each split across `models/`, `repositories/` and `services/`. |
| violation-distant-test | TS | `shipping.test.ts` sits next to its module, but `discount.test.ts` lives in a mirror tree under `test/unit/`. |
| violation-component-assets-scattered | TSX | Avatar's stylesheet is in `src/styles/` and its fixture in `fixtures/`, both used by Avatar only. |
| violation-central-constants | Rust | `constants.rs` holds constants that each serve one module (`http`, `sync`). |
| ok-shared-by-two-features | TS | `money.ts` is used by billing and cart, and sits in their lowest common folder. |
| ok-feature-folders | Python | Each feature owns its model, logic and test in its own folder. |
| ok-rust-tool-imposed-tests | Rust | Unit tests are inside the module; integration tests are in the `tests/` folder cargo requires. |
| ok-component-folder | TSX | Avatar owns its stylesheet, test and fixture in its folder. |
| ok-constants-with-their-users | Rust | Each constant lives in the module that uses it; `config.rs`, used by several modules, is at the crate root. |

Violations and correct cases come in near pairs (same domain, different
layout), so a checker cannot score by recognising the domain.

## Baseline

The current check is a placeholder that flags nothing: 0 of 5 violations
caught, 0 of 5 correct cases flagged, a balanced accuracy of 50%.

## Label review

An independent model reviewer labeled the ten cases blind (renamed, shuffled,
given only the requirement text) and agreed with all ten labels. Its lowest
confidence was 0.8, on violation-central-constants: the requirement did not
say whether "used by one feature" is judged per file or per item. The
requirement now says per item, counts tests as users, and states that a
convention such as a mirrored test/ tree is not a location a tool requires.
This is model review, not human annotation.
