# 0007 · 모바일 DOM 호환 계층

**상태:** 제안 · **명세 버전:** `0.1.0-draft`

## 목표와 경계

모바일 앱에서 일부 웹 DOM API와 같은 이름·호출 형태를 사용할 수 있도록, JavaScript 호환 계층을 Rust가 소유하는 스피논 UI 트리에 연결하는 것이 목표다. 이 문서는 후보 API와 선행 결정을 정리한다. 구현이나 웹 호환성 완료를 뜻하지 않는다.

웹 빌드는 실제 브라우저 DOM을 사용한다. Android·iOS의 모바일 DOM 호환 계층은 스피논 문서 트리의 API façade다. Blink·WebKit 전체, HTML 문서 파서, 브라우저 창 모델이나 Web API 전체를 앱에 넣는 계획은 아니다. 모바일의 주 화면은 계속 GPU로 그리며 DOM API를 제공한다고 해서 WebView가 주 렌더러가 되지 않는다.

동일한 이름을 쓰는 API는 이 명세에 적힌 시그니처와 관찰 동작만 호환 목표로 삼는다. `document`가 있다는 이유로 전체 브라우저 DOM, CSSOM, `window`, 웹 라이브러리 전반의 호환성을 주장하지 않는다.

DOM façade만으로 `react-dom`이나 브라우저 DOM을 직접 호출하는 React/Vue/Svelte 라이브러리가 동작한다고 보장하지 않는다. 스피논 프레임워크 어댑터와 실제로 필요한 라이브러리 API 조합을 각각 검증한다.

## 제안 구조

```text
앱 JavaScript
  ├─ React / Vue / Svelte 어댑터 ─┐
  └─ 제한된 DOM 호환 façade ──────┴─ 공통 호스트 작업
                                      ↓
                               V8 호스트 바인딩
                                      ↓ 제한된 FFI
                               Rust 문서·UI 트리
                                      ↓
                       스타일 계산 → 레이아웃 → GPU 장면
```

- Rust 문서 트리가 모바일 UI의 정본이다. DOM façade와 프레임워크 어댑터가 서로 다른 UI 트리를 따로 소유하지 않는다.
- DOM façade는 JavaScript의 `Document`·`Node`·`Element`·`Text` 모양을 제공하고 호스트 작업을 Rust에 전달한다. V8은 ECMAScript 실행만으로 이 객체나 브라우저 API를 자동 제공하지 않는다.
- 프레임워크 어댑터와 DOM façade는 같은 논리 트리에 변경을 반영한다. 단, 한 프레임워크가 관리하는 하위 트리를 직접 DOM 변경과 어떻게 공유할지는 미정이며, 구현 전에 소유권 규칙을 정해야 한다.
- DOM 호출의 논리 결과와 화면 출력 시점은 분리한다. 같은 JavaScript 실행 흐름에서 뒤따르는 트리 조회는 앞선 성공한 변경을 관찰해야 한다. GPU 그리기는 다음 프레임에 반영될 수 있으며 DOM 변경 성공이 픽셀 표시 완료를 뜻하지 않는다.
- 앱별 `document` 객체와 GPU 표면의 루트 연결 방법은 미정이다. 브라우저의 `document.body`를 그대로 가정할 수 없으므로, 앱 작성 코드가 표시 트리에 붙일 컨테이너를 어떻게 얻는지 API 범위 결정에 포함해야 한다.

## 첫 단계 API 후보

아래는 호환 계층의 작은 시작점으로 제안하는 후보이며 현재 지원 API가 아니다. 세부 타입·예외 이름·수명·적합성 사례를 정하기 전에는 공개 지원으로 표시하지 않는다.

| API 영역 | 첫 단계 후보 | 계약에 필요한 조건 |
| --- | --- | --- |
| 노드 생성 | `document.createElement()`, `document.createTextNode()` | 지원 태그·노드 종류, HTML 이름의 대소문자 처리, 잘못된 이름의 예외와 문서 소속 규칙 |
| 자식 변경 | `appendChild()`, `insertBefore()`, `removeChild()` | 기존 부모에서 이동, `insertBefore(node, null)`의 끝 삽입, 삽입한/제거한 노드 반환, 순환·잘못된 참조의 동기 `DOMException`, 실패 시 기존 트리 보존 |
| 트리 읽기 | `nodeType`, `nodeName`, `parentNode`, `firstChild`, `nextSibling`, `textContent`, `Text.data`/`nodeValue` | 요소와 텍스트가 섞인 순서, 노드 종류 상수·이름 대소문자, 분리된 노드의 수명, 변경 직후 읽기 |
| 기본 속성 | `getAttribute()`, `setAttribute()`, `removeAttribute()`, `id`, `className` | 속성 이름·값의 변환, 속성과 프로퍼티의 반영 관계 |

다음 항목은 첫 단계에 자동 포함하지 않는다. 각 항목은 별도 동작 계약과 적합성 시나리오가 필요하다.

| 항목 | 현재 제안 경계 |
| --- | --- |
| `childNodes`, `children`, `NodeList`, `HTMLCollection` | 라이브/정적 컬렉션, 인덱스와 반복 동작을 정하기 전까지 미정 |
| `classList` | 토큰 규칙, `toggle()` 인자·반환값을 정한 뒤 추가 검토 |
| `getElementById()`, `querySelector(All)` | 선택자 문법·검색 범위·결과 컬렉션을 별도로 정하기 전까지 미정 |
| `addEventListener()` 등 DOM 이벤트 | 전파·캡처·취소·기본 동작·포인터와 접근성 입력을 [이벤트 계약](0002-ui-tree-events.md)에서 정하기 전까지 미정 |
| `getBoundingClientRect()`, `getComputedStyle()` | 레이아웃 동기화, 캐시된 값, 읽기 비용과 값의 유효 시점을 정하기 전까지 미정 |
| `innerHTML`, `outerHTML`, `DOMParser` | HTML 문자열 파싱과 보안 계약이 없으므로 첫 단계에서 제외 제안 |
| `document.body`, `document.documentElement`, 전체 `window` | 브라우저 페이지 모델을 제공하지 않으므로 첫 단계에서 제외 제안 |
| Shadow DOM, Custom Elements, MutationObserver, Range/Selection, iframe | 별도 제품 범위가 정해지기 전까지 약속하지 않음 |

