use std::collections::{BTreeMap, BTreeSet};

use crate::NodeId;

use super::{
    ParentRef,
    types::{
        DocumentError, DocumentErrorKind, DocumentGeneration, DocumentOperation, HostElement,
        HostNode, HostNodeHandle, HostNodeKind, HostParent, OwnerId, valid_name,
    },
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct Candidate {
    pub(super) root_children: Vec<NodeId>,
    pub(super) nodes: BTreeMap<NodeId, HostNode>,
}

pub(super) fn apply_operation(
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

pub(super) fn is_connected(nodes: &BTreeMap<NodeId, HostNode>, id: NodeId) -> bool {
    let mut current = id;
    loop {
        match nodes.get(&current).and_then(|node| node.parent) {
            Some(ParentRef::Root) => return true,
            Some(ParentRef::Node(parent)) => current = parent,
            None => return false,
        }
    }
}

pub(super) fn same_render_projection(
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
