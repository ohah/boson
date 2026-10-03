use crate::host::DocumentCommitCallback;
use std::ffi::{c_char, c_void};

#[repr(C)]
pub(crate) struct SpinonV8Runtime {
    _private: [u8; 0],
}

pub(crate) type NodeCallback = extern "C" fn(*mut c_void, i32, *const c_char);
pub(crate) type TextCallback = extern "C" fn(*mut c_void, *const c_char);

unsafe extern "C" {
    pub(crate) fn spinon_v8_runtime_new(
        node_callback: NodeCallback,
        text_callback: TextCallback,
        document_commit_callback: DocumentCommitCallback,
        user_data: *mut c_void,
        document_user_data: *mut c_void,
    ) -> *mut SpinonV8Runtime;
    pub(crate) fn spinon_v8_runtime_eval(
        runtime: *mut SpinonV8Runtime,
        source: *const c_char,
    ) -> i32;
    pub(crate) fn spinon_v8_runtime_dispatch(runtime: *mut SpinonV8Runtime, node_id: i32) -> i32;
    pub(crate) fn spinon_v8_runtime_last_error(runtime: *mut SpinonV8Runtime) -> *const c_char;
    pub(crate) fn spinon_v8_runtime_was_terminated(runtime: *mut SpinonV8Runtime) -> i32;
    pub(crate) fn spinon_v8_runtime_free(runtime: *mut SpinonV8Runtime);
    pub(crate) fn spinon_v8_runtime_terminate(runtime: *mut SpinonV8Runtime);
    pub(crate) fn spinon_v8_runtime_cancel_termination(runtime: *mut SpinonV8Runtime);
    pub(crate) fn spinon_v8_current_thread_id() -> u64;
}
