extern fn exit(status: c_int) noreturn;

pub fn main() void {
    exit(@import("core.zig").boson_run());
}
