pub fn describe(values: &[f64]) -> String {
    if values.is_empty() {
        return "n=0".to_string();
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    format!("n={} mean={:.2}", values.len(), mean)
}
