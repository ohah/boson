use std::ffi::{CStr, CString, c_char, c_void};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind { Column, Row, Text, Button }

impl Kind {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "column" => Some(Self::Column),
            "row" => Some(Self::Row),
            "text" => Some(Self::Text),
            "button" => Some(Self::Button),
            _ => None,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Self::Column => "column", Self::Row => "row",
            Self::Text => "text", Self::Button => "button",
        }
    }
    fn default_height(self) -> i32 {
        match self { Self::Button => 64, Self::Row => 56, Self::Text => 48, Self::Column => 0 }
    }
}

struct Node {
    id: i32,
    parent: i32,
    order: i32,
    kind: Kind,
    text: CString,
    width: i32,
    height: i32,
    padding: i32,
    gap: i32,
    grow: i32,
}

#[derive(Default)]
pub struct Tree { nodes: Vec<Node> }

type FrameCallback = extern "C" fn(*mut c_void, i32, *const c_char, *const c_char, i32, i32, i32, i32);

#[unsafe(no_mangle)]
pub extern "C" fn boson_tree_new() -> *mut Tree { Box::into_raw(Box::new(Tree::default())) }

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_free(tree: *mut Tree) {
    if !tree.is_null() { drop(unsafe { Box::from_raw(tree) }); }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_create(tree: *mut Tree, id: i32, parent: i32, tag: *const c_char, order: i32) -> i32 {
    let Some(tree) = (unsafe { tree.as_mut() }) else { return -1 };
    if tag.is_null() || id <= 0 || tree.nodes.iter().any(|node| node.id == id) { return -1 }
    let Ok(tag) = (unsafe { CStr::from_ptr(tag) }).to_str() else { return -1 };
    let Some(kind) = Kind::parse(tag) else { return -1 };
    if parent == 0 {
        if !tree.nodes.is_empty() || !matches!(kind, Kind::Row | Kind::Column) { return -1 }
    } else if !tree.nodes.iter().any(|node| node.id == parent && matches!(node.kind, Kind::Row | Kind::Column)) {
        return -1;
    }
    tree.nodes.push(Node { id, parent, order, kind, text: CString::default(), width: -1,
        height: -1, padding: 0, gap: 0, grow: 0 });
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_remove(tree: *mut Tree, id: i32) -> i32 {
    let Some(tree) = (unsafe { tree.as_mut() }) else { return -1 };
    if id <= 0 || !tree.nodes.iter().any(|node| node.id == id) { return -1 }
    let mut removed = vec![id];
    let mut index = 0;
    while index < removed.len() {
        let parent = removed[index];
        removed.extend(tree.nodes.iter().filter(|node| node.parent == parent).map(|node| node.id));
        index += 1;
    }
    tree.nodes.retain(|node| !removed.contains(&node.id));
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_set_text(tree: *mut Tree, id: i32, text: *const c_char) -> i32 {
    let Some(tree) = (unsafe { tree.as_mut() }) else { return -1 };
    if text.is_null() { return -1 }
    let Some(node) = tree.nodes.iter_mut().find(|node| node.id == id) else { return -1 };
    node.text = (unsafe { CStr::from_ptr(text) }).to_owned();
    0
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_set_style(tree: *mut Tree, id: i32, width: i32, height: i32,
    padding: i32, gap: i32, grow: i32) -> i32 {
    let Some(tree) = (unsafe { tree.as_mut() }) else { return -1 };
    let Some(node) = tree.nodes.iter_mut().find(|node| node.id == id) else { return -1 };
    if width < -1 || height < -1 || padding < 0 || gap < 0 || grow < 0 { return -1 }
    node.width = width; node.height = height; node.padding = padding; node.gap = gap; node.grow = grow;
    0
}

impl Tree {
    fn layout_node(&self, id: i32, x: i32, y: i32, width: i32, height: i32,
        callback: FrameCallback, user_data: *mut c_void) {
        let Some(node) = self.nodes.iter().find(|node| node.id == id) else { return };
        let tag = CString::new(node.kind.as_str()).unwrap();
        callback(user_data, id, tag.as_ptr(), node.text.as_ptr(), x, y, width, height);
        if !matches!(node.kind, Kind::Row | Kind::Column) { return }
        let mut children: Vec<&Node> = self.nodes.iter().filter(|child| child.parent == id).collect();
        children.sort_by_key(|child| (child.order, child.id));
        if children.is_empty() { return }
        let horizontal = node.kind == Kind::Row;
        let padding_twice = node.padding.saturating_mul(2);
        let inner_width = width.saturating_sub(padding_twice).max(0);
        let inner_height = height.saturating_sub(padding_twice).max(0);
        let main = if horizontal { inner_width } else { inner_height };
        let gap_total = node.gap.saturating_mul((children.len() - 1) as i32);
        let fixed: i32 = children.iter().map(|child| {
            let requested = if horizontal { child.width } else { child.height };
            if requested >= 0 { requested }
            else if child.grow > 0 { 0 }
            else if horizontal { 0 }
            else { child.kind.default_height() }
        }).sum();
        let free = main.saturating_sub(fixed).saturating_sub(gap_total).max(0);
        let grow_total: i32 = children.iter().map(|child| child.grow).sum();
        let mut cursor = if horizontal { x + node.padding } else { y + node.padding };
        for child in children {
            let requested = if horizontal { child.width } else { child.height };
            let fixed_main = if requested >= 0 { requested }
                else if child.grow > 0 { 0 }
                else if horizontal { 0 }
                else { child.kind.default_height() };
            let extra = if grow_total > 0 { free.saturating_mul(child.grow) / grow_total } else { 0 };
            let main_size = fixed_main.saturating_add(extra).max(0);
            let cross_requested = if horizontal { child.height } else { child.width };
            let cross_size = if cross_requested >= 0 { cross_requested }
                else if horizontal { inner_height } else { inner_width };
            let (child_x, child_y, child_w, child_h) = if horizontal {
                (cursor, y + node.padding, main_size, cross_size)
            } else {
                (x + node.padding, cursor, cross_size, main_size)
            };
            self.layout_node(child.id, child_x, child_y, child_w, child_h, callback, user_data);
            cursor = cursor.saturating_add(main_size).saturating_add(node.gap);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_layout(tree: *const Tree, width: i32, height: i32,
    callback: FrameCallback, user_data: *mut c_void) -> i32 {
    let Some(tree) = (unsafe { tree.as_ref() }) else { return -1 };
    if width <= 0 || height <= 0 || !tree.nodes.iter().any(|node| node.parent == 0) { return -1 }
    let root = tree.nodes.iter().find(|node| node.parent == 0).unwrap();
    tree.layout_node(root.id, 0, 0, width, height, callback, user_data);
    0
}
