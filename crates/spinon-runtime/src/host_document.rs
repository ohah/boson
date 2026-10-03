#[cfg(test)]
use spinon_core::HostDocumentSnapshot;
use spinon_core::{
    AttributeName, DocumentChangeBatch, DocumentOperation, DocumentReceipt, DomString,
    HostDocument, HostNodeHandle, HostParent, OwnerId,
};
use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};

pub(crate) const MAX_BATCH_OPERATIONS: usize = 256;
const MAX_NAME_UNITS: usize = 1024;
const MAX_VALUE_UNITS: usize = 1_048_576;
const MAX_BATCH_STRING_UNITS: usize = 1_048_576;

#[path = "host_document_callback.rs"]
mod callback;
pub(crate) use callback::{DocumentCommitCallback, SpinonDocumentReceipt, commit_callback};
#[cfg(test)]
pub(crate) use callback::{
    OP_APPEND, OP_CREATE_ELEMENT, OP_CREATE_TEXT, OP_SET_ATTRIBUTE, OP_SET_TEXT,
    SpinonDocumentOperation,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DocumentBatchOperation {
    CreateElement {
        id: i32,
        namespace: String,
        name: String,
    },
    CreateText {
        id: i32,
        data: Vec<u16>,
    },
    Append {
        parent: i32,
        node: i32,
    },
    InsertBefore {
        parent: i32,
        node: i32,
        before: i32,
    },
    Remove {
        parent: i32,
        node: i32,
    },
    SetText {
        node: i32,
        data: Vec<u16>,
    },
    SetAttribute {
        node: i32,
        name: String,
        value: Vec<u16>,
    },
    RemoveAttribute {
        node: i32,
        name: String,
    },
}

#[derive(Debug)]
pub(crate) struct HostDocumentBridge {
    document: HostDocument,
    owner: OwnerId,
    handles: BTreeMap<i32, HostNodeHandle>,
}

impl HostDocumentBridge {
    pub(crate) fn new() -> Result<Self, String> {
        let document = HostDocument::new().map_err(|error| error.to_string())?;
        let owner = OwnerId::new(1).ok_or_else(|| "문서 소유자 ID가 잘못되었습니다".to_owned())?;
        Ok(Self {
            document,
            owner,
            handles: BTreeMap::new(),
        })
    }

    pub(crate) fn commit(
        &mut self,
        operations: &[DocumentBatchOperation],
    ) -> Result<SpinonDocumentReceipt, String> {
        if operations.len() > MAX_BATCH_OPERATIONS {
            return Err(format!(
                "문서 변경 묶음은 최대 {MAX_BATCH_OPERATIONS}개 작업까지 허용합니다"
            ));
        }
        validate_string_limits(operations)?;

        let mut candidate_handles = self.handles.clone();
        let mut reserved = Vec::with_capacity(operations.len());
        let result = catch_unwind(AssertUnwindSafe(|| {
            self.build_and_commit(operations, &mut candidate_handles, &mut reserved)
        }));
        match result {
            Ok(Ok(receipt)) => {
                self.handles = candidate_handles;
                let mut receipt = SpinonDocumentReceipt::from(receipt);
                receipt.node_count = self.handles.len() as u64;
                Ok(receipt)
            }
            Ok(Err(error)) => {
                for handle in reserved {
                    let _ = self.document.cancel_node_handle_reservation(handle);
                }
                Err(error)
            }
            Err(payload) => {
                for handle in reserved {
                    let _ = self.document.cancel_node_handle_reservation(handle);
                }
                resume_unwind(payload)
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> HostDocumentSnapshot {
        self.document.snapshot()
    }

    pub(crate) fn document_revision(&self) -> u64 {
        self.document.document_revision().get()
    }

    pub(crate) fn render_tree_revision(&self) -> u64 {
        self.document.render_tree_revision().get()
    }

    pub(crate) fn node_count(&self) -> u64 {
        self.handles.len() as u64
    }

    #[cfg(test)]
    pub(crate) fn handle(&self, external_id: i32) -> Option<HostNodeHandle> {
        self.handles.get(&external_id).copied()
    }

    fn build_and_commit(
        &mut self,
        operations: &[DocumentBatchOperation],
        handles: &mut BTreeMap<i32, HostNodeHandle>,
        reserved: &mut Vec<HostNodeHandle>,
    ) -> Result<DocumentReceipt, String> {
        let mut batch = DocumentChangeBatch::new(self.owner, self.document.document_revision());
        for (index, operation) in operations.iter().enumerate() {
            let operation = self.build_core_operation(operation, handles, reserved, index)?;
            batch.push(operation);
        }
        self.document
            .commit(batch)
            .map_err(|error| error.to_string())
    }

    fn build_core_operation(
        &mut self,
        operation: &DocumentBatchOperation,
        handles: &mut BTreeMap<i32, HostNodeHandle>,
        reserved: &mut Vec<HostNodeHandle>,
        index: usize,
    ) -> Result<DocumentOperation, String> {
        let at = |message: String| format!("문서 변경 {index}에서 거부했습니다: {message}");
        match operation {
            DocumentBatchOperation::CreateElement {
                id,
                namespace,
                name,
            } => {
                validate_new_id(*id, handles).map_err(at)?;
                let handle = self
                    .document
                    .reserve_node_handle()
                    .map_err(|error| at(error.to_string()))?;
                reserved.push(handle);
                handles.insert(*id, handle);
                Ok(DocumentOperation::CreateElement {
                    node: handle,
                    namespace: namespace.clone(),
                    local_name: name.clone(),
                })
            }
            DocumentBatchOperation::CreateText { id, data } => {
                validate_new_id(*id, handles).map_err(at)?;
                let handle = self
                    .document
                    .reserve_node_handle()
                    .map_err(|error| at(error.to_string()))?;
                reserved.push(handle);
                handles.insert(*id, handle);
                Ok(DocumentOperation::CreateText {
                    node: handle,
                    data: DomString::from_utf16(data.clone()),
                })
            }
            DocumentBatchOperation::Append { parent, node } => {
                let parent = core_parent(*parent, handles).map_err(at)?;
                let node = required_handle(*node, handles).map_err(at)?;
                Ok(DocumentOperation::InsertBefore {
                    parent,
                    node,
                    before: None,
                })
            }
            DocumentBatchOperation::InsertBefore {
                parent,
                node,
                before,
            } => {
                let parent = core_parent(*parent, handles).map_err(at)?;
                let node = required_handle(*node, handles).map_err(at)?;
                let before = if *before == 0 {
                    None
                } else {
                    Some(required_handle(*before, handles).map_err(at)?)
                };
                Ok(DocumentOperation::InsertBefore {
                    parent,
                    node,
                    before,
                })
            }
            DocumentBatchOperation::Remove { parent, node } => {
                let parent = core_parent(*parent, handles).map_err(at)?;
                let node = required_handle(*node, handles).map_err(at)?;
                Ok(DocumentOperation::RemoveChild { parent, node })
            }
            DocumentBatchOperation::SetText { node, data } => {
                let node = required_handle(*node, handles).map_err(at)?;
                Ok(DocumentOperation::SetTextData {
                    node,
                    data: DomString::from_utf16(data.clone()),
                })
            }
            DocumentBatchOperation::SetAttribute { node, name, value } => {
                let node = required_handle(*node, handles).map_err(at)?;
                let name = AttributeName::new(None, name.clone())
                    .ok_or_else(|| at("속성 이름이 잘못되었습니다".to_owned()))?;
                Ok(DocumentOperation::SetAttribute {
                    node,
                    name,
                    value: DomString::from_utf16(value.clone()),
                })
            }
            DocumentBatchOperation::RemoveAttribute { node, name } => {
                let node = required_handle(*node, handles).map_err(at)?;
                let name = AttributeName::new(None, name.clone())
                    .ok_or_else(|| at("속성 이름이 잘못되었습니다".to_owned()))?;
                Ok(DocumentOperation::RemoveAttribute { node, name })
            }
        }
    }
}

fn validate_string_limits(operations: &[DocumentBatchOperation]) -> Result<(), String> {
    let mut total_units = 0usize;
    for (index, operation) in operations.iter().enumerate() {
        let at = |message: String| format!("문서 변경 {index}에서 거부했습니다: {message}");
        let (name_units, namespace_units, value_units) = match operation {
            DocumentBatchOperation::CreateElement {
                namespace, name, ..
            } => (
                name.encode_utf16().count(),
                namespace.encode_utf16().count(),
                0,
            ),
            DocumentBatchOperation::CreateText { data, .. }
            | DocumentBatchOperation::SetText { data, .. } => (0, 0, data.len()),
            DocumentBatchOperation::SetAttribute { name, value, .. } => {
                (name.encode_utf16().count(), 0, value.len())
            }
            DocumentBatchOperation::RemoveAttribute { name, .. } => {
                (name.encode_utf16().count(), 0, 0)
            }
            DocumentBatchOperation::Append { .. }
            | DocumentBatchOperation::InsertBefore { .. }
            | DocumentBatchOperation::Remove { .. } => (0, 0, 0),
        };
        if name_units > MAX_NAME_UNITS || namespace_units > MAX_NAME_UNITS {
            return Err(at(format!(
                "이름 또는 namespace는 UTF-16 코드 단위 {MAX_NAME_UNITS}개까지 허용합니다"
            )));
        }
        if value_units > MAX_VALUE_UNITS {
            return Err(at(format!(
                "문자열 값은 UTF-16 코드 단위 {MAX_VALUE_UNITS}개까지 허용합니다"
            )));
        }
        let operation_units = name_units + namespace_units + value_units;
        total_units = total_units
            .checked_add(operation_units)
            .filter(|units| *units <= MAX_BATCH_STRING_UNITS)
            .ok_or_else(|| {
                at(format!(
                    "문서 변경 묶음 문자열은 UTF-16 코드 단위 {MAX_BATCH_STRING_UNITS}개까지 허용합니다"
                ))
            })?;
    }
    Ok(())
}

impl From<DocumentReceipt> for SpinonDocumentReceipt {
    fn from(receipt: DocumentReceipt) -> Self {
        Self {
            document_revision: receipt.document_revision().get(),
            render_tree_revision: receipt.render_tree_revision().get(),
            node_count: 0,
            changed: i32::from(receipt.changed()),
        }
    }
}

fn validate_new_id(id: i32, handles: &BTreeMap<i32, HostNodeHandle>) -> Result<(), String> {
    if id <= 0 {
        return Err("새 노드 ID는 양의 32비트 정수여야 합니다".to_owned());
    }
    if handles.contains_key(&id) {
        return Err(format!("노드 연결 키를 재사용했습니다: {id}"));
    }
    Ok(())
}

fn required_handle(
    external_id: i32,
    handles: &BTreeMap<i32, HostNodeHandle>,
) -> Result<HostNodeHandle, String> {
    if external_id <= 0 {
        return Err("노드 ID는 양의 32비트 정수여야 합니다".to_owned());
    }
    handles
        .get(&external_id)
        .copied()
        .ok_or_else(|| format!("알 수 없는 노드 연결 키입니다: {external_id}"))
}

fn core_parent(
    external_id: i32,
    handles: &BTreeMap<i32, HostNodeHandle>,
) -> Result<HostParent, String> {
    if external_id == 0 {
        return Ok(HostParent::Root);
    }
    if external_id < 0 {
        return Err("부모 ID는 0 또는 양의 32비트 정수여야 합니다".to_owned());
    }
    required_handle(external_id, handles).map(HostParent::Node)
}

#[cfg(test)]
#[path = "host_document_callback_tests.rs"]
mod callback_tests;
#[cfg(test)]
#[path = "host_document_limit_tests.rs"]
mod limit_tests;
#[cfg(test)]
#[path = "host_document_tests.rs"]
mod tests;
