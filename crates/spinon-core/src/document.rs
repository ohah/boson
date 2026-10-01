use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt,
    num::NonZeroU64,
    sync::{Mutex, OnceLock},
};

use crate::NodeId;

static NEXT_DOCUMENT_GENERATION: OnceLock<Mutex<u64>> = OnceLock::new();

/// 한 번의 앱 런타임에 해당하는 문서 세대 식별자입니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct DocumentGeneration(NonZeroU64);

impl DocumentGeneration {
    pub const fn get(self) -> u64 {
        self.0.get()
    }

    fn allocate() -> Option<Self> {
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
pub struct DocumentRevision(u64);

impl DocumentRevision {
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// 연결 표시 트리 입력의 revision입니다.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RenderTreeRevision(u64);

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

    pub fn from_str(value: &str) -> Self {
        Self(value.encode_utf16().collect())
    }

    pub fn code_units(&self) -> &[u16] {
        &self.0
    }

    pub fn to_string_lossy(&self) -> String {
        String::from_utf16_lossy(&self.0)
    }

    fn append(&mut self, other: &Self) {
        self.0.extend_from_slice(&other.0);
    }
}

impl From<&str> for DomString {
    fn from(value: &str) -> Self {
        Self::from_str(value)
    }
}

impl From<String> for DomString {
    fn from(value: String) -> Self {
        Self::from_str(&value)
    }
}

/// 앱 런타임 세대 안에서 노드를 가리키는 핸들입니다.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct HostNodeHandle {
    generation: DocumentGeneration,
    id: NodeId,
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
    namespace: String,
    local_name: String,
    attributes: BTreeMap<AttributeName, DomString>,
    states: BTreeSet<ElementState>,
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
    id: NodeId,
    owner: OwnerId,
    parent: Option<ParentRef>,
    children: Vec<NodeId>,
    kind: HostNodeKind,
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
    owner: OwnerId,
    base_revision: DocumentRevision,
    operations: Vec<DocumentOperation>,
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
    previous_document_revision: DocumentRevision,
    document_revision: DocumentRevision,
    previous_render_tree_revision: RenderTreeRevision,
    render_tree_revision: RenderTreeRevision,
    changed: bool,
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
    operation_index: Option<usize>,
    kind: DocumentErrorKind,
}

impl DocumentError {
    pub const fn operation_index(&self) -> Option<usize> {
        self.operation_index
    }

    pub const fn kind(&self) -> &DocumentErrorKind {
        &self.kind
    }

    fn batch(kind: DocumentErrorKind) -> Self {
        Self {
            operation_index: None,
            kind,
        }
    }

    fn operation(index: usize, kind: DocumentErrorKind) -> Self {
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

/// 스타일·레이아웃 계산에 넘길 불변 문서 사본입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostDocumentSnapshot {
    generation: DocumentGeneration,
    document_revision: DocumentRevision,
    render_tree_revision: RenderTreeRevision,
    root_children: Vec<NodeId>,
    nodes: BTreeMap<NodeId, HostNode>,
}

impl HostDocumentSnapshot {
    pub const fn generation(&self) -> DocumentGeneration {
        self.generation
    }

    pub const fn document_revision(&self) -> DocumentRevision {
        self.document_revision
    }

    pub const fn render_tree_revision(&self) -> RenderTreeRevision {
        self.render_tree_revision
    }

    pub fn root_children(&self) -> impl Iterator<Item = HostNodeHandle> + '_ {
        self.root_children.iter().copied().map(|id| self.handle(id))
    }

    pub fn node(&self, handle: HostNodeHandle) -> Option<&HostNode> {
        (handle.generation == self.generation)
            .then(|| self.nodes.get(&handle.id))
            .flatten()
    }

    pub fn parent(&self, handle: HostNodeHandle) -> Option<HostParent> {
        let node = self.node(handle)?;
        node.parent.map(|parent| self.external_parent(parent))
    }

    pub fn first_child(&self, handle: HostNodeHandle) -> Option<HostNodeHandle> {
        self.node(handle)?
            .children
            .first()
            .copied()
            .map(|id| self.handle(id))
    }

    pub fn children(
        &self,
        handle: HostNodeHandle,
    ) -> Option<impl Iterator<Item = HostNodeHandle> + '_> {
        self.node(handle)
            .map(|node| node.children.iter().copied().map(|id| self.handle(id)))
    }

    pub fn previous_sibling(&self, handle: HostNodeHandle) -> Option<HostNodeHandle> {
        self.sibling(handle, false)
    }

    pub fn next_sibling(&self, handle: HostNodeHandle) -> Option<HostNodeHandle> {
        self.sibling(handle, true)
    }

    pub fn is_connected(&self, handle: HostNodeHandle) -> bool {
        self.node(handle)
            .is_some_and(|_| is_connected(&self.nodes, handle.id))
    }

