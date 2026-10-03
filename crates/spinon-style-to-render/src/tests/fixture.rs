use std::{collections::BTreeMap, fs, path::PathBuf};

use serde_json::Value;
use spinon_core::{
    AttributeName, DocumentChangeBatch, DocumentOperation, HostDocument, HostNodeHandle,
    HostParent, OwnerId, StyleRevision,
};
use spinon_style::{CssOrigin, CssViewport, StylesheetSource, StyloDocumentView};
use spinon_style_to_layout::{StyleLayoutOutput, compute_s04_style_layout};
use style::context::QuirksMode;

use crate::{
    CurrentLayoutInputs, FixtureNodeMapping, RenderFixtureProvenance, StyleRenderError,
    build_s04_static_render_snapshot,
};

const HTML: &str = "http://www.w3.org/1999/xhtml";
const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/s04/flex-paint.v1.json"
);
const REFERENCE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/references/s04-flex-paint-v1-chromium-154.0.8037.95-a4abee019ac5-827b7e12ddf3-affc6715a14a.json"
);
const REFERENCE_SHA256: &str = "20a55f01c35bd0b6546026bb7d6a68d0a2bfc0f4010984573ca0ac791cc85b05";

pub(super) struct Fixture {
    pub(super) document: HostDocument,
    pub(super) root: HostNodeHandle,
    pub(super) nodes: BTreeMap<String, HostNodeHandle>,
    pub(super) input: Value,
    pub(super) reference: Value,
    pub(super) stylesheet: StylesheetSource,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let input: Value =
            serde_json::from_str(&fs::read_to_string(FIXTURE_PATH).unwrap()).unwrap();
        let reference: Value =
            serde_json::from_str(&fs::read_to_string(REFERENCE_PATH).unwrap()).unwrap();
        let mut document = HostDocument::new().unwrap();
        let owner = OwnerId::new(1804).unwrap();
        let preorder = input["tree"]["preorder"].as_array().unwrap();
        let nodes = preorder
            .iter()
            .map(|fixture_id| {
                (
                    fixture_id.as_str().unwrap().to_owned(),
                    document.reserve_node_handle().unwrap(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let root = nodes["flex-parent"];
        let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
        for fixture_id in preorder {
            let fixture_id = fixture_id.as_str().unwrap();
            let handle = nodes[fixture_id];
            batch
                .push(DocumentOperation::CreateElement {
                    node: handle,
                    namespace: HTML.to_owned(),
                    local_name: "div".to_owned(),
                })
                .push(DocumentOperation::SetAttribute {
                    node: handle,
                    name: AttributeName::new(None, "id").unwrap(),
                    value: fixture_id.into(),
                });
            let parent = if fixture_id == "flex-parent" {
                HostParent::Root
            } else {
                HostParent::Node(root)
            };
            batch.push(DocumentOperation::InsertBefore {
                parent,
                node: handle,
                before: None,
            });
        }
        document.commit(batch).unwrap();

        let stylesheet = StylesheetSource {
            id: input["stylesheet"]["id"].as_str().unwrap().to_owned(),
            base_url: input["stylesheet"]["baseUrl"].as_str().unwrap().to_owned(),
            origin: CssOrigin::Author,
            css: fs::read_to_string(fixture_css_path()).unwrap(),
        };
        Self {
            document,
            root,
            nodes,
            input,
            reference,
            stylesheet,
        }
    }

    pub(super) fn viewport(&self) -> CssViewport {
        CssViewport {
            width_css_px: self.input["viewport"]["widthCssPx"].as_f64().unwrap() as f32,
            height_css_px: self.input["viewport"]["heightCssPx"].as_f64().unwrap() as f32,
            device_scale_factor: self.input["viewport"]["deviceScaleFactor"]
                .as_f64()
                .unwrap() as f32,
            environment_revision: Default::default(),
        }
    }

    pub(super) fn view(&self) -> StyloDocumentView {
        StyloDocumentView::new_with_base_url(
            self.document.snapshot(),
            self.root,
            true,
            QuirksMode::NoQuirks,
            self.input["documentBaseUrl"].as_str().unwrap(),
        )
        .unwrap()
    }

    pub(super) fn compute(
        &self,
    ) -> Result<StyleLayoutOutput, spinon_style_to_layout::StyleLayoutError> {
        compute_s04_style_layout(
            &self.document.snapshot(),
            &self.view(),
            self.root,
            std::slice::from_ref(&self.stylesheet),
            self.viewport(),
            StyleRevision::default(),
        )
    }

    pub(super) fn mappings(&self) -> Vec<FixtureNodeMapping<'_>> {
        self.input["tree"]["preorder"]
            .as_array()
            .unwrap()
            .iter()
            .map(|fixture_id| {
                let fixture_id = fixture_id.as_str().unwrap();
                FixtureNodeMapping {
                    fixture_id,
                    node_id: self.nodes[fixture_id].id(),
                }
            })
            .collect()
    }

    pub(super) fn provenance(&self) -> RenderFixtureProvenance {
        let fixture = &self.reference["fixture"];
        let stylesheet = &self.reference["stylesheet"];
        RenderFixtureProvenance {
            fixture_id: self.input["fixtureId"].as_str().unwrap().to_owned(),
            fixture_sha256: decode_sha256(fixture["sha256"].as_str().unwrap()),
            stylesheet_sha256: decode_sha256(stylesheet["sha256"].as_str().unwrap()),
            chromium_reference_id: self.reference["referenceId"].as_str().unwrap().to_owned(),
            chromium_reference_sha256: decode_sha256(REFERENCE_SHA256),
        }
    }

    pub(super) fn build(
        &self,
        output: &StyleLayoutOutput,
    ) -> Result<spinon_render::StaticRenderSnapshot, StyleRenderError> {
        build_s04_static_render_snapshot(
            &self.document.snapshot(),
            self.root,
            output,
            self.current_layout_inputs(),
            &self.mappings(),
            self.provenance(),
        )
    }

    pub(super) fn current_layout_inputs(&self) -> CurrentLayoutInputs {
        let document = self.document.snapshot();
        CurrentLayoutInputs::for_host_document(&document, StyleRevision::default(), self.viewport())
    }
}

fn fixture_css_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/css/s04/flex-paint.v1.css")
}

fn decode_sha256(value: &str) -> [u8; 32] {
    assert_eq!(value.len(), 64);
    let mut output = [0; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).unwrap();
    }
    output
}

