mod add;
mod check;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("add") => add::run(&args[2..]),
        _ => check::run(),
    }
}
