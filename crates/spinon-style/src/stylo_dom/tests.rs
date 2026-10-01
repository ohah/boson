use selectors::Element;
use selectors::matching::{
    MatchingContext, MatchingForInvalidation, MatchingMode, NeedsSelectorFlags, SelectorCaches,
    matches_selector_list,
};
use spinon_core::{
    AttributeName, DocumentChangeBatch, DocumentOperation, ElementState, HostDocument,
    HostNodeHandle, HostParent, OwnerId,
};
use style::{
    context::QuirksMode,
    dom::{TDocument, TElement, TNode},
    selector_parser::{SelectorImpl, SelectorParser},
    stylesheets::UrlExtraData,
};

use super::{StyloDocumentView, StyloDomError, StyloElement};

const HTML_NS: &str = "http://www.w3.org/1999/xhtml";
const XML_NS: &str = "http://www.w3.org/XML/1998/namespace";
const FOREIGN_NS: &str = "urn:spinon:foreign";

struct Fixture {
    document: HostDocument,
    owner: OwnerId,
    root: HostNodeHandle,
    text: HostNodeHandle,
    span: HostNodeHandle,
    button: HostNodeHandle,
    empty: HostNodeHandle,
    input: HostNodeHandle,
    link: HostNodeHandle,
    empty_text_element: HostNodeHandle,
    other_root: HostNodeHandle,
    detached: HostNodeHandle,
}

impl Fixture {
    fn new() -> Self {
        let mut document = HostDocument::new().unwrap();
        let owner = OwnerId::new(41).unwrap();
        let root = document.reserve_node_handle().unwrap();
        let text = document.reserve_node_handle().unwrap();
        let span = document.reserve_node_handle().unwrap();
        let button = document.reserve_node_handle().unwrap();
        let empty = document.reserve_node_handle().unwrap();
        let input = document.reserve_node_handle().unwrap();
        let link = document.reserve_node_handle().unwrap();
        let empty_text_element = document.reserve_node_handle().unwrap();
        let empty_text = document.reserve_node_handle().unwrap();
        let other_root = document.reserve_node_handle().unwrap();
        let detached = document.reserve_node_handle().unwrap();
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());

        for (node, name) in [
            (root, "main"),
            (span, "span"),
            (button, "button"),
            (empty, "i"),
            (input, "input"),
            (link, "a"),
            (empty_text_element, "em"),
            (other_root, "main"),
            (detached, "b"),
        ] {
            batch.push(DocumentOperation::CreateElement {
                node,
                namespace: if node == other_root {
                    FOREIGN_NS
                } else {
                    HTML_NS
                }
                .to_owned(),
                local_name: name.to_owned(),
            });
        }
        batch.push(DocumentOperation::CreateText {
            node: text,
            data: "오늘".into(),
        });
        batch.push(DocumentOperation::CreateText {
            node: empty_text,
            data: "".into(),
        });
        set_attribute(&mut batch, root, None, "ID", "app-root");
        set_attribute(&mut batch, root, None, "CLASS", "shell page");
        set_attribute(&mut batch, root, None, "lang", "ko-KR");
        set_attribute(&mut batch, span, None, "class", "label");
        set_attribute(&mut batch, span, None, "data-role", "title");
        set_attribute(&mut batch, span, Some(XML_NS), "lang", "ko");
        set_attribute(&mut batch, button, None, "class", "primary action");
        set_attribute(&mut batch, button, None, "DATA-ROLE", "action");
        set_attribute(&mut batch, button, None, "disabled", "");
        set_attribute(&mut batch, input, None, "type", "checkbox");
        set_attribute(&mut batch, link, None, "href", "/docs");
        batch.push(DocumentOperation::SetElementState {
            node: button,
            state: ElementState::Disabled,
            enabled: true,
        });
        batch.push(DocumentOperation::SetElementState {
            node: span,
            state: ElementState::Focus,
            enabled: true,
        });
        batch.push(DocumentOperation::SetElementState {
            node: span,
            state: ElementState::Hover,
            enabled: true,
        });
        batch.push(DocumentOperation::SetElementState {
            node: span,
            state: ElementState::FocusVisible,
            enabled: true,
        });
        batch.push(DocumentOperation::SetElementState {
            node: input,
            state: ElementState::Checked,
            enabled: true,
        });
        batch.push(DocumentOperation::SetElementState {
            node: link,
            state: ElementState::Active,
            enabled: true,
        });
        for (parent, node) in [
            (HostParent::Root, root),
            (HostParent::Root, other_root),
            (HostParent::Node(root), text),
            (HostParent::Node(root), span),
            (HostParent::Node(root), button),
            (HostParent::Node(root), empty),
            (HostParent::Node(root), input),
            (HostParent::Node(root), link),
            (HostParent::Node(root), empty_text_element),
            (HostParent::Node(empty_text_element), empty_text),
        ] {
            batch.push(DocumentOperation::InsertBefore {
                parent,
                node,
                before: None,
            });
        }
        document.commit(batch).unwrap();

