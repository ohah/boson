# 0014 · C02 번들러 모듈 그래프 adapter

**계약 버전:** `0.1.0-draft` · **상태:** 내부 실험 계약 · **제품 기능:** 미구현

## 목적과 관계

Vite·Rspack production build에서 입력 모듈 의존성과 최종 출력 청크 사이의 대응을 수집하고, R15 OTA 그래프로 변환할 수 있는지 판정한다. 이 계약은 fixture adapter의 내부 결과 형식이며 앱 작성자용 API, 번들러 플러그인 제품 API, OTA manifest가 아니다.

[0011 CSS 자원 adapter](0011-css-resource-adapter-c02.md)는 CSS·폰트·이미지의 출력 자원 snapshot을 계속 담당한다. 이 문서는 JavaScript module graph와 기능 entry, 출력 형식 적합성을 보충한다. CSS `@import`·`url()` 관계는 0011 결과를 참조하며, 두 snapshot이 모두 성공하고 ID 참조가 일치해야 결합할 수 있다. 0011에 없는 CSS 출력 연결을 추측으로 채우지 않는다.

[0013 R15 모델](0013-r15-ota-chunk-compatibility.md)의 최종 JS edge는 번들러 입력 edge와 다르다. 따라서 adapter는 **입력 resolver graph**와 **최종 emitted ESM graph**를 별도로 기록한다. 입력 graph만으로 R15 graph를 만들거나, 원본 import 문자열을 최종 emitted specifier라고 간주하지 않는다.

## 결과와 성공 조건

결과에는 adapter·번들러 버전, 고정된 output profile, fixture digest, build status, 진단, 입력 graph, 출력 graph가 들어간다. 입력 및 출력 graph의 추출 상태는 각각 `complete` 또는 `incomplete`로 기록한다. 지원하지 않는 profile은 `failed`와 안정된 진단 코드로 반환하고 부분 결과를 R15 입력으로 사용할 수 없게 한다.

성공으로 기록하려면 다음 조건을 모두 충족해야 한다.

1. 번들러가 분석한 입력 모듈·의존성의 전부를 수집하고, 관찰한 모듈·edge 수와 정규화 graph digest를 기록한다.
2. 각 source module의 출력 청크 소속을 전부 기록한다. tree-shaking으로 출력되지 않은 모듈은 그 사실을 명시하며, 하나의 모듈이 여러 청크에 실리는 번들러 동작도 그대로 보존한다. 소속을 관찰하지 못하면 실패한다.
3. 각 출력 JS 청크를 실제 바이트 기준 ESM parser로 분석한다. 청크가 실제 ESM이 아니거나 parser가 모듈 형식·import attribute를 해석하지 못하면 실패한다.
4. emitted static·dynamic import의 specifier는 최종 JS에 출력된 문자열 그대로 보존하고, 같은 specifier의 target chunk를 하나로 확정한다.
5. 외부·bare import, unresolved import, 출력 바이트에서 target을 연결할 수 없는 import, 유한한 target으로 축소되지 않은 계산형 dynamic import를 발견하면 성공 결과를 만들지 않는다.
6. 동일 referrer/specifier에서 static·dynamic 종류가 달라도 target은 같아야 한다. 같은 kind·target 중복은 한 edge로 정규화하고, 종류가 다른 edge는 각각 보존한다. 순환은 허용한다.
7. adapter의 build-local chunk/resource ID와 R15 논리 ID를 구분한다. 논리 ID 안정성을 증명하지 못하면 `logicalId: null`, `identityStatus: "unproven"`으로 기록하고 R15 소비자는 `affectedScope=app`으로 fallback한다. 출력 파일명이나 콘텐츠 digest를 논리 ID로 쓰지 않는다.
8. 기능 ID와 entry source key는 fixture 설정에서 명시한다. 번들러 기본 이름이나 출력 파일명으로 제품 기능 경계를 추측하지 않는다.

`complete`는 해당 번들러 API와 출력물을 끝까지 관찰했다는 adapter 진술이다. manifest 자체 검증이나 digest는 소스 import를 번들러가 누락하지 않았음을 독립적으로 증명하지 않는다. 근거 문서에는 fixture 원본, build 설정 digest, 번들러 API capture 지점과 수집 수치를 남긴다.

## 내부 snapshot 형식

아래는 필드 관계를 보여주는 draft다. 제품 JSON schema나 장기 호환 API로 취급하지 않는다.

