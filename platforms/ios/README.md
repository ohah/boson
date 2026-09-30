# iOS 부트스트랩과 R06 실험

`SpinonBootstrap.xcodeproj`는 Bun으로 만든 JavaScript를 V8에서 평가하고 Rust 콜백 및 역방향 JS 이벤트를 실행하는 개발용 부트스트랩입니다. 기본 시작 smoke는 백그라운드 Dispatch queue에서 실행합니다. 빈 UIKit 호스트 창과 로그는 제품 렌더러가 아니며 UIKit 위젯 기반 UI를 뜻하지 않습니다.

필요한 도구는 Xcode, iOS Simulator SDK, 루트 `mise.toml`에 고정한 Rust·Bun입니다. Xcode의 빌드 스크립트가 Rust 정적 라이브러리와 V8 어댑터를 준비하고 번들을 앱 리소스에 복사합니다. V8 커밋과 시뮬레이터·기기별 GN 산출물은 [V8 빌드 안내](../../native/v8/VERSION.md)를 따릅니다.

루트에서 `mise exec -- bun run build:ios-sim`으로 시뮬레이터 앱을 빌드합니다. 기본 실행 로그의 `SPINON_BOOTSTRAP_EXECUTION is_main_thread=false`와 `SPINON_BOOTSTRAP_RESULT=nodes=2 last_node=8 tag=text text=이벤트:7`로 백그라운드 JS 부팅을 확인할 수 있습니다.

R06 개발 화면은 아래 실행 인자를 받습니다.

```sh
xcrun simctl launch booted dev.spinon.bootstrap --spinon-runtime-threads
xcrun simctl launch --terminate-running-process booted dev.spinon.bootstrap --spinon-runtime-threads --spinon-r06-auto
xcrun simctl launch --terminate-running-process booted dev.spinon.bootstrap --spinon-priority-probe
```

첫 명령은 터치 이벤트, 긴 JavaScript 실행, 취소, 세션 재생성을 수동으로 확인합니다. 두 번째 명령은 메인 UI heartbeat, 취소된 eval, 대기 이벤트 처리, V8 소유 스레드 일치, 세션 종료·재생성을 자동으로 검증합니다. 세 번째 명령은 실제 V8에서 실행 중인 JavaScript를 취소한 뒤, 우선순위를 섞어 접수한 6개 작업의 `user-blocking` → `user-visible` → `background` 선택과 같은 등급 FIFO를 검사합니다. 동기 FFI 호출은 동시 백그라운드 queue에서 처리하지만 semaphore로 진행 중·대기 중 호출을 합해 최대 64개로 제한합니다. 취소는 별도 직렬 제어 queue에서 요청하고, 세션 종료·재생성은 `DispatchGroup`으로 접수된 호출의 반환을 기다립니다. Objective-C++ `SpinonRunner.mm`는 Rust C ABI에 대한 얇은 변환 계층입니다. iOS 대기열 포화나 종료 제한 시간은 아직 검증하지 않았습니다.

Android 에뮬레이터와 iOS 시뮬레이터를 빌드·실행하고 실제 V8 우선순위 결과를 자동 판정하는 반복 명령은 `mise exec -- bun run verify:r06-priority:simulators`입니다. 이 스크립트는 부팅된 iOS 시뮬레이터만 대상으로 합니다.

2026-09-30 기준 iPhone 17 Pro / iOS 26.2 시뮬레이터에서 앱 빌드·부팅, R06 수동·자동 시나리오, 실제 V8의 혼합 우선순위 여섯 작업 단일 배치를 확인했습니다. 순서는 `user-blocking` 두 개, `user-visible` 두 개, `background` 두 개였고 등급별 FIFO와 Isolate owner thread 콜백을 통과했습니다. 런타임 분리 후에도 빌드와 자동 시나리오를 다시 통과했습니다. 시뮬레이터 V8은 `v8_jitless=false` 구성입니다. 이 결과는 장기 기아·공정성, iOS 실기기, JIT 없는 기기 빌드, GPU·제품 렌더러·접근성 동작을 검증하지 않습니다. 분리 전 근거는 [R06 런타임 기록](../../spec/internal/evidence/r06-v8-runtime-thread-2026-09-30.md), 분리 후 근거는 [최신 재검증 기록](../../spec/internal/evidence/r06-task-scheduler-2026-09-30.md), [우선순위 시뮬레이터 검증](../../spec/internal/evidence/r06-priority-simulators-2026-09-30.md)과 [iOS 로그·캡처](../../spec/internal/README.md#검증-기록)에 있습니다. 구현 완료 표시는 [공식 상태 대장](../../spec/STATUS.md)을 따릅니다.

V8 링크에는 `BrowserEngineCore`가 포함됩니다. 이 부트스트랩의 시뮬레이터 빌드는 앱 배포 자격이나 App Store 정책 적합성을 확인하지 않으며, 해당 정책 검토는 [구현 상태 대장](../../spec/STATUS.md)의 R09에서 별도로 진행합니다.
