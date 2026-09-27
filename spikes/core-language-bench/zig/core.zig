const std = @import("std");
const allocator = std.heap.c_allocator;

const Node = struct { id: i32, height: i32, text: [16]u8 };
comptime { if (@sizeOf(Node) != 24) @compileError("Node must be 24 bytes"); }
const Tree = struct { nodes: []Node };

noinline fn snapshot_sum(nodes: []Node) u64 {
    var sum: u64 = 0;
    for (nodes) |*node| {
        const byte: *volatile const u8 = @ptrCast(&node.text[0]);
        sum +%= byte.*;
    }
    return sum;
}

pub export fn bench_new(count: i32) ?*anyopaque {
    if (count <= 0) return null;
    const tree = allocator.create(Tree) catch return null;
    tree.nodes = allocator.alloc(Node, @intCast(count)) catch {
        allocator.destroy(tree);
        return null;
    };
    for (tree.nodes, 0..) |*node, i| {
        node.* = .{ .id = @intCast(i + 1), .height = 24 + @as(i32, @intCast(i % 3)), .text = .{0} ** 16 };
        node.text[0] = @truncate(i);
    }
    return @ptrCast(tree);
}
pub export fn bench_free(handle: ?*anyopaque) void {
    const ptr = handle orelse return;
    const tree: *Tree = @ptrCast(@alignCast(ptr));
    allocator.free(tree.nodes);
    allocator.destroy(tree);
}
pub export fn bench_step(handle: *anyopaque, iteration: u32, scan: i32) u64 {
    const tree: *Tree = @ptrCast(@alignCast(handle));
    const snapshot = allocator.dupe(Node, tree.nodes) catch unreachable;
    defer allocator.free(snapshot);
    const changed: usize = @as(usize, iteration) % tree.nodes.len;
    tree.nodes[changed].text[0] = @truncate(iteration);
    var y: i32 = 0;
    var hash: u64 = 0;
    for (0..tree.nodes.len) |i| {
        var node = &tree.nodes[i];
        if (scan != 0) {
            for (tree.nodes) |*candidate| {
                if (candidate.id == @as(i32, @intCast(i + 1))) {
                    node = candidate;
                    break;
                }
            }
        }
        const part: i32 = node.id * 31 + y * 7 + @as(i32, node.text[0]);
        hash = hash *% 131 +% @as(u64, @intCast(part));
        y += node.height + 1;
    }
    return hash +% snapshot_sum(snapshot);
}
