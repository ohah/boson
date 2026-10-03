//! 플랫폼 API나 GPU 자원을 포함하지 않는 불변 렌더 입력 자료형입니다.

use std::{collections::BTreeSet, error::Error, fmt};

use spinon_core::{
    DocumentGeneration, DocumentRevision, EnvironmentRevision, NodeId, RenderTreeRevision,
    StyleRevision,
};

/// CSS px 좌표계의 양수 viewport 크기입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CssSize {
    width: f32,
    height: f32,
}

impl CssSize {
    pub fn new(width: f32, height: f32) -> Result<Self, SnapshotError> {
        if !width.is_finite() || width <= 0.0 || !height.is_finite() || height <= 0.0 {
            return Err(SnapshotError::InvalidViewport);
        }
        Ok(Self { width, height })
    }

    pub const fn width(self) -> f32 {
        self.width
    }

    pub const fn height(self) -> f32 {
        self.height
    }
}

/// CSS px 좌표계의 절대 사각형입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CssRect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

impl CssRect {
    pub fn new(x: f32, y: f32, width: f32, height: f32) -> Result<Self, SnapshotError> {
        let right = x + width;
        let bottom = y + height;
        if !x.is_finite()
            || !y.is_finite()
            || !width.is_finite()
            || width < 0.0
            || !height.is_finite()
            || height < 0.0
            || !right.is_finite()
            || !bottom.is_finite()
        {
            return Err(SnapshotError::InvalidFrame);
        }
        Ok(Self {
            x,
            y,
            width,
            height,
        })
    }

    pub const fn x(self) -> f32 {
        self.x
    }

    pub const fn y(self) -> f32 {
        self.y
    }

    pub const fn width(self) -> f32 {
        self.width
    }

    pub const fn height(self) -> f32 {
        self.height
    }
}

/// Alpha가 255인 encoded sRGB 8-bit CSS 색입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OpaqueCssSrgb {
    red: u8,
    green: u8,
    blue: u8,
}

impl OpaqueCssSrgb {
    pub const fn new(red: u8, green: u8, blue: u8) -> Self {
        Self { red, green, blue }
    }

    pub const fn red(self) -> u8 {
        self.red
    }

    pub const fn green(self) -> u8 {
        self.green
    }

    pub const fn blue(self) -> u8 {
        self.blue
    }
}

/// S04 고정 입력을 계산한 Stylo 스타일 종류입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ComputedStyleProfileId {
    S04FlexPaintV1,
}

/// 레이아웃 엔진에 전달한 제한 속성 집합입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutProjectionId {
    TaffyFlexSubsetV1,
}

/// 장면에 전달한 페인트 속성 집합입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaintProfileId {
    OpaqueBackgroundColorV1,
}

/// 고정 fixture와 Chromium oracle을 추적하기 위한 출처입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StaticRenderSource {
    pub document_generation: DocumentGeneration,
    pub document_revision: DocumentRevision,
    pub render_tree_revision: RenderTreeRevision,
    pub style_revision: StyleRevision,
    pub environment_revision: EnvironmentRevision,
    pub computed_style_profile: ComputedStyleProfileId,
    pub layout_projection: LayoutProjectionId,
    pub paint_profile: PaintProfileId,
    pub fixture_id: String,
    pub fixture_sha256: [u8; 32],
    pub stylesheet_sha256: [u8; 32],
    pub chromium_reference_id: String,
    pub chromium_reference_sha256: [u8; 32],
}

/// 한 노드의 프레임, 단색 페인트 및 전역 순서입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StaticRenderBox {
    node_id: NodeId,
    frame_css_px: CssRect,
    paint: OpaqueCssSrgb,
    paint_order: u32,
}

impl StaticRenderBox {
    pub const fn new(
        node_id: NodeId,
        frame_css_px: CssRect,
        paint: OpaqueCssSrgb,
        paint_order: u32,
    ) -> Self {
        Self {
            node_id,
            frame_css_px,
            paint,
            paint_order,
        }
    }

    pub const fn node_id(self) -> NodeId {
        self.node_id
    }

    pub const fn frame_css_px(self) -> CssRect {
        self.frame_css_px
    }

    pub const fn paint(self) -> OpaqueCssSrgb {
        self.paint
    }

    pub const fn paint_order(self) -> u32 {
        self.paint_order
    }
}

/// GPU 표면으로 변환하기 전의 불변 전체 장면입니다.
#[derive(Clone, Debug, PartialEq)]
pub struct StaticRenderSnapshot {
    source: StaticRenderSource,
    viewport_css_px: CssSize,
    boxes: Vec<StaticRenderBox>,
}

impl StaticRenderSnapshot {
    pub fn new(
        source: StaticRenderSource,
        viewport_css_px: CssSize,
        boxes: Vec<StaticRenderBox>,
    ) -> Result<Self, SnapshotError> {
        let mut node_ids = BTreeSet::new();
        for (index, render_box) in boxes.iter().enumerate() {
            if !node_ids.insert(render_box.node_id) {
                return Err(SnapshotError::DuplicateNode(render_box.node_id));
            }
            if usize::try_from(render_box.paint_order).ok() != Some(index) {
                return Err(SnapshotError::InvalidPaintOrder);
            }
        }
        if boxes.is_empty() {
            return Err(SnapshotError::EmptyScene);
        }
        Ok(Self {
            source,
            viewport_css_px,
            boxes,
        })
    }

    pub const fn source(&self) -> &StaticRenderSource {
        &self.source
    }

    pub const fn viewport_css_px(&self) -> CssSize {
        self.viewport_css_px
    }

    pub fn boxes(&self) -> &[StaticRenderBox] {
        &self.boxes
    }
}

/// 불완전하거나 모순된 snapshot을 만든 이유입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SnapshotError {
    InvalidViewport,
    InvalidFrame,
    DuplicateNode(NodeId),
    InvalidPaintOrder,
    EmptyScene,
}

impl fmt::Display for SnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidViewport => formatter.write_str("렌더 viewport는 유한한 양수여야 합니다"),
            Self::InvalidFrame => {
                formatter.write_str("렌더 프레임은 유한하고 크기가 음수가 아니어야 합니다")
            }
            Self::DuplicateNode(node) => write!(formatter, "렌더 노드 {node}가 중복됩니다"),
            Self::InvalidPaintOrder => formatter.write_str("paint_order가 0부터 연속이어야 합니다"),
            Self::EmptyScene => formatter.write_str("렌더 장면에 노드가 없습니다"),
        }
    }
}

impl Error for SnapshotError {}

#[cfg(test)]
mod tests;
