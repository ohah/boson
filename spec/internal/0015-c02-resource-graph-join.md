# 0015 · C02 JavaScript·CSS 자원 그래프 결합 계약

**계약 버전:** `0.1.0-draft` · **상태:** 내부 구현 계약 · **제품 API:** 없음 · **C02 완료 판정:** 아님

## 목적과 범위

0014의 JavaScript 입력·최종 ESM 그래프와 0011의 CSS·글꼴·이미지 출력 snapshot을 같은 번들러 실행에서 결합한다. 결과는 빌드 단위의 교차 참조 검증 자료이며 R15 논리 ID, 전체 OTA manifest, 제품 번들러 API를 뜻하지 않는다.

결합 입력은 `assertModuleGraphSnapshot`과 `assertAdapterSnapshot`을 통과한 snapshot이어야 한다. 성공 snapshot의 `build`에는 다음 결합 식별 필드가 있어야 한다.

| 필드 | 규칙 |
| --- | --- |
| `captureId` | 한 번의 production build 시작 전에 생성한 임의 UUID. 두 collector에 같은 값을 전달한다. |
| `fixtureSha256` | 두 snapshot에서 같아야 한다. fixture 전체 파일 목록 digest이며 resolver graph 자체의 증거로 취급하지 않는다. |
| `buildProfileSha256` | 같은 실제 build profile의 정규 digest여야 한다. profile 내용도 두 snapshot에서 같아야 한다. |
| `tool`, `toolVersion`, `mode` | 번들러 종류·정확한 버전이 일치해야 한다. 0011 `build.mode`와 0014 `build.profile.effectiveOptions.mode`가 모두 `production`으로 일치해야 한다. |

`captureId`만 같다고 별도 build가 같은 실행이라고 보지 않는다. 제공되는 production capture 함수가 하나의 bundler build 안에서 양 collector를 실행하고 ID·profile을 공유해야 한다. 조인 검증은 여기에 더해 JS output resource 집합과 각 파일의 경로·종류·바이트 수·SHA-256이 양 snapshot에서 완전히 같은지 확인한다. fixture digest만 같은 C02.1/C02.2 기존 산출물을 사후 조인하는 것은 금지한다.

## 조인 규칙

1. **실패·불완전 build를 거부한다.** 두 build status, 0014 source/output graph status는 모두 성공·완전이어야 한다. 그래프 진단에 오류가 있거나 Vite Worker JavaScript `OutputAsset`처럼 미포착 실행 출력이 있으면 조인을 만들지 않는다.
2. **chunk ID 문자열을 교차 키로 쓰지 않는다.** 0014 chunk의 `javascriptResourceId`와 0011 chunk의 `javascriptResourceIds` 사이의 유일한 같은-build 연결을 사용한다. 모든 JS resource는 양쪽에서 각각 정확히 한 chunk에 속해야 한다. 조인된 JS resource 경로·종류·media type·크기·SHA-256도 일치해야 한다.
3. **출력 소유 관계와 입력 출처를 분리한다.** 성공한 0014 `outputGraph`의 chunk dependency만 JS 실행 edge로 복사한다. 0014 `sourceGraph.excludedDependencies`, 0011 stylesheet `imports`·`references`는 입력 provenance로 별도 보존하며 출력 소유 관계를 대신하지 않는다.
4. **chunk 자원 연결을 투영한다.** 매칭된 0011 chunk의 `stylesheetResourceIds`와 `assetResourceIds`를 해당 0014 chunk에 복사한다. 자원 참조는 같은 0011 snapshot 안의 실제 resource ID여야 하며 stylesheet 연결은 `stylesheet`, 자산 연결은 `font`·`image` 중 지원 자원이어야 한다. 미지원 `other` resource가 chunk에 연결되면 실패한다.
5. **CSS `url()`은 정확한 출력 자원 ID를 사용한다.** 활성 stylesheet의 로컬 reference는 `targetResourceId`가 존재하고 해당 resource의 `sourcePath`가 `targetSourcePath`와 같아야 한다. 동일 입력 경로를 가진 출력 자원이 여러 개면 추측하지 않고 실패한다. 활성 stylesheet에서 필요한 external·unresolved font/image는 성공 graph에 허용하지 않는다. `data:`·fragment는 별도 자원으로 만들지 않는다.
6. **CSS `@import` 입력 관계를 보존한다.** 로컬 import 대상은 0011 stylesheet 목록에 있어야 한다. active 입력 stylesheet와 출력 CSS 자원의 대응이 유일할 때만 별도 emitted stylesheet edge를 만든다. 여러 output 후보로 정확한 대응을 증명할 수 없으면 실패한다. 비활성·tree-shaken 입력 관계는 provenance에 남기며 런타임 edge로 만들지 않는다. 활성 stylesheet에 필요한 external·unresolved import는 실패한다.
7. **닫힘을 검사한다.** 각 출력 chunk와 참조된 runtime resource는 feature entry에서 최종 JS static/dynamic edge와 chunk 소유 자원 edge를 따라 도달 가능해야 한다. 사용되지 않는 출력 stylesheet·font·image는 orphan으로 실패한다. source map 등 알려진 비실행 산출물은 출력 graph에서 제외할 수 있으나 chunk·stylesheet reference에서 가리키면 안 된다.
8. **논리 ID를 만들지 않는다.** `resource:<outputPath>`, 번들러 chunk ID, CSS module 경로는 build-local 식별자다. R15 `logicalId`·`objectId` 또는 빌드 간 OTA 변경 범위로 승격하지 않는다.

