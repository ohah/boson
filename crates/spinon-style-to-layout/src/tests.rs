use std::{collections::BTreeMap, fs, path::PathBuf};

use serde_json::Value;
use spinon_core::{
    AttributeName, DocumentChangeBatch, DocumentOperation, HostDocument, HostNodeHandle,
    HostParent, OwnerId,
};
use spinon_layout::LayoutSourceRevision;
use spinon_style::{CssCascadeError, CssOrigin, CssViewport, StylesheetSource, StyloDocumentView};
use style::context::QuirksMode;

use crate::{StyleLayoutError, compute_style_layout};

const HTML: &str = "http://www.w3.org/1999/xhtml";
const FIXTURE_JSON: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/c04/style-layout-bridge.v1.json"
);
const C01_LAYOUT_REFERENCE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/references/chromium-macos-arm64-macos-26.5.1-25f80-154.0.8037.95-layout-v1-778a2065ac58-inventory-ef6d0b87a506-capture-85a34bd9a1a2-bin-affc6715a14a/core-layout.json"
);

struct DocumentFixture {
    document: HostDocument,
    root: HostNodeHandle,
    nodes: BTreeMap<String, HostNodeHandle>,
}

impl DocumentFixture {
    fn new(with_text: bool) -> Self {
        let mut document = HostDocument::new().unwrap();
        let owner = OwnerId::new(1702).unwrap();
        let root = document.reserve_node_handle().unwrap();
        let children = [
            ("flex-a", document.reserve_node_handle().unwrap()),
            ("flex-b", document.reserve_node_handle().unwrap()),
            ("flex-c", document.reserve_node_handle().unwrap()),
        ];
        let text = with_text.then(|| document.reserve_node_handle().unwrap());
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        let mut nodes = BTreeMap::from([("flex-parent".to_owned(), root)]);
        create_div(&mut batch, root, "flex-parent");
        batch.push(DocumentOperation::InsertBefore {
            parent: HostParent::Root,
            node: root,
            before: None,
        });
        for (name, handle) in children {
            create_div(&mut batch, handle, name);
            batch.push(DocumentOperation::InsertBefore {
                parent: HostParent::Node(root),
                node: handle,
                before: None,
            });
            nodes.insert(name.to_owned(), handle);
        }
        if let Some(text) = text {
            batch.push(DocumentOperation::CreateText {
                node: text,
                data: "fixture text".into(),
            });
            batch.push(DocumentOperation::InsertBefore {
                parent: HostParent::Node(root),
                node: text,
                before: None,
            });
        }
        document.commit(batch).unwrap();
        Self {
            document,
            root,
            nodes,
        }
    }

    fn with_inline_style(style: &str) -> Self {
        let mut fixture = Self::new(false);
        let owner = OwnerId::new(1702).unwrap();
        let mut batch = DocumentChangeBatch::new(owner, fixture.document.document_revision());
        batch.push(DocumentOperation::SetAttribute {
            node: fixture.root,
            name: AttributeName::new(None, "style").unwrap(),
            value: style.into(),
        });
        fixture.document.commit(batch).unwrap();
        fixture
    }

    fn view(&self) -> StyloDocumentView {
        StyloDocumentView::new_with_base_url(
            self.document.snapshot(),
            self.root,
            true,
            QuirksMode::NoQuirks,
            "https://spinon.invalid/c04/style-layout-bridge.html",
        )
        .unwrap()
    }

    fn stylesheet(&self) -> StylesheetSource {
        StylesheetSource {
            id: "c04-style-layout-bridge".to_owned(),
            base_url: "https://spinon.invalid/c04/style-layout-bridge.css".to_owned(),
            origin: CssOrigin::Author,
            css: fs::read_to_string(fixture_css_path()).unwrap(),
        }
    }

    fn viewport(&self) -> CssViewport {
        let fixture = load_fixture();
        CssViewport {
            width_css_px: fixture["viewport"]["widthCssPx"].as_f64().unwrap() as f32,
            height_css_px: fixture["viewport"]["heightCssPx"].as_f64().unwrap() as f32,
            device_scale_factor: fixture["viewport"]["deviceScaleFactor"].as_f64().unwrap() as f32,
        }
    }

    fn compute(
        &self,
        extra_css: Option<&str>,
    ) -> Result<crate::StyleLayoutOutput, StyleLayoutError> {
        let mut stylesheets = vec![self.stylesheet()];
        if let Some(css) = extra_css {
            stylesheets.push(StylesheetSource {
                id: "c04-style-layout-override".to_owned(),
                base_url: "https://spinon.invalid/c04/override.css".to_owned(),
                origin: CssOrigin::Author,
                css: css.to_owned(),
            });
        }
        let snapshot = self.document.snapshot();
        compute_style_layout(
            &snapshot,
            &self.view(),
            self.root,
            &stylesheets,
            self.viewport(),
        )
    }
}

