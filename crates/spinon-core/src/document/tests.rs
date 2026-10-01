use super::*;

const HTML: &str = "http://www.w3.org/1999/xhtml";

fn owner(value: u64) -> OwnerId {
    OwnerId::new(value).unwrap()
}

fn commit(document: &mut HostDocument, owner: OwnerId, operation: DocumentOperation) {
    let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
    batch.push(operation);
    document.commit(batch).unwrap();
}

fn create_element(document: &mut HostDocument, owner: OwnerId, name: &str) -> HostNodeHandle {
    let handle = document.reserve_node_handle().unwrap();
    commit(
        document,
        owner,
        DocumentOperation::CreateElement {
            node: handle,
            namespace: HTML.to_owned(),
            local_name: name.to_owned(),
        },
    );
    handle
}

fn create_text(document: &mut HostDocument, owner: OwnerId, data: DomString) -> HostNodeHandle {
    let handle = document.reserve_node_handle().unwrap();
    commit(
        document,
        owner,
        DocumentOperation::CreateText { node: handle, data },
    );
    handle
}

fn insert(
    document: &mut HostDocument,
    owner: OwnerId,
    parent: HostParent,
    node: HostNodeHandle,
    before: Option<HostNodeHandle>,
) -> DocumentReceipt {
    let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
    batch.push(DocumentOperation::InsertBefore {
        parent,
        node,
        before,
    });
    document.commit(batch).unwrap()
}

#[test]
fn mixed_nodes_attributes_state_and_sibling_order_are_preserved() {
    let mut document = HostDocument::new().unwrap();
    let owner = owner(1);
    let root = create_element(&mut document, owner, "div");
    let first_text = create_text(&mut document, owner, "앞".into());
    let child = create_element(&mut document, owner, "span");
    let last_text = create_text(&mut document, owner, "뒤".into());
    insert(&mut document, owner, HostParent::Root, root, None);
    insert(
        &mut document,
        owner,
        HostParent::Node(root),
        first_text,
        None,
    );
    insert(&mut document, owner, HostParent::Node(root), child, None);
    insert(
        &mut document,
        owner,
        HostParent::Node(root),
        last_text,
        None,
    );

    let class_name = AttributeName::new(None, "class").unwrap();
    let namespaced_attribute =
        AttributeName::new(Some("urn:spinon:test".to_owned()), "key").unwrap();
    let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
    batch.push(DocumentOperation::SetAttribute {
        node: child,
        name: class_name.clone(),
        value: "selected".into(),
    });
    batch.push(DocumentOperation::SetAttribute {
        node: child,
        name: namespaced_attribute.clone(),
        value: "qualified".into(),
    });
    batch.push(DocumentOperation::SetElementState {
        node: child,
        state: ElementState::Focus,
        enabled: true,
    });
    document.commit(batch).unwrap();

    let snapshot = document.snapshot();
    let ordered = snapshot.children(root).unwrap().collect::<Vec<_>>();
    assert_eq!(ordered, [first_text, child, last_text]);
    assert_eq!(snapshot.next_sibling(first_text), Some(child));
    assert_eq!(snapshot.previous_sibling(last_text), Some(child));
    assert_eq!(snapshot.text_content(root).unwrap(), "앞뒤".into());
    let HostNodeKind::Element(element) = snapshot.node(child).unwrap().kind() else {
        panic!("span은 요소여야 합니다");
    };
    assert_eq!(element.namespace(), HTML);
    assert_eq!(element.local_name(), "span");
    assert_eq!(
        element.attribute(&class_name),
        Some(&DomString::from("selected"))
    );
    assert_eq!(
        element.attribute(&namespaced_attribute),
        Some(&DomString::from("qualified"))
    );
    assert!(element.has_state(ElementState::Focus));
}

