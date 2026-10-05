//! `check`: runs the checks that apply to the repository's files.

// Interface

/// Lists the repository and runs the planned checks.
pub fn run() {
    let files = list_files();
    for file in plan(&files, ".rs") {
        println!("{file}");
    }
}

// Domain: pure

/// Which files each check runs on.
fn plan(files: &[String], glob: &str) -> Vec<String> {
    files.iter().filter(|f| f.ends_with(glob)).cloned().collect()
}

// I/O

fn list_files() -> Vec<String> {
    std::fs::read_dir(".")
        .unwrap()
        .map(|e| e.unwrap().path().display().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn plans_matching_files() {
        let files = vec!["a.rs".to_string(), "b.py".to_string()];
        assert_eq!(super::plan(&files, ".rs"), vec!["a.rs".to_string()]);
    }
}
