use crate::config::Config;

const REQUEST_TIMEOUT_MS: u64 = 10_000;

pub struct Client {
    pub endpoint: String,
    pub timeout_ms: u64,
}

impl Client {
    pub fn new(config: &Config) -> Self {
        Client { endpoint: config.endpoint.clone(), timeout_ms: REQUEST_TIMEOUT_MS }
    }
}
