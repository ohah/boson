use std::{collections::BTreeMap, fs, path::PathBuf};

use serde_json::Value;
use spinon_core::{
    AttributeName, DocumentChangeBatch, DocumentOperation, HostDocument, HostParent, OwnerId,
};

use super::{CssCascadeError, CssViewport, compute_basic_cascade};
use crate::stylo_dom::StyloDocumentView;
use crate::{CssOrigin, StylesheetSource};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/c04/cascade-input.v1.json"
);
const REFERENCE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/references/chromium-darwin-arm64-25.5.0-macos-26.5.1-154.0.8037.95-c04-cascade-v1-cb1e77476585-29b38ffc9b17-0e231fc4dc01-0cf4a1587190-affc6715a14a/computed-styles.json"
);

struct Fixture {
    tree: Value,
    view: StyloDocumentView,
    node_by_fixture_id: BTreeMap<String, spinon_core::NodeId>,
    author_stylesheets: Vec<StylesheetSource>,
}

impl Fixture {
    fn load() -> Self {
        let fixture: Value =
            serde_json::from_str(&fs::read_to_string(FIXTURE_PATH).unwrap()).unwrap();
        assert_eq!(fixture["schema"], "spinon-css-c04-cascade-fixture/v1");
        let mut document = HostDocument::new().unwrap();
        let owner = OwnerId::new(504).unwrap();
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        let mut node_by_fixture_id = BTreeMap::new();
        let root = create_element_tree(
            &mut document,
            &mut batch,
            &fixture["tree"],
            None,
            &mut node_by_fixture_id,
        );
        document.commit(batch).unwrap();

        let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let author_stylesheets = fixture["authorStylesheets"]
            .as_array()
            .unwrap()
            .iter()
            .map(|stylesheet| {
                let css_path = repository_root
                    .join("tests/fixtures/css/c04")
                    .join(stylesheet["source"].as_str().unwrap());
                StylesheetSource {
                    id: stylesheet["id"].as_str().unwrap().to_owned(),
                    base_url: stylesheet["baseUrl"].as_str().unwrap().to_owned(),
                    origin: CssOrigin::Author,
                    css: fs::read_to_string(css_path).unwrap(),
                }
            })
            .collect();
        let base_url = fixture["documentBaseUrl"].as_str().unwrap();
        let view = StyloDocumentView::new_with_base_url(
            document.snapshot(),
            root,
            true,
            style::context::QuirksMode::NoQuirks,
            base_url,
        )
        .unwrap();

        Self {
            tree: fixture,
            view,
            node_by_fixture_id,
            author_stylesheets,
        }
    }

    fn computed(&self) -> super::ComputedStyleSnapshot {
        let viewport = &self.tree["viewport"];
        let dimensions = CssViewport {
            width_css_px: viewport["widthCssPx"].as_f64().unwrap() as f32,
            height_css_px: viewport["heightCssPx"].as_f64().unwrap() as f32,
            device_scale_factor: viewport["deviceScaleFactor"].as_f64().unwrap() as f32,
            environment_revision: Default::default(),
        };
        compute_basic_cascade(&self.view, &self.author_stylesheets, dimensions).unwrap()
    }

    fn property<'a>(
        &self,
        snapshot: &'a super::ComputedStyleSnapshot,
        fixture_id: &str,
        property: &str,
    ) -> &'a str {
        let node_id = self.node_by_fixture_id[fixture_id];
        snapshot
            .elements
            .iter()
            .find(|style| style.node_id == node_id)
            .unwrap()
            .properties
            .get(property)
            .unwrap()
    }
}

fn create_element_tree(
    document: &mut HostDocument,
    batch: &mut DocumentChangeBatch,
    input: &Value,
    parent: Option<spinon_core::HostNodeHandle>,
    node_by_fixture_id: &mut BTreeMap<String, spinon_core::NodeId>,
) -> spinon_core::HostNodeHandle {
    let handle = document.reserve_node_handle().unwrap();
    batch.push(DocumentOperation::CreateElement {
        node: handle,
        namespace: "http://www.w3.org/1999/xhtml".to_owned(),
        local_name: input["tag"].as_str().unwrap().to_owned(),
    });
    let fixture_id = input["fixtureId"].as_str().unwrap();
    assert!(
        node_by_fixture_id
            .insert(fixture_id.to_owned(), handle.id())
            .is_none(),
        "fixtureId는 tree 전체에서 고유해야 합니다"
    );
    set_attribute(batch, handle, "data-c04-fixture-id", fixture_id);
    for (name, value) in input["attributes"].as_object().unwrap() {
        set_attribute(batch, handle, name, value.as_str().unwrap());
    }
    batch.push(DocumentOperation::InsertBefore {
        parent: parent.map_or(HostParent::Root, HostParent::Node),
        node: handle,
        before: None,
    });
    if let Some(children) = input["children"].as_array() {
        for child in children {
            create_element_tree(document, batch, child, Some(handle), node_by_fixture_id);
        }
    }
    handle
}

