# Chromium CSS 기준 수집기

외부 JavaScript 패키지 없이 Node.js 내장 WebSocket으로 Chrome DevTools Protocol(CDP)을 제어해 C01 HTML fixture의 관찰값을 수집합니다. 스크립트는 Chromium 버전·revision·실행 파일 SHA-256·OS·viewport·배율·locale·time zone·미디어 상태·fixture 및 CSS 자원 SHA-256을 결과와 함께 저장합니다.

저장소의 `mise.toml`이 지정한 Node.js 24.20.0 이상과 로컬 Chromium 설치가 필요합니다. 브라우저 자동화 패키지는 추가하지 않습니다.

```sh
node tools/css-reference/capture.mjs
```

표준 macOS·Linux 설치 경로를 검색합니다. 다른 실행 파일을 사용할 때는 `SPINON_CHROMIUM_BIN`에 절대 경로를 지정합니다. reference-id는 실행 파일이 보고한 전체 버전을 포함하고 기존 파일은 덮어쓰지 않습니다. 같은 버전을 다시 수집하려면 결과 파일을 직접 교체하는 대신 그 이유와 새 실행 환경을 검토해 별도 reference-id 정책을 먼저 정합니다.

현재 fixture는 Chromium에서 HTML UA 규칙의 selector match와 computed value만 캡처합니다. 레이아웃·글꼴·GPU 픽셀 비교와 모바일 적합성은 아직 수행하지 않습니다. 따라서 결과 추가는 [C01](../../spec/STATUS.md) 전체 완료가 아닙니다.
