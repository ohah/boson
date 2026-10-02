# 0013 · R15 청크 OTA 호환 모델

**계약 버전:** `0.1.0-draft` · **상태:** 내부 설계 제안 · **제품 기능:** 미구현

## 목적과 경계

이 문서는 Android·iOS 바이너리에 포함된 런타임과 호환되는 JavaScript·CSS·이미지·폰트 그래프를 식별하고, 변경된 콘텐츠만 전달하면서도 기기에서는 일관된 전체 스냅샷을 실행하기 위한 R15 모델을 정한다. 공개 앱 API, 배포 서버, 서명 구현, 모바일 청크 로더를 정의하거나 구현 완료로 선언하지 않는다.

R15는 X01이 사용할 로컬 그래프 매니페스트의 공통 필드와 호환 규칙을 제안한다. D02는 같은 그래프 모델을 참조하는 서명된 릴리스 envelope를 확정하고, D03은 업로드·채널·대상 집단을, D04는 다운로드·활성화·복구 동작을 구현한다. C02는 번들러 산출 그래프를 이 모델의 입력으로 정규화한다. C02의 실험 snapshot은 이 문서의 제품 매니페스트가 아니다.

## 모델 결정

| 항목 | R15 제안 |
| --- | --- |
| 호환 단위 | 앱 바이너리가 제공하는 불투명 `runtimeId`의 **정확 일치**. 앱 ID·플랫폼·CPU ABI·Spinon 런타임/모듈 로더 ABI·V8 빌드와 실행 설정·호스트 API 집합·스타일 런타임 계약·GPU 장면 ABI 등 실행 의미를 바꾸는 항목이 달라지면 새 ID를 발급한다. 앱의 마케팅 버전만으로 호환을 판정하지 않는다. |
| 그래프 단위 | 매니페스트는 한 앱·한 플랫폼/ABI·한 `runtimeId`를 대상으로 하는 **완전한 목표 스냅샷**이다. 기능 진입점과 그 정적·동적 청크 및 자원 참조 전체를 열거한다. |
| 전송 단위 | 최종 변환된 JS·CSS·이미지·폰트 파일 각각을 SHA-256 콘텐츠 객체로 식별한다. 업데이트는 목표 그래프 전체를 전달하되, 기기에 검증되어 이미 있는 해시 객체는 다시 받지 않는다. 바이트 단위 바이너리 patch는 초기 형식에 넣지 않는다. |
| 기능 배포 경계 | 한 기능의 변경은 그 기능 및 바뀐 공유 의존성의 역방향 영향 범위로 계산한다. 대상 집단에 새 릴리스를 배포할 때 기기에는 완전한 새 스냅샷을 적용한다. 서로 다른 릴리스의 기능 버전을 임의로 섞지 않는다. |
| 활성화 단위 | 검증·준비가 끝난 스냅샷 참조 하나를 안전한 앱 재시작 시점에 원자적으로 전환한다. 실행 중인 V8 모듈 교체와 화면 상태 보존은 포함하지 않는다. |
| 무결성 경계 | 서명은 앱/플랫폼/ABI/`runtimeId`와 완전한 그래프, 각 리소스의 해시·크기를 인증해야 한다. 서명은 발행자 진위를, 리소스 해시는 받은 바이트의 무결성을 확인한다. 리소스 바이트 해시를 확인하기 전에는 평가·표시하지 않는다. 알고리즘·키 운영·직렬화의 정식 형식은 D02가 확정한다. |
| 실패·복구 | 그래프 호환성·참조·서명·파일 검증 중 하나라도 실패하면 후보 스냅샷 전체를 거부하고 기존 활성 스냅샷을 유지한다. 되돌릴 대상은 현재 바이너리와 같은 `runtimeId`인 마지막 정상 스냅샷 또는 해당 바이너리에 내장된 스냅샷으로 한정한다. |

### `runtimeId` 호환 규칙

