# C04.1 기본 cascade slice 실행 근거

**판정:** 고정 fixture용 내부 구현과 Chromium 비교 완료 · **제품 CSS/runtime 지원:** 미완료

**최종 검증일:** 2026-10-03 (Asia/Seoul)

## 비교 환경

| 항목 | 고정값 |
| --- | --- |
| Chromium | Chrome `154.0.8037.95`, revision `@05d469856e75794131cc2e5d9b2f6b6f10a70388` |
| 실행 파일 SHA-256 | `affc6715a14a423f5207014ae4b86ddad028e70b04b13572d60d35d8ac728f91` |
| OS | macOS `26.5.1` (`25F80`), Darwin kernel `25.5.0`, arm64 |
| Node.js | `v24.20.0` |
| 문서 viewport | `800×600` CSS px, device scale factor `1`, `screen`, light, `en-US`, `UTC` |
| 외부 자원 | Chromium 렌더러 네트워크를 offline으로 설정, stylesheet `@import` 거부 |
| 입력 fixture SHA-256 | `cb1e774765851d6a51fd0fb41c99c3f888cb882921dde72fc26363853f0a79d1` |
| 캡처 도구 SHA-256 | `0e231fc4dc017c9d41186d9b29c96a7dc3c8fffeaaf77b417f446297310814b7` |
| 최종 reference | [`computed-styles.json`](../../../tests/fixtures/css/references/chromium-darwin-arm64-25.5.0-macos-26.5.1-154.0.8037.95-c04-cascade-v1-cb1e77476585-29b38ffc9b17-0e231fc4dc01-0cf4a1587190-affc6715a14a/computed-styles.json) |

## 확인한 동작

`spinon-style` 내부에서 한 immutable `HostDocument` revision에 대해 내장 UA stylesheet와 전달 순서대로 등록한 author stylesheet를 Stylo `Stylist`에 넣었다. 문서 URL·HTML 모드·quirks mode를 가진 `StyloDocumentView`에서 no-namespace HTML `style` 속성을 파싱해 같은 `SharedRwLock`으로 Stylo 요소에 제공한다. root-first 순회 중 부모의 computed values를 전달하고 `display`, `color`, `font-size`, `font-weight`, `margin-top`만 snapshot으로 반환한다. 잘못된 inline 선언은 그 HostNode ID에 연결한 파서 진단으로 남긴다.

Chromium `getComputedStyle()`과 요소 fixture ID 순서로 16개 요소 × 5개 속성, 총 80개 문자열을 정확 비교했다. fixture에는 UA 대 author origin, selector specificity, stylesheet source order, normal/important 및 inline declaration, 대문자 HTML `STYLE`, 파싱 실패 진단, 상속과 `inherit`·`initial`·`unset`, 고정 폭 screen media query를 포함했다. 비교 결과는 모두 일치했다.

## 적대적 점검에서 수정한 항목

- viewport의 각 입력값이 양수·유한한지 확인하는 것만으로는 `width × deviceScaleFactor`가 무한대가 되거나 0으로 underflow하는 입력을 막지 못했다. 실제 device 크기 곱도 검사하고 overflow·underflow 회귀 사례를 추가했다.
- capture 도구가 `print`·dark 조건도 허용했지만 내부 Stylo `Device`는 screen·light로 고정되어 있었다. reference 생성 입력을 screen·light로 제한하고 고정 viewport와 같은 언어 설정을 Chromium에 전달한다.
- reference ID가 브라우저 버전만 식별해 동일 버전의 다른 바이너리·OS 조건 결과가 충돌할 수 있었다. 캡처 도구, OS 환경, 브라우저 실행 파일 해시를 ID에 포함하고 macOS 제품 버전·빌드와 kernel 정보를 결과에 기록한다.
- User-Agent override가 `MacIntel`을 고정해 다른 운영체제에서 실행하면 기준 환경 표기가 실제 OS와 달라질 수 있었다. 플랫폼 override를 제거하고 실행 환경 metadata를 보존한다.
- DevTools 응답·페이지 load 무한 대기와 Chromium 기동 오류가 진단을 늦추거나 임시 profile을 남길 수 있었다. 연결·명령·이벤트·HTTP 응답에 시간 제한을 두고 성공·오류 경로에서 임시 profile과 프로세스를 정리한다. Unicode 오류가 `btoa()`에서 추가 오류를 내던 경로도 UTF-8 base64 인코딩으로 바꿨다.
- fixture에서 태그·속성 이름이나 script 종료 문자열이 캡처 HTML 경계를 바꿀 수 있었다. HTML/JSON 삽입 값을 escape·검증하고 실행 코드·외부 스타일 요소, 이벤트 속성, `@import`, fixture 디렉터리 밖 symlink 및 잘못된 UTF-8을 거부한다. 관찰 ID 조회는 CSS 식별자 escape에 의존하지 않고 DOM 속성값을 정확히 대조한다. 브라우저 캡처 페이지는 외부 네트워크 없이 실행한다.
- 페이지 안의 Unicode 진단 문자열은 `btoa()`에 직접 전달할 수 없어 오류 보고 중 예외를 낼 수 있었다. UTF-8 바이트를 base64로 바꿔 원래 캡처 오류를 보존한다.
- C03 selector adapter에서 pseudo-element와 `:visited` history matching이 구현되지 않았으므로 C04 계약의 제한으로 명시했다. Stylo가 문법을 인식하는 것만으로 이 동작을 제품 지원으로 판정하지 않는다.

## 실행 검증

| 명령 | 결과 |
| --- | --- |
| `mise exec -- node --check tools/css-reference/capture-c04-cascade.mjs` | 통과 |
| `mise exec -- node tools/css-reference/capture-c04-cascade.mjs` | Chrome `154.0.8037.95`에서 reference 신규 생성, 16개 요소 캡처 |
| `mise exec -- cargo fmt --all -- --check` | 통과 |
| `mise exec -- cargo test --locked -p spinon-style` | 14개 통과 |
| `mise exec -- cargo test --locked --workspace` | 75개 통과, 실패 없음 |
| `mise exec -- cargo clippy --locked --workspace --all-targets -- -D warnings` | 통과 |

## 경계와 남은 범위

이 결과는 고정 fixture용 내부 cascade 계산만 검증한다. `compute_basic_cascade`는 `pub(crate)`이고 runtime·JS API·Taffy·GPU·앱 경로에서 호출되지 않는다. 고정 UA 규칙 subset, 한 번의 전체 traversal, whitelist serialization만 제공한다. 동적 stylesheet 변경·invalidation, computed-style DOM API, CSSOM, pseudo-element 생성, `:visited`, cascade layers, `@scope`, CSS custom properties, animations, external loader, 실제 font metrics, Android·iOS 동작은 확인하거나 완료 처리하지 않았다. 제품 CSS 지원의 전체 상태는 [C04 상태 대장](../../STATUS.md#css-구현-체크리스트)과 [0016 내부 계약](../0016-c04-basic-cascade.md)을 따른다.
