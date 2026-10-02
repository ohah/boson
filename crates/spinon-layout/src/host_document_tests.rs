use std::collections::BTreeMap;

use spinon_core::{
    ChangeBatch, DocumentChangeBatch, DocumentOperation, HostDocument, HostNodeHandle, HostParent,
    NodeId, Operation, OwnerId, Tree,
};

use crate::{
    FlexDirection, LayoutDimension, LayoutEdges, LayoutEngine, LayoutError, LayoutFrame, LayoutGap,
    LayoutInput, LayoutSourceRevision, LayoutStyle, TaffyLayoutEngine, Viewport,
};

const HTML: &str = "http://www.w3.org/1999/xhtml";

fn node_id(value: u64) -> NodeId {
    NodeId::new(value).unwrap()
}

fn styles() -> BTreeMap<NodeId, LayoutStyle> {
    BTreeMap::from([
        (
            node_id(1),
            LayoutStyle {
                width: LayoutDimension::Fixed(100.0),
                height: LayoutDimension::Fixed(80.0),
                flex_direction: FlexDirection::Row,
                padding: LayoutEdges {
                    top: 2.0,
                    right: 3.0,
                    bottom: 4.0,
                    left: 5.0,
                },
                gap: LayoutGap {
                    row: 1.0,
                    column: 7.0,
                },
                ..LayoutStyle::default()
            },
        ),
        (
            node_id(2),
            LayoutStyle {
                width: LayoutDimension::Fixed(20.0),
                height: LayoutDimension::Fixed(20.0),
                ..LayoutStyle::default()
            },
        ),
        (
            node_id(3),
            LayoutStyle {
                width: LayoutDimension::Fixed(30.0),
                height: LayoutDimension::Fixed(20.0),
                ..LayoutStyle::default()
            },
        ),
    ])
}

fn host_document_fixture(with_text: bool) -> (HostDocument, HostNodeHandle, HostNodeHandle) {
    let mut document = HostDocument::new().unwrap();
    let owner = OwnerId::new(1).unwrap();
    let root = document.reserve_node_handle().unwrap();
    let second = document.reserve_node_handle().unwrap();
    let first = document.reserve_node_handle().unwrap();
    let text = with_text.then(|| document.reserve_node_handle().unwrap());

    let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
    batch
        .push(DocumentOperation::CreateElement {
            node: root,
            namespace: HTML.to_owned(),
            local_name: "div".to_owned(),
        })
        .push(DocumentOperation::CreateElement {
            node: second,
            namespace: HTML.to_owned(),
            local_name: "span".to_owned(),
        })
        .push(DocumentOperation::CreateElement {
            node: first,
            namespace: HTML.to_owned(),
            local_name: "span".to_owned(),
        })
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Root,
            node: root,
            before: None,
        })
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(root),
            node: first,
            before: None,
        })
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(root),
            node: second,
            before: None,
        });
    if let Some(text) = text {
        batch.push(DocumentOperation::CreateText {
            node: text,
            data: "text".into(),
        });
        batch.push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(root),
            node: text,
            before: None,
        });
    }
    document.commit(batch).unwrap();
    (document, root, first)
}

fn legacy_tree_fixture() -> Tree {
    let mut tree = Tree::new();
    let mut batch = ChangeBatch::new(tree.revision());
    batch
        .push(Operation::Create {
            id: node_id(1),
            tag: "div".to_owned(),
        })
        .push(Operation::Insert {
            id: node_id(1),
            parent: None,
            index: 0,
        })
        .push(Operation::Create {
            id: node_id(3),
            tag: "span".to_owned(),
        })
        .push(Operation::Insert {
            id: node_id(3),
            parent: Some(node_id(1)),
            index: 0,
        })
        .push(Operation::Create {
            id: node_id(2),
            tag: "span".to_owned(),
        })
        .push(Operation::Insert {
            id: node_id(2),
            parent: Some(node_id(1)),
            index: 1,
        });
    tree.commit(batch).unwrap();
    tree
}

fn viewport() -> Viewport {
    Viewport {
        width: 100.0,
        height: 80.0,
    }
}

