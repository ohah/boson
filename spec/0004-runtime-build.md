# 0004 · 실행·빌드·배포

**상태:** 제안 · **명세 버전:** `0.1.0-draft`

초기 Rust·V8 호출 경계와 플랫폼 빌드 smoke의 비공개 범위는 [내부 V8 부팅 실험](internal/0001-v8-bootstrap.md)을 참고한다. 내부 smoke는 이 제안 명세의 공개 런타임·번들 호환 계약을 완료한 것이 아니다.

## 모바일 실행 경계

모바일 앱은 V8 어댑터, 프레임워크 어댑터, 제한된 DOM façade, 별도 JavaScript 호스트 API, Rust UI 코어, 스타일·레이아웃, GPU 렌더러, Android·iOS 호스트를 별도 책임으로 둔다. DOM 작업은 Rust 문서 트리로, `fetch` 같은 네트워크 API는 별도 `NetworkHost` 계약과 전송 계층으로 간다. 두 기능은 제안 단계이며 현재 공개 지원이 아니다. 첫 엔진 목표는 Android·iOS의 같은 V8 소스 리비전이며 iOS 실기기에서는 JIT 없는 실행을 확인해야 한다.

OS 호스트는 GPU 표면, 입력·IME·접근성 연결을 제공한다. 일반 요소는 GPU로 그리지만 WebView·지도·카메라 등은 명시적인 플랫폼 컴포넌트다. 화면 회전·백그라운드 복귀·GPU 표면 재생성의 복구와 실패 표시가 첫 모바일 앱의 적합성 항목이다.

## 빌드 산출물

| 대상 | 산출물의 의미 | 첫 구현 범위 |
| --- | --- | --- |
| 웹 | 같은 앱 코드의 브라우저 DOM·CSS 빌드 | React·Vite |
| 모바일 JS | V8에 전달할 JS와 소스맵·에셋 참조 | 첫 수직 구현은 단일 번들, 배포 목표는 청크 그래프 |
| 모바일 스타일 | Stylo가 처리할 번들 CSS 자원과 원본 진단 위치 | 카운터 화면 최소 CSS |
| 앱 바이너리 | V8, Rust 코어, GPU 렌더러, 플랫폼 호스트 | Android·iOS 실기기 |

`단일 번들`은 첫 수직 구현의 임시 범위다. 정식 모바일 배포 형식은 진입점·공유 코드·기능별 JS 청크, Stylo용 CSS 자원, 폰트·이미지 에셋을 해시로 참조하는 청크 그래프를 목표로 한다. ESM 로더는 referrer 청크와 최종 변환된 JS의 정확한 module specifier로 대상 청크를 찾는다. 한 referrer/specifier는 static·dynamic edge 종류와 무관하게 하나의 대상만 가리켜야 한다. 유한한 specifier 매핑으로 낮출 수 없는 계산형 `import()`, graph에 연결되지 않은 외부 import, 번들 안으로 완전히 변환하지 못한 import attribute 또는 표현할 수 없는 module type은 빌드 오류다. ESM 청크 로딩과 동적 `import()`는 별도 적합성 관문이다. Rspack, Vue·Svelte의 산출물도 각각 검증한다. 웹과 모바일은 원본 코드가 같아도 플랫폼별 산출물은 다르다.

청크 로더는 R15의 [그래프 매니페스트 초안](internal/0013-r15-ota-chunk-compatibility.md)과 S06의 단일 번들 경로를 바탕으로 **최소 로컬 매니페스트**를 먼저 읽는다. 로컬과 원격 형식은 같은 `graphSchemaVersion`·앱/플랫폼/ABI/`runtimeId`·feature/chunk/resource graph 본문을 공유한다. 로컬 manifest는 개발·내장 실행을 위한 것이며 원격 배포 승인을 뜻하지 않는다. C02는 번들러에서 해석된 의존성 전체를 그래프로 내보내고, X01은 referrer와 exact module specifier mapping에 따라 모듈을 해결한다. D02는 이 graph 본문을 참조하는 별도 서명 릴리스 envelope와 release schema/version을 확정한다. X01은 알 수 없는 graph version을 거부해야 하며, D02에서 확정할 서명·채널·release/anti-replay 필드를 로컬 형식과 혼동하지 않는다.

## 번들·호스트 호환성

