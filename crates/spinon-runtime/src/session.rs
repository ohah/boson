use crate::host::{HostDocumentBridge, commit_callback};
#[cfg(test)]
use crate::v8::{NodeCallback, TextCallback};
use crate::v8::{
    SpinonV8Runtime, spinon_v8_current_thread_id, spinon_v8_runtime_cancel_termination,
    spinon_v8_runtime_dispatch, spinon_v8_runtime_eval, spinon_v8_runtime_free,
    spinon_v8_runtime_last_error, spinon_v8_runtime_new, spinon_v8_runtime_terminate,
    spinon_v8_runtime_was_terminated,
};
use spinon_core::PriorityQueue;
pub use spinon_core::TaskPriority;
use std::ffi::{CStr, CString, c_char, c_void};
use std::ptr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const QUEUE_CAPACITY: usize = 64;
const OK: i32 = 0;
const ERR_ARGUMENT: i32 = -1;
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

pub struct RuntimeSession {
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

pub struct OperationResponse {
    pub status: i32,
    pub report: String,
}

struct CallbackState {
    callback_count: u64,
    created_nodes: u64,
    last_node_id: i32,
    callback_thread_id: u64,
    document: HostDocumentBridge,
}

impl CallbackState {
    fn new() -> Result<Self, String> {
        Ok(Self {
            callback_count: 0,
            created_nodes: 0,
            last_node_id: 0,
            callback_thread_id: 0,
            document: HostDocumentBridge::new()?,
        })
    }

    fn reset_operation(&mut self) {
        self.callback_count = 0;
        self.created_nodes = 0;
        self.last_node_id = 0;
        self.callback_thread_id = 0;
    }
}

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
    let mut callbacks = match CallbackState::new() {
        Ok(callbacks) => callbacks,
        Err(error) => {
            let _ = ready.send(Err(format!("HostDocument를 만들지 못했습니다: {error}")));
            return;
        }
    };
    let callback_data = ptr::addr_of_mut!(callbacks).cast::<c_void>();
    let document_data = ptr::addr_of_mut!(callbacks.document).cast::<c_void>();
    let runtime = unsafe {
        spinon_v8_runtime_new(
            on_node,
            on_text,
            commit_callback,
            callback_data,
            document_data,
        )
    };
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
                let report = operation_report(OperationReport {
                    sequence,
                    operation: "eval",
                    status,
                    caller_thread_id,
                    owner_thread_id,
                    callback_thread_id: callbacks.callback_thread_id,
                    queue_wait_us,
                    v8_call_us,
                    cancel_requested,
                    callbacks: &callbacks,
                    error: &error,
                });
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
                let report = operation_report(OperationReport {
                    sequence,
                    operation: "dispatch",
                    status,
                    caller_thread_id,
                    owner_thread_id,
                    callback_thread_id: callbacks.callback_thread_id,
                    queue_wait_us,
                    v8_call_us,
                    cancel_requested,
                    callbacks: &callbacks,
                    error: &error,
                });
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

struct OperationReport<'a> {
    sequence: u64,
    operation: &'a str,
    status: i32,
    caller_thread_id: u64,
    owner_thread_id: u64,
    callback_thread_id: u64,
    queue_wait_us: u128,
    v8_call_us: u128,
    cancel_requested: bool,
    callbacks: &'a CallbackState,
    error: &'a str,
}

fn operation_report(report: OperationReport<'_>) -> String {
    let OperationReport {
        sequence,
        operation,
        status,
        caller_thread_id,
        owner_thread_id,
        callback_thread_id,
        queue_wait_us,
        v8_call_us,
        cancel_requested,
        callbacks,
        error,
    } = report;
    let error = if error.is_empty() { "none" } else { error };
    format!(
        "seq={sequence} op={operation} status={status} caller_tid={caller_thread_id} owner_tid={owner_thread_id} callback_tid={callback_thread_id} queue_wait_us={queue_wait_us} v8_call_us={v8_call_us} cancel_requested={cancel_requested} callback_count={} created_nodes={} last_node_id={} document_revision={} render_tree_revision={} document_nodes={} error={error}",
        callbacks.callback_count,
        callbacks.created_nodes,
        callbacks.last_node_id,
        callbacks.document.document_revision(),
        callbacks.document.render_tree_revision(),
        callbacks.document.node_count(),
    )
}

