use cronlite::parse::parse;
use cronlite::schedule::next_after;

#[test]
fn next_is_strictly_after() {
    let spec = parse("0 9").unwrap();
    assert_eq!(next_after(&spec, 9 * 60), None);
    assert_eq!(next_after(&spec, 8 * 60), Some(9 * 60));
}
