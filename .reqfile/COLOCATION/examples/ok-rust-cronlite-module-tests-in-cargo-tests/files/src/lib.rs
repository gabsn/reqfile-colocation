//! Minimal `minute hour` cron expressions.

pub mod parse;
pub mod schedule;

pub use parse::{parse, Spec};
pub use schedule::next_after;
