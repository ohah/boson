use super::{
    HostDocumentBridge, OP_APPEND, OP_CREATE_ELEMENT, OP_CREATE_TEXT, OP_SET_ATTRIBUTE,
    OP_SET_TEXT, SpinonDocumentOperation, SpinonDocumentReceipt, commit_callback,
};
use std::ffi::c_char;

const HTML: &str = "http://www.w3.org/1999/xhtml";

#[test]
fn ffi_callback_decodes_utf16_and_writes_a_complete_receipt() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let namespace = HTML.encode_utf16().collect::<Vec<_>>();
    let name = "div".encode_utf16().collect::<Vec<_>>();
    let operation = SpinonDocumentOperation {
        kind: OP_CREATE_ELEMENT,
        node_id: 5,
        namespace: namespace.as_ptr(),
        namespace_length: namespace.len(),
        name: name.as_ptr(),
        name_length: name.len(),
        ..SpinonDocumentOperation::default()
    };
    let mut receipt = SpinonDocumentReceipt::default();
    let mut error = [0_i8; 256];
    let status = unsafe {
        commit_callback(
            (&mut bridge as *mut HostDocumentBridge).cast(),
            &operation,
            1,
            &mut receipt,
            error.as_mut_ptr().cast::<c_char>(),
            error.len(),
        )
    };
    assert_eq!(status, 0);
    assert_eq!(receipt.document_revision, 1);
    assert_eq!(receipt.render_tree_revision, 0);
    assert_eq!(receipt.node_count, 1);
    assert_eq!(receipt.changed, 1);
    assert_eq!(error[0], 0);

    let empty_status = unsafe {
        commit_callback(
            (&mut bridge as *mut HostDocumentBridge).cast(),
            std::ptr::null(),
            0,
            &mut receipt,
            error.as_mut_ptr().cast::<c_char>(),
            error.len(),
        )
    };
    assert_eq!(empty_status, 0);
    assert_eq!(receipt.document_revision, 1);
    assert_eq!(receipt.changed, 0);
}

#[test]
fn ffi_aggregate_utf16_limit_rejects_before_document_commit() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let first = vec![b'a' as u16; 600_000];
    let second = vec![b'b' as u16; 500_001];
    let operations = [
        SpinonDocumentOperation {
            kind: OP_CREATE_TEXT,
            node_id: 1,
            value: first.as_ptr(),
            value_length: first.len(),
            ..SpinonDocumentOperation::default()
        },
        SpinonDocumentOperation {
            kind: OP_CREATE_TEXT,
            node_id: 2,
            value: second.as_ptr(),
            value_length: second.len(),
            ..SpinonDocumentOperation::default()
        },
    ];
    let mut receipt = SpinonDocumentReceipt::default();
    let mut error = [0_i8; 256];
    let status = unsafe {
        commit_callback(
            (&mut bridge as *mut HostDocumentBridge).cast(),
            operations.as_ptr(),
            operations.len(),
            &mut receipt,
            error.as_mut_ptr().cast::<c_char>(),
            error.len(),
        )
    };

    assert_eq!(status, -2);
    assert_eq!(bridge.snapshot().node_count(), 0);
    assert_eq!(bridge.document_revision(), 0);
    assert!(
        unsafe { std::ffi::CStr::from_ptr(error.as_ptr()) }
            .to_string_lossy()
            .contains("묶음 문자열")
    );
}

#[test]
fn ffi_error_message_truncation_keeps_utf8_and_nul_termination() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let operation = SpinonDocumentOperation {
        kind: i32::MAX,
        ..SpinonDocumentOperation::default()
    };
    let mut receipt = SpinonDocumentReceipt::default();
    let mut error = [0_i8; 5];
    let status = unsafe {
        commit_callback(
            (&mut bridge as *mut HostDocumentBridge).cast(),
            &operation,
            1,
            &mut receipt,
            error.as_mut_ptr().cast::<c_char>(),
            error.len(),
        )
    };

    assert_eq!(status, -2);
    assert_eq!(error[3], 0);
    let message = unsafe { std::ffi::CStr::from_ptr(error.as_ptr()) };
    assert_eq!(message.to_str().unwrap(), "문");
}