바이너리는 실행 전에 자신의 `applicationId`, `target`과 `runtimeId`를 호스트가 신뢰하는 값으로 제공한다. 매니페스트가 주장하는 값만 믿지 않는다. 초기 로더는 앱 ID, 플랫폼, CPU ABI, 그래프 형식 버전과 `runtimeId`가 모두 일치할 때만 매니페스트를 허용한다. 다른 플랫폼이나 ABI의 번들, 알 수 없는 그래프 형식, 불일치 런타임은 실행하지 않는다.

`runtimeId`는 버전 범위 추측 대신 호환 가능한 바이너리 런타임 집합을 가리킨다. 최소 구성 요소는 다음과 같다.

- Spinon 런타임 ABI와 모듈 로더 ABI·모듈 형식
- V8 빌드 식별자와 실행 의미를 바꾸는 설정
- JavaScript에서 보이는 호스트 API 및 네이티브 모듈 집합
- CSS 입력 형식·스타일 계산 계약
- GPU 장면/표시 ABI
- 앱 ID, 플랫폼과 대상 CPU ABI

호환 동작을 바꾸는 구성 요소가 달라지면 새 `runtimeId`가 필요하다. 호환 변경 없는 바이너리 빌드 번호나 스토어 버전은 진단 필드로 둘 수 있지만 그 값만으로 `runtimeId`를 바꾸지는 않는다. 최초 형식은 정확 일치만 허용하며 호환 범위나 이전 ABI를 자동 추론하지 않는다.

같은 바이너리가 여러 OS 버전에서 실행될 때도 바이너리는 선언한 호스트 API 계약을 유지해야 한다. 특정 OS 버전에서만 가능한 native capability는 `runtimeId`에 적힌 API가 항상 있다는 뜻으로 취급하지 않는다. 첫 형식의 OTA 코드는 바이너리가 지원 OS 범위 전체에서 제공한다고 보장한 API만 사용할 수 있다. OS 조건부 API를 OTA 코드에서 고르려면 별도 capability 요구 필드와 기기 측 검사가 필요하며, 그 계약은 X01/D02 전에 추가해야 한다. CPU ABI만으로 OS API 호환성을 추론하지 않는다.

## 그래프 매니페스트 제안

로컬 매니페스트와 원격 릴리스는 같은 그래프 본문을 사용한다. 로컬 매니페스트에는 서명·배포 정보가 없다. D02 릴리스 envelope는 그래프 본문에 릴리스 식별·순서·서명을 덧붙인다. 아래 JSON은 필드 관계를 보여주는 초안이며 공개 API나 고정 전송 schema가 아니다.

