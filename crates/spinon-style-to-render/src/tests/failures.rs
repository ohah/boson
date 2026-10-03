use spinon_core::{DocumentChangeBatch, DocumentOperation, HostDocument, HostParent, OwnerId};
use spinon_layout::LayoutSourceRevision;
use spinon_style::{
    CascadeDiagnostic, ComputedStyleProfile, CssCascadeError, CssOrigin, CssParseDiagnostic,
    StylesheetSource, StyloDocumentView,
};
use spinon_style_to_layout::compute_s04_style_layout;
use style::context::QuirksMode;

use crate::{StyleRenderError, build_s04_static_render_snapshot};

use super::fixture::Fixture;

const HTML: &str = "http://www.w3.org/1999/xhtml";

#[test]
fn revision_mismatch_and_incomplete_node_sets_fail_atomically() {
    let fixture = Fixture::new();
    let output = fixture.compute().unwrap();
    let other = Fixture::new();
    assert!(matches!(
        build_s04_static_render_snapshot(
            &other.document.snapshot(),
            other.root,
            &output,
            &fixture.mappings(),
            fixture.provenance(),
        ),
        Err(StyleRenderError::SnapshotMismatch {
            field: "DocumentGeneration"
        })
    ));

    let mut stale_document_revision = output.clone();
    stale_document_revision.computed_styles.document_revision = Default::default();
    assert!(matches!(
        fixture.build(&stale_document_revision),
        Err(StyleRenderError::SnapshotMismatch {
            field: "DocumentRevision"
        })
    ));

    let mut stale_render_revision = output.clone();
    stale_render_revision.computed_styles.render_tree_revision = Default::default();
    assert!(matches!(
        fixture.build(&stale_render_revision),
        Err(StyleRenderError::SnapshotMismatch {
            field: "RenderTreeRevision"
        })
    ));

    let mut stale_layout_revision = output.clone();
    stale_layout_revision.layout.source_revision = LayoutSourceRevision::Tree(Default::default());
    assert!(matches!(
        fixture.build(&stale_layout_revision),
        Err(StyleRenderError::SnapshotMismatch {
            field: "LayoutSourceRevision"
        })
    ));

    let mut missing_frame = output.clone();
    missing_frame
        .layout
        .frames
        .remove(&fixture.nodes["flex-b"].id());
    assert!(matches!(
        fixture.build(&missing_frame),
        Err(StyleRenderError::MissingLayoutFrame(node)) if node == fixture.nodes["flex-b"].id()
    ));

    let mut missing_style = output.clone();
    missing_style.computed_styles.elements.remove(1);
    assert!(matches!(
        fixture.build(&missing_style),
        Err(StyleRenderError::MissingComputedStyle(_))
    ));

    let mut missing_color = output.clone();
    missing_color.computed_styles.elements[1].background_color = None;
    assert!(matches!(
        fixture.build(&missing_color),
        Err(StyleRenderError::MissingBackgroundColor(_))
    ));
}

#[test]
fn duplicate_nodes_bad_mapping_and_non_finite_frames_fail_closed() {
    let fixture = Fixture::new();
    let output = fixture.compute().unwrap();

    let mut duplicate_style = output.clone();
    duplicate_style
        .computed_styles
        .elements
        .push(duplicate_style.computed_styles.elements[0].clone());
    assert!(matches!(
        fixture.build(&duplicate_style),
        Err(StyleRenderError::DuplicateComputedStyle(_))
    ));

    let mut mapping = fixture.mappings();
    mapping[1].node_id = mapping[0].node_id;
    assert!(matches!(
        build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            &mapping,
            fixture.provenance(),
        ),
        Err(StyleRenderError::DuplicateFixtureNode(_))
    ));

    let mut reordered_mapping = fixture.mappings();
    reordered_mapping.swap(1, 2);
    assert!(matches!(
        build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            &reordered_mapping,
            fixture.provenance(),
        ),
        Err(StyleRenderError::FixtureMappingOrder { index: 1, .. })
    ));

    let mut non_finite_frame = output.clone();
    non_finite_frame
        .layout
        .frames
        .get_mut(&fixture.nodes["flex-a"].id())
        .unwrap()
        .x = f32::NAN;
    assert!(matches!(
        fixture.build(&non_finite_frame),
        Err(StyleRenderError::InvalidFrame(node)) if node == fixture.nodes["flex-a"].id()
    ));
}

