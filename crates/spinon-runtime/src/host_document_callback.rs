use super::{
    DocumentBatchOperation, HostDocumentBridge, MAX_BATCH_OPERATIONS, MAX_BATCH_STRING_UNITS,
    MAX_NAME_UNITS, MAX_VALUE_UNITS,
};
use std::ffi::{c_char, c_void};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::slice;

const CALLBACK_OK: i32 = 0;
const CALLBACK_INVALID: i32 = -1;
const CALLBACK_REJECTED: i32 = -2;
const CALLBACK_PANIC: i32 = -3;

pub(crate) const OP_CREATE_ELEMENT: i32 = 1;
pub(crate) const OP_CREATE_TEXT: i32 = 2;
pub(crate) const OP_APPEND: i32 = 3;
pub(crate) const OP_INSERT_BEFORE: i32 = 4;
pub(crate) const OP_REMOVE: i32 = 5;
pub(crate) const OP_SET_TEXT: i32 = 6;
pub(crate) const OP_SET_ATTRIBUTE: i32 = 7;
pub(crate) const OP_REMOVE_ATTRIBUTE: i32 = 8;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SpinonDocumentOperation {
    pub(crate) kind: i32,
    pub(crate) node_id: i32,
    pub(crate) parent_id: i32,
    pub(crate) before_id: i32,
    pub(crate) namespace: *const u16,
    pub(crate) namespace_length: usize,
    pub(crate) name: *const u16,
    pub(crate) name_length: usize,
    pub(crate) value: *const u16,
    pub(crate) value_length: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SpinonDocumentReceipt {
    pub(crate) document_revision: u64,
    pub(crate) render_tree_revision: u64,
    pub(crate) node_count: u64,
    pub(crate) changed: i32,
}

pub(crate) type DocumentCommitCallback = unsafe extern "C" fn(
    *mut c_void,
    *const SpinonDocumentOperation,
    usize,
    *mut SpinonDocumentReceipt,
    *mut c_char,
    usize,
) -> i32;

unsafe fn read_utf16(
    value: *const u16,
    length: usize,
    limit: usize,
    field: &str,
    total_units: &mut usize,
) -> Result<Vec<u16>, String> {
    if length > limit {
        return Err(format!("{field}가 허용 길이를 초과했습니다: {length}"));
    }
    *total_units = total_units
        .checked_add(length)
        .filter(|units| *units <= MAX_BATCH_STRING_UNITS)
        .ok_or_else(|| {
            format!(
                "문서 변경 묶음 문자열은 UTF-16 코드 단위 {MAX_BATCH_STRING_UNITS}개까지 허용합니다"
            )
        })?;
    if length == 0 {
        return Ok(Vec::new());
    }
    if value.is_null() {
        return Err(format!("{field} 포인터가 비어 있습니다"));
    }
    Ok(unsafe { slice::from_raw_parts(value, length) }.to_vec())
}

unsafe fn read_name(
    value: *const u16,
    length: usize,
    field: &str,
    total_units: &mut usize,
) -> Result<String, String> {
    let units = unsafe { read_utf16(value, length, MAX_NAME_UNITS, field, total_units)? };
    String::from_utf16(&units).map_err(|_| format!("{field}에 짝이 맞지 않는 UTF-16이 있습니다"))
}

unsafe fn decode_operations(
    raw: *const SpinonDocumentOperation,
    count: usize,
) -> Result<Vec<DocumentBatchOperation>, String> {
    if count > MAX_BATCH_OPERATIONS {
        return Err(format!(
            "문서 변경 묶음은 최대 {MAX_BATCH_OPERATIONS}개 작업까지 허용합니다"
        ));
    }
    if count > 0 && raw.is_null() {
        return Err("문서 변경 작업 포인터가 비어 있습니다".to_owned());
    }
    if count == 0 {
        return Ok(Vec::new());
    }
    let mut decoded = Vec::with_capacity(count);
    let mut total_units = 0;
    for (index, operation) in unsafe { slice::from_raw_parts(raw, count) }
        .iter()
        .enumerate()
    {
        let at = |message: String| format!("문서 변경 {index}에서 거부했습니다: {message}");
        decoded.push(match operation.kind {
            OP_CREATE_ELEMENT => {
                let namespace = unsafe {
                    read_name(
                        operation.namespace,
                        operation.namespace_length,
                        "namespace",
                        &mut total_units,
                    )
                }
                .map_err(at)?;
                let name = unsafe {
                    read_name(
                        operation.name,
                        operation.name_length,
                        "이름",
                        &mut total_units,
                    )
                }
                .map_err(at)?;
                DocumentBatchOperation::CreateElement {
                    id: operation.node_id,
                    namespace,
                    name,
                }
            }
            OP_CREATE_TEXT => DocumentBatchOperation::CreateText {
                id: operation.node_id,
                data: unsafe {
                    read_utf16(
                        operation.value,
                        operation.value_length,
                        MAX_VALUE_UNITS,
                        "문자열 값",
                        &mut total_units,
                    )
                }
                .map_err(at)?,
            },
            OP_APPEND => DocumentBatchOperation::Append {
                parent: operation.parent_id,
                node: operation.node_id,
            },
            OP_INSERT_BEFORE => DocumentBatchOperation::InsertBefore {
                parent: operation.parent_id,
                node: operation.node_id,
                before: operation.before_id,
            },
            OP_REMOVE => DocumentBatchOperation::Remove {
                parent: operation.parent_id,
                node: operation.node_id,
            },
            OP_SET_TEXT => DocumentBatchOperation::SetText {
                node: operation.node_id,
                data: unsafe {
                    read_utf16(
                        operation.value,
                        operation.value_length,
                        MAX_VALUE_UNITS,
                        "문자열 값",
                        &mut total_units,
                    )
                }
                .map_err(at)?,
            },
            OP_SET_ATTRIBUTE => {
                let name = unsafe {
                    read_name(
                        operation.name,
                        operation.name_length,
                        "이름",
                        &mut total_units,
                    )
                }
                .map_err(at)?;
                let value = unsafe {
                    read_utf16(
                        operation.value,
                        operation.value_length,
                        MAX_VALUE_UNITS,
                        "문자열 값",
                        &mut total_units,
                    )
                }
                .map_err(at)?;
                DocumentBatchOperation::SetAttribute {
                    node: operation.node_id,
                    name,
                    value,
                }
            }
            OP_REMOVE_ATTRIBUTE => DocumentBatchOperation::RemoveAttribute {
                node: operation.node_id,
                name: unsafe {
                    read_name(
                        operation.name,
                        operation.name_length,
                        "이름",
                        &mut total_units,
                    )
                }
                .map_err(at)?,
            },
            unknown => return Err(at(format!("알 수 없는 변경 종류입니다: {unknown}"))),
        });
    }
    Ok(decoded)
}

fn write_error(output: *mut c_char, capacity: usize, message: &str) {
    if output.is_null() || capacity == 0 {
        return;
    }
    let max = capacity - 1;
    let mut length = message.len().min(max);
    while !message.is_char_boundary(length) {
        length -= 1;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(message.as_ptr(), output.cast::<u8>(), length);
        *output.add(length) = 0;
    }
}

pub(crate) unsafe extern "C" fn commit_callback(
    user_data: *mut c_void,
    operations: *const SpinonDocumentOperation,
    count: usize,
    output: *mut SpinonDocumentReceipt,
    error_output: *mut c_char,
    error_capacity: usize,
) -> i32 {
    if user_data.is_null() || output.is_null() || (count > 0 && operations.is_null()) {
        write_error(
            error_output,
            error_capacity,
            "문서 변경 callback 인자가 잘못되었습니다",
        );
        return CALLBACK_INVALID;
    }
    let result = catch_unwind(AssertUnwindSafe(|| {
        let decoded = unsafe { decode_operations(operations, count) }?;
        let bridge = unsafe { &mut *user_data.cast::<HostDocumentBridge>() };
        bridge.commit(&decoded)
    }));
    match result {
        Ok(Ok(receipt)) => {
            unsafe { output.write(receipt) };
            CALLBACK_OK
        }
        Ok(Err(error)) => {
            write_error(error_output, error_capacity, &error);
            CALLBACK_REJECTED
        }
        Err(_) => {
            write_error(
                error_output,
                error_capacity,
                "문서 변경 callback에서 패닉을 복구했습니다",
            );
            CALLBACK_PANIC
        }
    }
}
