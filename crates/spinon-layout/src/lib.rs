mod error;
mod host_document;
mod tree_input;

use std::collections::{BTreeMap, BTreeSet, HashMap};

use spinon_core::{DocumentGeneration, DocumentRevision, NodeId, RenderTreeRevision, Revision};
use taffy::prelude::{
    AlignItems, AvailableSpace, Dimension, Display, FlexDirection as TaffyFlexDirection, FlexWrap,
    LengthPercentage, Rect, Size, Style, TaffyTree,
};
use taffy::style::{BoxSizing, Direction as TaffyDirection};

pub use error::LayoutError;

/// 루트 기준으로 계산할 고정 화면 크기입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Viewport {
    pub width: f32,
    pub height: f32,
}

/// 축에 지정할 크기입니다. 고정 값은 CSS px·Android dp·iOS point 변환 전의 레이아웃 값입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LayoutDimension {
    Auto,
    Fixed(f32),
}

/// Flex 자식 배치의 주축입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FlexDirection {
    Row,
    Column,
}

/// 가로 방향의 순서와 시작점을 정합니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TextDirection {
    Ltr,
    Rtl,
}

/// 네 방향의 내부 여백입니다.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LayoutEdges {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

/// Flex 행·열 사이의 간격입니다.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LayoutGap {
    pub row: f32,
    pub column: f32,
}

/// 이 초기 내부 계약이 표현하는 제한된 Flex 스타일입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutStyle {
    pub width: LayoutDimension,
    pub height: LayoutDimension,
    pub flex_direction: FlexDirection,
    pub direction: TextDirection,
    pub padding: LayoutEdges,
    pub gap: LayoutGap,
    pub flex_grow: f32,
}

impl Default for LayoutStyle {
    fn default() -> Self {
        Self {
            width: LayoutDimension::Auto,
            height: LayoutDimension::Auto,
            flex_direction: FlexDirection::Column,
            direction: TextDirection::Ltr,
            padding: LayoutEdges::default(),
            gap: LayoutGap::default(),
            flex_grow: 0.0,
        }
    }
}

/// 부모와 자식 ID 순서 및 레이아웃 스타일을 묶은 입력 노드입니다.
#[derive(Clone, Debug, PartialEq)]
pub struct LayoutNode {
    pub id: NodeId,
    pub children: Vec<NodeId>,
    pub style: LayoutStyle,
}

/// 한 번의 전체 레이아웃 계산 입력입니다.
#[derive(Clone, Debug, PartialEq)]
pub struct LayoutInput {
    root: NodeId,
    source_revision: LayoutSourceRevision,
    viewport: Viewport,
    nodes: Vec<LayoutNode>,
}

impl LayoutInput {
    pub const fn root(&self) -> NodeId {
        self.root
    }

    pub const fn source_revision(&self) -> LayoutSourceRevision {
        self.source_revision
    }

    pub const fn viewport(&self) -> Viewport {
        self.viewport
    }

    pub fn nodes(&self) -> &[LayoutNode] {
        &self.nodes
    }
}

/// 레이아웃 입력을 만든 코어 snapshot의 revision 출처입니다.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutSourceRevision {
    /// S01의 단순 트리 snapshot입니다.
    Tree(Revision),
    /// 혼합 노드를 지원하는 HostDocument snapshot입니다.
    HostDocument {
        generation: DocumentGeneration,
        document: DocumentRevision,
        render_tree: RenderTreeRevision,
    },
}

impl Default for LayoutSourceRevision {
    fn default() -> Self {
        Self::Tree(Revision::default())
    }
}

/// 화면 루트 왼쪽 위 기준의 절대 프레임입니다.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutFrame {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// 성공한 한 번의 계산에서 반환한 모든 노드의 프레임입니다.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayoutOutput {
    pub source_revision: LayoutSourceRevision,
    pub frames: BTreeMap<NodeId, LayoutFrame>,
}

/// 입력 트리를 검증하고 논리 단위 프레임을 반환하는 내부 엔진 경계입니다.
pub trait LayoutEngine {
    fn compute(&self, input: &LayoutInput) -> Result<LayoutOutput, LayoutError>;
}

/// Taffy Flexbox 기반의 현재 내부 엔진입니다.
#[derive(Clone, Copy, Debug, Default)]
pub struct TaffyLayoutEngine;