릴리스 매니페스트에는 적어도 번들 형식 버전, 필요한 엔진·호스트 API·Stylo 버전, 플랫폼, 채널, 기능 진입점과 전이 의존 그래프, JS·CSS·폰트·이미지 자원의 해시를 기록한다. 버전 문자열은 진단용으로도 남기되, 호환성 판정은 그래프 형식의 정확한 지원 버전과 바이너리가 제공한 `runtimeId` 정확 일치로 수행하며 수치 버전 범위를 추측하지 않는다. 같은 바이너리가 지원하는 OS 버전 전반에서 호스트 API 계약을 유지해야 한다. OS 조건부 API는 capability 요구·검사 계약이 정해지기 전 OTA 청크가 사용할 수 없다. 최소 로컬·개발 매니페스트는 현재 실행에 필요한 파일과 호환 버전을 식별하며, 서명·채널·원격 롤아웃을 전제하지 않는다. 릴리스 서명 형식과 호환성 거부 오류는 **미정**이다. 빌드는 미지원 요소·CSS·API를 식별 가능한 위치와 함께 진단해야 한다. 빌드 도구가 발견하지 못하는 동적 참조는 런타임 오류 계약도 필요하다.

## OTA

OTA는 React Native 앱의 JS·스타일·이미지 변경 배포 수준을 기본 목표로 하며, 스피논은 **변경된 콘텐츠 객체만 전송**하고 **기능 영향 범위와 별개로 앱 cohort를 롤아웃**하는 것을 추가 목표로 한다. R15 모델에서 목표 manifest는 전체 기능 그래프다. `affectedScope=features`는 검증된 closure diff를, `app`은 최초·불확실 기준의 전체 영향 범위를 표시하며 실제 대상 cohort는 앱 설치 단위다. 기능별 도달 closure diff는 진입점·노드 필드·객체 연결·typed edge 추가/삭제/종류/specifier/순서를 비교한다. 기준 snapshot이 없는 최초 발행은 전체 기능·객체를 대상으로 삼는다. 채널 head와 publish CAS는 앱·플랫폼·ABI·runtime·채널 조합마다 독립된다. 매니페스트 내부 검증만으로 번들 원본의 import 누락을 증명할 수 없으므로 C02 어댑터의 완전한 그래프 추출과 fixture가 선행되어야 한다. 기기에서 활성화하는 것은 서명·검증된 한 전체 snapshot이며 서로 다른 릴리스의 기능 버전을 섞지 않는다. 누락된 청크나 혼합 snapshot으로 화면을 실행하지 않는다.

업데이트는 개발 HMR과 별개다. 네이티브 코드·V8·GPU 렌더러·호스트 API·권한이 바뀌면 새 앱 바이너리가 필요하다. 실행 중인 V8 모듈을 임의로 교체하는 것은 첫 배포 목표가 아니며, 기본 활성화 시점은 다음 앱 시작 또는 안전한 전체 재시작이다. 첫 모델은 정적·동적 청크를 포함한 목표 그래프의 모든 객체를 활성화 전에 확보하고, 동적 import는 검증된 로컬 청크의 실행만 지연한다. import 시점 네트워크 다운로드는 미지원이다. 서명·해시·호환 ID 확인, streaming 전송·압축 해제 한도, 원자 활성화, 실패 감지와 저장 공간 부족 시 후보 거부를 제공한다. 재사용하는 로컬 객체도 후보 적용 전 다시 digest·크기로 검증하고 실제 JS 평가·자원 사용 전에 읽은 bytes의 digest를 확인한다. 활성 pointer·sequence high-water·복구에 필요한 객체는 OS purge 대상이 아닌 앱 전용 영속 저장소에 둔다. 이전 OTA snapshot rollback에는 더 높은 sequence와 유효 서명의 새 명령이 필요하다. 오프라인 시작 실패 시 이전 OTA snapshot을 위한 authorization 확보 방식은 D02/D04가 정하며, 이를 보장하기 전에는 오프라인 OTA rollback을 약속하지 않는다. 바이너리에 내장된 immutable snapshot은 high-water를 낮추지 않는 별도 로컬 fallback이다. 설치는 sequence high-water 기준으로 직렬화해 구버전 후보의 늦은 활성화를 거부하며, 활성 snapshot 참조와 high-water 갱신은 한 durable transaction으로 커밋하거나 복구 가능한 journal로 묶는다. 로컬 anti-replay 기준이 앱 데이터 복원·초기화·재설치로 되돌아갈 때의 보장과 오프라인 허용 정책은 D02/D04가 별도 위협 모델로 정한다. 구 envelope 재생으로 rollback하지 않는다. 플랫폼 정책과 앱 기능 변경 범위가 허용된 경우에만 출시하며, 스토어 심사 승인이나 모든 JS 기능 변경의 허용을 주장하지 않는다. 전체 목표 그래프·feature 변경 범위의 모델은 [R15 내부 설계](internal/0013-r15-ota-chunk-compatibility.md), 배포 흐름 초안은 [OTA 설계](../docs/ota-design.md)에 둔다.
