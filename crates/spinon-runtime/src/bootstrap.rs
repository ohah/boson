use crate::host::{HostDocumentBridge, commit_callback};
use crate::v8::{
    SpinonV8Runtime, spinon_v8_runtime_dispatch, spinon_v8_runtime_eval, spinon_v8_runtime_free,
    spinon_v8_runtime_last_error, spinon_v8_runtime_new,
};
use std::ffi::{CStr, CString, c_char, c_void};

#[derive(Debug)]
pub enum BootstrapSmokeError {
    RuntimeUnavailable,
    JavaScript(String),
}

struct CallbackState {
    created_nodes: u32,
    last_node_id: i32,
    last_tag: String,
    last_text: String,
    document: HostDocumentBridge,
}

impl CallbackState {
    fn new() -> Result<Self, String> {
        Ok(Self {
            created_nodes: 0,
            last_node_id: 0,
            last_tag: String::new(),
            last_text: String::new(),
            document: HostDocumentBridge::new()?,
        })
    }

    fn report(&self) -> String {
        format!(
            "nodes={} last_node={} tag={} text={} document_revision={} render_tree_revision={} document_nodes={}",
            self.created_nodes,
            self.last_node_id,
            self.last_tag,
            self.last_text,
            self.document.document_revision(),
            self.document.render_tree_revision(),
            self.document.node_count(),
        )
    }
}

extern "C" fn on_node(user_data: *mut c_void, node_id: i32, tag: *const c_char) {
    if user_data.is_null() || tag.is_null() {
        return;
    }
    let state = unsafe { &mut *user_data.cast::<CallbackState>() };
    let tag = unsafe { CStr::from_ptr(tag) }.to_string_lossy();
    state.created_nodes = state.created_nodes.saturating_add(1);
    state.last_node_id = node_id;
    state.last_tag = tag.into_owned();
}

extern "C" fn on_text(user_data: *mut c_void, text: *const c_char) {
    if user_data.is_null() || text.is_null() {
        return;
    }
    let state = unsafe { &mut *user_data.cast::<CallbackState>() };
    state.last_text = unsafe { CStr::from_ptr(text) }
        .to_string_lossy()
        .into_owned();
}

fn last_error(runtime: *mut SpinonV8Runtime) -> String {
    let error = unsafe { spinon_v8_runtime_last_error(runtime) };
    if error.is_null() {
        return "V8 오류 메시지가 비어 있습니다".to_owned();
    }
    unsafe { CStr::from_ptr(error) }
        .to_string_lossy()
        .into_owned()
}

/// 개발 부팅 확인에서 쓰는 V8 평가와 역방향 이벤트 호출을 수행합니다.
pub fn run_bootstrap_smoke(source: &str) -> Result<String, BootstrapSmokeError> {
    let source =
        CString::new(source).map_err(|error| BootstrapSmokeError::JavaScript(error.to_string()))?;
    let mut state = CallbackState::new().map_err(BootstrapSmokeError::JavaScript)?;
    let state_ptr = std::ptr::addr_of_mut!(state).cast::<c_void>();
    let document_ptr = std::ptr::addr_of_mut!(state.document).cast::<c_void>();
    let runtime = unsafe {
        spinon_v8_runtime_new(on_node, on_text, commit_callback, state_ptr, document_ptr)
    };
    if runtime.is_null() {
        return Err(BootstrapSmokeError::RuntimeUnavailable);
    }

    let mut result = unsafe { spinon_v8_runtime_eval(runtime, source.as_ptr()) };
    if result == 0 {
        result = unsafe { spinon_v8_runtime_dispatch(runtime, 7) };
    }
    let outcome = if result == 0 {
        Ok(state.report())
    } else {
        Err(BootstrapSmokeError::JavaScript(last_error(runtime)))
    };
    unsafe { spinon_v8_runtime_free(runtime) };
    outcome
}
