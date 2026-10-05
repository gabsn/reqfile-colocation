mod billing;

fn main() {
    println!("{} {}", billing::total(100), billing::tax::rate(100));
}
