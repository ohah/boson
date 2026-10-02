# 0014 · C02 번들러 모듈 그래프 adapter

**계약 버전:** `0.1.0-draft` · **상태:** 내부 실험 계약 · **제품 기능:** 미구현

## 목적과 관계

Vite·Rspack production build에서 입력 모듈 의존성과 최종 출력 청크 사이의 대응을 수집하고, R15 OTA 그래프로 변환할 수 있는지 판정한다. 이 계약은 fixture adapter의 내부 결과 형식이며 앱 작성자용 API, 번들러 플러그인 제품 API, OTA manifest가 아니다.

[0011 CSS 자원 adapter](0011-css-resource-adapter-c02.md)는 CSS·폰트·이미지의 출력 자원 snapshot을 계속 담당한다. 이 문서는 JavaScript module graph와 기능 entry, 출력 형식 적합성을 보충한다. CSS `@import`·`url()` 관계는 0011 결과를 참조하며, 두 snapshot이 모두 성공하고 ID 참조가 일치해야 결합할 수 있다. 0011에 없는 CSS 출력 연결을 추측으로 채우지 않는다.

[0013 R15 모델](0013-r15-ota-chunk-compatibility.md)의 최종 JS edge는 번들러 입력 edge와 다르다. 따라서 adapter는 **입력 resolver graph**와 **최종 emitted ESM graph**를 별도로 기록한다. 입력 graph만으로 R15 graph를 만들거나, 원본 import 문자열을 최종 emitted specifier라고 간주하지 않는다.

## 결과와 성공 조건

결과에는 `vite` 또는 `rspack` adapter·번들러 버전, 고정된 output profile, fixture digest, 재계산 가능한 build profile과 digest, build status, 진단, 입력 graph, 출력 graph가 들어간다. 입력 및 출력 graph의 추출 상태는 각각 `complete` 또는 `incomplete`로 기록한다. 지원하지 않는 profile은 `failed`와 안정된 진단 코드로 반환하고 부분 결과를 R15 입력으로 사용할 수 없게 한다. Snapshot 필드는 이 문서에 적힌 닫힌 내부 형식을 따른다. adapter 진단용 임시 필드는 정규화 snapshot 안에 추가하지 않는다.

성공으로 기록하려면 다음 조건을 모두 충족해야 한다.

1. 번들러가 분석한 입력 모듈·의존성의 전부를 관찰한다. JavaScript-to-JavaScript edge는 `dependencies`에, stylesheet·asset 등으로 향하는 edge는 분류된 `excludedDependencies`에 기록한다. snapshot의 `moduleCount`, `edgeCount`, `excludedDependencyCount`는 정규화된 배열의 항목 수이며, 번들러 API가 원래 보고한 항목 수·수집 방법은 근거 문서에 별도로 남긴다. 정규화 graph digest도 함께 기록한다. stylesheet·asset edge의 `resolvedResourceKey`가 없거나 분류할 수 없는 의존성이 있으면 성공 graph를 만들지 않는다.
2. 각 source module의 출력 청크 소속을 전부 기록한다. tree-shaking으로 출력되지 않은 모듈은 그 사실을 명시하며, 하나의 모듈이 여러 청크에 실리는 번들러 동작도 그대로 보존한다. 소속을 관찰하지 못하면 실패한다.
3. 각 출력 JS 청크를 실제 바이트 기준 ESM parser로 분석한다. 청크가 실제 ESM이 아니거나 parser가 문법을 분석할 수 없으면 `C02_GRAPH_OUTPUT_PARSE_FAILED`, 문법은 읽었지만 import 의미를 계약에 표현할 수 없으면 `C02_GRAPH_UNSUPPORTED_IMPORT`로 실패한다.
4. emitted static·dynamic import의 specifier는 최종 JS에 출력된 문자열 그대로 보존하고, 같은 specifier의 target chunk를 하나로 확정한다.
5. 외부·bare import, unresolved import, 출력 바이트에서 target을 연결할 수 없는 import, 유한한 target으로 축소되지 않은 계산형 dynamic import를 발견하면 성공 결과를 만들지 않는다.
6. 동일 referrer/specifier에서 static·dynamic 종류가 달라도 target은 같아야 한다. 같은 kind·target 중복은 각 원소의 schema를 먼저 검사한 뒤 한 edge로 정규화하고, 종류가 다른 edge는 각각 보존한다. 순환은 허용한다.
7. adapter의 build-local chunk/resource ID와 R15 논리 ID를 구분한다. 논리 ID 안정성을 증명하지 못하면 `logicalId: null`, `identityStatus: "unproven"`으로 기록하고 R15 소비자는 `affectedScope=app`으로 fallback한다. 출력 파일명이나 콘텐츠 digest를 논리 ID로 쓰지 않는다.
8. 기능 ID와 entry source key는 fixture 설정에서 명시한다. 번들러 기본 이름이나 출력 파일명으로 제품 기능 경계를 추측하지 않는다.

