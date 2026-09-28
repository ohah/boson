use std::error::Error;
use std::fmt;

use crate::{NodeId, Revision};

/// 작업 묶음 전체를 거부한 이유입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommitErrorKind {
    StaleRevision {
        expected: Revision,
        actual: Revision,
    },
    DuplicateNodeId(NodeId),
    InvalidTag,
    UnknownNode(NodeId),
    NodeAlreadyAttached(NodeId),
    NodeNotAttached(NodeId),
    UnknownParent(NodeId),
    RootAlreadyExists(NodeId),
    InvalidIndex {
        index: usize,
        child_count: usize,
    },
    Cycle {
        node: NodeId,
        parent: NodeId,
    },
    UnattachedNodes(Vec<NodeId>),
    RevisionExhausted,
}

/// 실패한 작업 묶음에 대한 진단입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitError {
    operation_index: Option<usize>,
    kind: CommitErrorKind,
}

impl fmt::Display for CommitErrorKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StaleRevision { expected, actual } => write!(
                formatter,
                "기준 revision이 오래됐습니다: 요청 {expected}, 현재 {actual}"
            ),
            Self::DuplicateNodeId(id) => write!(formatter, "이미 사용한 노드 ID입니다: {id}"),
            Self::InvalidTag => {
                formatter.write_str("태그는 비어 있거나 공백·NUL 문자를 포함할 수 없습니다")
            }
            Self::UnknownNode(id) => write!(formatter, "노드를 찾을 수 없습니다: {id}"),
            Self::NodeAlreadyAttached(id) => write!(formatter, "이미 연결된 노드입니다: {id}"),
            Self::NodeNotAttached(id) => write!(formatter, "트리에 연결되지 않은 노드입니다: {id}"),
            Self::UnknownParent(id) => write!(formatter, "부모 노드를 찾을 수 없습니다: {id}"),
            Self::RootAlreadyExists(id) => write!(formatter, "root가 이미 존재합니다: {id}"),
            Self::InvalidIndex { index, child_count } => write!(
                formatter,
                "자식 위치 {index}가 범위를 벗어났습니다 (자식 수: {child_count})"
            ),
            Self::Cycle { node, parent } => {
                write!(
                    formatter,
                    "노드 {node}를 하위 노드 {parent}에 연결할 수 없습니다"
                )
            }
            Self::UnattachedNodes(ids) => {
                formatter.write_str("root에 연결되지 않은 노드가 있습니다:")?;
                for id in ids {
                    write!(formatter, " {id}")?;
                }
                Ok(())
            }
            Self::RevisionExhausted => formatter.write_str("revision 번호가 모두 사용되었습니다"),
        }
    }
}

impl CommitError {
    pub const fn operation_index(&self) -> Option<usize> {
        self.operation_index
    }

    pub const fn kind(&self) -> &CommitErrorKind {
        &self.kind
    }

    pub(crate) fn batch(kind: CommitErrorKind) -> Self {
        Self {
            operation_index: None,
            kind,
        }
    }

    pub(crate) fn operation(index: usize, kind: CommitErrorKind) -> Self {
        Self {
            operation_index: Some(index),
            kind,
        }
    }
}

impl fmt::Display for CommitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.operation_index {
            Some(index) => write!(
                formatter,
                "작업 {index}에서 커밋을 거부했습니다: {}",
                self.kind
            ),
            None => write!(formatter, "커밋을 거부했습니다: {}", self.kind),
        }
    }
}

impl Error for CommitError {}
