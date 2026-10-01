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

실행 파일·환경·fixture·CSS 프로필의 해시와 Chromium 관찰 결과는 [고정 JSON 스냅샷](../../../tests/fixtures/css/references/chromium-macos-arm64-154.0.8037.92-ua-v0/ua-supported-elements.json)에 저장한다. 원본 입력은 [HTML fixture](../../../tests/fixtures/css/c01/supported-html-ua.html)다.

## 비교 입력과 판정

fixture는 HTML namespace의 `div`, `span`, `a`, `img`, `button`, `input`, `p`, `ul`, `li`를 각각 한 개씩 만든다. author stylesheet가 없는 상태에서 Chromium의 selector별 일치 노드와 내장 CSS 프로필이 선언한 computed value를 관찰한다. 그 다음 내장 CSS 파일을 테스트 페이지의 author stylesheet로 추가하고 같은 관찰값을 다시 읽는다.

selector 일치 집합 9개와 명시된 CSS 선언 19개, 총 28개 항목을 정확한 문자열·노드 ID 일치로 판정한다. 차이가 하나라도 있으면 수집기는 기준 파일을 쓰지 않고 실패한다. 측정 결과는 28개 모두 일치했다.

이 방법은 내장 규칙이 해당 Chromium에서 같은 selector와 computed value를 만드는지 보는 초기 oracle 대조다. CSS를 author origin으로 추가했으므로 UA cascade origin 자체를 검증한 것이 아니며, Rust FFI 자원 포인터를 읽거나 Stylo 연결을 검증한 것도 아니다.

## 범위와 남은 일

이 기록은 9개 HTML 요소의 구조 기본값에 한정한다. SVG 범위, 전체 CSS feature inventory, cascade 우선순위·상속·동적 변경, 레이아웃 좌표·텍스트 metrics, GPU 캡처, Android·iOS 결과는 측정하지 않았다. 이 한계 때문에 `C01`은 상태 대장에서 미완료로 유지한다. 전체 목표와 뒤이은 비교 층은 [CSS 호환 명세](../../0008-css-compatibility.md)와 [CSS 구현 계획](../../../docs/plans/css-rendering.md)을 따른다.
