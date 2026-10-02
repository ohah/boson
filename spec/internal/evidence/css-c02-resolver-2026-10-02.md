# C02.1 · Vite·Rspack CSS resolver 비교

**결과:** C02 M1~M9 통과 · **범위:** fixture resolver 실험 · **C02 제품 구현:** 미완료

Vite·Rspack의 production 빌드에서 alias와 package `exports`가 선택한 CSS 입력이 실제 산출 CSS와 공통 snapshot에 연결되는지 확인했다. 새 fixture는 alias stylesheet `src/alias/theme.css`, `@fixture/theme` package export stylesheet, 그 stylesheet가 상대 `@import`한 `tokens.css`를 포함한다. package template은 `spikes/css-bundler/package-fixtures/`에 추적하고, 비교 실행 시 fixture의 `node_modules/`로 복사한다. 생성된 실제 package 파일은 전체 fixture digest에 포함된다.

## 환경과 실행

- macOS arm64, Node.js `24.20.0`, Bun `1.4.2`
- Vite `8.3.1`, Rspack `2.2.7`, PostCSS `8.5.28`, `postcss-value-parser` `4.2.0`
- 실행: `mise exec -- bun install --frozen-lockfile`, `mise exec -- bun run compare`, `mise exec -- bun run test`
- 입력 fixture 22개 파일. 원본 경로·크기·SHA-256 및 양쪽 전체 snapshot은 [실행 JSON](./css-c02-bundler-2026-10-02.json)에 기록했다.

## 판정

| 비교 조건 | 결과 | 관찰 |
| --- | --- | --- |
| M1~M8 기존 산출·CSS Module·에셋·chunk·진단 조건 | 통과 | 이전 C02 fixture의 모든 조건을 확장된 같은 빌드에서 다시 통과했다. |
| M9 alias CSS | 통과 | Vite transform hook과 Rspack stats 모두 `src/alias/theme.css`를 native CSS module로 관찰했다. 두 snapshot은 이 파일을 정확히 한 번 수집하고 entry CSS에 `alias-css` marker와 출력 resource 연결을 기록했다. |
| M9 package exports CSS | 통과 | Vite transform hook과 Rspack stats 모두 `@fixture/theme/theme.css`가 선택한 `node_modules/@fixture/theme/dist/theme.css`를 native CSS module로 관찰했다. Rspack stats는 상대 `tokens.css` edge도 확인했다. 두 snapshot은 theme·tokens 파일을 정확히 한 번 수집했고 entry CSS에 연결했다. `package-export-css`, `package-css-import` marker가 산출 CSS에 남았다. |
| 공통 snapshot 경로·참조 검증 | 통과 | package 파일을 포함한 모든 입력·자원 경로가 fixture 상대 POSIX 경로로 남았고 snapshot 참조 검증을 통과했다. |

Vite snapshot은 `assets/index-33ooq19t.css`, Rspack snapshot은 `assets/main-4f1fcee2f0886748.css`를 entry CSS 출력으로 연결했다. 파일명은 빌드 해시에 따라 달라질 수 있으며 비교 식별자로 사용하지 않는다. 비교기는 source path 문자열만 확인하지 않고 두 빌드의 최종 entry CSS에 marker가 있는지도 확인한다.

## 한계

이 결과는 alias/package CSS 입력을 fixture 내에서 찾는 production resolver 동작과 현재 수집기의 snapshot 보존만 증명한다. fixture 밖 `node_modules`, symlink package, plugin virtual module, query별 ID, package exports 조건 조합, 임의 사용자 설정 조합을 검증하지 않았다. 제품 패키지/API, 최종 기능별 자원 graph 직렬화, CSS 런타임 적용, 모바일 자원 로더, OTA 설치·활성화, 화면 렌더링도 범위 밖이다. 따라서 C02 전체는 미완료다.
