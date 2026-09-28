use crate::constants::REQUEST_TIMEOUT_MS;

pub struct Client {
    pub timeout_ms: u64,
}

impl Client {
    pub fn new() -> Self {
        Client { timeout_ms: REQUEST_TIMEOUT_MS }
    }
}
