# Spinon

Spinon은 웹과 유사한 개발 경험으로 모바일 앱을 만드는 멀티플랫폼 UI 프레임워크 실험입니다. 공통 UI 코어는 Rust, 모바일 주 화면은 GPU 렌더러로 구현하기로 결정했습니다. 공개 API와 GPU 구현 기술은 아직 확정되지 않았습니다.

공개 동작의 첫 규범 문서: [스피논 명세 0.1 초안](spec/README.md). 현재 명세는 구현 완료 또는 스토어 배포 가능성을 뜻하지 않습니다.

공식 진행 상태: [78개 구현 항목 체크리스트](spec/STATUS.md) · [지원 완료 API 명세](spec/api/README.md). 완료 항목에는 API/인터페이스 명세와 동작 근거가 필요합니다.

웹 문서: [스피논 API 문서](https://ohah.github.io/spinon/). `spec/` Markdown을 Rspress로 정적 생성하며, 명세·구현 상태와 API 목록을 웹에서 검색할 수 있습니다. 작업 중 미리보기는 [Tailscale 문서 페이지](https://macstudio.tailed42f2.ts.net/spinon/docs/)입니다.

문서 생성기의 `@rspress/core`는 `2.0.22`에 고정합니다. 스피논의 첫 공식 릴리스 전에는 RSPress를 업데이트하지 않습니다.

```sh
bun install --frozen-lockfile
bun run docs:dev
bun run docs:build
```

정식 사이트는 GitHub Pages에 배포합니다. `main`에 문서 변경이 반영되면 GitHub Actions가 새 HTML을 생성해 게시합니다. `packages/docs/rspress.config.ts`의 기본 경로는 `/spinon/`입니다.

화면 이동과 딥링크의 공통 의미: [라우팅 명세](spec/0006-routing.md)

구현 경계와 순서: [Rust 코어 아키텍처 결정](docs/architecture.md)

변경된 청크·에셋만 전송하는 기능별 OTA 목표: [청크 기반 OTA 설계](docs/ota-design.md)

프로젝트 명령과 에이전트용 진단 인터페이스: [CLI·MCP 설계](docs/cli-mcp.md)

앱 코드의 태그·속성·이벤트 기준: [작성 문법 초안](docs/authoring-contract.md)

웹 태그·CSS와 JavaScript API 대응표: [HTML·CSS 명세](https://macstudio.tailed42f2.ts.net/spinon/compatibility.html), [JS API 명세](https://macstudio.tailed42f2.ts.net/spinon/js-api.html)

첫 번째 언어 선택 실험: [V8 연동 비교](spikes/v8-language-bridge/README.md)

CSS 빌드 변환과 Taffy 레이아웃의 최소 연결: [스타일·레이아웃 실험](spikes/style-layout/README.md)
