mod mutation;
mod snapshot;
mod types;

#[cfg(test)]
mod reservation_tests;
#[cfg(test)]
mod tests;

pub use snapshot::HostDocumentSnapshot;
pub use types::{
    AttributeName, DocumentChangeBatch, DocumentError, DocumentErrorKind, DocumentGeneration,
    DocumentOperation, DocumentReceipt, DocumentRevision, DomString, ElementState, HostElement,
    HostNode, HostNodeHandle, HostNodeKind, HostParent, OwnerId, RenderTreeRevision,
};

use std::collections::{BTreeMap, BTreeSet};

use crate::NodeId;
use mutation::{Candidate, apply_operation, same_render_projection};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ParentRef {
    Root,
    Node(NodeId),
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

    /// 노드를 만들기 전에 예약한 핸들을 취소합니다. 이미 소비되었거나 취소된 핸들이면 `false`입니다.
    /// 취소한 ID도 다시 사용하지 않으며 문서 revision은 바뀌지 않습니다.
    pub fn cancel_node_handle_reservation(
        &mut self,
        handle: HostNodeHandle,
    ) -> Result<bool, DocumentError> {
        if handle.generation != self.generation {
            return Err(DocumentError::batch(DocumentErrorKind::StaleGeneration {
                expected: self.generation.get(),
                actual: handle.generation.get(),
            }));
        }
        Ok(self.reserved_ids.remove(&handle.id))
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
