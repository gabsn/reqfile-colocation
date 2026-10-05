use cronlite::parse::field::parse_field;

#[test]
fn star_expands_to_full_range() {
    assert_eq!(parse_field("*", 0, 3).unwrap(), vec![0, 1, 2, 3]);
}

#[test]
fn step_skips_values() {
    assert_eq!(parse_field("*/20", 0, 59).unwrap(), vec![0, 20, 40]);
}
