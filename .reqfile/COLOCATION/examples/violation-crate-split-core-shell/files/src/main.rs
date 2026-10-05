mod core;
mod shell;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("add") => shell::add::run(&args[2..]),
        _ => shell::check::run(),
    }
}
