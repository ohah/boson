use std::{fmt, marker::PhantomData};

use spinon_core::{HostNodeHandle, HostNodeKind, HostParent};
use style::context::QuirksMode;
use style::dom::{NodeInfo, OpaqueNode, TDocument, TNode, TShadowRoot};
use style::shared_lock::SharedRwLock;
use style::stylist::CascadeData;

use super::{StyloDocument, StyloDocumentView, StyloElement};

/// HostDocument의 node 또는 어댑터가 제공하는 가상 Document node입니다.
#[derive(Clone, Copy)]
pub struct StyloNode<'a> {
    view: &'a StyloDocumentView,
    handle: Option<HostNodeHandle>,
}

impl<'a> StyloNode<'a> {
    pub(super) const fn new(view: &'a StyloDocumentView, handle: Option<HostNodeHandle>) -> Self {
        Self { view, handle }
    }

    pub const fn handle(self) -> Option<HostNodeHandle> {
        self.handle
    }

    fn node_children(self) -> Vec<Self> {
        match self.handle {
            None => vec![Self::new(self.view, Some(self.view.root_handle()))],
            Some(handle) => self
                .view
                .snapshot()
                .children(handle)
                .into_iter()
                .flatten()
                .filter(|child| self.view.is_member(*child))
                .map(|child| Self::new(self.view, Some(child)))
                .collect(),
        }
    }

    fn sibling(self, next: bool) -> Option<Self> {
        let handle = self.handle?;
        if handle == self.view.root_handle() {
            return None;
        }
        let sibling = if next {
            self.view.snapshot().next_sibling(handle)
        } else {
            self.view.snapshot().previous_sibling(handle)
        }?;
        self.view
            .is_member(sibling)
            .then(|| Self::new(self.view, Some(sibling)))
    }

    fn parent(self) -> Option<Self> {
        let handle = self.handle?;
        match self.view.snapshot().parent(handle)? {
            HostParent::Root if handle == self.view.root_handle() => {
                Some(Self::new(self.view, None))
            }
            HostParent::Root => None,
            HostParent::Node(parent) if self.view.is_member(parent) => {
                Some(Self::new(self.view, Some(parent)))
            }
            HostParent::Node(_) => None,
        }
    }
}

impl fmt::Debug for StyloNode<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StyloNode")
            .field("handle", &self.handle)
            .finish()
    }
}

impl PartialEq for StyloNode<'_> {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self.view, other.view) && self.handle == other.handle
    }
}

impl NodeInfo for StyloNode<'_> {
    fn is_element(&self) -> bool {
        self.as_element().is_some()
    }

    fn is_text_node(&self) -> bool {
        self.handle
            .and_then(|handle| self.view.snapshot().node(handle))
            .is_some_and(|node| matches!(node.kind(), HostNodeKind::Text(_)))
    }
}

impl<'a> TNode for StyloNode<'a> {
    type ConcreteElement = StyloElement<'a>;
    type ConcreteDocument = StyloDocument<'a>;
    type ConcreteShadowRoot = StyloShadowRoot<'a>;

    fn parent_node(&self) -> Option<Self> {
        self.parent()
    }

    fn first_child(&self) -> Option<Self> {
        self.node_children().into_iter().next()
    }

    fn last_child(&self) -> Option<Self> {
        self.node_children().into_iter().last()
    }

    fn prev_sibling(&self) -> Option<Self> {
        self.sibling(false)
    }

    fn next_sibling(&self) -> Option<Self> {
        self.sibling(true)
    }

    fn owner_doc(&self) -> StyloDocument<'a> {
        StyloDocument { view: self.view }
    }

    fn is_in_document(&self) -> bool {
        self.handle.is_none_or(|handle| self.view.is_member(handle))
    }

    fn traversal_parent(&self) -> Option<StyloElement<'a>> {
        self.parent_node().and_then(|parent| parent.as_element())
    }

    fn opaque(&self) -> OpaqueNode {
        let address = match self.handle {
            Some(handle) => self
                .view
                .snapshot()
                .node(handle)
                .map_or(0, |node| std::ptr::from_ref(node) as usize),
            None => std::ptr::from_ref(self.view) as usize,
        };
        OpaqueNode(address)
    }

    fn debug_id(self) -> usize {
        self.opaque().id()
    }

    fn as_element(&self) -> Option<StyloElement<'a>> {
        self.handle.and_then(|handle| self.view.element(handle))
    }

    fn as_document(&self) -> Option<StyloDocument<'a>> {
        self.handle
            .is_none()
            .then_some(StyloDocument { view: self.view })
    }

    fn as_shadow_root(&self) -> Option<StyloShadowRoot<'a>> {
        None
    }
}

impl<'a> TDocument for StyloDocument<'a> {
    type ConcreteNode = StyloNode<'a>;

    fn as_node(&self) -> StyloNode<'a> {
        StyloNode::new(self.view, None)
    }

    fn is_html_document(&self) -> bool {
        self.view.is_html_document()
    }

    fn quirks_mode(&self) -> QuirksMode {
        self.view.quirks_mode()
    }

    fn shared_lock(&self) -> &SharedRwLock {
        self.view.shared_lock()
    }
}

/// C03에서는 shadow tree를 만들지 않으므로 외부에서 생성할 수 없는 marker입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StyloShadowRoot<'a>(PhantomData<&'a StyloDocumentView>);

impl<'a> TShadowRoot for StyloShadowRoot<'a> {
    type ConcreteNode = StyloNode<'a>;

    fn as_node(&self) -> StyloNode<'a> {
        unreachable!("C03 어댑터는 ShadowRoot를 생성하지 않습니다")
    }

    fn host(&self) -> StyloElement<'a> {
        unreachable!("C03 어댑터는 ShadowRoot를 생성하지 않습니다")
    }

    fn style_data<'b>(&self) -> Option<&'b CascadeData>
    where
        Self: 'b,
    {
        None
    }
}
