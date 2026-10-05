/// A use block pinned to a commit.
pub fn pin(location: &str, commit: &str) -> String {
    format!("use: {location}@{commit}")
}