impl LayoutEngine for TaffyLayoutEngine {
    fn compute(&self, input: &LayoutInput) -> Result<LayoutOutput, LayoutError> {
        let index = validate(input)?;
        let postorder = postorder(input, &index)?;
        let mut tree = TaffyTree::<()>::with_capacity(input.nodes.len());
        tree.disable_rounding();
        let mut engine_ids = HashMap::with_capacity(input.nodes.len());

        for external_id in postorder {
            let node = &input.nodes[index[&external_id]];
            let children = node
                .children
                .iter()
                .map(|child| engine_ids[child])
                .collect::<Vec<_>>();
            let engine_id = tree
                .new_with_children(to_taffy_style(node.style), &children)
                .map_err(|error| LayoutError::Taffy(error.to_string()))?;
            engine_ids.insert(external_id, engine_id);
        }

        let engine_root = engine_ids[&input.root];
        let compute_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            tree.compute_layout(
                engine_root,
                Size {
                    width: AvailableSpace::Definite(input.viewport.width),
                    height: AvailableSpace::Definite(input.viewport.height),
                },
            )
        }));
        match compute_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(LayoutError::Taffy(error.to_string())),
            Err(_) => return Err(LayoutError::TaffyPanicked),
        }

        collect_frames(input, &index, &engine_ids, &tree)
    }
}

fn validate(input: &LayoutInput) -> Result<BTreeMap<NodeId, usize>, LayoutError> {
    if !input.viewport.width.is_finite()
        || !input.viewport.height.is_finite()
        || input.viewport.width <= 0.0
        || input.viewport.height <= 0.0
    {
        return Err(LayoutError::InvalidViewport);
    }

    let mut index = BTreeMap::new();
    for (position, node) in input.nodes.iter().enumerate() {
        if index.insert(node.id, position).is_some() {
            return Err(LayoutError::DuplicateNode(node.id));
        }
    }
    let Some(&root_position) = index.get(&input.root) else {
        return Err(LayoutError::MissingRoot(input.root));
    };

    for node in &input.nodes {
        validate_style(node)?;
    }

    let root = &input.nodes[root_position];
    if root.style.width != LayoutDimension::Fixed(input.viewport.width) {
        return Err(LayoutError::RootSizeMismatch { axis: "width" });
    }
    if root.style.height != LayoutDimension::Fixed(input.viewport.height) {
        return Err(LayoutError::RootSizeMismatch { axis: "height" });
    }

    let mut parent_count = BTreeMap::<NodeId, usize>::new();
    for node in &input.nodes {
        let mut child_set = BTreeSet::new();
        for &child in &node.children {
            if !index.contains_key(&child) {
                return Err(LayoutError::MissingChild {
                    parent: node.id,
                    child,
                });
            }
            if !child_set.insert(child) {
                return Err(LayoutError::DuplicateChild {
                    parent: node.id,
                    child,
                });
            }
            if child == input.root {
                return Err(LayoutError::RootHasParent(input.root));
            }
            *parent_count.entry(child).or_default() += 1;
            if parent_count[&child] > 1 {
                return Err(LayoutError::MultipleParents(child));
            }
        }
    }

    for &id in index.keys() {
        if id == input.root {
            continue;
        }
        if !parent_count.contains_key(&id) {
            return Err(LayoutError::DetachedNode(id));
        }
    }

    detect_cycles(input, &index)?;
    let mut reachable = BTreeSet::new();
    let mut pending = vec![input.root];
    while let Some(id) = pending.pop() {
        if reachable.insert(id) {
            pending.extend(input.nodes[index[&id]].children.iter().copied());
        }
    }
    if let Some(id) = index.keys().find(|id| !reachable.contains(id)) {
        return Err(LayoutError::UnreachableNode(*id));
    }

    Ok(index)
}

fn validate_style(node: &LayoutNode) -> Result<(), LayoutError> {
    let valid_dimension = |dimension| match dimension {
        LayoutDimension::Auto => true,
        LayoutDimension::Fixed(value) => value.is_finite() && value >= 0.0,
    };
    if !valid_dimension(node.style.width) {
        return Err(LayoutError::InvalidStyle {
            node: node.id,
            field: "width",
        });
    }
    if !valid_dimension(node.style.height) {
        return Err(LayoutError::InvalidStyle {
            node: node.id,
            field: "height",
        });
    }
    for (field, value) in [
        ("padding.top", node.style.padding.top),
        ("padding.right", node.style.padding.right),
        ("padding.bottom", node.style.padding.bottom),
        ("padding.left", node.style.padding.left),
        ("gap.row", node.style.gap.row),
        ("gap.column", node.style.gap.column),
        ("flex_grow", node.style.flex_grow),
    ] {
        if !value.is_finite() || value < 0.0 {
            return Err(LayoutError::InvalidStyle {
                node: node.id,
                field,
            });
        }
    }
    Ok(())
}

