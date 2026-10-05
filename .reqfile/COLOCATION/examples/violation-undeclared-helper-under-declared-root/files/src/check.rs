//! `pin check`: every entry names a source pinned to a full commit.

use crate::format::{parse, Entry};

pub fn run(text: &str) -> bool {
    parse(text).iter().all(pinned)
}

fn pinned(entry: &Entry) -> bool {
    entry.source.rsplit_once('@').is_some_and(|(_, commit)| commit.len() == 40)
}
