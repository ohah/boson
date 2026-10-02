use taffy::prelude::{
    AlignItems, Dimension, Display, FlexDirection as TaffyFlexDirection, FlexWrap,
    LengthPercentage, Rect, Size, Style,
};
use taffy::style::{BoxSizing, Direction as TaffyDirection};

use crate::{
    FlexDirection, LayoutBoxSizing, LayoutDimension, LayoutDisplay, LayoutStyle, TextDirection,
};

pub(super) fn to_taffy_style(style: LayoutStyle) -> Style {
    Style {
        display: match style.display {
            LayoutDisplay::Flex => Display::Flex,
            LayoutDisplay::Block => Display::Block,
            LayoutDisplay::None => Display::None,
        },
        box_sizing: match style.box_sizing {
            LayoutBoxSizing::BorderBox => BoxSizing::BorderBox,
            LayoutBoxSizing::ContentBox => BoxSizing::ContentBox,
        },
        direction: match style.direction {
            TextDirection::Ltr => TaffyDirection::Ltr,
            TextDirection::Rtl => TaffyDirection::Rtl,
        },
        size: Size {
            width: to_taffy_dimension(style.width),
            height: to_taffy_dimension(style.height),
        },
        padding: Rect {
            top: LengthPercentage::length(style.padding.top),
            right: LengthPercentage::length(style.padding.right),
            bottom: LengthPercentage::length(style.padding.bottom),
            left: LengthPercentage::length(style.padding.left),
        },
        gap: Size {
            width: LengthPercentage::length(style.gap.column),
            height: LengthPercentage::length(style.gap.row),
        },
        align_items: Some(AlignItems::STRETCH),
        flex_basis: to_taffy_dimension(style.flex_basis),
        flex_direction: match style.flex_direction {
            FlexDirection::Row => TaffyFlexDirection::Row,
            FlexDirection::Column => TaffyFlexDirection::Column,
        },
        flex_wrap: FlexWrap::NoWrap,
        flex_grow: style.flex_grow,
        flex_shrink: style.flex_shrink,
        ..Default::default()
    }
}

fn to_taffy_dimension(dimension: LayoutDimension) -> Dimension {
    match dimension {
        LayoutDimension::Auto => Dimension::auto(),
        LayoutDimension::Fixed(value) => Dimension::length(value),
    }
}
