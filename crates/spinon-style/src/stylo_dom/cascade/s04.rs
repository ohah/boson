use spinon_core::NodeId;
use style::properties::{ComputedValues, LonghandId};

use crate::OpaqueCssSrgb;

use super::CssCascadeError;

pub(super) const S04_FLEX_PAINT_PROPERTIES: &[(&str, LonghandId)] = &[
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
    ("background-color", LonghandId::BackgroundColor),
];

pub(super) const S04_FLEX_PAINT_AUTHOR_PROPERTIES: &[&str] = &[
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
    "background-color",
];

pub(super) fn computed_background_color(
    computed: &ComputedValues,
    node: NodeId,
) -> Result<OpaqueCssSrgb, CssCascadeError> {
    match computed.clone_background_color() {
        style::values::computed::Color::Absolute(color) => {
            OpaqueCssSrgb::from_absolute_color(color).map_err(|reason| {
                CssCascadeError::UnsupportedComputedBackgroundColor {
                    node,
                    reason: reason.to_owned(),
                }
            })
        }
        _ => Err(CssCascadeError::UnsupportedComputedBackgroundColor {
            node,
            reason: "Stylo 계산값이 절대 색상이 아닙니다".to_owned(),
        }),
    }
}
