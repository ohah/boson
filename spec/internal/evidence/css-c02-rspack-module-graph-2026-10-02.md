# C02 Rspack 모듈 그래프 실험 근거 · 2026-10-02

## 판정 범위

이 문서는 Rspack `2.2.7`에서 입력 `moduleGraph`·`chunkGraph`와 실제 최종 JavaScript bytes를 분리해 관찰한 fixture 결과다. 제품 번들러 API, OTA 지원, 안정적인 R15 chunk ID를 증명하지 않는다. 논리 ID는 계속 `null`, `identityStatus: "unproven"`으로 둔다.

비교 fixture는 `spikes/css-bundler/fixture-rspack-graph/`다. 하나의 JS entry가 resolver alias, package `exports`, manifest 기반 virtual module, cycle, tree-shaken 모듈, 반복 static·dynamic import, re-export, CSS import를 포함한다. side-effect-only 및 dynamic-import-only module, `import.meta`, top-level `await`도 별도 fixture로 둔다. 판정 기준은 [0014 C02 계약](../0014-c02-bundler-module-graph.md)이다.

## 실행 환경과 관찰 지점

- Rspack: `2.2.7`
- Node.js: `v24.20.0` (`mise exec`)
- 런타임 profile: `{ node: "v24.20.0", platform: "darwin", arch: "arm64" }`
- macOS: `26.5.1` (실행 환경 기록이며 profile digest에는 OS release 대신 Node/platform/arch를 포함)
- Bun: `1.4.2`
- fixture tree SHA-256: `46b24047ab47cce8c80e281eb4b62006d08c71524ec63475a7524925f25111d5`
- 성공 profile source graph SHA-256: `3204065f77ff3d4f28483cffab16e578fc382aa00dd563f327196e3f456312b9`
- 공통 validator hardening과 `output.clean: false`를 포함한 build profile SHA-256: `ffb5cff3af19f5a6e96e91b26a733d2acf1303ab1ff309ec04ba4a428e13c3da`
- 비교 명령: `mise exec -- node --test rspack-module-graph-adapter.test.mjs` (작업 디렉터리: `spikes/css-bundler/`)

입력 graph capture는 Rspack compilation의 `modules`, `moduleGraph.getOutgoingConnections(module)`, `chunkGraph.getOrderedChunkModulesIterable(chunk, compareFn)`, `chunkGraph.getModuleChunksIterable(module)`를 사용한다. 원본 AST는 Acorn으로 읽는다. `esm import`·`esm export import` canonical connection을 AST 요청 occurrence에 위치로 대응시키고, Rspack의 `*specifier` connection은 import 선언이 아닌 사용 식별자의 위치를 보고하므로 별도 edge로 세지 않고 canonical 요청과 target이 같은지 검사한다. Rspack은 dynamic import의 `dependency.loc`를 `null`로 제공한다. 이때 occurrence와 connection 수가 같고 target이 하나로 일치할 때만 source 위치 순서로 대응시키며, 수량이나 target이 모호하면 `C02_GRAPH_CAPTURE_INCOMPLETE`로 닫는다. 최종 출력은 `stats.toJson()`의 chunk ID·asset 경로와 출력 디렉터리의 실제 bytes를 대조한 뒤 Acorn으로 파싱한다.

