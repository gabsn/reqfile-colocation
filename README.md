# reqfile-colocation

A shareable [reqfile](https://reqfile.dev) requirement: **COLOCATION**, code
lives in the lowest folder that contains everything using it.

This is a spike of what a community requirement package looks like: the
requirement, its checker and its labeled benchmark, in one repository with the
same layout as a requirement inside any project.

```
Reqfile.yaml                      # the requirement, same format as a local one
.reqfile/COLOCATION/examples/     # labeled benchmark: violation-… and ok-… repositories
.reqfile/COLOCATION/README.md     # why each case has its label
src/                              # the checker, binary reqfile-colocation
```

## Use it

```sh
cargo install --git https://github.com/gabsn/reqfile-colocation
```

Then copy the COLOCATION entry of [Reqfile.yaml](Reqfile.yaml) into your
Reqfile. A `use:` import is the next step of the spike.

## The checker

`reqfile-colocation` runs from the repository root, reads the whole repository
(respecting .gitignore) and prints SARIF: one result per judged file, `fail`
or `pass`, each with `properties.probability`, the probability that the file
breaks COLOCATION. Exit 0 when nothing fails, 1 when something does, 2 when it
cannot run.

It resolves imports of TS/JS, Python and Rust into a file graph, then flags:

| Signal | Probability |
|---|---|
| a file used only from one folder, living outside it | 0.9 |
| a test living outside the folder of the code it tests | 0.85 |
| one feature split across sibling layer folders (models/, services/…) | 0.85 |
| a file whose items serve disjoint sets of users | 0.75 |

Imports are read with regular expressions, not parsers: fast (15 ms on a
mid-size repository), but approximate.

## Measure it

```sh
cargo install --path . && reqfile test
```

11 examples, 11 as labeled. The benchmark is small and was written together
with the checker, so this is a sanity check, not evidence of accuracy on
unseen code.
