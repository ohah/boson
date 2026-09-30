# 내부 인터페이스 0005 · V8 런타임 세션 실험

**상태:** 실험 전용 · **인터페이스 버전:** `0.1.0-draft` · **공개 API:** 아님

이 문서는 한 JavaScript 런타임 세션이 V8 Isolate 하나를 소유하는 실험 인터페이스다. Rust가 만든 전용 OS 스레드에서 V8을 초기화하고 일반 V8 호출을 직렬 처리한다. Android와 iOS 개발 화면에서 입력·취소·재사용·종료 경계를 확인한다. 이 구현은 제품 스레드 정책이나 R06 완료를 뜻하지 않는다. 결정된 기본 실행 방향과 미정 구현 경계는 [UI 트리·이벤트 명세](../0002-ui-tree-events.md)를 따른다.

## 검증 대상

- Android ARM64 앱 경로: V8 소스의 `out/boson-android-mac/args.gn`에서 `v8_jitless = false`를 확인했다. Android 16 에뮬레이터에서 백그라운드 입력, 실제 V8 취소 후 같은 Isolate 재사용, Activity 종료·세션 재생성, 플랫폼 작업 대기열 압력을 확인했다.
- iOS ARM64 시뮬레이터: iPhone 17 Pro / iOS 26.2에서 백그라운드 부팅, 수동 UIKit 입력, 실제 V8 무한 평가 취소 후 대기 이벤트 처리, 세션 종료·재생성을 확인했다. 시뮬레이터 V8 GN 설정은 `v8_jitless = false`다. 실기기 실행과 JITless 기기 정책은 확인하지 않았다.
- 공개 DOM·HostDocument·GPU·React·Fetch·Promise·타이머 API는 범위 밖이다.
- 스레드 수·공정성·성능에 관한 비교 결론은 내리지 않는다.

## 소유권과 호출 순서

1. `spinon_runtime_session_new`는 `spinon-js-runtime` OS 스레드를 만들고 그 스레드에서 V8 Isolate와 Context를 생성한다.
2. 해당 세션의 `eval`, 이벤트 `dispatch`, Isolate 해제는 이 스레드에서만 실행한다. Rust 콜백도 현재 동기 호출이므로 같은 스레드에서 실행된다.
3. C ABI `eval`과 `dispatch`는 결과를 기다리는 동기 함수다. 플랫폼 UI 스레드에서 직접 호출하지 말고 별도 실행기에서 호출해야 한다.
4. 런타임 명령 큐는 현재 실행 중인 작업과 별도로 대기 명령 최대 64개를 받는 bounded FIFO다. 접수 순서는 짧은 제출 mutex로 직렬화한다. 큐가 차면 새 명령을 즉시 거부하며, 병합·우선순위·이벤트 coalescing은 하지 않는다. 이는 Android/iOS 플랫폼 어댑터 대기열과 별도의 용량이다.
5. 보고서에는 호출자·소유자·마지막 콜백 OS thread ID, 명령 큐 대기 시간, V8 eval/dispatch 호출 시간, 취소 요청 여부가 포함된다. `queue_wait_us`는 API 제출 시점부터 작업자 수신까지이고, `v8_call_us`는 C++ V8 호출 구간만 잰다. 취소 요청과 실제 V8 종료는 별도 값이다. `-8`은 요청이 있었고 V8 `TryCatch::HasTerminated()`도 참일 때만 반환한다.

## 취소와 종료

- `spinon_runtime_session_cancel`은 실행 중인 JS에만 취소를 요청한다. 대기 중인 명령은 취소하지 않는다. 실행이 없으면 `1`, 요청을 보냈으면 `0`이다.
- 고정된 V8 헤더는 `TerminateExecution()`을 V8 lock을 얻지 않은 다른 스레드에서도 부를 수 있다고 명시한다. 이 실험은 이 함수만 소유자 밖에서 호출한다. 다른 V8 핸들·Context 조작은 외부에서 하지 않는다.
- 작업자가 JS 호출에서 돌아온 뒤 소유자 스레드가 `CancelTerminateExecution()`을 호출해 다음 명령을 허용한다. 가짜 엔진 단위 테스트 외에도 Android 에뮬레이터와 iOS 시뮬레이터에서 실제 V8 무한 평가를 취소한 뒤 같은 Isolate로 대기 이벤트를 실행하고 성공을 확인했다. 실기기 및 JITless 구성은 미검증이다.
- `free`는 새 접수를 막고 활성 JS를 취소한 뒤, 이미 대기 중인 명령에 종료 오류를 돌려주고 작업자를 join한다. join 제한 시간은 없다. 호출자는 다른 eval/dispatch/cancel 호출이 끝난 뒤에만 `free`해야 한다.
- 비동기 네이티브 함수, Promise, 타이머, 앱 백그라운드 전환, 강제 종료 중 결과 전달은 아직 없다.

