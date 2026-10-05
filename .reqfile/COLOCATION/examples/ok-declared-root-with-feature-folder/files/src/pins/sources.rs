//! Git sources: the commit a repository's latest tag points to.

pub fn latest_commit(repo: &str) -> String {
    let out = std::process::Command::new("git")
        .args(["ls-remote", "--tags", &format!("https://github.com/{repo}")])
        .output()
        .expect("git runs");
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().last().and_then(|l| l.split_whitespace().next()).unwrap_or_default().to_string()
}
