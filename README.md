# reqfile-colocation

A shareable [reqfile](https://reqfile.dev) requirement: **COLOCATION**, code
lives in the lowest folder that contains everything using it.

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
reqfile eval --use gabsn/reqfile-colocation@v0.1.2    # its score on its examples
reqfile check --use gabsn/reqfile-colocation@v0.1.2   # its findings on your code
reqfile add gabsn/reqfile-colocation@v0.1.2           # writes the line below
```

which writes:

```yaml
code:
  - { id: COLOCATION, use: gabsn/reqfile-colocation@<commit> }  # v0.1.2
```

The check runs `bunx @g48in/reqfile-colocation@0.1.1`: Bun fetches the checker from
npm once and caches it, nothing to install. With Node only, replace the check
in your use block with `run: npx -y @g48in/reqfile-colocation@0.1.1`.

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

A probability above 0.7 is a violation (`thresholds` in Reqfile.yaml); files
judged fine are reported as `pass` results with 0.1.

Imports are read with regular expressions, not parsers: fast (about 60 ms on
a mid-size repository), but approximate. The checker is plain TypeScript with
no dependencies, bundled to one Node-compatible file on publish.

## Measure it

```sh
bun install && bun test          # unit tests
reqfile eval                     # the labeled benchmark
```

`reqfile eval` runs the version named in Reqfile.yaml, the published one. To
measure the working copy before a release, `bun run build` and temporarily set
the check to `run: node dist/main.js`. reqfile has no way yet to point a
package's own checks at its working copy; the spike surfaced this.

## Release

Bump `version` in package.json and in the `run:` of Reqfile.yaml, then push a
tag `vX.Y.Z`. CI tests, builds and publishes to npm through trusted
publishing, without a stored token.
