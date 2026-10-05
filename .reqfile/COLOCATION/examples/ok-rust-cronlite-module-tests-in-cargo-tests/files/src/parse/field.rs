/// Parses one cron field: `*`, `*/step` or a comma list of numbers.
pub fn parse_field(src: &str, min: u32, max: u32) -> Result<Vec<u32>, String> {
    if src == "*" {
        return Ok((min..=max).collect());
    }
    if let Some(step) = src.strip_prefix("*/") {
        let step: u32 = step.parse().map_err(|_| format!("bad step: {step}"))?;
        if step == 0 {
            return Err("step must be positive".into());
        }
        return Ok((min..=max).step_by(step as usize).collect());
    }
    let mut values = Vec::new();
    for part in src.split(',') {
        let v: u32 = part.parse().map_err(|_| format!("bad value: {part}"))?;
        if v < min || v > max {
            return Err(format!("{v} out of range {min}-{max}"));
        }
        values.push(v);
    }
    values.sort_unstable();
    values.dedup();
    Ok(values)
}