```json
{
  "contract": { "name": "spinon.c02-bundler-module-graph", "version": "0.1.0-draft" },
  "build": {
    "tool": "vite",
    "toolVersion": "8.3.1",
    "adapterVersion": "0.1.0-spike",
    "outputProfile": "esm-chunks",
    "status": "success",
    "fixtureSha256": "<fixture-tree-sha256>",
    "buildProfileSha256": "<effective-profile-sha256>"
  },
  "sourceGraph": {
    "status": "complete",
    "capture": "bundler-module-graph-and-resolver-hooks",
    "moduleCount": 2,
    "edgeCount": 1,
    "sha256": "<normalized-source-graph-sha256>",
    "modules": [
      { "key": "src/main.js", "outputChunkIds": ["chunk:build-entry"] },
      { "key": "src/features/lazy.js", "outputChunkIds": ["chunk:build-lazy"] }
    ],
    "dependencies": [
      {
        "referrerModuleKey": "src/main.js",
        "kind": "dynamic",
        "sourceSpecifier": "./features/lazy.js",
        "resolvedModuleKey": "src/features/lazy.js",
        "external": false,
        "source": { "file": "src/main.js", "line": 4, "column": 1 }
      }
    ]
  },
  "features": [
    { "id": "main", "entrySourceKey": "src/main.js", "entryChunkId": "chunk:build-entry" }
  ],
  "outputGraph": {
    "status": "complete",
    "moduleFormat": "esm",
    "chunks": [
      {
        "id": "chunk:build-entry",
        "logicalId": null,
        "identityStatus": "unproven",
        "kind": "entry",
        "moduleFormat": "esm",
        "javascriptResourceId": "resource:assets/main.js",
        "sourceModuleKeys": ["src/main.js"],
        "dependencies": [
          { "kind": "dynamic", "specifier": "./lazy-ab12.js", "chunkId": "chunk:build-lazy" }
        ]
      },
      {
        "id": "chunk:build-lazy",
        "logicalId": null,
        "identityStatus": "unproven",
        "kind": "dynamic",
        "moduleFormat": "esm",
        "javascriptResourceId": "resource:assets/lazy-ab12.js",
        "sourceModuleKeys": ["src/features/lazy.js"],
        "dependencies": []
      }
    ]
  },
  "diagnostics": []
}
```

`sourceSpecifier`는 resolver가 처리하기 직전 parser/compiler dependency record에 들어 있는 요청 문자열을 뜻한다. 앱 원문 전체나 transform·alias 이전 표현까지 보장하지 않는다. Vite처럼 resolver hook만으로 alias 전 요청을 볼 수 없는 경우 AST의 dependency occurrence와 resolver 관찰을 정확히 짝짓는다. 짝이 모호하면 `C02_GRAPH_CAPTURE_INCOMPLETE`로 실패하며 resolver가 받은 다른 문자열을 대신 쓰지 않는다. `source` 위치를 API나 AST에서 얻지 못하면 `null`로 기록하고 추측한 위치를 만들지 않는다. `outputGraph.dependencies[].specifier`만 R15의 emitted specifier 필드로 투영한다.

`sourceGraph.modules[].outputChunkIds`는 build-local 대응이며 실제 청크 graph의 모든 소속을 담는다. source module의 복수 소속은 그 자체로 실패가 아니다. tree-shaken import는 실제 출력 edge에 없을 수 있으므로 source edge와 emitted edge를 같은 배열에 강제로 넣지 않는다. 서로 대응하지 않는 edge와 이유는 provenance 및 진단으로 설명한다. 출력 edge는 최종 JS에서 확인된 emitted specifier와 target이 각각 하나로 확정되어야 한다.

## 진단 코드와 실패 처리

adapter는 다음 조건을 안정된 코드로 보고한다. 각 진단은 `severity`, `code`, `stage`, `message`, `source`(관찰 불가 시 `null`), `referrerModuleKey`, `specifier`를 가진다. 여러 문제를 한 문자열에 합치지 않고 가능한 오류를 수집하되, 불완전한 graph를 성공 상태로 반환하지 않는다.

| 코드 | 실패 조건 |
| --- | --- |
| `C02_GRAPH_CAPTURE_INCOMPLETE` | 번들러 module/dependency graph를 전부 수집하지 못했거나 capture 지점이 확인되지 않음 |
| `C02_GRAPH_UNRESOLVED_IMPORT` | 입력 import의 로컬 대상 또는 출력 target이 없음 |
| `C02_GRAPH_EXTERNAL_IMPORT` | 외부·bare import가 bundle 내부 resource로 변환되지 않음 |
| `C02_GRAPH_UNSUPPORTED_IMPORT` | 지원하지 않는 import attributes, module type/import phase, non-literal dynamic import 또는 module syntax |
| `C02_GRAPH_OUTPUT_NOT_ESM` | 출력 profile이 실제 ESM static/dynamic module 관계를 생성하지 않음 |
| `C02_GRAPH_TARGET_AMBIGUOUS` | 입력 module 또는 emitted specifier가 0개/복수 출력 chunk에 대응 |
| `C02_GRAPH_TARGET_CONFLICT` | 같은 referrer/specifier가 static·dynamic 종류에 따라 다른 target을 가리킴 |
| `C02_GRAPH_RESOURCE_MISSING` | emitted JS resource 또는 결합할 CSS/asset resource ID가 snapshot에 없음 |
| `C02_GRAPH_PROVENANCE_MISSING` | fixture/config/capture digest 또는 관찰 수치를 기록하지 못함 |

실패 snapshot은 debugging용 부분 정보를 가질 수 있으나 R15 변환기는 `build.status !== "success"` 또는 graph status 불완전이면 거부한다. adapter가 아닌 공통 validator가 중복 제거, ID 참조, specifier 충돌, 순환 안전성을 재검증한다.

