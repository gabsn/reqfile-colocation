mod billing;
mod tax;

fn main() {
    println!("{} {}", billing::total(100), billing::rate(100));
}
