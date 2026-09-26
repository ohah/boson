extern fn boson_runtime_new(callback: *const fn (?*anyopaque, i32, [*:0]const u8) callconv(.c) void, user_data: ?*anyopaque) ?*anyopaque;
extern fn boson_runtime_set_text_callback(runtime: *anyopaque, callback: *const fn (?*anyopaque, [*:0]const u8) callconv(.c) void, user_data: ?*anyopaque) void;
extern fn boson_runtime_eval(runtime: *anyopaque, source: [*:0]const u8) i32;
extern fn boson_runtime_dispatch(runtime: *anyopaque, node_id: i32) i32;
extern fn boson_runtime_last_error(runtime: *anyopaque) [*:0]const u8;
extern fn boson_runtime_free(runtime: *anyopaque) void;
extern fn printf(format: [*:0]const u8, ...) c_int;
extern fn fflush(stream: ?*anyopaque) c_int;

const TextCallback = *const fn (?*anyopaque, [*:0]const u8) callconv(.c) void;

fn onNode(_: ?*anyopaque, id: i32, tag: [*:0]const u8) callconv(.c) void {
    _ = printf("node=%d tag=%s\n", id, tag);
    _ = fflush(null);
}

pub export fn boson_touch_new(source: [*:0]const u8, callback: TextCallback, user_data: ?*anyopaque) ?*anyopaque {
    const runtime = boson_runtime_new(onNode, null) orelse return null;
    boson_runtime_set_text_callback(runtime, callback, user_data);
    if (boson_runtime_eval(runtime, source) != 0) {
        _ = printf("JS: %s\n", boson_runtime_last_error(runtime));
        boson_runtime_free(runtime);
        return null;
    }
    return runtime;
}

pub export fn boson_touch_dispatch(runtime: ?*anyopaque, node_id: i32) i32 {
    const value = runtime orelse return -1;
    return boson_runtime_dispatch(value, node_id);
}

pub export fn boson_touch_last_error(runtime: ?*anyopaque) [*:0]const u8 {
    const value = runtime orelse return "null runtime";
    return boson_runtime_last_error(value);
}

pub export fn boson_touch_free(runtime: ?*anyopaque) void {
    if (runtime) |value| boson_runtime_free(value);
}
