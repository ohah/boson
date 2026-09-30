use spinon_core::{PriorityQueue, TaskPriority};
use std::ffi::{CStr, CString, c_char, c_void};
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Instant;

const QUEUE_CAPACITY: usize = 64;
const OK: i32 = 0;
const ERR_ARGUMENT: i32 = -1;
const ERR_OUTPUT_TOO_SMALL: i32 = -3;
const ERR_JAVASCRIPT: i32 = -4;
const ERR_QUEUE_FULL: i32 = -5;
const ERR_CLOSED: i32 = -6;
const ERR_WORKER: i32 = -7;
const ERR_CANCELLED: i32 = -8;

struct SchedulerState {
    queue: PriorityQueue<Command>,
    stopped: bool,
}

struct TaskScheduler {
    state: Mutex<SchedulerState>,
    available: Condvar,
}

enum EnqueueError {
    Full,
    Stopped,
}

impl TaskScheduler {
    fn new() -> Self {
        Self {
            state: Mutex::new(SchedulerState {
                queue: PriorityQueue::new(),
                stopped: false,
            }),
            available: Condvar::new(),
        }
    }

    fn try_enqueue(&self, priority: TaskPriority, command: Command) -> Result<(), EnqueueError> {
        let mut state = lock(&self.state);
        if state.stopped {
            return Err(EnqueueError::Stopped);
        }
        if state.queue.len() >= QUEUE_CAPACITY {
            return Err(EnqueueError::Full);
        }

        state.queue.push(priority, command);
        self.available.notify_one();
        Ok(())
    }

