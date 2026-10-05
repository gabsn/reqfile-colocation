pub fn numbers(input: &str) -> Vec<f64> {
    input
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn skips_words_and_commas() {
        assert_eq!(super::numbers("1, 2 x 3.5"), vec![1.0, 2.0, 3.5]);
    }
}
