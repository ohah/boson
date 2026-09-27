# iOS 빌드 골격

`SpinonBootstrap.xcodeproj`는 앱 시작 때 Bun으로 만든 JavaScript를 V8에서 평가하고 Rust 콜백 및 역방향 JS 이벤트를 실행하는 개발용 부트스트랩입니다. 빈 UIKit 호스트 창과 로그는 제품 렌더러가 아니며 UIKit 위젯 기반 UI를 뜻하지 않습니다.

필요한 도구는 Xcode 26.2, iOS 18 SDK, 루트 `mise.toml`에 고정한 Rust·Bun입니다. Xcode의 빌드 스크립트가 Rust 정적 라이브러리와 V8 어댑터를 준비하고 번들을 앱 리소스에 복사합니다. V8 커밋과 시뮬레이터·기기별 GN 산출물은 [V8 빌드 안내](../../native/v8/VERSION.md)를 따릅니다.

루트에서 `mise exec -- bun run build:ios-sim`으로 Apple Silicon 시뮬레이터 앱을 빌드합니다. 실행 로그에서 `SPINON_BOOTSTRAP_RESULT=nodes=2 last_node=8 tag=text text=이벤트:7`을 확인합니다. 현재 빌드 골격은 iOS 시뮬레이터 링크를 목표로 하며, 실기기 실행·JIT 없는 정책 검증·GPU·입력·접근성은 포함하지 않습니다. 구현 완료 표시는 [공식 상태 대장](../../spec/STATUS.md)과 [내부 V8 실행 인터페이스](../../spec/internal/0001-v8-bootstrap.md) 기준을 따릅니다.

V8 링크에는 `BrowserEngineCore`가 포함됩니다. 이 부트스트랩의 시뮬레이터 빌드는 앱 배포 자격이나 App Store 정책 적합성을 확인하지 않으며, 해당 정책 검토는 [구현 상태 대장](../../spec/STATUS.md)의 R09에서 별도로 진행합니다.