    fn receive(&self) -> Option<Command> {
        let mut state = lock(&self.state);
        loop {
            if let Some(command) = state.queue.pop_next() {
                return Some(command);
            }

            if state.stopped {
                return None;
            }

            state = self
                .available
                .wait(state)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
    }

    fn stop(&self) {
        let mut state = lock(&self.state);
        state.stopped = true;
        self.available.notify_all();
    }
}

#[repr(C)]
pub struct SpinonRuntimeSession {
    _private: [u8; 0],
}

struct RuntimeControl {
    runtime: Option<usize>,
    active: bool,
    cancel_generation: u64,
    closing: bool,
}

impl RuntimeControl {
    fn new() -> Self {
        Self {
            runtime: None,
            active: false,
            cancel_generation: 0,
            closing: false,
        }
    }
}

struct Session {
    scheduler: Arc<TaskScheduler>,
    worker: Mutex<Option<JoinHandle<()>>>,
    control: Arc<Mutex<RuntimeControl>>,
    submission: Mutex<()>,
    next_sequence: AtomicU64,
}

enum Command {
    Eval {
        sequence: u64,
        source: CString,
        submitted_at: Instant,
        caller_thread_id: u64,
        reply: SyncSender<OperationResponse>,
    },
    Dispatch {
        sequence: u64,
        node_id: i32,
        submitted_at: Instant,
        caller_thread_id: u64,
        reply: SyncSender<OperationResponse>,
    },
}

struct OperationResponse {
    status: i32,
    report: String,
}

#[derive(Default)]
struct CallbackState {
    callback_count: u64,
    created_nodes: u64,
    last_node_id: i32,
    callback_thread_id: u64,
}

impl CallbackState {
    fn reset_operation(&mut self) {
        self.callback_count = 0;
        self.created_nodes = 0;
        self.last_node_id = 0;
        self.callback_thread_id = 0;
    }
}

unsafe extern "C" {
    fn spinon_v8_runtime_new(
        node_callback: NodeCallback,
        text_callback: TextCallback,
        user_data: *mut c_void,
    ) -> *mut SpinonV8Runtime;
    fn spinon_v8_runtime_eval(runtime: *mut SpinonV8Runtime, source: *const c_char) -> i32;
    fn spinon_v8_runtime_dispatch(runtime: *mut SpinonV8Runtime, node_id: i32) -> i32;
    fn spinon_v8_runtime_last_error(runtime: *mut SpinonV8Runtime) -> *const c_char;
    fn spinon_v8_runtime_was_terminated(runtime: *mut SpinonV8Runtime) -> i32;
    fn spinon_v8_runtime_free(runtime: *mut SpinonV8Runtime);
    fn spinon_v8_runtime_terminate(runtime: *mut SpinonV8Runtime);
    fn spinon_v8_runtime_cancel_termination(runtime: *mut SpinonV8Runtime);
    fn spinon_v8_current_thread_id() -> u64;
}

#[repr(C)]
struct SpinonV8Runtime {
    _private: [u8; 0],
}

type NodeCallback = extern "C" fn(*mut c_void, i32, *const c_char);
type TextCallback = extern "C" fn(*mut c_void, *const c_char);

extern "C" fn on_node(user_data: *mut c_void, node_id: i32, tag: *const c_char) {
    if user_data.is_null() || tag.is_null() {
        return;
    }
    let state = unsafe { &mut *user_data.cast::<CallbackState>() };
    let _tag = unsafe { CStr::from_ptr(tag) }.to_string_lossy();
    state.callback_count = state.callback_count.saturating_add(1);
    state.created_nodes = state.created_nodes.saturating_add(1);
    state.last_node_id = node_id;
    state.callback_thread_id = unsafe { spinon_v8_current_thread_id() };
}

extern "C" fn on_text(user_data: *mut c_void, text: *const c_char) {
    if user_data.is_null() || text.is_null() {
        return;
    }
    let state = unsafe { &mut *user_data.cast::<CallbackState>() };
    let _text = unsafe { CStr::from_ptr(text) }.to_string_lossy();
    state.callback_count = state.callback_count.saturating_add(1);
    state.callback_thread_id = unsafe { spinon_v8_current_thread_id() };
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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

fn current_thread_id() -> u64 {
    unsafe { spinon_v8_current_thread_id() }
}

fn v8_error(runtime: *mut SpinonV8Runtime) -> String {
    let error = unsafe { spinon_v8_runtime_last_error(runtime) };
    if error.is_null() {
        return "V8 오류 메시지가 비어 있습니다".to_owned();
    }
    unsafe { CStr::from_ptr(error) }
        .to_string_lossy()
        .replace(['\n', '\r'], " ")
}

fn actor_loop(
    scheduler: Arc<TaskScheduler>,
    control: Arc<Mutex<RuntimeControl>>,
    ready: mpsc::Sender<Result<u64, String>>,
) {
    let mut callbacks = CallbackState::default();
    let callback_data = ptr::addr_of_mut!(callbacks).cast::<c_void>();
    let runtime = unsafe { spinon_v8_runtime_new(on_node, on_text, callback_data) };
    if runtime.is_null() {
        let _ = ready.send(Err("V8 Isolate를 만들지 못했습니다".to_owned()));
        return;
    }

    let owner_thread_id = current_thread_id();
    {
        let mut state = lock(&control);
        state.runtime = Some(runtime as usize);
    }
    if ready.send(Ok(owner_thread_id)).is_err() {
        let mut state = lock(&control);
        state.runtime = None;
        drop(state);
        unsafe { spinon_v8_runtime_free(runtime) };
        return;
    }

    while let Some(command) = scheduler.receive() {
        match command {
            Command::Eval {
                sequence,
                source,
                submitted_at,
                caller_thread_id,
                reply,
            } => {
                let generation = match begin_execution(&control, runtime) {
                    Ok(generation) => generation,
                    Err(response) => {
                        let _ = reply.send(response);
                        continue;
                    }
                };
                callbacks.reset_operation();
                let queue_wait_us = submitted_at.elapsed().as_micros();
                let started_at = Instant::now();
                let v8_result = unsafe { spinon_v8_runtime_eval(runtime, source.as_ptr()) };
                let v8_call_us = started_at.elapsed().as_micros();
                let v8_was_terminated = unsafe { spinon_v8_runtime_was_terminated(runtime) != 0 };
                let error = if v8_result == 0 {
                    String::new()
                } else {
                    v8_error(runtime)
                };
                let cancel_requested = finish_execution(&control, runtime, generation);
                let status = if v8_result == 0 {
                    OK
                } else if cancel_requested && v8_was_terminated {
                    ERR_CANCELLED
                } else {
                    ERR_JAVASCRIPT
                };
                let report = operation_report(
                    sequence,
                    "eval",
                    status,
                    caller_thread_id,
                    owner_thread_id,
                    callbacks.callback_thread_id,
                    queue_wait_us,
                    v8_call_us,
                    cancel_requested,
                    &callbacks,
                    &error,
                );
                let _ = reply.send(OperationResponse { status, report });
            }
            Command::Dispatch {
                sequence,
                node_id,
                submitted_at,
                caller_thread_id,
                reply,
            } => {
                let generation = match begin_execution(&control, runtime) {
                    Ok(generation) => generation,
                    Err(response) => {
                        let _ = reply.send(response);
                        continue;
                    }
                };
                callbacks.reset_operation();
                let queue_wait_us = submitted_at.elapsed().as_micros();
                let started_at = Instant::now();
                let v8_result = unsafe { spinon_v8_runtime_dispatch(runtime, node_id) };
                let v8_call_us = started_at.elapsed().as_micros();
                let v8_was_terminated = unsafe { spinon_v8_runtime_was_terminated(runtime) != 0 };
                let error = if v8_result == 0 {
                    String::new()
                } else {
                    v8_error(runtime)
                };
                let cancel_requested = finish_execution(&control, runtime, generation);
                let status = if v8_result == 0 {
                    OK
                } else if cancel_requested && v8_was_terminated {
                    ERR_CANCELLED
                } else {
                    ERR_JAVASCRIPT
                };
                let report = operation_report(
                    sequence,
                    "dispatch",
                    status,
                    caller_thread_id,
                    owner_thread_id,
                    callbacks.callback_thread_id,
                    queue_wait_us,
                    v8_call_us,
                    cancel_requested,
                    &callbacks,
                    &error,
                );
                let _ = reply.send(OperationResponse { status, report });
            }
        }
    }

    {
        let mut state = lock(&control);
        state.active = false;
        state.runtime = None;
    }
    unsafe { spinon_v8_runtime_free(runtime) };
}

fn begin_execution(
    control: &Mutex<RuntimeControl>,
    runtime: *mut SpinonV8Runtime,
) -> Result<u64, OperationResponse> {
    let mut state = lock(control);
    if state.closing {
        return Err(OperationResponse {
            status: ERR_CLOSED,
            report: "세션 종료 중이라 명령을 실행하지 않았습니다".to_owned(),
        });
    }
    if state.runtime != Some(runtime as usize) || state.active {
        return Err(OperationResponse {
            status: ERR_WORKER,
            report: "실행기 소유권 상태가 올바르지 않습니다".to_owned(),
        });
    }
    state.active = true;
    Ok(state.cancel_generation)
}

fn finish_execution(
    control: &Mutex<RuntimeControl>,
    runtime: *mut SpinonV8Runtime,
    generation: u64,
) -> bool {
    let cancelled = {
        let mut state = lock(control);
        let cancelled = state.cancel_generation != generation;
        state.active = false;
        cancelled
    };
    if cancelled {
        // 취소 플래그 정리는 다음 V8 작업을 시작하기 전에 소유 스레드에서 수행합니다.
        unsafe { spinon_v8_runtime_cancel_termination(runtime) };
    }
    cancelled
}

fn operation_report(
    sequence: u64,
    operation: &str,
    status: i32,
    caller_thread_id: u64,
    owner_thread_id: u64,
    callback_thread_id: u64,
    queue_wait_us: u128,
    v8_call_us: u128,
    cancel_requested: bool,
    callbacks: &CallbackState,
    error: &str,
) -> String {
    let error = if error.is_empty() { "none" } else { error };
    format!(
        "seq={sequence} op={operation} status={status} caller_tid={caller_thread_id} owner_tid={owner_thread_id} callback_tid={callback_thread_id} queue_wait_us={queue_wait_us} v8_call_us={v8_call_us} cancel_requested={cancel_requested} callback_count={} created_nodes={} last_node_id={} error={error}",
        callbacks.callback_count, callbacks.created_nodes, callbacks.last_node_id,
    )
}

fn task_priority_from_abi(value: i32) -> Option<TaskPriority> {
    match value {
        0 => Some(TaskPriority::UserBlocking),
        1 => Some(TaskPriority::UserVisible),
        2 => Some(TaskPriority::Background),
        _ => None,
    }
}

fn submit(
    session: &Session,
    priority: TaskPriority,
    command: impl FnOnce(u64, Instant, u64, SyncSender<OperationResponse>) -> Command,
) -> OperationResponse {
    let (reply, response) = mpsc::sync_channel(1);
    let _submission = lock(&session.submission);
    if lock(&session.control).closing {
        return OperationResponse {
            status: ERR_CLOSED,
            report: "세션이 종료되었습니다".to_owned(),
        };
    }
    let sequence = session.next_sequence.fetch_add(1, Ordering::Relaxed) + 1;
    let submitted_at = Instant::now();
    let caller_thread_id = current_thread_id();
    match session.scheduler.try_enqueue(
        priority,
        command(sequence, submitted_at, caller_thread_id, reply),
    ) {
        Ok(()) => {}
        Err(EnqueueError::Full) => {
            return OperationResponse {
                status: ERR_QUEUE_FULL,
                report: format!("명령 큐가 가득 찼습니다 capacity={QUEUE_CAPACITY}"),
            };
        }
        Err(EnqueueError::Stopped) => {
            return OperationResponse {
                status: ERR_CLOSED,
                report: "V8 실행기 큐가 종료되었습니다".to_owned(),
            };
        }
    }
    drop(_submission);
    response.recv().unwrap_or_else(|_| OperationResponse {
        status: ERR_WORKER,
        report: "V8 실행기가 응답하기 전에 종료되었습니다".to_owned(),
    })
}

/// 실험용 장기 실행 V8 세션을 만들고 전용 OS 스레드에서 Isolate를 소유합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_new(
    output: *mut c_char,
    output_capacity: usize,
) -> *mut SpinonRuntimeSession {
    if output.is_null() || output_capacity == 0 {
        return ptr::null_mut();
    }
    let control = Arc::new(Mutex::new(RuntimeControl::new()));
    let worker_control = Arc::clone(&control);
    let scheduler = Arc::new(TaskScheduler::new());
    let worker_scheduler = Arc::clone(&scheduler);
    let (ready_sender, ready_receiver) = mpsc::channel();
    let worker = match thread::Builder::new()
        .name("spinon-js-runtime".to_owned())
        .spawn(move || actor_loop(worker_scheduler, worker_control, ready_sender))
    {
        Ok(worker) => worker,
        Err(error) => {
            let _ = unsafe {
                write_report(
                    output,
                    output_capacity,
                    &format!("실행기 스레드 생성 실패: {error}"),
                )
            };
            return ptr::null_mut();
        }
    };
    let owner_thread_id = match ready_receiver.recv() {
        Ok(Ok(thread_id)) => thread_id,
        Ok(Err(error)) => {
            let _ = worker.join();
            let _ = unsafe { write_report(output, output_capacity, &error) };
            return ptr::null_mut();
        }
        Err(_) => {
            let _ = worker.join();
            let _ = unsafe {
                write_report(
                    output,
                    output_capacity,
                    "V8 실행기 초기화 응답을 받지 못했습니다",
                )
            };
            return ptr::null_mut();
        }
    };
    let report = format!(
        "session=ready owner_tid={owner_thread_id} isolate_per_session=1 queue_capacity={QUEUE_CAPACITY} queue_policy=strict-priority-fifo"
    );
    if !unsafe { write_report(output, output_capacity, &report) } {
        {
            let mut state = lock(&control);
            state.closing = true;
        }
        scheduler.stop();
        let _ = worker.join();
        return ptr::null_mut();
    }
    let session = Box::new(Session {
        scheduler,
        worker: Mutex::new(Some(worker)),
        control,
        submission: Mutex::new(()),
        next_sequence: AtomicU64::new(0),
    });
    Box::into_raw(session).cast::<SpinonRuntimeSession>()
}

/// JavaScript를 전용 실행 스레드에 넣고 완료 보고를 기다립니다. UI 스레드에서 호출하지 마세요.
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

/// 내부 호출자가 JavaScript 평가 작업의 우선순위를 지정합니다.
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
    let source = unsafe { CStr::from_ptr(source) };
    let source = match CString::new(source.to_bytes()) {
        Ok(source) => source,
        Err(_) => return ERR_ARGUMENT,
    };
    let session = unsafe { &*session.cast::<Session>() };
    let response = submit(
        session,
        priority,
        |sequence, submitted_at, caller_thread_id, reply| Command::Eval {
            sequence,
            source,
            submitted_at,
            caller_thread_id,
            reply,
        },
    );
    if !unsafe { write_report(output, output_capacity, &response.report) } {
        return ERR_OUTPUT_TOO_SMALL;
    }
    response.status
}

