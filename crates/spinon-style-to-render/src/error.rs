use std::{error::Error, fmt};

use spinon_core::NodeId;
use spinon_render::SnapshotError;

/// CSS, layout, HostDocument와의 일관성을 확인하지 못한 이유입니다.
#[derive(Debug)]
pub enum StyleRenderError {
    UnsupportedProfile,
    SnapshotMismatch { field: &'static str },
    CascadeDiagnostics,
    InvalidFixtureMetadata,
    InvalidViewport,
    InvalidRoot,
    UnsupportedTextNode(NodeId),
    DuplicateDocumentNode(NodeId),
    FixtureMappingLength { expected: usize, actual: usize },
    EmptyFixtureId { index: usize },
    DuplicateFixtureId(String),
    DuplicateFixtureNode(NodeId),
    FixtureMappingOrder { index: usize, fixture_id: String },
    DuplicateComputedStyle(NodeId),
    MissingComputedStyle(NodeId),
    UnexpectedComputedStyle(NodeId),
    MissingBackgroundColor(NodeId),
    MissingLayoutFrame(NodeId),
    UnexpectedLayoutFrame(NodeId),
    InvalidFrame(NodeId),
    PaintOrderOverflow,
    RenderSnapshot(SnapshotError),
}

impl fmt::Display for StyleRenderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedProfile => {
                formatter.write_str("S04FlexPaintV1 computed-style profile만 지원합니다")
            }
            Self::SnapshotMismatch { field } => {
                write!(
                    formatter,
                    "style, layout, HostDocument의 {field}가 일치하지 않습니다"
                )
            }
            Self::CascadeDiagnostics => formatter
                .write_str("CSS cascade 진단이 있는 결과는 RenderSnapshot에 사용할 수 없습니다"),
            Self::InvalidFixtureMetadata => {
                formatter.write_str("fixture 또는 Chromium reference 식별 정보가 비어 있습니다")
            }
            Self::InvalidViewport => formatter.write_str("CSS viewport가 유효하지 않습니다"),
            Self::InvalidRoot => formatter.write_str("HostDocument root가 연결된 요소가 아닙니다"),
            Self::UnsupportedTextNode(node) => {
                write!(
                    formatter,
                    "노드 {node}는 S04 정적 장면에서 텍스트를 지원하지 않습니다"
                )
            }
            Self::DuplicateDocumentNode(node) => {
                write!(
                    formatter,
                    "HostDocument preorder에 노드 {node}가 중복됩니다"
                )
            }
            Self::FixtureMappingLength { expected, actual } => write!(
                formatter,
                "fixture ID mapping 개수가 다릅니다: 문서 {expected}, mapping {actual}"
            ),
            Self::EmptyFixtureId { index } => {
                write!(
                    formatter,
                    "fixture ID mapping {index}의 문자열 ID가 비어 있습니다"
                )
            }
            Self::DuplicateFixtureId(id) => write!(formatter, "fixture ID {id}가 중복됩니다"),
            Self::DuplicateFixtureNode(node) => {
                write!(formatter, "fixture mapping에서 노드 {node}가 중복됩니다")
            }
            Self::FixtureMappingOrder { index, fixture_id } => write!(
                formatter,
                "fixture mapping {index}의 {fixture_id}가 HostDocument preorder와 다릅니다"
            ),
            Self::DuplicateComputedStyle(node) => {
                write!(formatter, "계산 style에서 노드 {node}가 중복됩니다")
            }
            Self::MissingComputedStyle(node) => {
                write!(formatter, "노드 {node}의 계산 style이 없습니다")
            }
            Self::UnexpectedComputedStyle(node) => {
                write!(
                    formatter,
                    "HostDocument 하위 트리 밖의 style 노드 {node}가 있습니다"
                )
            }
            Self::MissingBackgroundColor(node) => {
                write!(formatter, "노드 {node}의 typed background-color가 없습니다")
            }
            Self::MissingLayoutFrame(node) => {
                write!(formatter, "노드 {node}의 layout frame이 없습니다")
            }
            Self::UnexpectedLayoutFrame(node) => {
                write!(
                    formatter,
                    "HostDocument 하위 트리 밖의 layout frame {node}가 있습니다"
                )
            }
            Self::InvalidFrame(node) => {
                write!(
                    formatter,
                    "노드 {node}의 layout frame에 유한하지 않거나 음수인 크기가 있습니다"
                )
            }
            Self::PaintOrderOverflow => formatter.write_str("paint 순서가 u32 범위를 초과합니다"),
            Self::RenderSnapshot(error) => write!(formatter, "렌더 snapshot 검증 실패: {error}"),
        }
    }
}

impl Error for StyleRenderError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::RenderSnapshot(error) => Some(error),
            _ => None,
        }
    }
}

impl From<SnapshotError> for StyleRenderError {
    fn from(error: SnapshotError) -> Self {
        Self::RenderSnapshot(error)
    }
}
