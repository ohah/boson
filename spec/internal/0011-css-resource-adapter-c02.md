# 0011 · C02 CSS 자원 어댑터 내부 계약

**계약 버전:** `0.1.0-draft` · **상태:** 스파이크 비교 입력·출력 모델 · **제품 API:** 없음 · **C02 완료 판정:** 아님

## 목적과 경계

Vite·Rspack의 서로 다른 build graph를 CSS 자원과 청크 관계를 비교할 수 있는 공통 snapshot으로 정규화한다. 현재 스파이크의 수집 코드는 이 계약 후보를 검증하기 위한 실험 코드이며 `@spinon/*` 제품 패키지나 런타임 API가 아니다.

스파이크는 PostCSS AST와 `postcss-value-parser`로 fixture의 CSS 원본 참조 위치만 찾는다. 이 parser가 Stylo CSS 해석기나 cascade/layout 엔진 역할을 하지 않으며, production 수집기는 번들러의 실제 resolver·module/chunk graph를 기준으로 삼는다.

이 snapshot은 한 번의 로컬 빌드 안에서만 유효하다. OTA release manifest, 서명·검증, patch/delta 단위, 다운로드·설치·활성화, 런타임 캐시 ID를 정의하지 않는다. 그 경계는 R15·X01·D02의 제품 계약을 정한 뒤 따로 연결한다. 외부 CSS/이미지를 가져오지 않으며 CSS `url()`의 원본 위치를 source map에서 역산하지 않는다.

## snapshot 구조

정규화 결과는 아래 항목을 가진다. 배열 순서는 경로 또는 안정된 원본 순서로 정렬해 비교 파일이 불필요하게 흔들리지 않도록 한다.

```json
{
  "contract": { "name": "spinon.css-resource-adapter", "version": "0.1.0-draft" },
  "build": {
    "tool": "vite",
    "toolVersion": "8.3.1",
    "adapterVersion": "0.1.0-spike",
    "mode": "production",
    "status": "success",
    "fixtureSha256": "<64자리 소문자 16진수>"
  },
  "resources": [
    {
      "id": "resource:assets/app.css",
      "kind": "stylesheet",
      "outputPath": "assets/app.css",
      "mediaType": "text/css",
      "bytes": 123,
      "sha256": "<64자리 소문자 16진수>",
      "sourcePath": null
    }
  ],
  "chunks": [
    {
      "id": "chunk:app",
      "kind": "entry",
      "javascriptResourceIds": ["resource:assets/app.js"],
      "stylesheetResourceIds": ["resource:assets/app.css"],
      "assetResourceIds": ["resource:assets/logo.svg"]
    }
  ],
  "stylesheets": [
    {
      "id": "stylesheet:src/app.css",
      "sourcePath": "src/app.css",
      "sourceSha256": "<64자리 소문자 16진수>",
      "outputResourceIds": ["resource:assets/app.css"],
      "imports": [],
      "references": []
    }
  ],
  "cssModules": [],
  "diagnostics": []
}
```

## 필드 계약

| 항목 | 규칙 |
| --- | --- |
| `build` | 번들러·번들러 버전과 수집기 버전을 기록한다. `status`는 `success` 또는 `failed`다. `fixtureSha256`은 비교 fixture 전체를 상대 경로순으로 나열한 파일 경로·바이트 수·파일 SHA-256 목록의 digest다. 단일 build가 실제 소비한 resolver graph나 설정 파일의 digest를 뜻하지 않는다. |
| `resources` | 빌드 출력물의 상대 POSIX 경로, 종류, MIME, 실제 바이트 수와 SHA-256을 기록한다. 가능한 경우 입력 자원의 상대 경로를 `sourcePath`로 연결한다. 절대 경로와 OS별 구분자는 내보내지 않는다. `source-map`은 비교·진단 전용 산출물이며 chunk·앱 패키지·OTA 자원에 넣지 않는다. |
| `chunks` | `entry`·`dynamic`·`shared` 종류와 그 청크에 실제 연결된 JavaScript, stylesheet, 로컬 이미지·폰트 자원 ID를 기록한다. 서로 다른 번들러의 파일명이나 해시는 같을 필요가 없다. |
| `stylesheets` | 빌드가 소비한 각 원본 CSS 파일과 산출 CSS 파일 연결, 로컬·외부 `@import`, `url()` 참조를 기록한다. CSS 입력 파일은 청크 병합 뒤에도 독립된 source record로 남는다. `sourcePath`는 fixture 루트 안 파일의 정규화된 상대 POSIX 경로이며 fixture의 `node_modules/`도 포함한다. |
| `imports` | 원본 specifier, `local`·`external`·`data`·`fragment`·`unresolved`·`dynamic` 분류, 해석된 원본 stylesheet 경로(로컬일 때), 1부터 시작하는 원본 `line`·`column`을 기록한다. `conditions`는 specifier 뒤에 남은 media/layer/supports 조건 문자열이며, 파싱·cascade 의미를 보증하지 않는다. |
| `references` | `url()` 원본 specifier, `local`·`external`·`data`·`fragment`·`unresolved`·`dynamic` 분류, 입력 자원 경로와 출력 자원 ID(해석 가능한 로컬 자원일 때), 원본 시작 위치를 기록한다. 상대 경로는 해당 stylesheet 파일을 기준으로 해석한다. |
| `cssModules` | 원본 모듈 경로, 번들러가 제공하는 export 키와 export 모양을 기록한다. 생성 class 문자열은 번들러별로 다르며 비교 계약의 안정 ID로 쓰지 않는다. |
| `diagnostics` | severity·안정된 코드·메시지·원본 파일·1부터 시작하는 줄·열을 기록한다. 누락 로컬 import/URL은 `CSS_RESOURCE_NOT_FOUND`로 정규화하며, 빌드 오류가 난 경우에도 원본 위치를 보존한다. |

