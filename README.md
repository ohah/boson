# Spinon

Spinon은 웹과 유사한 개발 경험으로 모바일 앱을 만드는 멀티플랫폼 UI 프레임워크 실험입니다. 공통 UI 코어는 Rust, 모바일 주 화면은 GPU 렌더러로 구현하기로 결정했습니다. 공개 API와 GPU 구현 기술은 아직 확정되지 않았습니다.

공개 동작의 첫 규범 문서: [스피논 명세 0.1 초안](spec/README.md). 현재 명세는 구현 완료 또는 스토어 배포 가능성을 뜻하지 않습니다.

공식 진행 상태: [78개 구현 항목 체크리스트](spec/STATUS.md) · [지원 완료 API 명세](spec/api/README.md). 완료 항목에는 API/인터페이스 명세와 동작 근거가 필요합니다.

웹 문서: [스피논 API 문서](https://ohah.github.io/spinon/). `spec/` Markdown을 Rspress로 정적 생성하며, 명세·구현 상태와 API 목록을 웹에서 검색할 수 있습니다. 작업 중 미리보기는 [Tailscale 문서 페이지](https://macstudio.tailed42f2.ts.net/spinon/docs/)입니다.

문서 생성기의 `@rspress/core`는 `2.0.22`에 고정합니다. 스피논의 첫 공식 릴리스 전에는 RSPress를 업데이트하지 않습니다.

```sh
mise install
mise exec -- bun install --frozen-lockfile
mise exec -- bun run docs:dev
mise exec -- bun run docs:build
mise exec -- bun run test
mise exec -- bun run verify:r06-priority:simulators
```

## 네이티브 빌드 부트스트랩

Android 앱과 iOS 시뮬레이터 앱은 고정된 V8 소스, Rust FFI, Bun으로 만든 JavaScript를 함께 묶어 시작 smoke를 실행합니다. 먼저 `mise install`과 Android SDK·Xcode 설치를 마친 뒤 [V8 소스와 플랫폼별 빌드 준비](native/v8/VERSION.md)를 따릅니다. 자세한 SDK 패키지와 로그 확인법은 [Android](platforms/android/README.md), [iOS](platforms/ios/README.md), [내부 V8 인터페이스](spec/internal/0001-v8-bootstrap.md)를 참고하세요.

```sh
mise exec -- bun run build:android
mise exec -- bun run build:ios-sim
```

이 부트스트랩은 앱 빌드 연결을 검증합니다. GPU 렌더링, 제품 UI, OTA, 공개 API 지원 완료를 의미하지 않습니다.

현재 Android 실기기와 iOS 시뮬레이터에서 확인한 부팅 결과 및 검증 범위는 [네이티브 부트스트랩 기록](docs/evidence/native-bootstrap-2026-09-28.md)에 있습니다.

### 실제 V8 우선순위 시뮬레이터 검증

실행 중인 Android 에뮬레이터 하나와 iOS 시뮬레이터 하나를 선택해 실제 V8 우선순위·등급별 FIFO 진단을 빌드부터 실행까지 반복합니다. Android 대상은 `emulator-*` serial만 허용하며, 실기기는 선택되지 않습니다. 여러 시뮬레이터가 켜져 있다면 `SPINON_ANDROID_EMULATOR_SERIAL`과 `SPINON_IOS_SIMULATOR_UDID`로 대상을 지정합니다. 로그와 화면 캡처는 Git에 포함되지 않는 `build/spinon/priority-validation/<UTC 시각>/`에 저장합니다.

```sh
mise exec -- bun run verify:r06-priority:simulators
```

여러 대상이 부팅되어 있으면 serial과 UDID를 고정해 실행할 수 있습니다.

```sh
SPINON_ANDROID_EMULATOR_SERIAL=emulator-5554 \
SPINON_IOS_SIMULATOR_UDID=ACA7BF91-E2D5-4CF7-909A-08D1AD95FF3D \
  mise exec -- bun run verify:r06-priority:simulators
```

테스트 목적·단일 배치의 범위와 남은 한계는 [R06 우선순위 검증 기록](spec/internal/evidence/r06-priority-simulators-2026-09-30.md)에 있습니다.

정식 사이트는 GitHub Pages에 배포합니다. `main`에 문서 변경이 반영되면 GitHub Actions가 새 HTML을 생성해 게시합니다. `packages/docs/rspress.config.ts`의 기본 경로는 `/spinon/`입니다.

화면 이동과 딥링크의 공통 의미: [라우팅 명세](spec/0006-routing.md)

구현 경계와 순서: [Rust 코어 아키텍처 결정](docs/architecture.md)

변경된 청크·에셋만 전송하는 기능별 OTA 목표: [청크 기반 OTA 설계](docs/ota-design.md)

프로젝트 명령과 에이전트용 진단 인터페이스: [CLI·MCP 설계](docs/cli-mcp.md)

앱 코드의 태그·속성·이벤트 기준: [작성 문법 초안](docs/authoring-contract.md)

웹 태그·CSS와 JavaScript API 대응표: [HTML·CSS 명세](https://macstudio.tailed42f2.ts.net/spinon/compatibility.html), [JS API 명세](https://macstudio.tailed42f2.ts.net/spinon/js-api.html)

첫 번째 언어 선택 실험: [V8 연동 비교](spikes/v8-language-bridge/README.md)

CSS 빌드 변환과 Taffy 레이아웃의 최소 연결: [스타일·레이아웃 실험](spikes/style-layout/README.md)
