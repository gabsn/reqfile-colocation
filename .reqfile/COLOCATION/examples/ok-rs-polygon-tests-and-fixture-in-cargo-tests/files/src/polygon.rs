#[derive(Debug, PartialEq)]
pub struct Polygon {
    pub points: Vec<(f64, f64)>,
}

#[derive(Debug, PartialEq)]
pub struct ParseError(pub String);

/// Parse a `POLYGON((x y, x y, ...))` well-known-text string (outer ring only).
pub fn parse_wkt(text: &str) -> Result<Polygon, ParseError> {
    let inner = text
        .trim()
        .strip_prefix("POLYGON((")
        .and_then(|rest| rest.strip_suffix("))"))
        .ok_or_else(|| ParseError(format!("not a polygon: {text}")))?;
    let points = inner
        .split(',')
        .map(|pair| {
            let mut coords = pair.split_whitespace().map(str::parse::<f64>);
            match (coords.next(), coords.next(), coords.next()) {
                (Some(Ok(x)), Some(Ok(y)), None) => Ok((x, y)),
                _ => Err(ParseError(format!("bad point: {pair}"))),
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Polygon { points })
}

/// Area in the square of the coordinate unit, by the shoelace formula.
pub fn area(polygon: &Polygon) -> f64 {
    let p = &polygon.points;
    let twice: f64 = (0..p.len())
        .map(|i| {
            let (x1, y1) = p[i];
            let (x2, y2) = p[(i + 1) % p.len()];
            x1 * y2 - x2 * y1
        })
        .sum();
    twice.abs() / 2.0
}
