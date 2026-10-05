//! `pin add <repo>`: adds an entry pinned to the repository's latest tag.

use crate::format::{parse, render, Entry};
use crate::sources::latest_commit;

pub fn run(text: &str, repo: &str) -> String {
    let mut entries = parse(text);
    entries.push(Entry { name: repo.into(), source: format!("{repo}@{}", latest_commit(repo)) });
    render(&entries)
}
