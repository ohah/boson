use std::ffi::{CStr, CString, c_char, c_void};
use std::ptr;

#[repr(C)]
struct SpinonV8Runtime {
    _private: [u8; 0],
}

type NodeCallback = extern "C" fn(*mut c_void, i32, *const c_char);
type TextCallback = extern "C" fn(*mut c_void, *const c_char);

unsafe extern "C" {
    fn spinon_v8_runtime_new(
        node_callback: NodeCallback,
        text_callback: TextCallback,
        user_data: *mut c_void,
    ) -> *mut SpinonV8Runtime;
    fn spinon_v8_runtime_eval(runtime: *mut SpinonV8Runtime, source: *const c_char) -> i32;
    fn spinon_v8_runtime_dispatch(runtime: *mut SpinonV8Runtime, node_id: i32) -> i32;
    fn spinon_v8_runtime_last_error(runtime: *mut SpinonV8Runtime) -> *const c_char;
    fn spinon_v8_runtime_free(runtime: *mut SpinonV8Runtime);
}

#[derive(Default)]
struct CallbackState {
    created_nodes: u32,
    last_node_id: i32,
    last_tag: String,
    last_text: String,
}

impl CallbackState {
    fn report(&self) -> String {
        format!(
            "nodes={} last_node={} tag={} text={}",
            self.created_nodes, self.last_node_id, self.last_tag, self.last_text
        )
    }
}

extern "C" fn on_node(user_data: *mut c_void, node_id: i32, tag: *const c_char) {
    if user_data.is_null() || tag.is_null() {
        return;
    }
    // V8 invokes this synchronously on the thread that evaluates or dispatches JS.
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

fn copy_report(report: &str, output: &mut [u8]) -> bool {
    let bytes = report.as_bytes();
    if output.len() <= bytes.len() {
        if let Some(first) = output.first_mut() {
            *first = 0;
        }
        return false;
    }
    output[..bytes.len()].copy_from_slice(bytes);
    output[bytes.len()] = 0;
    true
}

fn last_error(runtime: *mut SpinonV8Runtime) -> String {
    let value = unsafe { spinon_v8_runtime_last_error(runtime) };
    if value.is_null() {
        return "V8 returned an empty error".to_owned();
    }
    unsafe { CStr::from_ptr(value) }
        .to_string_lossy()
        .into_owned()
}

/// V8를 만들고 예제 JavaScript를 평가한 뒤, 네이티브 콜백과 역방향 JS 이벤트를 실행합니다.
///
/// 이 함수와 `spinon` JavaScript 객체는 앱 빌드 연결을 검증하는 내부 smoke 경로입니다.
/// 제품 공개 API가 아닙니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_app_run(
    source: *const c_char,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    if source.is_null() || output.is_null() || output_capacity == 0 {
        return -1;
    }
    let source = unsafe { CStr::from_ptr(source) };

    let mut state = CallbackState::default();
    let state_ptr = ptr::addr_of_mut!(state).cast::<c_void>();
    let runtime = unsafe { spinon_v8_runtime_new(on_node, on_text, state_ptr) };
    if runtime.is_null() {
        return -2;
    }

    let mut v8_result = unsafe { spinon_v8_runtime_eval(runtime, source.as_ptr()) };
    if v8_result == 0 {
        // 부팅 smoke의 마지막 단계로 네이티브에서 JS 핸들러를 호출합니다.
        v8_result = unsafe { spinon_v8_runtime_dispatch(runtime, 7) };
    }

    let report = if v8_result == 0 {
        state.report()
    } else {
        format!("V8 error: {}", last_error(runtime))
    };
    let report = CString::new(report).expect("report contains no NUL bytes");
    let output_slice =
        unsafe { std::slice::from_raw_parts_mut(output.cast::<u8>(), output_capacity) };
    let copied = copy_report(
        report.to_str().unwrap_or("V8 report encoding error"),
        output_slice,
    );
    unsafe { spinon_v8_runtime_free(runtime) };

    if !copied {
        return -3;
    }
    if v8_result == 0 { 0 } else { -4 }
}