fn submit(
    session: &RuntimeSession,
    priority: TaskPriority,
    command: impl FnOnce(u64, Instant, u64, SyncSender<OperationResponse>) -> Command,
) -> OperationResponse {
    let response = match enqueue(session, priority, command) {
        Ok(response) => response,
        Err(response) => return response,
    };
    response.recv().unwrap_or_else(|_| OperationResponse {
        status: ERR_WORKER,
        report: "V8 실행기가 응답하기 전에 종료되었습니다".to_owned(),
    })
}

fn enqueue(
    session: &RuntimeSession,
    priority: TaskPriority,
    command: impl FnOnce(u64, Instant, u64, SyncSender<OperationResponse>) -> Command,
) -> Result<Receiver<OperationResponse>, OperationResponse> {
    let (reply, response) = mpsc::sync_channel(1);
    let _submission = lock(&session.submission);
    if lock(&session.control).closing {
        return Err(OperationResponse {
            status: ERR_CLOSED,
            report: "세션이 종료되었습니다".to_owned(),
        });
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
            return Err(OperationResponse {
                status: ERR_QUEUE_FULL,
                report: format!("명령 큐가 가득 찼습니다 capacity={QUEUE_CAPACITY}"),
            });
        }
        Err(EnqueueError::Stopped) => {
            return Err(OperationResponse {
                status: ERR_CLOSED,
                report: "V8 실행기 큐가 종료되었습니다".to_owned(),
            });
        }
    }
    drop(_submission);
    Ok(response)
}

struct PendingPriorityProbe {
    priority: TaskPriority,
    marker: i32,
    response: Receiver<OperationResponse>,
}

struct PriorityProbeResult {
    priority: TaskPriority,
    marker: i32,
    sequence: u64,
    execution_order: u64,
    owner_thread_id: u64,
    callback_thread_id: u64,
}