    pub fn text_content(&self, handle: HostNodeHandle) -> Option<DomString> {
        let node = self.node(handle)?;
        if let HostNodeKind::Text(data) = &node.kind {
            return Some(data.clone());
        }
        let mut result = DomString::default();
        let mut stack = node.children.iter().rev().copied().collect::<Vec<_>>();
        while let Some(id) = stack.pop() {
            let child = self.nodes.get(&id)?;
            match &child.kind {
                HostNodeKind::Element(_) => stack.extend(child.children.iter().rev().copied()),
                HostNodeKind::Text(data) => result.append(data),
            }
        }
        Some(result)
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    fn sibling(&self, handle: HostNodeHandle, next: bool) -> Option<HostNodeHandle> {
        let node = self.node(handle)?;
        let siblings = match node.parent? {
            ParentRef::Root => &self.root_children,
            ParentRef::Node(parent) => &self.nodes.get(&parent)?.children,
        };
        let position = siblings.iter().position(|id| *id == handle.id)?;
        let target = if next {
            siblings.get(position.checked_add(1)?)
        } else {
            position
                .checked_sub(1)
                .and_then(|index| siblings.get(index))
        }?;
        Some(self.handle(*target))
    }

    fn handle(&self, id: NodeId) -> HostNodeHandle {
        HostNodeHandle {
            generation: self.generation,
            id,
        }
    }

    fn external_parent(&self, parent: ParentRef) -> HostParent {
        match parent {
            ParentRef::Root => HostParent::Root,
            ParentRef::Node(id) => HostParent::Node(self.handle(id)),
        }
    }
}

/// 동기 DOM 논리 상태와 마지막으로 확정한 표시 revision을 소유합니다.
#[derive(Debug, Eq, PartialEq)]
pub struct HostDocument {
    generation: DocumentGeneration,
    document_revision: DocumentRevision,
    render_tree_revision: RenderTreeRevision,
    root_children: Vec<NodeId>,
    nodes: BTreeMap<NodeId, HostNode>,
    reserved_ids: BTreeSet<NodeId>,
    next_node_id: Option<u64>,
}

impl HostDocument {
    pub fn new() -> Result<Self, DocumentError> {
        let generation = DocumentGeneration::allocate()
            .ok_or_else(|| DocumentError::batch(DocumentErrorKind::GenerationExhausted))?;
        Ok(Self {
            generation,
            document_revision: DocumentRevision::default(),
            render_tree_revision: RenderTreeRevision::default(),
            root_children: Vec::new(),
            nodes: BTreeMap::new(),
            reserved_ids: BTreeSet::new(),
            next_node_id: Some(1),
        })
    }

    pub const fn generation(&self) -> DocumentGeneration {
        self.generation
    }

    pub const fn document_revision(&self) -> DocumentRevision {
        self.document_revision
    }

    pub const fn render_tree_revision(&self) -> RenderTreeRevision {
        self.render_tree_revision
    }

    /// 묶음에서 생성할 새 핸들을 예약합니다. 예약만으로 문서 revision은 바뀌지 않습니다.
    pub fn reserve_node_handle(&mut self) -> Result<HostNodeHandle, DocumentError> {
        let value = self
            .next_node_id
            .ok_or_else(|| DocumentError::batch(DocumentErrorKind::NodeIdExhausted))?;
        let id = NodeId::new(value)
            .ok_or_else(|| DocumentError::batch(DocumentErrorKind::NodeIdExhausted))?;
        self.next_node_id = value.checked_add(1);
        self.reserved_ids.insert(id);
        Ok(HostNodeHandle {
            generation: self.generation,
            id,
        })
    }

    pub fn snapshot(&self) -> HostDocumentSnapshot {
        HostDocumentSnapshot {
            generation: self.generation,
            document_revision: self.document_revision,
            render_tree_revision: self.render_tree_revision,
            root_children: self.root_children.clone(),
            nodes: self.nodes.clone(),
        }
    }

    /// 전체 변경 묶음을 임시 상태에서 검증한 뒤 한 번에 공개합니다.
    pub fn commit(&mut self, batch: DocumentChangeBatch) -> Result<DocumentReceipt, DocumentError> {
        if batch.base_revision != self.document_revision {
            return Err(DocumentError::batch(DocumentErrorKind::StaleRevision {
                expected: batch.base_revision,
                actual: self.document_revision,
            }));
        }

        if batch.operations.is_empty() {
            return Ok(self.receipt(false));
        }

        let mut candidate = Candidate {
            root_children: self.root_children.clone(),
            nodes: self.nodes.clone(),
        };
        let mut created = Vec::new();

        for (index, operation) in batch.operations.iter().enumerate() {
            apply_operation(
                &mut candidate,
                self.generation,
                batch.owner,
                &self.reserved_ids,
                operation,
                index,
                &mut created,
            )?;
        }

        let changed =
            self.root_children != candidate.root_children || self.nodes != candidate.nodes;
        if !changed {
            return Ok(self.receipt(false));
        }
        let render_changed = !same_render_projection(
            &self.root_children,
            &self.nodes,
            &candidate.root_children,
            &candidate.nodes,
        );

        let next_document_revision = self
            .document_revision
            .0
            .checked_add(1)
            .map(DocumentRevision)
            .ok_or_else(|| DocumentError::batch(DocumentErrorKind::RevisionExhausted))?;
        let next_render_tree_revision = if render_changed {
            self.render_tree_revision
                .0
                .checked_add(1)
                .map(RenderTreeRevision)
                .ok_or_else(|| DocumentError::batch(DocumentErrorKind::RevisionExhausted))?
        } else {
            self.render_tree_revision
        };

        let previous_document_revision = self.document_revision;
        let previous_render_tree_revision = self.render_tree_revision;
        self.root_children = candidate.root_children;
        self.nodes = candidate.nodes;
        self.document_revision = next_document_revision;
        self.render_tree_revision = next_render_tree_revision;
        for id in created {
            self.reserved_ids.remove(&id);
        }

        Ok(DocumentReceipt {
            previous_document_revision,
            document_revision: self.document_revision,
            previous_render_tree_revision,
            render_tree_revision: self.render_tree_revision,
            changed: true,
        })
    }

