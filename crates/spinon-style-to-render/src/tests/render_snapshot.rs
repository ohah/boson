use super::fixture::{
    Fixture, assert_style_layout_matches_reference, expected_to_rgb_css, parse_opaque_hex,
    parse_render_hex,
};
use spinon_layout::LayoutSourceRevision;
use spinon_render::PaintProfileId;
use spinon_style::CssCascadeError;

#[test]
fn fixed_s04_fixture_matches_chromium_and_builds_a_complete_static_snapshot() {
    let fixture = Fixture::new();
    assert_eq!(
        fixture.input["schema"],
        "spinon-css-s04-flex-paint-fixture/v1"
    );
    assert_eq!(
        fixture.reference["schema"],
        "spinon-css-s04-flex-paint-reference/v1"
    );
    assert_eq!(
        fixture.reference["fixture"]["sha256"],
        "a4abee019ac584a9be64862d59ae4255e0d5fa23e3ac50ff2f91be12c8a53de9"
    );
    assert_eq!(
        fixture.reference["stylesheet"]["sha256"],
        "827b7e12ddf39af8adee483bc223a4ed025fd1e9a8536780736dc838097aeb90"
    );
    assert_eq!(fixture.input["sampleRows"], serde_json::json!([0, 20, 39]));
    assert_eq!(
        fixture.input["comparison"]["perCoordinateMaximumAbsoluteError"],
        0.5
    );
    assert_eq!(
        fixture.input["comparison"]["aggregateAveragesAllowed"],
        false
    );
    let computed_properties = fixture.input["comparison"]["computedProperties"]
        .as_array()
        .unwrap();
    assert!(
        !computed_properties
            .iter()
            .any(|property| property == "width" || property == "height")
    );

    let output = fixture.compute().unwrap();
    assert_style_layout_matches_reference(&fixture, &output);
    assert_eq!(
        output.layout.source_revision,
        LayoutSourceRevision::HostDocument {
            generation: fixture.document.generation(),
            document: fixture.document.document_revision(),
            render_tree: fixture.document.render_tree_revision(),
        }
    );
    for (fixture_id, source_color) in fixture.input["authorBackgroundColors"].as_object().unwrap() {
        let expected = source_color.as_str().unwrap();
        let node_id = fixture.nodes[fixture_id].id();
        let style = output
            .computed_styles
            .elements
            .iter()
            .find(|style| style.node_id == node_id)
            .unwrap();
        assert_eq!(
            style.properties["background-color"],
            expected_to_rgb_css(expected)
        );
        assert_eq!(style.background_color, Some(parse_opaque_hex(expected)));
    }

    let snapshot = fixture.build(&output).unwrap();
    assert_eq!(snapshot.source().fixture_id, "S04-flex-paint-v1");
    assert_eq!(
        snapshot.source().chromium_reference_id,
        fixture.reference["referenceId"]
    );
    assert_eq!(
        snapshot.source().paint_profile,
        PaintProfileId::OpaqueBackgroundColorV1
    );
    assert_eq!(snapshot.viewport_css_px().width(), 301.0);
    assert_eq!(snapshot.viewport_css_px().height(), 40.0);
    assert_eq!(snapshot.boxes().len(), 4);
    for (index, (fixture_id, render_box)) in fixture.input["tree"]["preorder"]
        .as_array()
        .unwrap()
        .iter()
        .zip(snapshot.boxes())
        .enumerate()
    {
        let fixture_id = fixture_id.as_str().unwrap();
        let observation = fixture.reference["observations"]
            .as_array()
            .unwrap()
            .iter()
            .find(|observation| observation["fixtureId"] == fixture_id)
            .unwrap();
        let expected = &observation["frameRelativeToRoot"];
        let frame = render_box.frame_css_px();
        assert_eq!(render_box.node_id(), fixture.nodes[fixture_id].id());
        assert_eq!(render_box.paint_order(), index as u32);
        assert!((frame.x() - expected["x"].as_f64().unwrap() as f32).abs() <= 0.5);
        assert!((frame.y() - expected["y"].as_f64().unwrap() as f32).abs() <= 0.5);
        assert!((frame.width() - expected["width"].as_f64().unwrap() as f32).abs() <= 0.5);
        assert!((frame.height() - expected["height"].as_f64().unwrap() as f32).abs() <= 0.5);
        assert_eq!(
            render_box.paint(),
            parse_render_hex(
                fixture.input["authorBackgroundColors"][fixture_id]
                    .as_str()
                    .unwrap()
            )
        );
    }
}

#[test]
fn c04_flex_path_stays_separate_from_the_s04_profile() {
    let fixture = Fixture::new();
    let error = spinon_style_to_layout::compute_style_layout(
        &fixture.document.snapshot(),
        &fixture.view(),
        fixture.root,
        std::slice::from_ref(&fixture.stylesheet),
        fixture.viewport(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        spinon_style_to_layout::StyleLayoutError::Cascade(
            CssCascadeError::UnsupportedAuthorCss { ref feature, .. }
        ) if feature.contains("background-color")
    ));
}