fn set_attribute(
    batch: &mut DocumentChangeBatch,
    node: spinon_core::HostNodeHandle,
    name: &str,
    value: &str,
) {
    batch.push(DocumentOperation::SetAttribute {
        node,
        name: AttributeName::new(None, name).unwrap(),
        value: value.into(),
    });
}

#[test]
fn fixed_fixture_computes_origin_specificity_order_inline_and_inheritance() {
    let fixture = Fixture::load();
    let computed = fixture.computed();

    assert_eq!(
        fixture.property(&computed, "ua-default", "display"),
        "block"
    );
    assert_eq!(
        fixture.property(&computed, "author-vs-ua", "display"),
        "inline"
    );
    assert_eq!(
        fixture.property(&computed, "specificity", "color"),
        "rgb(0, 0, 255)"
    );
    assert_eq!(
        fixture.property(&computed, "source-order", "color"),
        "rgb(0, 0, 255)"
    );
    assert_eq!(
        fixture.property(&computed, "important", "color"),
        "rgb(255, 0, 0)"
    );
    assert_eq!(
        fixture.property(&computed, "inline", "color"),
        "rgb(0, 128, 0)"
    );
    assert_eq!(
        fixture.property(&computed, "inline-important", "color"),
        "rgb(0, 128, 0)"
    );
    assert_eq!(
        fixture.property(&computed, "invalid-inline", "color"),
        "rgb(1, 2, 3)"
    );
    assert_eq!(
        fixture.property(&computed, "inherit", "color"),
        "rgb(9, 17, 25)"
    );
    assert_eq!(
        fixture.property(&computed, "unset-inherited", "color"),
        "rgb(9, 17, 25)"
    );
    assert_eq!(
        fixture.property(&computed, "initial", "color"),
        "rgb(0, 0, 0)"
    );
    assert_eq!(
        fixture.property(&computed, "unset-non-inherited", "display"),
        "inline"
    );
    assert_eq!(
        fixture.property(&computed, "media", "color"),
        "rgb(0, 0, 255)"
    );
    assert_eq!(fixture.property(&computed, "margin", "margin-top"), "3px");
    assert_eq!(fixture.property(&computed, "margin", "font-weight"), "700");
    assert_eq!(fixture.property(&computed, "scope", "font-size"), "18px");
    let invalid_inline_node = fixture.node_by_fixture_id["invalid-inline"];
    assert_eq!(computed.diagnostics.len(), 1);
    assert_eq!(computed.diagnostics[0].node_id, Some(invalid_inline_node));
    assert_eq!(
        computed.diagnostics[0].source_id,
        format!("inline:{invalid_inline_node}")
    );
    assert_eq!(computed.diagnostics[0].diagnostic.line, 0);
    assert!(computed.diagnostics[0].diagnostic.column > 0);
    assert!(!computed.diagnostics[0].diagnostic.message.is_empty());
}

