# C04.2 computed-style → Taffy adapter 검증 근거

**날짜:** 2026-10-03  
**상태:** 내부 고정 fixture 검증 완료  
**제품 지원:** 미완료 · 앱 runtime 연결 아님

## 목적

[내부 계약 0017](../0017-c04-style-layout-bridge.md)의 제한된 `spinon-style` computed-style profile을 별도 `spinon-style-to-layout` crate에서 `spinon-layout` 입력으로 변환하고, Taffy 결과를 고정 Chromium reference와 비교한다. 이 검증은 하나의 분수 Flex fixture만 대상으로 하며 C04 전체, 일반 Flexbox 또는 CSS 지원을 판정하지 않는다.

## 고정 비교 자료

- Chromium `154.0.8037.95`, revision `@05d469856e75794131cc2e5d9b2f6b6f10a70388`, macOS `26.5.1`, arm64. 원본: [C01.2 비교 기록](css-c01-layout-2026-10-02.md) 및 [Chromium geometry JSON](../../../tests/fixtures/css/references/chromium-macos-arm64-macos-26.5.1-25f80-154.0.8037.95-layout-v1-778a2065ac58-inventory-ef6d0b87a506-capture-85a34bd9a1a2-bin-affc6715a14a/core-layout.json).
- 선택 case: `flex-fractional-growth`; viewport `301×40` CSS px, 세 자식의 `flex-grow` `1/2/3`, `flex-basis: 0`, `column-gap: 5px`.
- 비교 전 부모의 Chromium absolute origin `(20, 180)`을 빼서 fixture root `(0, 0)` 기준 상대 좌표로 정규화한다.
- Chromium computed property 문자열은 fixture에 기록된 값마다 정확히 비교한다. 각 node의 `x`, `y`, `width`, `height`는 각 좌표별 최대 절대 오차 `0.5 CSS px`를 허용하고 평균 오차로 실패를 상쇄하지 않는다.
- [입력 CSS](../../../tests/fixtures/css/c04/style-layout-bridge.css) SHA-256: `b1f65c7f961c3cd39a7841d921993c204408d86caf33c0b78c1970ab64b6ad2f`.
- [fixture JSON](../../../tests/fixtures/css/c04/style-layout-bridge.v1.json) SHA-256: `50d71915ad4f0717907df4807c881c6f148f5a639f30faa9714ef7473c22afe8`.
- Chromium geometry JSON SHA-256: `366cd9c12b514bd78dbe7f7d2b2ab0b9fe376d2b16b873a18c0c695d3fac8d36`.

## 관찰 결과

`cargo test --locked --workspace`에서 86개 Rust 단위 테스트가 통과했다. 신규 adapter 7개 테스트는 다음을 확인했다.

- 고정 fixture의 computed property와 Taffy frame이 Chromium oracle에 각각 정한 오차 안으로 들어온다. 자식 너비는 `48.5`, `97`, `145.5` CSS px이고 x 좌표는 `0`, `53.5`, `155.5` CSS px이다.
- 출력은 입력과 동일한 `DocumentGeneration`, `DocumentRevision`, `RenderTreeRevision`을 보존한다.
- 다른 generation과 stale document revision은 cascade/layout 전에 거부된다.
- stylesheet cascade 진단(`display: grid` fixture), profile 밖 percentage `flex-basis`, `row-reverse`, 선택 subtree의 text node는 부분 성공으로 진행하지 않고 실패한다.
- 유효하지만 미지원인 `padding` 선언과 HTML inline `style` 속성도 Stylo가 파싱한 입력 단계에서 거부한다. 따라서 미투영 CSS 값을 Taffy 기본값으로 조용히 바꾸지 않는다.
- Taffy 입력 계층에서 별도로 `display`, `box-sizing`, `flex-shrink`가 전달되는 회귀 테스트가 통과한다. 이는 해당 속성의 Chromium CSS 적합성 시험은 아니다.

## 실행 환경과 확인 명령

macOS `26.5.1` (`25F80`), arm64, Rust `1.96.1`, Bun `1.4.2`, Stylo `0.22.0`, Taffy `0.14.0`에서 실행했다.

| 확인 | 결과 |
| --- | --- |
| `mise exec -- bun run test` | Bun 예제 1/1, CSS reference Node 검사 3/3, Rust workspace 86/86 통과 |
| `mise exec -- cargo clippy --locked --workspace --all-targets -- -D warnings` | 통과, 경고 없음 |
| `mise exec -- cargo fmt --all -- --check` | 통과 |
| `mise exec -- cargo check --locked -p spinon-style-to-layout --target aarch64-apple-ios-sim` | 통과 |
| `mise exec -- cargo check --locked -p spinon-style-to-layout --target aarch64-apple-ios` | 통과 |
| `mise exec -- cargo check --locked -p spinon-style-to-layout --target aarch64-linux-android` | 통과 |
| `git diff --check` | 통과 |

플랫폼 target 검사는 Rust crate 교차 컴파일만 확인했다. iOS Simulator 앱 실행, Android 앱 빌드·에뮬레이터 또는 실기기 화면 검증은 하지 않았다.

## 경계와 미완료 항목

이 작업은 내부 Rust workspace adapter만 추가한다. V8/JavaScript 호출, 제품 stylesheet loading, dynamic style invalidation, CSSOM, text shaping/measurement, 일반 Block/Grid/전체 Flexbox, GPU 장면 또는 화면 출력을 연결하지 않는다. 사용자에게 공개되는 HTML/CSS 지원이나 Android·iOS runtime 동작으로 표시하면 안 된다. 나머지 기능은 [상태 대장](../../STATUS.md)의 C04·C05 이후 항목에서 별도로 구현하고 비교한다.
