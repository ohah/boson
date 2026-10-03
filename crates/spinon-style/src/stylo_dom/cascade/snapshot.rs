use std::collections::BTreeMap;

use spinon_core::{
    DocumentGeneration, DocumentRevision, EnvironmentRevision, NodeId, RenderTreeRevision,
    StyleRevision,
};

use crate::{CssParseDiagnostic, OpaqueCssSrgb};

/// CSS 계산에 적용할 viewport와 플랫폼 환경 snapshot 출처입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CssViewport {
    pub width_css_px: f32,
    pub height_css_px: f32,
    pub device_scale_factor: f32,
    /// 이 viewport 값이 속한 플랫폼 환경 snapshot의 revision입니다.
    pub environment_revision: EnvironmentRevision,
}

impl CssViewport {
    pub const C04_FIXTURE: Self = Self {
        width_css_px: 800.0,
        height_css_px: 600.0,
        device_scale_factor: 1.0,
        environment_revision: EnvironmentRevision::INITIAL,
    };

    pub(crate) fn is_valid(self) -> bool {
        let device_width = self.width_css_px * self.device_scale_factor;
        let device_height = self.height_css_px * self.device_scale_factor;
        self.width_css_px.is_finite()
            && self.width_css_px > 0.0
            && self.height_css_px.is_finite()
            && self.height_css_px > 0.0
            && self.device_scale_factor.is_finite()
            && self.device_scale_factor > 0.0
            && device_width.is_finite()
            && device_width > 0.0
            && device_height.is_finite()
            && device_height > 0.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComputedElementStyle {
    pub node_id: NodeId,
    pub properties: BTreeMap<String, String>,
    /// S04 paint profile에서만 설정하는 Stylo 계산 배경색입니다.
    pub background_color: Option<OpaqueCssSrgb>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CascadeDiagnostic {
    pub source_id: String,
    pub node_id: Option<NodeId>,
    pub diagnostic: CssParseDiagnostic,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ComputedStyleSnapshot {
    pub profile: ComputedStyleProfile,
    pub viewport: CssViewport,
    pub style_revision: StyleRevision,
    pub generation: DocumentGeneration,
    pub document_revision: DocumentRevision,
    pub render_tree_revision: RenderTreeRevision,
    pub elements: Vec<ComputedElementStyle>,
    pub diagnostics: Vec<CascadeDiagnostic>,
}

/// computed-style snapshot을 만든 whitelist profile입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ComputedStyleProfile {
    /// C04.1의 5개 cascade 비교 속성입니다.
    BasicCascadeV1,
    /// C04.2의 제한 Taffy Flex 입력 속성입니다.
    FlexLayoutV1,
    /// S04의 Flex layout 속성과 불투명 `#RRGGBB` 배경 페인트입니다.
    S04FlexPaintV1,
}