        Self {
            document,
            owner,
            root,
            text,
            span,
            button,
            empty,
            input,
            link,
            empty_text_element,
            other_root,
            detached,
        }
    }

    fn view(&self) -> StyloDocumentView {
        StyloDocumentView::new(
            self.document.snapshot(),
            self.root,
            true,
            QuirksMode::NoQuirks,
        )
        .unwrap()
    }
}

fn set_attribute(
    batch: &mut DocumentChangeBatch,
    node: HostNodeHandle,
    namespace: Option<&str>,
    local_name: &str,
    value: &str,
) {
    batch.push(DocumentOperation::SetAttribute {
        node,
        name: AttributeName::new(namespace.map(str::to_owned), local_name).unwrap(),
        value: value.into(),
    });
}

fn matches(element: StyloElement<'_>, selector: &str) -> bool {
    let url_data = UrlExtraData::from(url::Url::parse("https://spinon.invalid/").unwrap());
    let list = SelectorParser::parse_author_origin_no_namespace(selector, &url_data).unwrap();
    let mut caches = SelectorCaches::default();
    let mut context = MatchingContext::<SelectorImpl>::new(
        MatchingMode::Normal,
        None,
        &mut caches,
        element.view.quirks_mode(),
        NeedsSelectorFlags::Yes,
        MatchingForInvalidation::No,
    );
    matches_selector_list(&list, &element, &mut context)
}

#[test]
fn document_and_mixed_node_traversal_expose_only_the_selected_root_subtree() {
    let fixture = Fixture::new();
    let view = fixture.view();
    let document = view.document();
    let document_node = document.as_node();
    let root = view.root_element();
    let root_node = root.as_node();
    let first_child = root_node.first_child().unwrap();
    let span_node = view.node(fixture.span).unwrap();

    assert_eq!(
        view.document_revision(),
        fixture.document.document_revision()
    );
    assert!(document.is_html_document());
    assert_eq!(document.document_element(), root);
    assert!(document_node.is_in_document());
    assert_eq!(document_node.first_child(), Some(root_node));
    assert_eq!(document_node.last_child(), Some(root_node));
    assert_eq!(root_node.parent_node(), Some(document_node));
    assert_eq!(first_child.handle(), Some(fixture.text));
    assert_eq!(first_child.next_sibling(), Some(span_node));
    assert_eq!(
        span_node.prev_sibling().unwrap().handle(),
        Some(fixture.text)
    );
    assert_eq!(
        span_node.next_sibling().unwrap().handle(),
        Some(fixture.button)
    );
    assert!(view.node(fixture.other_root).is_none());
    assert!(view.node(fixture.detached).is_none());
    assert!(root.is_root());
    assert!(!view.element(fixture.span).unwrap().is_root());
}

#[test]
fn html_like_local_name_in_a_foreign_namespace_is_not_an_html_element() {
    let fixture = Fixture::new();
    let view = StyloDocumentView::new(
        fixture.document.snapshot(),
        fixture.other_root,
        true,
        QuirksMode::NoQuirks,
    )
    .unwrap();

    assert!(!view.root_element().is_html_element());
}

#[test]
fn stylo_selector_parser_matches_attributes_states_structure_and_ancestors() {
    let fixture = Fixture::new();
    let view = fixture.view();
    let root = view.root_element();
    let span = view.element(fixture.span).unwrap();
    let button = view.element(fixture.button).unwrap();
    let empty = view.element(fixture.empty).unwrap();
    let input = view.element(fixture.input).unwrap();
    let link = view.element(fixture.link).unwrap();
    let empty_text_element = view.element(fixture.empty_text_element).unwrap();

    assert!(matches(root, "MAIN#app-root.shell.page:root[lang|=ko]"));
    assert!(!matches(root, ".SHELL"));
    assert!(matches(
        span,
        "main > span.label[data-role=title]:focus:hover:focus-visible"
    ));
    assert!(matches(
        button,
        "main > span + button.primary.action:disabled"
    ));
    assert!(matches(button, "main:lang(ko) button[data-role=action]"));
    assert!(button.match_element_lang(None, &"ko".into()));
    assert!(matches(empty, "i:empty"));
    assert!(matches(empty_text_element, "em:empty"));
    assert!(matches(input, "input:checked"));
    assert!(matches(link, "a:any-link"));
    assert!(matches(link, "a:link"));
    assert!(matches(link, "a:active"));
    assert!(matches(root, "main:focus-within"));
    assert!(!matches(root, "aside:root"));
    assert!(!matches(button, "button:visited"));
}