```json
{
  "graphSchemaVersion": "1.0.0-draft",
  "applicationId": "net.example.app",
  "target": { "platform": "android", "architecture": "arm64-v8a" },
  "runtimeId": "runtime:<binary-compatibility-id>",
  "snapshotId": "snapshot:<opaque-id>",
  "features": [
    { "id": "feed", "entryChunkId": "chunk:feed" }
  ],
  "chunks": [
    {
      "id": "chunk:feed",
      "kind": "entry",
      "moduleFormat": "esm",
      "javascriptResourceId": "resource:feed-js",
      "dependencies": [
        { "kind": "static", "specifier": "./shared.js", "chunkId": "chunk:shared" },
        { "kind": "dynamic", "specifier": "./feed-detail.js", "chunkId": "chunk:feed-detail" }
      ],
      "resourceIds": ["resource:feed-css"]
    },
    {
      "id": "chunk:shared",
      "kind": "shared",
      "moduleFormat": "esm",
      "javascriptResourceId": "resource:shared-js",
      "dependencies": [],
      "resourceIds": []
    },
    {
      "id": "chunk:feed-detail",
      "kind": "dynamic",
      "moduleFormat": "esm",
      "javascriptResourceId": "resource:feed-detail-js",
      "dependencies": [],
      "resourceIds": []
    }
  ],
  "resources": [
    {
      "id": "resource:feed-js",
      "kind": "javascript",
      "objectId": "sha256:42f33d3eecd74a1d03fff5ebbd66b8574ad8b8b21b3e262ebb681cd4ab3ef831",
      "mediaType": "text/javascript"
    },
    {
      "id": "resource:shared-js",
      "kind": "javascript",
      "objectId": "sha256:b675041dfcf48b126dc24e27a8fb0efcfecf134b9d0bdae18315890216e3b14f",
      "mediaType": "text/javascript"
    },
    {
      "id": "resource:feed-detail-js",
      "kind": "javascript",
      "objectId": "sha256:e559feed815f6768fe173b8baaacf61645e5715c41d3f9cb2b6e532d58bb0e3b",
      "mediaType": "text/javascript"
    },
    {
      "id": "resource:feed-css",
      "kind": "stylesheet",
      "objectId": "sha256:019ddf9aa589f289a1348625ccb0db98bc1d7dc9fb12d5d759d27a68aaafea42",
      "mediaType": "text/css",
      "references": [
        { "kind": "stylesheet-import", "resourceId": "resource:feed-tokens" },
        { "kind": "asset-url", "resourceId": "resource:font-body" }
      ]
    },
    {
      "id": "resource:feed-tokens",
      "kind": "stylesheet",
      "objectId": "sha256:c97f0f563ac73709282f64e2a543265779e71bc342800571a4551a01e8034143",
      "mediaType": "text/css"
    },
    {
      "id": "resource:font-body",
      "kind": "font",
      "objectId": "sha256:ee4c3116854a9e5677f3e30aca56e92cb0bcbde48698920bcd48c65005321fd7",
      "mediaType": "font/woff2"
    }
  ],
  "objects": [
    { "id": "sha256:42f33d3eecd74a1d03fff5ebbd66b8574ad8b8b21b3e262ebb681cd4ab3ef831", "sizeBytes": 1234 },
    { "id": "sha256:b675041dfcf48b126dc24e27a8fb0efcfecf134b9d0bdae18315890216e3b14f", "sizeBytes": 123 },
    { "id": "sha256:e559feed815f6768fe173b8baaacf61645e5715c41d3f9cb2b6e532d58bb0e3b", "sizeBytes": 567 },
    { "id": "sha256:019ddf9aa589f289a1348625ccb0db98bc1d7dc9fb12d5d759d27a68aaafea42", "sizeBytes": 567 },
    { "id": "sha256:c97f0f563ac73709282f64e2a543265779e71bc342800571a4551a01e8034143", "sizeBytes": 88 },
    { "id": "sha256:ee4c3116854a9e5677f3e30aca56e92cb0bcbde48698920bcd48c65005321fd7", "sizeBytes": 2048 }
  ]
}
```

문서 계약 버전 `0.1.0-draft`와 예제의 `graphSchemaVersion` 값은 서로 다른 표기다. 예제 값 `1.0.0-draft`는 필드 관계를 보여주는 자리표시자이며 실제 그래프 버전 형식이나 호환 계약을 확정하지 않는다. X01/D02 구현 전에 형식과 첫 정식 버전을 정하고, 클라이언트는 자신이 지원한다고 명시한 버전만 허용한다.

예제의 SHA-256 문자열은 형식만 맞춘 가상 식별자이며 예제 바이트의 실제 digest가 아니다. `sizeBytes`도 같은 이유로 표본 수치다. 실제 fixture에서는 해당 원본 바이트에서 직접 digest와 크기를 계산해야 한다.

