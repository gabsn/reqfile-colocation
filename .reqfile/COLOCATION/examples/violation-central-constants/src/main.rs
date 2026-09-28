mod constants;
mod http;
mod sync;

fn main() {
    let client = http::Client::new();
    sync::run(&client);
}