#[test]
fn detached_changes_and_connected_changes_advance_separate_revisions() {
    let mut document = HostDocument::new().unwrap();
    let owner = owner(2);
    let root = create_element(&mut document, owner, "div");
    assert_eq!(document.document_revision().get(), 1);
    assert_eq!(document.render_tree_revision().get(), 0);

    let connected = insert(&mut document, owner, HostParent::Root, root, None);
    assert_eq!(connected.document_revision().get(), 2);
    assert_eq!(connected.render_tree_revision().get(), 1);
    assert!(document.snapshot().is_connected(root));

    let detached = create_element(&mut document, owner, "button");
    assert_eq!(document.render_tree_revision().get(), 1);
    let inserted = insert(&mut document, owner, HostParent::Node(root), detached, None);
    assert_eq!(inserted.document_revision().get(), 4);
    assert_eq!(inserted.render_tree_revision().get(), 2);

    let removed = {
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        batch.push(DocumentOperation::RemoveChild {
            parent: HostParent::Node(root),
            node: detached,
        });
        document.commit(batch).unwrap()
    };
    assert_eq!(removed.document_revision().get(), 5);
    assert_eq!(removed.render_tree_revision().get(), 3);
    assert!(!document.snapshot().is_connected(detached));
    assert_eq!(
        document.snapshot().node(detached).unwrap().id(),
        detached.id()
    );
    let reinserted = insert(&mut document, owner, HostParent::Node(root), detached, None);
    assert_eq!(reinserted.document_revision().get(), 6);
    assert_eq!(reinserted.render_tree_revision().get(), 4);
}

#[test]
fn owner_conflict_and_cycles_reject_the_whole_batch() {
    let mut document = HostDocument::new().unwrap();
    let owner_a = owner(10);
    let owner_b = owner(20);
    let parent = create_element(&mut document, owner_a, "section");
    insert(&mut document, owner_a, HostParent::Root, parent, None);

    let child = document.reserve_node_handle().unwrap();
    let mut create = DocumentChangeBatch::new(owner_b, document.document_revision());
    create.push(DocumentOperation::CreateElement {
        node: child,
        namespace: HTML.to_owned(),
        local_name: "span".to_owned(),
    });
    document.commit(create).unwrap();
    let before = document.snapshot();
    let mut conflicting = DocumentChangeBatch::new(owner_b, document.document_revision());
    conflicting.push(DocumentOperation::InsertBefore {
        parent: HostParent::Node(parent),
        node: child,
        before: None,
    });
    assert!(matches!(
        document.commit(conflicting).unwrap_err().kind(),
        DocumentErrorKind::OwnershipConflict { .. }
    ));
    assert_eq!(document.snapshot(), before);

    let new_parent = document.reserve_node_handle().unwrap();
    let mut cycle = DocumentChangeBatch::new(owner_b, document.document_revision());
    cycle.push(DocumentOperation::CreateElement {
        node: new_parent,
        namespace: HTML.to_owned(),
        local_name: "div".to_owned(),
    });
    cycle.push(DocumentOperation::InsertBefore {
        parent: HostParent::Node(new_parent),
        node: new_parent,
        before: None,
    });
    assert!(matches!(
        document.commit(cycle).unwrap_err().kind(),
        DocumentErrorKind::Hierarchy { .. }
    ));
    assert_eq!(document.snapshot(), before);
}

#[test]
fn batches_preserve_mixed_owner_siblings_without_crossing_ownership() {
    let mut document = HostDocument::new().unwrap();
    let owner_a = owner(31);
    let owner_b = owner(32);
    let left = create_element(&mut document, owner_a, "div");
    let right = create_element(&mut document, owner_b, "div");
    insert(&mut document, owner_a, HostParent::Root, left, None);
    insert(&mut document, owner_b, HostParent::Root, right, None);
    assert_eq!(
        document.snapshot().root_children().collect::<Vec<_>>(),
        [left, right]
    );

    let local = create_element(&mut document, owner_a, "span");
    let mut cross_owner_reference = DocumentChangeBatch::new(owner_a, document.document_revision());
    cross_owner_reference.push(DocumentOperation::InsertBefore {
        parent: HostParent::Root,
        node: local,
        before: Some(right),
    });
    assert!(matches!(
        document.commit(cross_owner_reference).unwrap_err().kind(),
        DocumentErrorKind::OwnershipConflict { .. }
    ));

    let mut denied = DocumentChangeBatch::new(owner_a, document.document_revision());
    denied.push(DocumentOperation::SetAttribute {
        node: right,
        name: AttributeName::new(None, "class").unwrap(),
        value: "bad".into(),
    });
    assert!(matches!(
        document.commit(denied).unwrap_err().kind(),
        DocumentErrorKind::OwnershipConflict { .. }
    ));
}

