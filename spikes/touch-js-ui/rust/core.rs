use std::ffi::{c_char, c_void, CStr};

#[repr(C)]
struct BosonRuntime { _private: [u8; 0] }

type TextCallback = extern "C" fn(*mut c_void, *const c_char);

unsafe extern "C" {
    fn boson_runtime_new(callback: extern "C" fn(*mut c_void, i32, *const c_char), user_data: *mut c_void) -> *mut BosonRuntime;
    fn boson_runtime_set_text_callback(runtime: *mut BosonRuntime, callback: TextCallback, user_data: *mut c_void);
    fn boson_runtime_eval(runtime: *mut BosonRuntime, source: *const c_char) -> i32;
    fn boson_runtime_dispatch(runtime: *mut BosonRuntime, node_id: i32) -> i32;
    fn boson_runtime_last_error(runtime: *mut BosonRuntime) -> *const c_char;
    fn boson_runtime_free(runtime: *mut BosonRuntime);
}

extern "C" fn on_node(_: *mut c_void, id: i32, tag: *const c_char) {
    let tag = unsafe { CStr::from_ptr(tag) }.to_string_lossy();
    println!("node={id} tag={tag}");
}

#[unsafe(no_mangle)]
pub extern "C" fn boson_touch_new(source: *const c_char, callback: TextCallback, user_data: *mut c_void) -> *mut c_void {
    if source.is_null() { return std::ptr::null_mut(); }
    let runtime = unsafe { boson_runtime_new(on_node, std::ptr::null_mut()) };
    if runtime.is_null() { return std::ptr::null_mut(); }
    unsafe { boson_runtime_set_text_callback(runtime, callback, user_data) };
    if unsafe { boson_runtime_eval(runtime, source) } != 0 {
        eprintln!("JS: {}", unsafe { CStr::from_ptr(boson_runtime_last_error(runtime)) }.to_string_lossy());
        unsafe { boson_runtime_free(runtime) };
        return std::ptr::null_mut();
    }
    runtime.cast()
}

#[unsafe(no_mangle)]
pub extern "C" fn boson_touch_dispatch(runtime: *mut c_void, node_id: i32) -> i32 {
    unsafe { boson_runtime_dispatch(runtime.cast(), node_id) }
}

#[unsafe(no_mangle)]
pub extern "C" fn boson_touch_last_error(runtime: *mut c_void) -> *const c_char {
    unsafe { boson_runtime_last_error(runtime.cast()) }
}

#[unsafe(no_mangle)]
pub extern "C" fn boson_touch_free(runtime: *mut c_void) {
    unsafe { boson_runtime_free(runtime.cast()) };
}