| 객체 | 의미와 불변 조건 |
| --- | --- |
| 그래프 본문 | `graphSchemaVersion`, `applicationId`, `target`, `runtimeId`, `snapshotId`, `features`, `chunks`, `resources`, `objects`를 가진다. 초기 클라이언트는 지원하는 정확한 그래프 버전만 읽고 모르는 버전을 거부한다. `snapshotId`는 불변 그래프 하나를 식별하며 다른 그래프 본문에 재사용하지 않는다. 파일 무결성 증명은 아니다. |
| 기능 | 앱 빌드 사이에서 유지되는 `featureId` 하나가 한 진입 청크를 가리킨다. 각 기능의 진입점에서 정적·동적 의존성을 따라 도달 가능한 그래프가 그 기능의 의존 범위다. 여러 기능이 같은 청크나 자원을 공유할 수 있다. |
| 청크 | 앱 그래프 안에서 유일한 논리 ID, `entry`·`static`·`dynamic`·`shared` 분류, 모듈 형식, JS 자원 참조 하나와 그래프 edge를 가진다. 각 정적·동적 import edge는 **최종 변환된 JS에 나타나는 정확한 module specifier**와 대상 `chunkId`를 연결한다. X01은 referrer 청크와 이 specifier 쌍으로 대상을 찾고 파일명 추측에 의존하지 않는다. 같은 source·kind·specifier가 서로 다른 대상 청크를 가리키면 그래프를 거부한다. 청크 `kind`는 번들러가 정규화한 설명용 분류이며 실행·도달 가능성은 edge의 `static`/`dynamic` 종류가 결정한다. 같은 청크가 여러 종류의 edge에서 참조될 수 있다. 같은 앱·그래프 정규화 형식에서 동일 논리 청크의 ID를 빌드 사이에 유지하고 출력 파일명이나 콘텐츠 해시로 만들지 않는다. 번들러 변경이나 ID 대응을 입증하지 못하면 전체 앱을 영향 범위로 계산한다. 순환 참조는 방문 집합으로 닫는다. 실행 순서·ESM 평가 의미는 X01 모듈 로더의 책임이다. |
| 자원 | 앱 그래프 안에서 유일한 형식 있는 참조다. `javascript`·`stylesheet`·`font`·`image` 종류, `objectId`, 진단용 MIME type과 필요한 경우 자원 edge를 가진다. 같은 앱·그래프 정규화 형식에서 동일 논리 자원 ID를 빌드 사이에 유지한다. 바이트가 바뀌면 `objectId`가 달라진다. |
| 콘텐츠 객체 | `objects`의 ID는 최종 변환 파일의 압축 전 원본 바이트에 대한 `sha256:<64 lowercase hex>`이고 `sizeBytes`는 0 이상의 정수인 그 바이트 크기다. 자원 여러 개가 같은 객체를 공유할 수 있으며 같은 바이트도 서로 다른 자원 의미로 참조될 수 있다. 저장소는 ID 기준으로 객체를 한 번만 보관한다. |
| 경로 | 로컬 파일 경로나 다운로드 URL은 호환 ID가 아니다. 저장 위치·전송 URL은 D03/D04가 해석하며, 그래프는 ID와 참조 관계만으로 닫혀 있어야 한다. 전송 압축은 객체 ID를 바꾸지 않으며, 클라이언트는 압축 해제한 원본 바이트의 크기와 hash를 확인한다. |
| 비실행 산출물 | source map·개발 로그·번들러 stats는 런타임 그래프 객체가 아니다. 디버그 심볼 배포는 별도 도구 계약으로 다룬다. |

매니페스트 검증은 빈 기능 그래프, 중복 기능·청크·자원·객체 ID, 미해결 청크·자원·객체 참조, 어느 기능 진입점에서도 도달할 수 없는 청크·자원·객체, 잘못된 digest/크기, 다른 앱·대상·런타임, 지원하지 않는 형식, 실행에 필요한 외부 CSS 자원을 거부한다. 기능 진입점은 `entry` 청크를, 각 청크의 JavaScript 참조는 `javascript` 자원을, stylesheet import edge는 `stylesheet` 자원을, asset edge는 허용된 font/image 자원을 가리켜야 한다. 각 import edge는 빈 값이 아닌 정확한 emitted module specifier를 가져야 하며, 같은 source·kind·specifier가 모호한 대상을 가리키면 거부한다. 첫 그래프 형식에서 유한한 정적 매핑으로 낮출 수 없는 계산형 `import()`는 빌드 오류다. 지원하지 않는 module type도 JS chunk로 변환·표현되지 않으면 빌드에서 거부한다. 모든 자원은 선언된 콘텐츠 객체 하나를 참조하고 모든 객체는 적어도 하나의 도달 가능한 자원에서 사용해야 한다. 그래프 순회는 같은 객체의 반복 사용과 순환 edge를 안전하게 처리해야 한다. CSS 내부의 `data:` URL은 stylesheet 객체 원본 bytes에 포함되며 별도 객체로 요청하지 않는다. 외부 CSS URL은 모바일에서 임의 요청하지 않는다. 외부 stylesheet/resource가 앱 표시의 필수 입력이면 초기 OTA 그래프는 완전한 것으로 인정하지 않고 번들러 진단으로 드러낸다. 원격 이미지처럼 앱 런타임 네트워크로 가져오는 데이터는 이 정적 OTA 객체 그래프 밖의 별도 호스트 API 계약이다.