`fetch`, 타이머, `URL`, 스토리지, 네트워크, 서비스 워커, Canvas/WebGL/WebGPU는 DOM 트리 API가 아니다. 각 기능은 [웹 표면 명세](0003-web-surface.md)의 별도 호스트 API 계약으로 판정한다.

## Rust 트리와 DOM 모델의 차이

현재 S01의 `spinon-core`는 안정적 ID와 원자 변경 묶음을 검증하는 최소 실험이다. 현재 `Node`는 노드마다 태그와 선택적 텍스트를 보관하고 자식 목록에는 다른 노드 ID를 둔다. 따라서 요소의 자식 위치마다 텍스트 노드가 끼어드는 DOM의 순서, `Element`와 `Text`의 서로 다른 노드 종류, 노드 객체의 연결·분리 수명을 표현하지 못한다. 또한 S01의 전체 변경 묶음 커밋은 개별 DOM 메서드의 동기 성공·오류 결과를 정의하지 않는다.

DOM 호환 계층에 연결하기 전 Rust 모델은 최소한 문서·요소·텍스트 노드 종류와 순서가 보존되는 혼합 자식 목록을 표현해야 한다. 노드 ID의 문서 범위, 분리 노드의 존속, wrapper 객체 정체성, 속성 저장, 동기 읽기·쓰기, 오류 매핑도 정의해야 한다. S01의 내부 배치 API가 DOM 의미를 이미 구현했다고 간주하지 않는다.

## 구현 전 결정과 검증 관문

1. **루트 연결:** 앱별 `document`가 GPU 표면의 어느 루트를 가리키는지, 직접 DOM 작성 코드가 첫 표시 컨테이너를 어떻게 얻는지 정한다. 전체 브라우저 페이지 모델을 몰래 만들지 않는다.
2. **소유권 충돌:** React·Vue·Svelte가 관리하는 하위 트리에 앱 코드가 `appendChild()` 등으로 직접 쓰기할 수 있는지 정한다. 첫 제안은 서로 다른 렌더러가 같은 하위 트리를 동시에 쓰지 못하게 하는 것이다. 이를 택하면 제약과 진단을 API 문서에 공개한다.
3. **동기 의미와 스레드:** 성공한 트리 변경은 같은 JavaScript 실행 흐름의 후속 조회에서 보여야 한다. GPU 장면 반영은 프레임 경계에서 비동기로 처리할 수 있다. JS·Rust 트리의 소유 스레드와 변경 직렬화 방법을 정하고 OS 입력 스레드를 불필요하게 기다리게 하지 않는다. 레이아웃 측정 API는 별도 동기화 계약 없이는 노출하지 않는다.
4. **객체 수명:** 삭제되거나 분리된 노드의 JavaScript wrapper가 언제까지 유효한지, 같은 Rust 노드 ID가 wrapper 정체성에 어떻게 대응하는지, GC·앱 재시작·OTA 뒤 ID가 재사용되는지 정한다.
5. **컬렉션·오류:** NodeList 계열의 라이브 여부, 잘못된 계층 변경의 예외 종류·이름, 잘못된 태그·속성 진단을 명세한다.
6. **프레임워크 경로:** 프레임워크 host adapter와 직접 DOM 호출의 변경이 한 문서 트리로 수렴하는 적합성 사례를 만든다.

이 관문이 닫히기 전에는 DOM 지원 API를 `지원`으로 등록하지 않는다. 첫 목표 범위와 구현 상태는 [범위·적합성 명세](0001-conformance.md) 및 [공식 상태 대장](STATUS.md)에서 따로 관리한다.

## 최소 적합성 시나리오 후보

- `<div>` 아래에 텍스트와 다른 요소를 번갈아 넣고, 웹과 모바일에서 자식 순서와 `textContent`를 비교한다.
- 부모가 있는 노드를 다른 부모로 옮기고, 같은 노드를 자기 자신 또는 자손 아래에 넣으려는 잘못된 변경을 비교한다.
- `appendChild()` 직후 `parentNode`, `firstChild`, `nextSibling`, `textContent`를 읽어 논리 트리가 동기화돼 있는지 확인한다.
- 잘못된 `removeChild()`에 다른 부모의 자식을 전달했을 때 웹과 모바일의 오류 종류·이전 트리 보존을 비교한다. 여러 앱 문서나 크로스 문서 노드를 지원한다면 채택 동작도 별도 사례로 추가한다.
- 프레임워크 어댑터로 만든 노드와 DOM façade로 만든 노드가 같은 트리에서 충돌 없이 조회·표시되는지 확인한다.

이 시나리오의 예상 결과와 웹·Android·iOS 원본 실행 근거가 생긴 뒤에만 버전별 지원 표에 적합성 판정을 추가한다.

동작 기준은 [WHATWG DOM Standard](https://dom.spec.whatwg.org/)에서 선택한 API와 노드 트리 동작으로 삼는다. 이 참조는 표준 전체 구현을 목표로 한다는 뜻이 아니다.
