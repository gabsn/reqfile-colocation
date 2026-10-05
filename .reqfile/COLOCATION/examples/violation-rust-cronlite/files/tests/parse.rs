use cronlite::parse::parse;

#[test]
fn two_fields_are_required() {
    assert!(parse("5").is_err());
    assert_eq!(parse("5 9").unwrap().hours, vec![9]);
}
