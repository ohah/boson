# C03 · HostDocument와 Stylo DOM 연결

**상태:** 내부 구현 계약 초안 `0.1.0-draft` · **기준:** Stylo `0.22.0`, `selectors 0.41.0` · **제품 CSS 지원:** 미완료

## 목적과 경계

`spinon-core::HostDocumentSnapshot`을 Stylo의 `style::dom::{TDocument, TNode, TElement}`와 `selectors::Element` 인터페이스에서 읽을 수 있게 연결한다. 입력 snapshot은 불변이며 이 어댑터는 스타일 계산 중 원본 HostDocument를 수정하지 않는다. Stylo cascade·계산 스타일, 스타일시트 수명과 무효화 정책, 레이아웃 변환이나 GPU 반영은 C03 범위가 아니다.

Blitz DOM은 런타임 의존성으로 사용하지 않는다. 의존성은 `stylo = 0.22.0`, 같은 Stylo 릴리스의 `stylo_dom`, 그리고 Stylo가 사용하는 `selectors = 0.41.0`으로 고정한다. 이 버전 조합은 동일한 trait 타입을 공유하도록 고정하며, 변경 시 공개 호환성과 플랫폼 컴파일을 다시 판정한다.

## 생성 계약

내부 `StyloDocumentView`는 다음 입력을 받는다.

| 입력 | 계약 |
| --- | --- |
| `HostDocumentSnapshot` | 읽기 전용 snapshot. 이후 HostDocument 변경은 현재 view에 자동 반영되지 않으며 새 snapshot과 view를 만들어야 한다. |
| `root_element` | HostRoot의 직접 자식인 연결된 Element 핸들. 앱의 어떤 요소를 스타일 문서 루트로 사용할지 호출자가 명시한다. 어댑터가 첫 자식이나 임의의 `<div>`를 고르지 않는다. |
| `is_html_document` | 로컬 이름의 HTML 문서 규칙과 HTML namespace 판정에 사용할 명시적 모드. |
| `quirks_mode` | selector 매칭에 넘길 Stylo quirks mode. 초기 테스트는 `NoQuirks`를 사용한다. |

HTML 문서의 XHTML 요소에 no-namespace 속성 이름이 ASCII 대소문자만 달리해 둘 이상 존재하면 `AmbiguousHtmlAttributeNames` 오류로 view 생성을 거부한다. HostDocument는 HTML 속성 정규화를 책임지지 않으므로 이 검사는 잘못된 입력을 임의의 속성 값으로 숨기지 않기 위한 경계다.

루트 핸들이 다른 generation이거나, 없거나, Element가 아니거나, HostRoot의 직접 자식이 아니면 view 생성을 오류로 거부한다. 가상 Stylo 문서 노드에는 명시한 루트 요소 하나만 자식으로 보인다. HostRoot와 공개 DOM의 `documentElement`가 같다고 선언하지 않는다.

Stylo view는 명시한 루트와 그 하위 트리의 연결 노드만 노출한다. 분리 노드와 다른 HostRoot 자식은 이 view의 selector tree에 포함하지 않는다. JS DOM에서 분리 노드의 `ownerDocument`, 조회 또는 수명 의미를 정하는 계약이 아니다.

## 노드·속성 매핑

| HostDocument | Stylo view |
| --- | --- |
| 선택한 `root_element` | 가상 Document node의 유일한 Element child |
| 요소 노드 | Stylo Element wrapper; local name, namespace, 속성, 상태는 snapshot 값에서 읽음 |
| 텍스트 노드 | selector tree 순서에 보존되는 비요소 Node; 요소 형제 조회에서는 건너뜀 |
| 부모·자식·형제 | snapshot의 연결 트리 순서를 사용. 선택 루트 위와 선택 루트 밖의 형제는 노출하지 않음 |
| HTML namespace | `http://www.w3.org/1999/xhtml`와 호출자가 준 `is_html_document`를 함께 판정 |
| 일반 속성 | namespace·local name별 조회; selectors의 `AttrSelectorOperation`을 적용. HTML 문서의 XHTML 요소에서는 no-namespace 속성 이름을 ASCII 대소문자 무시로 비교 |
| `id`, `class` | no-namespace 속성에서 읽음. HTML 문서의 XHTML 요소에서 속성 이름은 ASCII 대소문자를 무시하고, 값은 유지한다. class token 구분은 CSS ASCII whitespace(`U+0020`, `U+0009`, `U+000A`, `U+000C`, `U+000D`)를 사용 |
| hover, active, focus, focus-visible, disabled, checked | HostElement의 동명 상태를 Stylo `ElementState`로 전달 |

선택자 fixture에서 확인하는 non-tree pseudo-class는 `:active`, `:checked`, `:disabled`, `:focus`, `:focus-visible`, `:focus-within`, `:hover`, `:link`, `:any-link`, `:lang()`이다. `:lang()`은 선택 요소에서 가장 가까운 `xml:lang` 또는 `lang`을 확인한다. ID와 class 값 비교는 selectors가 받은 문서 quirks mode 규칙을 사용한다. HTML 모드와 XHTML namespace 조건이 맞지 않는 요소에는 HTML 이름 대소문자 규칙을 적용하지 않는다.