#[test]
fn stale_generation_and_stale_revision_are_rejected() {
    let mut document = HostDocument::new().unwrap();
    let mut other = HostDocument::new().unwrap();
    let foreign = other.reserve_node_handle().unwrap();
    let retryable = document.reserve_node_handle().unwrap();

    let mut batch = DocumentChangeBatch::new(owner(5), DocumentRevision(2));
    batch.push(DocumentOperation::CreateText {
        node: retryable,
        data: "x".into(),
    });
    assert!(matches!(
        document.commit(batch).unwrap_err().kind(),
        DocumentErrorKind::StaleRevision { .. }
    ));

    let mut batch = DocumentChangeBatch::new(owner(5), document.document_revision());
    batch.push(DocumentOperation::InsertBefore {
        parent: HostParent::Root,
        node: foreign,
        before: None,
    });
    assert!(matches!(
        document.commit(batch).unwrap_err().kind(),
        DocumentErrorKind::StaleGeneration { .. }
    ));
    assert_eq!(document.document_revision().get(), 0);

    let mut retry = DocumentChangeBatch::new(owner(5), document.document_revision());
    retry.push(DocumentOperation::CreateText {
        node: retryable,
        data: "재시도".into(),
    });
    document.commit(retry).unwrap();
    assert!(matches!(
        document.snapshot().node(retryable).unwrap().kind(),
        HostNodeKind::Text(data) if data.to_string_lossy() == "재시도"
    ));
}

#[test]
fn utf16_surrogate_units_survive_text_and_text_content_reads() {
    let mut document = HostDocument::new().unwrap();
    let owner = owner(7);
    let root = create_element(&mut document, owner, "p");
    let text = create_text(&mut document, owner, DomString::from_utf16(vec![0xD800]));
    insert(&mut document, owner, HostParent::Root, root, None);
    insert(&mut document, owner, HostParent::Node(root), text, None);
    let snapshot = document.snapshot();
    let text_content = snapshot.text_content(root).unwrap();
    assert_eq!(text_content.code_units(), [0xD800]);
    assert_eq!(
        snapshot.node(text).unwrap().kind(),
        &HostNodeKind::Text(text_content)
    );
}

#[test]
fn no_op_and_empty_batches_do_not_advance_revisions() {
    let mut document = HostDocument::new().unwrap();
    let owner = owner(8);
    let node = create_element(&mut document, owner, "div");
    let first = insert(&mut document, owner, HostParent::Root, node, None);
    let same = insert(&mut document, owner, HostParent::Root, node, None);
    assert_eq!(same.document_revision(), first.document_revision());
    assert_eq!(same.render_tree_revision(), first.render_tree_revision());
    assert!(!same.changed());

    let detached_parent = create_element(&mut document, owner, "aside");
    let before = document.snapshot();
    let mut round_trip = DocumentChangeBatch::new(owner, document.document_revision());
    round_trip
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(detached_parent),
            node,
            before: None,
        })
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Root,
            node,
            before: None,
        });
    let receipt = document.commit(round_trip).unwrap();
    assert!(!receipt.changed());
    assert_eq!(document.snapshot(), before);

    let class_name = AttributeName::new(None, "class").unwrap();
    let mut revert_attribute = DocumentChangeBatch::new(owner, document.document_revision());
    revert_attribute
        .push(DocumentOperation::SetAttribute {
            node,
            name: class_name.clone(),
            value: "temporary".into(),
        })
        .push(DocumentOperation::RemoveAttribute {
            node,
            name: class_name,
        });
    let receipt = document.commit(revert_attribute).unwrap();
    assert!(!receipt.changed());
    assert_eq!(document.snapshot(), before);

    let empty = document
        .commit(DocumentChangeBatch::new(
            owner,
            document.document_revision(),
        ))
        .unwrap();
    assert!(!empty.changed());
}

