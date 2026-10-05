/// A use block pinned to a commit: the pure half of `add`.
pub fn pin(location: &str, commit: &str) -> String {
    format!("use: {location}@{commit}")
}