Stylo 0.22 selector `AttrValue` 경계는 UTF-8 문자열을 요구한다. `DomString`의 잘못된 UTF-16 surrogate는 selector 속성 조회에서 U+FFFD로 치환되며, 이 손실은 공개 DOM 문자열 호환성 완료를 뜻하지 않는다. C03은 해당 경계가 가려지지 않도록 명세하고 회귀 사례를 보존한다.

Opaque node/element 표식은 view가 살아 있는 동안에만 비교 키로 유효하다. 숫자 핸들 또는 Opaque 표식을 view 사이에서 재사용하거나 수명 종료 후 보관하지 않는다.

## 선택자 동작 범위

초기 fixture는 실제 Stylo 0.22 selector parser와 matcher를 사용해 요소·속성·조상/형제·구조 상태 매핑을 확인한다. 직접 비교 기준은 입력 `HostDocumentSnapshot`과 이 문서의 예상 트리·속성·상태이며 Chromium CSS cascade/계산값 비교는 C01·C04에서 수행한다.

Stylo node/element data, selector flag, 자식 처리 카운터는 view 내부의 별도 계산 상태로 둔다. 새 HostDocument snapshot으로 만든 view에는 이전 계산 상태를 복사하지 않는다. 스타일 attribute나 animation data는 C03에서 제공하지 않는다.

어댑터는 다음 기능을 지원하지 않는다.

- CSS stylesheet 등록, selector cascade, computed style, layout 또는 GPU frame 생성
- Shadow DOM, slots, pseudo-element 생성/매칭, custom states, `part`/`exportparts`
- snapshot 간 selector invalidation; selector flag는 현재 view 내부에서만 기록되며 새 snapshot 간 재사용하지 않음
- `Element.style`, `style` attribute declaration parsing, CSSOM과 presentational hints
- malformed UTF-16의 무손실 UTF-8 변환

미지원 pseudo-class와 pseudo-element는 일치하지 않는 것으로 처리한다. 지원하지 않는 특성을 Stylo의 기본값이나 browser 호환 동작으로 포장하지 않는다.

## 고정 적합성 fixture

테스트는 하나의 원자 batch로 다음 트리를 만든다.

```text
HostRoot
└── <main ID="app-root" CLASS="shell page" lang="ko">
    ├── Text("제목")
    ├── <span class="label" data-role="title">Text("오늘")</span>
    ├── <button class="primary action" data-role="action" disabled>
    ├── <i></i>
    ├── <input type="checkbox" checked>
    ├── <a href="/docs">문서</a>
    └── <em>Text("")</em>
```

fixture의 대문자 `ID`, `CLASS`, `DATA-ROLE`은 HTML 문서 selector의 속성 이름 case-insensitive 동작을 확인하려는 원시 HostDocument 입력이다. DOM façade가 생성하는 공개 DOM은 같은 이름의 대소문자 별칭을 허용하지 않는다.

| 검사 | 기대 결과 |
| --- | --- |
| 가상 Document child 조회 | `main` 하나만 첫/마지막 자식이며, `main`의 parent node는 Document |
| mixed node traversal | `main`의 자식 순서는 Text, `span`, `button`, 빈 `i`, `input`, `a`, `em`; element sibling 조회는 Text를 건너뜀 |
| namespace/name | HTML 모드에서 XHTML `main`은 HTML element, 같은 로컬 이름의 다른 namespace는 HTML element가 아님 |
| 속성·class·id | 실제 Stylo selector parser·matcher에서 `#app-root`, `.shell`, `.page`, `[data-role="action"]`, `[disabled]` 조건을 확인. HTML 속성 이름의 ASCII 대소문자 차이도 포함 |
| 상태 | 실제 matcher에서 hover/focus/focus-visible/checked/disabled 상태 선택자를 확인하고, `:focus-within`은 focused descendant를 포함 |
| 구조 | 선택한 루트만 `:root`; 빈 `i`와 빈 텍스트만 포함한 `em`의 `:empty`, 조상·형제 결합자를 실제 matcher로 확인 |
| 격리 | 분리 노드·다른 HostRoot 직접 자식·다른 generation 핸들은 view tree에 들어오지 않음 |
| 갱신 경계 | 원본 snapshot의 다음 revision은 기존 view를 바꾸지 않고 새 view에서만 관찰됨 |
| 오류 | 잘못된 root handle, 다른 generation, 대소문자 별칭 속성은 view 생성 시 구체적인 오류로 반환 |

테스트는 `cargo test -p spinon-style`에서 실행한다. Rust 코어 snapshot API의 Android ARM64, iOS ARM64, iOS simulator ARM64 컴파일도 C03 대상별 빌드 관문이다. 테스트 통과만으로 계산 스타일·CSS 기능 또는 앱 화면을 지원한다고 판정하지 않는다.

## 실행 결과 기록

실제 구현 결과, 플랫폼별 명령, 실패와 미완료 범위는 [C03 어댑터 실행 근거](evidence/css-c03-stylo-dom-adapter-2026-10-01.md)에 기록한다. C03 상태는 selector-only adapter와 선언된 플랫폼 관문을 모두 통과한 뒤에만 갱신한다.
