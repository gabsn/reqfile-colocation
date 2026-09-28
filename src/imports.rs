//! The imports written in a file, per language, before resolution.
//! Regular expressions rather than parsers: fast, and enough to measure.

use std::sync::LazyLock;

use regex::Regex;

/// An import of `items` from a module; no items means the whole module.
#[derive(Debug, PartialEq)]
pub struct Import {
    pub module: String,
    pub items: Vec<String>,
}

static SCRIPT_FROM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^[ \t]*(?:import|export)[ \t]+([^;=()'"]*?)[ \t\n]*from[ \t]*['"]([^'"\n]+)['"]"#).unwrap()
});
static SCRIPT_BARE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^[ \t]*import[ \t]*['"]([^'"\n]+)['"]|(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)"#).unwrap()
});

/// Relative imports of a TS or JS file; `module` is the specifier.
pub fn script(text: &str) -> Vec<Import> {
    let mut imports = Vec::new();
    for caps in SCRIPT_FROM.captures_iter(text) {
        imports.push(Import { module: caps[2].to_string(), items: script_items(&caps[1]) });
    }
    for caps in SCRIPT_BARE.captures_iter(text) {
        let module = caps.get(1).or(caps.get(2)).map_or("", |m| m.as_str());
        imports.push(Import { module: module.to_string(), items: vec![] });
    }
    imports.retain(|import| import.module.starts_with('.'));
    imports
}

fn script_items(clause: &str) -> Vec<String> {
    let clause = clause.trim().trim_start_matches("type ").trim();
    if clause.contains('*') {
        return vec![];
    }
    let (default, named) = match clause.split_once('{') {
        Some((default, named)) => (default, named.trim_end_matches(|c: char| c == '}' || c.is_whitespace())),
        None => (clause, ""),
    };
    let mut items: Vec<String> = named
        .split(',')
        .map(|item| item.trim().trim_start_matches("type ").split(" as ").next().unwrap_or("").trim().to_string())
        .filter(|item| !item.is_empty())
        .collect();
    if !default.trim().trim_end_matches(',').trim().is_empty() {
        items.push("default".into());
    }
    items
}

static PY_FROM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)").unwrap());
static PY_IMPORT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^[ \t]*import[ \t]+([^\n#]+)").unwrap());

/// Python imports; `module` keeps its leading dots.
pub fn python(text: &str) -> Vec<Import> {
    let mut imports = Vec::new();
    for caps in PY_FROM.captures_iter(text) {
        let items: Vec<String> = caps[2]
            .trim_matches(|c: char| c == '(' || c == ')' || c.is_whitespace())
            .split(',')
            .map(|item| item.split(" as ").next().unwrap_or("").trim().to_string())
            .filter(|item| !item.is_empty())
            .collect();
        let items = if items.iter().any(|i| i == "*") { vec![] } else { items };
        imports.push(Import { module: caps[1].to_string(), items });
    }
    for caps in PY_IMPORT.captures_iter(text) {
        for module in caps[1].split(',') {
            let module = module.split(" as ").next().unwrap_or("").trim();
            if !module.is_empty() {
                imports.push(Import { module: module.to_string(), items: vec![] });
            }
        }
    }
    imports
}

static RUST_USE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\buse\s+([^;]+);").unwrap());
static RUST_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b[a-z_][a-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+").unwrap());

/// Rust paths from `use` declarations and from `module::Item` expressions,
/// as segments; resolution decides which of them name modules of the crate.
pub fn rust(text: &str) -> Vec<Vec<String>> {
    let mut paths = Vec::new();
    for caps in RUST_USE.captures_iter(text) {
        for path in expand_use_tree(&caps[1]) {
            let path = path.split(" as ").next().unwrap_or("");
            let path: String = path.chars().filter(|c| !c.is_whitespace()).collect();
            paths.push(path);
        }
    }
    // Paths inside `use` declarations were expanded above; scanning them again
    // would read `a::{B}` as a use of the whole module `a`.
    let body = RUST_USE.replace_all(text, "");
    paths.extend(RUST_PATH.find_iter(&body).map(|m| m.as_str().to_string()));
    paths
        .into_iter()
        .map(|path| {
            path.trim_start_matches("::")
                .split("::")
                .filter(|seg| *seg != "*")
                .map(str::to_string)
                .collect()
        })
        .collect()
}

/// `a::{B, c::{D, self}}` into `a::B`, `a::c::D`, `a::c::self`.
fn expand_use_tree(tree: &str) -> Vec<String> {
    let tree = tree.trim();
    let Some(open) = tree.find('{') else {
        return vec![tree.to_string()];
    };
    let prefix = &tree[..open];
    let inner = &tree[open + 1..tree.rfind('}').unwrap_or(tree.len())];
    split_top_level(inner)
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .flat_map(|part| expand_use_tree(part).into_iter().map(move |path| format!("{prefix}{path}")))
        .collect()
}

fn split_top_level(text: &str) -> Vec<&str> {
    let (mut parts, mut depth, mut start) = (Vec::new(), 0, 0);
    for (i, c) in text.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(&text[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&text[start..]);
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_named_default_and_side_effect_imports() {
        let text = "import Money, { formatCents, type Cents as C } from \"../money\";\nimport \"./Avatar.css\";\nimport { x } from \"react\";\n";
        assert_eq!(
            script(text),
            vec![
                Import { module: "../money".into(), items: vec!["formatCents".into(), "Cents".into(), "default".into()] },
                Import { module: "./Avatar.css".into(), items: vec![] },
            ]
        );
    }

    #[test]
    fn python_from_and_plain_imports() {
        let text = "from crm.models.invoice import Invoice, Line as L\nimport os.path\nfrom . import (a,\n  b)\n";
        assert_eq!(
            python(text),
            vec![
                Import { module: "crm.models.invoice".into(), items: vec!["Invoice".into(), "Line".into()] },
                Import { module: ".".into(), items: vec!["a".into(), "b".into()] },
                Import { module: "os.path".into(), items: vec![] },
            ]
        );
    }

    #[test]
    fn rust_use_trees_are_expanded() {
        let paths = rust("use crate::constants::{MAX_RETRIES, http::{Client as C, self}};");
        assert!(paths.contains(&vec!["crate".into(), "constants".into(), "MAX_RETRIES".into()]));
        assert!(paths.contains(&vec!["crate".into(), "constants".into(), "http".into(), "Client".into()]));
        assert!(paths.contains(&vec!["crate".into(), "constants".into(), "http".into(), "self".into()]));
        assert!(!paths.contains(&vec!["crate".into(), "constants".into()]));
    }
}
