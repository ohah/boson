# CSS·Stylo·레이아웃 구현 계획

**문서 상태:** 구현 계획 초안 · **구현 우선순위:** Android·iOS 모바일 우선 · **최종 목표:** 고정 Chromium 기준 CSS 동작 100% 호환 · **현재 제품 지원 완료:** 없음

이 문서는 [CSS 호환 명세](../../spec/0008-css-compatibility.md)의 범위를 어떤 순서로 구현할지 정리한다. Android·iOS 모바일 화면과 CSS 경로를 먼저 완성하고, 웹 빌드는 동일한 작성 코드와 고정 Chromium 기준 동작을 확인하는 대상으로 유지한다. 진행 상태의 SSOT는 [구현 상태 대장](../../spec/STATUS.md)의 `C01`~`C30`이다. 이 계획의 단계나 실험 통과만으로 제품 지원 완료를 선언하지 않는다. 첫 공식 릴리스 범위도 여기서 정하지 않는다.

## 현재 근거와 공백

- 현재 checkout에는 `spikes/stylo-style`과 `spikes/blitz-stylo-layout` 경로가 없다. `spikes/style-layout`은 Lightning CSS AST와 Taffy `0.14.0`을 시험하며 Stylo DOM/cascade 연결은 하지 않는다.
- 제품 workspace는 Stylo [`0.22.0`](https://crates.io/crates/stylo/0.22.0), `stylo_dom 0.22.0`, `selectors 0.41.0`을 고정했다. C03 Selector DOM adapter와 C04.1 fixture cascade 경로가 있으며, C04.2는 별도 `spinon-style-to-layout` crate에서 제한 computed-style profile을 Taffy 입력으로 투영해 C01.2 분수 Flex fixture와 비교한다. 제품 runtime과 GPU 표시는 연결되지 않았다.
- `spinon-style::StylesheetRegistry`는 UTF-8 stylesheet 입력, Stylo origin, 등록 순서와 parser 진단을 보존하고, 내부 C04.1 경로가 이를 Stylo `Stylist`에 연결해 UA·author·inline 선언과 제한 속성의 계산값을 만든다. 외부 `@import` 로더는 제공하지 않는다. 정확한 scope와 미완료 범위는 [0016 내부 계약](../../spec/internal/0016-c04-basic-cascade.md), 실행 결과는 [C04.1 근거](../../spec/internal/evidence/css-c04-basic-cascade-2026-10-03.md)에 둔다.
- R10은 Taffy의 트리 갱신·좌표·합성 텍스트 측정을 비교했다. 실제 글꼴 shaping·줄바꿈·GPU 화면을 검증하지 않았다.
- C02 production 추출과 fixture 전용 adapter prototype은 [Vite `8.3.1`·Rspack `2.2.7` 기록](../../spec/internal/evidence/css-c02-bundler-2026-10-01.md)에 있다. 양쪽 production build에서 CSS Module named import, 조건 suffix가 있는 로컬·외부 `@import`, SVG·WOFF2 자원, entry/dynamic/shared chunk를 확인했다. Vite 기본 CSS Module 객체 import는 통과하고 Rspack은 `namedExports: false` 설정으로 맞출 수 있다. Rspack stats는 CSS source/module graph와 원본 위치를 주고 Vite manifest는 chunk·CSS·asset 연결을 준다. 번들러별 collector가 [내부 계약 후보](../../spec/internal/0011-css-resource-adapter-c02.md)의 공통 snapshot으로 정규화한다. Vite 기본 경고에는 원본 CSS 위치가 없지만 fixture adapter가 입력 CSS parser 위치를 보존해 Rspack의 `2:24` raw column과 정규화된 1-based `2:25`를 맞췄다. 후속 [C02.1 비교](../../spec/internal/evidence/css-c02-resolver-2026-10-02.md)는 fixture alias, package `exports`, package 내부 상대 `@import`가 실제 두 번들러의 production graph에서 snapshot과 entry CSS로 이어짐을 확인했다. 이 prototype은 fixture에 한정되며 symlink·plugin 가상 모듈·조건별 exports, 최종 graph 직렬화, 제품 패키지/API, 모바일/OTA 연결은 구현하지 않았으므로 C02는 미완료다.
- C02.2는 [0014 모듈 그래프 adapter 계약](../../spec/internal/0014-c02-bundler-module-graph.md)에 따라 입력 resolver graph와 최종 emitted ESM graph를 별개로 수집한다. 원본 요청 문자열을 출력 specifier로 대신 쓰지 않으며, C02.2 하위 범위는 JavaScript graph·JavaScript resource digest까지다. chunk graph에 없는 Worker JavaScript `OutputAsset`은 누락 실행 코드로 보고 성공을 거부한다. 공통 snapshot validator·digest·ESM AST parser는 [contract evidence](../../spec/internal/evidence/css-c02-module-graph-contract-2026-10-02.md), Vite와 Rspack fixture adapter는 각각 [Vite evidence](../../spec/internal/evidence/css-c02-vite-module-graph-2026-10-02.md)와 [Rspack evidence](../../spec/internal/evidence/css-c02-rspack-module-graph-2026-10-02.md)에 둔다. Rspack의 기본 runtime output은 실제 ESM import edge를 만들지 않을 수 있으므로 설정 플래그가 아니라 최종 산출 JS를 검사하고 비호환이면 명시적으로 실패 처리한다. 각 adapter는 별도 fixture/output 소유자가 개발하고 공통 계약·validator·상태 대장은 단일 통합 소유자가 관리한다. C02.2 하위 fixture 구현은 통합 suite와 adapter별 독립 검토를 통과했다. 제품 API·범용 plugin 호환·X01 loader·OTA는 별도 작업이다.
- C02.3은 [0015 결합 계약](../../spec/internal/0015-c02-resource-graph-join.md)에 따라 한 번의 production build에서 두 collector가 관찰한 snapshot만 결합한다. 동일 capture ID·fixture/profile digest와 JS 출력 바이트 전체 일치를 확인하고, chunk 문자열 ID가 아니라 JS 출력 resource를 기준으로 0011의 stylesheet/font/image 연결을 0014의 feature·chunk에 붙인다. 입력 provenance와 최종 emitted JS edge를 섞지 않는다. 고정 Vite·Rspack fixture에서 실행한 [통합 근거](../../spec/internal/evidence/css-c02-resource-graph-join-2026-10-02.md)는 raw output bytes·graph digest·실패 경계를 보관한다. 이 내부 join은 범용 앱 지원, R15의 빌드 간 논리 ID나 제품 OTA 적격성을 증명하지 않는다.
- R03은 `HostDocument`·불변 snapshot의 내부 코어 모델을 `spinon-core`에 추가했고, C03은 snapshot을 Stylo `0.22.0` DOM·selector trait에 연결했다. 공개 DOM façade와 스타일 변환 계층, 계산 스타일→Taffy 경계는 별도 작업이다.
- S04.1의 정책, S04.2 Chromium 기준 fixture, S04.3 CPU `StaticRenderSnapshot`, S04.4 Android 및 S04.5 iOS simulator surface 연결, S04.6 교차 플랫폼 캡처 대조를 확인했다. 대조에서 각 플랫폼의 GPU 색상 경계와 Chromium geometry·snapshot 좌표 차이는 최대 0.167 CSS px였다. 다음은 S04.7 후속 계약 분리다. 일반 CSS·앱 runtime 완료를 뜻하지 않는다. [0019 S04 계약](../../spec/internal/0019-s04-css-layout-gpu-slice.md), [CPU snapshot 근거](../../spec/internal/evidence/s04-css-layout-render-snapshot-2026-10-03.md), [교차 플랫폼 근거](../../spec/internal/evidence/s04-cross-platform-comparison-2026-10-03.md)를 기준으로 남은 작업을 각 소유 명세와 상태 ID에 연결한다.


### C01 초기 기준 산출물

첫 Chromium oracle은 Chrome `154.0.8037.92` / Chromium revision `@334b65d254ccc35df4fca82706d1753227b01039`, macOS `26.5.1` (`25F80`, arm64)였다. 2026-10-02에는 Chrome `154.0.8037.93` / revision `@f89f3a4363808e117c592adedcf9947882ac3b79`로 부분 inventory 입력을 다시 캡처했다. viewport `800×600` CSS px, device scale factor `1`, locale `en-US`, time zone `UTC`, light/no-preference/forced-colors none은 CDP에서 고정한다. 실행 파일·fixture·inventory·CSS 자원의 SHA-256 및 관찰값은 [첫 비교 기록](../../spec/internal/evidence/css-c01-chromium-ua-2026-10-01.md), [부분 inventory 검증](../../spec/internal/evidence/css-c01-inventory-2026-10-02.md)과 각 JSON 스냅샷에 보존한다.

Node.js 내장 WebSocket과 Chromium DevTools Protocol로 HTML fixture를 확인한다. 현재 초기 범위인 9개 요소·19개 feature의 selector·예상 node ID·property·안정 ID는 버전 있는 부분 inventory JSON으로 관리한다. 캡처기는 이를 검증해 문서 생성 전에 fixture에 주입하고 inventory 해시를 새 reference-id와 결과에 기록한다. 초기 Chromium 계산값과 다른 값으로 시작하는 author baseline을 먼저 적용한 뒤 `supported-elements-v0.css`를 추가해 inventory의 computed CSS 값이 baseline을 덮고 기준값과 일치하는지 비교한다. 2026-10-02 수집에서 19개 값이 모두 일치했고 9개 요소 ID도 통과했다. `.92`와 `.93` 스냅샷의 관찰·비교 배열은 동일했다. 예전 `ua-v0`의 selector 집합만 보던 탐색 결과는 규칙 적용 여부를 증명하지 못해 현재 비교 자료에서 철회했다. 이 비교는 UA cascade origin, Rust FFI, Stylo, 레이아웃, 글꼴, GPU 픽셀 또는 Android·iOS 동작을 검증하지 않는다. SVG와 전체 CSS inventory도 아직 확정하지 않았으므로 C01은 미완료다.

### C01.2 단위·Flexbox·Grid oracle seed

`layout-inventory.v1.json`과 `layout-units-flex-grid.html`은 `rem`·`em`, content-box 퍼센트, 분수 Flexbox grow와 wrap/gap, 분수 Grid track의 5개 case를 정의한다. Chrome `154.0.8037.95` / revision `@05d469856e75794131cc2e5d9b2f6b6f10a70388`에서 16개 요소의 41개 computed 값과 CSS px 좌표를 수집했다. 계산값은 앞뒤 공백 제거 후 정확 비교하고 각 노드의 좌표·크기별 최대 절대 오차를 `0.5 CSS px`로 고정했다. [C01.2 근거](../../spec/internal/evidence/css-c01-layout-2026-10-02.md)와 [JSON 결과](../../tests/fixtures/css/references/chromium-macos-arm64-macos-26.5.1-25f80-154.0.8037.95-layout-v1-778a2065ac58-inventory-ef6d0b87a506-capture-85a34bd9a1a2-bin-affc6715a14a/core-layout.json)는 해당 결과가 Chromium 기준 데이터일 뿐 Spinon/Taffy 동작이나 CSS 지원 완료가 아님을 구분한다. 같은 `.95` revision에서 C01.1 UA fixture도 다시 수집했고 `.93` 결과와 관찰 배열이 같았다. 전체 목록, 텍스트·페인트, CSSWG/WPT coverage, Android·iOS는 남아 있어 C01 전체는 미완료다.

## 소유 모듈과 데이터 흐름

```mermaid
flowchart TD
    A[CSS import와 청크 산출<br/>Vite·Rspack] --> C[DOM trait 어댑터와 cascade<br/>spinon-style · Stylo]
    B[Spinon 문서 트리<br/>spinon-core] --> C
    C --> D[계산 스타일 변환·레이아웃<br/>spinon-layout · Taffy 및 추가 알고리즘]
    D -->|측정 요청| E[텍스트 측정·글꼴 shaping]
    E -->|측정값·glyph run| D
    C --> F[페인트 스타일]
    D --> G[geometry]
    D -->|배치된 glyph·geometry| H[GPU 장면·합성<br/>spinon-render]
    F --> H
    G --> H
    H --> I[Android·iOS GPU 표면]
```

| 모듈 | 소유할 구현 |
| --- | --- |
| `crates/spinon-core` | R03 `HostDocument` 내부 트리·안정 핸들·속성·요소 상태·문서/표시 revision snapshot. 기존 S01 `Tree`와 레이아웃 모듈은 아직 분리됨 |
| `crates/spinon-style` | Stylo [`0.22.0`](https://crates.io/crates/stylo/0.22.0) DOM trait adapter, stylesheet 파싱·출처·등록 순서, fixture cascade 및 computed-style snapshot. runtime 연결·cache·무효화는 후속 작업 |
| `crates/spinon-style-to-layout` | C04.2 제한 computed-style profile의 검증·변환과 CSS 값의 전체 요청 실패 진단. 일반 CSS 지원 또는 runtime 연결은 아님 |
| `crates/spinon-layout` | Taffy 입력·노드 ID 대응, Flex subset 계산, 텍스트·이미지 measure callback, dirty subtree 갱신, 좌표 정책 |
| `crates/spinon-render` | 페인트 속성 변환, GPU 장면, stacking·clip·composite·hit-test |
| Vite·Rspack 패키지 | CSS import·CSS Modules·에셋 참조·원본 위치·JS 청크별 CSS 의존성을 웹·모바일 산출물에 연결 |

Blitz DOM은 런타임 의존성에 넣지 않는다. `stylo_taffy`의 변환 코드는 대응 관계를 확인하는 참고 자료로 사용한다. 자체 변환기는 실제 지원 계약에 필요한 항목부터 만들고, MPL 고지와 원본 보존 등 라이선스 의무를 확인한 뒤 코드 재사용 범위를 정한다.

Taffy `0.14.0`에는 Block·Flexbox·Grid 구현이 있지만 현재 workspace는 `flexbox`와 `block_layout` 기능만 켠다. C04.2도 Flex fixture만 비교하며 Grid를 계산하지 않는다. C11에서 Grid feature를 별도 활성화·검증한다. 전체 CSS 목표를 달성하기 위해 `spinon-layout` 경계는 Taffy에 고정하지 않고 필요한 알고리즘을 자체 구현하거나 다른 검증된 알고리즘으로 확장할 수 있게 CSS 값 변환과 레이아웃 알고리즘 dispatch를 분리한다.

## 우선순위와 완료 관문

| 단계 | 먼저 구현할 것 | 통과 기준 |
| --- | --- | --- |
| P0 · 기준·연결 | Chromium 비교 기준과 버전, 지원 HTML/SVG 노드·UA stylesheet 프로필, CSS 기능 inventory와 fixture별 출력·허용 오차, CSS 번들 경로, Spinon DOM용 Stylo adapter, selector/cascade·상속·변수, 값·단위 변환, box model, 미지원 위치 진단 | Stylo `0.22.0` 계산 스타일을 Spinon 노드별로 얻고, 지원·미지원 선언을 원본 위치와 함께 구분한다. 선택자·계산값·레이아웃·페인트 결과를 고정 fixture와 비교하며 CSS 의미 차이를 래스터 허용 오차와 분리한다. |
| P1 · 모바일 앱 레이아웃 | Block·inline·Flex·Grid의 우선 속성, position·containing block, overflow·scroll, 내재 크기, 실제 글꼴 측정·줄바꿈, 기본 페인트 | 공통 화면 fixture의 computed value·geometry·텍스트 박스가 Chromium, Android, iOS에서 비교되고 허용 차이와 원인이 기록된다. |
| P2 · 반응형·동적 | pseudo-class·pseudo-element, media/support/container query, cascade layers, CSS 변수 변경, transform·clip·stacking, image sizing, transitions·animations | 상태 변경과 화면 크기 변경 뒤 선택자·cascade·layout·paint가 일관된 revision에서 갱신되고 취소·제거된 스타일 자원이 재사용되지 않는다. |
| P3 · 고급 CSS | 표·float·다단, 쓰기 모드·logical properties, advanced Grid, SVG·폼 외형, filters·masks·blend·containment 및 at-rule 확장 | 각 기능군의 표준·Chromium fixture와 미지원 진단이 정리되고 Android·iOS 차이가 적합성 자료에 남는다. |
| P4 · 100% 갭 종료 | 고정한 Chromium 기능 inventory 전체, 속성·값 조합·선택자·상태·동적 갱신 회귀, 성능·메모리·OTA 청크 경계 | 기준 inventory의 CSS 동작 차이가 모두 닫히고, 웹·Android·iOS 전체 적합성 묶음과 근거가 저장된다. 차이가 남아 있으면 100% 완료가 아니다. |

우선순위는 모바일 우선의 작업 순서이며 최종 범위 제외 목록이 아니다. 웹 호환성은 포기하지 않으며, 웹 빌드는 기준 동작과 작성 코드 호환을 확인하는 경로로 둔다. 모든 C 작업은 구현 전에 비교 모델을 준비한다. 비교 모델에는 기준 oracle, 재현 fixture와 실행 환경, 관찰 출력, 허용 오차·실패 규칙이 들어간다. CSS 외 다른 기능도 같은 원칙을 따르며 공통 규칙은 [구현 전 비교 모델](../../spec/0001-conformance.md#구현-전-비교-모델)에 둔다. 기준 Chromium 버전이 바뀌면 기능 inventory를 버전별로 다시 만들고 신규·변경·삭제된 동작을 분류한다.

## 의존성과 병렬 작업 경계

1. R03의 내부 `HostDocumentSnapshot`이 C03 adapter의 입력이다. 기존 S01 `Tree`를 직접 연결하지 않는다. 현재 HostDocument는 혼합 노드·속성·namespace·상태·revision을 갖고 Stylo DOM·selector trait adapter와 연결됐지만, V8 DOM façade와 계산 스타일은 없다.
2. C03 DOM traversal·namespace adapter와 selector matcher fixture는 완료했다. C04.1은 제한 cascade fixture를, C04.2는 제한 Flex fixture의 computed-style→Taffy 연결을 검증한다. 둘 다 제품 runtime 연결이 아니다. 일반 CSS와 첫 화면 판정은 C01 comparator 및 C02 bundle CSS resource 계약을 통과한 입력으로 확장한다.
3. `C02`의 CSS 자원 추출 실험과 `C01`의 Chromium fixture 형식은 서로 독립적이다. 기능 진입점→CSS·폰트·이미지 의존 그래프의 최종 직렬화는 R15·X01·D02의 매니페스트 계약을 따른다.
4. C02.2의 Vite·Rspack adapter는 [0014](../../spec/internal/0014-c02-bundler-module-graph.md)의 동일 snapshot 검증기와 R15 투영 규칙을 사용한다. 각 어댑터는 별도 fixture/output 디렉터리를 소유하고, 공용 contract·validator·비교 fixture·상태 대장은 하나의 변경 주체만 수정한다. 실패 profile은 성공 graph로 승격하지 않는다.
5. `C05` 스타일 무효화, `C06` 값·단위, `C07` box model이 정해진 뒤 `C08`~`C14` layout adapter를 진행한다. layout 입력 자료형과 invalidation boundary가 고정된 뒤 Flex·Grid·positioning 알고리즘을 분리해 진행한다.
6. `C15`~`C19` 텍스트·페인트 작업은 같은 computed-style snapshot과 revision 계약을 사용한다. 텍스트 측정과 GPU painter는 레이아웃 속성 변환과 독립적으로 개발할 수 있지만, 공통 fixture를 합칠 때만 완료를 판정한다.
7. 반응형·상태 선택자·애니메이션은 frame scheduling과 CSS invalidation 순서에 의존하므로 `C20`~`C25` 구현 전에 상태 변경·스타일 갱신·GPU 제출의 revision 순서를 고정한다.

병렬 작업 중 공용 DOM trait, computed-style snapshot, Taffy node ID와 CSS 자원 revision을 여러 작업이 동시에 바꾸지 않는다. 각 인터페이스는 선행 작업 하나가 소유하고, 병렬 작업은 버전이 있는 내부 계약에 맞춘다.

## CSS 처리 경계

1. Vite·Rspack은 CSS 입력과 모듈·에셋·원본 위치·JS 청크별 CSS 의존성을 추적한다. CSS 노드는 번들 내 `@import`와 stylesheet 기준 URL로 해석된 로컬 `url()` 폰트·이미지에 타입 있는 그래프 edge를 갖는다. `data:` 자원은 포함된 CSS 콘텐츠 해시에 속하고, JS 런타임이 생성하는 inline style·CSS 규칙은 그 JS 청크에 포함한다. 외부 네트워크 CSS `@import`·`url()` 로더는 미구현이며 현재 모바일은 요청하지 않고 미지원으로 진단한다. 웹 산출물은 브라우저의 CSS 엔진을 사용한다. 모바일은 해당 릴리스 snapshot의 번들 CSS 자원을 Stylo에 전달하며, 문서 트리와 CSS 자원은 `spinon-style`에서 합쳐진다. 릴리스 산출물은 [빌드·OTA 계약](../../spec/0004-runtime-build.md)과 세부 그래프 정책 [OTA 설계](../ota-design.md)를 따른다.
2. Stylo는 스타일 문법 해석과 선택자·cascade·상속·computed style의 기준이다. C03은 `spinon-style`에서 R03 snapshot을 DOM·selector trait으로 제공한다. C04.1·C04.2는 고정 fixture 내부 경로이며 제품 runtime의 계산·레이아웃·GPU 연결을 하지 않는다. DOM adapter나 자원이 존재한다는 사실만으로 제품 스타일 지원을 완료 처리하지 않는다.
3. `spinon-style-to-layout`은 computed-style profile과 문서 revision을 검증하고 지원하는 값만 layout 입력으로 바꾼다. `spinon-layout`은 CSS 문법을 해석하지 않고 Taffy 또는 확장 알고리즘을 호출한다. layout algorithm이 처리하지 못하는 속성을 CSS 엔진에서 계산됐다는 이유로 지원 처리하지 않는다.
4. layout은 텍스트·이미지 자원에 측정을 요청하고 결과를 받아 geometry와 줄 배치를 계산한다. 배치된 glyph와 geometry는 GPU 장면으로 전달한다. 합성 측정 결과와 실제 플랫폼 글꼴 결과를 분리해 검증한다.
5. `spinon-render`는 layout이 아닌 페인트 속성과 합성 규칙도 GPU 장면으로 변환한다. box-shadow 등 페인트 결과를 Taffy style에 넣지 않는다.
6. Lightning CSS는 CSS import·CSS Modules·최적화 및 의미 변환 후보로만 평가한다. 모바일의 CSS 파싱·selector·cascade·computed style 소유자는 Stylo다. 의미를 바꾸는 prefix 변환·속성 제거·색상 축약은 Stylo와 Chromium 비교를 통과하기 전까지 모바일 산출 경로에 포함하지 않는다.

Tailwind는 별도 모바일 렌더러가 아니다. 빌드 시 생성된 CSS가 C02의 공통 CSS 산출 경로로 들어오며, 유틸리티가 사용하는 선택자·선언·값·변수·계층을 모바일에서 각각 지원할 때만 해당 유틸리티를 같은 동작으로 판정한다. Tailwind 생성 CSS의 선택자·변수·`@layer`·Preflight는 R14 실험에서 작은 fixture로 확인하고 U01에서 빌드 경로로 확장한다. Preflight·테마·반응형 및 상태 변형은 별도 적합성 사례로 남긴다. 세부 대응 범위는 [웹 표면 명세의 Tailwind 계약](../../spec/0003-web-surface.md)을 따른다.

CSS stylesheet 교체는 JS 모듈과 동일한 릴리스 snapshot·청크 의존성에 포함한다. HMR은 개발 계획, OTA는 [청크 OTA 설계](../ota-design.md)에 따르며 오래된 스타일시트가 새 트리 revision에 섞이지 않도록 자원 세대를 검증한다.

## 구현 전에 고정할 세부 기준

- 웹 oracle로 실행할 Chromium의 정확한 revision/build·OS 이미지·플래그와 업데이트 주기, 다른 웹 엔진을 지원 대상으로 추가할 때의 별도 행렬, CSSWG/WPT fixture 버전
- fixture별 viewport·device scale·locale·글꼴 집합·미디어 및 사용자 선호 상태
- 지원 HTML·SVG 노드와 Chromium UA 기본 stylesheet의 범위; 내장 구조 규칙 초안은 [`spinon-style`](../../crates/spinon-style/resources/ua/supported-elements-v0.css)에 있지만 C01 기준 버전과 비교 전에는 Chromium 일치로 간주하지 않는다. 폼 컨트롤의 OS별 외형은 별도 프로필로 남긴다.
- 속성·값·선택자·at-rule 단위의 안정된 feature ID, 지원 노드 프로필, 자동 fixture 입력·기대값·fixture별 허용 오차 형식
- `@import` 번들 자원의 기준 URL, `media`·`supports`·`layer` 순서, 순환·실패; 외부 URL 로더는 미구현이며 재검토 시 URL·출처·캐시·취소·오류·R12/J06 보안 경계를 별도 계약으로 결정
- CSS 파싱/계산/레이아웃/페인트/동적 적용 단계별 오류와 원본 source map 위치
- CSS px, device scale, safe area, viewport·font·container 기준과 반올림 시점
- 실제 글꼴 로딩·fallback·shaping·emoji·RTL과 플랫폼별 폰트 차이 기록 방식
- Taffy가 다루지 못하는 기능을 추가 알고리즘으로 연결할 조건과 유지보수 비용 판정
- 기능 진입점에서 JS 청크·CSS stylesheet·폰트·이미지로 이어지는 공유 의존 그래프와 자원 revision을 앱 코드와 원자적으로 활성화하는 계약

## 검증 계획

새 CSS feature는 기능명만으로 완료하지 않는다. 각 fixture는 입력 HTML·CSS, 기준 Chromium 버전, 기대 selector match·computed style·geometry·GPU 캡처·이벤트 상태, 플랫폼, 명시적 허용 오차, 실패 진단을 보관한다.

비교 결과는 세 층으로 판정한다.

1. **CSS 의미:** selector match 집합, cascade 승자와 정규화한 computed value를 비교한다. 원소·선언 누락이나 잘못된 값은 시각 점수로 상쇄하지 않는다.
2. **레이아웃:** 각 노드의 `x/y/width/height`, 줄 상자·baseline과 scroll extent를 CSS px로 측정한다. fixture별 `max(|Δx|, |Δy|, |Δwidth|, |Δheight|)`를 주 판정값으로 두고, 평균 오차는 원인 분석용으로만 기록해 하나의 크게 틀린 노드를 가리지 않게 한다. 좌표 비교는 [CSSOM View의 CSS px 정의](https://drafts.csswg.org/cssom-view-1/#css-pixels)를 따른다.
3. **GPU 이미지:** 같은 CSS viewport와 명시한 raster scale로 캡처해 픽셀 채널 차이의 최대값과 허용 범위를 벗어난 픽셀 수/비율을 함께 기록한다. antialias·글꼴 래스터 차이는 별도 분류하고, 허용 범위는 [WPT reftest의 fuzzy 비교](https://web-platform-tests.org/writing-tests/reftests.html)처럼 fixture별로 한정한다. 화면을 임의로 확대·축소해 맞추지 않는다.

한계값은 동일 입력을 반복 실행해 계측 노이즈를 확인한 뒤, 플랫폼·기능 fixture별로 실행 전에 고정한다. 테스트 실패 뒤 한계만 넓혀 통과시키지 않는다. Chromium 비교와 Android/iOS 간 GPU 회귀 캡처는 분리해 기록한다. 합성 텍스트 테스트는 실제 글꼴 테스트를 대체하지 않는다.

한 속성의 단일 값 통과는 전체 속성 지원을 뜻하지 않는다. 상속·percentage reference·writing direction·상태 변화·부모 크기 변경·스타일 제거·동일 프레임 갱신을 함께 고려한다. CSS 지원 체크를 완료로 바꿀 때는 [구현 상태 대장](../../spec/STATUS.md)의 해당 ID, 공개 CSS 계약·예제, 웹·Android·iOS 적합성 자료를 같은 변경에 반영한다.
