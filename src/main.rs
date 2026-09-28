//! reqfile-colocation: reads the repository in the current folder and prints
//! a SARIF report of where files live relative to the code that uses them.
//! Exit 0 when nothing fails, 1 when something does, 2 when it cannot run.

mod imports;
mod paths;
mod resolve;
mod rules;
mod sarif;
mod source;

use std::collections::{BTreeMap, BTreeSet};
use std::process::ExitCode;
use std::sync::LazyLock;

use regex::Regex;

use resolve::Project;

fn main() -> ExitCode {
    if std::env::args().any(|arg| arg == "--version") {
        println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    match load(".") {
        Ok(project) => {
            let edges = resolve::edges(&project);
            let crates: BTreeSet<String> = project.crates.keys().cloned().collect();
            let judgments = rules::judge(&project.files, &project.sources, &edges, &crates);
            println!("{}", sarif::report(&judgments));
            ExitCode::from(if judgments.iter().any(sarif::failed) { 1 } else { 0 })
        }
        Err(error) => {
            eprintln!("reqfile-colocation: {error}");
            ExitCode::from(2)
        }
    }
}

static PACKAGE_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?m)^name\s*=\s*"([^"]+)""#).unwrap());

/// Every file git would track under `root`, with the sources and manifests read.
fn load(root: &str) -> Result<Project, String> {
    let mut files = BTreeSet::new();
    for entry in ignore::WalkBuilder::new(root).build() {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_some_and(|t| t.is_file()) {
            let path = entry.path().strip_prefix(root).map_err(|e| e.to_string())?;
            files.insert(path.to_string_lossy().replace('\\', "/"));
        }
    }
    let read = |path: &str| std::fs::read_to_string(paths::join(root, path)).map_err(|e| format!("{path}: {e}"));
    let mut sources = BTreeMap::new();
    for path in files.iter().filter(|p| source::lang(p).is_some()) {
        sources.insert(path.clone(), read(path)?);
    }
    let mut crates = BTreeMap::new();
    for manifest in files.iter().filter(|p| paths::name(p) == "Cargo.toml") {
        if let Some(name) = PACKAGE_NAME.captures(&read(manifest)?) {
            crates.insert(paths::dir(manifest).to_string(), name[1].to_string());
        }
    }
    let mut python_roots = vec![String::new()];
    for manifest in files.iter().filter(|p| matches!(paths::name(p), "pyproject.toml" | "setup.py")) {
        let dir = paths::dir(manifest);
        python_roots.extend([dir.to_string(), paths::join(dir, "src")]);
    }
    python_roots.dedup();
    Ok(Project { files, sources, crates, python_roots })
}
