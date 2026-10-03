use super::{DocumentBatchOperation as Operation, HostDocumentBridge, SpinonDocumentReceipt};

fn element(id: i32, name: &str) -> Operation {
    Operation::CreateElement {
        id,
        namespace: "http://www.w3.org/1999/xhtml".to_owned(),
        name: name.to_owned(),
    }
}

fn commit(bridge: &mut HostDocumentBridge, operations: Vec<Operation>) -> SpinonDocumentReceipt {
    bridge
        .commit(&operations)
        .expect("유효한 변경 묶음이어야 합니다")
}

#[test]
fn oversized_batches_fail_before_allocating_handles() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let operations = (1..=257).map(|id| element(id, "div")).collect::<Vec<_>>();
    let error = bridge.commit(&operations).unwrap_err();
    assert!(error.contains("최대 256개"));
    assert_eq!(bridge.snapshot().node_count(), 0);
    assert_eq!(bridge.document_revision(), 0);
}

#[test]
fn exact_operation_limit_is_accepted() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let operations = (1..=256).map(|id| element(id, "div")).collect::<Vec<_>>();

    let receipt = commit(&mut bridge, operations);

    assert_eq!(receipt.changed, 1);
    assert_eq!(receipt.node_count, 256);
    assert_eq!(bridge.snapshot().node_count(), 256);
    assert_eq!(bridge.document_revision(), 1);
}

#[test]
fn exact_name_limit_is_accepted() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    commit(
        &mut bridge,
        vec![element(1, "div"), Operation::Append { parent: 0, node: 1 }],
    );
    let name = "a".repeat(1024);

    let receipt = commit(
        &mut bridge,
        vec![Operation::SetAttribute {
            node: 1,
            name,
            value: Vec::new(),
        }],
    );

    assert_eq!(receipt.document_revision, 2);
    assert_eq!(receipt.node_count, 1);
}

#[test]
fn exact_utf16_value_limit_is_accepted() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let receipt = commit(
        &mut bridge,
        vec![Operation::CreateText {
            id: 1,
            data: vec![b'x' as u16; 1_048_576],
        }],
    );

    assert_eq!(receipt.document_revision, 1);
    assert_eq!(receipt.node_count, 1);
    assert_eq!(bridge.snapshot().node_count(), 1);
}

#[test]
fn aggregate_utf16_limit_rejects_before_reserving_any_node() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let before = bridge.snapshot();
    let error = bridge
        .commit(&[
            Operation::CreateText {
                id: 1,
                data: vec![b'a' as u16; 600_000],
            },
            Operation::CreateText {
                id: 2,
                data: vec![b'b' as u16; 500_001],
            },
        ])
        .unwrap_err();

    assert!(error.contains("묶음 문자열"));
    assert_eq!(bridge.snapshot(), before);
    assert_eq!(bridge.handle(1), None);
    assert_eq!(bridge.handle(2), None);
}
