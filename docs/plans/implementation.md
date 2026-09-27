# 스피논 모노레포 구현 계획

이 문서는 스파이크 중심 저장소를 Cargo·Bun 워크스페이스로 전환하는 작업 순서, 디렉터리 책임, 테스트 경계를 정리합니다. 구현 상태와 제품 지원 여부의 단일 원본은 계속 [공식 상태 대장](../../spec/STATUS.md)입니다. 이 문서는 별도의 완료 체크리스트가 아닙니다. 단계의 완료 여부는 상태 대장의 ID로 판단합니다.

첫 공식 릴리스의 범위는 이 문서에서 정하지 않습니다. 아래 구조와 패키지 이름은 구현을 분리하기 위한 제안이며, 제품 공개 API가 확정됐다는 뜻은 아닙니다.

## 권장 저장소 구조

```text
spinon/
├── Cargo.toml                 # Rust workspace와 공통 의존성
├── Cargo.lock                 # 앱/도구 Rust workspace 잠금 파일
├── package.json               # Bun workspaces와 저장소 명령
├── bun.lock                   # JS/TS workspace 잠금 파일
├── crates/
│   ├── spinon-core/           # UI 트리, ID, 변경 배치, 오류 계약
│   ├── spinon-layout/         # LayoutEngine 경계와 Taffy 어댑터
│   ├── spinon-render/         # 플랫폼에 무관한 장면·그리기 명령
│   └── spinon-ffi/            # 좁은 C ABI: Rust와 호스트 연결
├── native/
│   └── v8/                    # V8 C++ 어댑터와 공통 헤더
├── platforms/
│   ├── android/               # Gradle 앱, Kotlin 호스트, JNI/C++ 접착부
│   └── ios/                   # Xcode 앱, Swift 호스트, Objective-C++ 접착부
├── packages/
│   ├── docs/                  # spec/을 만드는 내부 @spinon/docs 패키지
│   ├── runtime/               # 작성 코드의 JS 호스트 API
│   ├── frameworks/
│   │   ├── react/              # React 호스트 어댑터
│   │   ├── vue/                # Vue 호스트 어댑터
│   │   └── svelte/             # Svelte 통합
│   ├── bundlers/
│   │   ├── vite/               # Vite 통합
│   │   └── rspack/             # Rspack 통합
│   └── cli/                   # create/dev/build/doctor 명령
├── examples/
│   └── counter/               # 웹·Android·iOS 공통 예제
├── tests/
│   ├── conformance/           # 공통 입력, 기대 트리·프레임·이벤트
│   └── integration/           # 런타임·번들러·플랫폼 연결 시나리오
├── docs/                      # 아키텍처와 구현 순서
├── spec/                      # 규범 문서와 공식 구현 상태
└── spikes/                    # 비교 실험, 재현 코드, 원본 결과 보존
```

초기 워크스페이스에 빈 크레이트를 한꺼번에 만들지 않습니다. 각 모듈은 맡을 코드와 테스트가 준비될 때 추가합니다. `spikes/`는 기존 실험을 재현하고 근거를 보존하는 공간으로 남기며, 제품 코드가 의존하는 위치로 사용하지 않습니다.

### 책임과 언어

| 경계 | 경로 | 책임 |
| --- | --- | --- |
| 공통 런타임 코어 | `crates/spinon-core` | 안정적 노드 ID, UI 트리, 변경 배치, revision, 오류·복구 의미 |
| 레이아웃 | `crates/spinon-layout` | 코어 노드와 레이아웃 엔진 사이 어댑터, Taffy 적용·검증 |
| 렌더 명령 | `crates/spinon-render` | 장면 변경, 그리기 명령, hit-test 입력·결과 모델 |
| 언어 경계 | `crates/spinon-ffi`, `native/v8` | Rust C ABI와 V8 C++ API를 제한된 값·핸들로 연결 |
| Android | `platforms/android` | Gradle 빌드, 앱 수명주기, 표면·입력·IME·접근성·JNI 연결 |
| iOS | `platforms/ios` | Xcode 빌드, 앱 수명주기, 표면·입력·IME·접근성·Objective-C++ 연결 |
| JS 패키지 | `packages/*` | 공개 JS 호스트 API, 프레임워크·번들러 어댑터, CLI |
| 공통 적합성 | `tests/conformance` | 플랫폼·프레임워크별로 공유할 시나리오와 기대 결과 |

