#!/usr/bin/env bash
# Fails when widget scores lower on the corpus than at the merge-base with $1.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
widget=$(dirname "$here")
base=$(git merge-base "$1" HEAD)
git worktree add /tmp/base "$base"
trap 'git worktree remove --force /tmp/base' EXIT
cargo build --release --manifest-path /tmp/base/widget/Cargo.toml
cargo build --release --manifest-path "$widget/Cargo.toml"
/tmp/base/widget/target/release/widget "$here/corpus.txt" > /tmp/before.jsonl
"$widget/target/release/widget" "$here/corpus.txt" > /tmp/after.jsonl
before=$(python3 "$here/score.py" /tmp/before.jsonl)
after=$(python3 "$here/score.py" /tmp/after.jsonl)
echo "score: $before -> $after"
python3 -c "import sys; sys.exit(float('$after') < float('$before'))"
