pub struct Config {
    pub endpoint: String,
}

impl Config {
    pub fn from_env() -> Self {
        Config { endpoint: std::env::var("SYNCD_ENDPOINT").expect("SYNCD_ENDPOINT is set") }
    }
}