Rust 코어와 C ABI는 분리합니다. `spinon-core`의 공개 Rust API는 안전한 타입 중심으로 두고, 포인터 수명·버퍼 복사·콜백 ABI는 `spinon-ffi`에 둡니다. V8 객체와 Rust 내부 포인터를 경계 밖에 보관하지 않습니다.

## CLI 언어 결정 제안

CLI는 **TypeScript로 작성하고 Node.js LTS에서 실행**하는 방식을 권합니다. Vite·Rspack·npm 패키지·소스맵·JS 개발 서버를 직접 연결하고, 같은 언어로 번들러 플러그인과 프로젝트 템플릿을 관리할 수 있기 때문입니다. Rust는 UI 런타임과 네이티브 코어를 맡고, CLI는 개발 도구 생태계를 조율합니다.

Bun은 저장소의 JS/TS 워크스페이스, 잠금 파일, 스크립트와 테스트 실행에 사용합니다. 배포된 CLI의 사용자가 Bun 설치를 강제받지 않도록 CLI 패키지는 Node.js용 JavaScript로 빌드해 npm에서 배포합니다. `bun`과 `node`에서 CLI 테스트를 돌려 런타임 차이를 확인합니다. Rust CLI로 바꾸는 결정은 배포 크기·실행 시간·플랫폼 지원에서 구체적인 이점이 나온 뒤 다시 검토합니다.

## Cargo와 Bun 워크스페이스

- 루트 `Cargo.toml`이 제품·내부 crate를 `[workspace]`로 관리하고 루트 `Cargo.lock` 하나를 사용합니다. 현재 `crates/spinon-ffi`는 부팅 smoke만 잇는 내부 crate이며 제품 API를 제공하지 않습니다. 공통 crate 버전은 `workspace.dependencies`에서 고정합니다.
- 루트 `package.json`은 Bun workspace와 문서·저장소 명령 진입점만 관리합니다. 실제 패키지는 준비될 때 구성원으로 추가하고, 존재하지 않는 패키지 경로를 미리 workspace에 나열하지 않습니다. 문서 생성기는 `packages/docs`에 두고 RSPress를 `2.0.22`에 고정합니다. `examples/bootstrap/app.js`는 프레임워크 API 확정 전의 번들 입력입니다.
- Rust 컴파일 결과는 루트 `build/` 또는 Cargo 공통 `target/`에 모읍니다. Gradle 캐시, Xcode 산출물, JS 의존성, 환경 파일은 Git에 넣지 않습니다.
- 스파이크의 독립 `Cargo.lock`, Bun 잠금 파일, 빌드 명령은 코드를 제품 크레이트로 옮겨 동작이 같음을 확인할 때까지 보존합니다. 잠금 파일을 일괄 삭제하거나 의존성을 최신화하지 않습니다.
- Taffy, Lightning CSS처럼 외부 의존성은 목적·버전·기능·대체 경계를 검토한 뒤 제품 workspace에 올립니다. Lightning CSS는 빌드 도구이며 모바일 런타임 의존성으로 포함하지 않습니다.

현재 루트 명령은 저장소 개발과 플랫폼 부팅 smoke에 한정합니다.

```sh
cargo test --locked --workspace
bun run test:js
bun run bundle:bootstrap
bun run test
bun run build:android
bun run build:ios-sim
```

`bun run test`는 Rust workspace 테스트와 Bun JS 예제 테스트를 실행합니다. 아직 공통 적합성 스위트나 앱 통합 XCTest는 만들지 않았습니다. 플랫폼 빌드는 각 OS SDK와 고정 V8 checkout이 필요한 로컬 명령이며 JS/Rust 단위 테스트 결과와 구분합니다.

## 플랫폼 빌드 디렉터리

### Android

