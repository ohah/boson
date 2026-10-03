# S04 첫 CSS 배경색 fixture

`flex-paint.v1.json`은 fixture ID·viewport·HostDocument 문자열 ID 순서·author 색상·GPU readback sample row와 비교 기준을 소유합니다. CSS 원문은 `flex-paint.v1.css`입니다. Chromium computed-style·relative geometry 기준은 `tests/fixtures/css/references/`에 별도 고정합니다. Android API 36 에뮬레이터 S04.4와 iOS 26.2 시뮬레이터 S04.5에서 각 GPU surface 제출과 고정 42개 sRGB RGBA 표본 readback을 확인했습니다. 두 시뮬레이터 결과는 실기기 GPU·성능 결과가 아닙니다.

이 fixture는 부모 1개와 자식 3개의 분수 Flex 배치에 불투명 CSS `background-color`를 연결합니다. 기존 C04.2 v1 fixture와 reference를 수정하지 않습니다. 태그별 네이티브 View, 일반 CSS 지원, 텍스트, 입력 이벤트, 제품 앱 runtime 또는 GPU 표시 완료를 뜻하지 않습니다.

```sh
mise exec -- bun run css:reference:s04
```

캡처 도구는 고정 viewport·device scale factor·media preference로 로컬 Chromium을 실행합니다. 자식 순서, 지원 computed property, 샘플 행, 좌표 오차·색상 판정 조건이 fixture와 다르면 실패합니다. 새 결과 파일이 이미 있으면 덮어쓰지 않으며, reference를 갱신할 때 기존 자료를 먼저 보존하고 계약 및 비교 기준을 갱신합니다. 재현 출력을 별도 디렉터리에 만들 때는 `SPINON_REFERENCE_OUTPUT_DIR=/tmp/s04-reference mise exec -- bun run css:reference:s04` 형식을 사용합니다. `width`와 `height`는 Chrome의 used value와 Stylo의 pre-layout computed value가 다르므로 문자열 대조에서 제외하고, 최종 geometry를 별도로 비교합니다.
