//! Judges where each file lives, given the files that use it.

use std::collections::{BTreeMap, BTreeSet};

use crate::paths;
use crate::resolve::Edge;
use crate::source;

/// The probability that a file breaks COLOCATION, and why.
#[derive(Debug, PartialEq)]
pub struct Judgment {
    pub path: String,
    pub probability: f64,
    pub message: String,
}

const MISPLACED: f64 = 0.9;
const TEST_AWAY: f64 = 0.85;
const LAYERED: f64 = 0.85;
const GRAB_BAG: f64 = 0.75;
const PLACED: f64 = 0.1;

/// Folder names that group code by technical layer rather than by feature.
const LAYERS: [&str; 28] = [
    "model", "service", "repository", "repo", "controller", "view", "handler", "util", "helper", "constant", "type",
    "interface", "dto", "schema", "entity", "store", "reducer", "action", "selector", "style", "hook", "fixture",
    "mock", "manager", "provider", "adapter", "dao", "mapper",
];

/// One judgment per judged file: the highest-probability finding, or a pass.
pub fn judge(
    files: &BTreeSet<String>,
    sources: &BTreeMap<String, String>,
    edges: &[Edge],
    crates: &BTreeSet<String>,
) -> Vec<Judgment> {
    let mut findings: BTreeMap<String, Vec<(f64, String)>> = BTreeMap::new();
    let mut judged: BTreeSet<String> = BTreeSet::new();
    let mut add = |path: &str, probability: f64, message: String| {
        findings.entry(path.to_string()).or_default().push((probability, message));
    };

    let tests: Vec<&String> = files.iter().filter(|f| source::is_test(f) && !tool_required(f, crates)).collect();
    let mut subjects_of_tests: BTreeSet<&str> = BTreeSet::new();
    for test in tests {
        let imported: Vec<&str> =
            edges.iter().filter(|e| e.from == **test && !source::is_test(&e.to)).map(|e| e.to.as_str()).collect();
        let named: Vec<&str> = imported.iter().copied().filter(|to| source::stem(to) == source::stem(test)).collect();
        let subjects = if named.is_empty() { imported } else { named };
        if subjects.is_empty() {
            continue;
        }
        subjects_of_tests.extend(&subjects);
        judged.insert(test.clone());
        let home = paths::common_folder(subjects.iter().map(|s| paths::dir(s)));
        if !paths::within(paths::dir(test), &home) {
            add(test, TEST_AWAY, format!("{test} tests {} but lives outside {}/", subjects.join(", "), or_root(&home)));
        }
    }

    let mut users: BTreeMap<&str, Vec<&Edge>> = BTreeMap::new();
    for edge in edges {
        users.entry(edge.to.as_str()).or_default().push(edge);
    }
    for (target, edges) in &users {
        if source::is_test(target) || is_root(target, crates) {
            continue;
        }
        let production: Vec<&str> =
            edges.iter().map(|e| e.from.as_str()).filter(|from| !source::is_test(from)).collect();
        let placing = if !production.is_empty() {
            production
        } else if subjects_of_tests.contains(target) {
            continue; // judged from its tests
        } else {
            edges.iter().map(|e| e.from.as_str()).collect()
        };
        judged.insert(target.to_string());
        let home = paths::common_folder(placing.iter().map(|u| paths::dir(u)));
        if !paths::within(paths::dir(target), &home) {
            add(
                target,
                MISPLACED,
                format!("{target} is used only from {}/ ({}) but lives outside it", or_root(&home), placing.join(", ")),
            );
        }
        if let Some(clusters) = grab_bag(edges, sources.get(*target).map_or("", String::as_str)) {
            add(target, GRAB_BAG, format!("{target} holds items that serve separate users: {clusters}"));
        }
    }

    for (path, message) in layered(files) {
        judged.insert(path.clone());
        add(&path, LAYERED, message);
    }

    judged
        .into_iter()
        .map(|path| match findings.remove(&path) {
            Some(found) => {
                let probability = found.iter().map(|(p, _)| *p).fold(0.0, f64::max);
                let message = found.into_iter().map(|(_, m)| m).collect::<Vec<_>>().join("; ");
                Judgment { path, probability, message }
            }
            None => Judgment { path, probability: PLACED, message: "lives with the code that uses it".into() },
        })
        .collect()
}

fn or_root(folder: &str) -> &str {
    if folder.is_empty() { "." } else { folder }
}

/// Rust integration tests, benches and examples next to Cargo.toml, and migrations.
fn tool_required(path: &str, crates: &BTreeSet<String>) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    parts.iter().enumerate().any(|(i, part)| {
        *part == "migrations"
            || (matches!(*part, "tests" | "benches" | "examples") && crates.contains(&parts[..i].join("/")))
    })
}

/// Crate roots are reached through the crate name, from anywhere.
fn is_root(path: &str, crates: &BTreeSet<String>) -> bool {
    ["src/main.rs", "src/lib.rs"].iter().any(|root| {
        path.strip_suffix(root).is_some_and(|krate| crates.contains(krate.trim_end_matches('/')))
    })
}

