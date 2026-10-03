# 0016 · C04 기본 stylesheet cascade

**상태:** 내부 구현 계약 · **버전:** `0.1.0-draft` · **Stylo:** `0.22.0` · **C04.1 fixture slice:** 구현·Chromium 비교 완료 · **제품 CSS 지원:** 미완료

## 목적과 범위

기존 [0012 stylesheet 입력 목록](0012-stylesheet-registry-c04.md)과 C03 `StyloDocumentView`를 Stylo `Stylist`에 연결해 고정 문서 revision의 기본 computed-style 값을 만든다. 이 계약은 `spinon-style` 내부 계층이며 공개 DOM/CSSOM API, 전체 CSS 지원 선언이 아니다.

입력은 문서 URL·HTML 모드·quirks mode·불변 HostDocument snapshot, 컴파일 시 포함한 UA stylesheet, 순서가 고정된 author stylesheet 목록, screen viewport다. `StyloDocumentView::new_with_base_url`이 절대 document URL을 검증하고, HTML namespace 요소의 no-namespace `style` 속성은 HTML 이름 규칙에 따라 찾아 author inline declaration으로 파싱한다. UA 및 author stylesheet와 inline declaration은 같은 문서 `SharedRwLock`을 사용한다. `StylesheetRegistry`가 CSS 파싱·origin·base URL·source order를 보존하고, Stylo가 선택자 매칭·specificity·중요도·origin/source order·상속·CSS-wide keyword와 computed value를 결정한다.

하위 비교 모델은 [`C04 기본 cascade 픽스처`](../../tests/fixtures/css/c04/README.md)와 [고정 Chromium capture](../../tests/fixtures/css/references/chromium-darwin-arm64-25.5.0-macos-26.5.1-154.0.8037.95-c04-cascade-v1-cb1e77476585-29b38ffc9b17-0e231fc4dc01-0cf4a1587190-affc6715a14a/computed-styles.json)를 사용한다. 대상 환경은 Chrome `154.0.8037.95`, Chromium revision `@05d469856e75794131cc2e5d9b2f6b6f10a70388`, macOS `26.5.1` (`25F80`, arm64), `800×600` CSS px, device scale factor `1`, `screen`, `light`, `en-US`, `UTC`다. 입력 HTML/CSS·캡처 스크립트·실행 파일의 SHA-256과 운영체제 버전·관찰 결과를 reference에 기록하고, 렌더러 네트워크를 오프라인으로 둬 외부 자원 결과가 섞이지 않게 한다. reference ID에는 OS 환경·캡처 도구·실행 파일 SHA-256 접두부를 포함하며 기존 결과를 덮어쓰지 않는다.

## 내부 Rust 연결

- `StyloDocumentView::new_with_base_url(snapshot, root, is_html_document, quirks_mode, document_url)`는 절대 URL이 아니면 `InvalidDocumentBaseUrl`로 view 생성을 거부한다. 기존 `new`는 C03 호출 호환을 위해 `https://spinon.invalid/document.html` 기준 URL을 사용한다.
- `compute_basic_cascade(view, author_stylesheets, viewport)`는 fixture 전용의 제한된 계산 entrypoint다. 입력 author stylesheet의 origin이 `Author`가 아니거나 viewport의 폭·높이·배율이 유한한 양수가 아니면 계산하지 않는다.
- 이 계산은 view의 shared lock으로 `StylesheetRegistry`를 만들어 `Origin::UserAgent`의 내장 UA stylesheet를 먼저 넣고 author sheets를 전달 순서대로 추가한다. HTML inline declaration도 view를 만들 때 같은 lock으로 파싱되어 Stylo `TElement::style_attribute()`에서 제공된다.
- 모든 대상 요소를 root-first preorder로 계산하며 부모 `ComputedValues`를 다음 요소에 전달한다. 반환 snapshot에는 입력 `DocumentRevision`·`RenderTreeRevision`, 호출자가 전달한 `StyleRevision`, viewport의 `EnvironmentRevision`, 고정 whitelist의 computed serialization, stylesheet ID 또는 HostNode ID를 포함한 parse 진단을 보존한다. C04.1 고정 fixture entrypoint는 동적 style 입력 관리자가 없어 `StyleRevision(0)`을 사용한다. revision 소유와 갱신 규칙은 [0009](0009-layout-engine.md)를 따른다.
- 내부 함수는 아직 `pub(crate)`이고 layout·FFI·JS API 소비자가 연결되지 않았다. 이 함수와 결과 자료형은 사용자 DOM API나 구현 완료 범위가 아니다.

## Stylo cascade 입력 순서