fn detect_cycles(input: &LayoutInput, index: &BTreeMap<NodeId, usize>) -> Result<(), LayoutError> {
    let mut visited = BTreeSet::new();
    for &start in index.keys() {
        if visited.contains(&start) {
            continue;
        }
        let mut active = BTreeSet::new();
        let mut pending = vec![(start, false)];
        while let Some((id, exiting)) = pending.pop() {
            if exiting {
                active.remove(&id);
                visited.insert(id);
                continue;
            }
            if visited.contains(&id) {
                continue;
            }
            if !active.insert(id) {
                return Err(LayoutError::Cycle(id));
            }
            pending.push((id, true));
            for &child in input.nodes[index[&id]].children.iter().rev() {
                if active.contains(&child) {
                    return Err(LayoutError::Cycle(child));
                }
                if !visited.contains(&child) {
                    pending.push((child, false));
                }
            }
        }
    }
    Ok(())
}

fn postorder(
    input: &LayoutInput,
    index: &BTreeMap<NodeId, usize>,
) -> Result<Vec<NodeId>, LayoutError> {
    let mut output = Vec::with_capacity(input.nodes.len());
    let mut visited = BTreeSet::new();
    let mut pending = vec![(input.root, false)];
    while let Some((id, exiting)) = pending.pop() {
        if exiting {
            output.push(id);
            continue;
        }
        if !visited.insert(id) {
            continue;
        }
        pending.push((id, true));
        for &child in input.nodes[index[&id]].children.iter().rev() {
            pending.push((child, false));
        }
    }
    if output.len() != input.nodes.len() {
        return Err(LayoutError::UnreachableNode(
            index
                .keys()
                .find(|id| !visited.contains(id))
                .copied()
                .unwrap_or(input.root),
        ));
    }
    Ok(output)
}

fn to_taffy_style(style: LayoutStyle) -> Style {
    Style {
        display: Display::Flex,
        box_sizing: BoxSizing::BorderBox,
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
        flex_direction: match style.flex_direction {
            FlexDirection::Row => TaffyFlexDirection::Row,
            FlexDirection::Column => TaffyFlexDirection::Column,
        },
        flex_wrap: FlexWrap::NoWrap,
        flex_grow: style.flex_grow,
        flex_shrink: 0.0,
        ..Default::default()
    }
}

fn to_taffy_dimension(dimension: LayoutDimension) -> Dimension {
    match dimension {
        LayoutDimension::Auto => Dimension::auto(),
        LayoutDimension::Fixed(value) => Dimension::length(value),
    }
}

fn collect_frames(
    input: &LayoutInput,
    index: &BTreeMap<NodeId, usize>,
    engine_ids: &HashMap<NodeId, taffy::prelude::NodeId>,
    tree: &TaffyTree<()>,
) -> Result<LayoutOutput, LayoutError> {
    let mut frames = BTreeMap::new();
    let mut pending = vec![(input.root, 0.0_f32, 0.0_f32)];
    while let Some((external_id, parent_x, parent_y)) = pending.pop() {
        let engine_id = engine_ids[&external_id];
        let layout = tree
            .layout(engine_id)
            .map_err(|_| LayoutError::MissingComputedLayout(external_id))?;
        let frame = LayoutFrame {
            x: parent_x + layout.location.x,
            y: parent_y + layout.location.y,
            width: layout.size.width,
            height: layout.size.height,
        };
        if [frame.x, frame.y, frame.width, frame.height]
            .into_iter()
            .any(|value| !value.is_finite())
        {
            return Err(LayoutError::NonFiniteFrame(external_id));
        }
        frames.insert(external_id, frame);
        let node = &input.nodes[index[&external_id]];
        for &child in node.children.iter().rev() {
            pending.push((child, frame.x, frame.y));
        }
    }
    Ok(LayoutOutput {
        source_revision: input.source_revision,
        frames,
    })
}

#[cfg(test)]
mod tests;
