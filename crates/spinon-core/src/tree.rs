use std::collections::{BTreeSet, HashMap, HashSet};

use crate::{
    Change, ChangeBatch, CommitError, CommitErrorKind, CommitReceipt, NodeId, Operation, Revision,
};

/// 트리 노드의 읽기 전용 상태입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Node {
    id: NodeId,
    tag: String,
    text: Option<String>,
    parent: Option<NodeId>,
    children: Vec<NodeId>,
}

impl Node {
    pub const fn id(&self) -> NodeId {
        self.id
    }

    pub fn tag(&self) -> &str {
        &self.tag
    }

    pub fn text(&self) -> Option<&str> {
        self.text.as_deref()
    }

    pub const fn parent(&self) -> Option<NodeId> {
        self.parent
    }

    pub fn children(&self) -> &[NodeId] {
        &self.children
    }
}

/// UI 트리와 마지막으로 확정한 revision을 소유합니다.
#[derive(Debug, Default, Eq, PartialEq)]
pub struct Tree {
    revision: Revision,
    root: Option<NodeId>,
    nodes: HashMap<NodeId, Node>,
    used_ids: HashSet<NodeId>,
}

impl Tree {
    pub fn new() -> Self {
        Self::default()
    }

    pub const fn revision(&self) -> Revision {
        self.revision
    }

    pub const fn root(&self) -> Option<NodeId> {
        self.root
    }