#[test]
fn snapshot_updates_are_visible_only_in_a_new_view() {
    let mut fixture = Fixture::new();
    let old_view = fixture.view();
    let old_root = old_view.root_element();
    let mut update = DocumentChangeBatch::new(fixture.owner, fixture.document.document_revision());
    set_attribute(&mut update, fixture.root, None, "CLASS", "updated");
    fixture.document.commit(update).unwrap();
    let new_view = fixture.view();

    assert!(matches(old_root, ".shell"));
    assert!(!matches(old_root, ".updated"));
    assert!(matches(new_view.root_element(), ".updated"));
    assert_ne!(old_view.document_revision(), new_view.document_revision());
}

#[test]
fn malformed_utf16_is_lossy_at_the_stylo_attribute_boundary() {
    let mut fixture = Fixture::new();
    let mut update = DocumentChangeBatch::new(fixture.owner, fixture.document.document_revision());
    update.push(DocumentOperation::SetAttribute {
        node: fixture.span,
        name: AttributeName::new(None, "data-bad").unwrap(),
        value: spinon_core::DomString::from_utf16(vec![0xD800]),
    });
    fixture.document.commit(update).unwrap();
    let view = fixture.view();
    let span = view.element(fixture.span).unwrap();

    assert_eq!(
        span.get_attr(&"data-bad".into(), &"".into()),
        Some("�".to_owned())
    );
    assert!(matches(span, "[data-bad='�']"));
}

#[test]
fn invalid_roots_and_foreign_generations_are_rejected_or_hidden() {
    let fixture = Fixture::new();
    let snapshot = fixture.document.snapshot();
    assert!(matches!(
        StyloDocumentView::new(
            snapshot.clone(),
            fixture.detached,
            true,
            QuirksMode::NoQuirks,
        ),
        Err(StyloDomError::InvalidRoot)
    ));

    let mut other_document = HostDocument::new().unwrap();
    let foreign = other_document.reserve_node_handle().unwrap();
    let mut create = DocumentChangeBatch::new(
        OwnerId::new(92).unwrap(),
        other_document.document_revision(),
    );
    create.push(DocumentOperation::CreateElement {
        node: foreign,
        namespace: HTML_NS.to_owned(),
        local_name: "main".to_owned(),
    });
    other_document.commit(create).unwrap();
    assert!(StyloDocumentView::new(snapshot, foreign, true, QuirksMode::NoQuirks,).is_err());
    assert!(fixture.view().node(foreign).is_none());
    assert!(fixture.view().element(foreign).is_none());
}

#[test]
fn html_attribute_aliases_are_rejected_and_quirks_mode_is_forwarded() {
    let mut invalid_fixture = Fixture::new();
    let mut ambiguous = DocumentChangeBatch::new(
        invalid_fixture.owner,
        invalid_fixture.document.document_revision(),
    );
    set_attribute(
        &mut ambiguous,
        invalid_fixture.root,
        None,
        "id",
        "second-id",
    );
    invalid_fixture.document.commit(ambiguous).unwrap();
    assert!(matches!(
        StyloDocumentView::new(
            invalid_fixture.document.snapshot(),
            invalid_fixture.root,
            true,
            QuirksMode::NoQuirks,
        ),
        Err(StyloDomError::AmbiguousHtmlAttributeNames { node })
            if node == invalid_fixture.root.id()
    ));

    let fixture = Fixture::new();
    let no_quirks = fixture.view();
    let quirks = StyloDocumentView::new(
        fixture.document.snapshot(),
        fixture.root,
        true,
        QuirksMode::Quirks,
    )
    .unwrap();
    assert!(!matches(no_quirks.root_element(), ".SHELL"));
    assert!(matches(quirks.root_element(), ".SHELL"));
}