/// 실제 V8 Isolate에서 세 우선순위의 선택 순서와 같은 우선순위 FIFO를 확인합니다.
/// 앱 작성자용 API가 아니라 시뮬레이터 검증에 쓰는 내부 진단 경로입니다.
pub fn run_priority_probe() -> Result<String, String> {
    const ACTIVE_TIMEOUT: Duration = Duration::from_secs(2);
    const RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);

    let (session, _) = RuntimeSession::new()?;
    let session = Arc::new(session);
    let blocker_session = Arc::clone(&session);
    let blocker = thread::Builder::new()
        .name("spinon-priority-probe".to_owned())
        .spawn(move || blocker_session.eval("while (true) {}", TaskPriority::Background))
        .map_err(|error| format!("우선순위 검증 작업 생성 실패: {error}"))?;

    let active_deadline = Instant::now() + ACTIVE_TIMEOUT;
    while !lock(&session.control).active && Instant::now() < active_deadline {
        thread::sleep(Duration::from_millis(1));
    }
    if !lock(&session.control).active {
        abort_priority_probe(&session);
        let _ = blocker.join();
        return Err("우선순위 검증의 V8 차단 작업이 시간 안에 시작되지 않았습니다".to_owned());
    }

    // 낮은 등급부터 섞어 접수합니다. 실행 순서는 이 접수 순서와 달라야 합니다.
    let planned = [
        (TaskPriority::Background, 201),
        (TaskPriority::UserVisible, 101),
        (TaskPriority::UserBlocking, 1),
        (TaskPriority::Background, 202),
        (TaskPriority::UserBlocking, 2),
        (TaskPriority::UserVisible, 102),
    ];
    let mut pending = Vec::with_capacity(planned.len());
    for (priority, marker) in planned {
        let source = CString::new(format!(
            "globalThis.__spinonPriorityProbeOrder=(globalThis.__spinonPriorityProbeOrder||0)+1;spinon.createNode(globalThis.__spinonPriorityProbeOrder,'probe-{marker}');"
        ))
        .expect("우선순위 검증 JavaScript에는 NUL 문자가 없습니다");
        let response = enqueue(
            &session,
            priority,
            |sequence, submitted_at, caller_thread_id, reply| Command::Eval {
                sequence,
                source,
                submitted_at,
                caller_thread_id,
                reply,
            },
        );
        match response {
            Ok(response) => pending.push(PendingPriorityProbe {
                priority,
                marker,
                response,
            }),
            Err(error) => {
                abort_priority_probe(&session);
                let _ = blocker.join();
                return Err(format!("우선순위 검증 작업 접수 실패: {}", error.report));
            }
        }
    }

    let cancel_status = session.cancel();
    let blocker_response = match blocker.join() {
        Ok(response) => response,
        Err(_) => {
            abort_priority_probe(&session);
            return Err("우선순위 검증의 차단 작업 스레드가 비정상 종료됐습니다".to_owned());
        }
    };
    if cancel_status != OK || blocker_response.status != ERR_CANCELLED {
        abort_priority_probe(&session);
        return Err(format!(
            "우선순위 검증 차단 해제 실패: cancel_status={cancel_status} blocker_status={}",
            blocker_response.status
        ));
    }

    let mut results = Vec::with_capacity(pending.len());
    for pending in pending {
        let response = match pending.response.recv_timeout(RESPONSE_TIMEOUT) {
            Ok(response) => response,
            Err(error) => {
                abort_priority_probe(&session);
                return Err(format!("우선순위 검증 작업 응답 시간 초과: {error}"));
            }
        };
        let result = match parse_priority_probe_result(pending.priority, pending.marker, &response)
        {
            Ok(result) => result,
            Err(error) => {
                abort_priority_probe(&session);
                return Err(error);
            }
        };
        results.push(result);
    }

    let mut expected = results.iter().collect::<Vec<_>>();
    expected.sort_by_key(|result| (priority_rank(result.priority), result.sequence));
    let mut observed = results.iter().collect::<Vec<_>>();
    observed.sort_by_key(|result| result.execution_order);

    let order_is_contiguous = observed
        .iter()
        .enumerate()
        .all(|(index, result)| result.execution_order == index as u64 + 1);
    let priority_and_fifo_match = observed
        .iter()
        .map(|result| (result.priority, result.marker))
        .eq(expected
            .iter()
            .map(|result| (result.priority, result.marker)));
    let owner_thread_id = observed.first().map(|result| result.owner_thread_id);
    let thread_ownership_matches = observed.iter().all(|result| {
        Some(result.owner_thread_id) == owner_thread_id
            && result.callback_thread_id == result.owner_thread_id
    });
    if !order_is_contiguous || !priority_and_fifo_match || !thread_ownership_matches {
        return Err(format!(
            "priority_probe=FAIL order={} contiguous={} priority_fifo={} owner_thread={}",
            format_priority_probe_order(&observed),
            order_is_contiguous,
            priority_and_fifo_match,
            thread_ownership_matches
        ));
    }

    Ok(format!(
        "priority_probe=PASS blocker_status={} cancel_status={} order={} owner_tid={}",
        blocker_response.status,
        cancel_status,
        format_priority_probe_order(&observed),
        owner_thread_id.unwrap_or_default()
    ))
}

fn abort_priority_probe(session: &RuntimeSession) {
    lock(&session.control).closing = true;
    let _ = cancel_control(&session.control);
    session.scheduler.stop();
}

