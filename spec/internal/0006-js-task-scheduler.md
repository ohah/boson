# 내부 설계 0006 · JavaScript 작업 스케줄러

**상태:** Chromium식 우선순위 선택 기준을 R06 실험 런타임에 반영 · **분리 전 Rust 테스트·플랫폼 빌드:** 통과 · **분리 후 Cargo 컴파일:** 통과 · **분리 후 테스트·플랫폼 빌드:** 미실행 · **실기기 혼합 우선순위 검증:** 미실행 · **공개 API:** 아님 · **제품 지원:** 아님

이 문서는 앱 JavaScript 작업의 우선순위를 설계하기 위한 내부 기준이다. 웹의 작업 스케줄러 우선순위 이름과 Chromium의 기본 큐 선택 규칙을 참고한다. Blink의 내부 큐 구성이나 시점별 정책을 복제한다고 약속하지 않는다. 제품 API와 구현 상태의 원본은 각각 `spec/` 문서와 [상태 대장](../STATUS.md)이다.

## 정한 방향

- 앱 작업을 브라우저의 `user-blocking`, `user-visible`, `background` 세 우선순위 개념에 맞춰 분류한다. 일반 작업의 기본값은 `user-visible`을 우선 후보로 둔다. 이는 OS thread QoS나 하드 실시간 마감 보장을 뜻하지 않는다.
- 우선순위는 실행 대기 중인 앱 작업 가운데 다음 작업을 고르는 기준이다. 실행 중인 JavaScript는 다른 작업이 제출되어도 선점되지 않는다. 긴 작업이 입력 응답을 막지 않게 하려면 작업을 나눠 양보하는 API·프레임워크 협력이 별도로 필요하다.
- 일반 앱 JavaScript와 입력 핸들러는 UI 메인 스레드 밖의 JS 실행 경로에서 실행한다. GPU 프레임·표시 작업은 GPU 소유 경로에서 별도로 처리하고 앱 JS 완료를 동기 대기하지 않는다.
- 각 V8 Isolate는 한 번에 한 OS 소유 스레드에서만 V8 API를 사용한다. 실행기 풀을 채택해도 같은 Isolate를 서로 다른 OS 스레드로 옮겨 실행하지 않는다.
- 취소·종료 제어는 UI 메인 스레드에서 실행하지 않는다. 별도 플랫폼 제어 실행기가 취소 요청을 전달할 수 있지만, 소유자 밖에서는 고정 V8 헤더가 허용한 `TerminateExecution()`만 호출한다. 일반 V8 객체 접근·취소 상태 복구·Isolate 해제는 소유 스레드가 맡는다.

## Chromium에서 가져온 기본 큐 규칙

R06 런타임 세션은 한 Isolate의 명령을 세 개의 FIFO에 넣는다. 작업 경계마다 가장 높은 등급 중 대기 작업 하나를 꺼내며, 같은 등급에서는 먼저 접수한 작업을 먼저 실행한다. 실행을 시작한 JavaScript는 선점하지 않는다. 상위 우선순위가 계속 들어오면 하위 우선순위가 굶을 수 있으며 일반적인 aging이나 기아 방지 정책은 두지 않는다. 이 규칙은 Chromium `TaskQueueSelector`의 우선순위 선택과 같은 우선순위의 enqueue 순서 유지에서 가져왔다.

현재 기본 매핑은 실험용 `spinon-ffi` ABI가 적용하고, 작업 큐와 세션 실행은 `spinon-runtime`이 소유한다. 기존 `dispatch`는 사용자 입력 핸들러로 간주해 `user-blocking`, 기존 `eval`은 일반 앱 작업으로 간주해 `user-visible`에 넣는다. 내부 호출자는 실험용 `*_with_priority` C ABI에서 세 등급 중 하나를 직접 고를 수 있다. 실제 타이머·네트워크·프레임워크 작업 출처의 매핑과 앱 공개 스케줄러 API는 아직 없다.

Chromium selector에 있는 지연 작업 대 즉시 작업의 제한된 starvation 보정은 복제하지 않는다. Spinon R06에는 지연 작업 큐가 없기 때문이다. 이는 전체 Chromium/Blink 스케줄러를 복제한다는 뜻이 아니다.

## 기준 어휘와 경계

웹 Prioritized Task Scheduling 명세는 `user-blocking`·`user-visible`·`background`와 `scheduler.postTask()`·`scheduler.yield()`·취소/우선순위 신호 모델을 제안한다. 확인일 기준 WICG Community Group 초안이며 W3C 표준 트랙 문서는 아니다. 이 어휘는 Spinon의 설계 기준일 뿐, Spinon이 해당 API를 지원한다는 선언은 아니다.

