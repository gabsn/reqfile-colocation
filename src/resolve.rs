//! Turns the imports of each file into edges between repository files.

use std::collections::{BTreeMap, BTreeSet};

use crate::imports::{self, Import};
use crate::paths;
use crate::source::{self, Lang};

/// `from` uses `items` of `to`; no items means the whole file.
#[derive(Debug, Clone)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub items: Vec<String>,
}

/// The repository as the resolver sees it.
pub struct Project {
    /// Every file, by repository-relative path.
    pub files: BTreeSet<String>,
    /// Source text of the files in a known language.
    pub sources: BTreeMap<String, String>,
    /// Rust crates: the folder of each Cargo.toml and its package name.
    pub crates: BTreeMap<String, String>,
    /// Folders Python absolute imports start from.
    pub python_roots: Vec<String>,
}

pub fn edges(project: &Project) -> Vec<Edge> {
    let modules = rust_modules(project);
    let mut edges = Vec::new();
    for (path, text) in &project.sources {
        let found = match source::lang(path) {
            Some(Lang::Script) => script(project, path, imports::script(text)),
            Some(Lang::Python) => python(project, path, imports::python(text)),
            Some(Lang::Rust) => rust(project, &modules, path, imports::rust(text)),
            Some(Lang::Style) | None => vec![],
        };
        edges.extend(found.into_iter().filter(|edge| edge.to != *path));
    }
    merge(edges)
}

/// One edge per pair of files, with the union of their items.
fn merge(edges: Vec<Edge>) -> Vec<Edge> {
    let mut merged: BTreeMap<(String, String), Option<BTreeSet<String>>> = BTreeMap::new();
    for edge in edges {
        let entry = merged.entry((edge.from, edge.to)).or_insert_with(|| Some(BTreeSet::new()));
        match (entry.as_mut(), edge.items.is_empty()) {
            (Some(_), true) => *entry = None,
            (Some(items), false) => items.extend(edge.items),
            (None, _) => {}
        }
    }
    merged
        .into_iter()
        .map(|((from, to), items)| Edge { from, to, items: items.map(Vec::from_iter).unwrap_or_default() })
        .collect()
}

const SCRIPT_CANDIDATES: [&str; 11] =
    ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

fn script(project: &Project, from: &str, imports: Vec<Import>) -> Vec<Edge> {
    imports
        .into_iter()
        .filter_map(|import| {
            let base = paths::normalize(&paths::join(paths::dir(from), &import.module))?;
            let to = SCRIPT_CANDIDATES
                .iter()
                .map(|suffix| format!("{base}{suffix}"))
                .find(|candidate| project.files.contains(candidate))?;
            Some(Edge { from: from.to_string(), to, items: import.items })
        })
        .collect()
}

fn python(project: &Project, from: &str, imports: Vec<Import>) -> Vec<Edge> {
    let mut edges = Vec::new();
    for import in imports {
        let dots = import.module.chars().take_while(|c| *c == '.').count();
        let module = import.module[dots..].replace('.', "/");
        let bases: Vec<String> = if dots > 0 {
            let mut base = paths::dir(from).to_string();
            for _ in 1..dots {
                base = paths::dir(&base).to_string();
            }
            vec![base]
        } else {
            project.python_roots.clone()
        };
        let find = |module: &str| {
            bases.iter().find_map(|base| {
                let stem = paths::join(base, module);
                [format!("{stem}.py"), format!("{stem}/__init__.py")]
                    .into_iter()
                    .find(|candidate| project.files.contains(candidate))
            })
        };
        let mut items = Vec::new();
        for item in &import.items {
            // `from pkg import module` names a file rather than an item.
            match find(&paths::join(&module, item)) {
                Some(to) => edges.push(Edge { from: from.to_string(), to, items: vec![] }),
                None => items.push(item.clone()),
            }
        }
        if import.items.is_empty() || !items.is_empty() {
            if let Some(to) = find(&module) {
                edges.push(Edge { from: from.to_string(), to, items });
            }
        }
    }
    edges
}

/// Module paths of each crate: crate folder -> module segments -> file.
type Modules = BTreeMap<String, BTreeMap<Vec<String>, String>>;

fn rust_modules(project: &Project) -> Modules {
    let mut modules: Modules = BTreeMap::new();
    for path in project.files.iter().filter(|p| p.ends_with(".rs")) {
        if let Some((krate, segments)) = rust_module_of(project, path) {
            let crate_modules = modules.entry(krate).or_default();
            // A library root answers for the crate over a binary root.
            if segments.is_empty() && crate_modules.contains_key(&segments) && !path.ends_with("lib.rs") {
                continue;
            }
            crate_modules.insert(segments, path.clone());
        }
    }
    modules
}

/// The crate folder of a file under its `src/`, and its module path.
fn rust_module_of(project: &Project, path: &str) -> Option<(String, Vec<String>)> {
    let krate = crate_of(project, path)?;
    let rel = path.strip_prefix(&paths::join(&krate, "src/"))?;
    let rel = rel.strip_suffix(".rs")?;
    let rel = rel.strip_suffix("/mod").unwrap_or(rel);
    let segments = match rel {
        "main" | "lib" => vec![],
        rel => rel.split('/').map(str::to_string).collect(),
    };
    Some((krate, segments))
}

fn crate_of(project: &Project, path: &str) -> Option<String> {
    let mut dir = paths::dir(path);
    loop {
        if project.crates.contains_key(dir) {
            return Some(dir.to_string());
        }
        if dir.is_empty() {
            return None;
        }
        dir = paths::dir(dir);
    }
}

fn rust(project: &Project, modules: &Modules, from: &str, uses: Vec<Vec<String>>) -> Vec<Edge> {
    let Some(krate) = crate_of(project, from) else { return vec![] };
    let crate_modules = &modules[&krate];
    let crate_name = project.crates[&krate].replace('-', "_");
    let current = rust_module_of(project, from).map(|(_, segments)| segments);
    let mut edges = Vec::new();
    for path in uses {
        let Some(first) = path.first() else { continue };
        let (mut base, rest) = match (first.as_str(), &current) {
            ("crate", Some(_)) => (vec![], &path[1..]),
            ("self", Some(current)) => (current.clone(), &path[1..]),
            ("super", Some(current)) => {
                let supers = path.iter().take_while(|s| *s == "super").count();
                let Some(keep) = current.len().checked_sub(supers) else { continue };
                (current[..keep].to_vec(), &path[supers..])
            }
            (name, _) if name == crate_name => (vec![], &path[1..]),
            (name, Some(current)) if crate_modules.contains_key(&[current.clone(), vec![name.to_string()]].concat()) => {
                ([current.clone(), vec![name.to_string()]].concat(), &path[1..])
            }
            _ => continue,
        };
        let mut rest = rest.iter();
        let item = loop {
            match rest.next() {
                Some(seg) if crate_modules.contains_key(&[base.clone(), vec![seg.clone()]].concat()) => base.push(seg.clone()),
                other => break other,
            }
        };
        let Some(to) = crate_modules.get(&base) else { continue };
        let items = match item {
            Some(item) if item != "self" => vec![item.clone()],
            _ => vec![],
        };
        edges.push(Edge { from: from.to_string(), to: to.clone(), items });
    }
    edges
}
