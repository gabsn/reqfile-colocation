#[test]
fn quarter_hours_in_the_morning() {
    let spec = cronlite::parse("*/15 9").unwrap();
    assert_eq!(cronlite::next_after(&spec, 9 * 60 + 20), Some(9 * 60 + 30));
}
