use std::fs;

use serde_json::Value;
use spinon_core::{EnvironmentRevision, Revision, StyleRevision};
use spinon_layout::{LayoutInputRevision, LayoutSourceRevision};
use spinon_style::CssViewport;

use crate::{CurrentLayoutInputs, StyleRenderError};

use super::fixture::Fixture;

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/css/s04/layout-revision-gate.v1.json"
);

fn revision(value: u64) -> StyleRevision {
    match value {
        0 => StyleRevision::default(),
        1 => StyleRevision::default().checked_next().unwrap(),
        other => panic!("revision gate fixture에 예상하지 않은 style revision: {other}"),
    }
}

fn environment_revision(value: u64) -> EnvironmentRevision {
    match value {
        0 => EnvironmentRevision::default(),
        1 => EnvironmentRevision::default().checked_next().unwrap(),
        other => panic!("revision gate fixture에 예상하지 않은 environment revision: {other}"),
    }
}

fn number(value: &Value, field: &str) -> f32 {
    value[field].as_f64().unwrap() as f32
}

fn fixture_viewport(value: &Value, environment_revision: EnvironmentRevision) -> CssViewport {
    CssViewport {
        width_css_px: number(value, "widthCssPx"),
        height_css_px: number(value, "heightCssPx"),
        device_scale_factor: number(value, "deviceScaleFactor"),
        environment_revision,
    }
}

fn spec() -> Value {
    serde_json::from_str(&fs::read_to_string(FIXTURE_PATH).unwrap()).unwrap()
}

#[test]
fn current_revision_tuple_is_admitted_and_every_stale_fixture_is_rejected() {
    let fixture = Fixture::new();
    let output = fixture.compute().unwrap();
    let input = spec();
    assert_eq!(input["schema"], "spinon-s04-layout-revision-gate/v1");

    let baseline = &input["baseline"];
    let current_viewport = fixture_viewport(
        &baseline["viewport"],
        environment_revision(baseline["environmentRevision"].as_u64().unwrap()),
    );
    let current = CurrentLayoutInputs::for_host_document(
        &fixture.document.snapshot(),
        revision(baseline["styleRevision"].as_u64().unwrap()),
        current_viewport,
    );
    let accepted = crate::build_s04_static_render_snapshot(
        &fixture.document.snapshot(),
        fixture.root,
        &output,
        current,
        &fixture.mappings(),
        fixture.provenance(),
    )
    .unwrap();
    assert_eq!(accepted.source().style_revision, current.revision.style());
    assert_eq!(
        accepted.source().environment_revision,
        current.viewport.environment_revision
    );
    assert_eq!(output.layout.revision.style(), current.revision.style());
    assert_eq!(
        output.layout.revision.environment(),
        current.viewport.environment_revision
    );

    for stale in input["staleCases"].as_array().unwrap() {
        let mut viewport = current.viewport;
        if let Some(changed) = stale.get("currentViewport") {
            viewport = fixture_viewport(changed, current.viewport.environment_revision);
        }
        let mut stale_current = CurrentLayoutInputs::for_host_document(
            &fixture.document.snapshot(),
            revision(stale["currentStyleRevision"].as_u64().unwrap()),
            viewport,
        );
        let environment =
            environment_revision(stale["currentEnvironmentRevision"].as_u64().unwrap());
        stale_current.revision = LayoutInputRevision::new(
            stale_current.revision.source(),
            stale_current.revision.style(),
            environment,
        );
        stale_current.viewport.environment_revision = environment;
        let expected = stale["expectedErrorField"].as_str().unwrap();
        let result = crate::build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            stale_current,
            &fixture.mappings(),
            fixture.provenance(),
        );
        assert!(
            matches!(result, Err(StyleRenderError::SnapshotMismatch { field }) if field == expected),
            "{} should reject with {expected}",
            stale["id"]
        );
    }

    let mut inconsistent_current = current;
    inconsistent_current.viewport.environment_revision = current
        .viewport
        .environment_revision
        .checked_next()
        .unwrap();
    assert!(matches!(
        crate::build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            inconsistent_current,
            &fixture.mappings(),
            fixture.provenance(),
        ),
        Err(StyleRenderError::SnapshotMismatch {
            field: "EnvironmentRevision"
        })
    ));

    let mut wrong_current_source = current;
    wrong_current_source.revision = LayoutInputRevision::new(
        LayoutSourceRevision::Tree(Revision::default()),
        current.revision.style(),
        current.revision.environment(),
    );
    assert!(matches!(
        crate::build_s04_static_render_snapshot(
            &fixture.document.snapshot(),
            fixture.root,
            &output,
            wrong_current_source,
            &fixture.mappings(),
            fixture.provenance(),
        ),
        Err(StyleRenderError::SnapshotMismatch {
            field: "CurrentLayoutSourceRevision"
        })
    ));
}

#[test]
fn nonzero_style_and_environment_revisions_survive_snapshot_admission() {
    let fixture = Fixture::new();
    let style_revision = StyleRevision::default().checked_next().unwrap();
    let environment_revision = EnvironmentRevision::default().checked_next().unwrap();
    let viewport = CssViewport {
        environment_revision,
        ..fixture.viewport()
    };
    let document = fixture.document.snapshot();
    let output = spinon_style_to_layout::compute_s04_style_layout(
        &document,
        &fixture.view(),
        fixture.root,
        std::slice::from_ref(&fixture.stylesheet),
        viewport,
        style_revision,
    )
    .unwrap();
    let current = CurrentLayoutInputs::for_host_document(&document, style_revision, viewport);
    let snapshot = crate::build_s04_static_render_snapshot(
        &document,
        fixture.root,
        &output,
        current,
        &fixture.mappings(),
        fixture.provenance(),
    )
    .unwrap();

    assert_eq!(snapshot.source().style_revision, style_revision);
    assert_eq!(snapshot.source().environment_revision, environment_revision);
}