#[test]
fn insert_before_uses_final_order_and_invalid_references_are_atomic() {
    let mut document = HostDocument::new().unwrap();
    let owner = owner(9);
    let root = create_element(&mut document, owner, "div");
    let first = create_element(&mut document, owner, "i");
    let second = create_element(&mut document, owner, "b");
    let third = create_element(&mut document, owner, "u");
    insert(&mut document, owner, HostParent::Root, root, None);
    insert(&mut document, owner, HostParent::Node(root), first, None);
    insert(&mut document, owner, HostParent::Node(root), second, None);
    insert(&mut document, owner, HostParent::Node(root), third, None);

    let moved = insert(
        &mut document,
        owner,
        HostParent::Node(root),
        third,
        Some(second),
    );
    assert!(moved.changed());
    assert_eq!(
        document
            .snapshot()
            .children(root)
            .unwrap()
            .collect::<Vec<_>>(),
        [first, third, second]
    );

    let same_position = insert(
        &mut document,
        owner,
        HostParent::Node(root),
        third,
        Some(second),
    );
    assert!(!same_position.changed());

    let before_itself = insert(
        &mut document,
        owner,
        HostParent::Node(root),
        third,
        Some(third),
    );
    assert!(!before_itself.changed());

    let detached = create_element(&mut document, owner, "small");
    let before = document.snapshot();
    let mut invalid = DocumentChangeBatch::new(owner, document.document_revision());
    invalid.push(DocumentOperation::InsertBefore {
        parent: HostParent::Node(root),
        node: detached,
        before: Some(root),
    });
    assert!(matches!(
        document.commit(invalid).unwrap_err().kind(),
        DocumentErrorKind::InvalidReference(_)
    ));
    assert_eq!(document.snapshot(), before);
}

#[test]
fn connected_attribute_and_state_changes_advance_render_revision_once() {
    let mut document = HostDocument::new().unwrap();
    let owner = owner(10);
    let element = create_element(&mut document, owner, "button");
    insert(&mut document, owner, HostParent::Root, element, None);
    let class_name = AttributeName::new(None, "class").unwrap();
    let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
    batch
        .push(DocumentOperation::SetAttribute {
            node: element,
            name: class_name.clone(),
            value: "on".into(),
        })
        .push(DocumentOperation::SetElementState {
            node: element,
            state: ElementState::Active,
            enabled: true,
        });
    let result = document.commit(batch).unwrap();
    assert_eq!(result.document_revision().get(), 3);
    assert_eq!(result.render_tree_revision().get(), 2);

    let mut repeat = DocumentChangeBatch::new(owner, document.document_revision());
    repeat.push(DocumentOperation::SetAttribute {
        node: element,
        name: class_name,
        value: "on".into(),
    });
    assert!(!document.commit(repeat).unwrap().changed());
    assert_eq!(document.render_tree_revision().get(), 2);
}

#[test]
fn node_id_allocator_uses_the_last_nonzero_id_then_stops() {
    let mut document = HostDocument::new().unwrap();
    document.next_node_id = Some(u64::MAX);
    let last = document.reserve_node_handle().unwrap();
    assert_eq!(last.id().get(), u64::MAX);
    assert!(matches!(
        document.reserve_node_handle().unwrap_err().kind(),
        DocumentErrorKind::NodeIdExhausted
    ));
}

#[test]
fn revision_exhaustion_never_publishes_a_partial_candidate() {
    let owner = owner(11);
    let mut document = HostDocument::new().unwrap();
    let reserved = document.reserve_node_handle().unwrap();
    document.document_revision = DocumentRevision(u64::MAX);
    let before = document.snapshot();
    let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
    batch.push(DocumentOperation::CreateElement {
        node: reserved,
        namespace: HTML.to_owned(),
        local_name: "div".to_owned(),
    });
    assert!(matches!(
        document.commit(batch).unwrap_err().kind(),
        DocumentErrorKind::RevisionExhausted
    ));
    assert_eq!(document.snapshot(), before);

    let mut render_limited = HostDocument::new().unwrap();
    let root = create_element(&mut render_limited, owner, "div");
    insert(&mut render_limited, owner, HostParent::Root, root, None);
    render_limited.render_tree_revision = RenderTreeRevision(u64::MAX);
    let before = render_limited.snapshot();
    let mut batch = DocumentChangeBatch::new(owner, render_limited.document_revision());
    batch.push(DocumentOperation::SetAttribute {
        node: root,
        name: AttributeName::new(None, "class").unwrap(),
        value: "changed".into(),
    });
    assert!(matches!(
        render_limited.commit(batch).unwrap_err().kind(),
        DocumentErrorKind::RevisionExhausted
    ));
    assert_eq!(render_limited.snapshot(), before);
}