## 내부 C ABI

선언은 저장소 파일 `crates/spinon-ffi/include/spinon_ffi.h`에 있다.

| 함수 | 결과 | 주요 제약 |
| --- | --- | --- |
| `spinon_runtime_session_new` | 불투명 세션 포인터 또는 `NULL` | 성공 보고에 owner TID와 큐 용량을 기록 |
| `spinon_runtime_session_eval` | 성공 `0`, 인자 `-1`, 출력 부족 `-3`, JS 오류 `-4`, 큐 포화 `-5`, 종료 중 `-6`, 작업자 오류 `-7`, 취소 `-8` | NUL 종료 UTF-8 원본, 동기 대기 |
| `spinon_runtime_session_dispatch` | eval과 같은 상태 코드 | 등록 이벤트 핸들러에 노드 ID 전달 |
| `spinon_runtime_session_cancel` | 취소 요청 `0`, 실행 중 아님 `1`, 오류 음수 | 별도 제어 스레드에서 호출 가능 |
| `spinon_runtime_session_free` | 반환값 없음 | 다른 세션 호출자와 동시 호출 금지, 취소·join으로 기다릴 수 있음 |

모든 함수는 개발 실험 내부 ABI다. 이 오류 코드나 큐 크기를 앱 작성자에게 약속하지 않는다.

## Android 개발용 화면

기본 부팅 화면과 R10 화면은 유지한다. 실행 Intent에 `spinon_runtime_threads=true`를 주면 별도 스레드 실험 화면을 연다.

```sh
adb shell am start -n dev.spinon.bootstrap/.MainActivity --ez spinon_runtime_threads true
adb logcat -s SpinonBootstrap:I
```

화면에서 이벤트 전송, 무한 JS 평가, 취소, 0.5초 뒤 네이티브가 JS를 다시 넣는 모의를 실행한다. 이 모의는 비동기 JS API 계약이나 실제 네트워크 응답을 검증하지 않는다. 무한 루프 중 탭이 화면에 반응하는지 직접 확인하고, 취소 후 로그에서 같은 `owner_tid`와 `callback_tid`를 비교해야 한다.

## iOS 시뮬레이터 개발용 화면

iOS Objective-C++ `SpinonRunner.mm`가 세션 생성·eval·dispatch·cancel·free를 감싼다. Swift 화면은 동시 백그라운드 queue를 사용하되 semaphore로 접수된 eval/dispatch 전체를 최대 64개로 제한한다. 취소는 별도 직렬 제어 queue에서 요청하며, 세션 종료·재생성은 `DispatchGroup`이 이미 접수한 호출의 반환을 확인한 뒤 `free`한다. 대기 제한 시간은 없다.

```sh
xcrun simctl launch booted dev.spinon.bootstrap --spinon-runtime-threads
xcrun simctl launch --terminate-running-process booted dev.spinon.bootstrap --spinon-runtime-threads --spinon-r06-auto
```

첫 실행 인자는 수동 검증 화면을 연다. 두 번째는 긴 JS, UIKit 타깃 액션, 취소, 메인 UI heartbeat와 대기 이벤트 처리를 자동 확인한다. 별도 수동 검증에서 시뮬레이터 터치 입력도 확인했다. 12초 watchdog은 취소를 요청할 뿐 V8 반환 전에 시나리오를 완료 처리하지 않는다. 로그와 캡처는 [R06 검증 기록](evidence/r06-v8-runtime-thread-2026-09-30.md)에 연결한다. 이 화면은 제품 API가 아니다.

## 미결정 사항

- 기본 실행 방향은 UI 트리·이벤트 명세에서 백그라운드 기본값으로 정했지만, 앱마다 전용 OS 스레드를 둘지 공용 런타임 스레드 풀을 둘지, 메모리·공정성·다중 앱 종료 격리를 비교하지 않았다.
- iOS의 실행 스레드/큐 및 JITless 실기기 동작은 미검증이다.
- HostDocument 소유자, UI 커밋 경계, revision 충돌과 JS-visible 동기 조회는 연결되지 않았다.
- 큐 포화 외 backpressure 정책, 이벤트 병합, 우선순위, 프레임 snapshot 병합은 미정이다.
- `free` 대기 시간 제한, 강제 종료 후 Isolate 복구, pending Promise·플랫폼 요청 오류 보존은 미정이다.
- 메모리 할당 실패·Rust panic·C++ 예외의 복구와 진단 보존을 보장하지 않는다.
