use serde::Deserialize;
use std::{collections::HashMap, fs};
use taffy::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StyleData {
    display: Option<String>,
    flex_direction: Option<String>,
    width: Option<f32>,
    height: Option<f32>,
    padding: Option<Edges>,
    gap: Option<Gap>,
    flex_grow: Option<f32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Edges {
    top: f32,
    right: f32,
    bottom: f32,
    left: f32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Gap {
    row: f32,
    column: f32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CompiledStyles {
    version: u32,
    styles: HashMap<String, StyleData>,
}

trait LayoutEngine {
    fn add_leaf(&mut self, id: u64, style: &StyleData) -> Result<(), String>;
    fn add_parent(&mut self, id: u64, style: &StyleData, children: &[u64]) -> Result<(), String>;
    fn compute(&mut self, root: u64) -> Result<(), String>;
    fn frame(&self, id: u64) -> Result<(f32, f32, f32, f32), String>;
}

struct TaffyLayout {
    tree: TaffyTree<()>,
    nodes: HashMap<u64, NodeId>,
}

impl TaffyLayout {
    fn new() -> Self {
        Self {
            tree: TaffyTree::new(),
            nodes: HashMap::new(),
        }
    }
}

fn to_taffy(style: &StyleData) -> Result<Style, String> {
    if style.display.as_deref() != Some("flex") {
        return Err("이 실험에서는 display: flex가 필요합니다".into());
    }
    for (name, value) in [
        ("width", style.width),
        ("height", style.height),
        ("flex-grow", style.flex_grow),
    ] {
        if value.is_some_and(|number| !number.is_finite() || number < 0.0) {
            return Err(format!("{name}: 0 이상의 유한한 값이 필요합니다"));
        }
    }
    if let Some(padding) = &style.padding {
        for (name, value) in [
            ("top", padding.top),
            ("right", padding.right),
            ("bottom", padding.bottom),
            ("left", padding.left),
        ] {
            if !value.is_finite() || value < 0.0 {
                return Err(format!("padding-{name}: 0 이상의 유한한 값이 필요합니다"));
            }
        }
    }
    if let Some(gap) = &style.gap {
        for (name, value) in [("row", gap.row), ("column", gap.column)] {
            if !value.is_finite() || value < 0.0 {
                return Err(format!("{name}-gap: 0 이상의 유한한 값이 필요합니다"));
            }
        }
    }
    Ok(Style {
        display: Display::Flex,
        flex_direction: match style.flex_direction.as_deref().unwrap_or("row") {
            "row" => FlexDirection::Row,
            "column" => FlexDirection::Column,
            other => return Err(format!("지원하지 않는 flex-direction: {other}")),
        },
        size: Size {
            width: style
                .width
                .map(Dimension::length)
                .unwrap_or(Dimension::auto()),
            height: style
                .height
                .map(Dimension::length)
                .unwrap_or(Dimension::auto()),
        },
        padding: style
            .padding
            .as_ref()
            .map(|p| Rect {
                top: LengthPercentage::length(p.top),
                right: LengthPercentage::length(p.right),
                bottom: LengthPercentage::length(p.bottom),
                left: LengthPercentage::length(p.left),
            })
            .unwrap_or(Rect::zero()),
        gap: style
            .gap
            .as_ref()
            .map(|g| Size {
                width: LengthPercentage::length(g.column),
                height: LengthPercentage::length(g.row),
            })
            .unwrap_or(Size::zero()),
        flex_grow: style.flex_grow.unwrap_or(0.0),
        ..Default::default()
    })
}

impl LayoutEngine for TaffyLayout {
    fn add_leaf(&mut self, id: u64, style: &StyleData) -> Result<(), String> {
        if self.nodes.contains_key(&id) {
            return Err(format!("중복 노드 ID: {id}"));
        }
        let node = self
            .tree
            .new_leaf(to_taffy(style)?)
            .map_err(|e| e.to_string())?;
        self.nodes.insert(id, node);
        Ok(())
    }

    fn add_parent(&mut self, id: u64, style: &StyleData, children: &[u64]) -> Result<(), String> {
        if self.nodes.contains_key(&id) {
            return Err(format!("중복 노드 ID: {id}"));
        }
        let children = children
            .iter()
            .map(|child| {
                self.nodes
                    .get(child)
                    .copied()
                    .ok_or_else(|| format!("없는 자식 노드: {child}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let node = self
            .tree
            .new_with_children(to_taffy(style)?, &children)
            .map_err(|e| e.to_string())?;
        self.nodes.insert(id, node);
        Ok(())
    }

    fn compute(&mut self, root: u64) -> Result<(), String> {
        let root = *self.nodes.get(&root).ok_or("없는 루트 노드")?;
        self.tree
            .compute_layout(root, Size::MAX_CONTENT)
            .map_err(|e| e.to_string())
    }

    fn frame(&self, id: u64) -> Result<(f32, f32, f32, f32), String> {
        let node = self.nodes.get(&id).ok_or("없는 노드")?;
        let layout = self.tree.layout(*node).map_err(|e| e.to_string())?;
        Ok((
            layout.location.x,
            layout.location.y,
            layout.size.width,
            layout.size.height,
        ))
    }
}

fn run() -> Result<(), String> {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "styles.json".into());
    let source = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let compiled: CompiledStyles = serde_json::from_str(&source).map_err(|e| e.to_string())?;
    if compiled.version != 1 {
        return Err(format!("지원하지 않는 스타일 버전: {}", compiled.version));
    }
    let screen = compiled
        .styles
        .get("screen")
        .ok_or(".screen 스타일이 없습니다")?;
    let card = compiled
        .styles
        .get("card")
        .ok_or(".card 스타일이 없습니다")?;
    let mut layout = TaffyLayout::new();
    layout.add_leaf(2, card)?;
    layout.add_parent(1, screen, &[2])?;
    layout.compute(1)?;
    for id in [1, 2] {
        let (x, y, width, height) = layout.frame(id)?;
        println!("노드 {id}: x={x}, y={y}, 너비={width}, 높이={height}");
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("오류: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_negative_width_from_json() {
        let style: StyleData = serde_json::from_str(r#"{"display":"flex","width":-2}"#).unwrap();
        assert!(to_taffy(&style).is_err());
    }

    #[test]
    fn reject_invalid_gap_from_json() {
        let style: StyleData =
            serde_json::from_str(r#"{"display":"flex","gap":{"row":-2,"column":3}}"#).unwrap();
        assert!(to_taffy(&style).is_err());
    }

    #[test]
    fn reject_unsupported_style_key() {
        let parsed: Result<StyleData, _> =
            serde_json::from_str(r#"{"display":"flex","color":"red"}"#);
        assert!(parsed.is_err());
    }
}