/// When the items of a file split into groups used by disjoint sets of
/// files, those groups, described; `None` when the file is one piece.
/// Items named in one top-level block of the file, such as a function and
/// the type it returns, are one piece whoever uses them.
fn grab_bag(edges: &[&Edge], text: &str) -> Option<String> {
    if edges.iter().any(|e| e.items.is_empty()) {
        return None;
    }
    let items: BTreeSet<&str> = edges.iter().flat_map(|e| e.items.iter().map(String::as_str)).collect();
    let related = blocks(text).into_iter().map(|block| {
        let named: BTreeSet<&str> = items.iter().copied().filter(|item| mentions(block, item)).collect();
        (named, BTreeSet::new())
    });
    let uses = edges.iter().map(|edge| {
        (edge.items.iter().map(String::as_str).collect(), BTreeSet::from([edge.from.as_str()]))
    });
    // Each group: items that share a user or a block, and their users.
    let mut groups: Vec<(BTreeSet<&str>, BTreeSet<&str>)> = Vec::new();
    for mut merged in related.filter(|(named, _)| named.len() > 1).chain(uses) {
        groups.retain(|(items, users)| {
            if items.is_disjoint(&merged.0) {
                return true;
            }
            merged.0.extend(items);
            merged.1.extend(users);
            false
        });
        groups.push(merged);
    }
    if groups.len() < 2 {
        return None;
    }
    let describe = |(items, users): &(BTreeSet<&str>, BTreeSet<&str>)| {
        format!(
            "{} for {}",
            items.iter().copied().collect::<Vec<_>>().join(", "),
            users.iter().copied().collect::<Vec<_>>().join(", ")
        )
    };
    Some(groups.iter().map(describe).collect::<Vec<_>>().join("; "))
}

/// The top-level blocks of a source file: each starts at an unindented line
/// that does not close or continue the previous one.
fn blocks(text: &str) -> Vec<&str> {
    let mut blocks = Vec::new();
    let mut start = 0;
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let opens = !line.starts_with(|c: char| c.is_whitespace() || matches!(c, '}' | ')' | ']'));
        if opens && offset > start {
            blocks.push(&text[start..offset]);
            start = offset;
        }
        offset += line.len();
    }
    blocks.push(&text[start..]);
    blocks
}

/// Whether `line` contains `word` as a whole identifier.
fn mentions(line: &str, word: &str) -> bool {
    line.match_indices(word).any(|(i, _)| {
        let before = line[..i].chars().next_back();
        let after = line[i + word.len()..].chars().next();
        !before.is_some_and(is_ident) && !after.is_some_and(is_ident)
    })
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Files of one feature spread over sibling layer folders, such as
/// models/invoice.py, services/invoice_service.py.
fn layered(files: &BTreeSet<String>) -> Vec<(String, String)> {
    let mut by_parent: BTreeMap<&str, BTreeMap<String, Vec<&String>>> = BTreeMap::new();
    for file in files.iter().filter(|f| source::lang(f).is_some()) {
        let folder = paths::dir(file);
        let layer = singular(paths::name(folder));
        if !LAYERS.contains(&layer.as_str()) {
            continue;
        }
        let feature: Vec<String> =
            words(paths::name(file).split('.').next().unwrap_or("")).into_iter().filter(|w| *w != layer && !LAYERS.contains(&w.as_str())).collect();
        if feature.is_empty() || feature == ["init"] || feature == ["index"] {
            continue;
        }
        by_parent.entry(paths::dir(folder)).or_default().entry(feature.join("_")).or_default().push(file);
    }
    let mut found = Vec::new();
    for features in by_parent.values() {
        for (feature, files) in features {
            let folders: BTreeSet<&str> = files.iter().map(|f| paths::dir(f)).collect();
            if folders.len() < 2 {
                continue;
            }
            let list = folders.iter().map(|f| format!("{}/", paths::name(f))).collect::<Vec<_>>().join(", ");
            for file in files {
                found.push((
                    file.to_string(),
                    format!("feature `{feature}` is split across layer folders {list}; group it in one folder"),
                ));
            }
        }
    }
    found
}

fn singular(word: &str) -> String {
    let word = word.to_lowercase();
    if let Some(stem) = word.strip_suffix("ies") {
        format!("{stem}y")
    } else if word.ends_with("ss") {
        word
    } else {
        word.strip_suffix('s').map_or(word.clone(), str::to_string)
    }
}

/// `invoice_repository`, `invoiceRepository`, `invoice-repository` -> [invoice, repository].
fn words(name: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    for c in name.chars() {
        if (c == '_' || c == '-' || c.is_uppercase()) && !current.is_empty() {
            words.push(singular(&current));
            current.clear();
        }
        if c.is_alphanumeric() {
            current.push(c);
        }
    }
    if !current.is_empty() {
        words.push(singular(&current));
    }
    words
}