fn parse_priority_probe_result(
    priority: TaskPriority,
    marker: i32,
    response: &OperationResponse,
) -> Result<PriorityProbeResult, String> {
    if response.status != OK {
        return Err(format!(
            "우선순위 검증 작업 실패: priority={} marker={} status={} report={}",
            priority_name(priority),
            marker,
            response.status,
            response.report
        ));
    }
    let parse = |key: &str| -> Result<u64, String> {
        report_field(&response.report, key)
            .and_then(|value| value.parse().ok())
            .ok_or_else(|| format!("검증 응답에 {key} 값이 없습니다: {}", response.report))
    };
    let execution_order = parse("last_node_id")?;
    let sequence = parse("seq")?;
    let owner_thread_id = parse("owner_tid")?;
    let callback_thread_id = parse("callback_tid")?;
    if execution_order == 0 {
        return Err(format!(
            "검증 작업이 V8 콜백을 실행하지 않았습니다: {}",
            response.report
        ));
    }
    Ok(PriorityProbeResult {
        priority,
        marker,
        sequence,
        execution_order,
        owner_thread_id,
        callback_thread_id,
    })
}

fn report_field<'a>(report: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{key}=");
    report
        .split_whitespace()
        .find_map(|field| field.strip_prefix(&prefix))
}

const fn priority_rank(priority: TaskPriority) -> u8 {
    match priority {
        TaskPriority::UserBlocking => 0,
        TaskPriority::UserVisible => 1,
        TaskPriority::Background => 2,
    }
}

const fn priority_name(priority: TaskPriority) -> &'static str {
    match priority {
        TaskPriority::UserBlocking => "user-blocking",
        TaskPriority::UserVisible => "user-visible",
        TaskPriority::Background => "background",
    }
}

