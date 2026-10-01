use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt,
    num::NonZeroU64,
    sync::{Mutex, OnceLock},
};

use crate::NodeId;

use super::ParentRef;

static NEXT_DOCUMENT_GENERATION: OnceLock<Mutex<u64>> = OnceLock::new();

/// 한 번의 앱 런타임에 해당하는 문서 세대 식별자입니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DocumentGeneration(NonZeroU64);

impl DocumentGeneration {
    pub const fn get(self) -> u64 {
        self.0.get()
    }

    pub(super) fn allocate() -> Option<Self> {
        let mut next = NEXT_DOCUMENT_GENERATION
            .get_or_init(|| Mutex::new(1))
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let value = NonZeroU64::new(*next)?;
        *next = value.get().checked_add(1).unwrap_or(0);
        Some(Self(value))
    }
}

/// 논리 문서 상태의 revision입니다.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DocumentRevision(pub(super) u64);

impl DocumentRevision {
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// 연결 표시 트리 입력의 revision입니다.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RenderTreeRevision(pub(super) u64);

impl RenderTreeRevision {
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// 문서 트리 하위 영역을 쓰는 DOM 또는 프레임워크 어댑터입니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct OwnerId(NonZeroU64);

impl OwnerId {
    pub const fn new(value: u64) -> Option<Self> {
        match NonZeroU64::new(value) {
            Some(value) => Some(Self(value)),
            None => None,
        }
    }

    pub const fn get(self) -> u64 {
        self.0.get()
    }
}

/// 스크립트에서 오가는 DOM 문자열을 UTF-16 코드 단위 그대로 보관합니다.
#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DomString(Vec<u16>);

impl DomString {
    pub fn from_utf16(units: impl Into<Vec<u16>>) -> Self {
        Self(units.into())
    }

    pub fn from_rust_str(value: &str) -> Self {
        Self(value.encode_utf16().collect())
    }

    pub fn code_units(&self) -> &[u16] {
        &self.0
    }

    pub fn to_string_lossy(&self) -> String {
        String::from_utf16_lossy(&self.0)
    }

    pub(super) fn append(&mut self, other: &Self) {
        self.0.extend_from_slice(&other.0);
    }
}

impl From<&str> for DomString {
    fn from(value: &str) -> Self {
        Self::from_rust_str(value)
    }
}

impl From<String> for DomString {
    fn from(value: String) -> Self {
        Self::from_rust_str(&value)
    }
}

/// 앱 런타임 세대 안에서 노드를 가리키는 핸들입니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct HostNodeHandle {
    pub(super) generation: DocumentGeneration,
    pub(super) id: NodeId,
}

impl HostNodeHandle {
    pub const fn generation(self) -> DocumentGeneration {
        self.generation
    }

    pub const fn id(self) -> NodeId {
        self.id
    }
}

/// 삽입 또는 제거 대상이 되는 앱 루트나 요소입니다.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum HostParent {
    Root,
    Node(HostNodeHandle),
}

/// namespace와 로컬 이름으로 식별하는 속성 이름입니다.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AttributeName {
    namespace: Option<String>,
    local_name: String,
}

impl AttributeName {
    pub fn new(namespace: Option<String>, local_name: impl Into<String>) -> Option<Self> {
        let local_name = local_name.into();
        valid_name(&local_name).then_some(Self {
            namespace,
            local_name,
        })
    }

    pub fn namespace(&self) -> Option<&str> {
        self.namespace.as_deref()
    }

    pub fn local_name(&self) -> &str {
        &self.local_name
    }
}

/// 첫 선택자·스타일 연동에서 읽을 수 있는 요소 상태입니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum ElementState {
    Hover,
    Active,
    Focus,
    FocusVisible,
    Disabled,
    Checked,
}

/// 노드의 종류와 그 종류에 해당하는 초기 데이터를 보관합니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HostNodeKind {
    Element(HostElement),
    Text(DomString),
}

