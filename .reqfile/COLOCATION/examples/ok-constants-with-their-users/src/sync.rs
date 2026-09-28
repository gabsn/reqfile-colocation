use crate::config::Config;
use crate::http::Client;

const MAX_RETRIES: u32 = 5;
const RETRY_BACKOFF_MS: u64 = 250;

pub fn run(client: &Client, config: &Config) {
    for attempt in 0..MAX_RETRIES {
        let wait = RETRY_BACKOFF_MS * u64::from(attempt);
        println!("{} attempt {attempt} after {wait} ms, timeout {}", config.endpoint, client.timeout_ms);
    }
}