이 검사는 **그래프 내부 참조의 닫힘**을 확인한다. 매니페스트 구조만 검사해서 원본 모듈의 import가 누락되었는지 증명할 수는 없다. C02 어댑터는 번들러의 해석된 정적·동적 의존 그래프와 CSS·asset 참조에서 완전한 런타임 그래프를 만들어야 하며, 비교 fixture로 그 투영을 검증한다. 필요한 참조 전체를 만들었다는 근거가 없으면 빌드·publish를 거부한다. 그래프 자체는 완전하지만 빌드 간 논리 ID 대응만 입증하지 못하는 경우에는 차등 영향 범위를 앱 전체로 넓힌다. 서명은 발행자가 보낸 그래프를 인증할 뿐 그래프 완전성을 별도로 증명하지 않는다. 객체 크기 상한, 그래프·입력 크기 상한과 정수 파싱 범위는 D02/D04가 확정하며 구현은 범위 밖 값을 거부한다.

## 기능별 변경과 부분 전송

릴리스마다 서버가 선택한 채널·대상 집단에 새 전체 그래프 스냅샷을 배포한다. 기능 단위는 변경 범위와 대상 롤아웃을 좁히는 기준이고, 기기에서 독립 버전의 기능들을 조립하는 권한이 아니다.

릴리스 envelope의 제안 `changeSet`은 다음 의미를 가진다.

| 필드 | 의미 |
| --- | --- |
| `baseSnapshotId` | 변경 범위를 계산할 대상 채널의 직전 snapshot. 대상 채널에 기존 snapshot이 없을 때만 생략할 수 있다. 감사·diff 기준이며 클라이언트 설치 전제는 아니다. |
| `changedFeatureIds` | 발행자가 변경 의도를 표시한 기능 ID다. 감사·설명용 힌트이며 영향 범위 검증이나 클라이언트의 그래프 조립 기준으로 신뢰하지 않는다. |
| `affectedScope` | 코드 영향 표기다. 완전한 기준·목표 diff를 입증했을 때만 `features`; 최초 발행 또는 안전한 diff가 불가능할 때는 `app`이다. 앱 설치 cohort를 선택하는 필드는 아니다. |
| `affectedFeatureIds` | `affectedScope=features`일 때 이전·목표 그래프의 기능 ID 합집합에서 정규화 도달 closure가 달라진 기능의 집합이다. `affectedScope=app`이면 빈 배열로 둬 전체 앱 fallback을 명확히 나타낸다. |
| `newObjectIds` | 비교 가능한 기준 snapshot에는 없고 목표 그래프에 필요한 콘텐츠 객체 ID다. 기준이 없거나 안전한 객체 diff를 계산하지 못하면 목표 그래프의 모든 객체를 담는다. 클라이언트는 이 목록에 의존하지 않고 목표 graph와 검증된 로컬 객체 저장소를 대조한다. |