/// 요소의 namespace·로컬 이름·속성·상태입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostElement {
    pub(super) namespace: String,
    pub(super) local_name: String,
    pub(super) attributes: BTreeMap<AttributeName, DomString>,
    pub(super) states: BTreeSet<ElementState>,
}

impl HostElement {
    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    pub fn local_name(&self) -> &str {
        &self.local_name
    }

    pub fn attributes(&self) -> &BTreeMap<AttributeName, DomString> {
        &self.attributes
    }

    pub fn attribute(&self, name: &AttributeName) -> Option<&DomString> {
        self.attributes.get(name)
    }

    pub fn has_state(&self, state: ElementState) -> bool {
        self.states.contains(&state)
    }

    pub fn states(&self) -> impl Iterator<Item = ElementState> + '_ {
        self.states.iter().copied()
    }
}

/// 문서의 요소·텍스트 노드입니다. 부모와 자식 연결은 문서 snapshot을 통해 읽습니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostNode {
    pub(super) id: NodeId,
    pub(super) owner: OwnerId,
    pub(super) parent: Option<ParentRef>,
    pub(super) children: Vec<NodeId>,
    pub(super) kind: HostNodeKind,
}

impl HostNode {
    pub const fn id(&self) -> NodeId {
        self.id
    }

    pub const fn owner(&self) -> OwnerId {
        self.owner
    }

    pub fn kind(&self) -> &HostNodeKind {
        &self.kind
    }

    pub fn children(&self) -> &[NodeId] {
        &self.children
    }
}

/// 한 묶음에서 실행할 원자 문서 변경입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DocumentOperation {
    CreateElement {
        node: HostNodeHandle,
        namespace: String,
        local_name: String,
    },
    CreateText {
        node: HostNodeHandle,
        data: DomString,
    },
    InsertBefore {
        parent: HostParent,
        node: HostNodeHandle,
        before: Option<HostNodeHandle>,
    },
    RemoveChild {
        parent: HostParent,
        node: HostNodeHandle,
    },
    SetTextData {
        node: HostNodeHandle,
        data: DomString,
    },
    SetAttribute {
        node: HostNodeHandle,
        name: AttributeName,
        value: DomString,
    },
    RemoveAttribute {
        node: HostNodeHandle,
        name: AttributeName,
    },
    SetElementState {
        node: HostNodeHandle,
        state: ElementState,
        enabled: bool,
    },
}

/// 한 OwnerId가 제출하는 변경 묶음입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentChangeBatch {
    pub(super) owner: OwnerId,
    pub(super) base_revision: DocumentRevision,
    pub(super) operations: Vec<DocumentOperation>,
}

impl DocumentChangeBatch {
    pub fn new(owner: OwnerId, base_revision: DocumentRevision) -> Self {
        Self {
            owner,
            base_revision,
            operations: Vec::new(),
        }
    }

    pub const fn owner(&self) -> OwnerId {
        self.owner
    }

    pub const fn base_revision(&self) -> DocumentRevision {
        self.base_revision
    }

    pub fn operations(&self) -> &[DocumentOperation] {
        &self.operations
    }

    pub fn push(&mut self, operation: DocumentOperation) -> &mut Self {
        self.operations.push(operation);
        self
    }
}

/// 문서 전체 변경을 원자적으로 거부하거나 확정한 결과입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DocumentReceipt {
    pub(super) previous_document_revision: DocumentRevision,
    pub(super) document_revision: DocumentRevision,
    pub(super) previous_render_tree_revision: RenderTreeRevision,
    pub(super) render_tree_revision: RenderTreeRevision,
    pub(super) changed: bool,
}

impl DocumentReceipt {
    pub const fn previous_document_revision(self) -> DocumentRevision {
        self.previous_document_revision
    }

    pub const fn document_revision(self) -> DocumentRevision {
        self.document_revision
    }

    pub const fn previous_render_tree_revision(self) -> RenderTreeRevision {
        self.previous_render_tree_revision
    }

    pub const fn render_tree_revision(self) -> RenderTreeRevision {
        self.render_tree_revision
    }

    pub const fn changed(self) -> bool {
        self.changed
    }
}

