use crate::{NodeId, Revision};

/// 한 번의 커밋으로 적용할 순서 있는 트리 작업입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Operation {
    Create {
        id: NodeId,
        tag: String,
    },
    Insert {
        id: NodeId,
        parent: Option<NodeId>,
        index: usize,
    },
    UpdateText {
        id: NodeId,
        text: String,
    },
    Move {
        id: NodeId,
        parent: Option<NodeId>,
        index: usize,
    },
    Remove {
        id: NodeId,
    },
}

/// 하나의 기준 revision에 적용할 작업 묶음입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChangeBatch {
    pub(crate) base_revision: Revision,
    pub(crate) operations: Vec<Operation>,
}

impl ChangeBatch {
    pub fn new(base_revision: Revision) -> Self {
        Self {
            base_revision,
            operations: Vec::new(),
        }
    }

    pub const fn base_revision(&self) -> Revision {
        self.base_revision
    }

    pub fn operations(&self) -> &[Operation] {
        &self.operations
    }

    pub fn push(&mut self, operation: Operation) -> &mut Self {
        self.operations.push(operation);
        self
    }

    pub fn create(&mut self, id: NodeId, tag: impl Into<String>) -> &mut Self {
        self.push(Operation::Create {
            id,
            tag: tag.into(),
        })
    }

    pub fn insert(&mut self, id: NodeId, parent: Option<NodeId>, index: usize) -> &mut Self {
        self.push(Operation::Insert { id, parent, index })
    }

    pub fn update_text(&mut self, id: NodeId, text: impl Into<String>) -> &mut Self {
        self.push(Operation::UpdateText {
            id,
            text: text.into(),
        })
    }

    pub fn move_node(&mut self, id: NodeId, parent: Option<NodeId>, index: usize) -> &mut Self {
        self.push(Operation::Move { id, parent, index })
    }

    pub fn remove(&mut self, id: NodeId) -> &mut Self {
        self.push(Operation::Remove { id })
    }
}

/// 성공한 커밋이 확정한 변경입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Change {
    Created {
        id: NodeId,
        tag: String,
    },
    Inserted {
        id: NodeId,
        parent: Option<NodeId>,
        index: usize,
    },
    TextUpdated {
        id: NodeId,
        text: String,
    },
    Moved {
        id: NodeId,
        from_parent: Option<NodeId>,
        from_index: usize,
        to_parent: Option<NodeId>,
        to_index: usize,
    },
    Removed {
        root: NodeId,
        nodes: Vec<NodeId>,
    },
}

/// 한 작업 묶음을 확정한 결과입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitReceipt {
    pub(crate) from_revision: Revision,
    pub(crate) revision: Revision,
    pub(crate) changes: Vec<Change>,
}

impl CommitReceipt {
    pub const fn from_revision(&self) -> Revision {
        self.from_revision
    }

    pub const fn revision(&self) -> Revision {
        self.revision
    }

    pub fn changes(&self) -> &[Change] {
        &self.changes
    }
}
