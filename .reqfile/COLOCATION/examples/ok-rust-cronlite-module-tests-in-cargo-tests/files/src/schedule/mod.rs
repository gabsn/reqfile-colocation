use crate::parse::Spec;

/// Next minute of the day strictly after `minute_of_day`, if any today.
pub fn next_after(spec: &Spec, minute_of_day: u32) -> Option<u32> {
    spec.hours
        .iter()
        .flat_map(|h| spec.minutes.iter().map(move |m| h * 60 + m))
        .filter(|t| *t > minute_of_day)
        .min()
}
