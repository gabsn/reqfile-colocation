//! `add`: writes a use block pinned to a commit.

// Interface

pub fn run(args: &[String]) {
    write(&pin(&args[0], &args[1]));
}

// Domain: pure

fn pin(location: &str, commit: &str) -> String {
    format!("use: {location}@{commit}")
}

// I/O

fn write(line: &str) {
    std::fs::write("Reqfile.yaml", line).unwrap();
}
