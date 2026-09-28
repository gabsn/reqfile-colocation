use slug::slugify;

#[test]
fn slugs_are_stable_for_callers() {
    assert_eq!(slugify("Rust 2024 Edition"), "rust-2024-edition");
}
