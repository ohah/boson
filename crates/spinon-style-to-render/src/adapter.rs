use std::collections::{BTreeMap, BTreeSet};

use spinon_core::{HostDocumentSnapshot, HostNodeHandle, HostNodeKind, HostParent, NodeId};
use spinon_layout::LayoutSourceRevision;
use spinon_render::{
    ComputedStyleProfileId, CssRect, CssSize, LayoutProjectionId, OpaqueCssSrgb, PaintProfileId,
    StaticRenderBox, StaticRenderSnapshot, StaticRenderSource,
};
use spinon_style::{ComputedStyleProfile, ComputedStyleSnapshot, OpaqueCssSrgb as ComputedCssSrgb};
use spinon_style_to_layout::StyleLayoutOutput;

use crate::StyleRenderError;

/// fixture 문자열 ID와 문서 노드의 명시적 대응입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FixtureNodeMapping<'a> {
    pub fixture_id: &'a str,
    pub node_id: NodeId,
}

/// 고정 fixture와 비교 oracle의 바이트 출처입니다.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenderFixtureProvenance {
    pub fixture_id: String,
    pub fixture_sha256: [u8; 32],
    pub stylesheet_sha256: [u8; 32],
    pub chromium_reference_id: String,
    pub chromium_reference_sha256: [u8; 32],
}

