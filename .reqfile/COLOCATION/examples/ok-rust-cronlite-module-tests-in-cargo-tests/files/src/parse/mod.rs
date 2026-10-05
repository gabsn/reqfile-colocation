pub mod field;

use field::parse_field;

/// A parsed `minute hour` expression.
#[derive(Debug, Clone, PartialEq)]
pub struct Spec {
    pub minutes: Vec<u32>,
    pub hours: Vec<u32>,
}

pub fn parse(expr: &str) -> Result<Spec, String> {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() != 2 {
        return Err(format!("expected 2 fields, got {}", parts.len()));
    }
    Ok(Spec {
        minutes: parse_field(parts[0], 0, 59)?,
        hours: parse_field(parts[1], 0, 23)?,
    })
}
