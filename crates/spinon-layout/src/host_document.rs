use std::collections::{BTreeMap, BTreeSet};

use spinon_core::{
    EnvironmentRevision, HostDocumentSnapshot, HostNodeHandle, HostNodeKind, HostParent, NodeId,
    StyleRevision,
};

use crate::{
    LayoutError, LayoutInput, LayoutInputRevision, LayoutNode, LayoutSourceRevision, LayoutStyle,
    Viewport,
};

impl LayoutInput {
    /// HostDocument의 요소 하위 트리를 순서 보존 레이아웃 snapshot으로 만듭니다.
    ///
    /// root는 HostRoot 직속 요소여야 합니다. 현재 텍스트 intrinsic measurement가
    /// 없으므로 선택한 하위 트리에 텍스트 노드가 있으면 입력 전체를 거부합니다.
    pub fn from_host_document(
        snapshot: &HostDocumentSnapshot,
        root: HostNodeHandle,
        viewport: Viewport,
        styles: &BTreeMap<NodeId, LayoutStyle>,
        style_revision: StyleRevision,
        environment_revision: EnvironmentRevision,
    ) -> Result<Self, LayoutError> {
        let root_node = snapshot
            .node(root)
            .ok_or(LayoutError::InvalidHostDocumentRoot(root.id()))?;
        if snapshot.parent(root) != Some(HostParent::Root)
            || !matches!(root_node.kind(), HostNodeKind::Element(_))
        {
            return Err(LayoutError::InvalidHostDocumentRoot(root.id()));
        }

        let mut nodes = Vec::new();
        let mut included = BTreeSet::new();
        let mut pending = vec![root];
        while let Some(handle) = pending.pop() {
            if !included.insert(handle.id()) {
                return Err(LayoutError::DuplicateNode(handle.id()));
            }

            let node = snapshot
                .node(handle)
                .ok_or(LayoutError::InvalidHostDocumentRoot(handle.id()))?;
            if matches!(node.kind(), HostNodeKind::Text(_)) {
                return Err(LayoutError::UnsupportedTextNode(handle.id()));
            }

            let child_handles = snapshot
                .children(handle)
                .ok_or(LayoutError::InvalidHostDocumentRoot(handle.id()))?
                .collect::<Vec<_>>();
            let mut children = Vec::with_capacity(child_handles.len());
            for child in &child_handles {
                let Some(child_node) = snapshot.node(*child) else {
                    return Err(LayoutError::MissingChild {
                        parent: handle.id(),
                        child: child.id(),
                    });
                };
                if matches!(child_node.kind(), HostNodeKind::Text(_)) {
                    return Err(LayoutError::UnsupportedTextNode(child.id()));
                }
                children.push(child.id());
            }

            let style = styles
                .get(&handle.id())
                .copied()
                .ok_or(LayoutError::MissingStyle(handle.id()))?;
            nodes.push(LayoutNode {
                id: handle.id(),
                children,
                style,
            });
            pending.extend(child_handles.into_iter().rev());
        }

        if let Some(id) = styles.keys().find(|id| !included.contains(*id)) {
            return Err(LayoutError::UnknownStyleNode(*id));
        }
        nodes.sort_by_key(|node| node.id);

        Ok(Self {
            root: root.id(),
            revision: LayoutInputRevision::new(
                LayoutSourceRevision::HostDocument {
                    generation: snapshot.generation(),
                    document: snapshot.document_revision(),
                    render_tree: snapshot.render_tree_revision(),
                },
                style_revision,
                environment_revision,
            ),
            viewport,
            nodes,
        })
    }
}

#[cfg(test)]
#[path = "host_document_tests.rs"]
mod tests;
