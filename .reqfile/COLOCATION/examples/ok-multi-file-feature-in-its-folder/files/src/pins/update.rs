//! `pin update`: moves every entry to its repository's latest tag.

use crate::format::{parse, render};
use super::sources::latest_commit;

pub fn run(text: &str) -> String {
    let mut entries = parse(text);
    for entry in &mut entries {
        let repo = entry.source.split('@').next().unwrap_or_default().to_string();
        entry.source = format!("{repo}@{}", latest_commit(&repo));
    }
    render(&entries)
}
