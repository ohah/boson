use std::{error::Error, fmt};

use spinon_core::NodeId;
use spinon_layout::LayoutError;
use spinon_style::{CascadeDiagnostic, CssCascadeError};

/// 계산 스타일과 제한 Taffy profile을 연결하지 못한 이유입니다.
#[derive(Debug)]
pub enum StyleLayoutError {
    Cascade(CssCascadeError),
    CascadeDiagnostic(CascadeDiagnostic),
    UnsupportedProfile {
        profile: String,
    },
    SnapshotMismatch {
        field: &'static str,
    },
    UnsupportedInlineStyle(NodeId),
    MissingComputedElement(NodeId),
    DuplicateComputedElement(NodeId),
    MissingComputedProperty {
        node: NodeId,
        property: &'static str,
    },
    UnsupportedComputedValue {
        node: NodeId,
        property: &'static str,
        value: String,
    },
    Layout(LayoutError),
}

impl fmt::Display for StyleLayoutError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cascade(error) => write!(formatter, "Stylo cascade 계산에 실패했습니다: {error}"),
            Self::CascadeDiagnostic(diagnostic) => write!(
                formatter,
                "stylesheet {}의 CSS 진단을 layout 입력에서 허용하지 않습니다: {}",
                diagnostic.source_id, diagnostic.diagnostic.message
            ),
            Self::UnsupportedProfile { profile } => {
                write!(
                    formatter,
                    "computed-style profile {profile}를 이 adapter가 지원하지 않습니다"
                )
            }
            Self::SnapshotMismatch { field } => {
                write!(
                    formatter,
                    "스타일과 레이아웃 snapshot의 {field}가 일치하지 않습니다"
                )
            }
            Self::UnsupportedInlineStyle(node) => write!(
                formatter,
                "노드 {node}의 inline style 속성은 C04.2 입력 profile에서 지원하지 않습니다"
            ),
            Self::MissingComputedElement(node) => {
                write!(formatter, "노드 {node}의 computed-style 항목이 없습니다")
            }
            Self::DuplicateComputedElement(node) => {
                write!(formatter, "노드 {node}의 computed-style 항목이 중복됩니다")
            }
            Self::MissingComputedProperty { node, property } => {
                write!(
                    formatter,
                    "노드 {node}의 computed property {property}가 없습니다"
                )
            }
            Self::UnsupportedComputedValue {
                node,
                property,
                value,
            } => {
                write!(
                    formatter,
                    "노드 {node}의 {property} 값 {value:?}를 layout profile이 지원하지 않습니다"
                )
            }
            Self::Layout(error) => {
                write!(formatter, "Taffy 입력 또는 계산에 실패했습니다: {error}")
            }
        }
    }
}

impl Error for StyleLayoutError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Cascade(error) => Some(error),
            Self::CascadeDiagnostic(_) => None,
            Self::Layout(error) => Some(error),
            _ => None,
        }
    }
}

impl From<CssCascadeError> for StyleLayoutError {
    fn from(error: CssCascadeError) -> Self {
        Self::Cascade(error)
    }
}

impl From<LayoutError> for StyleLayoutError {
    fn from(error: LayoutError) -> Self {
        Self::Layout(error)
    }
}
