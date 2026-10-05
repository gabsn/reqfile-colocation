pub use crate::tax::rate;

pub fn total(net: u32) -> u32 {
    net + rate(net)
}
