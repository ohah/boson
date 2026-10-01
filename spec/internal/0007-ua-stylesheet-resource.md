# I07 · 내장 UA stylesheet 자원 인터페이스

**상태:** 내부 구현 초안 · **버전:** `0.1.0-draft` · **구현 범위:** 컴파일 시 자원 내장과 읽기 전용 조회

이 문서는 Rust 앱 바이너리에 포함되는 기본 HTML 스타일 규칙과 C ABI 조회 경계를 정의한다. 이 자원이 존재하거나 조회된다고 Stylo cascade, 레이아웃, GPU 화면에 적용됐다는 뜻은 아니다. 스타일 계산 연결은 [CSS 호환 명세](../0008-css-compatibility.md)의 C03·C04에서 구현한다.

## 자원

- 크레이트: `spinon-style`
- 포함 경로: `crates/spinon-style/resources/ua/supported-elements-v0.css`
- 포함 방식: Rust `include_str!`; 실행 중 파일·네트워크를 읽지 않는다.
- 프로필 ID: `spinon-html-ua/0.1.0-draft`
- 출처 참고: [Chromium Blink `html.css`](https://chromium.googlesource.com/chromium/src/+/3ae19953a97dab54ff57330d80764be8c86c70be/third_party/blink/renderer/core/html/resources/html.css)

위 Chromium 소스 revision은 이 초안의 규칙을 작성할 때 참고한 입력이다. C01의 고정 oracle revision `@334b65d254ccc35df4fca82706d1753227b01039`과는 서로 다르며, 이 파일을 해당 oracle의 UA stylesheet 복사본으로 간주하지 않는다. 비교되는 동작은 C01 fixture의 Chromium 관찰값으로 별도 확인한다.

초안은 HTML namespace를 지정하고 지원 요소의 구조 기본값만 담는다.

| 요소 | 내장 선언 |
| --- | --- |
| `div` | `display: block` |
| `span`, `a`, `img` | `display: inline` |
| `button`, `input` | `display: inline-block` |
| `p` | `display: block`; block 방향 여백 `1em`, inline 방향 여백 `0` |
| `ul` | `display: block`; `disc` 마커; block 방향 여백 `1em`; inline 방향 여백 `0`; inline 시작 padding `40px` |
| `li` | `display: list-item` |

이 범위에는 버튼·입력의 OS별 외형과 font shorthand, 링크 상태별 색·밑줄, 폰트 공급, `<html>`·`<body>` 문서 틀이 포함되지 않는다. 지원 요소의 실제 노드·속성·상태 범위와 기준 Chromium 버전은 C01에서 확정한다. 따라서 이 프로필은 완성된 Chromium UA stylesheet가 아니다.

## C ABI

선언은 `crates/spinon-ffi/include/spinon_ffi.h`에 둔다.

| 함수 | 반환값 | 수명·오류 |
| --- | --- | --- |
| `spinon_embedded_ua_stylesheet_profile_id()` | NUL 종료 UTF-8 프로필 ID | 프로세스 수명 동안 유효한 읽기 전용 포인터; 실패 반환 없음 |
| `spinon_embedded_ua_stylesheet_data()` | CSS UTF-8 데이터 시작 주소 | 프로세스 수명 동안 유효한 읽기 전용 포인터; 바이트는 NUL 종료되지 않음 |
| `spinon_embedded_ua_stylesheet_len()` | CSS 바이트 길이 | 종단 NUL을 포함하지 않음 |

호출자는 데이터 포인터를 수정하거나 해제하지 않는다. CSS를 문자열로 다룰 때는 길이를 사용하며, 임의의 NUL 종료 문자열로 가정하지 않는다. 자원은 고정 데이터이므로 조회 함수는 플랫폼별 차이 없이 같은 내용을 반환한다.

사용 예시는 포인터와 길이를 짝으로 넘기는 방식만 보여준다. `consume_ua_css`는 호출 측에서 구현할 소비자를 나타내며 현재 제공되는 Spinon API가 아니다.

```c
#include "spinon_ffi.h"

void consume_ua_css(const uint8_t *css, size_t css_length);

void register_default_ua_style(void) {
  const uint8_t *css = spinon_embedded_ua_stylesheet_data();
  size_t css_length = spinon_embedded_ua_stylesheet_len();
  consume_ua_css(css, css_length); /* NUL 검색이나 free를 하지 않습니다. */
}
```

## 아직 연결하지 않은 런타임 동작

1. **완료:** C03 DOM adapter가 HTML 문서 모드와 XHTML namespace를 함께 판정한다. 이 연결만으로 UA stylesheet를 적용하지는 않는다.
2. C04에서 자원을 Stylo의 UA cascade 출처로 등록하고 앱 author stylesheet가 CSS cascade 규칙대로 덮어쓸 수 있게 한다.
3. CSS 의미·계산 스타일·레이아웃·GPU 픽셀을 기준 Chromium과 Android·iOS에서 각각 비교한다.
4. 버튼·입력 외형, 기본 폰트, 링크 상태 규칙은 별도 지원 프로필과 적합성 fixture가 정해지기 전까지 지원 완료로 표시하지 않는다.

C01 초기 Chromium revision과 9개 요소 fixture는 기록했지만 전체 HTML·SVG 범위와 CSS feature inventory는 아직 고정하지 않았다. 이 부분 자료만으로는 호환성을 보증하지 않는다. 기본 규칙을 바꾸어 관찰 결과가 달라지면 프로필 ID와 이 인터페이스 버전을 함께 갱신한다.
