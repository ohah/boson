use super::{DocumentBatchOperation as Operation, HostDocumentBridge, SpinonDocumentReceipt};
use spinon_core::{
    AttributeName, DocumentChangeBatch, DocumentOperation, DomString, HostDocument, HostNodeKind,
    HostParent, OwnerId,
};

const HTML: &str = "http://www.w3.org/1999/xhtml";

fn element(id: i32, name: &str) -> Operation {
    Operation::CreateElement {
        id,
        namespace: HTML.to_owned(),
        name: name.to_owned(),
    }
}

fn text(id: i32, data: &str) -> Operation {
    Operation::CreateText {
        id,
        data: data.encode_utf16().collect(),
    }
}

fn commit(bridge: &mut HostDocumentBridge, operations: Vec<Operation>) -> SpinonDocumentReceipt {
    bridge
        .commit(&operations)
        .expect("유효한 변경 묶음이어야 합니다")
}

#[test]
fn successful_batch_matches_direct_host_document_commit() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let receipt = commit(
        &mut bridge,
        vec![
            element(1, "div"),
            text(2, "hello 🌐"),
            Operation::Append { parent: 0, node: 1 },
            Operation::Append { parent: 1, node: 2 },
            Operation::SetAttribute {
                node: 1,
                name: "class".to_owned(),
                value: "card".encode_utf16().collect(),
            },
        ],
    );

    let mut expected = HostDocument::new().unwrap();
    let owner = OwnerId::new(1).unwrap();
    let expected_element = expected.reserve_node_handle().unwrap();
    let expected_text = expected.reserve_node_handle().unwrap();
    let mut expected_batch = DocumentChangeBatch::new(owner, expected.document_revision());
    expected_batch
        .push(DocumentOperation::CreateElement {
            node: expected_element,
            namespace: HTML.to_owned(),
            local_name: "div".to_owned(),
        })
        .push(DocumentOperation::CreateText {
            node: expected_text,
            data: DomString::from("hello 🌐"),
        })
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Root,
            node: expected_element,
            before: None,
        })
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(expected_element),
            node: expected_text,
            before: None,
        })
        .push(DocumentOperation::SetAttribute {
            node: expected_element,
            name: AttributeName::new(None, "class").unwrap(),
            value: DomString::from("card"),
        });
    let expected_receipt = expected.commit(expected_batch).unwrap();

    let snapshot = bridge.snapshot();
    let actual_element = bridge.handle(1).unwrap();
    let actual_text = bridge.handle(2).unwrap();
    let actual_element_node = snapshot.node(actual_element).unwrap();
    let HostNodeKind::Element(actual_data) = actual_element_node.kind() else {
        panic!("루트 노드는 요소여야 합니다");
    };
    assert_eq!(actual_data.namespace(), HTML);
    assert_eq!(actual_data.local_name(), "div");
    assert_eq!(
        actual_data
            .attribute(&AttributeName::new(None, "class").unwrap())
            .unwrap()
            .to_string_lossy(),
        "card"
    );
    assert_eq!(
        snapshot
            .children(actual_element)
            .unwrap()
            .collect::<Vec<_>>(),
        vec![actual_text]
    );
    assert_eq!(
        snapshot
            .text_content(actual_element)
            .unwrap()
            .to_string_lossy(),
        "hello 🌐"
    );
    assert!(snapshot.is_connected(actual_element));
    assert_eq!(receipt.changed, 1);
    assert_eq!(
        receipt.document_revision,
        expected_receipt.document_revision().get()
    );
    assert_eq!(
        receipt.render_tree_revision,
        expected_receipt.render_tree_revision().get()
    );
    assert_eq!(receipt.node_count, snapshot.node_count() as u64);
}

#[test]
fn rejected_last_operation_rolls_back_nodes_handles_and_revisions() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let before = bridge.snapshot();
    let error = bridge
        .commit(&[
            element(1, "div"),
            text(2, "not visible"),
            Operation::Append { parent: 0, node: 1 },
            Operation::Append { parent: 1, node: 2 },
            Operation::SetAttribute {
                node: 99,
                name: "class".to_owned(),
                value: "invalid".encode_utf16().collect(),
            },
        ])
        .unwrap_err();

    assert!(error.contains("알 수 없는 노드 연결 키"));
    assert_eq!(bridge.snapshot(), before);
    assert_eq!(bridge.handle(1), None);
    assert_eq!(bridge.handle(2), None);

    let receipt = commit(&mut bridge, vec![element(1, "section")]);
    assert_eq!(receipt.document_revision, 1);
    assert_eq!(bridge.snapshot().node_count(), 1);
}

