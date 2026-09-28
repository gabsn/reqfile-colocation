mod config;
mod http;
mod sync;

fn main() {
    let config = config::Config::from_env();
    let client = http::Client::new(&config);
    sync::run(&client, &config);
}