```text
platforms/android/
├── settings.gradle.kts
├── build.gradle.kts
├── gradlew                       # Gradle 8.13 Wrapper
└── app/
    ├── build.gradle.kts
    └── src/
        ├── main/AndroidManifest.xml
        ├── main/java/dev/spinon/bootstrap/ # 빌드 smoke Activity
        ├── main/cpp/                      # JNI와 V8/Rust 연결 설정
        └── build/                         # 무시되는 번들·JNI 산출물
```

현재 Gradle `preBuild`는 JS 번들 → Rust ARM64 정적 라이브러리 → JNI/V8 공유 라이브러리 → APK 순서로 부팅 smoke를 빌드합니다. 이는 실제 CLI, GPU surface, 입력·IME·접근성 연결이 아닙니다.

### iOS

```text
platforms/ios/
├── SpinonBootstrap.xcodeproj/
└── Sources/
    ├── AppDelegate.swift                 # 빈 호스트 창과 시작 로그
    ├── SpinonRunner.mm                    # 내부 C ABI 호출
    └── SpinonBootstrap-Bridging-Header.h
```

Xcode build phase가 Bun 번들 → Rust 정적 라이브러리 → V8 C++ 어댑터 → 앱 연결 순서로 수행합니다. 현재 재현 명령은 Apple Silicon 시뮬레이터입니다. 실기기 JIT 없는 앱 빌드는 별도 대상으로 남아 있습니다.

부팅에 필요한 Cargo target, V8 리비전, iOS/Android 빌드 입력은 [내부 V8 인터페이스](../../spec/internal/0001-v8-bootstrap.md)에 고정했습니다. 이것은 R02의 실기기·JIT 정책 검증, R06의 동시 호출·스레드 계약, R08의 GPU 렌더러 실험을 통과했다는 뜻이 아닙니다. 제품 ABI와 네이티브 런타임 모듈은 그 계약이 정해진 뒤 별도 설계합니다.

## 테스트 스위트 구성

| 테스트 층 | 위치·실행기 | 확인 대상 |
| --- | --- | --- |
| Rust 단위·통합 | 각 crate의 `tests/`, `cargo test --locked --workspace` | 현재는 FFI 보고 문자열·버퍼 규칙만 검사하며, 트리·레이아웃 테스트는 승격 단계에서 추가 |
| JS/TS 패키지 | `examples/bootstrap/*.test.ts`, `bun test` | 현재 예제 JS의 호스트 콜백과 역방향 이벤트 호출 |
| 공통 적합성 | `tests/conformance/`, Bun 실행기와 Rust fixture 소비 | 동일 앱 시나리오의 트리 revision, 이벤트, 프레임 기대값 |
| 웹 통합 | Playwright 브라우저 테스트 | DOM 호스트, Vite/Rspack 번들, 웹 기준 출력 |
| Android 통합 | Gradle instrumentation | APK 실행, surface 수명, 터치·접근성 이벤트, Rust/V8 연결 |
| iOS 통합 | XCTest | 앱 실행, surface 수명, 터치·접근성 이벤트, Rust/V8 연결 |
| 성능·실기기 | 저장소 스크립트와 원본 로그 | Android 실기기와 iOS 실기기의 입력·프레임·메모리. 시뮬레이터와 결과를 합산하지 않음 |

공통 fixture에는 입력 트리·이벤트 순서와 기대 revision·프레임·오류를 둡니다. 웹·Android·iOS 실행기가 같은 fixture를 읽도록 하며, 구현되지 않은 기능은 임의로 건너뛰지 않고 미지원 결과를 명시적으로 비교합니다. 앱스토어 배포 정책, OTA 승인, 첫 출시 포함 범위는 이 테스트 구조만으로 결정하지 않습니다.

## 단계와 완료 관문

