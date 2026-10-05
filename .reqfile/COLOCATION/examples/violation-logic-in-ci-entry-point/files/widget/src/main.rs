//! widget: scores each case of a corpus file and prints the results as JSON lines.

fn main() {
    let corpus = std::env::args().nth(1).expect("usage: widget <corpus.txt>");
    let text = std::fs::read_to_string(corpus).expect("readable corpus");
    for line in text.lines() {
        let passed = line.split(',').all(|part| !part.trim().is_empty());
        println!("{{\"case\": {line:?}, \"passed\": {passed}}}");
    }
}