빌드/배포 도구는 이전·목표 그래프의 기능 ID 합집합 각각에 대해 정규화된 도달 closure를 비교해 `affectedScope`와 `affectedFeatureIds`를 계산한다. 비교에는 기능 진입점, 도달 가능한 청크·자원과 객체 연결, 동작에 영향을 주는 모든 노드 필드, edge의 추가·삭제·종류·specifier·순서가 포함된다. 삭제·추가된 기능은 해당 이전·목표 closure로 비교한다. 바뀐 edge의 끝점과 그 edge에 도달하는 기능도 영향 대상으로 한다. 필드·edge 순서를 비교할 정규화 규칙은 그래프 형식에서 정의하고, 명시적으로 진단 전용인 필드 외에는 보수적으로 동작 영향 필드로 취급한다. 논리 ID 대응이나 closure 차이를 입증하지 못하면 `affectedScope=app`, `affectedFeatureIds=[]`로 처리하고 안전한 객체 diff를 입증할 수 없으면 `newObjectIds`에 목표 객체 전체를 넣는다. 첫 발행처럼 `baseSnapshotId`가 없으면 목표 앱 전체를 영향 범위로 삼고 `newObjectIds`에는 목표 그래프의 모든 객체 ID가 들어간다. 이는 기준 snapshot과의 차이일 뿐 서버 저장소에 다시 올려야 할 객체 전체를 뜻하지 않으며, D03은 전역 content-addressed 저장소에 이미 있는 객체를 재사용한다. D03은 `affectedScope`와 `affectedFeatureIds`를 검증하거나 다시 계산해야 하며 `changedFeatureIds`만으로 대상 집단을 좁히지 않는다. `changeSet`은 릴리스 설명·롤아웃 범위이며 전체 목표 그래프를 대신하거나 기능별 독립 버전을 허용하지 않는다. 기능 ID는 변경 영향과 릴리스 메모를 설명하지만 대상 집단은 앱 설치 단위의 cohort로 정한다. 기기에서 특정 기능만 따로 다른 릴리스 버전으로 활성화하지 않는다. 이 필드가 채널 승격이나 설치 허용에 영향을 주면 D02가 서명 범위에 넣는다. `baseSnapshotId` 누락은 대상 채널에 기존 snapshot이 전혀 없는 최초 발행에서만 허용한다. 채널에 snapshot이 있는데 기준 ID가 빠졌거나 현재 head와 다르면 D03은 발행을 거부한다. D03은 채널의 current head가 `baseSnapshotId`와 같은지 publish 시점에 원자적으로 비교한 뒤 새 head로 바꿔야 한다. 채널별 직렬화나 compare-and-swap으로 두 발행자가 같은 base에서 동시에 성공하는 lost update를 막는다. 다시 시도할 때는 발행자가 최신 그래프에 의도한 변경을 명시적으로 재적용해 새 전체 목표 snapshot과 diff를 만들고 다시 검증·서명해야 한다. 서버가 오래된 목표를 최신 기준에 조용히 재계산해 publish하지 않는다.

1. 발행자는 변경 의도인 `changedFeatureIds`를 제공할 수 있고, 빌드/배포기는 대상 채널 기준 그래프와 목표 그래프를 비교해 `affectedScope`와 `affectedFeatureIds`를 계산한다. 기능·청크·형식 있는 자원 ID는 빌드 간 비교가 가능하도록 같은 앱 그래프 안에서 안정적으로 정규화한다. 어댑터가 그래프 완전성을 증명하지 못하면 publish를 거부하고, 완전한 그래프에서만 논리 ID 대응을 증명하지 못하면 `affectedScope=app`으로 넓힌다.
2. 릴리스는 변경 기능의 코드만 담은 조각이 아니라, 모든 기능 진입점과 전체 의존 참조를 가진 자립 목표 그래프다. 직전 릴리스 ID는 감사·전송 최적화 힌트일 수 있지만 설치의 필수 전제는 아니다.
3. 서버에 이미 있는 콘텐츠 객체는 digest로 재사용한다. 클라이언트는 목표 그래프를 먼저 검증하고, 목표 그래프에서 도달 가능한 모든 자원 객체 중 로컬 검증 저장소에 없는 digest를 내려받는다. 동적 import는 실행을 지연하지만 첫 모델에서 객체 다운로드를 지연하지 않는다. 전송 중 객체는 임시 상태이며 완전 수신·크기·digest 확인 전 활성 스냅샷에서 보이지 않는다.
4. 대상 집단은 한 릴리스 전체를 받는다. 기능 하나만 바뀐 경우에도 목표 매니페스트는 전체 기능 구성을 나타내며 나머지 기능은 검증된 동일 digest 객체를 재사용한다.
5. 공유 청크·CSS·폰트·이미지의 digest가 바뀌면 이를 참조하는 모든 기능이 영향 범위에 포함된다. 의존성 변경이 기능 독립성을 보장하지 않으므로 “한 기능만 변경”으로 축소 표시하지 않는다.
6. 실행 중인 앱은 활성 snapshot만 읽는다. 정적·동적 청크를 포함해 목표 그래프의 모든 도달 객체가 준비되고 호환·무결성이 통과된 뒤 앱 재시작 경계에서 활성 snapshot 포인터를 한 번에 바꾼다. 동적 import는 이 검증된 로컬 객체의 실행만 늦춘다. 첫 모델은 import 시점 네트워크 다운로드를 하지 않는다. 실패하면 포인터를 바꾸지 않는다.