Chromium의 기본 `TaskQueue` 문서는 우선순위가 낮은 큐에 일반적인 기아 방지가 없으며, 높은 등급의 지속적인 작업이 낮은 등급을 막을 수 있다고 명시한다. `TaskQueueSelector`는 활성 등급 중 높은 등급부터 선택하고 같은 등급에서 enqueue 순서를 유지한다. 별도로 지연 작업과 즉시 작업 사이에는 제한된 starvation 보정이 있지만, 이는 모든 우선순위에 대한 공정성 보장이 아니다. Blink는 입력·컴포지터 상황에 맞춘 정책을 위에 추가한다. 이번 R06 기본 구현은 일반 우선순위 선택만 가져오며 Blink 동적 정책은 가져오지 않는다.

따라서 아래를 분리한다.

- **작업 우선순위:** 다음 JS 작업을 고르는 논리적 분류.
- **실행기 배치:** 작업이 도는 JS 소유 OS 스레드. 우선순위가 스레드를 만들거나 Isolate 이동을 허용하지 않는다.
- **백그라운드 실행 경로:** UI 메인 스레드와 분리된 JS 실행기라는 뜻이다. 우선순위 값 `background`나 앱이 OS 백그라운드 상태라는 뜻은 아니다.
- **GPU 프레임:** JS 작업 큐와 별도의 렌더링·표시 경로. JS가 트리를 갱신하면 revision이 붙은 데이터가 렌더링 단계로 전달된다.
- **제어 경로:** 취소와 종료를 진행시키는 경로. UI 메인 스레드와 JS 일반 작업 큐에 막히지 않아야 하지만 허용된 V8 호출은 제한한다.
- **마이크로태스크:** Promise reaction과 `queueMicrotask`를 포함하는 실행 순서. 우선순위별 일반 작업 큐와 섞는 시점은 별도 이벤트 루프 계약으로 정한다.

## 작업 출처 매핑 후보

아래 표는 FFI 어댑터가 런타임에 전달하는 현재 실험 매핑과 미정인 제품 매핑을 구분한다. 공개 동작 약속은 아니다.

| 작업 출처 | 현재 R06 실험 매핑 | 남은 제품 결정 |
| --- | --- | --- |
| 기존 실험 `dispatch` | `user-blocking` | 제품에서 직접 사용자 입력에 한정할지 |
| 기존 실험 `eval` | `user-visible` | 제품 기본 호출·프레임워크 렌더에 적용할지 |
| 내부 실험 `*_with_priority` | 호출자가 세 등급 중 선택 | 제품 코드의 task source별 기본 매핑 |
| 로깅·정리·비긴급 사전 계산 | 현재 제출 경로 없음; 향후 `background` 후보 | 앱이 백그라운드일 때 계속 실행할 수 있는지 |
| 포인터 이동·스크롤 진행 중 반복 이벤트 | 현재 제출 경로 없음 | 이벤트 병합 기준, 눌림·해제 보존, 취소·접근성 의미 |
| 레이아웃·렌더 snapshot 및 GPU 제출 | JS 우선순위에 직접 합치지 않는 별도 프레임 경로 | 프레임 마감, snapshot 병합, stale revision 폐기 |
| 취소·종료 | JS 작업 우선순위 큐 밖의 제어 경로 | 종료 순서·join 제한·pending 요청 결과 |

입력 이벤트를 높은 우선순위로 제출해도 이미 실행 중인 JS를 중단할 수 없다. 비동기 JS 핸들러는 웹의 `preventDefault()` 같은 동기 기본 동작 취소를 자동으로 제공하지 않는다. 두 의미는 [UI 트리·이벤트 명세](../0002-ui-tree-events.md)의 적합성 범위에서 따로 결정한다.

## 미결정 설계 목록

1. **공개 JS API와 프레임워크 연결:** `scheduler.postTask()`·`scheduler.yield()`·`TaskController`/`TaskSignal`을 제공할지, 기존 `MessageChannel`·타이머 기반 연결만 둘지, 앱 내부 모듈 API로 한정할지. React `scheduler`가 실제로 요구하는 host primitive는 지원 버전을 고정한 뒤 번들 산출물로 확인한다.
2. **제품 기본값과 우선순위 변경:** R06 FFI 어댑터의 기본값은 `dispatch=user-blocking`, `eval=user-visible`이다. 제품의 기본값, 동적 priority 변경, 일반 기아 방지 도입 여부는 미정이다. 현 R06 기준은 상위 작업이 지속되면 하위 작업이 굶을 수 있게 둔다.
3. **작업 출처 매핑:** 터치·키 입력, 접근성 활성화, 프레임워크 렌더, 네트워크 완료, 타이머, 네이티브 모듈 응답을 어떤 등급과 task source로 넣을지.
4. **실행기 구조:** Isolate마다 전용 OS 스레드를 둘지, 여러 Isolate를 고정된 worker 스레드에 배치할지. 풀을 쓰면 Isolate를 한 worker에 고정해도 되는지, head-of-line blocking·공정성·메모리·종료 격리를 어떻게 측정할지.
5. **큐와 역압력:** R06 런타임의 대기 총량은 실험상 최대 64개이며 세 등급이 용량을 공유한다. 등급별 예약 슬롯, 플랫폼 adapter와의 단일 접수 경계, 포화 오류, 거부·병합·폐기 기준은 미정이다. 여러 단계의 큐가 각각 무제한 증가하지 않게 해야 한다.
6. **입력 이벤트 병합:** `pointermove`·스크롤을 어느 프레임까지 합칠지, 최신 좌표·timestamp를 어떻게 보존할지, `down`·`up`·`cancel`·키보드·접근성 이벤트의 순서와 누락 금지 조건.
7. **프레임/문서 경계:** HostDocument 소유자, 변경 commit 및 `DocumentRevision` 충돌 복구, 레이아웃 snapshot 병합, 렌더러의 stale revision 폐기와 프레임 마감.
8. **이벤트 루프 순서:** JS task 종료 뒤 microtask checkpoint, 타이머·Promise·host callback 순서, `scheduler.yield()` 양보 후 continuation 우선순위, 작업 중 예외 전달.
9. **취소·종료와 앱 수명:** 대기 작업 취소, 실행 중 JS 종료 요청 시점, 종료 제한 시간, 강제 종료 뒤 Isolate 재사용 가능성, 앱 pause/background/foreground에서 task를 보류·제한·폐기하는 기준.
10. **오류와 자원 고갈:** 큐 포화·메모리 할당 실패·Rust panic·C++ 예외의 복구 단위, 비동기 오류의 JS 전달과 진단 보존 기간.

