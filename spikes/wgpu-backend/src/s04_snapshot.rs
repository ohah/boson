use std::collections::BTreeMap;

use serde_json::Value;
use sha2::{Digest, Sha256};
use spinon_core::{
    AttributeName, DocumentChangeBatch, DocumentOperation, HostDocument, HostNodeHandle,
    HostParent, OwnerId,
};
use spinon_render::StaticRenderSnapshot;
use spinon_style::{CssOrigin, CssViewport, StylesheetSource, StyloDocumentView};
use spinon_style_to_layout::compute_s04_style_layout;
use spinon_style_to_render::{
    build_s04_static_render_snapshot, FixtureNodeMapping, RenderFixtureProvenance,
};
use style::context::QuirksMode;

const HTML_NAMESPACE: &str = "http://www.w3.org/1999/xhtml";
const FIXTURE_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/s04/flex-paint.v1.json"
));
const FIXTURE_CSS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/s04/flex-paint.v1.css"
));
const CHROMIUM_REFERENCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/references/s04-flex-paint-v1-chromium-154.0.8037.95-a4abee019ac5-827b7e12ddf3-affc6715a14a.json"
));
const CHROMIUM_REFERENCE_SHA256: &str =
    "20a55f01c35bd0b6546026bb7d6a68d0a2bfc0f4010984573ca0ac791cc85b05";

