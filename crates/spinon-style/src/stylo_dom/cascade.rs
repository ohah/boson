use std::{error::Error, fmt};

use selectors::matching::{
    MatchingContext, MatchingForInvalidation, MatchingMode, NeedsSelectorFlags, SelectorCaches,
};
use spinon_core::{NodeId, StyleRevision};
use style::{
    applicable_declarations::ApplicableDeclarationList,
    context::{CascadeInputs, QuirksMode, TreeCountingCaches},
    device::{Device, servo::FontMetricsProvider},
    dom::TElement,
    font_metrics::FontMetrics,
    media_queries::MediaType,
    properties::{
        ComputedValues, FirstLineReparenting, LonghandId, PropertyDeclarationId,
        style_structs::Font,
    },
    queries::values::PrefersColorScheme,
    rule_cache::RuleCacheConditions,
    rule_tree::RuleCascadeFlags,
    selector_parser::SelectorImpl,
    servo::media_features::PointerCapabilities,
    shared_lock::StylesheetGuards,
    stylist::{RuleInclusion, Stylist},
    thread_state::{self, ThreadState},
    values::computed::{CSSPixelLength, Length, font::QueryFontMetricsFlags},
};
use url::Url;

use crate::{
    CssOrigin, StylesheetRegistry, StylesheetRegistryError, StylesheetSource, UA_STYLESHEET,
    s04_color_syntax::first_invalid_background_color,
};

use super::{StyloDocumentView, StyloElement};
mod s04;
mod snapshot;

pub use snapshot::{
    CascadeDiagnostic, ComputedElementStyle, ComputedStyleProfile, ComputedStyleSnapshot,
    CssViewport,
};

const UA_STYLESHEET_ID: &str = "spinon-ua-supported-elements-v0";
const UA_STYLESHEET_URL: &str = "https://spinon.invalid/ua/supported-elements-v0.css";
// C04.1 전용 계산 profile은 fixture가 소비하며 제품 runtime 연결은 아직 없습니다.
#[allow(dead_code)]
const BASIC_CASCADE_PROPERTIES: &[(&str, LonghandId)] = &[
    ("display", LonghandId::Display),
    ("color", LonghandId::Color),
    ("font-size", LonghandId::FontSize),
    ("font-weight", LonghandId::FontWeight),
    ("margin-top", LonghandId::MarginTop),
];

const FLEX_LAYOUT_PROPERTIES: &[(&str, LonghandId)] = &[
    ("display", LonghandId::Display),
    ("box-sizing", LonghandId::BoxSizing),
    ("width", LonghandId::Width),
    ("height", LonghandId::Height),
    ("flex-direction", LonghandId::FlexDirection),
    ("flex-grow", LonghandId::FlexGrow),
    ("flex-shrink", LonghandId::FlexShrink),
    ("flex-basis", LonghandId::FlexBasis),
    ("direction", LonghandId::Direction),
    ("row-gap", LonghandId::RowGap),
    ("column-gap", LonghandId::ColumnGap),
];

const FLEX_LAYOUT_AUTHOR_PROPERTIES: &[&str] = &[
    "display",
    "box-sizing",
    "width",
    "height",
    "flex-direction",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "direction",
    "row-gap",
    "column-gap",
];

#[derive(Debug)]
pub enum CssCascadeError {
    InvalidViewport,
    InvalidStylesheetOrigin {
        id: String,
    },
    UnsupportedAuthorCss {
        stylesheet_id: String,
        feature: String,
    },
    UnsupportedComputedBackgroundColor {
        node: NodeId,
        reason: String,
    },
    StylesheetRegistry(StylesheetRegistryError),
}

impl fmt::Display for CssCascadeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidViewport => {
                formatter.write_str("CSS viewport 크기와 배율은 유한한 양수여야 합니다")
            }
            Self::InvalidStylesheetOrigin { id } => {
                write!(
                    formatter,
                    "author stylesheet의 origin이 잘못되었습니다: {id}"
                )
            }
            Self::UnsupportedAuthorCss {
                stylesheet_id,
                feature,
            } => write!(
                formatter,
                "stylesheet {stylesheet_id}가 C04.2 CSS 입력 profile 밖 기능을 사용합니다: {feature}"
            ),
            Self::UnsupportedComputedBackgroundColor { node, reason } => write!(
                formatter,
                "노드 {node}의 계산 background-color를 S04 불투명 sRGB로 변환할 수 없습니다: {reason}"
            ),
            Self::StylesheetRegistry(error) => error.fmt(formatter),
        }
    }
}

impl Error for CssCascadeError {}

impl From<StylesheetRegistryError> for CssCascadeError {
    fn from(error: StylesheetRegistryError) -> Self {
        Self::StylesheetRegistry(error)
    }
}