    fn receipt(&self, changed: bool) -> DocumentReceipt {
        DocumentReceipt {
            previous_document_revision: self.document_revision,
            document_revision: self.document_revision,
            previous_render_tree_revision: self.render_tree_revision,
            render_tree_revision: self.render_tree_revision,
            changed,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ParentRef {
    Root,
    Node(NodeId),
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Candidate {
    root_children: Vec<NodeId>,
    nodes: BTreeMap<NodeId, HostNode>,
}

fn apply_operation(
    candidate: &mut Candidate,
    generation: DocumentGeneration,
    owner: OwnerId,
    reserved_ids: &BTreeSet<NodeId>,
    operation: &DocumentOperation,
    index: usize,
    created: &mut Vec<NodeId>,
) -> Result<(), DocumentError> {
    let at = |kind| DocumentError::operation(index, kind);
    match operation {
        DocumentOperation::CreateElement {
            node,
            namespace,
            local_name,
        } => {
            let id = check_generation(*node, generation).map_err(at)?;
            if !valid_name(local_name) {
                return Err(at(DocumentErrorKind::InvalidName));
            }
            if candidate.nodes.contains_key(&id) {
                return Err(at(DocumentErrorKind::DuplicateNodeId(id)));
            }
            if !reserved_ids.contains(&id) {
                return Err(at(DocumentErrorKind::UnreservedNodeId(id)));
            }
            candidate.nodes.insert(
                id,
                HostNode {
                    id,
                    owner,
                    parent: None,
                    children: Vec::new(),
                    kind: HostNodeKind::Element(HostElement {
                        namespace: namespace.clone(),
                        local_name: local_name.clone(),
                        attributes: BTreeMap::new(),
                        states: BTreeSet::new(),
                    }),
                },
            );
            created.push(id);
            Ok(())
        }
        DocumentOperation::CreateText { node, data } => {
            let id = check_generation(*node, generation).map_err(at)?;
            if candidate.nodes.contains_key(&id) {
                return Err(at(DocumentErrorKind::DuplicateNodeId(id)));
            }
            if !reserved_ids.contains(&id) {
                return Err(at(DocumentErrorKind::UnreservedNodeId(id)));
            }
            candidate.nodes.insert(
                id,
                HostNode {
                    id,
                    owner,
                    parent: None,
                    children: Vec::new(),
                    kind: HostNodeKind::Text(data.clone()),
                },
            );
            created.push(id);
            Ok(())
        }
        DocumentOperation::InsertBefore {
            parent,
            node,
            before,
        } => insert_before(candidate, generation, owner, *parent, *node, *before).map_err(at),
        DocumentOperation::RemoveChild { parent, node } => {
            remove_child(candidate, generation, owner, *parent, *node).map_err(at)
        }
        DocumentOperation::SetTextData { node, data } => {
            let id = check_generation(*node, generation).map_err(at)?;
            let target = candidate
                .nodes
                .get_mut(&id)
                .ok_or_else(|| at(DocumentErrorKind::UnknownNode(id)))?;
            check_owner(target, owner).map_err(at)?;
            match &mut target.kind {
                HostNodeKind::Text(current) => {
                    if current != data {
                        *current = data.clone();
                    }
                    Ok(())
                }
                HostNodeKind::Element(_) => Err(at(DocumentErrorKind::WrongNodeKind(id))),
            }
        }
        DocumentOperation::SetAttribute { node, name, value } => {
            let id = check_generation(*node, generation).map_err(at)?;
            let target = candidate
                .nodes
                .get_mut(&id)
                .ok_or_else(|| at(DocumentErrorKind::UnknownNode(id)))?;
            check_owner(target, owner).map_err(at)?;
            match &mut target.kind {
                HostNodeKind::Element(element) => {
                    if element.attributes.get(name) != Some(value) {
                        element.attributes.insert(name.clone(), value.clone());
                    }
                    Ok(())
                }
                HostNodeKind::Text(_) => Err(at(DocumentErrorKind::WrongNodeKind(id))),
            }
        }
        DocumentOperation::RemoveAttribute { node, name } => {
            let id = check_generation(*node, generation).map_err(at)?;
            let target = candidate
                .nodes
                .get_mut(&id)
                .ok_or_else(|| at(DocumentErrorKind::UnknownNode(id)))?;
            check_owner(target, owner).map_err(at)?;
            match &mut target.kind {
                HostNodeKind::Element(element) => {
                    element.attributes.remove(name);
                    Ok(())
                }
                HostNodeKind::Text(_) => Err(at(DocumentErrorKind::WrongNodeKind(id))),
            }
        }
        DocumentOperation::SetElementState {
            node,
            state,
            enabled,
        } => {
            let id = check_generation(*node, generation).map_err(at)?;
            let target = candidate
                .nodes
                .get_mut(&id)
                .ok_or_else(|| at(DocumentErrorKind::UnknownNode(id)))?;
            check_owner(target, owner).map_err(at)?;
            match &mut target.kind {
                HostNodeKind::Element(element) => {
                    if *enabled {
                        element.states.insert(*state);
                    } else {
                        element.states.remove(state);
                    }
                    Ok(())
                }
                HostNodeKind::Text(_) => Err(at(DocumentErrorKind::WrongNodeKind(id))),
            }
        }
    }
}

fn insert_before(
    candidate: &mut Candidate,
    generation: DocumentGeneration,
    owner: OwnerId,
    parent: HostParent,
    node: HostNodeHandle,
    before: Option<HostNodeHandle>,
) -> Result<(), DocumentErrorKind> {
    let node_id = check_generation(node, generation)?;
    let parent = parent_ref(parent, generation)?;
    let child = candidate
        .nodes
        .get(&node_id)
        .ok_or(DocumentErrorKind::UnknownNode(node_id))?;
    check_owner(child, owner)?;

    match parent {
        ParentRef::Root => {}
        ParentRef::Node(parent_id) => {
            let parent_node = candidate
                .nodes
                .get(&parent_id)
                .ok_or(DocumentErrorKind::UnknownNode(parent_id))?;
            check_owner(parent_node, owner)?;
            if !matches!(parent_node.kind, HostNodeKind::Element(_)) {
                return Err(DocumentErrorKind::InvalidParent(parent_id));
            }
            if node_id == parent_id || is_ancestor(candidate, node_id, parent_id) {
                return Err(DocumentErrorKind::Hierarchy {
                    node: node_id,
                    parent: parent_id,
                });
            }
        }
    }

    let before_id = before
        .map(|handle| check_generation(handle, generation))
        .transpose()?;
    if let Some(reference_id) = before_id {
        let reference = candidate
            .nodes
            .get(&reference_id)
            .ok_or(DocumentErrorKind::UnknownNode(reference_id))?;
        if reference.parent != Some(parent) {
            return Err(DocumentErrorKind::InvalidReference(reference_id));
        }
        check_owner(reference, owner)?;
    }

    let old_parent = candidate.nodes[&node_id].parent;
    if old_parent == Some(parent) && before_id == Some(node_id) {
        return Ok(());
    }

    if old_parent == Some(parent) {
        let current_children = children(candidate, parent).to_vec();
        let current_index = current_children
            .iter()
            .position(|id| *id == node_id)
            .ok_or(DocumentErrorKind::NotFound(node_id))?;
        let mut after_remove = current_children.clone();
        after_remove.remove(current_index);
        let target_index = before_id
            .map(|reference| {
                after_remove
                    .iter()
                    .position(|id| *id == reference)
                    .ok_or(DocumentErrorKind::InvalidReference(reference))
            })
            .transpose()?
            .unwrap_or(after_remove.len());
        if target_index == current_index {
            return Ok(());
        }
    }

    if let Some(old_parent) = old_parent {
        let old_children = children_mut(candidate, old_parent);
        let position = old_children
            .iter()
            .position(|id| *id == node_id)
            .ok_or(DocumentErrorKind::NotFound(node_id))?;
        old_children.remove(position);
    }

    let new_children = children_mut(candidate, parent);
    let target_index = before_id
        .map(|reference| {
            new_children
                .iter()
                .position(|id| *id == reference)
                .ok_or(DocumentErrorKind::InvalidReference(reference))
        })
        .transpose()?
        .unwrap_or(new_children.len());
    new_children.insert(target_index, node_id);
    candidate
        .nodes
        .get_mut(&node_id)
        .expect("validated node")
        .parent = Some(parent);

    Ok(())
}

fn remove_child(
    candidate: &mut Candidate,
    generation: DocumentGeneration,
    owner: OwnerId,
    parent: HostParent,
    node: HostNodeHandle,
) -> Result<(), DocumentErrorKind> {
    let parent = parent_ref(parent, generation)?;
    let node_id = check_generation(node, generation)?;
    let target = candidate
        .nodes
        .get(&node_id)
        .ok_or(DocumentErrorKind::UnknownNode(node_id))?;
    check_owner(target, owner)?;
    if target.parent != Some(parent) {
        return Err(DocumentErrorKind::NotFound(node_id));
    }
    if let ParentRef::Node(parent_id) = parent {
        let parent_node = candidate
            .nodes
            .get(&parent_id)
            .ok_or(DocumentErrorKind::UnknownNode(parent_id))?;
        check_owner(parent_node, owner)?;
        if !matches!(parent_node.kind, HostNodeKind::Element(_)) {
            return Err(DocumentErrorKind::InvalidParent(parent_id));
        }
    }
    let children = children_mut(candidate, parent);
    let position = children
        .iter()
        .position(|id| *id == node_id)
        .ok_or(DocumentErrorKind::NotFound(node_id))?;
    children.remove(position);
    candidate
        .nodes
        .get_mut(&node_id)
        .expect("validated node")
        .parent = None;
    Ok(())
}

fn check_generation(
    handle: HostNodeHandle,
    generation: DocumentGeneration,
) -> Result<NodeId, DocumentErrorKind> {
    if handle.generation != generation {
        return Err(DocumentErrorKind::StaleGeneration {
            expected: generation.get(),
            actual: handle.generation.get(),
        });
    }
    Ok(handle.id)
}

fn parent_ref(
    parent: HostParent,
    generation: DocumentGeneration,
) -> Result<ParentRef, DocumentErrorKind> {
    match parent {
        HostParent::Root => Ok(ParentRef::Root),
        HostParent::Node(handle) => Ok(ParentRef::Node(check_generation(handle, generation)?)),
    }
}

fn check_owner(node: &HostNode, expected: OwnerId) -> Result<(), DocumentErrorKind> {
    if node.owner == expected {
        Ok(())
    } else {
        Err(DocumentErrorKind::OwnershipConflict {
            node: node.id,
            expected,
            actual: node.owner,
        })
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && !name
            .chars()
            .any(|character| character.is_whitespace() || character == '\0')
}

fn children(candidate: &Candidate, parent: ParentRef) -> &[NodeId] {
    match parent {
        ParentRef::Root => &candidate.root_children,
        ParentRef::Node(parent) => {
            &candidate
                .nodes
                .get(&parent)
                .expect("parent validated")
                .children
        }
    }
}

fn children_mut(candidate: &mut Candidate, parent: ParentRef) -> &mut Vec<NodeId> {
    match parent {
        ParentRef::Root => &mut candidate.root_children,
        ParentRef::Node(parent) => {
            &mut candidate
                .nodes
                .get_mut(&parent)
                .expect("parent validated")
                .children
        }
    }
}

fn is_connected(nodes: &BTreeMap<NodeId, HostNode>, id: NodeId) -> bool {
    let mut current = id;
    loop {
        match nodes.get(&current).and_then(|node| node.parent) {
            Some(ParentRef::Root) => return true,
            Some(ParentRef::Node(parent)) => current = parent,
            None => return false,
        }
    }
}

fn same_render_projection(
    first_roots: &[NodeId],
    first_nodes: &BTreeMap<NodeId, HostNode>,
    second_roots: &[NodeId],
    second_nodes: &BTreeMap<NodeId, HostNode>,
) -> bool {
    if first_roots != second_roots {
        return false;
    }

    let mut pending = first_roots.iter().rev().copied().collect::<Vec<_>>();
    while let Some(id) = pending.pop() {
        let Some(first) = first_nodes.get(&id) else {
            return false;
        };
        let Some(second) = second_nodes.get(&id) else {
            return false;
        };
        if first != second {
            return false;
        }
        pending.extend(first.children.iter().rev().copied());
    }
    true
}

fn is_ancestor(candidate: &Candidate, possible_ancestor: NodeId, mut node: NodeId) -> bool {
    while let Some(ParentRef::Node(parent)) =
        candidate.nodes.get(&node).and_then(|value| value.parent)
    {
        if parent == possible_ancestor {
            return true;
        }
        node = parent;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    const HTML: &str = "http://www.w3.org/1999/xhtml";

    fn owner(value: u64) -> OwnerId {
        OwnerId::new(value).unwrap()
    }

    fn commit(document: &mut HostDocument, owner: OwnerId, operation: DocumentOperation) {
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        batch.push(operation);
        document.commit(batch).unwrap();
    }

    fn create_element(document: &mut HostDocument, owner: OwnerId, name: &str) -> HostNodeHandle {
        let handle = document.reserve_node_handle().unwrap();
        commit(
            document,
            owner,
            DocumentOperation::CreateElement {
                node: handle,
                namespace: HTML.to_owned(),
                local_name: name.to_owned(),
            },
        );
        handle
    }

    fn create_text(document: &mut HostDocument, owner: OwnerId, data: DomString) -> HostNodeHandle {
        let handle = document.reserve_node_handle().unwrap();
        commit(
            document,
            owner,
            DocumentOperation::CreateText { node: handle, data },
        );
        handle
    }

    fn insert(
        document: &mut HostDocument,
        owner: OwnerId,
        parent: HostParent,
        node: HostNodeHandle,
        before: Option<HostNodeHandle>,
    ) -> DocumentReceipt {
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        batch.push(DocumentOperation::InsertBefore {
            parent,
            node,
            before,
        });
        document.commit(batch).unwrap()
    }

    #[test]
    fn mixed_nodes_attributes_state_and_sibling_order_are_preserved() {
        let mut document = HostDocument::new().unwrap();
        let owner = owner(1);
        let root = create_element(&mut document, owner, "div");
        let first_text = create_text(&mut document, owner, "앞".into());
        let child = create_element(&mut document, owner, "span");
        let last_text = create_text(&mut document, owner, "뒤".into());
        insert(&mut document, owner, HostParent::Root, root, None);
        insert(
            &mut document,
            owner,
            HostParent::Node(root),
            first_text,
            None,
        );
        insert(&mut document, owner, HostParent::Node(root), child, None);
        insert(
            &mut document,
            owner,
            HostParent::Node(root),
            last_text,
            None,
        );

        let class_name = AttributeName::new(None, "class").unwrap();
        let namespaced_attribute =
            AttributeName::new(Some("urn:spinon:test".to_owned()), "key").unwrap();
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        batch.push(DocumentOperation::SetAttribute {
            node: child,
            name: class_name.clone(),
            value: "selected".into(),
        });
        batch.push(DocumentOperation::SetAttribute {
            node: child,
            name: namespaced_attribute.clone(),
            value: "qualified".into(),
        });
        batch.push(DocumentOperation::SetElementState {
            node: child,
            state: ElementState::Focus,
            enabled: true,
        });
        document.commit(batch).unwrap();

        let snapshot = document.snapshot();
        let ordered = snapshot.children(root).unwrap().collect::<Vec<_>>();
        assert_eq!(ordered, [first_text, child, last_text]);
        assert_eq!(snapshot.next_sibling(first_text), Some(child));
        assert_eq!(snapshot.previous_sibling(last_text), Some(child));
        assert_eq!(snapshot.text_content(root).unwrap(), "앞뒤".into());
        let HostNodeKind::Element(element) = snapshot.node(child).unwrap().kind() else {
            panic!("span은 요소여야 합니다");
        };
        assert_eq!(element.namespace(), HTML);
        assert_eq!(element.local_name(), "span");
        assert_eq!(
            element.attribute(&class_name),
            Some(&DomString::from("selected"))
        );
        assert_eq!(
            element.attribute(&namespaced_attribute),
            Some(&DomString::from("qualified"))
        );
        assert!(element.has_state(ElementState::Focus));
    }

    #[test]
    fn detached_changes_and_connected_changes_advance_separate_revisions() {
        let mut document = HostDocument::new().unwrap();
        let owner = owner(2);
        let root = create_element(&mut document, owner, "div");
        assert_eq!(document.document_revision().get(), 1);
        assert_eq!(document.render_tree_revision().get(), 0);

        let connected = insert(&mut document, owner, HostParent::Root, root, None);
        assert_eq!(connected.document_revision().get(), 2);
        assert_eq!(connected.render_tree_revision().get(), 1);
        assert!(document.snapshot().is_connected(root));

        let detached = create_element(&mut document, owner, "button");
        assert_eq!(document.render_tree_revision().get(), 1);
        let inserted = insert(&mut document, owner, HostParent::Node(root), detached, None);
        assert_eq!(inserted.document_revision().get(), 4);
        assert_eq!(inserted.render_tree_revision().get(), 2);

        let removed = {
            let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
            batch.push(DocumentOperation::RemoveChild {
                parent: HostParent::Node(root),
                node: detached,
            });
            document.commit(batch).unwrap()
        };
        assert_eq!(removed.document_revision().get(), 5);
        assert_eq!(removed.render_tree_revision().get(), 3);
        assert!(!document.snapshot().is_connected(detached));
        assert_eq!(
            document.snapshot().node(detached).unwrap().id(),
            detached.id()
        );
        let reinserted = insert(&mut document, owner, HostParent::Node(root), detached, None);
        assert_eq!(reinserted.document_revision().get(), 6);
        assert_eq!(reinserted.render_tree_revision().get(), 4);
    }

    #[test]
    fn owner_conflict_and_cycles_reject_the_whole_batch() {
        let mut document = HostDocument::new().unwrap();
        let owner_a = owner(10);
        let owner_b = owner(20);
        let parent = create_element(&mut document, owner_a, "section");
        insert(&mut document, owner_a, HostParent::Root, parent, None);

        let child = document.reserve_node_handle().unwrap();
        let mut create = DocumentChangeBatch::new(owner_b, document.document_revision());
        create.push(DocumentOperation::CreateElement {
            node: child,
            namespace: HTML.to_owned(),
            local_name: "span".to_owned(),
        });
        document.commit(create).unwrap();
        let before = document.snapshot();
        let mut conflicting = DocumentChangeBatch::new(owner_b, document.document_revision());
        conflicting.push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(parent),
            node: child,
            before: None,
        });
        assert!(matches!(
            document.commit(conflicting).unwrap_err().kind(),
            DocumentErrorKind::OwnershipConflict { .. }
        ));
        assert_eq!(document.snapshot(), before);

        let new_parent = document.reserve_node_handle().unwrap();
        let mut cycle = DocumentChangeBatch::new(owner_b, document.document_revision());
        cycle.push(DocumentOperation::CreateElement {
            node: new_parent,
            namespace: HTML.to_owned(),
            local_name: "div".to_owned(),
        });
        cycle.push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(new_parent),
            node: new_parent,
            before: None,
        });
        assert!(matches!(
            document.commit(cycle).unwrap_err().kind(),
            DocumentErrorKind::Hierarchy { .. }
        ));
        assert_eq!(document.snapshot(), before);
    }

    #[test]
    fn batches_preserve_mixed_owner_siblings_without_crossing_ownership() {
        let mut document = HostDocument::new().unwrap();
        let owner_a = owner(31);
        let owner_b = owner(32);
        let left = create_element(&mut document, owner_a, "div");
        let right = create_element(&mut document, owner_b, "div");
        insert(&mut document, owner_a, HostParent::Root, left, None);
        insert(&mut document, owner_b, HostParent::Root, right, None);
        assert_eq!(
            document.snapshot().root_children().collect::<Vec<_>>(),
            [left, right]
        );

        let local = create_element(&mut document, owner_a, "span");
        let mut cross_owner_reference =
            DocumentChangeBatch::new(owner_a, document.document_revision());
        cross_owner_reference.push(DocumentOperation::InsertBefore {
            parent: HostParent::Root,
            node: local,
            before: Some(right),
        });
        assert!(matches!(
            document.commit(cross_owner_reference).unwrap_err().kind(),
            DocumentErrorKind::OwnershipConflict { .. }
        ));

        let mut denied = DocumentChangeBatch::new(owner_a, document.document_revision());
        denied.push(DocumentOperation::SetAttribute {
            node: right,
            name: AttributeName::new(None, "class").unwrap(),
            value: "bad".into(),
        });
        assert!(matches!(
            document.commit(denied).unwrap_err().kind(),
            DocumentErrorKind::OwnershipConflict { .. }
        ));
    }

    #[test]
    fn stale_generation_and_stale_revision_are_rejected() {
        let mut document = HostDocument::new().unwrap();
        let mut other = HostDocument::new().unwrap();
        let foreign = other.reserve_node_handle().unwrap();

        let mut batch = DocumentChangeBatch::new(owner(5), DocumentRevision(2));
        batch.push(DocumentOperation::CreateText {
            node: document.reserve_node_handle().unwrap(),
            data: "x".into(),
        });
        assert!(matches!(
            document.commit(batch).unwrap_err().kind(),
            DocumentErrorKind::StaleRevision { .. }
        ));

        let mut batch = DocumentChangeBatch::new(owner(5), document.document_revision());
        batch.push(DocumentOperation::InsertBefore {
            parent: HostParent::Root,
            node: foreign,
            before: None,
        });
        assert!(matches!(
            document.commit(batch).unwrap_err().kind(),
            DocumentErrorKind::StaleGeneration { .. }
        ));
        assert_eq!(document.document_revision().get(), 0);
    }

    #[test]
    fn utf16_surrogate_units_survive_text_and_text_content_reads() {
        let mut document = HostDocument::new().unwrap();
        let owner = owner(7);
        let root = create_element(&mut document, owner, "p");
        let text = create_text(&mut document, owner, DomString::from_utf16(vec![0xD800]));
        insert(&mut document, owner, HostParent::Root, root, None);
        insert(&mut document, owner, HostParent::Node(root), text, None);
        let snapshot = document.snapshot();
        let text_content = snapshot.text_content(root).unwrap();
        assert_eq!(text_content.code_units(), [0xD800]);
        assert_eq!(
            snapshot.node(text).unwrap().kind(),
            &HostNodeKind::Text(text_content)
        );
    }

    #[test]
    fn no_op_and_empty_batches_do_not_advance_revisions() {
        let mut document = HostDocument::new().unwrap();
        let owner = owner(8);
        let node = create_element(&mut document, owner, "div");
        let first = insert(&mut document, owner, HostParent::Root, node, None);
        let same = insert(&mut document, owner, HostParent::Root, node, None);
        assert_eq!(same.document_revision(), first.document_revision());
        assert_eq!(same.render_tree_revision(), first.render_tree_revision());
        assert!(!same.changed());

        let detached_parent = create_element(&mut document, owner, "aside");
        let before = document.snapshot();
        let mut round_trip = DocumentChangeBatch::new(owner, document.document_revision());
        round_trip
            .push(DocumentOperation::InsertBefore {
                parent: HostParent::Node(detached_parent),
                node,
                before: None,
            })
            .push(DocumentOperation::InsertBefore {
                parent: HostParent::Root,
                node,
                before: None,
            });
        let receipt = document.commit(round_trip).unwrap();
        assert!(!receipt.changed());
        assert_eq!(document.snapshot(), before);

        let class_name = AttributeName::new(None, "class").unwrap();
        let mut revert_attribute = DocumentChangeBatch::new(owner, document.document_revision());
        revert_attribute
            .push(DocumentOperation::SetAttribute {
                node,
                name: class_name.clone(),
                value: "temporary".into(),
            })
            .push(DocumentOperation::RemoveAttribute {
                node,
                name: class_name,
            });
        let receipt = document.commit(revert_attribute).unwrap();
        assert!(!receipt.changed());
        assert_eq!(document.snapshot(), before);

        let empty = document
            .commit(DocumentChangeBatch::new(
                owner,
                document.document_revision(),
            ))
            .unwrap();
        assert!(!empty.changed());
    }

    #[test]
    fn insert_before_uses_final_order_and_invalid_references_are_atomic() {
        let mut document = HostDocument::new().unwrap();
        let owner = owner(9);
        let root = create_element(&mut document, owner, "div");
        let first = create_element(&mut document, owner, "i");
        let second = create_element(&mut document, owner, "b");
        let third = create_element(&mut document, owner, "u");
        insert(&mut document, owner, HostParent::Root, root, None);
        insert(&mut document, owner, HostParent::Node(root), first, None);
        insert(&mut document, owner, HostParent::Node(root), second, None);
        insert(&mut document, owner, HostParent::Node(root), third, None);

        let moved = insert(
            &mut document,
            owner,
            HostParent::Node(root),
            third,
            Some(second),
        );
        assert!(moved.changed());
        assert_eq!(
            document
                .snapshot()
                .children(root)
                .unwrap()
                .collect::<Vec<_>>(),
            [first, third, second]
        );

        let same_position = insert(
            &mut document,
            owner,
            HostParent::Node(root),
            third,
            Some(second),
        );
        assert!(!same_position.changed());

        let before_itself = insert(
            &mut document,
            owner,
            HostParent::Node(root),
            third,
            Some(third),
        );
        assert!(!before_itself.changed());

        let detached = create_element(&mut document, owner, "small");
        let before = document.snapshot();
        let mut invalid = DocumentChangeBatch::new(owner, document.document_revision());
        invalid.push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(root),
            node: detached,
            before: Some(root),
        });
        assert!(matches!(
            document.commit(invalid).unwrap_err().kind(),
            DocumentErrorKind::InvalidReference(_)
        ));
        assert_eq!(document.snapshot(), before);
    }

