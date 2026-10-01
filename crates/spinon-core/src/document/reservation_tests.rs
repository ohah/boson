use super::{
    DocumentChangeBatch, DocumentErrorKind, DocumentOperation, HostDocument, HostNodeKind, OwnerId,
};

fn owner() -> OwnerId {
    OwnerId::new(1).unwrap()
}

#[test]
fn reserved_handle_is_not_a_node_until_creation_commits() {
    let mut document = HostDocument::new().unwrap();
    let before = document.snapshot();
    let handle = document.reserve_node_handle().unwrap();

    assert_eq!(document.snapshot(), before);
    assert_eq!(document.document_revision().get(), 0);
    assert_eq!(document.render_tree_revision().get(), 0);
    assert!(document.snapshot().node(handle).is_none());

    let mut batch = DocumentChangeBatch::new(owner(), document.document_revision());
    batch.push(DocumentOperation::CreateElement {
        node: handle,
        namespace: "http://www.w3.org/1999/xhtml".to_owned(),
        local_name: "div".to_owned(),
    });
    document.commit(batch).unwrap();

    let snapshot = document.snapshot();
    assert!(matches!(
        snapshot.node(handle).unwrap().kind(),
        HostNodeKind::Element(element)
            if element.namespace() == "http://www.w3.org/1999/xhtml"
                && element.local_name() == "div"
    ));
    assert_eq!(snapshot.parent(handle), None);
    assert!(!snapshot.is_connected(handle));
    assert_eq!(document.document_revision().get(), 1);
    assert_eq!(document.render_tree_revision().get(), 0);
}

#[test]
fn canceled_reservation_is_not_reused_or_created() {
    let mut document = HostDocument::new().unwrap();
    let mut foreign_document = HostDocument::new().unwrap();
    let canceled = document.reserve_node_handle().unwrap();
    let foreign = foreign_document.reserve_node_handle().unwrap();

    assert!(matches!(
        document
            .cancel_node_handle_reservation(foreign)
            .unwrap_err()
            .kind(),
        DocumentErrorKind::StaleGeneration { .. }
    ));
    assert!(
        foreign_document
            .cancel_node_handle_reservation(foreign)
            .unwrap()
    );

    assert!(document.cancel_node_handle_reservation(canceled).unwrap());
    assert!(!document.cancel_node_handle_reservation(canceled).unwrap());
    assert_eq!(document.document_revision().get(), 0);
    assert_eq!(document.render_tree_revision().get(), 0);

    let next = document.reserve_node_handle().unwrap();
    assert!(next.id() > canceled.id());

    let mut batch = DocumentChangeBatch::new(owner(), document.document_revision());
    batch.push(DocumentOperation::CreateElement {
        node: canceled,
        namespace: "http://www.w3.org/1999/xhtml".to_owned(),
        local_name: "div".to_owned(),
    });
    assert!(matches!(
        document.commit(batch).unwrap_err().kind(),
        DocumentErrorKind::UnreservedNodeId(_)
    ));
    assert_eq!(document.document_revision().get(), 0);
}
