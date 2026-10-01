# Chromium CSS 기준 수집기

외부 JavaScript 패키지 없이 Node.js 내장 WebSocket으로 Chrome DevTools Protocol(CDP)을 제어해 C01 HTML fixture의 관찰값을 수집합니다. 스크립트는 Chromium 버전·revision·실행 파일 SHA-256·수집기와 Node.js 버전·OS·viewport·배율·locale·time zone·미디어 상태·fixture와 CSS 자원 SHA-256을 결과와 함께 저장합니다.

저장소의 `mise.toml`이 지정한 Node.js 24.20.0 이상과 로컬 Chromium 설치가 필요합니다. 브라우저 자동화 패키지는 추가하지 않습니다.

```sh
node tools/css-reference/capture.mjs
```

표준 macOS·Linux 설치 경로를 검색합니다. 다른 실행 파일을 사용할 때는 `SPINON_CHROMIUM_BIN`에 절대 경로를 지정합니다. reference-id는 실행 파일이 보고한 전체 버전과 비교 프로토콜 버전을 포함하고 기존 파일은 덮어쓰지 않습니다. CSS 프로필 해시와 feature ID 목록도 고정하므로 CSS 자원이 바뀌면 수집을 중단합니다. 같은 버전을 다시 수집하거나 프로필을 바꾸려면 결과를 직접 교체하지 말고 새 프로필·reference-id 정책을 먼저 정합니다.

수집기는 Chromium 기본값을 먼저 저장한 뒤 서로 다른 값의 author baseline과 내장 프로필을 순서대로 적용합니다. baseline을 덮은 프로필의 computed CSS 값 19개를 비교하고, 9개 fixture selector와 node ID는 별도 입력 무결성으로 검사합니다. baseline을 덮지 못하는 선언은 불일치로 실패합니다. UA cascade origin, 레이아웃·글꼴 shaping·GPU 픽셀 비교와 모바일 적합성은 아직 수행하지 않습니다. 결과 추가는 [C01](../../spec/STATUS.md) 전체 완료가 아닙니다.