    #[test]
    fn connected_attribute_and_state_changes_advance_render_revision_once() {
        let mut document = HostDocument::new().unwrap();
        let owner = owner(10);
        let element = create_element(&mut document, owner, "button");
        insert(&mut document, owner, HostParent::Root, element, None);
        let class_name = AttributeName::new(None, "class").unwrap();
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        batch
            .push(DocumentOperation::SetAttribute {
                node: element,
                name: class_name.clone(),
                value: "on".into(),
            })
            .push(DocumentOperation::SetElementState {
                node: element,
                state: ElementState::Active,
                enabled: true,
            });
        let result = document.commit(batch).unwrap();
        assert_eq!(result.document_revision().get(), 3);
        assert_eq!(result.render_tree_revision().get(), 2);

        let mut repeat = DocumentChangeBatch::new(owner, document.document_revision());
        repeat.push(DocumentOperation::SetAttribute {
            node: element,
            name: class_name,
            value: "on".into(),
        });
        assert!(!document.commit(repeat).unwrap().changed());
        assert_eq!(document.render_tree_revision().get(), 2);
    }

    #[test]
    fn node_id_allocator_uses_the_last_nonzero_id_then_stops() {
        let mut document = HostDocument::new().unwrap();
        document.next_node_id = Some(u64::MAX);
        let last = document.reserve_node_handle().unwrap();
        assert_eq!(last.id().get(), u64::MAX);
        assert!(matches!(
            document.reserve_node_handle().unwrap_err().kind(),
            DocumentErrorKind::NodeIdExhausted
        ));
    }

