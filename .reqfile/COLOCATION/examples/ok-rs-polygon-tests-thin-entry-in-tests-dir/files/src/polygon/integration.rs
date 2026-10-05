use plotarea::polygon::{area, parse_wkt, ParseError};

const FIELD: &str = include_str!("fixtures/field.wkt");

#[test]
fn a_200_by_150_field_has_area_30000() {
    let field = parse_wkt(FIELD).unwrap();
    assert_eq!(area(&field), 30_000.0);
}

#[test]
fn a_line_string_is_rejected() {
    assert!(matches!(parse_wkt("LINESTRING(0 0, 1 1)"), Err(ParseError(_))));
}