#[test]
fn invalid_external_ids_and_forward_references_leave_every_document_unchanged() {
    let invalid_batches = [
        vec![element(0, "div")],
        vec![element(-1, "div")],
        vec![element(1, "div"), element(1, "span")],
        vec![Operation::Append { parent: 0, node: 1 }, element(1, "div")],
        vec![
            element(1, "div"),
            Operation::Append {
                parent: -1,
                node: 1,
            },
        ],
    ];

    for operations in invalid_batches {
        let mut bridge = HostDocumentBridge::new().unwrap();
        let before = bridge.snapshot();

        assert!(bridge.commit(&operations).is_err());
        assert_eq!(bridge.snapshot(), before);
        assert_eq!(bridge.document_revision(), 0);
        assert_eq!(bridge.node_count(), 0);
    }
}

#[test]
fn independent_bridges_keep_identical_external_ids_isolated() {
    let mut first = HostDocumentBridge::new().unwrap();
    let mut second = HostDocumentBridge::new().unwrap();
    commit(&mut first, vec![element(1, "section")]);
    commit(&mut second, vec![element(1, "aside")]);

    let first_handle = first.handle(1).unwrap();
    let second_handle = second.handle(1).unwrap();
    let first_snapshot = first.snapshot();
    let second_snapshot = second.snapshot();
    let HostNodeKind::Element(first_element) = first_snapshot.node(first_handle).unwrap().kind()
    else {
        panic!("첫 문서는 요소 노드여야 합니다");
    };
    let HostNodeKind::Element(second_element) = second_snapshot.node(second_handle).unwrap().kind()
    else {
        panic!("두 번째 문서는 요소 노드여야 합니다");
    };

    assert_eq!(first_element.local_name(), "section");
    assert_eq!(second_element.local_name(), "aside");
    commit(
        &mut first,
        vec![Operation::SetAttribute {
            node: 1,
            name: "id".to_owned(),
            value: "first".encode_utf16().collect(),
        }],
    );
    assert_eq!(first.document_revision(), 2);
    assert_eq!(second.document_revision(), 1);
    let second_snapshot = second.snapshot();
    let HostNodeKind::Element(second_element) = second_snapshot.node(second_handle).unwrap().kind()
    else {
        panic!("두 번째 문서는 요소 노드여야 합니다");
    };
    assert!(
        second_element
            .attribute(&AttributeName::new(None, "id").unwrap())
            .is_none()
    );
}

#[test]
fn per_field_string_limits_fail_before_node_reservation() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let before = bridge.snapshot();
    let long_name = "x".repeat(1025);
    assert!(bridge.commit(&[element(1, &long_name)]).is_err());
    assert_eq!(bridge.snapshot(), before);
    assert_eq!(bridge.handle(1), None);

    let long_value = Operation::CreateText {
        id: 2,
        data: vec![b'x' as u16; 1_048_577],
    };
    assert!(bridge.commit(&[long_value]).is_err());
    assert_eq!(bridge.snapshot(), before);
    assert_eq!(bridge.handle(2), None);
}

#[test]
fn detached_nodes_keep_their_identity_and_can_be_reinserted() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    commit(
        &mut bridge,
        vec![
            element(1, "div"),
            element(2, "span"),
            Operation::Append { parent: 0, node: 1 },
            Operation::Append { parent: 1, node: 2 },
        ],
    );
    let child = bridge.handle(2).unwrap();

    let removed = commit(&mut bridge, vec![Operation::Remove { parent: 1, node: 2 }]);
    assert_eq!(removed.document_revision, 2);
    assert_eq!(removed.render_tree_revision, 2);
    assert_eq!(bridge.handle(2), Some(child));
    assert!(!bridge.snapshot().is_connected(child));

    commit(&mut bridge, vec![Operation::Append { parent: 0, node: 2 }]);
    assert!(bridge.snapshot().is_connected(child));
    assert_eq!(
        bridge.snapshot().root_children().collect::<Vec<_>>(),
        vec![bridge.handle(1).unwrap(), child]
    );

    let before = bridge.snapshot();
    let error = bridge.commit(&[element(2, "p")]).unwrap_err();
    assert!(error.contains("재사용"));
    assert_eq!(bridge.snapshot(), before);
}

