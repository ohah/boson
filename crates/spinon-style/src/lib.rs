//! 앱 바이너리에 포함하는 Spinon 기본 스타일 자원입니다.

use std::ffi::CStr;

mod stylesheet_registry;
mod stylo_dom;

pub use stylesheet_registry::{
    CssOrigin, CssParseDiagnostic, RegisteredStylesheet, StylesheetRegistry,
    StylesheetRegistryError, StylesheetSource,
};
pub use stylo_dom::{
    CascadeDiagnostic, ComputedElementStyle, ComputedStyleProfile, ComputedStyleSnapshot,
    CssCascadeError, CssViewport, StyloDocument, StyloDocumentView, StyloDomError, StyloElement,
    StyloNode, compute_flex_layout_cascade,
};

/// 지원 HTML 요소 기본 스타일 프로필의 초안 식별자입니다.
pub const UA_STYLESHEET_PROFILE_ID: &CStr = c"spinon-html-ua/0.1.0-draft";

/// 컴파일 시 앱 바이너리에 포함하는 기본 스타일 규칙입니다.
pub const UA_STYLESHEET: &str = include_str!("../resources/ua/supported-elements-v0.css");
