use std::collections::BTreeMap;

use spinon_core::{HostDocumentSnapshot, HostNodeHandle, HostNodeKind, NodeId};
use spinon_layout::{
    FlexDirection, LayoutBoxSizing, LayoutDimension, LayoutDisplay, LayoutEngine, LayoutGap,
    LayoutInput, LayoutOutput, LayoutStyle, TaffyLayoutEngine, TextDirection, Viewport,
};
use spinon_style::{
    ComputedStyleProfile, ComputedStyleSnapshot, CssViewport, StylesheetSource, StyloDocumentView,
    compute_flex_layout_cascade, compute_s04_flex_paint_cascade,
};

use crate::StyleLayoutError;

/// 같은 document snapshot에서 계산한 제한 CSS style과 Taffy layout 결과입니다.
#[derive(Clone, Debug)]
pub struct StyleLayoutOutput {
    pub computed_styles: ComputedStyleSnapshot,
    pub layout: LayoutOutput,
}

/// C04.2 profile로 Stylo cascade를 계산하고 HostDocument subtree를 Taffy에 전달합니다.
pub fn compute_style_layout(
    snapshot: &HostDocumentSnapshot,
    view: &StyloDocumentView,
    root: HostNodeHandle,
    author_stylesheets: &[StylesheetSource],
    viewport: CssViewport,
) -> Result<StyleLayoutOutput, StyleLayoutError> {
    compute_profile_layout(
        snapshot,
        view,
        root,
        author_stylesheets,
        viewport,
        ComputedStyleProfile::FlexLayoutV1,
    )
}

/// S04 새 paint profile만 대상으로 계산 style과 Taffy layout을 연결합니다.
pub fn compute_s04_style_layout(
    snapshot: &HostDocumentSnapshot,
    view: &StyloDocumentView,
    root: HostNodeHandle,
    author_stylesheets: &[StylesheetSource],
    viewport: CssViewport,
) -> Result<StyleLayoutOutput, StyleLayoutError> {
    compute_profile_layout(
        snapshot,
        view,
        root,
        author_stylesheets,
        viewport,
        ComputedStyleProfile::S04FlexPaintV1,
    )
}

fn compute_profile_layout(
    snapshot: &HostDocumentSnapshot,
    view: &StyloDocumentView,
    root: HostNodeHandle,
    author_stylesheets: &[StylesheetSource],
    viewport: CssViewport,
    profile: ComputedStyleProfile,
) -> Result<StyleLayoutOutput, StyleLayoutError> {
    assert_view_matches_snapshot(snapshot, view)?;
    assert_no_inline_style(snapshot, root)?;
    let computed_styles = match profile {
        ComputedStyleProfile::FlexLayoutV1 => {
            compute_flex_layout_cascade(view, author_stylesheets, viewport)?
        }
        ComputedStyleProfile::S04FlexPaintV1 => {
            compute_s04_flex_paint_cascade(view, author_stylesheets, viewport)?
        }
        ComputedStyleProfile::BasicCascadeV1 => {
            return Err(StyleLayoutError::UnsupportedProfile {
                profile: format!("{profile:?}"),
            });
        }
    };
    assert_matching_revision(snapshot, &computed_styles, profile)?;
    if let Some(diagnostic) = computed_styles.diagnostics.first().cloned() {
        return Err(StyleLayoutError::CascadeDiagnostic(diagnostic));
    }
    let styles = project_styles(&computed_styles)?;
    let layout_viewport = Viewport {
        width: viewport.width_css_px,
        height: viewport.height_css_px,
    };
    let input = LayoutInput::from_host_document(snapshot, root, layout_viewport, &styles)?;
    let layout = TaffyLayoutEngine.compute(&input)?;
    Ok(StyleLayoutOutput {
        computed_styles,
        layout,
    })
}

fn assert_no_inline_style(
    snapshot: &HostDocumentSnapshot,
    root: HostNodeHandle,
) -> Result<(), StyleLayoutError> {
    let mut pending = vec![root];
    while let Some(handle) = pending.pop() {
        let Some(node) = snapshot.node(handle) else {
            continue;
        };
        if let HostNodeKind::Element(element) = node.kind()
            && element.attributes().keys().any(|attribute| {
                attribute.namespace().is_none()
                    && attribute.local_name().eq_ignore_ascii_case("style")
            })
        {
            return Err(StyleLayoutError::UnsupportedInlineStyle(node.id()));
        }
        if let Some(children) = snapshot.children(handle) {
            pending.extend(children);
        }
    }
    Ok(())
}

fn assert_view_matches_snapshot(
    snapshot: &HostDocumentSnapshot,
    view: &StyloDocumentView,
) -> Result<(), StyleLayoutError> {
    if snapshot.generation() != view.generation() {
        return Err(StyleLayoutError::SnapshotMismatch {
            field: "DocumentGeneration",
        });
    }
    if snapshot.document_revision() != view.document_revision() {
        return Err(StyleLayoutError::SnapshotMismatch {
            field: "DocumentRevision",
        });
    }
    if snapshot.render_tree_revision() != view.render_tree_revision() {
        return Err(StyleLayoutError::SnapshotMismatch {
            field: "RenderTreeRevision",
        });
    }
    Ok(())
}