fn create_div(batch: &mut DocumentChangeBatch, node: HostNodeHandle, id: &str) {
    batch
        .push(DocumentOperation::CreateElement {
            node,
            namespace: HTML.to_owned(),
            local_name: "div".to_owned(),
        })
        .push(DocumentOperation::SetAttribute {
            node,
            name: AttributeName::new(None, "id").unwrap(),
            value: id.into(),
        });
}

fn fixture_css_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/css/c04/style-layout-bridge.css")
}

fn load_fixture() -> Value {
    let fixture: Value = serde_json::from_str(&fs::read_to_string(FIXTURE_JSON).unwrap()).unwrap();
    assert_eq!(fixture["schema"], "spinon-css-c04-style-layout-fixture/v1");
    assert_eq!(fixture["fixtureId"], "C04-style-layout-bridge-v1");
    fixture
}

fn assert_fixture_matches_c01_oracle(fixture: &Value) {
    let reference: Value =
        serde_json::from_str(&fs::read_to_string(C01_LAYOUT_REFERENCE).unwrap()).unwrap();
    assert_eq!(fixture["sourceReferenceId"], reference["referenceId"]);
    let oracle_case = reference["observations"]["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["id"] == "flex-fractional-growth")
        .unwrap();
    let oracle_nodes = oracle_case["nodes"].as_array().unwrap();
    let parent = oracle_nodes
        .iter()
        .find(|node| node["id"] == "flex-parent")
        .unwrap();
    for (node_id, properties) in fixture["chromiumComputedValues"].as_object().unwrap() {
        let oracle_node = oracle_nodes
            .iter()
            .find(|node| node["id"] == node_id.as_str())
            .unwrap();
        let features = oracle_node["features"].as_array().unwrap();
        for (property, expected) in properties.as_object().unwrap() {
            let feature = features
                .iter()
                .find(|feature| feature["property"] == property.as_str())
                .unwrap_or_else(|| panic!("C01 oracle property {node_id}.{property} is missing"));
            assert_eq!(
                feature["value"], *expected,
                "C01 oracle {node_id}.{property}"
            );
        }
    }
    for (node_id, expected) in fixture["chromiumFramesRelativeToRoot"].as_object().unwrap() {
        let oracle_node = oracle_nodes
            .iter()
            .find(|node| node["id"] == node_id.as_str())
            .unwrap();
        let rect = &oracle_node["rect"];
        for field in ["x", "y", "width", "height"] {
            let relative = match field {
                "x" => rect["x"].as_f64().unwrap() - parent["rect"]["x"].as_f64().unwrap(),
                "y" => rect["y"].as_f64().unwrap() - parent["rect"]["y"].as_f64().unwrap(),
                _ => rect[field].as_f64().unwrap(),
            };
            assert_eq!(
                expected[field].as_f64().unwrap(),
                relative,
                "C01 oracle {node_id}.{field}"
            );
        }
    }
}

#[test]
fn c04_computed_flex_style_projects_to_chromium_fractional_taffy_frames() {
    let fixture = DocumentFixture::new(false);
    let snapshot = fixture.document.snapshot();
    let oracle_fixture = load_fixture();
    assert_fixture_matches_c01_oracle(&oracle_fixture);
    let output = fixture.compute(None).unwrap();
    assert_eq!(output.computed_styles.generation, snapshot.generation());
    assert_eq!(
        output.computed_styles.document_revision,
        snapshot.document_revision()
    );
    assert_eq!(
        output.computed_styles.render_tree_revision,
        snapshot.render_tree_revision()
    );
    assert_eq!(
        output.layout.source_revision,
        LayoutSourceRevision::HostDocument {
            generation: snapshot.generation(),
            document: snapshot.document_revision(),
            render_tree: snapshot.render_tree_revision(),
        }
    );

    let expected_values = oracle_fixture["chromiumComputedValues"].clone();
    for (fixture_id, properties) in expected_values.as_object().unwrap() {
        let node = fixture.nodes[fixture_id].id();
        let actual = output
            .computed_styles
            .elements
            .iter()
            .find(|style| style.node_id == node)
            .unwrap_or_else(|| panic!("computed style for {fixture_id} is missing"));
        for (property, expected) in properties.as_object().unwrap() {
            assert_eq!(
                actual.properties.get(property).map(String::as_str),
                expected.as_str(),
                "{fixture_id}.{property}"
            );
        }
    }

    let expected_frames = oracle_fixture["chromiumFramesRelativeToRoot"].clone();
    assert_eq!(
        output.layout.frames.len(),
        expected_frames.as_object().unwrap().len()
    );
    for (fixture_id, expected) in expected_frames.as_object().unwrap() {
        let node = fixture.nodes[fixture_id].id();
        let actual = output.layout.frames.get(&node).unwrap();
        for (field, actual, expected) in [
            ("x", actual.x, expected["x"].as_f64().unwrap() as f32),
            ("y", actual.y, expected["y"].as_f64().unwrap() as f32),
            (
                "width",
                actual.width,
                expected["width"].as_f64().unwrap() as f32,
            ),
            (
                "height",
                actual.height,
                expected["height"].as_f64().unwrap() as f32,
            ),
        ] {
            assert!(
                (actual - expected).abs() <= 0.5,
                "{fixture_id}.{field}: 실제 {actual}, Chromium {expected}, 허용치 0.5 CSS px"
            );
        }
    }
}

#[test]
fn css_values_outside_the_flex_projection_fail_closed() {
    let fixture = DocumentFixture::new(false);
    let grid_result = fixture.compute(Some("#flex-parent { display: grid; }"));
    assert!(
        matches!(&grid_result, Err(StyleLayoutError::CascadeDiagnostic(_))),
        "grid display must fail closed: {grid_result:?}"
    );

    let percent_result = fixture.compute(Some("#flex-a { flex-basis: 50%; }"));
    assert!(
        matches!(
            &percent_result,
            Err(StyleLayoutError::UnsupportedComputedValue {
                property: "flex-basis",
                ..
            })
        ),
        "percentage width must fail closed: {percent_result:?}"
    );

    let padding_result = fixture.compute(Some("#flex-a { padding: 8px; }"));
    assert!(
        matches!(
            &padding_result,
            Err(StyleLayoutError::Cascade(CssCascadeError::UnsupportedAuthorCss {
                feature,
                ..
            })) if feature.contains("padding")
        ),
        "an unprojected but valid layout property must fail closed: {padding_result:?}"
    );

    let media_result = fixture.compute(Some("@media screen { #flex-parent { display: flex; } }"));
    assert!(
        matches!(
            &media_result,
            Err(StyleLayoutError::Cascade(CssCascadeError::UnsupportedAuthorCss {
                feature,
                ..
            })) if feature.contains("at-rule")
        ),
        "an unimplemented conditional rule must fail closed: {media_result:?}"
    );
}

#[test]
fn inline_style_attributes_are_rejected_before_layout_projection() {
    let fixture = DocumentFixture::with_inline_style("padding: 8px");
    assert!(matches!(
        fixture.compute(None),
        Err(StyleLayoutError::UnsupportedInlineStyle(node))
            if node == fixture.root.id()
    ));
}

#[test]
fn layout_rejects_text_in_a_host_document_subtree() {
    let fixture = DocumentFixture::new(true);
    assert!(matches!(
        fixture.compute(None),
        Err(StyleLayoutError::Layout(
            spinon_layout::LayoutError::UnsupportedTextNode(_)
        ))
    ));
}

#[test]
fn a_snapshot_from_another_document_generation_is_rejected_before_cascade() {
    let first = DocumentFixture::new(false);
    let second = DocumentFixture::new(false);
    let view = first.view();
    let stylesheets = vec![first.stylesheet()];
    assert_ne!(first.document.generation(), second.document.generation());
    assert!(matches!(
        compute_style_layout(
            &second.document.snapshot(),
            &view,
            second.root,
            &stylesheets,
            first.viewport()
        ),
        Err(StyleLayoutError::SnapshotMismatch {
            field: "DocumentGeneration"
        })
    ));
}

#[test]
fn stale_document_revision_is_rejected_before_cascade_or_layout() {
    let mut fixture = DocumentFixture::new(false);
    let view = fixture.view();
    let owner = OwnerId::new(1702).unwrap();
    let detached = fixture.document.reserve_node_handle().unwrap();
    let mut batch = DocumentChangeBatch::new(owner, fixture.document.document_revision());
    batch.push(DocumentOperation::CreateElement {
        node: detached,
        namespace: HTML.to_owned(),
        local_name: "aside".to_owned(),
    });
    fixture.document.commit(batch).unwrap();
    assert!(matches!(
        compute_style_layout(
            &fixture.document.snapshot(),
            &view,
            fixture.root,
            &[fixture.stylesheet()],
            fixture.viewport()
        ),
        Err(StyleLayoutError::SnapshotMismatch {
            field: "DocumentRevision"
        })
    ));
}

#[test]
fn projection_errors_keep_the_css_node_and_property_context() {
    let fixture = DocumentFixture::new(false);
    let error = fixture
        .compute(Some("#flex-parent { flex-direction: row-reverse; }"))
        .unwrap_err();
    assert!(
        matches!(
            &error,
            StyleLayoutError::UnsupportedComputedValue {
                node,
                property: "flex-direction",
                ..
            } if *node == fixture.nodes["flex-parent"].id()
        ),
        "unexpected error: {error:?}"
    );
}