조인 snapshot은 capture metadata, 원본 0011·0014 digest, feature, JS chunk, runtime resource, chunk/resource edge, source provenance, 오류 진단을 보존한다. 이 산출물은 같은 fixture build 안의 그래프 연결만 주장한다. R15 소비자는 추후 안정 논리 ID, 출력 CSS의 최종 규칙·참조 보존, 앱 전체 source coverage, platform/runtime compatibility를 추가 검증해야 한다.

## 실패 코드

| 코드 | 실패 조건 |
| --- | --- |
| `C02_JOIN_BUILD_MISMATCH` | capture ID, bundler/version/mode, fixture digest 또는 build profile이 다름 |
| `C02_JOIN_GRAPH_INCOMPLETE` | 한 component build나 graph가 실패·불완전 또는 오류 진단 보유 |
| `C02_JOIN_JS_RESOURCE_MISMATCH` | JS 출력 resource 집합·경로·종류·바이트·digest 불일치 또는 chunk 연결이 일대일이 아님 |
| `C02_JOIN_RESOURCE_MISSING` | 출력 chunk·CSS 참조가 가리키는 runtime resource가 없음 |
| `C02_JOIN_TARGET_AMBIGUOUS` | sourcePath 또는 stylesheet input edge가 여러 출력 자원 후보에 대응 |
| `C02_JOIN_RESOURCE_KIND_UNSUPPORTED` | runtime chunk/resource edge가 계약에 없는 resource kind를 가리킴 |
| `C02_JOIN_EXTERNAL_RESOURCE` | 활성 CSS 출력에 필요한 external/unresolved CSS·font·image 참조가 있음 |
| `C02_JOIN_ORPHAN_RESOURCE` | feature 진입점에서 닿지 않는 runtime chunk/resource가 남음 |

모든 코드는 build를 실패시킨다. 실패한 component snapshot을 부분 조인 결과로 반환하지 않는다.

## 비교 모델과 수락 기준

기준은 [C02 production 비교 모델](0008-css-bundler-c02.md), 0011, 0014, [R15 graph 초안](0013-r15-ota-chunk-compatibility.md)이다. Vite `8.3.1`/Rolldown `1.2.12`와 Rspack `2.2.7` 각각에서 하나의 고정 fixture·한 번의 production build에 두 collector를 함께 넣는다. 테스트 전 판정 기준은 다음과 같다.

- entry·dynamic feature에 JS chunk, extracted stylesheet, CSS `@import`, CSS URL image/font, JS-imported image가 정확히 연결된다.
- 같은 JS 출력 바이트를 서로 다른 component chunk ID 규칙과 무관하게 유일하게 조인한다.
- chunk ID/resource ID 누락·중복·바이트 변경, capture/profile 불일치, active external/unresolved 자원, ambiguous sourcePath, orphan runtime resource를 각각 실패시킨다.
- tree-shaken source module의 입력 provenance가 emitted runtime edge로 잘못 승격되지 않는다.
- 반복 build의 fixture·profile·resource graph digest를 비교한다. 이 검증은 다른 OS·번들러 버전의 결정론을 주장하지 않는다.

고정 버전 adapter fixture 통과는 제품 adapter/API, 모든 plugin·resolver, 완전한 R15 그래프, Web HMR/CDP, OTA 생성·배포·활성화·rollback 검증이 아니다.
