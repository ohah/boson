# CSS 변환 → 레이아웃 실험

Lightning CSS 1.33.0이 CSS를 AST로 읽고, 지원하는 값만 `styles.json`으로 변환합니다. Rust 프로그램은 그 데이터를 읽어 `LayoutEngine` 경계 뒤의 Taffy 0.14.0으로 좌표를 계산합니다. 아래 R10 실행 경로는 개발용 Android/iOS 앱에만 연결하는 실험이며 제품 코어·V8 UI 트리·GPU 렌더러에 연결되지 않았습니다.

```sh
cd spikes/style-layout
mise exec -- bun install --frozen-lockfile
mise exec -- bun run build:styles
mise exec -- cargo run
mise exec -- bun run verify
mise exec -- cargo test --locked
mise exec -- cargo run --release -- --r10 402 874 3
```

현재 샘플 결과는 루트 `(0, 0, 320, 240)`, 자식 `(16, 16, 288, 208)`입니다. `flex-grow: 1` 때문에 자식은 남은 세로 공간을 채웁니다.

`--r10`은 화면 논리 크기와 배율을 받아 안정 외부 노드 ID, 고정 텍스트 측정 fixture, LTR/RTL Flex 방향, Taffy 기본 반올림과 배율별 물리 픽셀 반올림, 단일 카드 스타일 갱신과 전체 트리 재생성 비용을 출력합니다. `--spinon-r10` 앱 시작 인수는 아래 실험 빌드에서 같은 경로를 실행하고 OS 로그에 결과를 남깁니다. 기본 앱 빌드에는 Taffy 실험 코드가 들어가지 않습니다. 텍스트 폭과 줄 높이는 실제 CoreText/Android 글꼴 측정값이 아니라 측정 콜백을 확인하기 위한 합성 입력입니다.

```sh
SPINON_ENABLE_R10_EXPERIMENT=1 mise exec -- bun run build:ios-sim
SPINON_ENABLE_R10_EXPERIMENT=1 mise exec -- bun run build:android
```

기본 빌드에서 실험 인수로 앱을 시작하면 `spinon_taffy_r10_run`이 기능 비활성 상태를 반환합니다. 이 C 경계는 검증 기록에 기술되어 있으며 공개 앱 API가 아닙니다.

지원 범위는 단일 클래스 선택자, `display: flex`, 행/열 방향, 픽셀 단위의 너비·높이·패딩·간격, `flex-grow`입니다. 미지원 문법은 변환 과정에서 오류로 처리합니다. 중복 규칙, 선택자 우선순위, 상속, 변수, 반응형 규칙은 아직 없습니다. 실험 결과만으로 웹 CSS 동등성이나 실기기 성능을 주장할 수 없습니다.

다음 연결 단계에서는 이 스타일 데이터를 스피논 노드 ID와 결합하고, 플랫폼 텍스트 측정 및 변경 노드만 다시 계산하는 경로를 확인합니다.
