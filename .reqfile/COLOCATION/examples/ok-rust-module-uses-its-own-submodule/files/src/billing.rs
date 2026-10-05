pub mod tax;

pub fn total(net: u32) -> u32 {
    net + tax::rate(net)
}
