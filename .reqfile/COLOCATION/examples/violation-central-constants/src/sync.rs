use crate::constants::{MAX_RETRIES, RETRY_BACKOFF_MS};
use crate::http::Client;

pub fn run(client: &Client) {
    for attempt in 0..MAX_RETRIES {
        let wait = RETRY_BACKOFF_MS * u64::from(attempt);
        println!("attempt {attempt} after {wait} ms, timeout {}", client.timeout_ms);
    }
}
