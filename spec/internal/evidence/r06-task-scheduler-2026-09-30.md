# R06 Chromium 참고 우선순위 큐 구현 확인

**일자:** 2026-09-30 · **검증 당시 범위:** Rust 선택기, FFI 세션 작업자, 플랫폼 빌드·기본 런타임 smoke · **실기기 우선순위 경합:** 미검증

## 구현

- `spinon-core::PriorityQueue`에 `user-blocking`, `user-visible`, `background`의 세 FIFO를 두고 높은 등급부터 선택한다.
- 같은 우선순위에서는 먼저 넣은 작업이 먼저 나온다.
- 검증 당시 `spinon-ffi` 런타임 세션은 총 대기 작업 64개를 제한하고, 작업자가 대기 중일 때 조건 변수로 깨웠다.
- 기존 `dispatch`는 `user-blocking`, 기존 `eval`은 `user-visible`로 제출한다. 내부 실험 C ABI의 `*_with_priority`는 세 등급을 직접 지정할 수 있다.
- 실행 중 JavaScript는 선점하지 않고 일반 기아 방지나 등급별 용량 예약은 구현하지 않았다. 지연 작업이 없으므로 Chromium의 지연/즉시 작업 보정도 구현하지 않았다.

## 자동 확인

실행한 Rust 명령:

```sh
cargo check --workspace
cargo test --locked --workspace
```

두 명령 모두 통과했다. 전체 35개 Rust 단위 테스트 결과:

| 묶음 | 통과 |
| --- | ---: |
| `spinon-core` | 16 |
| `spinon-ffi` | 11 |
| `spinon-style-layout-spike` 라이브러리 | 5 |
| `spinon-style-layout-spike` 실행 파일 | 3 |

검증 당시 코어 선택기 테스트는 세 등급 선택과 FIFO를 확인했다. FFI 세션 통합 테스트는 가짜 V8의 긴 평가가 실행 중일 때 background eval, user-visible dispatch, user-blocking dispatch 두 개를 순서대로 접수한 뒤 취소했다. 실행 순서는 `dispatch:31`, `dispatch:32`, `dispatch:22`, `eval:background`였다. 실행 중 작업은 선점하지 않고, 다음 작업 선택에서 높은 등급을 우선하며 같은 등급 FIFO를 유지함을 확인했다. 별도의 FFI 어댑터 테스트는 ABI 우선순위 값, bounded 대기열 선택과 종료 후 제출 거부를 확인했다.

플랫폼 확인:

| 명령·동작 | 결과 |
| --- | --- |
| `mise exec -- bash tools/build-android-app.sh` | Android ARM64 Rust/C++ 라이브러리와 debug APK 빌드 성공 |
| `mise exec -- bash tools/build-ios-sim.sh` | iOS Simulator ARM64 Rust/C++ 라이브러리와 앱 빌드 성공. V8 정적 라이브러리 debug map 경고가 있었으나 Xcode 빌드는 성공 |
| Android 16 에뮬레이터에 새 APK 설치 후 R06 화면 실행 | 로그에 `queue_policy=strict-priority-fifo`, 초기 eval 성공 기록 |
| iPhone 17 Pro / iOS 26.2 시뮬레이터에 새 앱 설치 후 `--spinon-r06-auto` 실행 | 무한 eval 취소, 대기 dispatch, UI heartbeat, Isolate 소유자, 세션 재생성 시나리오 통과 |

플랫폼 R06 smoke는 새 바이너리가 로드되고 기본 호출·수명 경로가 동작하는지 확인했다. 같은 실행 세션의 서로 다른 우선순위 작업을 동시에 쌓아 선택 순서를 검증하지는 않는다.

## 검증하지 않은 동작

- 실제 V8로 혼합 우선순위 작업을 실행하지 않았다. Android·iOS에서 세 우선순위 작업을 함께 대기시킨 뒤 선택 순서도 확인하지 않았다.
- Android 화면은 설치 후 열어 기본 eval을 확인했지만 탭 경합을 실행하지 않았다. iOS 자동 시나리오의 UIKit 액션은 실행 중 eval을 선점하지 않았고, 취소 후 dispatch가 실행됐다.
- 기존 앱 경로로 기본 `eval`/`dispatch`는 실행했지만, 개별 작업의 우선순위 선택 결과를 런타임 로그에 기록하지 않았다.
- 상위 등급이 계속 유입될 때 낮은 등급이 실제로 굶는 시간, 지연 분포와 UI 입력 지연을 측정하지 않았다.
- 성능 향상, 모바일 런타임 동작, 플랫폼 스레드 공정성을 주장하지 않는다.

## Chromium 참고 범위

이 구현은 Chromium `TaskQueueSelector`의 우선순위 선택과 같은 우선순위 안의 enqueue 순서를 작은 R06 실험 큐에 반영한다. Chromium의 모든 큐 종류, task source 정책, Blink 입력·컴포지터 재분류 또는 지연 작업 보정의 완전한 포팅이 아니다. 코드 근거와 경계는 [내부 JavaScript 작업 스케줄러 설계](../0006-js-task-scheduler.md)를 따른다.

## 후속 코드 분리

검증 뒤 세션 작업자와 V8 소유권 코드를 `crates/spinon-runtime`으로 이동하고 `crates/spinon-ffi`를 C ABI 변환 어댑터로 정리했다. 분리 후 `cargo check --workspace --locked`는 통과했지만 자동 테스트와 Android/iOS 빌드는 실행하지 않았다. 위 테스트·플랫폼 검증 결과는 분리 전 소스 커밋의 기록이며, 새 배치가 동일하게 동작한다는 증거로 사용하지 않는다.