profile digest에는 adapter/config 소스, 공통 `module-graph-contract.mjs`, `adapter-support.mjs`, `package.json`·`bun.lock`의 SHA-256과 정규화 effective options를 기록한다. 옵션 기록에는 고정 entry `main -> src/main.js`, `web`/`es2022` target, resolver alias·condition·dependency별 resolution, externals 설정, output format·preserveModules, optimization, CSS rule, capture plugin, Node 버전·플랫폼·아키텍처를 포함한다. 다른 feature entry 선언은 compiler를 실행하기 전에 거부한다. fixture digest는 root가 실제 디렉터리인지 확인하고 각 항목에 `lstat`을 적용해 일반 파일만 읽는다. symlink와 특수 파일은 내용 읽기 전에 거부한다. manifest는 fixture snapshot에서 읽은 동일 bytes로 virtual plugin을 구성하고, build 뒤 전체 fixture digest를 다시 계산한다. 각 JavaScript module의 `module.originalSource().source()`도 시작 snapshot의 해당 fixture/manifest bytes와 byte 단위로 비교한다. Buffer와 Uint8Array는 원시 bytes로, 문자열은 fixture UTF-8 bytes로 정규화한다. 원본 누락·불일치·미선언 virtual source는 실패한다. 고정 profile에는 JavaScript loader나 source 변환 plugin이 없고 CSS 입력 규칙만 둔다. 빌드 전후 fixture bytes나 파일 집합이 달라지면 성공을 거부한다.

통합 worktree는 Acorn `8.18.0`을 직접 의존성으로 고정하고 있다. 전용 suite와 production build는 통합 worktree의 Acorn package를 직접 사용했으며 임시 symlink가 필요하지 않았다. 다음 profile digest는 통합 package/lock bytes를 포함한다.

성공 profile build descriptor의 `configSources` 및 테스트 추적성 해시는 다음과 같다. 테스트 파일 해시는 재현 코드 추적용이며 build 출력에 영향을 주는 입력이 아니므로 `configSources`나 build profile digest에는 포함하지 않는다.

| 입력 파일 | SHA-256 |
| --- | --- |
| `rspack-module-graph-adapter.mjs` | `0f690e59ef9d14653acca88242432e7384083ca20bb752c1b8dabca1f669626b` |
| `rspack-graph.config.mjs` | `62a8dbc24b321606120f3d478f813fdc33ef6a0cf3ba7c45017a6afed1d02bb8` |
| `module-graph-contract.mjs` | `6e5cf5924a4c1b6aed863f858190d767a0967a097cefef8a3e615b186017e2a6` |
| `adapter-support.mjs` | `a4faa6b519322a10ecc213bccd636cea060a8a024cbd7eab86af12dfc2e54ccb` |
| `package.json` (통합 worktree) | `3ffdbf38f0b82cd19dcf77f40b0ccd42ac46dc35c3cb549ea0fe81fd60930204` |
| `bun.lock` (통합 worktree) | `e71ecca80fee83319fdde41ba33b6ad343b17d1bfd098f8fe1183ac5482ed145` |
| `rspack-module-graph-adapter.test.mjs` (테스트 추적 전용) | `ada91ac0285552b9d9ad452aeae1686e4456ed54fc3422684e18920fb5c93cb6` |

modern-module fixture build 관찰값은 다음과 같다.

| 관찰 지점 | 원시 관찰 수 | 정규화 snapshot 수 |
| --- | ---: | ---: |
| Rspack compilation modules / JavaScript modules | 12 / 11 | 11 JavaScript modules |
| 모든 raw JavaScript module의 `getOutgoingConnections()` 합계 | 29 | 18 JS dependency occurrences |
| stylesheet dependency | 1 | 1 `excludedDependencies` |
| stats module rows | 13 | source graph module count와 별도 관찰 |
| stats chunks | 11 | output chunks 10 |
| stats assets / JavaScript assets | 11 / 10 | output resources 10 |