snapshot 생성·검증, digest, emitted ESM parser, 경로·target resolver 등 공개 검증 helper는 입력 속성을 읽기 전에 JSON data tree인지 검사한다. getter/accessor 실행, 순환 참조, sparse 또는 사용자 속성이 붙은 배열, symbol 키, 비 JSON prototype·값은 거부한다. snapshot과 각 nested record는 이 문서의 허용 필드만 받으며 정규화·중복 제거 전에 원소별 schema를 검사한다. `resolveEmittedChunkTarget`에 직접 넘기는 resource와 chunk 목록도 필수 ID가 있어야 하고 각 목록 안에서 ID가 고유해야 한다. 이 사전 검사는 호출자 입력으로부터 실행 부작용이나 모호한 target을 만들지 않기 위한 계약 경계다.

명시한 feature의 `entryChunkId`는 번들러상 `entry` 또는 독립적인 `dynamic` chunk를 가리킬 수 있다. `static`·`shared` chunk는 feature 진입점으로 인정하지 않는다.

`sourceGraph.sha256`은 UTF-8로 인코딩한 정규 JSON의 SHA-256이다. payload 필드 순서는 `scope`, `modules`, `dependencies`, `excludedDependencies`다. module은 `key`의 Unicode 코드 포인트 사전 순으로 정렬하고 각 항목은 `key`, 정렬된 `outputChunkIds` 순서로 쓴다. JS dependency 정렬 키는 `[referrerModuleKey,kind,sourceSpecifier,resolvedModuleKey,external,sourceLocationKey]`, 제외 dependency 정렬 키는 `[referrerModuleKey,kind,sourceSpecifier,targetKind,resolvedResourceKey,sourceLocationKey]`를 순서 고정 JSON 문자열로 만든 뒤 Unicode 코드 포인트 순으로 비교한 값이다. `sourceLocationKey`는 위치가 있으면 `[file,line,column]`, 없으면 `null`이다. 위치의 `line`과 `column`은 1 이상의 안전한 정수다. 각 JS edge 객체 필드 순서는 `referrerModuleKey`, `kind`, `sourceSpecifier`, `resolvedModuleKey`, `external`, `source`; 제외 edge 객체는 `referrerModuleKey`, `kind`, `sourceSpecifier`, `targetKind`, `resolvedResourceKey`, `source`다. `source`는 `{file,line,column}` 또는 `null`로 직렬화한다. `modules`는 module key가 중복될 수 없고 `outputChunkIds`도 중복될 수 없다. dependency 배열은 import occurrence를 보존하므로 동일한 edge가 여러 번 나올 수 있다. 공통 helper가 digest를 재계산해 값과 비교한다. 독립 digest helper도 허용된 `sourceGraph` 필드만 입력받으며, 이 digest는 graph snapshot의 무결성·결정성을 확인할 뿐 resolver가 import를 누락했다는 독립 증명은 아니다.

`build.profile`은 `{configSources, effectiveOptions}`다. `configSources`는 adapter·번들러 설정 코드, `package.json`, lockfile처럼 빌드 동작을 정하는 저장소 입력 파일의 정규 상대 경로와 개별 SHA-256 목록이다. fixture 파일은 중복 기록하지 않고 `fixtureSha256`으로 별도 고정한다. `effectiveOptions`에는 실제로 적용된 entry, target/platform, format, resolver 조건·alias·external, plugin 식별자와 설정, transform·minify 옵션 및 빌드에 영향을 주는 환경 입력을 넣는다. 기본값을 생략해 실행 환경에 맡기지 않는다. `buildProfileSha256`은 파일 경로 순 정렬 후 profile 객체 키를 Unicode 코드 포인트 순 정렬하고, JSON 문자열·boolean·null·배열·일반 객체와 안전한 정수만 허용해 canonical JSON을 UTF-8 SHA-256으로 다시 계산한 값이다. 소스 설정은 `configSources`의 파일 digest로, 실행 옵션은 `effectiveOptions`로 검증 가능해야 한다. 허용 필드 밖의 설정이나 재현할 수 없는 환경 입력이 남으면 profile을 완전하다고 선언하지 않는다.

