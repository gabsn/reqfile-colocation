use crate::core::pins::pin;

/// Writes a use block into Reqfile.yaml: the I/O half of `add`.
pub fn run(args: &[String]) {
    let line = pin(&args[0], &args[1]);
    std::fs::write("Reqfile.yaml", line).unwrap();
}