    pub fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(&id)
    }

    /// 구현 순서를 보장하지 않는 노드 반복자를 반환합니다.
    pub fn nodes(&self) -> impl Iterator<Item = &Node> {
        self.nodes.values()
    }

    /// 작업 묶음을 원자적으로 검증하고 확정합니다.
    ///
    /// 실패하면 현재 트리, 사용한 ID 집합과 revision은 바뀌지 않습니다.
    pub fn commit(&mut self, batch: ChangeBatch) -> Result<CommitReceipt, CommitError> {
        if batch.base_revision != self.revision {
            return Err(CommitError::batch(CommitErrorKind::StaleRevision {
                expected: batch.base_revision,
                actual: self.revision,
            }));
        }

        if batch.operations.is_empty() {
            return Ok(CommitReceipt {
                from_revision: self.revision,
                revision: self.revision,
                changes: Vec::new(),
            });
        }

        let mut candidate = self.working_copy();
        let mut created_ids = Vec::new();
        let mut changes = Vec::with_capacity(batch.operations.len());

        for (index, operation) in batch.operations.into_iter().enumerate() {
            candidate.apply(
                operation,
                index,
                &self.used_ids,
                &mut created_ids,
                &mut changes,
            )?;
        }

        candidate.validate().map_err(CommitError::batch)?;
        let next_revision = candidate
            .revision
            .0
            .checked_add(1)
            .map(Revision)
            .ok_or_else(|| CommitError::batch(CommitErrorKind::RevisionExhausted))?;

        let receipt = CommitReceipt {
            from_revision: self.revision,
            revision: next_revision,
            changes,
        };
        self.used_ids.extend(created_ids);
        self.root = candidate.root;
        self.nodes = candidate.nodes;
        self.revision = next_revision;
        Ok(receipt)
    }

    fn apply(
        &mut self,
        operation: Operation,
        operation_index: usize,
        retired_ids: &HashSet<NodeId>,
        created_ids: &mut Vec<NodeId>,
        changes: &mut Vec<Change>,
    ) -> Result<(), CommitError> {
        match operation {
            Operation::Create { id, tag } => {
                if retired_ids.contains(&id)
                    || self.nodes.contains_key(&id)
                    || created_ids.contains(&id)
                {
                    return Err(CommitError::operation(
                        operation_index,
                        CommitErrorKind::DuplicateNodeId(id),
                    ));
                }
                if tag.is_empty() || tag.chars().any(char::is_whitespace) || tag.contains('\0') {
                    return Err(CommitError::operation(
                        operation_index,
                        CommitErrorKind::InvalidTag,
                    ));
                }

                self.nodes.insert(
                    id,
                    Node {
                        id,
                        tag: tag.clone(),
                        text: None,
                        parent: None,
                        children: Vec::new(),
                    },
                );
                created_ids.push(id);
                changes.push(Change::Created { id, tag });
            }
            Operation::Insert { id, parent, index } => {
                self.insert(id, parent, index, operation_index)?;
                changes.push(Change::Inserted { id, parent, index });
            }
            Operation::UpdateText { id, text } => {
                let node = self.nodes.get_mut(&id).ok_or_else(|| {
                    CommitError::operation(operation_index, CommitErrorKind::UnknownNode(id))
                })?;
                node.text = Some(text.clone());
                changes.push(Change::TextUpdated { id, text });
            }
            Operation::Move { id, parent, index } => {
                let (from_parent, from_index) =
                    self.move_node(id, parent, index, operation_index)?;
                changes.push(Change::Moved {
                    id,
                    from_parent,
                    from_index,
                    to_parent: parent,
                    to_index: index,
                });
            }
            Operation::Remove { id } => {
                let nodes = self.remove_subtree(id, operation_index)?;
                changes.push(Change::Removed { root: id, nodes });
            }
        }
        Ok(())
    }

    #[cfg(test)]
    fn candidate_copy(&self) -> Self {
        Self {
            revision: self.revision,
            root: self.root,
            nodes: self.nodes.clone(),
            used_ids: self.used_ids.clone(),
        }
    }

    fn working_copy(&self) -> Self {
        Self {
            revision: self.revision,
            root: self.root,
            nodes: self.nodes.clone(),
            used_ids: HashSet::new(),
        }
    }

    fn insert(
        &mut self,
        id: NodeId,
        parent: Option<NodeId>,
        index: usize,
        operation_index: usize,
    ) -> Result<(), CommitError> {
        let node = self.nodes.get(&id).ok_or_else(|| {
            CommitError::operation(operation_index, CommitErrorKind::UnknownNode(id))
        })?;
        if node.parent.is_some() || self.root == Some(id) {
            return Err(CommitError::operation(
                operation_index,
                CommitErrorKind::NodeAlreadyAttached(id),
            ));
        }

        if let Some(parent_id) = parent {
            if !self.nodes.contains_key(&parent_id) {
                return Err(CommitError::operation(
                    operation_index,
                    CommitErrorKind::UnknownParent(parent_id),
                ));
            }
            if parent_id == id || self.is_descendant(parent_id, id) {
                return Err(CommitError::operation(
                    operation_index,
                    CommitErrorKind::Cycle {
                        node: id,
                        parent: parent_id,
                    },
                ));
            }
            let child_count = self.nodes[&parent_id].children.len();
            if index > child_count {
                return Err(CommitError::operation(
                    operation_index,
                    CommitErrorKind::InvalidIndex { index, child_count },
                ));
            }
            self.nodes
                .get_mut(&parent_id)
                .expect("parent was checked")
                .children
                .insert(index, id);
        } else {
            if index != 0 {
                return Err(CommitError::operation(
                    operation_index,
                    CommitErrorKind::InvalidIndex {
                        index,
                        child_count: 0,
                    },
                ));
            }
            if let Some(root) = self.root {
                return Err(CommitError::operation(
                    operation_index,
                    CommitErrorKind::RootAlreadyExists(root),
                ));
            }
            self.root = Some(id);
        }

        self.nodes.get_mut(&id).expect("node was checked").parent = parent;
        Ok(())
    }

    fn move_node(
        &mut self,
        id: NodeId,
        parent: Option<NodeId>,
        index: usize,
        operation_index: usize,
    ) -> Result<(Option<NodeId>, usize), CommitError> {
        if !self.nodes.contains_key(&id) {
            return Err(CommitError::operation(
                operation_index,
                CommitErrorKind::UnknownNode(id),
            ));
        }
        if !self.is_attached(id) {
            return Err(CommitError::operation(
                operation_index,
                CommitErrorKind::NodeNotAttached(id),
            ));
        }
        if let Some(parent_id) = parent {
            if !self.nodes.contains_key(&parent_id) {
                return Err(CommitError::operation(
                    operation_index,
                    CommitErrorKind::UnknownParent(parent_id),
                ));
            }
            if parent_id == id || self.is_descendant(parent_id, id) {
                return Err(CommitError::operation(
                    operation_index,
                    CommitErrorKind::Cycle {
                        node: id,
                        parent: parent_id,
                    },
                ));
            }
        }

        let from_parent = self.nodes[&id].parent;
        let from_index = match from_parent {
            Some(parent_id) => self.nodes[&parent_id]
                .children
                .iter()
                .position(|child| *child == id)
                .expect("parent and child links are consistent"),
            None => 0,
        };

        let child_count = match parent {
            Some(parent_id) => {
                let len = self.nodes[&parent_id].children.len();
                len - usize::from(from_parent == Some(parent_id))
            }
            None => usize::from(from_parent == Some(id)),
        };
        if index > child_count {
            return Err(CommitError::operation(
                operation_index,
                CommitErrorKind::InvalidIndex { index, child_count },
            ));
        }
        if parent.is_none()
            && from_parent.is_some()
            && let Some(root) = self.root
        {
            return Err(CommitError::operation(
                operation_index,
                CommitErrorKind::RootAlreadyExists(root),
            ));
        }

        match from_parent {
            Some(parent_id) => {
                self.nodes
                    .get_mut(&parent_id)
                    .expect("parent was checked")
                    .children
                    .remove(from_index);
            }
            None => self.root = None,
        }

        match parent {
            Some(parent_id) => self
                .nodes
                .get_mut(&parent_id)
                .expect("destination parent was checked")
                .children
                .insert(index, id),
            None => self.root = Some(id),
        }
        self.nodes.get_mut(&id).expect("node was checked").parent = parent;

        Ok((from_parent, from_index))
    }

    fn remove_subtree(
        &mut self,
        id: NodeId,
        operation_index: usize,
    ) -> Result<Vec<NodeId>, CommitError> {
        let node = self.nodes.get(&id).ok_or_else(|| {
            CommitError::operation(operation_index, CommitErrorKind::UnknownNode(id))
        })?;
        let parent = node.parent;
        if let Some(parent_id) = parent {
            let parent_node = self.nodes.get_mut(&parent_id).expect("parent exists");
            let index = parent_node
                .children
                .iter()
                .position(|child| *child == id)
                .expect("parent and child links are consistent");
            parent_node.children.remove(index);
        } else if self.root == Some(id) {
            self.root = None;
        }

        let mut removed = Vec::new();
        let mut pending = vec![id];
        while let Some(current) = pending.pop() {
            let node = self.nodes.get(&current).expect("subtree node exists");
            removed.push(current);
            pending.extend(node.children.iter().rev().copied());
        }
        for removed_id in &removed {
            self.nodes.remove(removed_id);
        }
        Ok(removed)
    }

    fn is_attached(&self, id: NodeId) -> bool {
        let mut cursor = Some(id);
        while let Some(current) = cursor {
            if self.root == Some(current) {
                return true;
            }
            cursor = self.nodes.get(&current).and_then(|node| node.parent);
        }
        false
    }

    fn is_descendant(&self, candidate: NodeId, ancestor: NodeId) -> bool {
        let mut cursor = Some(candidate);
        while let Some(current) = cursor {
            if current == ancestor {
                return true;
            }
            cursor = self.nodes.get(&current).and_then(|node| node.parent);
        }
        false
    }

    fn validate(&self) -> Result<(), CommitErrorKind> {
        if self.nodes.is_empty() {
            return match self.root {
                None => Ok(()),
                Some(root) => Err(CommitErrorKind::UnattachedNodes(vec![root])),
            };
        }

        let Some(root) = self.root else {
            return Err(CommitErrorKind::UnattachedNodes(self.sorted_node_ids()));
        };
        if !self.nodes.contains_key(&root) {
            return Err(CommitErrorKind::UnattachedNodes(self.sorted_node_ids()));
        }
        if self.nodes[&root].parent.is_some() {
            return Err(CommitErrorKind::UnattachedNodes(vec![root]));
        }

        let mut visited = BTreeSet::new();
        let mut pending = vec![root];
        while let Some(id) = pending.pop() {
            if !visited.insert(id) {
                return Err(CommitErrorKind::UnattachedNodes(vec![id]));
            }
            let node = self
                .nodes
                .get(&id)
                .ok_or_else(|| CommitErrorKind::UnattachedNodes(vec![id]))?;
            for child in node.children.iter().rev() {
                let child_node = self
                    .nodes
                    .get(child)
                    .ok_or_else(|| CommitErrorKind::UnattachedNodes(vec![*child]))?;
                if child_node.parent != Some(id) {
                    return Err(CommitErrorKind::UnattachedNodes(vec![*child]));
                }
                pending.push(*child);
            }
        }

        if visited.len() != self.nodes.len() {
            let mut unattached: Vec<_> = self
                .nodes
                .keys()
                .filter(|id| !visited.contains(id))
                .copied()
                .collect();
            unattached.sort_unstable();
            return Err(CommitErrorKind::UnattachedNodes(unattached));
        }
        Ok(())
    }

    fn sorted_node_ids(&self) -> Vec<NodeId> {
        let mut ids: Vec<_> = self.nodes.keys().copied().collect();
        ids.sort_unstable();
        ids
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: u64) -> NodeId {
        NodeId::new(value).expect("test IDs are nonzero")
    }

    fn commit(tree: &mut Tree, operations: impl FnOnce(&mut ChangeBatch)) -> CommitReceipt {
        let mut batch = ChangeBatch::new(tree.revision());
        operations(&mut batch);
        tree.commit(batch).expect("test batch should commit")
    }

    fn create_root(tree: &mut Tree, root: NodeId) {
        commit(tree, |batch| {
            batch.create(root, "div").insert(root, None, 0);
        });
    }

    #[test]
    fn commits_ordered_tree_changes_as_one_revision() {
        let mut tree = Tree::new();
        let receipt = commit(&mut tree, |batch| {
            batch
                .create(id(1), "div")
                .insert(id(1), None, 0)
                .create(id(3), "span")
                .insert(id(3), Some(id(1)), 0)
                .create(id(2), "button")
                .insert(id(2), Some(id(1)), 0)
                .update_text(id(2), "확인");
        });

        assert_eq!(receipt.from_revision(), Revision(0));
        assert_eq!(receipt.revision(), Revision(1));
        assert_eq!(receipt.changes().len(), 7);
        assert_eq!(tree.root(), Some(id(1)));
        assert_eq!(tree.node(id(1)).unwrap().children(), &[id(2), id(3)]);
        assert_eq!(tree.node(id(2)).unwrap().text(), Some("확인"));
    }

    #[test]
    fn failed_batch_preserves_tree_revision_and_uncommitted_ids_can_be_retried() {
        let mut tree = Tree::new();
        create_root(&mut tree, id(1));
        let before = tree.candidate_copy();
        let mut batch = ChangeBatch::new(tree.revision());
        batch
            .create(id(2), "span")
            .insert(id(2), Some(id(1)), 0)
            .remove(id(99));

        let error = tree.commit(batch).unwrap_err();
        assert_eq!(error.operation_index(), Some(2));
        assert_eq!(error.kind(), &CommitErrorKind::UnknownNode(id(99)));
        assert_eq!(tree, before);

        commit(&mut tree, |batch| {
            batch.create(id(2), "span").insert(id(2), Some(id(1)), 0);
        });
        assert!(tree.node(id(2)).is_some());
    }

    #[test]
    fn stale_revision_is_rejected_without_mutating_the_tree() {
        let mut tree = Tree::new();
        create_root(&mut tree, id(1));
        let before = tree.candidate_copy();
        let mut batch = ChangeBatch::new(Revision(0));
        batch.create(id(2), "span").insert(id(2), Some(id(1)), 0);

        let error = tree.commit(batch).unwrap_err();
        assert_eq!(
            error.kind(),
            &CommitErrorKind::StaleRevision {
                expected: Revision(0),
                actual: Revision(1),
            }
        );
        assert_eq!(tree, before);
    }

    #[test]
    fn removed_node_ids_cannot_be_reused_in_the_same_tree_lifetime() {
        let mut tree = Tree::new();
        commit(&mut tree, |batch| {
            batch
                .create(id(1), "div")
                .insert(id(1), None, 0)
                .create(id(2), "span")
                .insert(id(2), Some(id(1)), 0);
        });
        commit(&mut tree, |batch| {
            batch.remove(id(2));
        });
        let before = tree.candidate_copy();
        let mut batch = ChangeBatch::new(tree.revision());
        batch.create(id(2), "button").insert(id(2), Some(id(1)), 0);

        assert_eq!(
            tree.commit(batch).unwrap_err().kind(),
            &CommitErrorKind::DuplicateNodeId(id(2))
        );
        assert_eq!(tree, before);
    }

    #[test]
    fn node_id_cannot_be_recreated_after_removal_in_the_same_batch() {
        let mut tree = Tree::new();
        create_root(&mut tree, id(1));
        let before = tree.candidate_copy();
        let mut batch = ChangeBatch::new(tree.revision());
        batch
            .create(id(2), "span")
            .insert(id(2), Some(id(1)), 0)
            .remove(id(2))
            .create(id(2), "button")
            .insert(id(2), Some(id(1)), 0);

        let error = tree.commit(batch).unwrap_err();
        assert_eq!(error.operation_index(), Some(3));
        assert_eq!(error.kind(), &CommitErrorKind::DuplicateNodeId(id(2)));
        assert_eq!(tree, before);
    }

    #[test]
    fn move_uses_final_index_after_removing_the_node_from_its_old_position() {
        let mut tree = Tree::new();
        commit(&mut tree, |batch| {
            batch
                .create(id(1), "div")
                .insert(id(1), None, 0)
                .create(id(2), "span")
                .insert(id(2), Some(id(1)), 0)
                .create(id(3), "span")
                .insert(id(3), Some(id(1)), 1)
                .create(id(4), "span")
                .insert(id(4), Some(id(1)), 2);
        });

        commit(&mut tree, |batch| {
            batch.move_node(id(2), Some(id(1)), 2);
        });

        assert_eq!(tree.node(id(1)).unwrap().children(), &[id(3), id(4), id(2)]);
    }

    #[test]
    fn cyclic_move_fails_without_partial_changes() {
        let mut tree = Tree::new();
        commit(&mut tree, |batch| {
            batch
                .create(id(1), "div")
                .insert(id(1), None, 0)
                .create(id(2), "div")
                .insert(id(2), Some(id(1)), 0)
                .create(id(3), "span")
                .insert(id(3), Some(id(2)), 0);
        });
        let before = tree.candidate_copy();
        let mut batch = ChangeBatch::new(tree.revision());
        batch.move_node(id(2), Some(id(3)), 0);

        assert_eq!(
            tree.commit(batch).unwrap_err().kind(),
            &CommitErrorKind::Cycle {
                node: id(2),
                parent: id(3),
            }
        );
        assert_eq!(tree, before);
    }

    #[test]
    fn inserting_a_subtree_under_its_descendant_is_rejected_atomically() {
        let mut tree = Tree::new();
        let mut batch = ChangeBatch::new(tree.revision());
        batch
            .create(id(1), "div")
            .create(id(2), "div")
            .insert(id(2), Some(id(1)), 0)
            .insert(id(1), Some(id(2)), 0);

        let error = tree.commit(batch).unwrap_err();
        assert_eq!(error.operation_index(), Some(3));
        assert_eq!(
            error.kind(),
            &CommitErrorKind::Cycle {
                node: id(1),
                parent: id(2),
            }
        );
        assert!(tree.nodes().next().is_none());
        assert_eq!(tree.revision(), Revision(0));
    }

    #[test]
    fn a_tree_cannot_commit_a_second_root() {
        let mut tree = Tree::new();
        create_root(&mut tree, id(1));
        let before = tree.candidate_copy();
        let mut batch = ChangeBatch::new(tree.revision());
        batch.create(id(2), "div").insert(id(2), None, 0);

        assert_eq!(
            tree.commit(batch).unwrap_err().kind(),
            &CommitErrorKind::RootAlreadyExists(id(1))
        );
        assert_eq!(tree, before);
    }

    #[test]
    fn removing_a_node_reports_and_removes_its_subtree_in_preorder() {
        let mut tree = Tree::new();
        commit(&mut tree, |batch| {
            batch
                .create(id(1), "div")
                .insert(id(1), None, 0)
                .create(id(2), "div")
                .insert(id(2), Some(id(1)), 0)
                .create(id(3), "span")
                .insert(id(3), Some(id(2)), 0)
                .create(id(4), "button")
                .insert(id(4), Some(id(1)), 1);
        });

        let receipt = commit(&mut tree, |batch| {
            batch.remove(id(2));
        });

        assert_eq!(
            receipt.changes(),
            &[Change::Removed {
                root: id(2),
                nodes: vec![id(2), id(3)],
            }]
        );
        assert_eq!(tree.node(id(1)).unwrap().children(), &[id(4)]);
        assert!(tree.node(id(2)).is_none());
        assert!(tree.node(id(3)).is_none());
    }

    #[test]
    fn empty_batch_does_not_advance_revision() {
        let mut tree = Tree::new();
        let receipt = tree
            .commit(ChangeBatch::new(tree.revision()))
            .expect("empty batch is a no-op");

        assert_eq!(receipt.from_revision(), Revision(0));
        assert_eq!(receipt.revision(), Revision(0));
        assert!(receipt.changes().is_empty());
    }

    #[test]
    fn detached_nodes_are_rejected_at_the_final_validation_boundary() {
        let mut tree = Tree::new();
        let mut batch = ChangeBatch::new(tree.revision());
        batch.create(id(1), "div");

        assert_eq!(
            tree.commit(batch).unwrap_err().kind(),
            &CommitErrorKind::UnattachedNodes(vec![id(1)])
        );
        assert!(tree.nodes().next().is_none());
    }

    #[test]
    fn invalid_tag_fails_at_the_operation_that_created_it() {
        let mut tree = Tree::new();
        let mut batch = ChangeBatch::new(tree.revision());
        batch.create(id(1), "bad tag");

        let error = tree.commit(batch).unwrap_err();
        assert_eq!(error.operation_index(), Some(0));
        assert_eq!(error.kind(), &CommitErrorKind::InvalidTag);
        assert_eq!(
            error.to_string(),
            "작업 0에서 커밋을 거부했습니다: 태그는 비어 있거나 공백·NUL 문자를 포함할 수 없습니다"
        );
        assert!(tree.nodes().next().is_none());

        let mut nul_batch = ChangeBatch::new(tree.revision());
        nul_batch.create(id(1), "bad\0tag");
        assert_eq!(
            tree.commit(nul_batch).unwrap_err().kind(),
            &CommitErrorKind::InvalidTag
        );
    }

    #[test]
    fn revision_overflow_rejects_the_whole_batch() {
        let mut tree = Tree {
            revision: Revision(u64::MAX),
            ..Tree::default()
        };
        let mut batch = ChangeBatch::new(tree.revision());
        batch.create(id(1), "div").insert(id(1), None, 0);

        assert_eq!(
            tree.commit(batch).unwrap_err().kind(),
            &CommitErrorKind::RevisionExhausted
        );
        assert_eq!(tree.revision(), Revision(u64::MAX));
        assert!(tree.nodes().next().is_none());
    }

    #[test]
    fn zero_is_not_a_valid_node_id() {
        assert_eq!(NodeId::new(0), None);
        assert_eq!(NodeId::new(1).unwrap().get(), 1);
    }
}
