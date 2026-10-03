//! Stylo computed-style snapshot을 Taffy layout 입력으로 연결하는 내부 adapter입니다.

mod error;
mod projection;

#[cfg(test)]
mod tests;

pub use error::StyleLayoutError;
pub use projection::{StyleLayoutOutput, compute_style_layout};
