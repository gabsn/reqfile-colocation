/// Scores a widget from its parts; the public API of the crate.
pub fn score(parts: &[u32]) -> u32 {
    parts.iter().sum()
}

#[cfg(test)]
mod tests {
    #[test]
    fn sums_parts() {
        assert_eq!(super::score(&[1, 2]), 3);
    }
}
