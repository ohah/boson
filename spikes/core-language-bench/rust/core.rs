use std::ffi::c_void;

#[derive(Clone, Copy)]
struct Node { id: i32, height: i32, text: [u8; 16] }
const _: () = assert!(std::mem::size_of::<Node>() == 24);
struct Tree { nodes: Vec<Node> }

#[inline(never)]
fn snapshot_sum(nodes: &[Node]) -> u64 {
    nodes.iter().map(|node| u64::from(unsafe { std::ptr::read_volatile(&node.text[0]) })).sum()
}

#[unsafe(no_mangle)]
pub extern "C" fn bench_new(count: i32) -> *mut c_void {
    if count <= 0 { return std::ptr::null_mut(); }
    let mut nodes = Vec::with_capacity(count as usize);
    for i in 0..count {
        let mut node = Node { id: i + 1, height: 24 + i % 3, text: [0; 16] };
        node.text[0] = i as u8;
        nodes.push(node);
    }
    Box::into_raw(Box::new(Tree { nodes })).cast()
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bench_free(handle: *mut c_void) {
    if !handle.is_null() { drop(unsafe { Box::from_raw(handle.cast::<Tree>()) }); }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bench_step(handle: *mut c_void, iteration: u32, scan: i32) -> u64 {
    let tree = unsafe { &mut *handle.cast::<Tree>() };
    let snapshot = tree.nodes.clone();
    let nodes = &mut tree.nodes;
    let changed = iteration as usize % nodes.len();
    nodes[changed].text[0] = iteration as u8;
    let mut y = 0_i32;
    let mut hash = 0_u64;
    for i in 0..nodes.len() {
        let node = if scan != 0 {
            nodes.iter().find(|candidate| candidate.id == (i + 1) as i32).unwrap()
        } else { &nodes[i] };
        hash = hash.wrapping_mul(131).wrapping_add((node.id * 31 + y * 7 + i32::from(node.text[0])) as u64);
        y += node.height + 1;
    }
    hash.wrapping_add(snapshot_sum(&snapshot))
}