## Vite·Rspack profile 판정

번들러 이름이나 `format: "es"`·`output.module: true` 설정값만으로 ESM 호환을 선언하지 않는다. 실제 출력 바이트와 resolver/module graph를 서로 대조한다.

- Vite는 `resolveId`/`moduleParsed` 등 resolver·module 관찰 결과와 `generateBundle`의 최종 output chunk `imports`, `dynamicImports`, module membership를 함께 검사한다. manifest entry만으로 emitted edge를 만들지 않는다.
- Rspack은 `moduleGraph`의 실제 dependency/module 연결과 `chunkGraph`를 관찰하고, 최종 output asset의 ESM 문법을 검사한다. 기본 runtime chunk loading 출력이나 `__webpack_require__` 코드에 원본 source specifier가 남지 않는 profile은 `C02_GRAPH_OUTPUT_NOT_ESM`으로 거부한다. `output.module`·`chunkFormat` 설정만으로 예외 처리하지 않는다. Rspack JS dependency API가 import phase를 노출하지 않는 경우 해당 문법을 AST로 별도 식별하거나 profile을 실패 처리한다. Rspack [ESM 출력 문서](https://v2.rspack.rs/guide/features/esm)는 application chunk와 전용 library rendering 경로를 구분한다.
- Rspack preserve-modules/modern-module 같은 별도 profile은 최종 emitted literal specifier와 target 파일의 일치 fixture를 통과하기 전까지 미지원이다.

### 고정 버전 API 근거

- Vite `8.3.1` plugin hook·`generateBundle`·module metadata: [Vite plugin API](https://github.com/vitejs/vite/blob/v8.3.1/docs/guide/api-plugin.md).
- Rolldown `1.2.12` resolution kind와 module/output 형식: [ModuleInfo types](https://github.com/rolldown/rolldown/blob/v1.2.12/packages/rolldown/src/types/module-info.ts), [output types](https://github.com/rolldown/rolldown/blob/v1.2.12/packages/rolldown/src/types/rolldown-output.ts), [resolve API](https://github.com/rolldown/rolldown/blob/v1.2.12/packages/rolldown/src/plugin/plugin-context.ts).
- Rspack `2.2.7` module graph·stats·ESM 출력: [JavaScript API 구조](https://www.rspack.dev/api/javascript-api/architecture), [Stats JSON](https://v2.rspack.rs/api/javascript-api/stats-json), [ESM 출력](https://v2.rspack.rs/guide/features/esm), [`preserveModules`](https://v2.rspack.rs/config/output#outputlibrarypreservemodules), [dynamic import codegen](https://github.com/web-infra-dev/rspack/blob/v2.2.7/crates/rspack_plugin_javascript/src/dependency/esm/import_dependency.rs).

이 조건은 Rspack 사용 불가라는 제품 결론이 아니다. 현재 adapter가 OTA용 R15 ESM graph를 증명하지 못하는 output profile을 식별한다.

## 비교 fixture와 수락 기준

기준 비교 모델은 [C02 production 비교](0008-css-bundler-c02.md), [R15 그래프 계약](0013-r15-ota-chunk-compatibility.md), 고정된 동일 source fixture를 사용한다. 각 번들러의 버전·lockfile digest·정규화한 실제 build profile digest·fixture digest·산출물 digest를 기록한다. profile에 반영하지 못한 resolver·transform/plugin 설정이 있으면 graph 완전성을 선언하지 않는다. fixture에는 다음 동작을 서로 독립적으로 검증하는 case가 들어간다.

- entry, static import, literal dynamic import, shared chunk와 명시 feature entry
- 한 importer에서 같은 specifier를 static·dynamic 양쪽으로 요청하는 경우와 target 충돌 주입
- alias·package exports·virtual module에서 resolver key 및 output chunk 대응
- tree-shaken import, cycle, 같은 kind/target 중복, 같은 specifier의 다른 target
- external/bare/unresolved import, 계산형 dynamic import, import attributes·import phase와 비 JS module type
- 기본 Rspack runtime output과 ESM/preserve-modules 후보의 실제 출력 판정
- source/output chunk 누락·중복, resource 누락, 재현 가능한 config/graph digest

수락은 성공 케이스가 예상 graph와 정확히 같고, 각 부정 케이스가 해당 실패 코드로 `failed` 처리되며, 실패 snapshot이 R15 변환을 통과하지 못할 때만 한다. 반복 빌드 digest 비교는 결정론을 확인하되, 다른 tool version·OS의 결정론을 주장하지 않는다. 현재 fixture를 통과해도 symlink, 임의 plugin virtual module, 모든 transformer, 모든 import attribute, 웹/모바일 전체 번들 호환이 증명되는 것은 아니다.

## 범위 밖

제품 번들러 API, web HMR/CDP/DevTools, X01 JavaScript module loader, D02 서명·release, D03 배포, D04 다운로드/rollback, runtime CSS loader, 외부 CSS URL 요청은 이 계약에서 구현하지 않는다. C02 전체는 `spec/STATUS.md`의 완료 조건과 모든 CSS·asset·source diagnostic 행렬을 통과하기 전까지 미완료다.
