//! The config file format: one `name = source` entry per line.

pub struct Entry {
    pub name: String,
    pub source: String,
}

pub fn parse(text: &str) -> Vec<Entry> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .map(|(name, source)| Entry { name: name.trim().into(), source: source.trim().into() })
        .collect()
}

pub fn render(entries: &[Entry]) -> String {
    entries.iter().map(|e| format!("{} = {}\n", e.name, e.source)).collect()
}