원시 Rspack 수와 정규화 graph 항목 수는 서로 다른 계층이다. 원시 connection에는 import 요청 occurrence 외에 Rspack `*specifier` 연결도 포함되므로 29를 의미상 dependency 수로 읽으면 안 된다. 원시 JavaScript module count는 `compilation.modules` 전체에서 JavaScript type인 module을 먼저 분류해 얻고, raw outgoing connection 수는 그 모든 module에 대해 합산한다. 정규화 source graph module은 fixture 안에서 키를 얻은 11개이며 AST 요청 occurrence는 18개다. `compilation.modules`의 12개에는 CSS module이 포함되고 stats module rows는 별도 stats 관찰치다. CSS는 `sourceGraph.excludedDependencies`에서 `targetKind: "stylesheet"`로 분류한다. JavaScript 외 자원과 CSS URL 관계는 [0011 CSS resource adapter](../0011-css-resource-adapter-c02.md)의 범위다.
분류한 stylesheet/asset target이 fixture 내부 resource key로 해소되지 않으면 `resolvedResourceKey: null`을 보존하되 adapter가 `C02_GRAPH_CAPTURE_INCOMPLETE`로 성공 snapshot을 거부한다. 공통 `assertR15JavaScriptGraphInput`도 null excluded key가 있는 성공 snapshot을 거부한다. 성공 fixture의 검증 결과에는 `requiresResourceGraphJoin: true`가 표시된다. C02.2 JavaScript graph validator 통과는 전체 R15 입력 적격을 뜻하지 않으며, CSS 등 excluded resource edge는 0011 자원 snapshot과 결합해 검증해야 한다.

Rspack stats의 chunk file 이름만으로 output resource를 만들지 않는다. stats의 emitted asset 목록과 디스크의 실제 bytes에 모두 있는 JavaScript 파일만 output chunk 자원으로 연결한다. Rspack chunk가 보고하는 file과 실제 emitted asset이 다를 수 있기 때문이다.

## 실제 출력 profile 비교

각 profile은 동일 fixture와 production `web`/`es2022` target으로 독립 build했다. 성공 여부는 설정 이름이 아니라 출력 파일의 바이트와 literal module syntax로 판정했다.

| Profile | 실제 출력 관찰 | 판정 |
| --- | --- | --- |
| `default-runtime` | entry가 IIFE와 Rspack runtime helper로 감싸지고, 동적 파일은 `globalThis.rspackChunk.push(...)` wrapper로 출력된다. 입력 graph도 최적화 후 일부 source 요청 connection이 빠져 AST occurrence 대응이 불완전하다. | `C02_GRAPH_CAPTURE_INCOMPLETE`, `C02_GRAPH_OUTPUT_NOT_ESM`으로 거부 |
| `output-module` | `output.module`, `chunkFormat: "module"`, `chunkLoading: "import"`, `iife: false`를 켰다. 동적 chunk에 ESM export는 생기지만 entry는 runtime helper를 포함하고 계산형 dynamic import를 출력한다. 입력 graph도 최적화 후 요청 connection이 빠진다. | `C02_GRAPH_UNSUPPORTED_IMPORT`, `C02_GRAPH_CAPTURE_INCOMPLETE`, `C02_GRAPH_OUTPUT_NOT_ESM`으로 거부 |
| `modern-module-preserve-modules` | `library.type: "modern-module"`과 fixture `src`에 대한 `preserveModules`에서 실제 static/dynamic ESM literal 관계를 얻었다. 출력 파일 경로와 최종 specifier로 target을 모두 한 chunk에 연결했다. | fixture 범위에서 성공 |

`output.module: true`만으로 application runtime이 ESM chunk graph가 되지는 않았다. `default-runtime`과 `output-module`은 최적화 후 Rspack graph connection이 원본 AST 요청을 모두 덮지 않아 source graph도 `incomplete`다. `modern-module-preserve-modules`는 이번 fixture의 Rspack library output profile로만 증명했다. 일반 앱 config 전반에 호환된다는 의미는 아니다.

## 입력 edge와 emitted edge의 분리

`src/main.js`의 원본 `@graph/same.js` 요청은 resolver graph에서 `src/same.js`로 연결된다. 최종 `main.js`에는 alias 문자열 대신 `./same.js`가 출력된다. adapter는 두 문자열이 달라도 실패시키지 않고, 최종 emitted literal `./same.js`를 실제 출력 파일 `same.js`에 연결한다.