`fixtureSha256`은 fixture 내부의 일반 파일을 정규 상대 경로 순으로 정렬해 `[{path,bytes,sha256}]` 배열로 만들고, 그 순서 고정 JSON을 UTF-8 SHA-256으로 계산한다. `path`는 `/` 구분자 상대 경로, `bytes`는 실제 파일 바이트 길이, `sha256`은 같은 bytes의 소문자 SHA-256이다. 디렉터리 열거 순서와 작업 디렉터리 절대 경로는 입력하지 않는다. fixture에 일반 파일 이외의 심볼릭 링크 등 추적할 수 없는 항목이 있으면 성공 profile을 만들지 않는다.

`complete`는 해당 번들러 API와 출력물을 끝까지 관찰했다는 adapter 진술이다. manifest 자체 검증이나 digest는 소스 import를 번들러가 누락하지 않았음을 독립적으로 증명하지 않는다. 근거 문서에는 fixture 원본, build 설정 digest, 번들러 API capture 지점과 API 원본 관찰 수치를 남긴다. 원본 관찰 수와 snapshot의 정규화 배열 수는 같은 의미가 아니며 둘 사이의 정규화·중복 제거 규칙을 설명한다. module key와 non-null `resolvedResourceKey`는 adapter가 정규화한 fixture 상대 경로 또는 `virtual:<논리 키>`이며 절대 경로, `.`·`..` segment, 역슬래시, 제어 문자는 허용하지 않는다.

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
    "profile": {
      "configSources": [
        { "path": "spikes/css-bundler/vite-module-graph-adapter.mjs", "sha256": "<adapter-source-sha256>" },
        { "path": "spikes/css-bundler/module-graph-contract.mjs", "sha256": "<common-validator-sha256>" },
        { "path": "spikes/css-bundler/vite-graph.config.mjs", "sha256": "<bundler-config-sha256>" },
        { "path": "spikes/css-bundler/package.json", "sha256": "<package-json-sha256>" },
        { "path": "spikes/css-bundler/bun.lock", "sha256": "<lockfile-sha256>" }
      ],
      "effectiveOptions": {
        "entryPoints": { "main": "src/main.js" },
        "format": "esm",
        "platform": "browser",
        "target": "esnext",
        "minify": false,
        "resolver": { "conditions": ["browser", "import"], "alias": {}, "external": [] },
        "plugins": []
      }
    },
    "buildProfileSha256": "<effective-profile-sha256>"
  },
  "sourceGraph": {
    "scope": "javascript-module-dependencies",
    "status": "complete",
    "capture": "bundler-module-graph-and-resolver-hooks",
    "moduleCount": 2,
    "edgeCount": 1,
    "excludedDependencyCount": 0,
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
    ],
    "excludedDependencies": []
  },
  "features": [
    { "id": "main", "entrySourceKey": "src/main.js", "entryChunkId": "chunk:build-entry" }
  ],
  "outputGraph": {
    "status": "complete",
    "moduleFormat": "esm",
    "resources": [
      {
        "id": "resource:assets/main.js",
        "logicalId": null,
        "identityStatus": "unproven",
        "kind": "javascript",
        "outputPath": "assets/main.js",
        "mediaType": "text/javascript",
        "bytes": 420,
        "sha256": "<emitted-main-js-sha256>"
      },
      {
        "id": "resource:assets/lazy-ab12.js",
        "logicalId": null,
        "identityStatus": "unproven",
        "kind": "javascript",
        "outputPath": "assets/lazy-ab12.js",
        "mediaType": "text/javascript",
        "bytes": 180,
        "sha256": "<emitted-lazy-js-sha256>"
      }
    ],
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

`sourceSpecifier`는 resolver가 처리하기 직전 parser/compiler dependency record에 들어 있는 요청 문자열을 뜻한다. 앱 원문 전체나 transform·alias 이전 표현까지 보장하지 않는다. Vite처럼 resolver hook만으로 alias 전 요청을 볼 수 없는 경우 AST의 dependency occurrence와 resolver 관찰을 정확히 짝짓는다. 짝이 모호하면 `C02_GRAPH_CAPTURE_INCOMPLETE`로 실패하며 resolver가 받은 다른 문자열을 대신 쓰지 않는다. 번들러가 추가한 virtual helper dependency처럼 대응하는 앱 원문 AST occurrence가 없는 입력 edge도 조용히 버리지 않는다. 결정적인 `virtual:<논리 키>` module key와 source occurrence 또는 정당한 `null` source 위치로 기록하고 module membership까지 확인하거나 graph를 incomplete로 실패한다. `source` 위치를 API나 AST에서 얻지 못하면 `null`로 기록하고 추측한 위치를 만들지 않는다. `outputGraph.dependencies[].specifier`만 R15의 emitted specifier 필드로 투영한다. 이 필드는 최종 산출 ESM AST에서 읽은 문자열을 바꾸지 않고 저장한다.

`outputGraph.resources`에는 JavaScript chunk를 구성하는 최종 출력 파일만 기록한다. `id`는 이 build 안에서 참조하는 자원 ID, `logicalId`와 `identityStatus`는 R15에서 빌드 간 동일 자원임을 식별할 수 있는지 나타내며, `outputPath`는 출력 루트 기준 정규 상대 경로, `mediaType`은 실제 JavaScript MIME, `bytes`와 `sha256`은 같은 출력 바이트에서 계산한 값이다. 안정성이 입증되지 않은 자원은 `logicalId: null`, `identityStatus: "unproven"`이어야 하며 R15 소비자는 해당 출력 변경의 영향 범위를 앱 전체로 fallback한다. 성공 snapshot에서는 JavaScript resource와 output chunk가 일대일로 대응한다. resource 개수와 chunk 개수가 같아야 하고, 각 chunk는 정확히 하나의 resource를 가리키며 각 resource는 한 chunk에서만 참조되어야 한다. 번들러가 보고한 JavaScript 출력 파일 중 chunk graph에 대응하지 않는 `OutputAsset`도 누락된 실행 코드로 취급해 `C02_GRAPH_CAPTURE_INCOMPLETE`로 거부한다. 여기에는 별도 파일로 출력된 Web Worker 코드가 포함된다. 현재 fixture profile은 Worker 출력 graph를 지원하지 않는다. CSS·font·image 자원 객체와 edge는 여기 복제하지 않고 0011에서 별도로 확인한다.

`sourceGraph.modules[].outputChunkIds`는 build-local 대응이며 실제 청크 graph의 모든 소속을 담는다. source module의 복수 소속은 그 자체로 실패가 아니다. 입력 dependency와 최종 emitted edge는 최적화 때문에 일대일 관계가 아니다. tree-shaking으로 제거되거나 모듈 본문에 인라인될 수 있고 변환 과정에서 specifier가 달라질 수 있다. 따라서 이 계약은 입력 edge마다 출력 edge disposition을 추측하거나 R15 edge를 입력 graph에서 만들지 않는다. source graph는 번들러 입력 해석의 provenance와 capture 수치를 보존하고, **R15의 청크 의존성은 최종 출력 바이트를 AST로 분석해 만든 output graph만 사용한다.** 소스 입력 graph와 final output graph 양쪽의 완전성을 각각 증명할 근거가 없으면 해당 graph를 `incomplete`로 처리한다. `excludedDependencies` 항목은 `referrerModuleKey`, `kind`, `sourceSpecifier`, `targetKind`(`stylesheet` 또는 `asset`), `resolvedResourceKey`, `source`를 가진다. 성공 snapshot의 `resolvedResourceKey`는 null일 수 없다. 이는 CSS·폰트·이미지 등 0011 자원 snapshot이 맡는 관계를 다시 JS 청크 edge로 오인하지 않게 분류한 입력 기록이다. 이 하위 항목은 그 자원의 출력 연결 자체를 완료하지 않는다. `assertR15JavaScriptGraphInput`은 JavaScript graph 부분만 검사하고 항상 0011 자원 snapshot과의 후속 join이 필요함을 표시한다. C02.2는 별도 CSS entry나 JS import에서 관찰되지 않은 자원의 존재를 판정할 수 없기 때문이다. 이 검사는 전체 R15 graph 적격 판정이 아니다. 출력 edge는 최종 JS에서 확인된 emitted specifier와 target이 각각 하나로 확정되어야 하며, query·fragment가 붙은 로컬 specifier, percent-decoding 후 의미를 확정할 수 없는 경로, URL 정규화 결과가 디렉터리인 `.`·`..` 끝 경로는 실제 JavaScript resource로 매핑하지 않고 실패한다.

## 진단 코드와 실패 처리

adapter는 다음 조건을 안정된 코드로 보고한다. 각 진단은 `severity`, `code`, `stage`, `message`, `source`(관찰 불가 시 `null`), `referrerModuleKey`, `specifier`를 가진다. 표에 정의한 현재 코드는 모두 성공 graph를 막는 조건이며 severity는 반드시 `error`다. 현재 계약에서는 `warning`·`info`로 낮추어 성공 상태를 통과할 수 없다. 여러 문제를 한 문자열에 합치지 않고 가능한 오류를 수집하되, 불완전한 graph를 성공 상태로 반환하지 않는다.

| 코드 | 실패 조건 |
| --- | --- |
| `C02_GRAPH_CAPTURE_INCOMPLETE` | 번들러 module/dependency graph를 전부 수집하지 못했거나 capture 지점이 확인되지 않음 |
| `C02_GRAPH_UNRESOLVED_IMPORT` | 입력 import의 로컬 대상 또는 출력 target이 없음 |
| `C02_GRAPH_EXTERNAL_IMPORT` | 외부·bare import가 bundle 내부 resource로 변환되지 않음 |
| `C02_GRAPH_UNSUPPORTED_IMPORT` | parser가 읽을 수는 있지만 현재 graph 계약이 표현하지 못하는 import attribute·옵션·phase 또는 계산형 dynamic import |
| `C02_GRAPH_OUTPUT_NOT_ESM` | 출력 profile이 실제 ESM static/dynamic module 관계를 생성하지 않음 |
| `C02_GRAPH_TARGET_AMBIGUOUS` | emitted specifier가 복수 출력 chunk에 대응 |
| `C02_GRAPH_TARGET_CONFLICT` | 같은 referrer/specifier가 static·dynamic 종류에 따라 다른 target을 가리킴 |
| `C02_GRAPH_RESOURCE_MISSING` | emitted JS resource가 없거나 chunk의 자원 참조가 snapshot에 없음 |
| `C02_GRAPH_PROVENANCE_MISSING` | fixture/config/capture digest 또는 관찰 수치를 기록하지 못함 |
| `C02_GRAPH_OUTPUT_PARSE_FAILED` | 최종 JavaScript output의 문법을 ESM AST로 분석하지 못함. Acorn이 읽지 못하는 문법과 잘못된 구문을 포함한다. |

실패 snapshot은 debugging용 부분 정보를 가질 수 있으나 R15 변환기는 `build.status !== "success"` 또는 graph status 불완전이면 거부한다. adapter가 아닌 공통 validator가 중복 제거, ID 참조, specifier 충돌, 순환 안전성을 재검증한다. R15 변환은 이 JavaScript graph와 별도로 0011 CSS·font·image 자원 graph를 결합한 뒤 전체 reference closure를 검증해야 한다.

## Vite·Rspack profile 판정

번들러 이름이나 `format: "es"`·`output.module: true` 설정값만으로 ESM 호환을 선언하지 않는다. 실제 출력 바이트와 resolver/module graph를 서로 대조한다. 최종 코드에 남은 계산형 `import(expr)`와 import 옵션은 target 하나로 대응되지 않으므로 실패한다. 번들러가 유한한 후보를 여러 개의 literal ESM import로 낮춰 출력했다면 그 literal edge를 각각 확인한다.

- Vite는 `resolveId`/`moduleParsed` 등 resolver·module 관찰 결과와 `generateBundle`의 최종 output chunk `imports`, `dynamicImports`, module membership를 함께 검사한다. `writeBundle`에서 전체 output bundle의 asset/chunk 종류도 확인하며, chunk graph에 대응하지 않는 JavaScript `OutputAsset`(예: 별도 Worker 번들)은 `C02_GRAPH_CAPTURE_INCOMPLETE`로 거부한다. manifest entry만으로 emitted edge를 만들지 않는다.
- Rspack은 `moduleGraph`의 실제 dependency/module 연결과 `chunkGraph`를 관찰하고, 최종 output asset의 ESM 문법을 검사한다. 기본 runtime chunk output이 실제 ESM이 아니면 `C02_GRAPH_OUTPUT_NOT_ESM`으로 거부한다. ESM profile에서도 runtime이 계산형 import를 생성하거나 target을 파일 하나로 연결하지 못하면 `C02_GRAPH_UNSUPPORTED_IMPORT` 또는 `C02_GRAPH_TARGET_AMBIGUOUS`로 실패한다. source specifier와 emitted specifier가 달라지는 것 자체는 실패 사유가 아니다. `output.module`·`chunkFormat` 설정만으로 예외 처리하지 않는다. Rspack JS dependency API가 import phase를 노출하지 않는 경우 해당 문법을 AST로 별도 식별하거나 profile을 실패 처리한다. Rspack [ESM 출력 문서](https://v2.rspack.rs/guide/features/esm)는 application chunk와 전용 library rendering 경로를 구분한다.
- Rspack `modern-module` + `preserveModules` 후보는 고정 버전의 원시 실험에서 ESM 파일과 literal import를 출력했지만, 최종 AST의 각 literal specifier가 실제 target 파일 하나와 일치하는 adapter fixture를 통과하기 전까지는 지원 profile로 선언하지 않는다. 이는 후보를 거부한다는 뜻이 아니다.

### 고정 버전 API 근거

- Vite `8.3.1` plugin hook·`generateBundle`·module metadata: [Vite plugin API](https://github.com/vitejs/vite/blob/v8.3.1/docs/guide/api-plugin.md).
- Rolldown `1.2.12` resolution kind와 module/output 형식: [ModuleInfo types](https://github.com/rolldown/rolldown/blob/v1.2.12/packages/rolldown/src/types/module-info.ts), [output types](https://github.com/rolldown/rolldown/blob/v1.2.12/packages/rolldown/src/types/rolldown-output.ts), [resolve API](https://github.com/rolldown/rolldown/blob/v1.2.12/packages/rolldown/src/plugin/plugin-context.ts).
- Rspack `2.2.7` module graph·stats·ESM 출력: [JavaScript API 구조](https://www.rspack.dev/api/javascript-api/architecture), [Stats JSON](https://v2.rspack.rs/api/javascript-api/stats-json), [ESM 출력](https://v2.rspack.rs/guide/features/esm), [`preserveModules`](https://v2.rspack.rs/config/output#outputlibrarypreservemodules), [dynamic import codegen](https://github.com/web-infra-dev/rspack/blob/v2.2.7/crates/rspack_plugin_javascript/src/dependency/esm/import_dependency.rs).

이 조건은 Rspack 사용 불가라는 제품 결론이 아니다. source specifier를 emitted specifier와 같게 만들 것을 요구하지 않으며, 현재 adapter가 OTA용 R15 ESM graph를 증명하지 못하는 output profile만 식별한다.

## 비교 fixture와 수락 기준

기준 비교 모델은 [C02 production 비교](0008-css-bundler-c02.md), [R15 그래프 계약](0013-r15-ota-chunk-compatibility.md), 고정된 동일 source fixture를 사용한다. 각 번들러의 버전·lockfile digest·정규화한 실제 build profile digest·fixture digest·산출물 digest를 기록한다. profile에 반영하지 못한 resolver·transform/plugin 설정이 있으면 graph 완전성을 선언하지 않는다. 이 하위 계약은 JavaScript module/chunk graph와 JavaScript 출력 자원의 digest만 다룬다. CSS·폰트·이미지 자원과 그 edge는 0011 및 C02 나머지 작업에서 계속 검증한다. fixture에는 다음 동작을 서로 독립적으로 검증하는 case가 들어간다.

현재 fixture adapter 구현 근거는 [공통 snapshot validator](evidence/css-c02-module-graph-contract-2026-10-02.md), [Vite](evidence/css-c02-vite-module-graph-2026-10-02.md), [Rspack](evidence/css-c02-rspack-module-graph-2026-10-02.md)에 기록한다. Vite adapter는 Vite `8.3.1`/Rolldown `1.2.12`, Rspack adapter는 `2.2.7`의 고정 profile과 fixture만 통과했다. 이는 제품 번들러 패키지/API, 전체 R15 resource join, CSS·폰트·이미지 배포, X01 module loader, OTA 다운로드·활성화·롤백 구현이 아니다. 두 플랫폼 adapter의 범용 지원이나 교차 OS 재현성도 보장하지 않는다.

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