pub(crate) fn build_snapshot() -> Result<StaticRenderSnapshot, String> {
    let fixture: Value = serde_json::from_str(FIXTURE_JSON)
        .map_err(|error| format!("S04 fixture JSON 파싱 실패: {error}"))?;
    let reference: Value = serde_json::from_str(CHROMIUM_REFERENCE)
        .map_err(|error| format!("S04 Chromium 기준 JSON 파싱 실패: {error}"))?;
    let fixture_sha256 = sha256(FIXTURE_JSON.as_bytes());
    let stylesheet_sha256 = sha256(FIXTURE_CSS.as_bytes());
    let reference_sha256 = sha256(CHROMIUM_REFERENCE.as_bytes());
    validate_digest(&fixture_sha256, &reference["fixture"]["sha256"], "fixture")?;
    validate_digest(
        &stylesheet_sha256,
        &reference["stylesheet"]["sha256"],
        "stylesheet",
    )?;
    validate_digest(
        &reference_sha256,
        &Value::String(CHROMIUM_REFERENCE_SHA256.to_owned()),
        "Chromium reference",
    )?;

    let preorder = string_array(&fixture["tree"]["preorder"], "tree.preorder")?;
    let root_id = string_value(&fixture["tree"]["root"], "tree.root")?;
    let viewport = CssViewport {
        width_css_px: number_value(&fixture["viewport"]["widthCssPx"], "viewport.widthCssPx")?,
        height_css_px: number_value(&fixture["viewport"]["heightCssPx"], "viewport.heightCssPx")?,
        device_scale_factor: number_value(
            &fixture["viewport"]["deviceScaleFactor"],
            "viewport.deviceScaleFactor",
        )?,
        environment_revision: Default::default(),
    };
    let nodes = create_fixture_document(&preorder, &root_id)?;
    let root = *nodes
        .handles
        .get(&root_id)
        .ok_or_else(|| format!("S04 root 노드가 없습니다: {root_id}"))?;
    let document = nodes.document;
    let document_snapshot = document.snapshot();
    let document_base_url = string_value(&fixture["documentBaseUrl"], "documentBaseUrl")?;
    let view = StyloDocumentView::new_with_base_url(
        document_snapshot.clone(),
        root,
        true,
        QuirksMode::NoQuirks,
        &document_base_url,
    )
    .map_err(|error| format!("S04 Stylo 문서 구성 실패: {error}"))?;
    let stylesheet = StylesheetSource {
        id: string_value(&fixture["stylesheet"]["id"], "stylesheet.id")?,
        base_url: string_value(&fixture["stylesheet"]["baseUrl"], "stylesheet.baseUrl")?,
        origin: CssOrigin::Author,
        css: FIXTURE_CSS.to_owned(),
    };
    let output = compute_s04_style_layout(
        &document_snapshot,
        &view,
        root,
        &[stylesheet],
        viewport,
        Default::default(),
    )
    .map_err(|error| format!("S04 CSS·레이아웃 fixture 계산 실패: {error}"))?;
    let mappings = preorder
        .iter()
        .map(|fixture_id| {
            let node = nodes
                .handles
                .get(fixture_id)
                .ok_or_else(|| format!("S04 fixture 노드가 없습니다: {fixture_id}"))?;
            Ok(FixtureNodeMapping {
                fixture_id,
                node_id: node.id(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let provenance = RenderFixtureProvenance {
        fixture_id: string_value(&fixture["fixtureId"], "fixtureId")?,
        fixture_sha256,
        stylesheet_sha256,
        chromium_reference_id: string_value(&reference["referenceId"], "referenceId")?,
        chromium_reference_sha256: reference_sha256,
    };
    let current_layout_inputs = spinon_style_to_render::CurrentLayoutInputs::for_host_document(
        &document.snapshot(),
        Default::default(),
        viewport,
    );
    build_s04_static_render_snapshot(
        &document.snapshot(),
        root,
        &output,
        current_layout_inputs,
        &mappings,
        provenance,
    )
    .map_err(|error| format!("S04 정적 RenderSnapshot 생성 실패: {error}"))
}

struct FixtureDocument {
    document: HostDocument,
    handles: BTreeMap<String, HostNodeHandle>,
}

fn create_fixture_document(preorder: &[String], root_id: &str) -> Result<FixtureDocument, String> {
    let mut document = HostDocument::new().map_err(|error| error.to_string())?;
    let handles = preorder
        .iter()
        .map(|fixture_id| {
            document
                .reserve_node_handle()
                .map(|handle| (fixture_id.clone(), handle))
                .map_err(|error| error.to_string())
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let root = *handles
        .get(root_id)
        .ok_or_else(|| format!("S04 root ID가 preorder에 없습니다: {root_id}"))?;
    let owner =
        OwnerId::new(1804).ok_or_else(|| "S04 fixture owner ID가 잘못됐습니다".to_owned())?;
    let mut batch = DocumentChangeBatch::new(owner, document.document_revision());
    for fixture_id in preorder {
        let handle = *handles
            .get(fixture_id)
            .ok_or_else(|| format!("S04 노드 핸들이 없습니다: {fixture_id}"))?;
        batch
            .push(DocumentOperation::CreateElement {
                node: handle,
                namespace: HTML_NAMESPACE.to_owned(),
                local_name: "div".to_owned(),
            })
            .push(DocumentOperation::SetAttribute {
                node: handle,
                name: AttributeName::new(None, "id")
                    .ok_or_else(|| "fixture id 속성 이름이 잘못됐습니다".to_owned())?,
                value: fixture_id.clone().into(),
            });
        let parent = if fixture_id == root_id {
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
    document.commit(batch).map_err(|error| error.to_string())?;
    Ok(FixtureDocument { document, handles })
}

fn validate_digest(actual: &[u8; 32], expected: &Value, name: &str) -> Result<(), String> {
    let expected = string_value(expected, name)?;
    if encode_hex(actual) != expected {
        return Err(format!("S04 {name} SHA-256가 고정 기준과 다릅니다"));
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[usize::from(byte >> 4)] as char);
        output.push(HEX[usize::from(byte & 0x0f)] as char);
    }
    output
}

fn string_array(value: &Value, name: &str) -> Result<Vec<String>, String> {
    value
        .as_array()
        .ok_or_else(|| format!("S04 {name} 값은 배열이어야 합니다"))?
        .iter()
        .map(|entry| string_value(entry, name))
        .collect()
}

fn string_value(value: &Value, name: &str) -> Result<String, String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("S04 {name} 값은 문자열이어야 합니다"))
}

fn number_value(value: &Value, name: &str) -> Result<f32, String> {
    value
        .as_f64()
        .map(|number| number as f32)
        .filter(|number| number.is_finite())
        .ok_or_else(|| format!("S04 {name} 값은 유한한 숫자여야 합니다"))
}

#[cfg(test)]
mod tests {
    use super::build_snapshot;
    use spinon_render::ComputedStyleProfileId;

    #[test]
    fn fixture_builds_the_same_validated_snapshot_contract() {
        let snapshot = build_snapshot().expect("고정 S04 snapshot 생성 성공");
        assert_eq!(
            snapshot.source().computed_style_profile,
            ComputedStyleProfileId::S04FlexPaintV1
        );
        assert_eq!(snapshot.boxes().len(), 4);
        assert_eq!(snapshot.viewport_css_px().width(), 301.0);
        assert_eq!(snapshot.viewport_css_px().height(), 40.0);
        assert_eq!(snapshot.boxes()[2].frame_css_px().x(), 53.5);
        assert_eq!(snapshot.boxes()[3].frame_css_px().x(), 155.5);
    }
}
