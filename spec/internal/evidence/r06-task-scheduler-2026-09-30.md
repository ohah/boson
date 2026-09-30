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

## 코드 분리 직후 기록 (저장 공간 확보 전)

세션 작업자와 V8 소유권 코드를 `crates/spinon-runtime`으로 이동하고 `crates/spinon-ffi`를 C ABI 변환 어댑터로 정리한 직후의 기록이다. 이 시점에는 `cargo check --workspace --locked`만 통과했고 자동 테스트와 Android/iOS 빌드는 실행하지 않았다. 이는 코드 분리 직후의 중간 결과다. 아래 저장 공간 확보 뒤 재검증 결과가 현재 상태다. 위쪽 테스트·플랫폼 결과는 분리 전 소스 커밋의 기록이며 새 배치가 동일하게 동작한다는 증거로 사용하지 않는다.

## 분리 후 초기 적대적 재검증 (저장 공간 확보 전)

2026-09-30에 의존 방향, V8 심볼 소유권, C 헤더와 Rust ABI 선언, 세션 취소·종료 경로, 상태 대장과 근거 문서를 다시 대조했다. FFI 테스트 모듈의 사용하지 않는 import 경고를 발견해 제거했다.

| 명령 | 결과 |
| --- | --- |
| `mise exec -- bun run test` | Bun 1개와 Rust 단위 테스트 33개 통과. 실행 때 사용하지 않는 import 경고가 있었고 이후 제거했다. 제거 뒤 재실행은 `target/.fingerprint` 기록 중 디스크 부족으로 Rust 테스트 시작 전에 실패했다. |
| `mise exec -- bun run build:android` | Android ARM64 Rust/C++ 라이브러리와 debug APK 빌드 성공. Gradle은 환경 NDK 경로가 고정 버전과 달라 무시하고 SDK NDK `27.1.12297006`을 사용했다. |
| `mise exec -- bun run build:ios-sim` | ARM64 앱 실행 파일 생성 뒤 dSYM 단계에서 `No space left on device`로 전체 빌드 실패. 실행 당시 여유 공간은 약 101 MiB였고 앱 설치·실행은 확인하지 않았다. |
| Android 16 ARM64 `sdk_gphone64_arm64` 에뮬레이터에 새 APK 설치·실행 | 초기 eval 성공. 무한 eval 중 UI 탭 카운터가 증가했고, 취소 후 eval `status=-8`, 대기 이벤트 `status=0`; 실행·콜백 `owner_tid=7550`으로 일치했다. |
| `gh pr checks 15` | 보고된 검사 없음. |

첫 테스트 실행은 경고 수정 전 소스에서 통과했다. 이후 수정은 사용하지 않는 테스트 import 한 줄 제거뿐이며, 수정 뒤 Rust 재실행과 iOS 전체 빌드는 저장 공간 문제로 완료하지 못했다. Android 링크 빌드는 수정 뒤 성공했다. 이 결과는 분리 후 앱 런타임 실행이나 실제 V8 우선순위 선택 순서를 증명하지 않는다.

Android 실행에서는 긴 JavaScript 평가 중 두 번째 UI 탭이 즉시 화면에 반영됐고, JS 취소를 요청하자 평가가 `status=-8`로 반환된 뒤 이벤트 dispatch가 `status=0`으로 처리됐다. 해당 한 번의 큐 대기 보고는 성능 지표가 아니다. [분리 후 Android 화면 캡처](spinon-r06-android-post-split-2026-09-30.png).

## 저장 공간 확보 뒤 분리 후 재검증

2026-09-30에 여유 공간을 확보한 뒤, import 경고 제거가 반영된 현재 작업 트리(`a4764b8` 기준)를 다시 검증했다.

| 명령·동작 | 결과 |
| --- | --- |
| `mise exec -- bun run test` | 통과: Bun 1개, Rust 단위 테스트 33개. `spinon-core` 16개, `spinon-ffi` 3개, `spinon-runtime` 6개, 레이아웃 실험 라이브러리 5개·실행 파일 3개. |
| `mise exec -- bun run build:ios-sim` | Xcode 26.2 / iOS 26.2 Simulator SDK, ARM64 앱 빌드 성공. V8 정적 아카이브의 중복 debug-map 경고가 있었지만 dSYM 생성을 포함해 빌드가 완료됐다. |
| iPhone 17 Pro / iOS 26.2 시뮬레이터 설치·자동 실행 | `--spinon-runtime-threads --spinon-r06-auto` 실행 완료. 긴 평가 `status=-8`, 대기 이벤트 `status=0`, heartbeat 증가 17, 평가·dispatch·콜백 owner thread 일치, 세션 종료·재생성 후 eval·dispatch `status=0`. |
| 원본 근거 | [iOS OS 로그](r06-ios-simulator-post-split-2026-09-30.log) · [검증 완료 화면](spinon-r06-ios-post-split-2026-09-30.png). |

대기 이벤트의 `queue_wait_us=466715`는 한 번의 시뮬레이터 실행 관찰값이며 성능 지표가 아니다. 이번 실행은 분리 후 iOS 앱 경로의 취소·대기 이벤트·스레드 소유권·세션 재생성을 확인한다. 실제 V8 혼합 우선순위 선택 순서와 기아, 실기기, JITless iOS, 공유 실행기 비교는 검증하지 않는다. 앞선 저장 공간 부족으로 인한 iOS 빌드 실패와 테스트 재실행 실패는 이번 성공한 재검증으로 대체한다.
