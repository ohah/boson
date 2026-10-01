use spinon_style::{UA_STYLESHEET, UA_STYLESHEET_PROFILE_ID};
#[cfg(feature = "r10-experiment")]
use std::ffi::CString;
use std::ffi::{CStr, c_char};

/// 앱 바이너리에 내장된 기본 스타일 프로필 식별자를 반환합니다.
///
/// 반환 포인터는 읽기 전용이며 프로세스가 끝날 때까지 유효합니다.
#[unsafe(no_mangle)]
pub extern "C" fn spinon_embedded_ua_stylesheet_profile_id() -> *const c_char {
    UA_STYLESHEET_PROFILE_ID.as_ptr()
}

/// 앱 바이너리에 내장된 기본 스타일 UTF-8 데이터의 시작 주소를 반환합니다.
///
/// 반환 포인터는 읽기 전용이며 프로세스가 끝날 때까지 유효합니다. 데이터 끝에는
/// NUL 바이트가 없으며 길이는 `spinon_embedded_ua_stylesheet_len()`으로 얻습니다.
#[unsafe(no_mangle)]
pub extern "C" fn spinon_embedded_ua_stylesheet_data() -> *const u8 {
    UA_STYLESHEET.as_ptr()
}

/// 앱 바이너리에 내장된 기본 스타일 UTF-8 데이터의 바이트 수를 반환합니다.
#[unsafe(no_mangle)]
pub extern "C" fn spinon_embedded_ua_stylesheet_len() -> usize {
    UA_STYLESHEET.len()
}

mod runtime_session;

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

fn write_report(output: *mut c_char, output_capacity: usize, report: &str) -> bool {
    if output.is_null() || output_capacity == 0 {
        return false;
    }
    let output = unsafe { std::slice::from_raw_parts_mut(output.cast::<u8>(), output_capacity) };
    copy_report(report, output)
}

/// V8를 만들고 예제 JavaScript를 평가한 뒤 네이티브 콜백과 역방향 JS 이벤트를 실행합니다.
///
/// 앱 빌드 연결을 검증하는 내부 smoke 경로이며 제품 공개 API가 아닙니다.
///
/// # Safety
///
/// `source`는 NUL 종료된 읽기 가능한 C 문자열을 가리켜야 합니다. `output`은
/// `output_capacity` 바이트만큼 쓸 수 있는 메모리를 가리켜야 합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_app_run(
    source: *const c_char,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    if source.is_null() || output.is_null() || output_capacity == 0 {
        return -1;
    }
    let source = unsafe { CStr::from_ptr(source) }.to_string_lossy();
    let (status, report) = match spinon_runtime::run_bootstrap_smoke(&source) {
        Ok(report) => (0, report),
        Err(spinon_runtime::BootstrapSmokeError::RuntimeUnavailable) => {
            (-2, "V8 Isolate를 만들지 못했습니다".to_owned())
        }
        Err(spinon_runtime::BootstrapSmokeError::JavaScript(error)) => {
            (-4, format!("V8 error: {error}"))
        }
    };
    if !write_report(output, output_capacity, &report) {
        return -3;
    }
    status
}

/// 실제 V8 세션에서 우선순위 선택과 동일 등급 FIFO를 확인하는 내부 진단 함수입니다.
///
/// # Safety
///
/// `output`은 `output_capacity` 바이트만큼 쓸 수 있는 메모리를 가리켜야 합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_priority_probe(
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    if output.is_null() || output_capacity == 0 {
        return -1;
    }
    let (status, report) = match spinon_runtime::run_priority_probe() {
        Ok(report) => (0, report),
        Err(error) => (-7, error),
    };
    if !write_report(output, output_capacity, &report) {
        return -3;
    }
    status
}

/// 명시적으로 실행된 개발용 Taffy 실험의 결과를 호출자 버퍼에 씁니다.
///
/// # Safety
///
/// `output`은 `output_capacity` 바이트만큼 쓸 수 있는 메모리를 가리켜야 합니다.
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
///
/// # Safety
///
/// `output`은 `output_capacity` 바이트만큼 쓸 수 있는 메모리를 가리켜야 합니다.
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
    use std::ffi::CStr;

    #[repr(C)]
    struct TestV8Runtime {
        _private: [u8; 0],
    }

    // FFI 테스트 바이너리의 네이티브 V8 참조를 해소하는 링크 스텁입니다.
    // 이 스텁은 V8 동작을 검증하지 않으며, 해당 검증은 런타임 테스트에서 따로 합니다.
    type NodeCallback = extern "C" fn(*mut std::ffi::c_void, i32, *const std::ffi::c_char);
    type TextCallback = extern "C" fn(*mut std::ffi::c_void, *const std::ffi::c_char);

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_runtime_new(
        _node_callback: NodeCallback,
        _text_callback: TextCallback,
        _user_data: *mut std::ffi::c_void,
    ) -> *mut TestV8Runtime {
        std::ptr::null_mut()
    }

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_runtime_eval(
        _runtime: *mut TestV8Runtime,
        _source: *const std::ffi::c_char,
    ) -> i32 {
        -1
    }

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_runtime_dispatch(_runtime: *mut TestV8Runtime, _node_id: i32) -> i32 {
        -1
    }

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_runtime_last_error(
        _runtime: *mut TestV8Runtime,
    ) -> *const std::ffi::c_char {
        c"테스트용 V8 오류".as_ptr()
    }

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_runtime_was_terminated(_runtime: *mut TestV8Runtime) -> i32 {
        0
    }

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_runtime_free(_runtime: *mut TestV8Runtime) {}

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_runtime_terminate(_runtime: *mut TestV8Runtime) {}

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_runtime_cancel_termination(_runtime: *mut TestV8Runtime) {}

    #[unsafe(no_mangle)]
    extern "C" fn spinon_v8_current_thread_id() -> u64 {
        1
    }

    #[test]
    fn embedded_ua_stylesheet_ffi_returns_stable_read_only_bytes() {
        let profile_id_pointer = super::spinon_embedded_ua_stylesheet_profile_id();
        assert_eq!(
            profile_id_pointer,
            super::spinon_embedded_ua_stylesheet_profile_id()
        );
        let profile_id = unsafe { CStr::from_ptr(profile_id_pointer) };
        assert_eq!(profile_id.to_bytes(), b"spinon-html-ua/0.1.0-draft");

        let data = super::spinon_embedded_ua_stylesheet_data();
        assert_eq!(data, super::spinon_embedded_ua_stylesheet_data());
        let length = super::spinon_embedded_ua_stylesheet_len();
        assert_eq!(length, super::spinon_embedded_ua_stylesheet_len());
        assert!(!data.is_null());
        assert!(length > 0);
        let bytes = unsafe { std::slice::from_raw_parts(data, length) };
        assert_eq!(bytes, super::UA_STYLESHEET.as_bytes());
        assert!(!bytes.contains(&0));
        assert!(std::str::from_utf8(bytes).is_ok());
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