/// 등록된 JavaScript 이벤트 함수를 전용 실행 스레드에서 호출합니다.
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

/// 내부 호출자가 이벤트 작업의 우선순위를 지정합니다.
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
    let session = unsafe { &*session.cast::<Session>() };
    let response = submit(
        session,
        priority,
        |sequence, submitted_at, caller_thread_id, reply| Command::Dispatch {
            sequence,
            node_id,
            submitted_at,
            caller_thread_id,
            reply,
        },
    );
    if !unsafe { write_report(output, output_capacity, &response.report) } {
        return ERR_OUTPUT_TOO_SMALL;
    }
    response.status
}

/// 실행 중인 JavaScript만 V8의 스레드 안전 종료 API로 중단합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_cancel(session: *mut SpinonRuntimeSession) -> i32 {
    if session.is_null() {
        return ERR_ARGUMENT;
    }
    let session = unsafe { &*session.cast::<Session>() };
    cancel_control(&session.control)
}

fn cancel_control(control: &Mutex<RuntimeControl>) -> i32 {
    let mut state = lock(control);
    if !state.active {
        return 1;
    }
    let Some(runtime) = state.runtime else {
        return ERR_WORKER;
    };
    state.cancel_generation = state.cancel_generation.wrapping_add(1);
    unsafe { spinon_v8_runtime_terminate(runtime as *mut SpinonV8Runtime) };
    OK
}

