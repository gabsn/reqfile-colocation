mod bins;
mod histogram;
mod parse;
mod summary;

use std::io::Read;

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("read stdin");
    let values = parse::numbers(&input);
    println!("{}", summary::describe(&values));
    print!("{}", histogram::render(&values, 4));
}