    #[test]
    fn revision_exhaustion_never_publishes_a_partial_candidate() {
        let owner = owner(11);
        let mut document = HostDocument::new().unwrap();
        let reserved = document.reserve_node_handle().unwrap();
        document.document_revision = DocumentRevision(u64::MAX);
        let before = document.snapshot();
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        batch.push(DocumentOperation::CreateElement {
            node: reserved,
            namespace: HTML.to_owned(),
            local_name: "div".to_owned(),
        });
        assert!(matches!(
            document.commit(batch).unwrap_err().kind(),
            DocumentErrorKind::RevisionExhausted
        ));
        assert_eq!(document.snapshot(), before);

        let mut render_limited = HostDocument::new().unwrap();
        let root = create_element(&mut render_limited, owner, "div");
        insert(&mut render_limited, owner, HostParent::Root, root, None);
        render_limited.render_tree_revision = RenderTreeRevision(u64::MAX);
        let before = render_limited.snapshot();
        let mut batch = DocumentChangeBatch::new(owner, render_limited.document_revision());
        batch.push(DocumentOperation::SetAttribute {
            node: root,
            name: AttributeName::new(None, "class").unwrap(),
            value: "changed".into(),
        });
        assert!(matches!(
            render_limited.commit(batch).unwrap_err().kind(),
            DocumentErrorKind::RevisionExhausted
        ));
        assert_eq!(render_limited.snapshot(), before);
    }
}
