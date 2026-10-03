use spinon_core::{EnvironmentRevision, HostDocument, StyleRevision};

use super::{
    ComputedStyleProfileId, CssRect, CssSize, LayoutProjectionId, OpaqueCssSrgb, PaintProfileId,
    SnapshotError, StaticRenderBox, StaticRenderSnapshot, StaticRenderSource,
};

fn source() -> StaticRenderSource {
    let document = HostDocument::new().unwrap();
    let snapshot = document.snapshot();
    StaticRenderSource {
        document_generation: snapshot.generation(),
        document_revision: snapshot.document_revision(),
        render_tree_revision: snapshot.render_tree_revision(),
        style_revision: StyleRevision::default(),
        environment_revision: EnvironmentRevision::default(),
        computed_style_profile: ComputedStyleProfileId::S04FlexPaintV1,
        layout_projection: LayoutProjectionId::TaffyFlexSubsetV1,
        paint_profile: PaintProfileId::OpaqueBackgroundColorV1,
        fixture_id: "S04-test".to_owned(),
        fixture_sha256: [1; 32],
        stylesheet_sha256: [2; 32],
        chromium_reference_id: "chromium-test".to_owned(),
        chromium_reference_sha256: [3; 32],
    }
}

#[test]
fn css_sizes_and_frames_reject_non_finite_or_negative_dimensions() {
    assert!(matches!(
        CssSize::new(f32::NAN, 10.0),
        Err(SnapshotError::InvalidViewport)
    ));
    assert!(matches!(
        CssRect::new(0.0, 0.0, f32::INFINITY, 10.0),
        Err(SnapshotError::InvalidFrame)
    ));
    assert!(matches!(
        CssRect::new(0.0, 0.0, -1.0, 10.0),
        Err(SnapshotError::InvalidFrame)
    ));
    assert!(matches!(
        CssRect::new(f32::MAX, 0.0, f32::MAX, 10.0),
        Err(SnapshotError::InvalidFrame)
    ));
    assert!(matches!(
        CssSize::new(0.0, 10.0),
        Err(SnapshotError::InvalidViewport)
    ));
}

#[test]
fn static_snapshot_requires_unique_nodes_and_contiguous_paint_order() {
    let mut document = HostDocument::new().unwrap();
    let first = document.reserve_node_handle().unwrap().id();
    let second = document.reserve_node_handle().unwrap().id();
    let frame = CssRect::new(0.0, 0.0, 1.0, 1.0).unwrap();
    let color = OpaqueCssSrgb::new(1, 2, 3);
    let viewport = CssSize::new(2.0, 2.0).unwrap();

    assert!(matches!(
        StaticRenderSnapshot::new(
            source(),
            viewport,
            vec![
                StaticRenderBox::new(first, frame, color, 0),
                StaticRenderBox::new(first, frame, color, 1),
            ]
        ),
        Err(SnapshotError::DuplicateNode(node)) if node == first
    ));
    assert!(matches!(
        StaticRenderSnapshot::new(
            source(),
            viewport,
            vec![
                StaticRenderBox::new(first, frame, color, 0),
                StaticRenderBox::new(second, frame, color, 2),
            ]
        ),
        Err(SnapshotError::InvalidPaintOrder)
    ));
}

#[test]
fn static_snapshot_rejects_an_empty_scene() {
    assert!(matches!(
        StaticRenderSnapshot::new(source(), CssSize::new(1.0, 1.0).unwrap(), Vec::new(),),
        Err(SnapshotError::EmptyScene)
    ));
}