#[test]
fn insert_move_remove_and_attribute_operations_keep_final_tree_order() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    commit(
        &mut bridge,
        vec![
            element(1, "div"),
            element(2, "span"),
            element(3, "button"),
            Operation::Append { parent: 0, node: 1 },
            Operation::Append { parent: 1, node: 2 },
            Operation::Append { parent: 1, node: 3 },
            Operation::SetAttribute {
                node: 1,
                name: "class".to_owned(),
                value: "card".encode_utf16().collect(),
            },
        ],
    );
    let parent = bridge.handle(1).unwrap();
    let first = bridge.handle(2).unwrap();
    let second = bridge.handle(3).unwrap();

    commit(
        &mut bridge,
        vec![Operation::InsertBefore {
            parent: 1,
            node: 3,
            before: 2,
        }],
    );
    assert_eq!(
        bridge
            .snapshot()
            .children(parent)
            .unwrap()
            .collect::<Vec<_>>(),
        vec![second, first]
    );

    commit(&mut bridge, vec![Operation::Append { parent: 1, node: 3 }]);
    assert_eq!(
        bridge
            .snapshot()
            .children(parent)
            .unwrap()
            .collect::<Vec<_>>(),
        vec![first, second]
    );

    commit(
        &mut bridge,
        vec![
            Operation::InsertBefore {
                parent: 1,
                node: 2,
                before: 0,
            },
            Operation::RemoveAttribute {
                node: 1,
                name: "class".to_owned(),
            },
        ],
    );
    let snapshot = bridge.snapshot();
    assert_eq!(
        snapshot.children(parent).unwrap().collect::<Vec<_>>(),
        vec![second, first]
    );
    let HostNodeKind::Element(element) = snapshot.node(parent).unwrap().kind() else {
        panic!("부모는 요소여야 합니다");
    };
    assert!(
        element
            .attribute(&AttributeName::new(None, "class").unwrap())
            .is_none()
    );

    let before_invalid_remove = bridge.snapshot();
    let error = bridge
        .commit(&[Operation::Remove { parent: 0, node: 3 }])
        .unwrap_err();
    assert!(error.contains("부모"));
    assert_eq!(bridge.snapshot(), before_invalid_remove);

    commit(
        &mut bridge,
        vec![
            Operation::Remove { parent: 1, node: 3 },
            Operation::Append { parent: 0, node: 3 },
        ],
    );
    let snapshot = bridge.snapshot();
    assert_eq!(
        snapshot.root_children().collect::<Vec<_>>(),
        vec![parent, second]
    );
    assert_eq!(bridge.handle(3), Some(second));
}

#[test]
fn utf16_text_values_preserve_unpaired_surrogates() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let data = vec![0xD800, b'x' as u16, 0xDC00];
    commit(
        &mut bridge,
        vec![
            element(1, "span"),
            Operation::CreateText {
                id: 2,
                data: data.clone(),
            },
            Operation::Append { parent: 0, node: 1 },
            Operation::Append { parent: 1, node: 2 },
        ],
    );
    let text = bridge.handle(2).unwrap();
    let snapshot = bridge.snapshot();
    let HostNodeKind::Text(actual) = snapshot.node(text).unwrap().kind() else {
        panic!("텍스트 노드여야 합니다");
    };
    assert_eq!(actual.code_units(), data);

    let receipt = commit(
        &mut bridge,
        vec![Operation::SetText {
            node: 2,
            data: vec![0xDFFF],
        }],
    );
    assert_eq!(receipt.document_revision, 2);
    let snapshot = bridge.snapshot();
    let HostNodeKind::Text(actual) = snapshot.node(text).unwrap().kind() else {
        panic!("텍스트 노드여야 합니다");
    };
    assert_eq!(actual.code_units(), [0xDFFF]);
}

#[test]
fn no_op_and_empty_batches_do_not_advance_revisions() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let initial = bridge.commit(&[]).unwrap();
    assert_eq!(initial.document_revision, 0);
    assert_eq!(initial.render_tree_revision, 0);
    assert_eq!(initial.changed, 0);

    commit(
        &mut bridge,
        vec![element(1, "div"), Operation::Append { parent: 0, node: 1 }],
    );
    let receipt = commit(
        &mut bridge,
        vec![Operation::SetAttribute {
            node: 1,
            name: "class".to_owned(),
            value: "same".encode_utf16().collect(),
        }],
    );
    let unchanged = commit(
        &mut bridge,
        vec![Operation::SetAttribute {
            node: 1,
            name: "class".to_owned(),
            value: "same".encode_utf16().collect(),
        }],
    );
    assert_eq!(receipt.document_revision, 2);
    assert_eq!(unchanged.document_revision, 2);
    assert_eq!(unchanged.render_tree_revision, 2);
    assert_eq!(unchanged.changed, 0);
}

#[test]
fn failed_core_commit_cancels_every_new_reservation() {
    let mut bridge = HostDocumentBridge::new().unwrap();
    let error = bridge
        .commit(&[
            element(1, "div"),
            Operation::SetText {
                node: 1,
                data: "wrong kind".encode_utf16().collect(),
            },
        ])
        .unwrap_err();
    assert!(error.contains("종류의 노드"));
    assert_eq!(bridge.snapshot().node_count(), 0);
    assert_eq!(bridge.handle(1), None);
}
