# 0008 · CSS 호환 목표와 범위

**상태:** 제안 · **명세 버전:** `0.1.0-draft` · **구현 우선순위:** Android·iOS 모바일 우선 · **최종 목표:** 고정 Chromium 기준 CSS 동작 100% 호환

이 문서는 스피논 CSS 지원의 목표 범위와 우선순위를 정한다. 제품의 주 대상은 Android·iOS 앱이므로 CSS 엔진 구현과 기능 검증은 모바일 화면을 먼저 완성하는 순서로 진행한다. 웹 빌드는 동일한 작성 코드를 실행하는 대상이며, 고정 Chromium 결과는 모바일 CSS 동작을 대조하는 기준이다. 웹 지원 목표를 제외하는 뜻은 아니다. 100%는 현재 지원이나 첫 릴리스 범위를 뜻하지 않는다. 실제 지원 여부와 완료 근거는 [구현 상태 대장](STATUS.md)의 CSS 체크리스트에서만 관리한다. 첫 공식 릴리스에 포함할 범위는 별도로 정한다.

## 100% 목표의 판정 기준

목표는 빌드와 실행 조건을 고정한 Chromium의 CSS 관찰 동작과 스피논 웹·Android·iOS 결과를 맞추는 것이다. 실제 CSS 구현·성능 작업은 모바일을 우선하고, 웹 결과는 같은 고정 Chromium에서 실행한 웹 빌드로 기준 동작을 확인한다. Safari·Firefox 등 다른 웹 엔진은 이 기준에 자동 포함되지 않으며, 지원 대상으로 삼을 때 별도 브라우저 버전·fixture 행렬을 추가한다. 호환 판정에는 정확한 Chromium revision/build, 실행 OS 이미지와 플래그, fixture별 viewport·device scale·locale·글꼴 집합·미디어 및 사용자 선호 상태를 기록한다. 고정한 Chromium 동작이 호환 판정 기준이고 CSSWG 표준·WPT는 기능 목록과 회귀 입력을 빠뜨리지 않도록 보완한다. 표준과 기준 Chromium 동작이 다르면 차이를 기록하고 판정 기준을 임의로 섞지 않는다. 지원을 주장하기 전에 비교 기준과 실행 조건을 기록한다. 기준과 CSS 기능 목록을 정하는 일은 `C01`이다.

기능별 비교에는 입력 CSS와 문서, 선택자 매칭, 계단식·상속 결과, 계산·사용 값, 레이아웃 좌표, GPU 표시, 동적 상태 변화와 오류 진단을 포함한다. 텍스트 모양·글꼴 대체·래스터 차이도 숨기지 않고 별도 결과로 기록한다. 화면이 대략 비슷하거나 Stylo가 선언을 파싱했다는 이유만으로 CSS 기능을 지원한다고 판정하지 않는다.

이 목표는 CSS 표면에 관한 것이다. DOM·JavaScript 호스트 API·HTML 요소의 동작은 각각 [웹 표면 명세](0003-web-surface.md), [DOM 호환 명세](0007-dom-compatibility.md), [구현 상태 대장](STATUS.md)의 별도 항목을 따른다.

