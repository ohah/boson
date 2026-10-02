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
        { "kind": "static", "chunkId": "chunk:shared" },
        { "kind": "dynamic", "chunkId": "chunk:feed-detail" }
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
      "objectId": "sha256:<feed-js-digest>",
      "mediaType": "text/javascript"
    },
    {
      "id": "resource:shared-js",
      "kind": "javascript",
      "objectId": "sha256:<shared-js-digest>",
      "mediaType": "text/javascript"
    },
    {
      "id": "resource:feed-detail-js",
      "kind": "javascript",
      "objectId": "sha256:<feed-detail-js-digest>",
      "mediaType": "text/javascript"
    },
    {
      "id": "resource:feed-css",
      "kind": "stylesheet",
      "objectId": "sha256:<feed-css-digest>",
      "mediaType": "text/css",
      "references": [
        { "kind": "stylesheet-import", "resourceId": "resource:feed-tokens" },
        { "kind": "asset-url", "resourceId": "resource:font-body" }
      ]
    },
    {
      "id": "resource:feed-tokens",
      "kind": "stylesheet",
      "objectId": "sha256:<tokens-digest>",
      "mediaType": "text/css"
    },
    {
      "id": "resource:font-body",
      "kind": "font",
      "objectId": "sha256:<font-digest>",
      "mediaType": "font/woff2"
    }
  ],
  "objects": [
    { "id": "sha256:<feed-js-digest>", "sizeBytes": 1234 },
    { "id": "sha256:<shared-js-digest>", "sizeBytes": 123 },
    { "id": "sha256:<feed-detail-js-digest>", "sizeBytes": 567 },
    { "id": "sha256:<feed-css-digest>", "sizeBytes": 567 },
    { "id": "sha256:<tokens-digest>", "sizeBytes": 88 },
    { "id": "sha256:<font-digest>", "sizeBytes": 2048 }
  ]
}
```

문서 계약 버전 `0.1.0-draft`와 예제의 `graphSchemaVersion` 값은 서로 다른 표기다. 예제 값 `1.0.0-draft`는 필드 관계를 보여주는 자리표시자이며 실제 그래프 버전 형식이나 호환 계약을 확정하지 않는다. X01/D02 구현 전에 형식과 첫 정식 버전을 정하고, 클라이언트는 자신이 지원한다고 명시한 버전만 허용한다.

| 객체 | 의미와 불변 조건 |
| --- | --- |
| 그래프 본문 | `graphSchemaVersion`, `applicationId`, `target`, `runtimeId`, `snapshotId`, `features`, `chunks`, `resources`, `objects`를 가진다. 초기 클라이언트는 지원하는 정확한 그래프 버전만 읽고 모르는 버전을 거부한다. `snapshotId`는 그래프 식별자이며 파일 무결성 증명이 아니다. |
| 기능 | 앱 빌드 사이에서 유지되는 `featureId` 하나가 한 진입 청크를 가리킨다. 각 기능의 진입점에서 정적·동적 의존성을 따라 도달 가능한 그래프가 그 기능의 의존 범위다. 여러 기능이 같은 청크나 자원을 공유할 수 있다. |
| 청크 | 앱 그래프 안에서 유일한 논리 ID, `entry`·`static`·`dynamic`·`shared` 종류, 모듈 형식, JS 자원 참조 하나와 그래프 edge를 가진다. 같은 앱·그래프 정규화 형식에서 동일 논리 청크의 ID를 빌드 사이에 유지하고 출력 파일명이나 콘텐츠 해시로 만들지 않는다. 번들러 변경이나 ID 대응을 입증하지 못하면 전체 앱을 영향 범위로 계산한다. static/dynamic edge를 모두 기록하며 순환 참조는 방문 집합으로 닫는다. 실행 순서·ESM 평가 의미는 X01 모듈 로더의 책임이다. |
| 자원 | 앱 그래프 안에서 유일한 형식 있는 참조다. `javascript`·`stylesheet`·`font`·`image` 종류, `objectId`, 진단용 MIME type과 필요한 경우 자원 edge를 가진다. 같은 앱·그래프 정규화 형식에서 동일 논리 자원 ID를 빌드 사이에 유지한다. 바이트가 바뀌면 `objectId`가 달라진다. |
| 콘텐츠 객체 | `objects`의 ID는 최종 변환 파일의 압축 전 원본 바이트에 대한 `sha256:<64 lowercase hex>`이고 `sizeBytes`는 그 바이트 크기다. 자원 여러 개가 같은 객체를 공유할 수 있으며 같은 바이트도 서로 다른 자원 의미로 참조될 수 있다. 저장소는 ID 기준으로 객체를 한 번만 보관한다. |
| 경로 | 로컬 파일 경로나 다운로드 URL은 호환 ID가 아니다. 저장 위치·전송 URL은 D03/D04가 해석하며, 그래프는 ID와 참조 관계만으로 닫혀 있어야 한다. 전송 압축은 객체 ID를 바꾸지 않으며, 클라이언트는 압축 해제한 원본 바이트의 크기와 hash를 확인한다. |
| 비실행 산출물 | source map·개발 로그·번들러 stats는 런타임 그래프 객체가 아니다. 디버그 심볼 배포는 별도 도구 계약으로 다룬다. |

매니페스트 검증은 중복 기능·청크·자원·객체 ID, 미해결 청크·자원·객체 참조, 참조되지 않는 그래프 객체, 잘못된 digest/크기, 다른 앱·대상·런타임, 지원하지 않는 형식, 빠진 기능 의존성, 실행에 필요한 외부 CSS 자원을 거부한다. 기능 진입점은 `entry` 청크를, 청크의 JavaScript 참조는 `javascript` 자원을, stylesheet import edge는 `stylesheet` 자원을, asset edge는 허용된 font/image 자원을 가리켜야 한다. 모든 자원은 선언된 콘텐츠 객체 하나를 참조하고 모든 객체는 적어도 하나의 도달 가능한 자원에서 사용해야 한다. 그래프 순회는 같은 객체의 반복 사용과 순환 edge를 안전하게 처리해야 한다. CSS 내부의 `data:` URL은 stylesheet 객체 원본 bytes에 포함되며 별도 객체로 요청하지 않는다. 외부 CSS URL은 모바일에서 임의 요청하지 않는다. 외부 stylesheet/resource가 앱 표시의 필수 입력이면 초기 OTA 그래프는 완전한 것으로 인정하지 않고 번들러 진단으로 드러낸다. 원격 이미지처럼 앱 런타임 네트워크로 가져오는 데이터는 이 정적 OTA 객체 그래프 밖의 별도 호스트 API 계약이다.

## 기능별 변경과 부분 전송

릴리스마다 서버가 선택한 채널·대상 집단에 새 전체 그래프 스냅샷을 배포한다. 기능 단위는 변경 범위와 대상 롤아웃을 좁히는 기준이고, 기기에서 독립 버전의 기능들을 조립하는 권한이 아니다.

릴리스 envelope의 제안 `changeSet`은 다음 의미를 가진다.

| 필드 | 의미 |
| --- | --- |
| `baseSnapshotId` | 변경 범위를 계산할 대상 채널의 직전 snapshot. 첫 배포에는 없을 수 있다. 감사·diff 기준이며 클라이언트 설치 전제는 아니다. |
| `changedFeatureIds` | 발행자가 변경 의도를 표시한 기능 ID다. 감사·설명용 힌트이며 영향 범위 검증이나 클라이언트의 그래프 조립 기준으로 신뢰하지 않는다. |
| `affectedFeatureIds` | 기준·목표 그래프를 비교해 계산한 영향 기능 집합이다. 기능별 그래프의 이전/새 도달 closure 중 추가·삭제·변경된 논리 노드(기능·청크·자원) 또는 객체 연결이 있으면 그 기능을 포함한다. |
| `newObjectIds` | 기준 snapshot에는 없고 목표 그래프에 필요한 콘텐츠 객체 ID다. 클라이언트는 이 목록에 의존하지 않고 목표 graph와 검증된 로컬 객체 저장소를 대조한다. |

빌드/배포 도구는 기준·목표 그래프에서 기능·청크·자원 노드와 객체 연결의 추가·삭제·변경을 비교하고, 이전과 새 기능 closure를 모두 순회해 `affectedFeatureIds`를 계산한다. 논리 ID 대응이나 그래프 차이를 입증하지 못하면 전체 앱 기능을 영향 범위로 삼는다. D03은 전달된 `affectedFeatureIds`를 검증하거나 다시 계산해야 하며 `changedFeatureIds`만으로 대상 집단을 좁히지 않는다. `changeSet`은 릴리스 설명·롤아웃 범위이며 전체 목표 그래프를 대신하거나 기능별 독립 버전을 허용하지 않는다. 이 필드가 채널 승격이나 설치 허용에 영향을 주면 D02가 서명 범위에 넣는다. `baseSnapshotId`가 오래됐거나 채널의 최신 목표에서 파생되지 않은 publish는 D03이 거부하거나 최신 기준으로 다시 계산해야 한다.

1. 빌드기가 대상 채널의 기준 그래프와 새 그래프를 비교해 바뀐 `featureId`와 공유 의존성의 역방향 영향 기능을 계산한다. 기능·청크·형식 있는 자원 ID는 빌드 간 비교가 가능하도록 같은 앱 그래프 안에서 안정적으로 정규화한다. 어댑터가 대응 관계를 증명할 수 없으면 영향 범위를 전체 앱으로 넓힌다.
2. 릴리스는 변경 기능의 코드만 담은 조각이 아니라, 모든 기능 진입점과 전체 의존 참조를 가진 자립 목표 그래프다. 직전 릴리스 ID는 감사·전송 최적화 힌트일 수 있지만 설치의 필수 전제는 아니다.
3. 서버에 이미 있는 콘텐츠 객체는 digest로 재사용한다. 클라이언트는 목표 그래프를 먼저 검증하고, 목표 그래프에서 요구되나 로컬 검증 저장소에 없는 digest만 내려받는다. 전송 중 객체는 임시 상태이며 완전 수신·크기·digest 확인 전 활성 스냅샷에서 보이지 않는다.
4. 대상 집단은 한 릴리스 전체를 받는다. 기능 하나만 바뀐 경우에도 목표 매니페스트는 전체 기능 구성을 나타내며 나머지 기능은 검증된 동일 digest 객체를 재사용한다.
5. 공유 청크·CSS·폰트·이미지의 digest가 바뀌면 이를 참조하는 모든 기능이 영향 범위에 포함된다. 의존성 변경이 기능 독립성을 보장하지 않으므로 “한 기능만 변경”으로 축소 표시하지 않는다.
6. 실행 중인 앱은 활성 snapshot만 읽는다. 목표에 필요한 모든 자원이 준비되고 호환·무결성이 통과된 뒤 앱 재시작 경계에서 활성 snapshot 포인터를 한 번에 바꾼다. 실패하면 포인터를 바꾸지 않는다.

즉 `부분 배포`는 빌드 업로드와 기기 전송을 실제로 달라진 콘텐츠 객체로 제한하고, 롤아웃 대상은 영향받은 기능 변경으로 선택하는 뜻이다. 릴리스 envelope의 `changeSet`은 기준 snapshot·변경/영향 기능을 기록하며, 그 범위가 배포 승인이나 설치에 영향을 주면 서명 대상에 포함한다. 클라이언트 설치는 `changeSet`으로 빠진 기존 그래프를 추측하지 않고 항상 완전한 목표 그래프를 읽는다. 여러 기능 변경을 함께 활성화하려면 서버가 그 조합을 담은 목표 스냅샷 하나를 발행한다. D03은 대상 채널의 현재 기준 그래프에서 새 snapshot을 만들거나, 오래된 기준으로 이전 기능을 되돌리는 발행을 거부해야 한다. CDN 객체 저장소는 불변 digest key를 사용하고 릴리스별 manifest는 논리적 snapshot을 표현한다.

## 서명·활성화·복구 경계

- D02가 서명할 때는 manifest 그래프 본문, 앱/플랫폼/ABI/`runtimeId`, 그래프 버전과 설치 순서에 영향을 주는 릴리스 필드를 모두 인증한다. 서명된 그래프가 객체 digest와 크기를 포함하므로 전송 주소가 다른 바이트를 돌려주더라도 hash 검사에서 거부된다. 압축 전송 표현을 바꾸면 압축 해제 후 원본 byte 수와 digest를 다시 검증한다.
- 클라이언트는 크기 제한을 적용해 envelope를 파싱한 뒤 신뢰된 서명·앱/대상/runtime 호환성을 확인하고서만 객체 다운로드를 시작한다. 각 객체는 전체 수신 후 압축을 푼 원본 bytes에 대해 ID의 SHA-256과 `sizeBytes`를 검사한다. 한 객체라도 실패하면 후보 릴리스 전체를 활성화하지 않는다. 엄격한 직렬화, 중복 JSON key 거부, 입력·그래프 크기 한도와 키 교체는 D02/D04가 명세한다.
- 활성 상태는 스냅샷 단위 참조 하나다. 기존 실행의 파일을 제자리에서 덮어쓰지 않고 새 객체를 staging한 다음 원자적으로 참조를 교체한다. process crash 중 반쪽짜리 그래프가 현재 상태가 되지 않아야 한다.
- 이전 스냅샷을 유지하되, 현재 바이너리의 `runtimeId`에 맞는 서명·검증 완료 그래프만 rollback 대상으로 삼는다. 새 네이티브 바이너리가 호환 ID를 바꾸면 이전 바이너리 OTA snapshot을 가져와 실행하지 않고 새 바이너리 내장 버전으로 복구한다.
- “마지막 정상” 확정 시점, 첫 실행 health check, 보관 snapshot 수·용량, rollout 중단, monotonic release sequence와 재생 공격 방지는 D02/D03/D04에서 구체화한다. 이 문서만으로 복구 구현이 완료되지는 않는다.

## 후속 명세 경계와 검증 조건

| 작업 | 이 모델을 사용하는 책임 |
| --- | --- |
| C02 / X02 / X03 | Vite·Rspack graph를 모듈·기능·CSS·에셋 edge로 수집하고 지원할 수 없는 참조를 진단한다. |
| X01 | 같은 graph schema의 로컬 manifest를 읽고 현재 바이너리 runtime ID와 검증한 로컬 object store를 바탕으로 ESM 정적·동적 import를 해결한다. 네트워크 OTA나 임의 외부 CSS fetch를 추가하지 않는다. |
| D02 | 서명된 전체 release envelope·digest·키 버전·schema version·반복 공격 방지 필드를 확정한다. |
| D03 | 업로드 객체와 manifest publish, channel/cohort 배정, 기능 변경 대상의 roll-out 제어를 구현한다. |
| D04 | 다운로드 재개·용량·검증·원자 활성화·health check·rollback과 로그를 구현한다. |
| R09 / D05 | 출시 시점의 iOS·Android 배포/스토어 정책을 확인한다. 이 기술 모델은 정책 허용을 주장하지 않는다. |

실행 구현 전후에는 최소한 다음 fixture를 검증한다: 앱/플랫폼/ABI/runtime ID 불일치 거부, 모르는 graph schema 거부, 끊긴 정적·동적·CSS 자원 edge 거부, ESM 순환·공유 청크 closure, 한 기능의 JS/CSS만 변경된 digest 집합, 공유 객체 변경 시 모든 역방향 영향 기능 산출, 손상·부분 다운로드 후 활성 포인터 보존, 호환되지 않는 이전 snapshot rollback 거부, 서명된 graph의 resource bytes 변조 거부.

이 R15 산출물은 내부 설계 문서이며 공개 OTA 지원 API가 아니다. 전체 비교 기록은 [R15 검토 근거](./evidence/r15-ota-chunk-model-2026-10-02.md)를 참고한다.