/// 명시적으로 실행된 개발용 Taffy 실험의 결과를 호출자 버퍼에 씁니다.
#[cfg(feature = "r10-experiment")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_taffy_r10_run(
    width: f32,
    height: f32,
    scale: f32,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    if output.is_null() || output_capacity == 0 {
        return -1;
    }

    let report = match spinon_style_layout_spike::r10::run_report(width, height, scale) {
        Ok(report) => report,
        Err(error) => {
            let report = CString::new(error).expect("오류 메시지에 NUL 바이트가 없습니다");
            let output_slice =
                unsafe { std::slice::from_raw_parts_mut(output.cast::<u8>(), output_capacity) };
            if !copy_report(
                report.to_str().unwrap_or("R10 오류 인코딩 실패"),
                output_slice,
            ) {
                return -3;
            }
            return -2;
        }
    };

    let output_slice =
        unsafe { std::slice::from_raw_parts_mut(output.cast::<u8>(), output_capacity) };
    if copy_report(&report, output_slice) {
        0
    } else {
        -3
    }
}

/// 일반 빌드에서는 Taffy 실험 코드를 연결하지 않고, 명시 실행 요청에 비활성 이유를 돌려줍니다.
#[cfg(not(feature = "r10-experiment"))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_taffy_r10_run(
    _width: f32,
    _height: f32,
    _scale: f32,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    if output.is_null() || output_capacity == 0 {
        return -1;
    }
    let output_slice =
        unsafe { std::slice::from_raw_parts_mut(output.cast::<u8>(), output_capacity) };
    if copy_report(
        "R10 실험이 꺼져 있습니다. SPINON_ENABLE_R10_EXPERIMENT=1로 다시 빌드하세요.",
        output_slice,
    ) {
        -4
    } else {
        -3
    }
}

#[cfg(test)]
mod tests {
    use super::{CallbackState, copy_report};
    use std::ffi::CStr;

    #[test]
    fn report_includes_callbacks_from_javascript() {
        let state = CallbackState {
            created_nodes: 2,
            last_node_id: 8,
            last_tag: "text".to_owned(),
            last_text: "이벤트:7".to_owned(),
        };
        assert_eq!(state.report(), "nodes=2 last_node=8 tag=text text=이벤트:7");
    }

    #[test]
    fn report_copy_is_nul_terminated_and_rejects_short_buffers() {
        let mut output = [0_u8; 8];
        assert!(!copy_report("too long", &mut output));
        assert_eq!(output[0], 0);

        let mut output = [0_u8; 5];
        assert!(copy_report("done", &mut output));
        assert_eq!(&output, b"done\0");
    }

    #[cfg(feature = "r10-experiment")]
    #[test]
    fn taffy_experiment_writes_a_machine_readable_success_report() {
        let mut output = [0_i8; 2048];
        let result = unsafe {
            super::spinon_taffy_r10_run(402.0, 874.0, 3.0, output.as_mut_ptr(), output.len())
        };
        assert_eq!(result, 0);
        let report = unsafe { CStr::from_ptr(output.as_ptr()) }.to_string_lossy();
        assert!(report.contains("rtl=PASS"));
        assert!(report.contains("text-metrics=synthetic"));
    }

    #[cfg(not(feature = "r10-experiment"))]
    #[test]
    fn taffy_experiment_is_excluded_from_default_builds() {
        let mut output = [0_i8; 128];
        let result = unsafe {
            super::spinon_taffy_r10_run(402.0, 874.0, 3.0, output.as_mut_ptr(), output.len())
        };
        assert_eq!(result, -4);
        let report = unsafe { CStr::from_ptr(output.as_ptr()) }.to_string_lossy();
        assert!(report.contains("SPINON_ENABLE_R10_EXPERIMENT=1"));
    }
}
