# C01 · Chromium HTML UA 스타일 초기 비교 기록

**상태:** 초기 비교 산출물 · **C01 전체 완료:** 아니요 · **측정일:** 2026-10-01

## 기준 환경

- 브라우저: Google Chrome `154.0.8037.92`
- Chromium revision: `@334b65d254ccc35df4fca82706d1753227b01039`
- 실행 파일 SHA-256: `a5087eafc7c5fc9107951b0d4b86b54a2cc46c275d0009476e9f61465f5f270e`
- 호스트: macOS `26.5.1` (`25F80`), `arm64`
- viewport: `800×600` CSS px, device scale factor `1`
- locale/time zone: `en-US` / `UTC`
- 미디어: `prefers-color-scheme: light`, `prefers-reduced-motion: no-preference`, `forced-colors: none`
- 실행기: Node.js 내장 WebSocket으로 Chromium DevTools Protocol 사용. 저장소에 브라우저 제어 패키지를 추가하지 않았다.

실행 파일·환경·fixture·비교 baseline·CSS 프로필·수집 도구의 해시와 Chromium 관찰 결과는 [검증 절차를 강화한 JSON 스냅샷](../../../tests/fixtures/css/references/chromium-macos-arm64-154.0.8037.92-ua-profile-override-v1/ua-supported-elements.json)에 저장한다. 이전 `ua-v0` 탐색 결과는 selector 조회 9건이 CSS 규칙 적용을 입증하지 못해 현재 기준 자료에서 철회했다. 원본 입력은 [HTML fixture](../../../tests/fixtures/css/c01/supported-html-ua.html)다.

## 비교 입력과 판정

fixture는 HTML namespace의 `div`, `span`, `a`, `img`, `button`, `input`, `p`, `ul`, `li`를 각각 한 개씩 만든다. author stylesheet가 없는 상태에서 Chromium의 selector별 노드 ID와 내장 CSS 프로필이 선언한 computed value를 관찰한다. 그 뒤 `display`, 목록 표식, 여백, padding을 기본값과 다르게 지정하는 author baseline을 넣고 프로필 CSS를 추가한다. 프로필 선언은 baseline보다 구체적인 type selector를 사용하므로 해당 값이 실제 적용되지 않으면 기준 computed value와 일치하지 않아야 한다. baseline·프로필 스타일시트 수와 baseline 해시도 JSON에 기록한다.

fixture selector 9개의 node ID와 CSS feature ID 19개는 고정 목록과 정확히 일치하는지 별도 확인한다. 적합성 비교 점수에는 CSS 선언 19개의 computed value만 포함한다. 수집기는 기준값과 baseline 값이 다르고, 프로필 계산값이 기준값과 같을 때만 통과 처리한다. 차이가 하나라도 있으면 기준 파일을 쓰지 않고 실패한다. 측정 결과는 19개 모두 일치했다. 2026-10-01 첫 수집의 미디어 상태와 기본 글꼴 크기도 예상값인지 확인했다.

이 방법은 내장 규칙이 해당 Chromium에서 fixture의 예상 요소를 선택하고 baseline보다 우선해 같은 computed value를 만드는지 확인하는 초기 oracle 대조다. CSS를 author origin으로 추가했으므로 UA cascade origin·UA 대 author 우선순위 자체를 검증한 것이 아니며, Rust FFI 자원 포인터나 Stylo 렌더 연결을 검증한 것은 아니다. FFI 정적 자원 조회는 별도 Rust 단위 테스트에서 바이트·프로필 ID·UTF-8·NUL 경계를 확인한다.

## 범위와 남은 일

이 기록은 9개 HTML 요소의 구조 기본값에 한정한다. SVG 범위, 전체 CSS feature inventory, cascade 우선순위·상속·동적 변경, 레이아웃 좌표·텍스트 metrics, GPU 캡처, Android·iOS 결과는 측정하지 않았다. 이 한계 때문에 `C01`은 상태 대장에서 미완료로 유지한다. 전체 목표와 뒤이은 비교 층은 [CSS 호환 명세](../../0008-css-compatibility.md)와 [CSS 구현 계획](../../../docs/plans/css-rendering.md)을 따른다.
