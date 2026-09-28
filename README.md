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

In your Reqfile (reqfile 0.2 or later), with [uv](https://docs.astral.sh/uv/)
installed:

```yaml
code:
  - { id: COLOCATION, use: gabsn/reqfile-colocation@v0.1.1 }
```

The check runs `uvx reqfile-colocation==0.1.1`: uv fetches the checker from
PyPI once and caches it, nothing to install. Without uv, replace the check in
your use block with `cargo install reqfile-colocation` and
`run: reqfile-colocation`.

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

`reqfile test` runs the version named in Reqfile.yaml, the published one. To
measure the working copy before a release, `cargo install --path .` and
temporarily set the check to `run: reqfile-colocation`. reqfile has no way yet
to point a package's own checks at its working copy; the spike surfaced this.

## Release

Bump `version` in Cargo.toml and in the `run:` of Reqfile.yaml, then push a
tag `vX.Y.Z`. The release workflow builds wheels for Linux, macOS and Windows
and publishes them to PyPI through trusted publishing, without a stored token.

11 examples, 11 as labeled. The benchmark is small and was written together
with the checker, so this is a sanity check, not evidence of accuracy on
unseen code.
