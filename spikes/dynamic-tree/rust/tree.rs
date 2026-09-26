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

#[derive(Clone)]
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

#[derive(Clone, Default)]
pub struct Tree { nodes: Vec<Node> }

type FrameCallback = extern "C" fn(*mut c_void, i32, *const c_char, *const c_char, i32, i32, i32, i32);

#[unsafe(no_mangle)]
pub extern "C" fn boson_tree_new() -> *mut Tree { Box::into_raw(Box::new(Tree::default())) }

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_free(tree: *mut Tree) {
    if !tree.is_null() { drop(unsafe { Box::from_raw(tree) }); }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_clone(tree: *const Tree) -> *mut Tree {
    let Some(tree) = (unsafe { tree.as_ref() }) else { return std::ptr::null_mut() };
    Box::into_raw(Box::new(tree.clone()))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn boson_tree_restore(tree: *mut Tree, snapshot: *mut Tree) -> i32 {
    let (Some(tree), Some(snapshot)) = (unsafe { tree.as_mut() }, unsafe { snapshot.as_ref() }) else { return -1 };
    *tree = snapshot.clone();
    0
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
        }).fold(0_i32, i32::saturating_add);
        let free = main.saturating_sub(fixed).saturating_sub(gap_total).max(0);
        let grow_total: i32 = children.iter().map(|child| child.grow).fold(0_i32, i32::saturating_add);
        let mut cursor = if horizontal { x.saturating_add(node.padding) } else { y.saturating_add(node.padding) };
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
                (cursor, y.saturating_add(node.padding), main_size, cross_size)
            } else {
                (x.saturating_add(node.padding), cursor, cross_size, main_size)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Eq)]
    struct Frame { id: i32, x: i32, y: i32, width: i32, height: i32 }

    extern "C" fn collect(user_data: *mut c_void, id: i32, _: *const c_char,
                          _: *const c_char, x: i32, y: i32, width: i32, height: i32) {
        let frames = unsafe { &mut *(user_data as *mut Vec<Frame>) };
        frames.push(Frame { id, x, y, width, height });
    }

    fn frames(tree: &Tree, width: i32, height: i32) -> Vec<Frame> {
        let mut result = Vec::new();
        assert_eq!(unsafe { boson_tree_layout(tree, width, height, collect,
            (&mut result as *mut Vec<Frame>).cast()) }, 0);
        result
    }

    fn create(tree: &mut Tree, id: i32, parent: i32, tag: &str, order: i32) -> i32 {
        let tag = CString::new(tag).unwrap();
        unsafe { boson_tree_create(tree, id, parent, tag.as_ptr(), order) }
    }

    #[test]
    fn invalid_ids_and_parents_leave_tree_unchanged() {
        let mut tree = Tree::default();
        assert_eq!(create(&mut tree, 2, 1, "text", 0), -1);
        assert_eq!(create(&mut tree, 1, 0, "text", 0), -1);
        assert_eq!(create(&mut tree, 1, 0, "column", 0), 0);
        assert_eq!(create(&mut tree, 1, 0, "row", 0), -1);
        assert_eq!(create(&mut tree, 2, 99, "text", 0), -1);
        assert_eq!(create(&mut tree, 2, 1, "unsupported", 0), -1);
        assert_eq!(create(&mut tree, 2, 1, "text", 0), 0);
        assert_eq!(create(&mut tree, 3, 2, "text", 0), -1);
        assert_eq!(tree.nodes.len(), 2);
    }

    #[test]
    fn subtree_deletion_and_id_reuse() {
        let mut tree = Tree::default();
        assert_eq!(create(&mut tree, 1, 0, "column", 0), 0);
        assert_eq!(create(&mut tree, 2, 1, "row", 0), 0);
        assert_eq!(create(&mut tree, 3, 2, "text", 0), 0);
        assert_eq!(create(&mut tree, 4, 1, "text", 1), 0);
        assert_eq!(unsafe { boson_tree_remove(&mut tree, 2) }, 0);
        assert_eq!(frames(&tree, 200, 200).iter().map(|frame| frame.id).collect::<Vec<_>>(), vec![1, 4]);
        assert_eq!(create(&mut tree, 3, 1, "button", 2), 0);
        assert_eq!(unsafe { boson_tree_remove(&mut tree, 2) }, -1);
        assert_eq!(unsafe { boson_tree_remove(&mut tree, 1) }, 0);
        assert!(tree.nodes.is_empty());
        assert_eq!(create(&mut tree, 1, 0, "row", 0), 0);
    }

    #[test]
    fn nested_order_gap_and_flex_layout() {
        let mut tree = Tree::default();
        create(&mut tree, 1, 0, "column", 0);
        create(&mut tree, 2, 1, "text", 0);
        create(&mut tree, 3, 1, "row", 20);
        create(&mut tree, 4, 1, "text", 10);
        create(&mut tree, 5, 3, "text", 0);
        create(&mut tree, 6, 3, "text", 1);
        unsafe {
            boson_tree_set_style(&mut tree, 1, -1, -1, 10, 5, 0);
            boson_tree_set_style(&mut tree, 2, -1, 20, 0, 0, 0);
            boson_tree_set_style(&mut tree, 3, -1, 40, 0, 8, 0);
            boson_tree_set_style(&mut tree, 4, -1, 30, 0, 0, 0);
            boson_tree_set_style(&mut tree, 5, -1, -1, 0, 0, 1);
            boson_tree_set_style(&mut tree, 6, -1, -1, 0, 0, 1);
        }
        assert_eq!(frames(&tree, 200, 200), vec![
            Frame { id: 1, x: 0, y: 0, width: 200, height: 200 },
            Frame { id: 2, x: 10, y: 10, width: 180, height: 20 },
            Frame { id: 4, x: 10, y: 35, width: 180, height: 30 },
            Frame { id: 3, x: 10, y: 70, width: 180, height: 40 },
            Frame { id: 5, x: 10, y: 70, width: 86, height: 40 },
            Frame { id: 6, x: 104, y: 70, width: 86, height: 40 },
        ]);
    }

    #[test]
    fn overfull_and_extreme_dimensions_do_not_panic() {
        let mut tree = Tree::default();
        create(&mut tree, 1, 0, "column", 0);
        create(&mut tree, 2, 1, "text", 0);
        create(&mut tree, 3, 1, "text", 1);
        unsafe {
            boson_tree_set_style(&mut tree, 1, -1, -1, 100, i32::MAX, 0);
            boson_tree_set_style(&mut tree, 2, -1, i32::MAX, 0, 0, 0);
            boson_tree_set_style(&mut tree, 3, -1, i32::MAX, 0, 0, 0);
        }
        let result = frames(&tree, 100, 100);
        assert_eq!(result.len(), 3);
        assert!(result.iter().all(|frame| frame.width >= 0 && frame.height >= 0));
    }

    #[test]
    fn one_thousand_nodes_can_be_laid_out_and_removed() {
        let mut tree = Tree::default();
        create(&mut tree, 1, 0, "column", 0);
        for id in 2..=1001 { assert_eq!(create(&mut tree, id, 1, "text", id), 0); }
        assert_eq!(frames(&tree, 400, 800).len(), 1001);
        assert_eq!(unsafe { boson_tree_remove(&mut tree, 1) }, 0);
        assert!(tree.nodes.is_empty());
    }

    #[test]
    fn failed_event_can_restore_tree_snapshot() {
        let mut tree = Tree::default();
        create(&mut tree, 1, 0, "column", 0);
        let snapshot = unsafe { boson_tree_clone(&tree) };
        create(&mut tree, 2, 1, "text", 0);
        assert_eq!(tree.nodes.len(), 2);
        assert_eq!(unsafe { boson_tree_restore(&mut tree, snapshot) }, 0);
        unsafe { boson_tree_free(snapshot) };
        assert_eq!(frames(&tree, 100, 100).len(), 1);
        assert_eq!(create(&mut tree, 2, 1, "text", 0), 0);
    }
}
