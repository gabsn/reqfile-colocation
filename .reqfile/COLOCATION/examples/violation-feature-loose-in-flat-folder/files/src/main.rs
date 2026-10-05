mod add;
mod check;
mod format;
mod sources;
mod update;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let text = std::fs::read_to_string("pins.txt").unwrap_or_default();
    let out = match args.get(1).map(String::as_str) {
        Some("add") => add::run(&text, &args[2]),
        Some("update") => update::run(&text),
        _ => return println!("{}", check::run(&text)),
    };
    std::fs::write("pins.txt", out).unwrap();
}
