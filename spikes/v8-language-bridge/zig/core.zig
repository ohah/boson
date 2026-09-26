extern fn boson_runtime_new(callback: *const fn (?*anyopaque, i32, [*:0]const u8) callconv(.c) void, user_data: ?*anyopaque) ?*anyopaque;
extern fn boson_runtime_eval(runtime: *anyopaque, source: [*:0]const u8) i32;
extern fn boson_runtime_dispatch(runtime: *anyopaque, node_id: i32) i32;
extern fn boson_runtime_last_error(runtime: *anyopaque) [*:0]const u8;
extern fn boson_runtime_free(runtime: *anyopaque) void;
extern fn printf(format: [*:0]const u8, ...) c_int;
extern fn fflush(stream: ?*anyopaque) c_int;

fn onNode(_: ?*anyopaque, id: i32, tag: [*:0]const u8) callconv(.c) void {
    _ = printf("node=%d tag=%s\n", id, tag);
    _ = fflush(null);
}

pub export fn boson_run() c_int {
    const runtime = boson_runtime_new(onNode, null) orelse return 1;
    defer boson_runtime_free(runtime);
    var result = boson_runtime_eval(runtime, "boson.createNode(1, 'view'); boson.onEvent(id => boson.createNode(id + 1, 'text'));");
    if (result == 0) result = boson_runtime_dispatch(runtime, 1);
    if (result != 0) {
        _ = printf("%s\n", boson_runtime_last_error(runtime));
        return 1;
    }
    return 0;
}
