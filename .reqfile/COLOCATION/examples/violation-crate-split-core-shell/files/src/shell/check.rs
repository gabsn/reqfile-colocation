use crate::core::plan::plan;

/// Lists the repository and runs the planned checks.
pub fn run() {
    let files: Vec<String> = std::fs::read_dir(".")
        .unwrap()
        .map(|e| e.unwrap().path().display().to_string())
        .collect();
    for file in plan(&files, ".rs") {
        println!("{file}");
    }
}