#[test]
fn rgb_color_syntax_and_text_nodes_are_rejected() {
    let fixture = Fixture::new();
    let mut rgb_stylesheet = fixture.stylesheet.clone();
    rgb_stylesheet.css = rgb_stylesheet.css.replace("#e11d48", "rgb(225, 29, 72)");
    let error = compute_s04_style_layout(
        &fixture.document.snapshot(),
        &fixture.view(),
        fixture.root,
        &[rgb_stylesheet],
        fixture.viewport(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        spinon_style_to_layout::StyleLayoutError::Cascade(
            CssCascadeError::UnsupportedAuthorCss { ref feature, .. }
        ) if feature.contains("#RRGGBB")
    ));

    let mut with_text = HostDocument::new().unwrap();
    let owner = OwnerId::new(1805).unwrap();
    let root = with_text.reserve_node_handle().unwrap();
    let text = with_text.reserve_node_handle().unwrap();
    let mut batch = DocumentChangeBatch::new(owner, with_text.document_revision());
    batch
        .push(DocumentOperation::CreateElement {
            node: root,
            namespace: HTML.to_owned(),
            local_name: "div".to_owned(),
        })
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Root,
            node: root,
            before: None,
        })
        .push(DocumentOperation::CreateText {
            node: text,
            data: "text".into(),
        })
        .push(DocumentOperation::InsertBefore {
            parent: HostParent::Node(root),
            node: text,
            before: None,
        });
    with_text.commit(batch).unwrap();
    let text_view = StyloDocumentView::new_with_base_url(
        with_text.snapshot(),
        root,
        true,
        QuirksMode::NoQuirks,
        "https://spinon.invalid/s04/flex-paint.html",
    )
    .unwrap();
    let text_stylesheet = StylesheetSource {
        id: "s04-text-rejection".to_owned(),
        base_url: "https://spinon.invalid/s04/text.css".to_owned(),
        origin: CssOrigin::Author,
        css: "div { display: flex; width: 301px; height: 40px; background-color: #112233; }"
            .to_owned(),
    };
    let error = compute_s04_style_layout(
        &with_text.snapshot(),
        &text_view,
        root,
        &[text_stylesheet],
        fixture.viewport(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        spinon_style_to_layout::StyleLayoutError::Layout(
            spinon_layout::LayoutError::UnsupportedTextNode(node)
        ) if node == text.id()
    ));
}

#[test]
fn invalid_profile_diagnostics_root_and_viewport_are_rejected() {
    let mut fixture = Fixture::new();
    let output = fixture.compute().unwrap();

    let mut wrong_profile = output.clone();
    wrong_profile.computed_styles.profile = ComputedStyleProfile::FlexLayoutV1;
    assert!(matches!(
        fixture.build(&wrong_profile),
        Err(StyleRenderError::UnsupportedProfile)
    ));

    let mut diagnosed = output.clone();
    diagnosed
        .computed_styles
        .diagnostics
        .push(CascadeDiagnostic {
            source_id: "s04-test".to_owned(),
            node_id: None,
            diagnostic: CssParseDiagnostic {
                line: 0,
                column: 1,
                message: "test diagnostic".to_owned(),
            },
        });
    assert!(matches!(
        fixture.build(&diagnosed),
        Err(StyleRenderError::CascadeDiagnostics)
    ));

    let mut invalid_viewport = output.clone();
    invalid_viewport.computed_styles.viewport.width_css_px = f32::INFINITY;
    assert!(matches!(
        fixture.build(&invalid_viewport),
        Err(StyleRenderError::InvalidViewport)
    ));

    let detached_root = fixture.document.reserve_node_handle().unwrap();
    assert!(matches!(
        build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            detached_root,
            &output,
            &fixture.mappings(),
            fixture.provenance(),
        ),
        Err(StyleRenderError::InvalidRoot)
    ));

    let mut invalid_provenance = fixture.provenance();
    invalid_provenance.fixture_id = "  ".to_owned();
    assert!(matches!(
        build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            &fixture.mappings(),
            invalid_provenance,
        ),
        Err(StyleRenderError::InvalidFixtureMetadata)
    ));
}

#[test]
fn mapping_and_node_sets_reject_missing_extra_and_duplicate_entries() {
    let mut fixture = Fixture::new();
    let output = fixture.compute().unwrap();

    let mut short_mapping = fixture.mappings();
    short_mapping.pop();
    assert!(matches!(
        build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            &short_mapping,
            fixture.provenance(),
        ),
        Err(StyleRenderError::FixtureMappingLength {
            expected: 4,
            actual: 3
        })
    ));

    let mut empty_id_mapping = fixture.mappings();
    empty_id_mapping[1].fixture_id = " ";
    assert!(matches!(
        build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            &empty_id_mapping,
            fixture.provenance(),
        ),
        Err(StyleRenderError::EmptyFixtureId { index: 1 })
    ));

    let mut duplicate_id_mapping = fixture.mappings();
    duplicate_id_mapping[1].fixture_id = duplicate_id_mapping[0].fixture_id;
    assert!(matches!(
        build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            &duplicate_id_mapping,
            fixture.provenance(),
        ),
        Err(StyleRenderError::DuplicateFixtureId(_))
    ));

    let extra_node = fixture.document.reserve_node_handle().unwrap().id();
    let mut unexpected_style = output.clone();
    let mut extra_style = unexpected_style.computed_styles.elements[0].clone();
    extra_style.node_id = extra_node;
    unexpected_style.computed_styles.elements.push(extra_style);
    assert!(matches!(
        fixture.build(&unexpected_style),
        Err(StyleRenderError::UnexpectedComputedStyle(node)) if node == extra_node
    ));

    let mut unexpected_frame = output.clone();
    let first_frame = *unexpected_frame.layout.frames.values().next().unwrap();
    unexpected_frame
        .layout
        .frames
        .insert(extra_node, first_frame);
    assert!(matches!(
        fixture.build(&unexpected_frame),
        Err(StyleRenderError::UnexpectedLayoutFrame(node)) if node == extra_node
    ));
}