즉 `부분 배포`는 빌드 업로드와 기기 전송을 실제로 달라진 콘텐츠 객체로 제한하고, 영향 기능 집합을 릴리스 메모·앱 설치 cohort의 단계적 공개 범위로 사용한다. 기능 ID만으로 특정 사용자나 설치 기기가 해당 기능을 사용한다고 추정하지 않는다. 릴리스 envelope의 `changeSet`은 기준 snapshot·발행자 변경 의도·계산된 영향 기능을 기록하며, 배포 승인이나 설치에 영향을 주는 필드는 서명 대상에 포함한다. 클라이언트 설치는 `changeSet`으로 빠진 기존 그래프를 추측하지 않고 항상 완전한 목표 그래프를 읽는다. 여러 기능 변경을 함께 활성화하려면 서버가 그 조합을 담은 목표 스냅샷 하나를 발행한다. D03은 대상 채널의 현재 기준 그래프에서 새 snapshot을 만들거나, 오래된 기준으로 이전 기능을 되돌리는 발행을 거부해야 한다. CDN 객체 저장소는 불변 digest key를 사용하고 릴리스별 manifest는 논리적 snapshot을 표현한다.

## 서명·활성화·복구 경계

- D02 서명은 manifest 그래프 본문, 앱/플랫폼/ABI/`runtimeId`, 그래프 버전, sequence와 롤백 대상 등 설치 의미를 인증한다. publish CAS 대상 채널과 `baseSnapshotId`는 함께 서명 envelope에 결합한다. `affectedScope`·`affectedFeatureIds`가 publish/승인 결정에 쓰이면 그 값도 인증한다. 채널 승격·이동은 D02에서 정한 별도 권한과 서명 경계를 거친다. 서명된 그래프가 객체 digest와 크기를 포함하므로 전송 주소가 다른 바이트를 돌려주더라도 hash 검사에서 거부된다. 압축 전송 표현을 바꾸면 압축 해제 후 원본 byte 수와 digest를 다시 검증한다.
- 클라이언트는 크기 제한을 적용해 envelope를 파싱한 뒤 신뢰된 서명·앱/대상/runtime 호환성을 확인하고서만 객체 다운로드를 시작한다. 각 객체는 전체 수신 후 압축을 푼 원본 bytes에 대해 ID의 SHA-256과 `sizeBytes`를 검사한다. D04는 압축 전송 크기·압축 해제 크기·압축률·시간 상한을 streaming 처리 중 적용하고, 한도 초과 시 임시 객체를 중단·삭제해 저장 공간·메모리·CPU 고갈을 막아야 한다. 한 객체라도 실패하면 후보 릴리스 전체를 활성화하지 않는다. 엄격한 직렬화, 중복 JSON key 거부, 입력·그래프 크기 한도와 키 교체는 D02/D04가 명세한다.
- 활성 상태는 스냅샷 단위 참조 하나다. 기존 실행의 파일을 제자리에서 덮어쓰지 않고 새 객체를 staging한 다음 원자적으로 참조를 교체한다. process crash 중 반쪽짜리 그래프가 현재 상태가 되지 않아야 한다.
- 이전 스냅샷을 유지하되, 현재 바이너리의 `runtimeId`에 맞는 서명·검증 완료 그래프만 rollback 대상으로 삼는다. 새 네이티브 바이너리가 호환 ID를 바꾸면 이전 바이너리 OTA snapshot을 가져와 실행하지 않고 새 바이너리 내장 버전으로 복구한다.
- “마지막 정상” 확정 시점, 첫 실행 health check, 보관 snapshot 수·용량, rollout 중단, monotonic release sequence와 재생 공격 방지는 D02/D03/D04에서 구체화한다. D02는 sequence의 단조성 범위(앱·플랫폼·runtime·채널)와 채널 이동 규칙을 정한다. 롤백은 예전 서명 envelope를 재생하는 예외가 아니다. 이전에 검증된 콘텐츠 snapshot을 가리키는 새 롤백 명령/envelope에 해당 sequence 범위에서 더 높은 순서와 유효한 서명을 부여해야 한다. D04는 활성화 직전에 저장된 high-water sequence를 다시 검사하고 설치를 직렬화해, 늦게 도착한 오래된 후보가 이미 활성화된 새 snapshot을 덮지 못하게 한다. 활성 snapshot 포인터와 high-water sequence는 한 durable transaction으로 커밋하거나 crash 후 같은 상태로 복구하는 journal로 묶어야 한다. 앱 데이터 복원·초기화·재설치 뒤 로컬 high-water가 되돌아가는 경우의 anti-replay 보장과 오프라인 허용 범위는 D02/D04 위협 모델에서 정한다. 정확한 필드와 서명 주체는 D02가 정하고 설치 허용은 D04가 검사한다. 이 문서만으로 복구 구현이 완료되지는 않는다.