fn format_priority_probe_order(results: &[&PriorityProbeResult]) -> String {
    let order = results
        .iter()
        .map(|result| {
            format!(
                "{}:{}#seq{}",
                priority_name(result.priority),
                result.marker,
                result.sequence
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("[{order}]")
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

impl RuntimeSession {
    /// V8 Isolate를 만들고 소유 전용 OS 스레드의 준비를 기다립니다.
    pub fn new() -> Result<(Self, String), String> {
        let control = Arc::new(Mutex::new(RuntimeControl::new()));
        let worker_control = Arc::clone(&control);
        let scheduler = Arc::new(TaskScheduler::new());
        let worker_scheduler = Arc::clone(&scheduler);
        let (ready_sender, ready_receiver) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("spinon-js-runtime".to_owned())
            .spawn(move || actor_loop(worker_scheduler, worker_control, ready_sender))
            .map_err(|error| format!("실행기 스레드 생성 실패: {error}"))?;

        let owner_thread_id = match ready_receiver.recv() {
            Ok(Ok(thread_id)) => thread_id,
            Ok(Err(error)) => {
                let _ = worker.join();
                return Err(error);
            }
            Err(_) => {
                let _ = worker.join();
                return Err("V8 실행기 초기화 응답을 받지 못했습니다".to_owned());
            }
        };
        let report = format!(
            "session=ready owner_tid={owner_thread_id} isolate_per_session=1 queue_capacity={QUEUE_CAPACITY} queue_policy=strict-priority-fifo"
        );
        Ok((
            Self {
                scheduler,
                worker: Mutex::new(Some(worker)),
                control,
                submission: Mutex::new(()),
                next_sequence: AtomicU64::new(0),
            },
            report,
        ))
    }

    /// JavaScript 평가를 지정한 논리 우선순위로 제출하고 완료 응답을 돌려줍니다.
    pub fn eval(&self, source: &str, priority: TaskPriority) -> OperationResponse {
        let source = match CString::new(source) {
            Ok(source) => source,
            Err(_) => {
                return OperationResponse {
                    status: ERR_ARGUMENT,
                    report: "JavaScript 원본에 NUL 문자가 있습니다".to_owned(),
                };
            }
        };
        submit(
            self,
            priority,
            |sequence, submitted_at, caller_thread_id, reply| Command::Eval {
                sequence,
                source,
                submitted_at,
                caller_thread_id,
                reply,
            },
        )
    }

    /// 등록된 JavaScript 이벤트 함수를 지정한 우선순위로 호출합니다.
    pub fn dispatch(&self, node_id: i32, priority: TaskPriority) -> OperationResponse {
        submit(
            self,
            priority,
            |sequence, submitted_at, caller_thread_id, reply| Command::Dispatch {
                sequence,
                node_id,
                submitted_at,
                caller_thread_id,
                reply,
            },
        )
    }

    /// 실행 중인 JavaScript를 취소합니다. 실행 중인 작업이 없으면 1을 돌려줍니다.
    pub fn cancel(&self) -> i32 {
        cancel_control(&self.control)
    }
}

impl Drop for RuntimeSession {
    fn drop(&mut self) {
        {
            let _submission = lock(&self.submission);
            lock(&self.control).closing = true;
        }
        let _ = cancel_control(&self.control);
        self.scheduler.stop();
        if let Some(worker) = lock(&self.worker).take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CallbackState, Command, ERR_CANCELLED, ERR_QUEUE_FULL, EnqueueError, OK, OperationReport,
        QUEUE_CAPACITY, RuntimeSession, TaskPriority, TaskScheduler, operation_report,
    };
    use crate::host::{DocumentCommitCallback, HostDocumentBridge};
    use std::ffi::{CStr, c_char, c_void};
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
        _document_commit_callback: DocumentCommitCallback,
        user_data: *mut c_void,
        _document_user_data: *mut c_void,
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

    fn new_session() -> RuntimeSession {
        RuntimeSession::new()
            .expect("가짜 V8 런타임 세션을 만들어야 합니다")
            .0
    }

    fn eval(session: &RuntimeSession, source: &str) -> super::OperationResponse {
        session.eval(source, TaskPriority::UserVisible)
    }

    #[test]
    fn report_exposes_caller_owner_callback_threads_and_timings() {
        let callbacks = CallbackState {
            callback_count: 2,
            created_nodes: 1,
            last_node_id: 7,
            callback_thread_id: 42,
            document: HostDocumentBridge::new().unwrap(),
        };
        let report = operation_report(OperationReport {
            sequence: 3,
            operation: "dispatch",
            status: 0,
            caller_thread_id: 10,
            owner_thread_id: 42,
            callback_thread_id: 42,
            queue_wait_us: 11,
            v8_call_us: 29,
            cancel_requested: false,
            callbacks: &callbacks,
            error: "",
        });
        assert!(report.contains("caller_tid=10"));
        assert!(report.contains("owner_tid=42"));
        assert!(report.contains("callback_tid=42"));
        assert!(report.contains("queue_wait_us=11"));
        assert!(report.contains("v8_call_us=29"));
        assert!(report.contains("cancel_requested=false"));
        assert!(report.contains("document_revision=0"));
        assert!(report.contains("render_tree_revision=0"));
        assert!(report.contains("document_nodes=0"));
        assert!(report.contains("callback_count=2"));
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
    fn session_executes_pending_commands_by_priority_and_fifo() {
        let session = Arc::new(new_session());
        let running_session = Arc::clone(&session);
        let running = thread::spawn(move || eval(&running_session, "hang"));
        wait_until_active(&session);

        let background_session = Arc::clone(&session);
        let background =
            thread::spawn(move || background_session.eval("background", TaskPriority::Background));
        wait_for_queue_len(&session, 1);
        let visible_session = Arc::clone(&session);
        let visible =
            thread::spawn(move || visible_session.dispatch(22, TaskPriority::UserVisible));
        wait_for_queue_len(&session, 2);
        let blocking_first_session = Arc::clone(&session);
        let blocking_first =
            thread::spawn(move || blocking_first_session.dispatch(31, TaskPriority::UserBlocking));
        wait_for_queue_len(&session, 3);
        let blocking_second_session = Arc::clone(&session);
        let blocking_second =
            thread::spawn(move || blocking_second_session.dispatch(32, TaskPriority::UserBlocking));
        wait_for_queue_len(&session, 4);

        assert_eq!(session.cancel(), OK);
        assert_eq!(running.join().unwrap().status, ERR_CANCELLED);
        assert_eq!(background.join().unwrap().status, OK);
        assert_eq!(visible.join().unwrap().status, OK);
        assert_eq!(blocking_first.join().unwrap().status, OK);
        assert_eq!(blocking_second.join().unwrap().status, OK);

        let runtime = super::lock(&session.control)
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
    }

    fn wait_until_active(session: &RuntimeSession) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !super::lock(&session.control).active && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(1));
        }
        assert!(super::lock(&session.control).active);
    }

    fn wait_for_queue_len(session: &RuntimeSession, expected: usize) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while super::lock(&session.scheduler.state).queue.len() != expected
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(super::lock(&session.scheduler.state).queue.len(), expected);
    }

    #[test]
    fn persistent_session_keeps_owner_and_callbacks_on_one_worker() {
        let session = new_session();
        let first = eval(&session, "callback");
        assert_eq!(first.status, OK);
        let caller = field(&first.report, "caller_tid");
        let owner = field(&first.report, "owner_tid");
        assert_ne!(caller, owner);
        assert_eq!(owner, field(&first.report, "callback_tid"));

        let second = session.dispatch(7, TaskPriority::UserBlocking);
        assert_eq!(second.status, OK);
        assert_eq!(field(&second.report, "owner_tid"), owner);
        assert_eq!(field(&second.report, "callback_tid"), owner);
    }

    #[test]
    fn cancel_interrupts_active_call_and_session_accepts_next_call() {
        let session = Arc::new(new_session());
        let running_session = Arc::clone(&session);
        let running = thread::spawn(move || eval(&running_session, "hang"));
        wait_until_active(&session);
        assert_eq!(session.cancel(), OK);

        let cancelled = running.join().unwrap();
        assert_eq!(cancelled.status, ERR_CANCELLED);
        assert!(cancelled.report.contains("cancel_requested=true"));
        assert!(cancelled.report.contains("owner_tid="));
        let resumed = eval(&session, "again");
        assert_eq!(resumed.status, OK);
        assert!(resumed.report.contains("error=none"));
    }

    #[test]
    fn bounded_queue_rejects_overflow_and_drains_after_cancellation() {
        assert_eq!(QUEUE_CAPACITY, 64);
        let session = Arc::new(new_session());
        let running_session = Arc::clone(&session);
        let long_eval = thread::spawn(move || eval(&running_session, "hang"));
        wait_until_active(&session);

        let start = Arc::new(Barrier::new(66));
        let completed = Arc::new(AtomicUsize::new(0));
        let statuses = Arc::new(Mutex::new(Vec::with_capacity(65)));
        let mut callers = Vec::with_capacity(65);
        for node_id in 0..65 {
            let start = Arc::clone(&start);
            let completed = Arc::clone(&completed);
            let statuses = Arc::clone(&statuses);
            let session = Arc::clone(&session);
            callers.push(thread::spawn(move || {
                start.wait();
                let status = session.dispatch(node_id, TaskPriority::UserBlocking).status;
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
        assert_eq!(session.cancel(), OK);

        assert_eq!(long_eval.join().unwrap().status, ERR_CANCELLED);
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
    }

    fn field(report: &str, key: &str) -> String {
        report
            .split_whitespace()
            .find_map(|field| field.strip_prefix(&format!("{key}=")))
            .unwrap_or_else(|| panic!("보고서에 {key} 필드가 없습니다: {report}"))
            .to_owned()
    }
}
