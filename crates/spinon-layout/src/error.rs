use std::{error::Error, fmt};

use spinon_core::NodeId;

/// 입력 검증, Taffy 계산 또는 결과 변환 실패입니다.
#[derive(Clone, Debug, PartialEq)]
pub enum LayoutError {
    InvalidViewport,
    EmptyTree,
    InvalidHostDocumentRoot(NodeId),
    UnsupportedTextNode(NodeId),
    MissingRoot(NodeId),
    MissingStyle(NodeId),
    UnknownStyleNode(NodeId),
    DuplicateNode(NodeId),
    MissingChild { parent: NodeId, child: NodeId },
    DuplicateChild { parent: NodeId, child: NodeId },
    RootHasParent(NodeId),
    MultipleParents(NodeId),
    DetachedNode(NodeId),
    Cycle(NodeId),
    UnreachableNode(NodeId),
    RootSizeMismatch { axis: &'static str },
    InvalidStyle { node: NodeId, field: &'static str },
    Taffy(String),
    TaffyPanicked,
    MissingComputedLayout(NodeId),
    NonFiniteFrame(NodeId),
}

impl fmt::Display for LayoutError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidViewport => {
                write!(formatter, "화면 크기는 0보다 큰 유한한 값이어야 합니다")
            }
            Self::EmptyTree => write!(formatter, "레이아웃할 코어 트리에 루트가 없습니다"),
            Self::InvalidHostDocumentRoot(id) => write!(
                formatter,
                "HostDocument 레이아웃 루트 {id}는 HostRoot 직속 요소가 아닙니다"
            ),
            Self::UnsupportedTextNode(id) => write!(
                formatter,
                "텍스트 노드 {id}는 intrinsic measurement를 지원하지 않습니다"
            ),
            Self::MissingRoot(id) => write!(formatter, "루트 노드 {id}를 찾을 수 없습니다"),
            Self::MissingStyle(id) => write!(formatter, "노드 {id}의 계산된 스타일이 없습니다"),
            Self::UnknownStyleNode(id) => {
                write!(formatter, "스타일의 노드 {id}가 코어 트리에 없습니다")
            }
            Self::DuplicateNode(id) => write!(formatter, "노드 ID {id}가 중복되었습니다"),
            Self::MissingChild { parent, child } => {
                write!(formatter, "노드 {parent}의 자식 {child}를 찾을 수 없습니다")
            }
            Self::DuplicateChild { parent, child } => {
                write!(formatter, "노드 {parent}에 자식 {child}가 중복되었습니다")
            }
            Self::RootHasParent(id) => {
                write!(formatter, "루트 노드 {id}는 다른 노드의 자식일 수 없습니다")
            }
            Self::MultipleParents(id) => write!(formatter, "노드 {id}에 부모가 둘 이상 있습니다"),
            Self::DetachedNode(id) => write!(formatter, "루트가 아닌 노드 {id}에 부모가 없습니다"),
            Self::Cycle(id) => write!(formatter, "노드 {id}에서 순환 참조를 발견했습니다"),
            Self::UnreachableNode(id) => {
                write!(formatter, "노드 {id}는 루트에서 도달할 수 없습니다")
            }
            Self::RootSizeMismatch { axis } => {
                write!(formatter, "루트의 {axis} 크기는 viewport와 같아야 합니다")
            }
            Self::InvalidStyle { node, field } => {
                write!(formatter, "노드 {node}의 {field} 값이 유효하지 않습니다")
            }
            Self::Taffy(message) => {
                write!(formatter, "Taffy 레이아웃 계산에 실패했습니다: {message}")
            }
            Self::TaffyPanicked => {
                write!(formatter, "Taffy 레이아웃 계산이 panic으로 중단되었습니다")
            }
            Self::MissingComputedLayout(id) => {
                write!(formatter, "노드 {id}의 계산된 레이아웃을 찾을 수 없습니다")
            }
            Self::NonFiniteFrame(id) => {
                write!(formatter, "노드 {id}의 계산 결과가 유한하지 않습니다")
            }
        }
    }
}

impl Error for LayoutError {}
