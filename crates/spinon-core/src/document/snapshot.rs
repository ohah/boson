use std::collections::BTreeMap;

use crate::NodeId;

use super::{
    DocumentGeneration, DocumentRevision, DomString, HostDocument, HostNode, HostNodeHandle,
    HostNodeKind, HostParent, ParentRef, RenderTreeRevision, mutation::is_connected,
};

/// 스타일·레이아웃 계산에 넘길 불변 문서 사본입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostDocumentSnapshot {
    pub(super) generation: DocumentGeneration,
    pub(super) document_revision: DocumentRevision,
    pub(super) render_tree_revision: RenderTreeRevision,
    pub(super) root_children: Vec<NodeId>,
    pub(super) nodes: BTreeMap<NodeId, HostNode>,
}

impl HostDocument {
    pub fn snapshot(&self) -> HostDocumentSnapshot {
        HostDocumentSnapshot {
            generation: self.generation,
            document_revision: self.document_revision,
            render_tree_revision: self.render_tree_revision,
            root_children: self.root_children.clone(),
            nodes: self.nodes.clone(),
        }
    }
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
