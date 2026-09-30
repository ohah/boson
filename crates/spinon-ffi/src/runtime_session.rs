use spinon_runtime::{RuntimeSession, TaskPriority};
use std::ffi::{CStr, c_char};
use std::ptr;

const ERR_ARGUMENT: i32 = -1;
const ERR_OUTPUT_TOO_SMALL: i32 = -3;

#[repr(C)]
pub struct SpinonRuntimeSession {
    _private: [u8; 0],
}

fn task_priority_from_abi(value: i32) -> Option<TaskPriority> {
    match value {
        0 => Some(TaskPriority::UserBlocking),
        1 => Some(TaskPriority::UserVisible),
        2 => Some(TaskPriority::Background),
        _ => None,
    }
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

unsafe fn write_report(output: *mut c_char, capacity: usize, report: &str) -> bool {
    if output.is_null() || capacity == 0 {
        return false;
    }
    let output = unsafe { std::slice::from_raw_parts_mut(output.cast::<u8>(), capacity) };
    copy_report(report, output)
}

fn write_response(
    response: spinon_runtime::OperationResponse,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    if !unsafe { write_report(output, output_capacity, &response.report) } {
        return ERR_OUTPUT_TOO_SMALL;
    }
    response.status
}

/// 전용 V8 세션을 만들고 초기화 보고를 출력합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_new(
    output: *mut c_char,
    output_capacity: usize,
) -> *mut SpinonRuntimeSession {
    if output.is_null() || output_capacity == 0 {
        return ptr::null_mut();
    }
    let (session, report) = match RuntimeSession::new() {
        Ok(session) => session,
        Err(error) => {
            let _ = unsafe { write_report(output, output_capacity, &error) };
            return ptr::null_mut();
        }
    };
    if !unsafe { write_report(output, output_capacity, &report) } {
        drop(session);
        return ptr::null_mut();
    }
    Box::into_raw(Box::new(session)).cast::<SpinonRuntimeSession>()
}

/// 기본 우선순위로 JavaScript를 실행합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_eval(
    session: *mut SpinonRuntimeSession,
    source: *const c_char,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    unsafe {
        session_eval_with_priority(
            session,
            source,
            TaskPriority::UserVisible,
            output,
            output_capacity,
        )
    }
}

/// 지정한 논리 우선순위로 JavaScript를 실행합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_eval_with_priority(
    session: *mut SpinonRuntimeSession,
    source: *const c_char,
    priority: i32,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    let Some(priority) = task_priority_from_abi(priority) else {
        return ERR_ARGUMENT;
    };
    unsafe { session_eval_with_priority(session, source, priority, output, output_capacity) }
}

unsafe fn session_eval_with_priority(
    session: *mut SpinonRuntimeSession,
    source: *const c_char,
    priority: TaskPriority,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    if session.is_null() || source.is_null() || output.is_null() || output_capacity == 0 {
        return ERR_ARGUMENT;
    }
    let source = match unsafe { CStr::from_ptr(source) }.to_str() {
        Ok(source) => source,
        Err(_) => return ERR_ARGUMENT,
    };
    let response = unsafe { &*session.cast::<RuntimeSession>() }.eval(source, priority);
    write_response(response, output, output_capacity)
}

/// 이벤트 작업을 user-blocking 우선순위로 실행합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_dispatch(
    session: *mut SpinonRuntimeSession,
    node_id: i32,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    unsafe {
        session_dispatch_with_priority(
            session,
            node_id,
            TaskPriority::UserBlocking,
            output,
            output_capacity,
        )
    }
}

/// 지정한 논리 우선순위로 이벤트 작업을 실행합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_dispatch_with_priority(
    session: *mut SpinonRuntimeSession,
    node_id: i32,
    priority: i32,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    let Some(priority) = task_priority_from_abi(priority) else {
        return ERR_ARGUMENT;
    };
    unsafe { session_dispatch_with_priority(session, node_id, priority, output, output_capacity) }
}

unsafe fn session_dispatch_with_priority(
    session: *mut SpinonRuntimeSession,
    node_id: i32,
    priority: TaskPriority,
    output: *mut c_char,
    output_capacity: usize,
) -> i32 {
    if session.is_null() || output.is_null() || output_capacity == 0 {
        return ERR_ARGUMENT;
    }
    let response = unsafe { &*session.cast::<RuntimeSession>() }.dispatch(node_id, priority);
    write_response(response, output, output_capacity)
}

/// 실행 중인 JavaScript 취소를 런타임에 요청합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_cancel(session: *mut SpinonRuntimeSession) -> i32 {
    if session.is_null() {
        return ERR_ARGUMENT;
    }
    unsafe { &*session.cast::<RuntimeSession>() }.cancel()
}

/// 모든 세션 호출이 끝난 뒤 세션을 종료합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_free(session: *mut SpinonRuntimeSession) {
    if !session.is_null() {
        drop(unsafe { Box::from_raw(session.cast::<RuntimeSession>()) });
    }
}

#[cfg(test)]
mod tests {
    use super::{ERR_ARGUMENT, ERR_OUTPUT_TOO_SMALL, copy_report, task_priority_from_abi};
    use spinon_runtime::TaskPriority;
    use std::ptr;

    #[test]
    fn c_abi_priority_values_match_the_runtime_priorities() {
        assert_eq!(task_priority_from_abi(0), Some(TaskPriority::UserBlocking));
        assert_eq!(task_priority_from_abi(1), Some(TaskPriority::UserVisible));
        assert_eq!(task_priority_from_abi(2), Some(TaskPriority::Background));
        assert_eq!(task_priority_from_abi(3), None);
    }

    #[test]
    fn report_copy_is_nul_terminated_and_rejects_short_buffers() {
        let mut short = [0_u8; 4];
        assert!(!copy_report("four", &mut short));
        assert_eq!(short[0], 0);

        let mut exact = [0_u8; 5];
        assert!(copy_report("four", &mut exact));
        assert_eq!(&exact, b"four\0");

        assert_eq!(
            unsafe {
                super::spinon_runtime_session_eval_with_priority(
                    ptr::null_mut(),
                    c"".as_ptr(),
                    3,
                    ptr::null_mut(),
                    0,
                )
            },
            ERR_ARGUMENT
        );
        assert_ne!(ERR_OUTPUT_TOO_SMALL, ERR_ARGUMENT);
    }
}