/// 같은 HostDocument revision에서 계산한 Flex layout과 typed paint를 결합합니다.
pub fn build_s04_static_render_snapshot(
    document: &HostDocumentSnapshot,
    root: HostNodeHandle,
    output: &StyleLayoutOutput,
    fixture_nodes: &[FixtureNodeMapping<'_>],
    provenance: RenderFixtureProvenance,
) -> Result<StaticRenderSnapshot, StyleRenderError> {
    validate_profile(&output.computed_styles)?;
    validate_revisions(
        document,
        &output.computed_styles,
        output.layout.source_revision,
    )?;
    validate_provenance(&provenance)?;
    validate_viewport(output.computed_styles.viewport)?;

    let preorder = document_preorder(document, root)?;
    validate_fixture_mapping(&preorder, fixture_nodes)?;
    let styles = indexed_styles(&output.computed_styles)?;
    validate_style_node_set(&preorder, &styles)?;
    validate_layout_node_set(&preorder, &output.layout.frames)?;

    let viewport = output.computed_styles.viewport;
    let viewport_css_px = CssSize::new(viewport.width_css_px, viewport.height_css_px)
        .map_err(|_| StyleRenderError::InvalidViewport)?;
    let mut boxes = Vec::with_capacity(preorder.len());
    for (index, node_id) in preorder.iter().copied().enumerate() {
        let style = styles
            .get(&node_id)
            .ok_or(StyleRenderError::MissingComputedStyle(node_id))?;
        let computed_color = style
            .background_color
            .ok_or(StyleRenderError::MissingBackgroundColor(node_id))?;
        let frame = output
            .layout
            .frames
            .get(&node_id)
            .ok_or(StyleRenderError::MissingLayoutFrame(node_id))?;
        let frame_css_px = CssRect::new(frame.x, frame.y, frame.width, frame.height)
            .map_err(|_| StyleRenderError::InvalidFrame(node_id))?;
        boxes.push(StaticRenderBox::new(
            node_id,
            frame_css_px,
            render_color(computed_color),
            u32::try_from(index).map_err(|_| StyleRenderError::PaintOrderOverflow)?,
        ));
    }

    let styles = &output.computed_styles;
    let source = StaticRenderSource {
        document_generation: styles.generation,
        document_revision: styles.document_revision,
        render_tree_revision: styles.render_tree_revision,
        computed_style_profile: ComputedStyleProfileId::S04FlexPaintV1,
        layout_projection: LayoutProjectionId::TaffyFlexSubsetV1,
        paint_profile: PaintProfileId::OpaqueBackgroundColorV1,
        fixture_id: provenance.fixture_id,
        fixture_sha256: provenance.fixture_sha256,
        stylesheet_sha256: provenance.stylesheet_sha256,
        chromium_reference_id: provenance.chromium_reference_id,
        chromium_reference_sha256: provenance.chromium_reference_sha256,
    };
    StaticRenderSnapshot::new(source, viewport_css_px, boxes).map_err(Into::into)
}

fn validate_profile(styles: &ComputedStyleSnapshot) -> Result<(), StyleRenderError> {
    if styles.profile != ComputedStyleProfile::S04FlexPaintV1 {
        return Err(StyleRenderError::UnsupportedProfile);
    }
    if !styles.diagnostics.is_empty() {
        return Err(StyleRenderError::CascadeDiagnostics);
    }
    Ok(())
}

fn validate_revisions(
    document: &HostDocumentSnapshot,
    styles: &ComputedStyleSnapshot,
    layout_revision: LayoutSourceRevision,
) -> Result<(), StyleRenderError> {
    if document.generation() != styles.generation {
        return Err(StyleRenderError::SnapshotMismatch {
            field: "DocumentGeneration",
        });
    }
    if document.document_revision() != styles.document_revision {
        return Err(StyleRenderError::SnapshotMismatch {
            field: "DocumentRevision",
        });
    }
    if document.render_tree_revision() != styles.render_tree_revision {
        return Err(StyleRenderError::SnapshotMismatch {
            field: "RenderTreeRevision",
        });
    }
    let expected = LayoutSourceRevision::HostDocument {
        generation: document.generation(),
        document: document.document_revision(),
        render_tree: document.render_tree_revision(),
    };
    if layout_revision != expected {
        return Err(StyleRenderError::SnapshotMismatch {
            field: "LayoutSourceRevision",
        });
    }
    Ok(())
}

fn validate_provenance(provenance: &RenderFixtureProvenance) -> Result<(), StyleRenderError> {
    if provenance.fixture_id.trim().is_empty() || provenance.chromium_reference_id.trim().is_empty()
    {
        return Err(StyleRenderError::InvalidFixtureMetadata);
    }
    Ok(())
}

fn validate_viewport(viewport: spinon_style::CssViewport) -> Result<(), StyleRenderError> {
    let device_width = viewport.width_css_px * viewport.device_scale_factor;
    let device_height = viewport.height_css_px * viewport.device_scale_factor;
    if !viewport.width_css_px.is_finite()
        || viewport.width_css_px <= 0.0
        || !viewport.height_css_px.is_finite()
        || viewport.height_css_px <= 0.0
        || !viewport.device_scale_factor.is_finite()
        || viewport.device_scale_factor <= 0.0
        || !device_width.is_finite()
        || !device_height.is_finite()
    {
        return Err(StyleRenderError::InvalidViewport);
    }
    Ok(())
}

fn document_preorder(
    document: &HostDocumentSnapshot,
    root: HostNodeHandle,
) -> Result<Vec<NodeId>, StyleRenderError> {
    if document.parent(root) != Some(HostParent::Root)
        || !document
            .node(root)
            .is_some_and(|node| matches!(node.kind(), HostNodeKind::Element(_)))
    {
        return Err(StyleRenderError::InvalidRoot);
    }

    let mut result = Vec::new();
    let mut visited = BTreeSet::new();
    let mut pending = vec![root];
    while let Some(handle) = pending.pop() {
        if !visited.insert(handle.id()) {
            return Err(StyleRenderError::DuplicateDocumentNode(handle.id()));
        }
        let node = document.node(handle).ok_or(StyleRenderError::InvalidRoot)?;
        if matches!(node.kind(), HostNodeKind::Text(_)) {
            return Err(StyleRenderError::UnsupportedTextNode(node.id()));
        }
        result.push(node.id());
        if let Some(children) = document.children(handle) {
            let children = children.collect::<Vec<_>>();
            for child in &children {
                let child_node = document.node(*child).ok_or(StyleRenderError::InvalidRoot)?;
                if matches!(child_node.kind(), HostNodeKind::Text(_)) {
                    return Err(StyleRenderError::UnsupportedTextNode(child_node.id()));
                }
            }
            pending.extend(children.into_iter().rev());
        }
    }
    Ok(result)
}

fn validate_fixture_mapping(
    preorder: &[NodeId],
    fixture_nodes: &[FixtureNodeMapping<'_>],
) -> Result<(), StyleRenderError> {
    if preorder.len() != fixture_nodes.len() {
        return Err(StyleRenderError::FixtureMappingLength {
            expected: preorder.len(),
            actual: fixture_nodes.len(),
        });
    }
    let mut ids = BTreeSet::new();
    let mut nodes = BTreeSet::new();
    for (index, mapping) in fixture_nodes.iter().enumerate() {
        if mapping.fixture_id.trim().is_empty() {
            return Err(StyleRenderError::EmptyFixtureId { index });
        }
        if !ids.insert(mapping.fixture_id) {
            return Err(StyleRenderError::DuplicateFixtureId(
                mapping.fixture_id.to_owned(),
            ));
        }
        if !nodes.insert(mapping.node_id) {
            return Err(StyleRenderError::DuplicateFixtureNode(mapping.node_id));
        }
        if preorder[index] != mapping.node_id {
            return Err(StyleRenderError::FixtureMappingOrder {
                index,
                fixture_id: mapping.fixture_id.to_owned(),
            });
        }
    }
    Ok(())
}

fn indexed_styles(
    styles: &ComputedStyleSnapshot,
) -> Result<BTreeMap<NodeId, &spinon_style::ComputedElementStyle>, StyleRenderError> {
    let mut result = BTreeMap::new();
    for style in &styles.elements {
        if result.insert(style.node_id, style).is_some() {
            return Err(StyleRenderError::DuplicateComputedStyle(style.node_id));
        }
    }
    Ok(result)
}

fn validate_style_node_set(
    preorder: &[NodeId],
    styles: &BTreeMap<NodeId, &spinon_style::ComputedElementStyle>,
) -> Result<(), StyleRenderError> {
    let expected = preorder.iter().copied().collect::<BTreeSet<_>>();
    for node in &expected {
        if !styles.contains_key(node) {
            return Err(StyleRenderError::MissingComputedStyle(*node));
        }
    }
    if let Some(node) = styles.keys().find(|node| !expected.contains(node)) {
        return Err(StyleRenderError::UnexpectedComputedStyle(*node));
    }
    Ok(())
}

fn validate_layout_node_set(
    preorder: &[NodeId],
    frames: &BTreeMap<NodeId, spinon_layout::LayoutFrame>,
) -> Result<(), StyleRenderError> {
    let expected = preorder.iter().copied().collect::<BTreeSet<_>>();
    for node in &expected {
        if !frames.contains_key(node) {
            return Err(StyleRenderError::MissingLayoutFrame(*node));
        }
    }
    if let Some(node) = frames.keys().find(|node| !expected.contains(node)) {
        return Err(StyleRenderError::UnexpectedLayoutFrame(*node));
    }
    Ok(())
}

fn render_color(color: ComputedCssSrgb) -> OpaqueCssSrgb {
    OpaqueCssSrgb::new(color.red, color.green, color.blue)
}