/// 문서 변경을 거부한 이유입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DocumentErrorKind {
    StaleRevision {
        expected: DocumentRevision,
        actual: DocumentRevision,
    },
    StaleGeneration {
        expected: u64,
        actual: u64,
    },
    NodeIdExhausted,
    GenerationExhausted,
    RevisionExhausted,
    UnreservedNodeId(NodeId),
    DuplicateNodeId(NodeId),
    UnknownNode(NodeId),
    InvalidName,
    InvalidParent(NodeId),
    InvalidReference(NodeId),
    NotFound(NodeId),
    WrongNodeKind(NodeId),
    OwnershipConflict {
        node: NodeId,
        expected: OwnerId,
        actual: OwnerId,
    },
    Hierarchy {
        node: NodeId,
        parent: NodeId,
    },
}

/// 실패한 변경 묶음과 작업 위치를 보관합니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocumentError {
    pub(super) operation_index: Option<usize>,
    pub(super) kind: DocumentErrorKind,
}

impl DocumentError {
    pub const fn operation_index(&self) -> Option<usize> {
        self.operation_index
    }

    pub const fn kind(&self) -> &DocumentErrorKind {
        &self.kind
    }

    pub(super) fn batch(kind: DocumentErrorKind) -> Self {
        Self {
            operation_index: None,
            kind,
        }
    }

    pub(super) fn operation(index: usize, kind: DocumentErrorKind) -> Self {
        Self {
            operation_index: Some(index),
            kind,
        }
    }
}

impl fmt::Display for DocumentErrorKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StaleRevision { expected, actual } => {
                write!(
                    formatter,
                    "문서 revision이 다릅니다: 요청 {}, 현재 {}",
                    expected.get(),
                    actual.get()
                )
            }
            Self::StaleGeneration { expected, actual } => {
                write!(
                    formatter,
                    "문서 세대가 다릅니다: 요청 {expected}, 현재 {actual}"
                )
            }
            Self::NodeIdExhausted => formatter.write_str("노드 ID가 모두 사용되었습니다"),
            Self::GenerationExhausted => formatter.write_str("문서 세대 ID가 모두 사용되었습니다"),
            Self::RevisionExhausted => formatter.write_str("문서 revision이 모두 사용되었습니다"),
            Self::UnreservedNodeId(id) => write!(formatter, "예약하지 않은 노드 ID입니다: {id}"),
            Self::DuplicateNodeId(id) => write!(formatter, "이미 생성된 노드 ID입니다: {id}"),
            Self::UnknownNode(id) => write!(formatter, "노드를 찾을 수 없습니다: {id}"),
            Self::InvalidName => {
                formatter.write_str("이름은 비어 있거나 공백·NUL을 포함할 수 없습니다")
            }
            Self::InvalidParent(id) => write!(formatter, "요소가 아닌 부모 노드입니다: {id}"),
            Self::InvalidReference(id) => {
                write!(formatter, "지정 부모의 직접 자식이 아닙니다: {id}")
            }
            Self::NotFound(id) => write!(formatter, "부모의 직접 자식이 아닙니다: {id}"),
            Self::WrongNodeKind(id) => write!(formatter, "요청한 종류의 노드가 아닙니다: {id}"),
            Self::OwnershipConflict {
                node,
                expected,
                actual,
            } => write!(
                formatter,
                "노드 {node}의 소유자가 요청 {expected:?}와 다릅니다: 실제 {actual:?}"
            ),
            Self::Hierarchy { node, parent } => {
                write!(
                    formatter,
                    "노드 {node}를 자신의 하위 노드 {parent}에 연결할 수 없습니다"
                )
            }
        }
    }
}

impl fmt::Display for DocumentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.operation_index {
            Some(index) => write!(
                formatter,
                "문서 변경 {index}에서 거부했습니다: {}",
                self.kind
            ),
            None => write!(formatter, "문서 변경을 거부했습니다: {}", self.kind),
        }
    }
}

impl Error for DocumentError {}

pub(super) fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && !name
            .chars()
            .any(|character| character.is_whitespace() || character == '\0')
}
