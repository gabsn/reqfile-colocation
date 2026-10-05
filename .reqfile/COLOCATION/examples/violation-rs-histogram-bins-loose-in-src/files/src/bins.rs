/// Equal-width bins between the smallest and largest value.
pub struct Bins {
    pub min: f64,
    pub width: f64,
    pub count: usize,
}

impl Bins {
    pub fn covering(values: &[f64], count: usize) -> Bins {
        let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
        let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let width = if max > min { (max - min) / count as f64 } else { 1.0 };
        Bins { min, width, count }
    }

    pub fn index(&self, value: f64) -> usize {
        (((value - self.min) / self.width) as usize).min(self.count - 1)
    }

    pub fn lower_edge(&self, i: usize) -> f64 {
        self.min + self.width * i as f64
    }
}

#[cfg(test)]
mod tests {
    use super::Bins;

    #[test]
    fn the_largest_value_falls_in_the_last_bin() {
        let bins = Bins::covering(&[0.0, 10.0], 4);
        assert_eq!(bins.index(10.0), 3);
    }
}