## 구현 후 검증 관문 (아직 미실행)

분리 전 커밋의 우선순위 선택기·FFI 세션 작업자 Rust 테스트와 Android·iOS Simulator 빌드는 통과했다. 가짜 V8 혼합 우선순위 테스트에서 실행 순서를 확인했다. 이후 세션 작업자를 `spinon-runtime`으로 옮기고 FFI를 얇은 C ABI 어댑터로 정리했다. 현재 분리 코드는 `cargo check --workspace --locked`를 통과했지만 분리 후 Rust 테스트·플랫폼 앱 빌드는 실행하지 않았다. 실제 V8을 이용한 세 등급 경합과 플랫폼의 선택 순서·기아 동작도 아직 확인하지 않았다.

명령별 결과와 테스트 범위: [R06 Chromium 참고 우선순위 큐 구현 확인](evidence/r06-task-scheduler-2026-09-30.md).

- 장시간 JS 실행 중 입력을 넣어 UI 입력·GPU frame 제출이 JS 반환을 기다리지 않는지 확인한다. 높은 우선순위 JS callback도 현재 JS 작업 종료 전에는 실행되지 않는 사실을 별도 기록한다.
- 각 우선순위 대기 작업을 동시에 넣어 선택 순서, 같은 등급 안의 순서, 반복 입력 아래 `background`의 기아 여부를 확인한다. 결과는 미리 정한 공정성 계약에 대조한다.
- 큐 포화에서 각 접수 경계의 거부·병합·완료 수가 보존되는지 재현하고 UI 메인 스레드에 blocking wait가 없는지 확인한다.
- Isolate owner thread와 cancellation control thread를 따로 기록한다. `TerminateExecution()` 이외 V8 핸들·Context 접근 및 Isolate 해제가 소유 스레드에 남는지 확인한다.
- JS 작업·문서 commit·snapshot·GPU frame의 revision을 함께 기록해 지연 계산과 입력이 오래된 화면에 잘못 적용되지 않는지 확인한다.
- 에뮬레이터·시뮬레이터 확인과 실기기 성능·메모리 결과를 분리한다. UI 응답 확인만으로 성능 우위를 주장하지 않는다.

## 참고 기준

- [WICG Prioritized Task Scheduling 초안](https://wicg.github.io/scheduling-apis/) — 우선순위 이름, `postTask()`·`yield()` 및 제어 신호 제안. 2026-09-30 확인.
- [Chromium `TaskQueue`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/base/task/sequence_manager/task_queue.h) — 고정 우선순위에서 일반 기아 방지를 보장하지 않는다는 설명. 2026-09-30 확인.
- [Chromium `TaskQueueSelector`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/base/task/sequence_manager/task_queue_selector.h) — 작업 선택과 제한된 지연/즉시 작업 starvation 보정. 2026-09-30 확인.
- [Blink 메인 스레드 스케줄러](https://chromium.googlesource.com/chromium/src/+/f10bbdb7693a6ab4f54dd4a73cf68e3c218507a2/third_party/blink/renderer/platform/scheduler/main_thread/main_thread_scheduler_impl.cc) — 입력·컴포지터 중심의 별도 동적 정책. 2026-09-30 확인.
- [Chromium Blink의 작업 스케줄링 지침](https://chromium.googlesource.com/chromium/src/+/master/third_party/blink/renderer/platform/scheduler/TaskSchedulingInBlink.md) — task source 분류, 입력 우선순위, 비선점 작업, starvation·백그라운드 정책에 관한 내부 문서. 2026-09-30 확인.
- [WHATWG HTML 이벤트 루프](https://html.spec.whatwg.org/multipage/webappapis.html) — task와 microtask의 별도 실행 모델 참고. 이 문서로 Spinon 이벤트 루프 적합성을 주장하지 않는다.