/// 고정 viewport에서 한 문서 snapshot 전체의 제한된 computed style을 계산합니다.
// C04.1 전용 계산 entrypoint는 fixture 검증에서 호출합니다.
#[allow(dead_code)]
pub(crate) fn compute_basic_cascade(
    view: &StyloDocumentView,
    author_stylesheets: &[StylesheetSource],
    viewport: CssViewport,
) -> Result<ComputedStyleSnapshot, CssCascadeError> {
    compute_cascade(
        view,
        author_stylesheets,
        viewport,
        StyleRevision::default(),
        BASIC_CASCADE_PROPERTIES,
        ComputedStyleProfile::BasicCascadeV1,
    )
}

/// C04.2 Flex adapter가 사용하는 제한 computed-style snapshot을 계산합니다.
pub fn compute_flex_layout_cascade(
    view: &StyloDocumentView,
    author_stylesheets: &[StylesheetSource],
    viewport: CssViewport,
    style_revision: StyleRevision,
) -> Result<ComputedStyleSnapshot, CssCascadeError> {
    compute_cascade(
        view,
        author_stylesheets,
        viewport,
        style_revision,
        FLEX_LAYOUT_PROPERTIES,
        ComputedStyleProfile::FlexLayoutV1,
    )
}

/// S04 고정 fixture용 Flex layout 및 불투명 배경색 계산 style을 계산합니다.
pub fn compute_s04_flex_paint_cascade(
    view: &StyloDocumentView,
    author_stylesheets: &[StylesheetSource],
    viewport: CssViewport,
    style_revision: StyleRevision,
) -> Result<ComputedStyleSnapshot, CssCascadeError> {
    compute_cascade(
        view,
        author_stylesheets,
        viewport,
        style_revision,
        s04::S04_FLEX_PAINT_PROPERTIES,
        ComputedStyleProfile::S04FlexPaintV1,
    )
}

fn compute_cascade(
    view: &StyloDocumentView,
    author_stylesheets: &[StylesheetSource],
    viewport: CssViewport,
    style_revision: StyleRevision,
    properties: &[(&str, LonghandId)],
    profile: ComputedStyleProfile,
) -> Result<ComputedStyleSnapshot, CssCascadeError> {
    if !viewport.is_valid() {
        return Err(CssCascadeError::InvalidViewport);
    }

    let mut registry = StylesheetRegistry::with_shared_lock(view.shared_lock().clone());
    registry.append(StylesheetSource {
        id: UA_STYLESHEET_ID.to_owned(),
        base_url: Url::parse(UA_STYLESHEET_URL)
            .expect("내장 UA stylesheet URL은 절대 URL이어야 합니다")
            .to_string(),
        origin: CssOrigin::UserAgent,
        css: UA_STYLESHEET.to_owned(),
    })?;
    for source in author_stylesheets {
        if source.origin != CssOrigin::Author {
            return Err(CssCascadeError::InvalidStylesheetOrigin {
                id: source.id.clone(),
            });
        }
        registry.append(source.clone())?;
    }
    let allowed_author_properties = match profile {
        ComputedStyleProfile::BasicCascadeV1 => None,
        ComputedStyleProfile::FlexLayoutV1 => Some(FLEX_LAYOUT_AUTHOR_PROPERTIES),
        ComputedStyleProfile::S04FlexPaintV1 => Some(s04::S04_FLEX_PAINT_AUTHOR_PROPERTIES),
    };
    if let Some(allowed) = allowed_author_properties
        && let Some((stylesheet_id, feature)) = registry.first_unsupported_author_feature(allowed)
    {
        return Err(CssCascadeError::UnsupportedAuthorCss {
            stylesheet_id,
            feature,
        });
    }
    if profile == ComputedStyleProfile::S04FlexPaintV1 {
        for source in author_stylesheets {
            if let Some(feature) = first_invalid_background_color(&source.css) {
                return Err(CssCascadeError::UnsupportedAuthorCss {
                    stylesheet_id: source.id.clone(),
                    feature,
                });
            }
        }
    }

    let device = make_device(view.quirks_mode(), viewport);
    let mut stylist = Stylist::new(device, view.quirks_mode());
    let mut elements = Vec::new();
    let mut diagnostics = Vec::new();
    for stylesheet in registry.iter() {
        diagnostics.extend(stylesheet.diagnostics().iter().cloned().map(|diagnostic| {
            CascadeDiagnostic {
                source_id: stylesheet.id().to_owned(),
                node_id: None,
                diagnostic,
            }
        }));
    }

    let guard = view.shared_lock().read();
    for (_, stylesheet) in registry.iter_stylo_sheets() {
        stylist.append_stylesheet(stylesheet.clone(), &guard);
    }
    let guards = StylesheetGuards::same(&guard);
    stylist.flush(&guards);

    let _layout_state = LayoutThreadState::enter();
    let mut pending = vec![(view.root_handle(), None)];
    while let Some((handle, parent_style)) = pending.pop() {
        let computed = if let Some(element) = view.element(handle) {
            for diagnostic in &element.data().inline_style_diagnostics {
                diagnostics.push(CascadeDiagnostic {
                    source_id: format!("inline:{}", handle.id()),
                    node_id: Some(handle.id()),
                    diagnostic: diagnostic.clone(),
                });
            }
            let computed =
                compute_element_style(&stylist, element, &guards, parent_style.as_deref());
            let background_color = if profile == ComputedStyleProfile::S04FlexPaintV1 {
                Some(s04::computed_background_color(&computed, handle.id())?)
            } else {
                None
            };
            elements.push(ComputedElementStyle {
                node_id: handle.id(),
                properties: properties
                    .iter()
                    .map(|(name, id)| {
                        (
                            (*name).to_owned(),
                            computed.computed_value_to_string(PropertyDeclarationId::Longhand(*id)),
                        )
                    })
                    .collect(),
                background_color,
            });
            Some(computed)
        } else {
            parent_style
        };

        if let Some(children) = view.snapshot().children(handle) {
            let children = children.collect::<Vec<_>>();
            pending.extend(
                children
                    .into_iter()
                    .rev()
                    .map(|child| (child, computed.clone())),
            );
        }
    }

    Ok(ComputedStyleSnapshot {
        profile,
        viewport,
        style_revision,
        generation: view.snapshot().generation(),
        document_revision: view.document_revision(),
        render_tree_revision: view.render_tree_revision(),
        elements,
        diagnostics,
    })
}

