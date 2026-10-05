/// Which files each check runs on.
pub fn plan(files: &[String], glob: &str) -> Vec<String> {
    files.iter().filter(|f| f.ends_with(glob)).cloned().collect()
}