#[test]
fn ffi_rejects_nonzero_string_length_with_a_null_pointer() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let operation = SpinonDocumentOperation {
        kind: OP_CREATE_TEXT,
        node_id: 1,
        value: std::ptr::null(),
        value_length: 1,
        ..SpinonDocumentOperation::default()
    };
    let mut receipt = SpinonDocumentReceipt::default();
    let mut error = [0_i8; 128];
    let status = unsafe {
        commit_callback(
            (&mut bridge as *mut HostDocumentBridge).cast(),
            &operation,
            1,
            &mut receipt,
            error.as_mut_ptr().cast::<c_char>(),
            error.len(),
        )
    };

    assert_eq!(status, -2);
    assert_eq!(bridge.snapshot().node_count(), 0);
    assert_eq!(bridge.document_revision(), 0);
    assert!(
        unsafe { std::ffi::CStr::from_ptr(error.as_ptr()) }
            .to_string_lossy()
            .contains("포인터")
    );
}

#[test]
fn namespace_and_attribute_names_reject_unpaired_utf16_before_commit() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let mut operation = SpinonDocumentOperation {
        kind: OP_CREATE_ELEMENT,
        node_id: 1,
        ..SpinonDocumentOperation::default()
    };
    let bad_name = [0xD800_u16];
    operation.name = bad_name.as_ptr();
    operation.name_length = bad_name.len();
    let mut receipt = SpinonDocumentReceipt::default();
    let mut error = [0_i8; 128];
    let status = unsafe {
        commit_callback(
            (&mut bridge as *mut HostDocumentBridge).cast(),
            &operation,
            1,
            &mut receipt,
            error.as_mut_ptr().cast::<c_char>(),
            error.len(),
        )
    };
    assert_eq!(status, -2);
    assert_eq!(bridge.snapshot().node_count(), 0);
    assert_eq!(bridge.document_revision(), 0);
    assert_ne!(error[0], 0);
}

#[test]
fn operation_kinds_without_values_do_not_require_non_null_utf16_pointers() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let namespace = HTML.encode_utf16().collect::<Vec<_>>();
    let element_name = "div".encode_utf16().collect::<Vec<_>>();
    let name = "id".encode_utf16().collect::<Vec<_>>();
    let unpaired_text = [0xD800_u16];
    let operations = [
        SpinonDocumentOperation {
            kind: OP_CREATE_ELEMENT,
            node_id: 1,
            namespace: namespace.as_ptr(),
            namespace_length: namespace.len(),
            name: element_name.as_ptr(),
            name_length: element_name.len(),
            ..SpinonDocumentOperation::default()
        },
        SpinonDocumentOperation {
            kind: OP_CREATE_TEXT,
            node_id: 2,
            value: unpaired_text.as_ptr(),
            value_length: unpaired_text.len(),
            ..SpinonDocumentOperation::default()
        },
        SpinonDocumentOperation {
            kind: OP_APPEND,
            parent_id: 0,
            node_id: 1,
            ..SpinonDocumentOperation::default()
        },
        SpinonDocumentOperation {
            kind: OP_APPEND,
            parent_id: 1,
            node_id: 2,
            ..SpinonDocumentOperation::default()
        },
        SpinonDocumentOperation {
            kind: OP_SET_ATTRIBUTE,
            node_id: 1,
            name: name.as_ptr(),
            name_length: name.len(),
            value: std::ptr::null(),
            value_length: 0,
            ..SpinonDocumentOperation::default()
        },
        SpinonDocumentOperation {
            kind: OP_SET_TEXT,
            node_id: 2,
            value: std::ptr::null(),
            value_length: 0,
            ..SpinonDocumentOperation::default()
        },
    ];
    let mut receipt = SpinonDocumentReceipt::default();
    let mut error = [0_i8; 128];
    let status = unsafe {
        commit_callback(
            (&mut bridge as *mut HostDocumentBridge).cast(),
            operations.as_ptr(),
            operations.len(),
            &mut receipt,
            error.as_mut_ptr().cast::<c_char>(),
            error.len(),
        )
    };
    assert_eq!(
        status,
        0,
        "{}",
        error
            .iter()
            .map(|byte| *byte as u8 as char)
            .collect::<String>()
    );
    assert_eq!(receipt.document_revision, 1);
}