fn assert_matching_revision(
    snapshot: &HostDocumentSnapshot,
    styles: &ComputedStyleSnapshot,
    expected_profile: ComputedStyleProfile,
) -> Result<(), StyleLayoutError> {
    if styles.profile != expected_profile {
        return Err(StyleLayoutError::UnsupportedProfile {
            profile: format!("{:?}", styles.profile),
        });
    }
    if snapshot.generation() != styles.generation {
        return Err(StyleLayoutError::SnapshotMismatch {
            field: "DocumentGeneration",
        });
    }
    if snapshot.document_revision() != styles.document_revision {
        return Err(StyleLayoutError::SnapshotMismatch {
            field: "DocumentRevision",
        });
    }
    if snapshot.render_tree_revision() != styles.render_tree_revision {
        return Err(StyleLayoutError::SnapshotMismatch {
            field: "RenderTreeRevision",
        });
    }
    Ok(())
}

fn project_styles(
    snapshot: &ComputedStyleSnapshot,
) -> Result<BTreeMap<NodeId, LayoutStyle>, StyleLayoutError> {
    let mut output = BTreeMap::new();
    for element in &snapshot.elements {
        let node = element.node_id;
        let style = LayoutStyle {
            display: parse_display(node, required(element, "display")?)?,
            box_sizing: parse_box_sizing(node, required(element, "box-sizing")?)?,
            width: parse_dimension(node, "width", required(element, "width")?)?,
            height: parse_dimension(node, "height", required(element, "height")?)?,
            flex_basis: parse_dimension(node, "flex-basis", required(element, "flex-basis")?)?,
            flex_direction: parse_flex_direction(node, required(element, "flex-direction")?)?,
            direction: parse_direction(node, required(element, "direction")?)?,
            flex_grow: parse_number(node, "flex-grow", required(element, "flex-grow")?)?,
            flex_shrink: parse_number(node, "flex-shrink", required(element, "flex-shrink")?)?,
            gap: LayoutGap {
                row: parse_gap(node, "row-gap", required(element, "row-gap")?)?,
                column: parse_gap(node, "column-gap", required(element, "column-gap")?)?,
            },
            ..LayoutStyle::default()
        };
        if output.insert(node, style).is_some() {
            return Err(StyleLayoutError::DuplicateComputedElement(node));
        }
    }
    Ok(output)
}

fn required<'a>(
    element: &'a spinon_style::ComputedElementStyle,
    property: &'static str,
) -> Result<&'a str, StyleLayoutError> {
    element.properties.get(property).map(String::as_str).ok_or(
        StyleLayoutError::MissingComputedProperty {
            node: element.node_id,
            property,
        },
    )
}

fn parse_display(node: NodeId, value: &str) -> Result<LayoutDisplay, StyleLayoutError> {
    match value {
        "flex" => Ok(LayoutDisplay::Flex),
        "block" => Ok(LayoutDisplay::Block),
        "none" => Ok(LayoutDisplay::None),
        value => unsupported(node, "display", value),
    }
}

fn parse_box_sizing(node: NodeId, value: &str) -> Result<LayoutBoxSizing, StyleLayoutError> {
    match value {
        "border-box" => Ok(LayoutBoxSizing::BorderBox),
        "content-box" => Ok(LayoutBoxSizing::ContentBox),
        value => unsupported(node, "box-sizing", value),
    }
}

fn parse_dimension(
    node: NodeId,
    property: &'static str,
    value: &str,
) -> Result<LayoutDimension, StyleLayoutError> {
    if value == "auto" {
        return Ok(LayoutDimension::Auto);
    }
    parse_css_px(node, property, value).map(LayoutDimension::Fixed)
}

fn parse_flex_direction(node: NodeId, value: &str) -> Result<FlexDirection, StyleLayoutError> {
    match value {
        "row" => Ok(FlexDirection::Row),
        "column" => Ok(FlexDirection::Column),
        value => unsupported(node, "flex-direction", value),
    }
}

fn parse_direction(node: NodeId, value: &str) -> Result<TextDirection, StyleLayoutError> {
    match value {
        "ltr" => Ok(TextDirection::Ltr),
        "rtl" => Ok(TextDirection::Rtl),
        value => unsupported(node, "direction", value),
    }
}

fn parse_number(
    node: NodeId,
    property: &'static str,
    value: &str,
) -> Result<f32, StyleLayoutError> {
    let parsed = value
        .parse::<f32>()
        .ok()
        .filter(|number| number.is_finite() && *number >= 0.0);
    parsed.ok_or_else(|| unsupported_value(node, property, value))
}

fn parse_gap(node: NodeId, property: &'static str, value: &str) -> Result<f32, StyleLayoutError> {
    if value == "normal" {
        return Ok(0.0);
    }
    parse_css_px(node, property, value)
}

fn parse_css_px(
    node: NodeId,
    property: &'static str,
    value: &str,
) -> Result<f32, StyleLayoutError> {
    let Some(number) = value.strip_suffix("px") else {
        return unsupported(node, property, value);
    };
    let parsed = number
        .parse::<f32>()
        .ok()
        .filter(|number| number.is_finite() && *number >= 0.0);
    parsed.ok_or_else(|| unsupported_value(node, property, value))
}

fn unsupported<T>(
    node: NodeId,
    property: &'static str,
    value: &str,
) -> Result<T, StyleLayoutError> {
    Err(unsupported_value(node, property, value))
}

fn unsupported_value(node: NodeId, property: &'static str, value: &str) -> StyleLayoutError {
    StyleLayoutError::UnsupportedComputedValue {
        node,
        property,
        value: value.to_owned(),
    }
}