100% 판정의 문서 범위는 `C01`에서 고정하는 지원 HTML·SVG 노드 집합과 UA stylesheet다. 이 경계는 브라우저 DOM·호스트 API 전체를 포함하지 않지만, 지원 노드에 적용되는 CSS 규칙을 임의로 제외하지 않는다. `C01`은 Chromium CSS feature inventory와 각 fixture의 선택자 매칭·계산값·레이아웃·페인트 결과를 고정하고, 비교 허용 오차와 차이 분류를 픽스처별로 명시한다. 비교는 세 층으로 나눈다. 선택자 매칭·cascade·정규화한 CSS 계산값은 의미 일치로 비교하고, 노드 상자·줄 상자·스크롤 범위는 CSS px 좌표의 최대 절대 오차로 비교한다. GPU 캡처는 고정 viewport·raster scale에서 픽셀 채널 차이와 다른 픽셀 수를 각각 비교한다. 숫자 한계는 기능·fixture별로 측정 전에 고정하고 하나의 전체 평균 점수로 실패를 감추지 않는다. 글꼴 래스터 등 GPU·OS 표면 차이는 별도 분류하되 계산값·레이아웃·표시 여부의 CSS 차이를 허용 오차로 숨기지 않는다. 이 범위와 판정 기준이 고정되기 전에는 100% 호환을 주장할 수 없다. 좌표는 [CSSOM View의 CSS px 좌표](https://drafts.csswg.org/cssom-view-1/#css-pixels)를 기준으로 하고, 캡처 fuzziness는 [Web Platform Tests의 reftest 기준](https://web-platform-tests.org/writing-tests/reftests.html)을 참고한다.

**UA stylesheet**(User-Agent stylesheet)는 HTML 요소의 브라우저 기본 스타일 규칙이다. 앱 author CSS와 Tailwind Preflight/reset CSS와 구분되는 cascade 출처다. 웹 브라우저는 자체 UA stylesheet를 적용하지만, 모바일 Spinon GPU 트리에는 브라우저가 없으므로 지원 요소의 기본 규칙을 내장해야 한다.

초기 구조 규칙 자원은 `spinon-style` 크레이트의 [`supported-elements-v0.css`](https://github.com/ohah/spinon/blob/main/crates/spinon-style/resources/ua/supported-elements-v0.css)에 두고 Rust 컴파일 시 바이너리에 포함한다. 현재 초안은 HTML namespace의 `div`, `span`, `a`, `img`, `button`, `input`, `p`, `ul`, `li`에 구조적 기본값을 제공한다. 버튼·입력의 OS별 모양과 기본 폰트, 링크 상태별 색·장식은 이 초안에 포함하지 않는다. C03은 Spinon snapshot을 Stylo DOM·selector 인터페이스에 연결했지만, 내장 자원을 UA cascade 출처로 등록해 계산 스타일과 화면에 적용하는 것은 별도 단계다. UA cascade 등록·레이아웃·GPU 표시가 연결되기 전에는 기본 스타일이 동작한다고 주장하지 않는다. Chromium 버전과 요소별 기준값은 `C01`에서 고정하고, 그 기준에 맞춘 검증을 마칠 때까지 이 자원은 호환성 완료 근거가 아니다. Rust·네이티브 경계와 포인터 수명은 [내장 UA stylesheet 인터페이스](internal/0007-ua-stylesheet-resource.md)에 둔다.


## 초기 Chromium 기준 스냅샷

C01의 첫 비교 산출물은 Chrome `154.0.8037.92`, Chromium revision `@334b65d254ccc35df4fca82706d1753227b01039`, macOS `26.5.1` (`25F80`, arm64)에서 수집했다. viewport는 `800×600` CSS px, 배율 `1`, locale `en-US`, time zone `UTC`, 미디어 상태는 light/no-preference/forced-colors none이다. 재현 조건과 브라우저·fixture·스타일 파일 해시는 [초기 비교 기록](internal/evidence/css-c01-chromium-ua-2026-10-01.md)과 그 기록이 가리키는 JSON에 있다.

초기 fixture는 9개 HTML 요소를 확인하고, computed value 19개를 정확 비교한다. 프로필 선언이 실제로 적용되는지 확인하기 위해 각 기대 계산값과 다른 author baseline을 먼저 넣고, 그 뒤 내장 CSS를 author stylesheet로 추가했다. baseline과 프로필 계산값을 모두 스냅샷에 보존하며, 19개 값은 모두 기준 Chromium 계산값과 일치했다. 9개 요소 ID는 별도의 fixture 범위 검사로 통과했다. 앞선 `ua-v0` 탐색 결과의 selector 집합 9개는 CSS 선언 적용을 입증하지 못해 비교 근거에서 제외하고 현재 기준 자료에서는 철회했다. 이 결과도 `C01` 전체가 아니다. SVG와 전체 feature inventory, UA cascade origin, layout·text·GPU 비교, Android·iOS 결과는 미측정이며 100% 호환을 주장하지 않는다.

2026-10-02의 C01.2 부분 layout oracle은 Chrome `154.0.8037.95` / revision `@05d469856e75794131cc2e5d9b2f6b6f10a70388`, macOS `26.5.1` (`25F80`, arm64)에서 수집했다. `rem`·`em`, content-box 퍼센트, fractional Flexbox grow·wrap, fractional Grid track 등 5개 case의 16개 요소와 computed CSS 값 41개를 고정한다. 계산 CSSStyleDeclaration 값은 앞뒤 공백을 제거한 뒤 정확 비교하고, 각 노드의 `x`·`y`·`width`·`height`는 CSS px별 최대 절대 오차 `0.5`를 기준으로 둔다. [C01.2 비교 근거](internal/evidence/css-c01-layout-2026-10-02.md)와 [layout snapshot](../tests/fixtures/css/references/chromium-macos-arm64-macos-26.5.1-25f80-154.0.8037.95-layout-v1-778a2065ac58-inventory-ef6d0b87a506-capture-85a34bd9a1a2-bin-affc6715a14a/core-layout.json)에 환경·입력 hash·관찰값을 보존한다. 같은 Chromium revision에서 기존 9개 요소·19개 값 UA fixture도 재수집해 `.93` 관찰 객체와 동일함을 확인했다. 이는 oracle 입력을 보강한 부분 자료이며 Spinon/Taffy 비교나 제품 기능 지원 판정이 아니다. 텍스트, 페인트·GPU, 전체 Grid/Flexbox, Android·iOS는 미측정이므로 C01은 계속 미완료다.

## 구현 책임

| 계층 | 책임 | 경계 |
| --- | --- | --- |
| Vite·Rspack 통합 | CSS import·모듈·에셋과 JS 청크의 의존 관계를 보존하고 웹·모바일 산출물을 만든다. | CSS 문법을 조용히 제거하거나 모바일 지원으로 간주하지 않는다. Lightning CSS 변환은 웹 기준 결과와 동등함을 확인한 범위에서만 사용한다. |
| `spinon-core` 문서 트리 | 요소·텍스트·속성·클래스·문서 순서와 변경 revision을 소유한다. | 현재 S01 트리만으로 Stylo DOM 계약을 충족한다고 보지 않는다. |
| `spinon-style` | 고정한 Stylo 버전에 맞춰 Spinon 트리를 CSS DOM 계약에 연결하고, 스타일시트·선택자·계단식·상속·계산 스타일·무효화를 관리한다. | Blitz DOM을 런타임 의존성으로 사용하지 않는다. Stylo는 계산 스타일을 제공하며 화면을 그리거나 전체 레이아웃을 대신하지 않는다. |
| `spinon-layout` | 계산 스타일을 레이아웃 입력으로 변환하고 노드 ID·측정 콜백·캐시·갱신·좌표를 관리한다. | Taffy는 지원하는 Block·Flexbox·Grid 알고리즘에 사용한다. 전체 CSS 목표를 Taffy의 현재 기능에 한정하지 않고 추가 알고리즘이나 대체 경로를 허용한다. |
| 텍스트·자원 계층 | 글꼴 선택, shaping, 줄바꿈, 이미지의 고유 크기와 측정을 제공한다. | Taffy의 합성 측정 fixture를 실제 글꼴·텍스트 지원으로 간주하지 않는다. |
| `spinon-render` | 계산된 페인트 스타일을 GPU 장면·클리핑·합성·히트 테스트로 반영한다. | 레이아웃 입력으로 변환되지 않는 CSS 페인트 속성도 별도로 구현해야 한다. |

초기 Stylo 통합 기준은 [Stylo crate `0.22.0`](https://crates.io/crates/stylo/0.22.0)으로 고정한다. 기존 Blitz 참조 실험과 공개 `stylo_taffy` 코드는 동작·변환 규칙을 살펴볼 참고 자료다. Spinon은 자체 DOM 어댑터와 자체 Stylo→레이아웃 변환 경계를 소유하며 Blitz DOM에 의존하지 않는다. 버전 변경은 DOM trait, computed value, 변환 결과와 적합성 fixture를 함께 확인한 뒤 수행한다.

## CSS 지원 우선순위

우선순위는 구현 순서다. 낮은 우선순위 항목도 최종 목표에서 제외되지 않는다.

| 우선순위 | 구현 단계 | 포함 범위 |
| --- | --- | --- |
| P0 | 기반과 첫 모바일 화면 | 기준 브라우저·속성 목록, CSS 산출물 경로, Stylo DOM 연결, selector/cascade, 상속·사용자 지정 속성, 기본 단위·상자 모델, `display: none/block`, Flex 기본, 기본 색·글꼴 값, 미지원 진단 |
| P1 | 일반 모바일 앱 레이아웃 | Block·인라인·Flex·Grid의 웹 동작, 크기·간격·정렬·위치 지정·overflow·내재 크기, 실제 글꼴 측정과 줄바꿈, 배경·테두리·모서리·투명도 |
| P2 | 반응형·상호작용 | 복합 선택자와 상태·가상 요소, 미디어·기능·컨테이너 질의, cascade layers, 변환·클리핑·쌓임, 전환·애니메이션, 이미지 표시 규칙 |
| P3 | 고급·문서 레이아웃 | 표·float·다단, 논리 속성·RTL·쓰기 모드, 고급 Grid, containment, SVG 스타일, 필터·마스크·혼합, 폼 컨트롤 외형과 희귀 at-rule |
| P4 | 기준 구현 전체 대조 | 고정 Chromium 기준에서 남은 CSS 속성·값·선택자·at-rule·상태 차이를 분류하고 100% 목표까지 닫는다. 새 Chromium 기준을 채택하면 새 버전 적합성 묶음으로 반복한다. |

P0~P3 항목은 먼저 세 플랫폼 수직 화면에서 필요한 부분을 구현할 수 있다. 일부 값을 지원했다고 해당 속성군 전체를 완료 처리하지 않는다. 부분 구현은 대장에 하위 ID를 만들고, 미지원 분기와 진단을 남긴다.

## 범위별 목표 목록

아래 목록은 최종 CSS 목표의 기능군이다. 실제 구현 상태 체크는 중복 기록하지 않고 [CSS 구현 체크리스트](STATUS.md#css-구현-체크리스트)를 따른다.

| 기능군 | 목표 범위 | 우선순위 |
| --- | --- | --- |
| 문법·선택자 | 스타일시트와 inline style, type·universal·class·ID·attribute selector, 결합자, 구조·상태·언어 관련 pseudo-class, pseudo-element, 오류 위치 | P0 → P4 |
| cascade·상속 | origin·importance·specificity·source order, 상속·초깃값·상속 키워드, custom properties와 `var()` 대체·순환, `@layer`, `@import` 해석·순서, `@namespace`, `@scope` | P0 → P4 |
| 값·단위 | 절대·상대 길이, `%`, font·viewport·container 단위, `calc()`·`min()`·`max()`·`clamp()`, 색상 공간·투명도, 함수·키워드·전역 값 | P0 → P4 |
| 상자·기본 배치 | content/padding/border box, margin·padding·border, width/height와 min/max, aspect ratio, display와 기본값, 내재 크기 | P0 → P4 |
| 레이아웃 | Block·inline formatting, Flexbox, Grid, 위치 지정과 containing block, overflow·스크롤, 표·float·다단·고급 Grid | P0 → P4 |
| 글꼴·텍스트 | font 선택·크기·굵기·스타일·line-height, shaping·fallback·font loading, 줄바꿈·공백·정렬·장식·간격, bidi·RTL·writing mode·logical properties | P0 → P4 |
| 페인트·합성 | color·background, gradient·image, border·radius·outline·shadow, opacity·transform·filter, clipping·mask·blend·stacking·z-index | P0 → P4 |
| 반응형·동적 상태 | `@media`, `@supports`, `@container`, 상태 선택자, prefers-* 환경, transition·animation·keyframes, scroll-linked 동작 | P1 → P4 |
| 대체 요소·플랫폼 스타일 | replaced element 크기와 `object-fit`/`object-position`, SVG CSS, form control appearance·상태·focus, UA 기본 스타일 | P1 → P4 |
| CSSOM 연결 | 일반 `id`·`class` DOM 변경에 따른 재계산과 프레임워크 어댑터가 전달하는 초기 inline declaration은 첫 수직 CSS 경로에 포함할 수 있다. 공개 `setAttribute("style", ...)`, `Element.style`/`CSSStyleDeclaration`, CSSStyleSheet 편집, 계산 스타일·박스 조회와 관찰자는 각 동기화 계약을 정한 뒤 C29에서 연결한다. | P0 → P4 |

## 미지원과 오류 처리

CSS 파싱 성공, Stylo 계산 스타일 생성, Taffy 입력 변환, GPU 표시를 각각 구분한다. 어느 단계에서든 지원하지 않는 선언·선택자·at-rule이 있으면 빌드 또는 개발 실행에서 원본 위치와 원인을 진단한다. 웹에서는 동작하지만 모바일에서 빠지는 경우 `차이`로 기록한다. 의미를 보존하지 못하는 값을 기본값으로 바꿔 놓고 지원으로 표시하지 않는다. 모바일의 외부 네트워크 CSS `@import`와 `url()` 자원 요청 로더는 미구현이며, 로컬 번들 자원만 이 범위에서 읽는다. 외부 참조를 요청하지 않고 미지원으로 진단한다. 이 항목은 `<img src>`의 원격 이미지 로딩 계약과 별개다.

지원 완료 표기는 [범위와 적합성 명세](0001-conformance.md)의 상태 정의를 따른다. CSS 기능군은 자식 속성·값·선택자 시나리오가 모두 적합성 기준을 통과하기 전까지 부분 상태로 둔다.