| 단계 | 구현·선행 결정 | 대상 위치 | 다음 단계로 가는 기준 |
| --- | --- | --- | --- |
| 0. 워크스페이스와 빌드 부트스트랩 | Cargo·Bun 기초, 고정 V8 소스 입력, Rust FFI·Android Gradle·iOS Xcode 빌드 smoke와 JS/Rust 단위 검사 | 루트 설정, `crates/spinon-ffi`, `native/v8`, `platforms/`, `tools/` | V8 연결 앱이 각 플랫폼에서 실행되고 결과 문자열이 맞음. 제품 API 완료는 아님 |
| 1. 런타임 계약과 코어 승격 | 실패한 변경 배치 복구, revision·ID, 지연 이벤트·콜백 수명·소유권을 먼저 결정. 동적 트리 PoC의 순수 Rust 코어를 테스트와 함께 이동 | `crates/spinon-core` | Android/iOS 호스트가 공유할 타입·오류·revision 계약과 단위 테스트 확보 |
| 2. 레이아웃 모듈 | Taffy 적합성·비용을 검증하고 작은 PoC와 비교 | `crates/spinon-layout` | 공통 fixture의 웹 기준 좌표와 허용 차이가 정의됨 |
| 3. 제품 V8·FFI 경계 | smoke 경계를 제품 런타임으로 승격하고 격리·예외·콜백 수명·스레드 규칙을 정해 검증 | `crates/spinon-ffi`, `native/v8` | 버전 있는 내부 계약·오류 복구·실기기 검증 |
| 4. 모바일 호스트 골격 | 현재 부팅 앱을 GPU surface·입력·수명주기·복구 검증으로 확장 | `platforms/android`, `platforms/ios` | 같은 런타임이 두 앱에서 실행되고 앱 수명 복구 확인 |
| 5. GPU 첫 수직 화면 | R08 실험 후 GPU 백엔드와 텍스트·버튼 hit-test·접근성 연결 | `crates/spinon-render`, 플랫폼 surface | Android·iOS에서 같은 카운터 시나리오가 표시·입력·복구됨 |
| 6. JS workspace와 첫 개발 흐름 | Runtime 패키지, React 어댑터, Vite 우선 통합, 웹 호스트, 다시 로드·오류 위치 | `packages/runtime`, `packages/frameworks/react`, `packages/bundlers/vite`, `examples/counter` | 한 TSX 앱이 웹·Android·iOS에서 빌드되고 공통 fixture 통과 |
| 7. Rspack·Vue·Svelte·CLI | 코어 호스트 계약을 재사용해 어댑터와 도구 지원 추가. TypeScript CLI를 Node LTS용으로 배포 | `packages/bundlers/rspack`, `packages/frameworks/vue`, `packages/frameworks/svelte`, `packages/cli` | 각 조합의 지원표와 통합 테스트가 있음 |
| 8. 성능·OTA | 같은 fixture·릴리스 빌드에서 비교, 매니페스트·서명·청크·롤백 구현과 호환성 검사 | `tests/`, `packages/cli`, OTA 모듈 | 앱스토어 정책 확인과 대상 플랫폼별 복구·부분 배포 증거 확보 |

단계 0의 설정은 코어 공개 계약을 대신하지 않습니다. 단계 1에서 R03·R06, 레이아웃 단계에서 R10·R11, 렌더러 전에 R08, 성능 전에 R04·R05를 닫습니다. 제품 완료 표시는 해당 단계가 끝났다는 이유만으로 바꾸지 않고, [공식 상태 대장 규칙](../../spec/STATUS.md)에 필요한 명세와 실행 근거가 있을 때만 갱신합니다.

## 단계별 병렬 작업 경계

- Cargo/Bun workspace, 공통 fixture 형식, 트리·이벤트 계약이 먼저 안정돼야 여러 작업자가 같은 공용 인터페이스를 동시에 바꾸지 않습니다.
- 이후 Android와 iOS 호스트는 같은 C ABI를 기준으로 분리해 병렬 진행할 수 있습니다.
- React 어댑터와 Vite/Rspack 통합은 Rust 레이아웃·표시 코드와 독립적으로 진행하되, 같은 TS 호스트 명령 계약을 사용합니다.
- 코어 revision/변경 규칙이나 C ABI 변경은 한 작업이 소유하고, 나머지 작업은 버전된 인터페이스에 맞춥니다.
- 스파이크 폴더의 비교 코드·캡처·원본 로그는 승격 과정에서 삭제하지 않습니다. 새 구현과의 차이를 검증하고 참조 링크를 갱신합니다.
