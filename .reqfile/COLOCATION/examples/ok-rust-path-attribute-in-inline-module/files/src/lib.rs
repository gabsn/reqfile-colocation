mod nested {
    #[path = "implementation.rs"]
    pub mod implementation;
}
pub fn run() -> u32 { nested::implementation::value() }
