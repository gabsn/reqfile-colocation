//! Repository-relative paths, always with `/` separators, `""` for the root.

pub fn dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

pub fn name(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

pub fn join(dir: &str, rel: &str) -> String {
    if dir.is_empty() {
        rel.to_string()
    } else {
        format!("{dir}/{rel}")
    }
}

/// Resolves `.` and `..`; `None` when the path leaves the repository.
pub fn normalize(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

/// Whether `path` is `folder` itself or inside it.
pub fn within(path: &str, folder: &str) -> bool {
    folder.is_empty() || path == folder || path.starts_with(&format!("{folder}/"))
}

/// The lowest folder containing every one of `folders`.
pub fn common_folder<'a>(folders: impl IntoIterator<Item = &'a str>) -> String {
    let mut common: Option<Vec<&str>> = None;
    for folder in folders {
        let parts: Vec<&str> = folder.split('/').filter(|p| !p.is_empty()).collect();
        common = Some(match common {
            None => parts,
            Some(common) => common
                .into_iter()
                .zip(parts)
                .take_while(|(a, b)| a == b)
                .map(|(a, _)| a)
                .collect(),
        });
    }
    common.unwrap_or_default().join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_folder_stops_at_the_first_difference() {
        assert_eq!(common_folder(["src/billing", "src/cart"]), "src");
        assert_eq!(common_folder(["src/billing"]), "src/billing");
        assert_eq!(common_folder(["src", "test/unit"]), "");
    }

    #[test]
    fn normalize_resolves_parent_segments() {
        assert_eq!(normalize("test/unit/../../src/a.ts").as_deref(), Some("src/a.ts"));
        assert_eq!(normalize("../a.ts"), None);
    }
}
