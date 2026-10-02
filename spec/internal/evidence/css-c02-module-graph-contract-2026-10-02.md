# C02.2 · 공통 모듈 그래프 계약 검증기

**일자:** 2026-10-02 · **상태:** 내부 스파이크 · **제품 지원:** 없음

## 범위

0014 draft를 소비하는 Vite·Rspack 공통 snapshot 정규화·검증 함수를 `spikes/css-bundler/module-graph-contract.mjs`에 구현했다. 이 결과는 C02 전체 완료나 R15 OTA 실행 가능성을 뜻하지 않는다. 이 증거는 공통 검증기만 대상으로 하며 Vite·Rspack collector의 입력 graph 완전성과 출력 적합성은 별도 fixture에서 검증한다.

공통 모듈은 다음을 제공한다.

- `createModuleGraphSnapshot` — snapshot 복사·정규화 전에 JSON data tree를 검사해 getter, 순환 참조, 숨은 필드, symbol, 희소 배열과 비 JSON 객체를 거부한다. 닫힌 build/feature/source/output graph 형식, build profile hash, ID·count·membership·module format·edge 충돌·resource 참조와 진단을 검증하고 정규 순서로 반환한다.
- `assertModuleGraphSnapshot` — 이미 만들어진 snapshot의 계약 불변식을 확인한다. 누락된 `contract`만 draft 기본값을 쓰며 명시한 `null`과 알 수 없는 필드는 거부한다. output edge는 중복 제거 전에 각 edge schema를 검사하며 모든 공개 입력 경계는 accessor·순환·비JSON 값을 읽기 전에 거부한다.
- `computeSourceGraphSha256` — 필수 필드와 관계를 검사한 뒤 source graph의 정규 JSON을 UTF-8 SHA-256으로 계산한다. snapshot 검사 시 저장된 digest를 재계산한다.
- `computeBuildProfileSha256` — 설정·adapter·package/lock 입력 파일의 경로별 SHA-256과 실제 적용 옵션을 정규 JSON SHA-256으로 계산한다.
- `parseEmittedEsm` — Acorn으로 최종 JS 바이트를 ESM AST로 분석하고 static import/re-export/literal dynamic import를 추출한다. 문법 분석 실패와 읽을 수 있지만 표현할 수 없는 import attribute·option·계산형 dynamic import를 다른 진단 코드로 반환한다.
- `resolveLocalOutputPath`·`resolveEmittedChunkTarget` — emitted literal 상대 specifier가 정확히 한 실제 JS resource/chunk에 연결되는지 확인한다. bare·외부·query/fragment·잘못된 인코딩·encoded separator·root traversal은 추측하지 않고 미해결로 둔다.
- `assertR15JavaScriptGraphInput` — 성공·완전 JavaScript graph만 허용하고, 안정성이 증명되지 않은 chunk/resource identity가 있으면 앱 전체 영향 범위 fallback을 요구한다. 항상 0011 자원 graph join이 필요하다고 표시하며 전체 R15 적격을 판정하지 않는다.

Unicode 정렬은 locale 및 UTF-16 코드 단위 순서에 의존하지 않고 코드 포인트 순서를 사용한다. source/output graph는 각각의 관찰 근거를 가진 독립 graph다. R15 edge는 final ESM AST만으로 만들며 입력 import와 출력 edge의 일대일 대응이나 tree-shaking 결과를 추측하지 않는다.

## 실행 검증

명령: `mise exec -- node --test` (`spikes/css-bundler`에서 실행)

환경: Node.js `v24.20.0`, Bun `1.4.2`, Acorn `8.18.0`, Vite `8.3.1`, Rspack `2.2.7` (`mise` 및 lockfile 고정).

공통 helper와 기존 CSS adapter의 scoped suite는 **70 passed, 0 failed** — CSS adapter 11개와 graph contract 59개다. graph fixture는 digest 변조·정규 JSON·Unicode 경계 정렬·profile 및 개별 설정 파일 hash 변경·안전한 정수 byte 수와 source 위치·명시적 null·닫힌 필드·source/resource 경로 traversal·exact emitted target·중복 target ambiguity·resource/chunk 안정 ID·R15 영향 범위 fallback·entry 도달성·순환·external edge·계산형 import·import attribute·최종 ESM AST를 검사한다. 추가 회귀는 중복 emitted edge schema 우회, 공개 helper의 getter 입력, warning으로 낮춘 blocking 진단, 미정의 hash metadata, 빠졌거나 중복된 resolver ID를 막는다. 미해결 stylesheet·asset edge 거부, 0011 join 의무, URL 디렉터리 path 거부도 검사한다.

최종 통합 worktree에서 CSS/resource·공통 graph contract·Vite·Rspack을 포함한 `mise exec -- bun run test` suite는 **130 passed, 0 failed**다. 전용 adapter 결과와 환경·profile·fixture·resource digest는 [Vite 근거](css-c02-vite-module-graph-2026-10-02.md)와 [Rspack 근거](css-c02-rspack-module-graph-2026-10-02.md)에 기록한다. Vite와 Rspack evidence capture도 공통 validator hardening을 포함한 최종 통합 코드에서 다시 실행했다.

최종 source 추적 해시: `module-graph-contract.mjs` SHA-256 `6e5cf5924a4c1b6aed863f858190d767a0967a097cefef8a3e615b186017e2a6`; `module-graph-contract.test.mjs` SHA-256 `e5044f20a1b130b3f675b6caddd63759803132abde4667becf78412fbd28fdf5`.

## 경계와 남은 증명

- 공통 검증기는 adapter가 `complete`를 거짓으로 표기하는 것을 독립적으로 판별하지 않는다. 각 번들러의 capture API·관찰 수·원본 fixture digest와 재현 가능한 profile을 adapter evidence로 확인해야 한다.
- source dependency edge와 emitted output edge는 tree-shaking·inlining·변환 때문에 일대일이 아닐 수 있다. R15는 입력 graph에서 edge를 만들지 않으며 final output AST에서 관찰한 graph만 사용한다. 각 adapter가 두 graph를 끝까지 수집했다는 근거는 별도로 검토해야 한다.
- Vite·Rspack graph collector의 capture API·관찰 수·source fixture digest와 emitted bytes는 각 adapter evidence에서 별도로 확인한다. 현재 결과는 고정 fixture·tool profile 스파이크에 한정되고 임의 plugin·전체 CSS/asset graph·다른 OS profile의 포괄성을 증명하지 않는다. 0014는 내부 draft `0.1.0-draft`를 유지한다.
- CSS·font·image 자원 연결은 0011 범위다. 제품 loader, R15 manifest, OTA download·activation·rollback은 범위 밖이다.