#[test]
fn every_observed_property_matches_the_pinned_chromium_reference() {
    let fixture = Fixture::load();
    let computed = fixture.computed();
    let reference: Value =
        serde_json::from_str(&fs::read_to_string(REFERENCE_PATH).unwrap()).unwrap();
    assert_eq!(reference["schema"], "spinon-css-c04-cascade-reference/v1");
    assert_eq!(
        reference["capture"]["sha256"],
        "0e231fc4dc017c9d41186d9b29c96a7dc3c8fffeaaf77b417f446297310814b7"
    );
    assert_eq!(
        reference["referenceId"],
        "chromium-darwin-arm64-25.5.0-macos-26.5.1-154.0.8037.95-c04-cascade-v1-cb1e77476585-29b38ffc9b17-0e231fc4dc01-0cf4a1587190-affc6715a14a"
    );
    assert_eq!(
        reference["fixture"]["sha256"],
        "cb1e774765851d6a51fd0fb41c99c3f888cb882921dde72fc26363853f0a79d1"
    );
    assert_eq!(reference["stylesheets"].as_array().unwrap().len(), 2);
    assert_eq!(
        reference["stylesheets"][0]["sha256"],
        "3d62f1417ecc609f9ad352c5f9ea09d9ffa9b96dfa8701814a2a84279219fdd1"
    );
    assert_eq!(
        reference["stylesheets"][1]["sha256"],
        "f8b39475d9d1f8edb53241a56ac614e3867089c2a5af8b836115064efb7b8815"
    );
    assert_eq!(reference["browser"]["version"], "Chrome/154.0.8037.95");
    assert_eq!(
        reference["browser"]["sha256"],
        "affc6715a14a423f5207014ae4b86ddad028e70b04b13572d60d35d8ac728f91"
    );
    assert_eq!(
        reference["browser"]["revision"],
        "@05d469856e75794131cc2e5d9b2f6b6f10a70388"
    );
    assert_eq!(reference["viewport"]["widthCssPx"], 800);
    assert_eq!(reference["viewport"]["heightCssPx"], 600);
    assert_eq!(reference["viewport"]["deviceScaleFactor"], 1);
    assert_eq!(reference["viewport"]["locale"], "en-US");
    assert_eq!(reference["viewport"]["timeZone"], "UTC");
    assert!(reference["viewport"]["screenMedia"].as_bool().unwrap());
    assert!(reference["viewport"]["lightColorScheme"].as_bool().unwrap());
    assert_eq!(fixture.tree["viewport"]["mediaType"], "screen");
    assert_eq!(fixture.tree["viewport"]["colorScheme"], "light");
    assert_eq!(
        reference["capture"]["operatingSystem"]["platform"],
        "darwin"
    );
    assert_eq!(
        reference["capture"]["operatingSystem"]["architecture"],
        "arm64"
    );
    assert_eq!(
        reference["capture"]["operatingSystem"]["productVersion"],
        "26.5.1"
    );
    assert_eq!(
        reference["capture"]["operatingSystem"]["buildVersion"],
        "25F80"
    );
    assert_eq!(reference["capture"]["networkMode"], "offline");
    assert!(
        !reference["capture"]["operatingSystem"]["release"]
            .as_str()
            .unwrap()
            .is_empty()
    );

    let reference_observations = reference["observations"].as_array().unwrap();
    assert_eq!(
        reference_observations.len(),
        fixture.tree["observations"].as_array().unwrap().len()
    );
    assert_eq!(computed.elements.len(), reference_observations.len());
    for (index, observation) in reference_observations.iter().enumerate() {
        let fixture_id = observation["fixtureId"].as_str().unwrap();
        assert_eq!(
            fixture.tree["observations"][index].as_str().unwrap(),
            fixture_id,
            "reference 관찰 순서가 fixture와 다릅니다"
        );
        assert_eq!(
            computed.elements[index].node_id, fixture.node_by_fixture_id[fixture_id],
            "computed preorder가 fixture tree 순서와 다릅니다"
        );
        assert_eq!(
            computed.elements[index].properties.len(),
            fixture.tree["properties"].as_array().unwrap().len(),
            "whitelist 밖 computed property가 포함됐거나 속성이 누락됐습니다"
        );
        for property in fixture.tree["properties"].as_array().unwrap() {
            let property = property.as_str().unwrap();
            assert_eq!(
                fixture.property(&computed, fixture_id, property),
                observation["properties"][property].as_str().unwrap(),
                "{fixture_id}.{property}"
            );
        }
    }
    assert_eq!(
        computed.document_revision,
        fixture.view.document_revision(),
        "cascade 결과가 입력 document revision에 고정되어야 합니다"
    );
    assert_eq!(
        computed.render_tree_revision,
        fixture.view.render_tree_revision(),
        "cascade 결과가 입력 render-tree revision에 고정되어야 합니다"
    );
}

#[test]
fn invalid_viewport_and_non_author_inputs_fail_before_computation() {
    let fixture = Fixture::load();
    for invalid_viewport in [
        CssViewport {
            width_css_px: f32::NAN,
            ..CssViewport::C04_FIXTURE
        },
        CssViewport {
            width_css_px: 0.0,
            ..CssViewport::C04_FIXTURE
        },
        CssViewport {
            height_css_px: f32::INFINITY,
            ..CssViewport::C04_FIXTURE
        },
        CssViewport {
            height_css_px: -1.0,
            ..CssViewport::C04_FIXTURE
        },
        CssViewport {
            device_scale_factor: 0.0,
            ..CssViewport::C04_FIXTURE
        },
        CssViewport {
            device_scale_factor: f32::NAN,
            ..CssViewport::C04_FIXTURE
        },
        CssViewport {
            width_css_px: f32::MAX,
            device_scale_factor: 2.0,
            ..CssViewport::C04_FIXTURE
        },
        CssViewport {
            width_css_px: f32::MIN_POSITIVE,
            device_scale_factor: f32::MIN_POSITIVE,
            ..CssViewport::C04_FIXTURE
        },
    ] {
        assert!(matches!(
            compute_basic_cascade(&fixture.view, &fixture.author_stylesheets, invalid_viewport),
            Err(CssCascadeError::InvalidViewport)
        ));
    }

    let invalid_origin = [StylesheetSource {
        id: "unexpected-ua".to_owned(),
        base_url: "https://spinon.invalid/ua.css".to_owned(),
        origin: CssOrigin::UserAgent,
        css: "div { display: none; }".to_owned(),
    }];
    assert!(matches!(
        compute_basic_cascade(&fixture.view, &invalid_origin, CssViewport::C04_FIXTURE),
        Err(CssCascadeError::InvalidStylesheetOrigin { id }) if id == "unexpected-ua"
    ));
}
