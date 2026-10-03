use std::collections::BTreeMap;

use spinon_core::{EnvironmentRevision, NodeId, StyleRevision, Tree};

use crate::{
    LayoutError, LayoutInput, LayoutInputRevision, LayoutNode, LayoutSourceRevision, LayoutStyle,
    Viewport,
};

impl LayoutInput {
    /// S01 코어 트리의 자식 순서를 보존하면서 완전한 스타일 snapshot을 만듭니다.
    pub fn from_tree(
        tree: &Tree,
        viewport: Viewport,
        styles: &BTreeMap<NodeId, LayoutStyle>,
        style_revision: StyleRevision,
        environment_revision: EnvironmentRevision,
    ) -> Result<Self, LayoutError> {
        let root = tree.root().ok_or(LayoutError::EmptyTree)?;
        let mut core_nodes = tree.nodes().collect::<Vec<_>>();
        core_nodes.sort_by_key(|node| node.id());

        for &id in styles.keys() {
            if tree.node(id).is_none() {
                return Err(LayoutError::UnknownStyleNode(id));
            }
        }

        let mut nodes = Vec::with_capacity(core_nodes.len());
        for node in core_nodes {
            let style = styles
                .get(&node.id())
                .copied()
                .ok_or(LayoutError::MissingStyle(node.id()))?;
            nodes.push(LayoutNode {
                id: node.id(),
                children: node.children().to_vec(),
                style,
            });
        }

        Ok(Self {
            root,
            revision: LayoutInputRevision::new(
                LayoutSourceRevision::Tree(tree.revision()),
                style_revision,
                environment_revision,
            ),
            viewport,
            nodes,
        })
    }
}