1. 새 계산은 전달된 하나의 `StyloDocumentView`와 동일한 `DocumentRevision`·`RenderTreeRevision`에 고정한다.
2. UA stylesheet를 `Origin::UserAgent`로 먼저 추가한다. 애플리케이션 stylesheet는 `Origin::Author`로 전달 순서대로 추가한다. source order는 같은 origin 안에서만 cascade에 영향을 주며, 전체 등록 번호가 origin 우선순위를 대체하지 않는다.
3. 각 stylesheet는 자기 absolute base URL과 동일한 문서 shared lock으로 파싱한다. 상대 URL 파싱은 base URL에 한정하며 네트워크 fetch는 없다. `@import`는 기존 0012 규칙대로 허용하지 않고 진단을 보존한다.
4. HTML 요소의 no-namespace `style` 속성은 해당 문서 URL을 base로 하는 author inline declaration으로 파싱한다. selector rule과 함께 Stylo cascade에 넣는다.
5. root에서 preorder로 각 요소의 규칙을 수집하고 부모 요소의 이미 계산된 style을 전달한다. 이 하위 범위의 검증 fixture에는 `display: contents`가 없다. layout-parent fixup과 pseudo-element 계산은 제공하지 않는다.
6. `CssComputedProperty`에서 명시한 속성만 CSS 직렬화 문자열로 snapshot에 노출한다. 이 snapshot은 DOM `getComputedStyle()`이나 CSSOM 반환 객체가 아니다.

## 비교 속성과 판정

고정 fixture는 16개 HTML 요소와 `display`, `color`, `font-size`, `font-weight`, `margin-top`을 관찰한다. Chromium `getComputedStyle()`과 Stylo `ComputedValues::computed_value_to_string()`의 80개 문자열을 요소 fixture ID·속성별로 정확 비교한다. 누락 요소·누락 속성·순서 차이·예상하지 못한 parse 진단은 실패다. fixture에서 의도한 잘못된 inline 선언 진단 하나는 해당 HostNode ID와 함께 확인한다. 평균 점수나 다른 속성의 통과로 필수 비교 실패를 상쇄하지 않는다.

비교 사례는 UA 기본 `div` display, author가 UA 규칙을 덮는 경우, type/class/ID specificity, 두 author stylesheet 사이 source order, normal 대 important, 대문자 HTML `STYLE` 속성의 inline normal·important, 잘못된 inline 선언을 무시하고 노드 진단에 연결하는 경우, 상속, `inherit`·`initial`·`unset`, 800 CSS px viewport media query, `font-weight`와 `margin-top` 지정값을 포함한다. CSS color는 양쪽 엔진의 computed serialization 문자열을 그대로 기록한다.

## 오류와 제한

- 문법 오류는 Stylo의 CSS 오류 복구를 따르되 원본 위치 진단을 stylesheet ID 또는 HostNode ID와 연결한다. 고정 fixture의 의도된 잘못된 inline 선언 하나는 cascade 우승자를 바꾸지 않고 해당 Node ID 진단으로 남는다.
- 잘못된 viewport, base URL, stylesheet ID는 계산을 시작하기 전에 오류로 반환하며 partial success를 만들지 않는다.
- 계산 결과는 현재 한 번의 전체 preorder cascade다. 캐시, incremental invalidation, concurrent traversal, 취소, style generation 관리 기능은 없다.
- 사용자 stylesheet 순서는 전달 순서와 같다. CSS cascade가 최종 승자를 계산하며 구현체가 자체 specificity 정렬을 하지 않는다.
- `@import`, 외부 네트워크 자원, cascade layer, `@scope`, CSS custom property/`var()`, animation/transition, pseudo-element 생성, `:visited` 이력 판단, DOM CSSOM 변경·`getComputedStyle()`, layout·paint·GPU, Android/iOS 적합성은 이 하위 계약에서 완료 처리하지 않는다. 이 selector adapter는 C03에 적힌 제한된 pseudo-class 집합만 상태와 매칭하고 미지원 pseudo-class는 일치하지 않는 것으로 처리한다. Stylo가 구문을 인식한다는 사실만으로 해당 기능을 제품 지원으로 표시하지 않는다.
- 고정 font metric provider는 oracle 계측용 결정적 입력이며 실제 플랫폼 font database나 shaping의 구현을 뜻하지 않는다. 실제 font loading·metrics는 C16에 남는다.

## 상태·공개 API

상위 [C04 stylesheet·selector·cascade](../STATUS.md#css-구현-체크리스트)는 전체로 미완료다. 현재 완료는 고정 fixture 내부 cascade 경로와 Chromium computed-style 비교뿐이다. 공개 app API는 없으며 제품 CSS 지원 완료로 판정하지 않는다.
