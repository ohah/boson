# Chromium CSS 기준 수집기

외부 JavaScript 패키지 없이 Node.js 내장 WebSocket으로 Chrome DevTools Protocol(CDP)을 제어해 C01 HTML fixture의 관찰값을 수집합니다. 스크립트는 Chromium 버전·revision·실행 파일 SHA-256·수집기와 Node.js 버전·OS·viewport·배율·locale·time zone·미디어 상태·fixture와 CSS 자원 SHA-256을 결과와 함께 저장합니다.

저장소의 `mise.toml`이 지정한 Node.js 24.20.0 이상과 로컬 Chromium 설치가 필요합니다. 브라우저 자동화 패키지는 추가하지 않습니다. 비교 feature는 [`inventory.v1.json`](../../tests/fixtures/css/c01/inventory.v1.json)에서 읽으며, 현재 seed 범위는 9개 HTML 요소와 19개 computed CSS 값입니다.

```sh
node tools/css-reference/capture.mjs
```

표준 macOS·Linux 설치 경로를 검색합니다. 다른 실행 파일을 사용할 때는 `SPINON_CHROMIUM_BIN`에 절대 경로를 지정합니다. reference-id는 브라우저 전체 버전, 캡처 프로토콜 버전, inventory SHA-256 일부를 포함하고 기존 파일은 덮어쓰지 않습니다. inventory schema·안정 ID·selector별 node ID 중복 여부와 CSS 프로필 해시를 검증합니다. 서로 다른 selector의 결과 집합은 같은 node ID를 포함할 수 있습니다. 결과에는 캡처 스크립트와 inventory validator 모듈의 SHA-256도 기록합니다. 같은 버전을 다시 수집하거나 프로필을 바꾸려면 결과를 직접 교체하지 말고 새 프로필·reference-id 정책을 먼저 정합니다.

수집기는 Chromium 기본값을 먼저 저장한 뒤 서로 다른 값의 author baseline과 내장 프로필을 순서대로 적용합니다. baseline을 덮은 프로필의 computed CSS 값과 selector·예상 node ID는 machine-readable inventory에서 읽어 정확히 비교합니다. baseline을 덮지 못하는 선언은 불일치로 실패합니다. UA cascade origin, 레이아웃·글꼴 shaping·GPU 픽셀 비교와 모바일 적합성은 아직 수행하지 않습니다. 결과 추가는 [C01](../../spec/STATUS.md) 전체 완료가 아닙니다.

inventory 단위 검증은 `mise exec -- bun run test:css-reference`로 실행합니다. 전체 기본 테스트 명령 `bun run test`에도 포함됩니다.

## C04 기본 cascade 기준 수집

`cascade-input.v1.json`이 문서 트리·관찰 속성·stylesheet 목록과 순서·viewport를 정합니다. capture 도구는 그 입력에서 HTML을 만들고 Chromium DevTools Protocol로 `800×600` CSS px, scale `1`, `screen`, light, `en-US`, `UTC`를 고정합니다. 렌더러 네트워크를 오프라인으로 설정해 외부 자원이 기준 결과에 섞이지 않게 합니다. 브라우저 실행 파일·revision, fixture·stylesheet·도구의 SHA-256, Node.js·OS 버전 및 16개 요소의 computed style을 reference JSON에 기록합니다. reference ID에는 캡처 도구와 브라우저 실행 파일의 해시 접두부를 포함합니다.

```sh
mise exec -- node tools/css-reference/capture-c04-cascade.mjs
```

기존 reference 경로는 덮어쓰지 않습니다. 이 기준은 CSS 의미의 제한된 cascade slice만 비교하며 layout·font shaping·GPU pixels·Android/iOS 동작이나 전체 CSS 지원을 뜻하지 않습니다. 계산 결과 비교는 `mise exec -- cargo test -p spinon-style`에서 같은 fixture와 고정 reference를 읽어 수행합니다.

## C01 레이아웃 기준 수집

`layout-units-flex-grid.html`과 [`layout-inventory.v1.json`](../../tests/fixtures/css/c01/layout-inventory.v1.json)은 `rem`·`em`, content-box 기준 퍼센트 크기, 분수 Flexbox 성장·줄바꿈, 분수 Grid track의 Chromium 기준을 정의합니다. computed CSS 값은 앞뒤 공백 제거 후 문자열 정확 일치로 비교하고, 각 노드의 `x`·`y`·`width`·`height` 최대 절대 오차는 각각 `0.5 CSS px`로 제한합니다. 평균값으로 개별 노드의 실패를 상쇄하지 않습니다.

```sh
node tools/css-reference/capture-layout.mjs
```

이 수집기는 Chromium revision·바이너리 해시·OS·viewport·locale·미디어 상태와 fixture/inventory 해시를 JSON 스냅샷에 기록합니다. 기존 스냅샷은 덮어쓰지 않습니다. 현재 결과는 기준 데이터이며 Spinon 레이아웃 구현과의 비교나 CSS 기능 지원 판정이 아닙니다. 텍스트 shaping, GPU 픽셀, Android·iOS 측정은 포함하지 않습니다.