## 후속 명세 경계와 검증 조건

| 작업 | 이 모델을 사용하는 책임 |
| --- | --- |
| C02 / X02 / X03 | Vite·Rspack graph를 모듈·기능·CSS·에셋 edge로 수집하고 지원할 수 없는 참조를 진단한다. |
| X01 | 같은 graph schema의 로컬 manifest를 읽고 현재 바이너리 runtime ID와 검증한 로컬 object store를 바탕으로 ESM 정적·동적 import를 해결한다. 네트워크 OTA나 임의 외부 CSS fetch를 추가하지 않는다. |
| D02 | 서명된 전체 release envelope·digest·키 버전·schema version·반복 공격 방지 필드를 확정한다. |
| D03 | 업로드 객체와 manifest publish, channel/cohort 배정, 원자적인 base/head CAS, orphan 객체 수명, 기능 영향 범위 검증을 구현한다. |
| D04 | 다운로드 재개·용량·검증·원자 활성화·health check·rollback과 로그를 구현한다. |
| R09 / D05 | 출시 시점의 iOS·Android 배포/스토어 정책을 확인한다. 이 기술 모델은 정책 허용을 주장하지 않는다. |

실행 구현 전후에는 최소한 다음 fixture를 검증한다: 앱/플랫폼/ABI/runtime ID 불일치 거부, 모르는 graph schema 거부, 끊긴 정적·동적·CSS 자원 edge 거부, ESM 순환·공유 청크 closure, 한 기능의 JS/CSS만 변경된 digest 집합, 공유 객체 변경 시 모든 역방향 영향 기능 산출, 손상·부분 다운로드 후 활성 포인터 보존, 호환되지 않는 이전 snapshot rollback 거부, 서명된 graph의 resource bytes 변조 거부.

이 R15 산출물은 내부 설계 문서이며 공개 OTA 지원 API가 아니다. 전체 비교 기록은 [R15 검토 근거](./evidence/r15-ota-chunk-model-2026-10-02.md)를 참고한다.