`src/main.js`는 `@graph/same.js`를 static 2회, dynamic 2회 요청한다. source graph에는 각 AST 위치가 따로 보존되며 네 edge가 모두 `src/same.js` target으로 연결된다. 최종 `main.js`는 static·dynamic 각각 하나의 `./same.js` edge로 정규화하고 둘 다 같은 output chunk/resource를 가리킨다. 같은 referrer/specifier가 kind에 따라 다른 target을 가리키는 합성 입력은 adapter 전용 테스트에서 `C02_GRAPH_TARGET_CONFLICT`로 거부한다. 위치 없는 connection 수가 AST occurrence 수와 다를 때도 capture incomplete로 거부한다.

성공 snapshot은 `assertR15JavaScriptGraphInput` 검증을 통과했다. 반환값은 CSS excluded edge로 인해 `requiresResourceGraphJoin: true`이고, chunk와 resource 논리 ID가 모두 `unproven`이어서 OTA 영향 범위는 앱 전체로 fallback된다. stylesheet edge는 별도 자원 snapshot과 join해야 하므로 이 결과는 전체 R15 입력 적격이나 OTA 부분 배포 범위를 증명하지 않는다.

`src/re-export.js`와 그 내부 `./shared.js` source edge는 compilation graph에는 남지만, Rspack이 re-export를 `main.js`로 인라인/정리해 `src/re-export.js`의 output chunk 소속은 빈 배열이다. adapter는 입력 edge를 최종 emitted edge라고 가정하지 않는다.

## ESM 성공 profile의 출력 resource

아래 크기와 digest는 출력 디렉터리에서 다시 읽은 최종 bytes 기준이다. 테스트는 각 파일에 대해 byte 길이와 SHA-256을 직접 재계산해 snapshot과 비교한다.

| 출력 파일 | Bytes | SHA-256 |
| --- | ---: | --- |
| `749.js` | 57 | `daa0d31d7bd9973145e277751f0a61500523e1e383268baf53775733c4df0d50` |
| `dynamic-only.js` | 59 | `77bf0b5168fb8e94ac135dec0fec13b502d5546d0516f9d44754260cecfcabac` |
| `lazy.js` | 77 | `4a454d3eb6dc6bab8ddd562d15d3d5a502301e212e3b208ff615575cc0f2535c` |
| `main.js` | 539 | `03d8e370bd93fd803df54bf74d2ed886f95634c2044a39b3ab1f80b4eea3ed37` |
| `module-meta.js` | 167 | `e88cd05b296302e96f969eaa3f02b0923a9ef0414e4c0b3f8feba61fabeca7ae` |
| `re-export.js` | 47 | `1e6de85285b17ba8f73fe4b6c138c80e6801e7f5d58a50bbe0e33c21ddd2f16b` |
| `same.js` | 178 | `07ef908382f1dcb459df7cf80bead4a5b60c94e4a05f14de5f7778ad0b6e4c62` |
| `shared.js` | 126 | `d3d2cace31782aad3247ac4772e6b9722ec777d01db9de01b9dc6b55cd4f15cd` |
| `side-effect.js` | 39 | `5023485ec0aa66fbd9d9b52027e5ebada251a564c1d7d85be6da6d54adbff72f` |
| `virtual-entry.js` | 49 | `886a553087ea6f9febbafeadf3985dd0d8fab58b944cfb193fe908a09a051fc0` |

실제 `main.js`에는 `from "./same.js"` static import와 `import("./same.js")` dynamic import가 함께 있다. Acorn이 관찰한 최종 literal과 stats가 연결한 출력 파일을 기준으로 두 edge가 동일한 target을 가리키는지 검사한다. 출력 해시에는 최종 변환 결과 전체가 포함된다.

동일한 Acorn `8.18.0`·통합 package/lock·config 입력에서 `modern-module-preserve-modules`를 두 번 빌드했다. 두 결과의 fixture SHA-256, source graph SHA-256, build profile descriptor/digest, 출력 자원 경로·byte 수·SHA-256, chunk별 emitted dependency의 target resource 경로가 모두 같았다. 재현 digest는 fixture `46b24047…`, source graph `3204065f…`, build profile `ffb5cff3…`다. 최종 JavaScript output resource는 10개며 위 표의 각 resource byte 수와 digest가 두 build에서 일치한다. 이 비교는 macOS `26.5.1` / Node `v24.20.0` / Rspack `2.2.7` 조합만 확인한다.

