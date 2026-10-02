// C04 fixture 검증에서 먼저 사용하고 S10 layout 연결 단계에서 런타임 소비자를 추가합니다.
#[allow(dead_code)]
mod cascade;
mod document;
mod element;
mod node;
mod selectors;
mod style;

#[cfg(test)]
mod tests;

pub use document::{StyloDocument, StyloDocumentView, StyloDomError};
pub use element::StyloElement;
pub use node::StyloNode;