`id` 값은 한 snapshot 내부 참조용이다. 같은 파일이 다른 빌드에서 같은 ID를 가져야 한다고 약속하지 않는다. source 위치의 `column`은 사람이 읽는 1-based 열이며, 범위를 추가하면 끝 위치는 exclusive로 정의한다.

스파이크는 현재 fixture의 상대 경로와 루트 상대 경로만 직접 해석한다. 실제 제품 어댑터는 alias, package export, query suffix, symlink, package exports 조건별 resolver, bundler plugin이 제공하는 가상 모듈을 자체 파일 경로 조합으로 추측하지 않고 해당 번들러의 resolver/module graph 결과에서 받아야 한다. 이 차이가 닫히기 전에는 이 스파이크를 임의의 앱 CSS를 지원하는 adapter로 소개하지 않는다. 한 입력이 여러 출력 자원으로 변환되는 경우도 번들러 edge를 따라 정확한 `targetResourceId`를 골라야 하며, source path 하나로 출력 ID 하나를 추측하지 않는다.

C02.1의 resolver 비교 fixture는 `node_modules/`도 fixture 내부에 실제 파일로 저장해 안정적인 상대 경로 키를 만든다. 이 실험은 두 번들러가 alias와 package `exports`로 선택한 CSS 모듈을 snapshot에 보존하는지만 확인한다. symlink로 fixture 밖을 가리키는 패키지, plugin 가상 모듈, query별 모듈 정체성과 조건부 package exports는 여전히 미검증이다.

## 수집 및 실패 동작

각 번들러 수집기는 번들러 고유 manifest·module graph·stats를 읽고 위 snapshot으로 변환한다. 공통 검증은 중복 ID, 끊어진 자원 참조, 잘못된 경로, 잘못된 해시, CSS가 아닌 자원의 stylesheet 연결, 유효하지 않은 source 위치를 거부한다.

CSS parser가 로컬 `@import`나 `url()`을 발견하고 원본 경로로 파일을 찾을 수 없으면 진단을 생성한다. Vite 어댑터는 번들러의 기본 경고만 저장하지 않고 같은 원본 위치를 가진 정규 진단을 만든다. Rspack은 원래 빌드 진단과 정규 진단을 각각 보존한다. 두 번들러 모두 실패 snapshot은 `status: "failed"`, 산출 resource/chunk 없음, 원본 오류 진단을 포함한다. 둘 다 모바일 앱에서 해당 경로를 가져오거나 런타임까지 누락 상태를 미루지 않는다. 외부 URL은 외부 참조로 남고 네트워크 요청하지 않는다. `data:` URL은 원본 stylesheet 안에 유지되며 별도 자원 ID를 만들지 않는다.

CSS parser가 위치를 제공하지 못하거나 번들러 graph를 공통 필드로 대응할 수 없으면 값을 추측하지 않고 `null`/미지원 근거로 남긴다. `column`은 parser가 사용하는 UTF-16 code unit 기준으로 센다. 이 계약의 정상 fixture에서 필수 source 위치가 비면 해당 비교 조건은 실패한다.

## 검증 항목과 한계

이 버전의 fixture 검증은 다음을 비교한다.

- 같은 전체 fixture inventory digest, output resource 종류·바이트·SHA-256
- CSS Modules named/default export 차이와 local export 키
- 로컬 및 외부 `@import`, 이미지·폰트 URL, CSS 원본 source 위치
- entry/dynamic/shared chunk가 소유한 JavaScript·stylesheet와 로컬 자원 참조, `@import` 조건 suffix
- 누락 로컬 URL의 원본 위치와 Vite/Rspack 기본 진단 차이

이 snapshot은 브라우저 rendering, Stylo cascade, CSSOM, JavaScript에서 동적으로 만든 inline style, HMR, 플랫폼 자원 로더, OTA 전체·부분 배포, 런타임 원자적 활성화를 검증하지 않는다. C02 제품 완료 전에는 실제 Vite/Rspack 패키지 API, R15·X01·D02 자원 그래프, 모바일 설치·복구 흐름을 별도 구현하고 시험해야 한다.
