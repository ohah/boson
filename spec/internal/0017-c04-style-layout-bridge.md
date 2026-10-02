# 0017 · C04 계산 스타일에서 Taffy 입력으로 투영

**계약 버전:** `0.1.0` · **상태:** C04.2 내부 구현 완료 · **제품 API:** 없음 · **제품 CSS 지원:** 미완료

## 목적과 범위

`spinon-style`의 제한 computed-style snapshot을 `spinon-layout`의 입력으로 변환하는 Rust workspace adapter 계약이다. adapter는 CSS cascade를 재구현하지 않고, HostDocument node ID와 세대·revision을 보존한 채 고정 속성 집합을 Taffy layout subset으로 전달한다.

이 하위 작업은 C04.1 계산 cascade와 C01.2 Chromium `flex-fractional-growth` fixture를 연결하는 요소 전용 vertical slice다. `display:flex` 부모와 세 자식의 `flex-grow`, `flex-basis`, `column-gap`만 사용한다. 임의 앱·일반 Flexbox·Block formatting·text measurement·GPU·Android/iOS 실행 및 사용자 공개 API를 제공하지 않는다.

## 입력·revision 계약

입력은 같은 문서에서 얻은 `HostDocumentSnapshot`과 `StyloDocumentView`, HostRoot 직속 요소 handle, Author stylesheet 목록, CSS viewport다. view와 layout snapshot의 `DocumentGeneration`, `DocumentRevision`, `RenderTreeRevision`이 모두 같지 않으면 계산을 시작하지 않는다. 결과는 해당 세 값을 그대로 반환한다.

레이아웃 좌표 단위는 CSS px이다. `CssViewport.width_css_px`와 `height_css_px`를 Taffy viewport로 전달하며 device scale factor를 좌표에 곱하지 않는다. 선택한 subtree에 텍스트 노드가 있으면 `spinon-layout`의 `UnsupportedTextNode` 오류로 전체 요청을 거부한다.

## computed-style projection profile

| CSS property | 허용 값과 mapping |
| --- | --- |
| `display` | `flex`, `block`, `none`을 Taffy display 값으로 전달한다. 그 밖의 값은 실패한다. |
| `box-sizing` | `border-box`, `content-box`를 각각 동일한 layout 값으로 전달한다. |
| `width`, `height`, `flex-basis` | `auto` 또는 유한·비음수 CSS px 값만 허용한다. `%`, `calc()`, `min-content` 및 다른 단위는 실패한다. |
| `flex-direction` | `row`, `column`만 허용한다. |
| `flex-grow`, `flex-shrink` | 유한·비음수 수치만 허용한다. |
| `direction` | `ltr`, `rtl`만 허용한다. |
| `row-gap`, `column-gap` | `normal`은 0으로 매핑하고 유한·비음수 CSS px 값만 허용한다. |

profile은 고정 fixture 검증에만 사용한다. width/height 외에 margin·border·padding·position·overflow·wrap·alignment 및 intrinsic sizing을 일반 변환한다고 주장하지 않는다. 이 fixture에서 이 속성들은 layout 결과를 바꾸지 않도록 0 또는 초기값이다.

Stylo가 stylesheet 파싱·cascade 과정에서 하나라도 진단을 반환하면 adapter는 해당 결과를 layout에 사용하지 않고 실패한다. 진단을 무시해 Stylo의 대체 computed value를 성공 결과로 취급하지 않는다. 지원 subset 밖의 CSS는 부분 layout으로 진행하지 않고 전체 요청을 거부한다.

author stylesheet는 아래 computed property에 대응하는 선언만 사용할 수 있다. `flex` shorthand는 `flex-grow`·`flex-shrink`·`flex-basis`로 확장된 선언만 허용한다. Stylo가 파싱한 선언 목록에서 다른 property, 사용자 지정 property, at-rule 또는 중첩 규칙을 찾으면 cascade 전에 실패한다. HTML `style` 속성도 이 fixture profile에서는 거부한다. 따라서 padding·margin처럼 유효하지만 projection되지 않은 레이아웃 선언을 조용히 무시하지 않는다. 이 엄격한 입력 제한은 고정 fixture를 위한 것이며 일반 stylesheet 지원이 아니다.

## 성공 및 실패 조건

- 성공하면 고정 fixture의 4개 HostElement를 모두 보존하고 CSS computed profile, 입력 revision과 Taffy frame을 함께 반환한다.
- Chromium의 고정 C01.2 결과와 비교할 때 computed property 문자열은 property별 정확 일치, 각 node의 x/y/width/height는 CSS px 최대 절대 오차 `0.5` 이내여야 한다. node별 평균으로 실패를 상쇄하지 않는다.
- CSS computed 값이 profile 밖이거나 파싱할 수 없으면 node ID·property·원본 값을 포함한 오류로 전체 변환을 거부한다.
- author stylesheet의 미지원 선언·at-rule·중첩 규칙 또는 요소의 `style` 속성이 있으면 전체 변환을 거부한다. 예를 들어 `padding: 8px`은 Taffy 입력으로 조용히 버리지 않는다.
- 계산 snapshot의 generation 또는 revision이 다르면 layout을 실행하지 않는다.
- 텍스트 노드, 누락 style, 중복/누락 node frame은 부분 성공으로 숨기지 않는다.

## 비교 모델

기준은 [C01.2 고정 Chromium layout oracle](../evidence/css-c01-layout-2026-10-02.md)의 Chrome `154.0.8037.95`, Chromium revision `@05d469856e75794131cc2e5d9b2f6b6f10a70388`, macOS `26.5.1` arm64 결과다. 선택 case는 `flex-fractional-growth`이며 viewport `800×600`, 부모 `301×40`, `column-gap:5px`, 자식 `flex:1 1 0`, `2 1 0`, `3 1 0`이다. 비교 fixture는 부모 기준 상대 좌표로 정규화한다. 부모의 C01.2 절대 위치 `(20,180)`은 adapter의 root 좌표 원점 `(0,0)`과 비교하지 않는다.

| node | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| `flex-parent` | 0 | 0 | 301 | 40 |
| `flex-a` | 0 | 0 | 48.5 | 40 |
| `flex-b` | 53.5 | 0 | 97 | 40 |
| `flex-c` | 155.5 | 0 | 145.5 | 40 |

실행 전 fixture와 CSS source hash를 기록하고 property별 computed 기대값 및 위 geometry를 고정한다. 테스트 결과와 환경은 별도 실행 근거에 기록한다. 이 결과는 C01 전체, C04 전체, CSS 100% 호환 또는 모바일 성능을 뜻하지 않는다.

실행 기록은 [C04.2 검증 근거](evidence/css-c04-style-layout-bridge-2026-10-03.md)에 둔다.

## 구현 연결

`spinon-style`은 profile별 computed-style snapshot을 만든다. `spinon-style-layout`은 snapshot을 검증·변환하고 `spinon-layout`의 `LayoutInput::from_host_document` 및 `TaffyLayoutEngine`을 호출한다. 세 crate는 서로의 내부 Stylo·Taffy 타입을 경계 밖에 노출하지 않는다. 이 adapter는 Rust workspace 내부 API이며 JavaScript/CSSOM API가 아니다.
