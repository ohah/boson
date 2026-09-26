use std::ffi::{c_char, c_void, CStr, CString};

#[repr(C)]
struct BosonRuntime { _private: [u8; 0] }

unsafe extern "C" {
    fn boson_runtime_new(callback: extern "C" fn(*mut c_void, i32, *const c_char), user_data: *mut c_void) -> *mut BosonRuntime;
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
pub extern "C" fn boson_run() -> i32 {
    let source = CString::new("boson.createNode(1, 'view'); boson.onEvent(id => boson.createNode(id + 1, 'text'));").unwrap();
    let runtime = unsafe { boson_runtime_new(on_node, std::ptr::null_mut()) };
    assert!(!runtime.is_null(), "V8 initialization failed");
    let mut result = unsafe { boson_runtime_eval(runtime, source.as_ptr()) };
    if result == 0 { result = unsafe { boson_runtime_dispatch(runtime, 1) }; }
    if result != 0 {
        eprintln!("{}", unsafe { CStr::from_ptr(boson_runtime_last_error(runtime)) }.to_string_lossy());
    }
    unsafe { boson_runtime_free(runtime) };
    if result != 0 { 1 } else { 0 }
}

fn main() { std::process::exit(boson_run()); }
