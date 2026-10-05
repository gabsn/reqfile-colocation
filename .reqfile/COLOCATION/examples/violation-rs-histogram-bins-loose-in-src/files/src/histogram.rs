use crate::bins::Bins;

pub fn render(values: &[f64], count: usize) -> String {
    if values.is_empty() {
        return String::new();
    }
    let bins = Bins::covering(values, count);
    let mut counts = vec![0usize; count];
    for &v in values {
        counts[bins.index(v)] += 1;
    }
    counts
        .iter()
        .enumerate()
        .map(|(i, n)| format!("{:>8.2} | {}\n", bins.lower_edge(i), "#".repeat(*n)))
        .collect()
}
