use crate::parse::Spec;

/// Next minute of the day strictly after `minute_of_day`, if any today.
pub fn next_after(spec: &Spec, minute_of_day: u32) -> Option<u32> {
    spec.hours
        .iter()
        .flat_map(|h| spec.minutes.iter().map(move |m| h * 60 + m))
        .filter(|t| *t > minute_of_day)
        .min()
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse;

    #[test]
    fn next_is_strictly_after() {
        let spec = parse("0 9").unwrap();
        assert_eq!(next_after(&spec, 9 * 60), None);
        assert_eq!(next_after(&spec, 8 * 60), Some(9 * 60));
    }
}
