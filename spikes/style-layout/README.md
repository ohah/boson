# CSS 변환 → 레이아웃 실험

Lightning CSS 1.33.0이 CSS를 AST로 읽고, 지원하는 값만 `styles.json`으로 변환합니다. Rust 프로그램은 그 데이터를 읽어 `LayoutEngine` 경계 뒤의 Taffy 0.14.0으로 두 노드의 좌표를 계산합니다. 이 코드는 독립 실험이며 Android/iOS 호스트나 V8 트리에 아직 연결되지 않았습니다.

```sh
cd spikes/style-layout
mise exec -- bun install --frozen-lockfile
mise exec -- bun run build:styles
mise exec -- cargo run
mise exec -- bun run verify
mise exec -- cargo test --locked
```

현재 샘플 결과는 루트 `(0, 0, 320, 240)`, 자식 `(16, 16, 288, 208)`입니다. `flex-grow: 1` 때문에 자식은 남은 세로 공간을 채웁니다.

지원 범위는 단일 클래스 선택자, `display: flex`, 행/열 방향, 픽셀 단위의 너비·높이·패딩·간격, `flex-grow`입니다. 미지원 문법은 변환 과정에서 오류로 처리합니다. 중복 규칙, 선택자 우선순위, 상속, 변수, 반응형 규칙, 텍스트 측정, 부분 갱신은 아직 없습니다. 따라서 이 결과만으로 웹 CSS 호환이나 모바일 성능을 판단할 수 없습니다.

다음 연결 단계에서는 이 스타일 데이터를 스피논 노드 ID와 결합하고, 플랫폼 텍스트 측정 및 변경 노드만 다시 계산하는 경로를 확인합니다.