/// 호출자는 실행·취소 API를 모두 끝낸 뒤 이 함수를 불러야 합니다.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn spinon_runtime_session_free(session: *mut SpinonRuntimeSession) {
    if session.is_null() {
        return;
    }
    let session = unsafe { Box::from_raw(session.cast::<Session>()) };
    {
        let _submission = lock(&session.submission);
        lock(&session.control).closing = true;
    }
    let _ = cancel_control(&session.control);
    session.scheduler.stop();
    if let Some(worker) = lock(&session.worker).take() {
        let _ = worker.join();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CallbackState, Command, ERR_CANCELLED, ERR_QUEUE_FULL, EnqueueError, OK, QUEUE_CAPACITY,
        Session, SpinonRuntimeSession, TaskPriority, TaskScheduler, copy_report, operation_report,
        spinon_runtime_session_cancel, spinon_runtime_session_dispatch,
        spinon_runtime_session_dispatch_with_priority, spinon_runtime_session_eval,
        spinon_runtime_session_eval_with_priority, spinon_runtime_session_free,
        spinon_runtime_session_new,
    };
    use std::ffi::{CStr, CString, c_char, c_void};
    use std::hash::{Hash, Hasher};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    struct FakeV8Runtime {
        node_callback: super::NodeCallback,
        text_callback: super::TextCallback,
        user_data: usize,
        terminated: AtomicBool,
        was_terminated: AtomicBool,
        operation_order: Mutex<Vec<String>>,
    }

    unsafe impl Sync for FakeV8Runtime {}

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_runtime_new(
        node_callback: super::NodeCallback,
        text_callback: super::TextCallback,
        user_data: *mut c_void,
    ) -> *mut super::SpinonV8Runtime {
        Box::into_raw(Box::new(FakeV8Runtime {
            node_callback,
            text_callback,
            user_data: user_data as usize,
            terminated: AtomicBool::new(false),
            was_terminated: AtomicBool::new(false),
            operation_order: Mutex::new(Vec::new()),
        }))
        .cast::<super::SpinonV8Runtime>()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_runtime_eval(
        runtime: *mut super::SpinonV8Runtime,
        source: *const c_char,
    ) -> i32 {
        let runtime = unsafe { &*runtime.cast::<FakeV8Runtime>() };
        let source = unsafe { CStr::from_ptr(source) }.to_bytes();
        runtime.was_terminated.store(false, Ordering::Release);
        if source == b"hang" {
            while !runtime.terminated.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(1));
            }
            runtime.was_terminated.store(true, Ordering::Release);
            return -1;
        }
        runtime
            .operation_order
            .lock()
            .unwrap()
            .push(format!("eval:{}", String::from_utf8_lossy(source)));
        (runtime.node_callback)(runtime.user_data as *mut c_void, 7, c"view".as_ptr());
        (runtime.text_callback)(runtime.user_data as *mut c_void, c"ready".as_ptr());
        0
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_runtime_dispatch(
        runtime: *mut super::SpinonV8Runtime,
        node_id: i32,
    ) -> i32 {
        let runtime = unsafe { &*runtime.cast::<FakeV8Runtime>() };
        runtime.was_terminated.store(false, Ordering::Release);
        runtime
            .operation_order
            .lock()
            .unwrap()
            .push(format!("dispatch:{node_id}"));
        (runtime.node_callback)(
            runtime.user_data as *mut c_void,
            node_id + 1,
            c"text".as_ptr(),
        );
        0
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_runtime_was_terminated(
        runtime: *mut super::SpinonV8Runtime,
    ) -> i32 {
        let runtime = unsafe { &*runtime.cast::<FakeV8Runtime>() };
        i32::from(runtime.was_terminated.load(Ordering::Acquire))
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_runtime_last_error(
        _runtime: *mut super::SpinonV8Runtime,
    ) -> *const c_char {
        c"fake JavaScript error".as_ptr()
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_runtime_terminate(runtime: *mut super::SpinonV8Runtime) {
        let runtime = unsafe { &*runtime.cast::<FakeV8Runtime>() };
        runtime.terminated.store(true, Ordering::Release);
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_runtime_cancel_termination(runtime: *mut super::SpinonV8Runtime) {
        let runtime = unsafe { &*runtime.cast::<FakeV8Runtime>() };
        runtime.terminated.store(false, Ordering::Release);
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_runtime_free(runtime: *mut super::SpinonV8Runtime) {
        drop(unsafe { Box::from_raw(runtime.cast::<FakeV8Runtime>()) });
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn spinon_v8_current_thread_id() -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        thread::current().id().hash(&mut hasher);
        hasher.finish()
    }

    fn new_session() -> *mut SpinonRuntimeSession {
        let mut output = [0_i8; 512];
        unsafe { spinon_runtime_session_new(output.as_mut_ptr(), output.len()) }
    }

    fn eval(session: *mut SpinonRuntimeSession, source: &str) -> (i32, String) {
        let source = CString::new(source).unwrap();
        let mut output = [0_i8; 1024];
        let status = unsafe {
            spinon_runtime_session_eval(session, source.as_ptr(), output.as_mut_ptr(), output.len())
        };
        let report = unsafe { CStr::from_ptr(output.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        (status, report)
    }

    #[test]
    fn report_exposes_caller_owner_callback_threads_and_timings() {
        let callbacks = CallbackState {
            callback_count: 2,
            created_nodes: 1,
            last_node_id: 7,
            callback_thread_id: 42,
        };
        let report = operation_report(3, "dispatch", 0, 10, 42, 42, 11, 29, false, &callbacks, "");
        assert!(report.contains("caller_tid=10"));
        assert!(report.contains("owner_tid=42"));
        assert!(report.contains("callback_tid=42"));
        assert!(report.contains("queue_wait_us=11"));
        assert!(report.contains("v8_call_us=29"));
        assert!(report.contains("cancel_requested=false"));
        assert!(report.contains("callback_count=2"));
    }

    #[test]
    fn report_copy_requires_a_nul_terminator() {
        let mut short = [0_u8; 4];
        assert!(!copy_report("four", &mut short));
        assert_eq!(short[0], 0);

        let mut exact = [0_u8; 5];
        assert!(copy_report("four", &mut exact));
        assert_eq!(&exact, b"four\0");
    }

    #[test]
    fn bounded_scheduler_selects_priority_then_fifo_and_drains_on_stop() {
        let scheduler = TaskScheduler::new();
        for (priority, node_id) in [
            (TaskPriority::Background, 1),
            (TaskPriority::UserVisible, 2),
            (TaskPriority::Background, 3),
            (TaskPriority::UserBlocking, 4),
            (TaskPriority::UserBlocking, 5),
            (TaskPriority::UserVisible, 6),
        ] {
            let (reply, _response) = std::sync::mpsc::sync_channel(1);
            let command = Command::Dispatch {
                sequence: node_id as u64,
                node_id,
                submitted_at: Instant::now(),
                caller_thread_id: 0,
                reply,
            };
            assert!(scheduler.try_enqueue(priority, command).is_ok());
        }

        let mut order = Vec::new();
        for _ in 0..6 {
            let command = scheduler.receive().expect("대기 작업을 받아야 합니다");
            if let Command::Dispatch { node_id, .. } = command {
                order.push(node_id);
            }
        }
        assert_eq!(order, [4, 5, 2, 6, 1, 3]);

        scheduler.stop();
        assert!(scheduler.receive().is_none());
        let (reply, _response) = std::sync::mpsc::sync_channel(1);
        assert!(matches!(
            scheduler.try_enqueue(
                TaskPriority::UserBlocking,
                Command::Dispatch {
                    sequence: 7,
                    node_id: 7,
                    submitted_at: Instant::now(),
                    caller_thread_id: 0,
                    reply,
                }
            ),
            Err(EnqueueError::Stopped)
        ));
    }

    #[test]
    fn c_abi_priority_values_match_the_three_runtime_priorities() {
        assert_eq!(
            super::task_priority_from_abi(0),
            Some(TaskPriority::UserBlocking)
        );
        assert_eq!(
            super::task_priority_from_abi(1),
            Some(TaskPriority::UserVisible)
        );
        assert_eq!(
            super::task_priority_from_abi(2),
            Some(TaskPriority::Background)
        );
        assert!(super::task_priority_from_abi(3).is_none());
    }

    #[test]
    fn session_executes_pending_commands_by_priority_and_fifo() {
        let session = new_session();
        assert!(!session.is_null());
        let session_address = session as usize;
        let running =
            thread::spawn(move || eval(session_address as *mut SpinonRuntimeSession, "hang"));
        wait_until_active(session);

        let background = thread::spawn(move || {
            eval_with_priority(
                session_address as *mut SpinonRuntimeSession,
                "background",
                2,
            )
        });
        wait_for_queue_len(session, 1);
        let visible = thread::spawn(move || {
            dispatch_with_priority(session_address as *mut SpinonRuntimeSession, 22, 1)
        });
        wait_for_queue_len(session, 2);
        let blocking_first = thread::spawn(move || {
            dispatch_with_priority(session_address as *mut SpinonRuntimeSession, 31, 0)
        });
        wait_for_queue_len(session, 3);
        let blocking_second = thread::spawn(move || {
            dispatch_with_priority(session_address as *mut SpinonRuntimeSession, 32, 0)
        });
        wait_for_queue_len(session, 4);

        assert_eq!(unsafe { spinon_runtime_session_cancel(session) }, OK);
        assert_eq!(running.join().unwrap().0, ERR_CANCELLED);
        assert_eq!(background.join().unwrap().0, OK);
        assert_eq!(visible.join().unwrap().0, OK);
        assert_eq!(blocking_first.join().unwrap().0, OK);
        assert_eq!(blocking_second.join().unwrap().0, OK);

        let session_ref = unsafe { &*session.cast::<Session>() };
        let runtime = super::lock(&session_ref.control)
            .runtime
            .expect("세션 V8 실행기가 남아 있어야 합니다");
        let operation_order = unsafe { &*(runtime as *const FakeV8Runtime) }
            .operation_order
            .lock()
            .unwrap()
            .clone();
        assert_eq!(
            operation_order,
            [
                "dispatch:31",
                "dispatch:32",
                "dispatch:22",
                "eval:background"
            ]
        );

        unsafe { spinon_runtime_session_free(session) };
    }

    fn wait_until_active(session: *mut SpinonRuntimeSession) {
        let session_ref = unsafe { &*session.cast::<Session>() };
        let deadline = Instant::now() + Duration::from_secs(2);
        while !super::lock(&session_ref.control).active && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(1));
        }
        assert!(super::lock(&session_ref.control).active);
    }

    fn wait_for_queue_len(session: *mut SpinonRuntimeSession, expected: usize) {
        let session_ref = unsafe { &*session.cast::<Session>() };
        let deadline = Instant::now() + Duration::from_secs(2);
        while super::lock(&session_ref.scheduler.state).queue.len() != expected
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(
            super::lock(&session_ref.scheduler.state).queue.len(),
            expected
        );
    }

    fn eval_with_priority(
        session: *mut SpinonRuntimeSession,
        source: &str,
        priority: i32,
    ) -> (i32, String) {
        let source = CString::new(source).unwrap();
        let mut output = [0_i8; 1024];
        let status = unsafe {
            spinon_runtime_session_eval_with_priority(
                session,
                source.as_ptr(),
                priority,
                output.as_mut_ptr(),
                output.len(),
            )
        };
        let report = unsafe { CStr::from_ptr(output.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        (status, report)
    }

    fn dispatch_with_priority(
        session: *mut SpinonRuntimeSession,
        node_id: i32,
        priority: i32,
    ) -> (i32, String) {
        let mut output = [0_i8; 1024];
        let status = unsafe {
            spinon_runtime_session_dispatch_with_priority(
                session,
                node_id,
                priority,
                output.as_mut_ptr(),
                output.len(),
            )
        };
        let report = unsafe { CStr::from_ptr(output.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        (status, report)
    }

    #[test]
    fn persistent_session_keeps_owner_and_callbacks_on_one_worker() {
        let session = new_session();
        assert!(!session.is_null());
        let (status, first) = eval(session, "callback");
        assert_eq!(status, OK);
        let caller = field(&first, "caller_tid");
        let owner = field(&first, "owner_tid");
        assert_ne!(caller, owner);
        assert_eq!(owner, field(&first, "callback_tid"));

        let mut output = [0_i8; 1024];
        let status = unsafe {
            spinon_runtime_session_dispatch(session, 7, output.as_mut_ptr(), output.len())
        };
        let second = unsafe { CStr::from_ptr(output.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        assert_eq!(status, OK);
        assert_eq!(field(&second, "owner_tid"), owner);
        assert_eq!(field(&second, "callback_tid"), owner);
        unsafe { spinon_runtime_session_free(session) };
    }

    #[test]
    fn cancel_interrupts_active_call_and_session_accepts_next_call() {
        let session = new_session();
        assert!(!session.is_null());
        let session_address = session as usize;
        let running =
            thread::spawn(move || eval(session_address as *mut SpinonRuntimeSession, "hang"));

        let session_ref = unsafe { &*session.cast::<Session>() };
        let deadline = Instant::now() + Duration::from_secs(2);
        while !super::lock(&session_ref.control).active && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(1));
        }
        assert!(
            super::lock(&session_ref.control).active,
            "가짜 JS 실행이 시작되지 않았습니다"
        );
        assert_eq!(unsafe { spinon_runtime_session_cancel(session) }, OK);

        let (status, cancelled) = running.join().unwrap();
        assert_eq!(status, ERR_CANCELLED);
        assert!(cancelled.contains("cancel_requested=true"));
        assert!(cancelled.contains("owner_tid="));
        let (status, resumed) = eval(session, "again");
        assert_eq!(status, OK);
        assert!(resumed.contains("error=none"));
        unsafe { spinon_runtime_session_free(session) };
    }

    #[test]
    fn bounded_queue_rejects_overflow_and_drains_after_cancellation() {
        assert_eq!(QUEUE_CAPACITY, 64);
        let session = new_session();
        assert!(!session.is_null());
        let session_address = session as usize;
        let long_eval =
            thread::spawn(move || eval(session_address as *mut SpinonRuntimeSession, "hang"));
        let session_ref = unsafe { &*session.cast::<Session>() };
        let deadline = Instant::now() + Duration::from_secs(2);
        while !super::lock(&session_ref.control).active && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(1));
        }
        assert!(
            super::lock(&session_ref.control).active,
            "가짜 JS 실행이 시작되지 않았습니다"
        );

        let start = Arc::new(Barrier::new(66));
        let completed = Arc::new(AtomicUsize::new(0));
        let statuses = Arc::new(Mutex::new(Vec::with_capacity(65)));
        let mut callers = Vec::with_capacity(65);
        for node_id in 0..65 {
            let start = Arc::clone(&start);
            let completed = Arc::clone(&completed);
            let statuses = Arc::clone(&statuses);
            callers.push(thread::spawn(move || {
                start.wait();
                let mut output = [0_i8; 1024];
                let status = unsafe {
                    spinon_runtime_session_dispatch(
                        session_address as *mut SpinonRuntimeSession,
                        node_id,
                        output.as_mut_ptr(),
                        output.len(),
                    )
                };
                statuses.lock().unwrap().push(status);
                completed.fetch_add(1, Ordering::Release);
            }));
        }
        start.wait();
        let deadline = Instant::now() + Duration::from_secs(2);
        while completed.load(Ordering::Acquire) == 0 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(1));
        }
        assert!(
            completed.load(Ordering::Acquire) > 0,
            "가득 찬 큐가 호출을 거부하지 않았습니다"
        );
        assert_eq!(unsafe { spinon_runtime_session_cancel(session) }, OK);

        let (cancel_status, _) = long_eval.join().unwrap();
        assert_eq!(cancel_status, ERR_CANCELLED);
        for caller in callers {
            caller.join().unwrap();
        }
        let statuses = statuses.lock().unwrap();
        assert!(statuses.contains(&ERR_QUEUE_FULL));
        assert!(
            statuses
                .iter()
                .all(|status| *status == OK || *status == ERR_QUEUE_FULL)
        );
        unsafe { spinon_runtime_session_free(session) };
    }

    fn field(report: &str, key: &str) -> String {
        report
            .split_whitespace()
            .find_map(|field| field.strip_prefix(&format!("{key}=")))
            .unwrap_or_else(|| panic!("보고서에 {key} 필드가 없습니다: {report}"))
            .to_owned()
    }
}
