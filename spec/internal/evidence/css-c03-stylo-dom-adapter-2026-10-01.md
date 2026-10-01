# C03 HostDocument Stylo DOM adapter 실행 근거

**기준일:** 2026-10-01 · **작업 브랜치:** `feat/css-c03-stylo-adapter` · **구현 계약:** [0010 C03 adapter](../0010-stylo-dom-adapter-c03.md)

## 비교 기준과 판정

구현 전 `spinon-style`에는 HostDocument snapshot을 Stylo DOM trait으로 읽는 adapter가 없었다. 별도 브라우저 oracle이 없는 이 경계는 내부 계약 0010의 정확한 트리·속성·상태·generation 불변 조건을 기준으로 삼고, 선택자 동작은 Stylo가 제공하는 실제 parser와 matcher를 호출해 확인한다. 이 결과는 Chromium CSS cascade나 계산 스타일 비교가 아니다.

합격 조건은 가상 Document에 호출자가 고른 HostRoot 직속 요소 하나만 보이고, 혼합 텍스트·요소 순서와 자식/형제 이동이 snapshot과 일치하며, namespace·HTML 속성명·quirks mode·상태 선택자가 Stylo matcher에서 기대값을 내는 것이다. 다른 generation의 같은 숫자 NodeId는 현재 view 요소를 돌려주지 않아야 한다. 잘못된 root, 충돌하는 HTML 속성 별칭, malformed UTF-16 입력 경계도 구체적으로 확인한다.

## 변경 내용

- `spinon-style`에 `stylo = 0.22.0`, 동일 릴리스의 `stylo_dom = 0.22.0`, Stylo와 동일한 `selectors = 0.41.0`을 고정했다. 직접 selector 의존성을 Stylo trait 버전에 맞춰 같은 타입 그래프를 사용한다.
- 불변 `HostDocumentSnapshot`으로부터 명시적인 루트 subtree view를 만든다. 가상 Document는 선택한 루트 하나만 자식으로 갖고, 선택 범위 밖·분리된 노드는 숨긴다.
- `TDocument`, `TNode`, `TElement`, `selectors::Element`를 연결했다. Stylo element data와 selector flag는 view 내부에 두고 원본 snapshot은 변경하지 않는다.
- HTML 문서의 XHTML 요소는 local name과 no-namespace 속성 이름을 ASCII 대소문자 무시로 비교한다. 대소문자 별칭 속성이 충돌하면 view 생성 오류를 반환한다. class/id 값은 수정하지 않고 quirks mode는 matcher에 전달한다.
- Stylo trait이 `unsafe` 시그니처로 요구하는 다섯 상태 변경 메서드만 lint 예외를 둔다. 구현 본문은 `Cell`과 Stylo의 안전한 wrapper만 호출하며 unsafe block을 추가하지 않는다.
- Shadow DOM·slot·pseudo-element, animation, style attribute 해석, stylesheet cascade, computed style, Taffy 변환, GPU 출력은 제공하지 않는다. ShadowRoot wrapper는 값을 만들지 않는 marker다.

## 재현 fixture와 관찰값

`crates/spinon-style/src/stylo_dom/tests.rs`는 한 번의 atomic batch로 `main` 아래 텍스트, `span`, `button`, 빈 `i`, checked `input`, 링크 `a`, 빈 텍스트를 포함한 `em`을 만든다. 원시 HostDocument의 `ID`, `CLASS`, `DATA-ROLE` 대문자 속성 이름은 HTML selector의 ASCII case-insensitive 규칙을 검증한다. `xml:lang`, `lang`, focus·hover·focus-visible·disabled·checked·active 상태를 함께 설정한다.

실제 Stylo matcher에서 `#id`, `.class`, attribute selectors, 대소문자 무시 HTML tag/속성 이름, `:root`, `:empty`, `:lang()`, `:focus-within`, hover/focus/disabled/checked/link 상태, 조상·형제 결합자를 확인했다. 같은 `main` 로컬 이름을 가진 비-XHTML namespace 요소는 HTML element로 분류하지 않는 사례도 확인했다. 별도 사례에서 새 snapshot만 변경을 관찰하고, 이전 view는 생성 revision의 상태를 유지하는 것을 확인했다. malformed UTF-16 surrogate는 selector 속성 문자열을 만드는 UTF-8 경계에서 U+FFFD로 바뀐다.

## 실행 결과

개발 환경은 Apple Silicon Mac Studio, macOS `26.5.1` / Darwin `25.5.0`, Rust와 Cargo `1.96.1`이다.

| 명령 또는 대상 | 결과 |
| --- | --- |
| `cargo test --locked --workspace` | 68개 테스트 통과: core 29, FFI 4, layout 14, runtime 6, style 7, layout spike library 5, spike binary 3 |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | 통과 |
| `cargo fmt --all -- --check` | 통과 |
| `git diff --check` | 통과 |
| `cargo check --locked -p spinon-style --target aarch64-linux-android` | 통과 |
| `cargo check --locked -p spinon-style --target aarch64-apple-ios` | 통과 |
| `cargo check --locked -p spinon-style --target aarch64-apple-ios-sim` | 통과 |

## 범위 해석

세 Rust target check는 해당 target에서 dependency와 adapter가 타입 검사되는 것을 확인한다. Android APK, iOS 앱, V8 호출, Stylo cascade, layout, 플랫폼 화면 또는 성능은 실행·측정하지 않았다. CSS 기능 및 계산값 적합성은 C04 fixture에 남는다. 공개 DOM API, app root 선택 정책, CSSOM, 동적 selector invalidation도 여기서 완료 처리하지 않는다.
