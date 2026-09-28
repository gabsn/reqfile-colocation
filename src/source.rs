//! What a path alone says about a file: its language, whether it is a test,
//! and the name a test shares with its subject.

use crate::paths;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Lang {
    Script,
    Python,
    Rust,
    Style,
}

pub fn lang(path: &str) -> Option<Lang> {
    match path.rsplit_once('.')?.1 {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" => Some(Lang::Script),
        "py" => Some(Lang::Python),
        "rs" => Some(Lang::Rust),
        "css" | "scss" | "sass" | "less" => Some(Lang::Style),
        _ => None,
    }
}

pub fn is_test(path: &str) -> bool {
    let name = paths::name(path);
    name.contains(".test.")
        || name.contains(".spec.")
        || (name.starts_with("test_") && name.ends_with(".py"))
        || name.ends_with("_test.py")
        || paths::dir(path)
            .split('/')
            .any(|part| matches!(part, "tests" | "test" | "__tests__"))
}

/// `discount` for `discount.test.ts`, `issue` for `test_issue.py`.
pub fn stem(path: &str) -> String {
    let name = paths::name(path);
    let base = name.split('.').next().unwrap_or(name);
    let base = base.strip_prefix("test_").unwrap_or(base);
    let base = base.strip_suffix("_test").unwrap_or(base);
    base.to_lowercase()
}