## 테스트와 남은 범위

Rspack 전용 테스트는 다음 성공·실패를 다룬다.

- `modern-module-preserve-modules`의 input/output graph 분리와 최종 byte digest
- 동일 source referrer/specifier의 반복 static·dynamic occurrence 위치 연결과 반복 build digest 재현성
- 원본 alias와 emitted literal이 다른 경우의 실제 chunk 연결
- 동일 emitted specifier의 static·dynamic target 일치
- CSS input edge의 별도 분류와 tree-shaken source module
- 기본 runtime 및 `output.module`의 fail-closed 진단
- 원본 referrer/specifier가 static·dynamic 사이에서 target을 바꾸는 경우 거부
- Rspack이 제공한 source occurrence 수와 connection 수 불일치 거부
- emitted ESM이 이미 존재하는 비-JavaScript 자원을 가져오면 안정 진단과 null target edge를 남기고 거부
- source graph에서 fixture key로 해소하지 못한 excluded stylesheet target 거부
- fixture 항목과 fixture root의 symlink를 읽기 전에 거부
- compiler `originalSource()`가 시작 fixture/manifest snapshot bytes와 다르거나 원본이 누락되면 거부; Buffer·Uint8Array·UTF-8 문자열 반환을 검증
- 고정 feature entry가 `main -> src/main.js`와 다르면 compiler 실행 전에 거부
- CSS 외 JavaScript loader 규칙이 없는 고정 config 확인
- source/output chunk membership 누락·중복, orphan resource, 중복 owner, raw number/string chunk ID 충돌 진단
- Acorn이 import phase 문법을 파싱하지 못하면 unsupported 진단
- raw JavaScript module / outgoing connection count와 normalized module count가 다른 resource-less virtual module 사례

통합 worktree에서 전용 테스트 **30/30**개가 통과했다 (`mise exec -- node --test rspack-module-graph-adapter.test.mjs`, `spikes/css-bundler/`에서 실행). 전체 CSS bundler suite는 **130/130** 통과했다. 이어 production modern-module build도 성공해 통합 package/lock을 반영한 profile/source graph/output resource digest를 수집했다. 이는 Rspack `2.2.7`의 고정 fixture/profile을 검증한 결과이며 C02 전체 완료나 OTA 부분 배포를 선언하지 않는다. Rspack symlink module의 제품 지원, JSON/Wasm 자원, 임의 loader/plugin, 다른 target·OS의 모든 profile은 이 fixture에서 증명하지 않았다. 외부·bare·unresolved 입력은 성공으로 수용하지 않고 실패 fixture에서 adapter 진단으로 거부한다. fixture symlink와 특수 파일은 digest 단계에서 명시적으로 거부한다. `output.clean`은 false이며 build 전에 output 경로가 없어야 하고 adapter가 `mkdir`로 경로를 원자적으로 확보한 뒤 실제 경로를 다시 확인한다. 기존 sentinel 보존과 같은 output 경로 동시 요청 테스트를 포함한다. Rspack에 넘기는 경로가 문자열이므로 동일 사용자 프로세스가 확보 후 경로를 교체해 쓰기 위치를 바꾸는 경우는 막지 못한다. 이 제한에서도 recursive clean은 실행되지 않는다.

Rspack API 및 profile 근거는 [JavaScript API architecture](https://www.rspack.dev/api/javascript-api/architecture), [Stats JSON](https://v2.rspack.rs/api/javascript-api/stats-json), [ESM output](https://v2.rspack.rs/guide/features/esm), [`preserveModules`](https://v2.rspack.rs/config/output#outputlibrarypreservemodules), [Rspack v2.2.7 import dependency codegen](https://github.com/web-infra-dev/rspack/blob/v2.2.7/crates/rspack_plugin_javascript/src/dependency/esm/import_dependency.rs)를 참조한다.
