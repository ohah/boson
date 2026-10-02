use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt,
};

use spinon_core::{HostDocumentSnapshot, HostNodeHandle, HostNodeKind, HostParent, NodeId};
use style::context::QuirksMode;
use style::shared_lock::SharedRwLock;
use url::Url;

use crate::stylo_dom::{element::StyloElementData, node::StyloNode};

use super::StyloElement;

/// Stylo view를 만들 수 없는 내부 문서 입력입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StyloDomError {
    /// root가 현재 snapshot의 HostRoot 직속 연결 요소가 아닙니다.
    InvalidRoot,
    /// HTML 요소에 ASCII 대소문자만 다른 no-namespace 속성이 중복됩니다.
    AmbiguousHtmlAttributeNames { node: NodeId },
    /// 문서 base URL을 절대 URL로 파싱할 수 없습니다.
    InvalidDocumentBaseUrl,
}

impl fmt::Display for StyloDomError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRoot => formatter.write_str("Stylo root는 연결된 요소여야 합니다"),
            Self::AmbiguousHtmlAttributeNames { node } => write!(
                formatter,
                "HTML 요소 {node}에 대소문자만 다른 속성 이름이 중복됩니다"
            ),
            Self::InvalidDocumentBaseUrl => {
                formatter.write_str("문서 base URL은 올바른 절대 URL이어야 합니다")
            }
        }
    }
}

impl Error for StyloDomError {}

/// 불변 HostDocument snapshot을 Stylo 문서·요소 trait에 연결하는 view입니다.
///
/// 생성한 뒤에는 snapshot과 root가 고정됩니다. 문서 변경은 새 view로 전달합니다.
pub struct StyloDocumentView {
    snapshot: HostDocumentSnapshot,
    root: HostNodeHandle,
    is_html_document: bool,
    quirks_mode: QuirksMode,
    members: BTreeSet<NodeId>,
    elements: BTreeMap<NodeId, StyloElementData>,
    shared_lock: SharedRwLock,
    document_base_url: Url,
}

impl StyloDocumentView {
    /// 명시한 HostRoot 직속 요소를 스타일 문서의 유일한 루트로 보입니다.
    pub fn new(
        snapshot: HostDocumentSnapshot,
        root: HostNodeHandle,
        is_html_document: bool,
        quirks_mode: QuirksMode,
    ) -> Result<Self, StyloDomError> {
        Self::new_with_base_url(
            snapshot,
            root,
            is_html_document,
            quirks_mode,
            "https://spinon.invalid/document.html",
        )
    }

    /// 문서 URL을 기준으로 inline style 속성을 파싱하는 Stylo view를 만듭니다.
    pub fn new_with_base_url(
        snapshot: HostDocumentSnapshot,
        root: HostNodeHandle,
        is_html_document: bool,
        quirks_mode: QuirksMode,
        document_base_url: &str,
    ) -> Result<Self, StyloDomError> {
        let document_base_url =
            Url::parse(document_base_url).map_err(|_| StyloDomError::InvalidDocumentBaseUrl)?;
        if snapshot.parent(root) != Some(HostParent::Root)
            || !matches!(
                snapshot.node(root).map(|node| node.kind()),
                Some(HostNodeKind::Element(_))
            )
        {
            return Err(StyloDomError::InvalidRoot);
        }

        let mut members = BTreeSet::new();
        let mut elements = BTreeMap::new();
        let shared_lock = SharedRwLock::new();
        let mut pending = vec![root];

        while let Some(handle) = pending.pop() {
            if !members.insert(handle.id()) {
                continue;
            }

            let Some(node) = snapshot.node(handle) else {
                return Err(StyloDomError::InvalidRoot);
            };
            if let HostNodeKind::Element(element) = node.kind() {
                if is_html_document
                    && element.namespace() == "http://www.w3.org/1999/xhtml"
                    && has_ambiguous_html_attribute_names(element)
                {
                    return Err(StyloDomError::AmbiguousHtmlAttributeNames { node: handle.id() });
                }
                elements.insert(
                    handle.id(),
                    StyloElementData::from_host_element(
                        element,
                        is_html_document,
                        &document_base_url,
                        &shared_lock,
                        quirks_mode,
                    ),
                );
            }
            if let Some(children) = snapshot.children(handle) {
                pending.extend(children);
            }
        }

        Ok(Self {
            snapshot,
            root,
            is_html_document,
            quirks_mode,
            members,
            elements,
            shared_lock,
            document_base_url,
        })
    }