#[test]
fn host_document_projection_matches_legacy_tree_and_taffy_frames() {
    let (document, root, _) = host_document_fixture(false);
    let styles = styles();
    let host_input =
        LayoutInput::from_host_document(&document.snapshot(), root, viewport(), &styles).unwrap();
    let tree = legacy_tree_fixture();
    let tree_input = LayoutInput::from_tree(&tree, viewport(), &styles).unwrap();

    assert_eq!(host_input.root(), tree_input.root());
    assert_eq!(host_input.nodes(), tree_input.nodes());
    assert_eq!(
        host_input.source_revision(),
        LayoutSourceRevision::HostDocument {
            generation: document.generation(),
            document: document.document_revision(),
            render_tree: document.render_tree_revision(),
        }
    );

    let host_output = TaffyLayoutEngine.compute(&host_input).unwrap();
    let tree_output = TaffyLayoutEngine.compute(&tree_input).unwrap();
    assert_eq!(host_output.frames, tree_output.frames);
    assert_eq!(host_output.source_revision, host_input.source_revision());
    assert_eq!(
        host_output.frames[&node_id(1)],
        LayoutFrame {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 80.0,
        }
    );
    assert_eq!(
        host_output.frames[&node_id(3)],
        LayoutFrame {
            x: 5.0,
            y: 2.0,
            width: 30.0,
            height: 20.0,
        }
    );
    assert_eq!(
        host_output.frames[&node_id(2)],
        LayoutFrame {
            x: 42.0,
            y: 2.0,
            width: 20.0,
            height: 20.0,
        }
    );
}

#[test]
fn display_box_sizing_and_flex_shrink_reach_taffy() {
    let (document, root, first) = host_document_fixture(false);
    let snapshot = document.snapshot();
    let children = snapshot.children(root).unwrap().collect::<Vec<_>>();
    let second = children[1];
    let mut styles = styles();
    let first_style = styles.get_mut(&first.id()).unwrap();
    first_style.display = crate::LayoutDisplay::Block;
    first_style.box_sizing = crate::LayoutBoxSizing::ContentBox;
    first_style.width = crate::LayoutDimension::Fixed(20.0);
    first_style.height = crate::LayoutDimension::Fixed(20.0);
    first_style.padding.left = 5.0;
    let second_style = styles.get_mut(&second.id()).unwrap();
    second_style.display = crate::LayoutDisplay::None;

    let input = LayoutInput::from_host_document(&snapshot, root, viewport(), &styles).unwrap();
    let output = TaffyLayoutEngine.compute(&input).unwrap();
    assert_eq!(output.frames[&first.id()].width, 25.0);
    assert_eq!(output.frames[&first.id()].height, 20.0);
    assert_eq!(output.frames[&second.id()].width, 0.0);
    assert_eq!(output.frames[&second.id()].height, 0.0);

    let root = node_id(1);
    let first = node_id(2);
    let second = node_id(3);
    let tree = Tree::new();
    let mut batch = ChangeBatch::new(tree.revision());
    batch
        .push(Operation::Create {
            id: root,
            tag: "div".to_owned(),
        })
        .push(Operation::Insert {
            id: root,
            parent: None,
            index: 0,
        })
        .push(Operation::Create {
            id: first,
            tag: "div".to_owned(),
        })
        .push(Operation::Insert {
            id: first,
            parent: Some(root),
            index: 0,
        })
        .push(Operation::Create {
            id: second,
            tag: "div".to_owned(),
        })
        .push(Operation::Insert {
            id: second,
            parent: Some(root),
            index: 1,
        });
    let mut tree = tree;
    tree.commit(batch).unwrap();
    let shrink_styles = BTreeMap::from([
        (
            root,
            LayoutStyle {
                width: LayoutDimension::Fixed(100.0),
                height: LayoutDimension::Fixed(80.0),
                flex_direction: FlexDirection::Row,
                ..LayoutStyle::default()
            },
        ),
        (
            first,
            LayoutStyle {
                width: LayoutDimension::Fixed(70.0),
                height: LayoutDimension::Fixed(20.0),
                flex_shrink: 1.0,
                ..LayoutStyle::default()
            },
        ),
        (
            second,
            LayoutStyle {
                width: LayoutDimension::Fixed(70.0),
                height: LayoutDimension::Fixed(20.0),
                flex_shrink: 1.0,
                ..LayoutStyle::default()
            },
        ),
    ]);
    let input = LayoutInput::from_tree(
        &tree,
        Viewport {
            width: 100.0,
            height: 80.0,
        },
        &shrink_styles,
    )
    .unwrap();
    let output = TaffyLayoutEngine.compute(&input).unwrap();
    assert_eq!(output.frames[&first].width, 50.0);
    assert_eq!(output.frames[&second].width, 50.0);
}

