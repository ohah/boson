# C01 부분 CSS inventory · Chromium 비교 근거

**상태:** C01.1 부분 작업 근거 · **C01 전체 완료:** 아니요 · **측정일:** 2026-10-02

## 비교 입력

- 부분 inventory: [`inventory.v1.json`](../../../tests/fixtures/css/c01/inventory.v1.json)
- schema / inventory ID: `spinon-css-feature-inventory/v1` / `C01-UAv0-supported-html-elements`
- inventory SHA-256: `1293be438ca54d184c0f614d49fb0549bded5484806e73467a73898e6dc4fc6c`
- 캡처기 SHA-256: `tools/css-reference/capture.mjs` · `879f9f19a429657f4c09fef03a55faaa609973a2c0660ae0eadf0d946b12b0af`
- inventory validator SHA-256: `tools/css-reference/inventory.mjs` · `19fe7982efc211fc55596fb6fefcf8eb319dcf98410a8249b9e07da268831c84`
- 현재 범위: HTML 요소 selector 9개, computed CSS feature 19개
- 미포함: 전체 HTML·SVG inventory, CSSWG/WPT 기준 및 feature 값 조합, cascade·레이아웃·텍스트·페인트 기준, Android·iOS 행렬

캡처기는 inventory를 검증하고 CDP의 `Page.addScriptToEvaluateOnNewDocument`로 fixture가 실행되기 전에 주입한다. fixture 결과의 inventory ID·schema·selector·feature ID를 읽고 원본 JSON과 비교한다. Chromium이 관찰한 node ID는 각 selector에 선언된 기대 ID와 비교한다. 캡처 결과는 inventory SHA-256과 `completeness: partial`을 보존한다.

## 실행과 결과

실행 명령: `mise exec -- node tools/css-reference/capture.mjs`

- Chromium: Google Chrome `154.0.8037.93`, revision `@f89f3a4363808e117c592adedcf9947882ac3b79`
- 실행 파일 SHA-256: `b4a14b08946ab78756169696fd272d6c3040a22df52da4f83f665225685f4c10`
- 호스트: macOS `26.5.1` (`25F80`), `arm64`
- Node.js: `24.20.0`
- 고정 환경: viewport `800×600` CSS px, scale `1`, `en-US`, `UTC`, light/no-preference/forced-colors none
- 결과: [Chromium JSON snapshot](../../../tests/fixtures/css/references/chromium-macos-arm64-154.0.8037.93-ua-profile-override-v4-inventory-1293be438ca5/ua-supported-elements.json)
- 판정: 요소 9개와 computed CSS 값 19개 일치, 비교 실패 0개

기존 Chrome `154.0.8037.92` 스냅샷은 보존했다. 이전·신규 스냅샷의 Chromium 요소 관찰, selector·기대 ID·node ID, baseline, 프로필 결과와 computed feature 비교를 기계적으로 비교해 동일함을 확인했다. 신규 결과에는 HTML 태그·namespace 일치 검증도 9/9로 기록된다. 새 브라우저 버전은 새 reference-id를 사용한다.

inventory validator의 단위 테스트 3개가 통과했다. 테스트는 현재 9개 요소·19개 feature 수, 중복 node/feature ID 거부, 전체 inventory로 잘못 표기한 입력 거부를 확인한다.

## 제한

이 결과는 C01 초기 seed를 데이터로 분리하고 현재 Chromium fixture 입력을 고정한 부분 작업이다. CSS 전체 inventory를 확정하지 않았고, author-origin 비교는 UA cascade origin 동작을 증명하지 않는다. Stylo, FFI, 레이아웃, 글꼴, GPU, Android·iOS 동등성도 검증하지 않았으므로 C01 전체와 제품 CSS 지원은 미완료다.