    /// 이 view의 가상 Document node를 반환합니다.
    pub fn document(&self) -> StyloDocument<'_> {
        StyloDocument { view: self }
    }

    /// 선택한 유일한 문서 루트를 반환합니다.
    pub fn root_element(&self) -> StyloElement<'_> {
        StyloElement::new(self, self.root)
    }

    /// 선택한 루트 하위 트리의 노드만 반환합니다.
    pub fn node(&self, handle: HostNodeHandle) -> Option<StyloNode<'_>> {
        (self.members.contains(&handle.id()) && self.snapshot.node(handle).is_some())
            .then_some(StyloNode::new(self, Some(handle)))
    }

    /// 선택한 루트 하위 트리의 요소만 반환합니다.
    pub fn element(&self, handle: HostNodeHandle) -> Option<StyloElement<'_>> {
        (self.members.contains(&handle.id())
            && self.snapshot.node(handle).is_some()
            && self.elements.contains_key(&handle.id()))
        .then(|| StyloElement::new(self, handle))
    }

    /// view가 고정한 문서 revision입니다.
    pub const fn document_revision(&self) -> spinon_core::DocumentRevision {
        self.snapshot.document_revision()
    }

    /// 이 view가 고정한 문서 generation입니다.
    pub const fn generation(&self) -> spinon_core::DocumentGeneration {
        self.snapshot.generation()
    }

    /// view가 고정한 연결 표시 트리 revision입니다.
    pub const fn render_tree_revision(&self) -> spinon_core::RenderTreeRevision {
        self.snapshot.render_tree_revision()
    }

    /// 이 view가 사용하는 문서 모드입니다.
    pub const fn is_html_document(&self) -> bool {
        self.is_html_document
    }

    pub fn document_base_url(&self) -> &Url {
        &self.document_base_url
    }

    pub(super) fn snapshot(&self) -> &HostDocumentSnapshot {
        &self.snapshot
    }

    pub(super) const fn root_handle(&self) -> HostNodeHandle {
        self.root
    }

    pub(super) const fn quirks_mode(&self) -> QuirksMode {
        self.quirks_mode
    }

    pub(super) fn element_data(&self, handle: HostNodeHandle) -> Option<&StyloElementData> {
        self.elements.get(&handle.id())
    }

    pub(super) fn is_member(&self, handle: HostNodeHandle) -> bool {
        self.members.contains(&handle.id())
    }

    pub(super) fn shared_lock(&self) -> &SharedRwLock {
        &self.shared_lock
    }
}

fn has_ambiguous_html_attribute_names(element: &spinon_core::HostElement) -> bool {
    let mut names = BTreeSet::new();
    element
        .attributes()
        .keys()
        .filter(|name| name.namespace().unwrap_or("").is_empty())
        .any(|name| !names.insert(name.local_name().to_ascii_lowercase()))
}

/// Stylo의 `TDocument`에 대응하는 가상 문서 wrapper입니다.
#[derive(Clone, Copy)]
pub struct StyloDocument<'a> {
    pub(super) view: &'a StyloDocumentView,
}

impl<'a> StyloDocument<'a> {
    /// 이 문서의 유일한 요소 루트를 반환합니다.
    pub fn document_element(self) -> StyloElement<'a> {
        self.view.root_element()
    }

    /// 이 문서의 가상 node를 반환합니다.
    pub fn as_node(self) -> StyloNode<'a> {
        StyloNode::new(self.view, None)
    }
}

impl fmt::Debug for StyloDocument<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StyloDocument")
            .field("generation", &self.view.snapshot.generation())
            .field("revision", &self.view.snapshot.document_revision())
            .finish()
    }
}

impl PartialEq for StyloDocument<'_> {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.view, other.view)
    }
}

impl Eq for StyloDocument<'_> {}