#[test]
fn host_document_input_preserves_distinct_document_and_render_revisions() {
    let (mut document, root, _) = host_document_fixture(false);
    let owner = OwnerId::new(1).unwrap();
    let detached = document.reserve_node_handle().unwrap();
    let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
    batch.push(DocumentOperation::CreateElement {
        node: detached,
        namespace: HTML.to_owned(),
        local_name: "aside".to_owned(),
    });
    document.commit(batch).unwrap();

    assert_ne!(
        document.document_revision().get(),
        document.render_tree_revision().get()
    );
    let mut styles = styles();
    let input =
        LayoutInput::from_host_document(&document.snapshot(), root, viewport(), &styles).unwrap();
    assert_eq!(
        input.source_revision(),
        LayoutSourceRevision::HostDocument {
            generation: document.generation(),
            document: document.document_revision(),
            render_tree: document.render_tree_revision(),
        }
    );

    styles.insert(detached.id(), LayoutStyle::default());
    assert_eq!(
        LayoutInput::from_host_document(&document.snapshot(), root, viewport(), &styles),
        Err(LayoutError::UnknownStyleNode(detached.id()))
    );
}

#[test]
fn host_document_input_rejects_missing_styles_text_and_non_root_elements() {
    let (document, root, child) = host_document_fixture(false);
    let mut incomplete = styles();
    incomplete.remove(&child.id());
    assert_eq!(
        LayoutInput::from_host_document(&document.snapshot(), root, viewport(), &incomplete),
        Err(LayoutError::MissingStyle(child.id()))
    );
    assert_eq!(
        LayoutInput::from_host_document(&document.snapshot(), child, viewport(), &styles()),
        Err(LayoutError::InvalidHostDocumentRoot(child.id()))
    );

    let (foreign_document, foreign_root, _) = host_document_fixture(false);
    let current_input =
        LayoutInput::from_host_document(&document.snapshot(), root, viewport(), &styles()).unwrap();
    let foreign_input = LayoutInput::from_host_document(
        &foreign_document.snapshot(),
        foreign_root,
        viewport(),
        &styles(),
    )
    .unwrap();
    assert_ne!(
        current_input.source_revision(),
        foreign_input.source_revision()
    );
    assert_eq!(
        LayoutInput::from_host_document(&document.snapshot(), foreign_root, viewport(), &styles()),
        Err(LayoutError::InvalidHostDocumentRoot(root.id()))
    );

    let mut detached_document = HostDocument::new().unwrap();
    let owner = OwnerId::new(2).unwrap();
    let detached = detached_document.reserve_node_handle().unwrap();
    let mut batch = DocumentChangeBatch::new(owner, detached_document.document_revision());
    batch.push(DocumentOperation::CreateElement {
        node: detached,
        namespace: HTML.to_owned(),
        local_name: "aside".to_owned(),
    });
    detached_document.commit(batch).unwrap();
    assert_eq!(
        LayoutInput::from_host_document(
            &detached_document.snapshot(),
            detached,
            viewport(),
            &BTreeMap::from([(detached.id(), LayoutStyle::default())]),
        ),
        Err(LayoutError::InvalidHostDocumentRoot(detached.id()))
    );

    let (document, root, _) = host_document_fixture(true);
    let text_id = NodeId::new(4).unwrap();
    assert_eq!(
        LayoutInput::from_host_document(&document.snapshot(), root, viewport(), &styles()),
        Err(LayoutError::UnsupportedTextNode(text_id))
    );
}
