pub const SQUARE_METRES_PER_HECTARE: f64 = 10_000.0;

pub fn hectares(square_metres: f64) -> f64 {
    square_metres / SQUARE_METRES_PER_HECTARE
}

#[cfg(test)]
mod tests {
    #[test]
    fn one_hectare_is_ten_thousand_square_metres() {
        assert_eq!(super::hectares(10_000.0), 1.0);
    }
}