fn compute_element_style(
    stylist: &Stylist,
    element: StyloElement<'_>,
    guards: &StylesheetGuards<'_>,
    parent_style: Option<&ComputedValues>,
) -> style::servo_arc::Arc<ComputedValues> {
    let mut selector_caches = SelectorCaches::default();
    let mut matching_context = MatchingContext::<SelectorImpl>::new(
        MatchingMode::Normal,
        None,
        &mut selector_caches,
        element.view.quirks_mode(),
        NeedsSelectorFlags::Yes,
        MatchingForInvalidation::No,
    );
    let mut declarations = ApplicableDeclarationList::new();
    stylist.push_applicable_declarations(
        element,
        None,
        element.style_attribute(),
        None,
        Default::default(),
        RuleInclusion::All,
        &mut declarations,
        &mut matching_context,
    );
    let rules = stylist
        .rule_tree()
        .compute_rule_node(&mut declarations, guards);
    let inputs = CascadeInputs {
        rules: Some(rules),
        visited_rules: None,
        flags: matching_context.extra_data.cascade_input_flags,
        included_cascade_flags: RuleCascadeFlags::empty(),
    };
    stylist.cascade_style_and_visited(
        Some(element),
        None,
        &inputs,
        guards,
        parent_style,
        parent_style,
        FirstLineReparenting::No,
        &Default::default(),
        None,
        &mut RuleCacheConditions::default(),
        &mut TreeCountingCaches::default(),
    )
}

fn make_device(quirks_mode: QuirksMode, viewport: CssViewport) -> Device {
    let font_metrics = FixedFontMetricsProvider;
    let viewport_size = euclid::Size2D::new(viewport.width_css_px, viewport.height_css_px);
    let device_size = euclid::Size2D::new(
        viewport.width_css_px * viewport.device_scale_factor,
        viewport.height_css_px * viewport.device_scale_factor,
    );
    Device::new(
        MediaType::screen(),
        quirks_mode,
        viewport_size,
        device_size,
        euclid::Scale::new(viewport.device_scale_factor),
        Box::new(font_metrics),
        ComputedValues::initial_values_with_font_override(Font::initial_values()),
        PrefersColorScheme::Light,
        PointerCapabilities::default(),
        PointerCapabilities::default(),
    )
}

#[derive(Debug)]
struct FixedFontMetricsProvider;

impl FontMetricsProvider for FixedFontMetricsProvider {
    fn query_font_metrics(
        &self,
        _vertical: bool,
        _font: &Font,
        _base_size: CSSPixelLength,
        _flags: QueryFontMetricsFlags,
    ) -> FontMetrics {
        FontMetrics::default()
    }

    fn base_size_for_generic(
        &self,
        _generic: style::values::computed::font::GenericFontFamily,
    ) -> Length {
        Length::new(16.0)
    }
}

struct LayoutThreadState {
    entered: bool,
}

impl LayoutThreadState {
    fn enter() -> Self {
        let entered = !thread_state::get().contains(ThreadState::LAYOUT);
        if entered {
            thread_state::enter(ThreadState::LAYOUT);
        }
        Self { entered }
    }
}

impl Drop for LayoutThreadState {
    fn drop(&mut self) {
        if self.entered {
            thread_state::exit(ThreadState::LAYOUT);
        }
    }
}

#[cfg(test)]
#[path = "cascade/tests.rs"]
mod tests;
