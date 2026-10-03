//! S04 computed style과 layout 결과를 플랫폼 중립 RenderSnapshot으로 변환합니다.

mod adapter;
mod error;

#[cfg(test)]
mod tests;

pub use adapter::{FixtureNodeMapping, RenderFixtureProvenance, build_s04_static_render_snapshot};
pub use error::StyleRenderError;