pub(super) fn assert_style_layout_matches_reference(fixture: &Fixture, output: &StyleLayoutOutput) {
    let observations = fixture.reference["observations"].as_array().unwrap();
    assert_eq!(observations.len(), fixture.nodes.len());
    for observation in observations {
        let fixture_id = observation["fixtureId"].as_str().unwrap();
        let node_id = fixture.nodes[fixture_id].id();
        let style = output
            .computed_styles
            .elements
            .iter()
            .find(|style| style.node_id == node_id)
            .unwrap();
        for (property, expected) in observation["computedValues"].as_object().unwrap() {
            assert_eq!(
                style.properties[property],
                expected.as_str().unwrap(),
                "{fixture_id}.{property}"
            );
        }
        let expected = &observation["frameRelativeToRoot"];
        let actual = output.layout.frames.get(&node_id).unwrap();
        for (property, actual) in [
            ("x", actual.x),
            ("y", actual.y),
            ("width", actual.width),
            ("height", actual.height),
        ] {
            let expected = expected[property].as_f64().unwrap() as f32;
            assert!(
                (actual - expected).abs() <= 0.5,
                "{fixture_id}.{property}: 실제 {actual}, Chromium {expected}"
            );
        }
    }
}

pub(super) fn expected_to_rgb_css(value: &str) -> String {
    let color = parse_opaque_hex(value);
    format!("rgb({}, {}, {})", color.red, color.green, color.blue)
}

pub(super) fn parse_opaque_hex(value: &str) -> spinon_style::OpaqueCssSrgb {
    let value = value.strip_prefix('#').unwrap();
    spinon_style::OpaqueCssSrgb {
        red: u8::from_str_radix(&value[0..2], 16).unwrap(),
        green: u8::from_str_radix(&value[2..4], 16).unwrap(),
        blue: u8::from_str_radix(&value[4..6], 16).unwrap(),
    }
}

pub(super) fn parse_render_hex(value: &str) -> spinon_render::OpaqueCssSrgb {
    let color = parse_opaque_hex(value);
    spinon_render::OpaqueCssSrgb::new(color.red, color.green, color.blue)
}
