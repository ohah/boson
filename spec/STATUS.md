# 스피논 구현 상태와 API 명세 대장

**기준:** 2026-09-27 · **명세 버전:** `0.1.0-draft` · **현재 제품 지원 완료:** 없음

이 문서가 구현 상태의 공식 원본이다. 웹 미리보기의 체크박스는 개인 브라우저에 저장되는 탐색 도구이며 공식 완료 판정이 아니다. 아래 75개 항목은 현재 로드맵과 같은 ID를 사용한다. `- [ ]`는 미완료이며, PoC가 있어도 제품 API의 지원 완료를 뜻하지 않는다.

## 완료 표시 규칙

1. 기능 항목을 `- [x]`로 바꾸려면 **구현 코드와 버전 있는 API/인터페이스 명세 링크**, 지원 플랫폼·프레임워크 범위, 성공·오류·수명 동작, 사용 예제, 실제 동작 근거를 같은 PR에 넣는다. 명세가 없으면 구현 코드가 있어도 미완료다.
2. 앱 작성자에게 보이는 요소·CSS·JS API·CLI·OTA는 공개 [API 명세 목록](api/README.md)에 연결한다. 내부 트리·렌더러·V8 경계는 호출자·입출력·소유권·오류가 적힌 인터페이스 명세에 연결한다. 기존 `0001`~`0006` 제안 문서는 완료된 API 명세를 대신하지 않는다.
3. 조사·벤치마크·문서화처럼 호출 가능한 API가 없는 항목은 `API 해당 없음`으로 두되, 판정 기준·산출물과 원본 근거를 연결한 뒤 완료 표시한다.
4. 일부만 구현됐으면 해당 항목을 쪼개 하위 ID를 만들거나 지원 범위를 좁혀 명시한다. PoC, 시뮬레이터 실행, 설계 초안, 단일 플랫폼 결과만으로 세 플랫폼 지원을 체크하지 않는다.
5. 공개 API가 바뀌면 명세·예제·호환성 표·변경 이력도 같은 변경에 포함한다. 미지원 API는 이름과 진단 결과를 기록한다. 상태를 바꾼 PR에는 기기/브라우저, 빌드, 원본 증거를 남긴다.

각 항목의 `관련 계약`은 현재 제안 명세를 가리킨다. 기능 항목의 `API 명세: 미작성`은 실제 인터페이스·예제·오류 계약이 아직 게시되지 않았다는 뜻이다.

## 1. 위험 검증
- [ ] **R01 웹 호환 범위 명세** — 요소·CSS·이벤트·DOM 유사 API의 지원/미지원 표를 먼저 정한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R02 iOS 실기기 V8 검증** — JIT 없는 V8 앱을 실기기에 설치해 JS 실행·터치·메모리를 확인한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음 · PoC: 시뮬레이터 PoC
- [ ] **R03 호스트 계약 초안** — 노드 ID, 생성·수정·이동·삭제·이벤트의 공통 의미를 웹과 모바일에 맞춰 정의한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음 · PoC: 생성·삭제 PoC
- [ ] **R04 세 비교 기준 앱** — React Native Fabric·ReactLynx·Android Views/UIKit의 같은 카운터 화면을 만든다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R05 계측 계약과 원본 수집** — 실기기 전경·입력 성공·첫 유효 화면·프레임·메모리의 수집과 제외 조건을 고정한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R06 스레드·소유권 위험 표** — V8·Rust·UI 경계의 객체 수명, 동기 호출, 취소와 오류 복원 범위를 기록한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R07 Vue·Svelte 호스트 가능성** — React 전용 가정이 공통 노드 계약에 새지 않는지 작은 어댑터 실험으로 확인한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R08 GPU 출력 위험 실험** — Android·iOS에서 최소 GPU 화면과 텍스트·터치·IME·접근성 연결 가능성을 실험하고 제약을 기록한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R09 iOS 배포·OTA 정책 범위** — V8·CSS 해석·원격 JS 업데이트에 적용될 지침과 기능 변경 한계를 공식 문서로 검토한다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R10 Taffy 적합성 실험** — 노드 ID·텍스트 측정·좌표 반올림·RTL·갱신 비용을 작은 화면에서 확인한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R11 CSS 빌드 경로 실험** — Lightning CSS의 AST를 지원 문법만 담은 모바일 스타일 데이터로 변환할 수 있는지 확인한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R12 JS 라이브러리 호환 표** — V8의 ECMAScript 기능과 스피논이 별도로 제공할 타이머·네트워크·URL 등 호스트 API를 구분한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R13 플랫폼 생명주기·GPU 복구 실험** — 화면 회전·백그라운드 복귀·표면 재생성·GPU 자원 손실에서 최소 화면과 입력을 복구할 수 있는지 확인한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R14 Tailwind 생성 CSS 실험** — 작은 유틸리티 묶음을 빌드해 생성 CSS의 선택자·변수·계층·Preflight를 모바일 변환기로 판정한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R15 청크 OTA 호환 모델 초안** — 바이너리 런타임 ID, 기능별 진입점과 청크 의존성, JS·CSS·에셋 해시, 서명·롤백·기능 변경 경계를 OTA 구현 전에 정의한다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **R16 스피논 명세 초안** — UI 트리·이벤트·HTML/CSS/JS API·빌드·도구의 버전별 계약과 미정 항목을 공개하고 첫 적합성 시나리오를 정한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음

## 2. 세 플랫폼 수직 구현
- [ ] **S01 Rust 코어의 최소 모듈** — 트리·커밋·FFI를 분리하고 노드 ID 및 변경 배치 규칙을 구현한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **S02 Taffy 레이아웃 연결** — Rust 코어의 LayoutEngine 경계 뒤에 Taffy를 연결하고 기존 작은 엔진을 비교 기준으로 보존한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **S03 V8 호스트 바인딩** — Isolate·Context 수명, JS 노드 명령·이벤트 콜백·타이머·마이크로태스크·예외를 C++↔Rust에 연결한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음 · PoC: 연결 PoC
- [ ] **S04 Android·iOS GPU 적용기** — 같은 변경 배치를 GPU 장면에 반영하고 플랫폼 입력을 노드 이벤트로 돌려준다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음 · PoC: 네이티브 뷰 연결 PoC
- [ ] **S05 React 첫 어댑터** — React 호스트 작업을 스피논 명령으로 변환해 상태 변경·이벤트 해제를 확인한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **S06 최소 웹 호스트·단일 번들** — 같은 앱 코드가 브라우저 DOM과 모바일의 단일 JS 번들에서 표시되도록 Vite 개발 빌드를 연결한다. 이 단계의 단일 번들은 동적 import·청크 로더 지원을 뜻하지 않는다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API 명세: 미작성 · 근거: 없음
- [ ] **S07 GPU 텍스트·터치·화면 완료** — 플랫폼 폰트 측정과 GPU 글자 표시, 탭 히트 테스트, 접근성 이름과 실제 화면 결과를 맞춘다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **S08 초기 빌드 자동화** — Android·iOS·웹의 재현 가능한 빌드와 작은 화면 확인을 자동화한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **S09 첫 네 구현 비교** — 릴리스 빌드와 같은 실기기로 터치·첫 화면·자원 사용을 측정하고, 아직 없는 지표는 미측정으로 남긴다. 앱·입력·화면이 동등하지 않으면 순위를 내지 않는다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **S10 최소 CSS 계산** — 카운터 화면에 필요한 블록·Flex·크기·간격·색·글꼴 값을 빌드 변환과 런타임 계산으로 연결하고 웹 결과와 차이를 기록한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **S11 표면·콜백 수명 복구** — 화면 회전·백그라운드 복귀·표면 재생성 시 GPU 자원, 노드 ID, JS 콜백을 안전하게 다시 연결한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **S12 첫 개발 반복 경로** — Vite 개발 서버 변경을 감지해 Android·iOS 앱을 전체 리로드하고 콘솔·빌드 오류·소스맵 위치를 확인한다. 상태 보존 HMR은 다음 단계로 분리한다. 관련 계약: [0005-developer-tools.md](0005-developer-tools.md) · API 명세: 미작성 · 근거: 없음
- [ ] **S13 최소 스피논 CLI** — create·dev·build·doctor 명령으로 예제 생성, 웹·Android·iOS 실행과 도구 체인 진단을 한 경로에서 제공한다. 실패는 종료 코드와 원인 메시지로 구분한다. 관련 계약: [0005-developer-tools.md](0005-developer-tools.md) · API 명세: 미작성 · 근거: 없음

## 3. 실사용 UI
- [ ] **U01 CSS 빌드 변환 확장** — 수직 구현의 최소 변환을 바탕으로 Lightning CSS AST의 지원 속성·선택자를 넓히고 Tailwind 생성 CSS를 항목별로 판정한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U02 스타일 계산 확장** — 수직 구현의 최소 계산을 바탕으로 선택자 매칭·우선순위·상속·변수·단위 계산과 갱신 무효화를 구현한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U03 Flex 레이아웃** — Taffy의 Flex 결과를 웹 기준 화면과 비교하고 미지원 차이를 명시한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음 · PoC: 행·열 PoC
- [ ] **U04 폰트·텍스트** — span의 인라인 배치·줄바꿈·높이 측정·서체 대체·다국어·이모지·RTL을 처리한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U05 이미지·리소스** — 비동기 디코드·크기 측정·캐시·로컬/원격 로딩을 구현한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U06 입력과 IME** — 키보드·선택·커서·포커스·한글 조합을 플랫폼별로 확인한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U07 스크롤과 긴 목록** — 클리핑·가상화·재사용·동적 행 높이를 구현한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U08 접근성 의미 트리** — 탐색 순서·라벨·동작·동적 변경을 Android/iOS와 웹에 연결한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U09 화면 크기·미디어 규칙** — 회전·안전 영역·픽셀 비율과 지원하는 반응형 CSS 규칙을 연결한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U10 공통 라우터·화면 이동** — 경로·검색 매개변수·방문 항목의 push·replace·back을 웹 URL과 모바일 화면 스택에 연결한다. 목록→상세→뒤로 가기에서 앱 상태 복원 범위를 명시한다. 관련 계약: [0006-routing.md](0006-routing.md) · API 명세: 미작성 · 근거: 없음
- [ ] **U11 실제 앱형 데모** — 로컬 데이터로 피드·이미지·검색·상세 화면을 만들어 Android·iOS 실기기와 웹에서 만져본다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **U12 확장 시나리오 비교** — 데모의 목록·이미지·긴 글·검색·계산 경합을 네 구현에서 반복 측정한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **U13 딥링크·외부 URL·뒤로 가기** — 웹 새로고침·Android/iOS 딥링크 시작, 외부 링크, 시스템 뒤로 가기와 미등록 경로의 결과를 비교한다. 관련 계약: [0006-routing.md](0006-routing.md) · API 명세: 미작성 · 근거: 없음

## 4. 렌더러·성능
- [ ] **E01 부분 레이아웃 계산** — 오염된 서브트리만 다시 계산하고 관련 프레임만 반영한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **E02 GPU 텍스트·이미지 품질** — 글리프 캐시, 이미지 업로드, 클리핑·합성의 품질과 메모리 비용을 개선한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **E03 입력·접근성 통합 검증** — GPU 화면의 IME·선택·스크롤·접근성 의미 트리가 플랫폼 기능과 일치하는지 확인한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **E04 GPU 프레임 배치** — 변경 명령 병합·자원 재사용·불필요한 GPU 제출 제거를 구현한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **E05 스레드 스케줄러** — JS·레이아웃·UI 큐와 우선순위, 역압력, 취소 및 입력 응답을 측정하며 정한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **E06 제스처·애니메이션** — 드래그·스크롤·취소·동시 제스처와 프레임 스케줄러를 연결한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **E07 장시간·오류 회귀** — 회전, 백그라운드 복귀, 빠른 입력, 누수와 오류 복원을 확인한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **E08 시작 시간 최적화 실험** — 번들 사전 변환·V8 코드 캐시·스냅샷의 효과와 버전 호환성을 따로 측정한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음

## 5. 프레임워크·도구
- [ ] **X01 ESM·청크 로더** — 모듈·동적 import·기능별 청크 의존성·에셋 URL의 모바일 로딩을 구현한다. 활성 릴리스 스냅샷 밖의 청크는 실행하지 않는다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X02 Vite 플러그인** — 웹·모바일 프로덕션 출력과 개발 서버·소스맵을 제공한다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X03 Rspack 플러그인** — Vite와 같은 산출물 계약을 Rspack에서도 검증한다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X04 Vue 어댑터** — Vue 반응성 결과를 스피논 호스트 명령에 연결한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X05 Svelte 어댑터** — 컴파일된 UI 갱신을 같은 호스트 명령에 연결한다. 관련 계약: [0002-ui-tree-events.md](0002-ui-tree-events.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X06 웹 호환 확장** — 웹 호스트와 모바일의 지원 요소·스타일·이벤트 차이를 줄이고 문서화한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X07 개발 진단 기본** — 오류 화면·로그·소스맵·리로드와 모듈 교체 실패 시 전체 리로드를 제공한다. 관련 계약: [0005-developer-tools.md](0005-developer-tools.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X08 네이티브 모듈 계약** — 저장소·네트워크·카메라 등 권한, 호출, 콜백과 수명을 정의한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X09 Grid 레이아웃** — Taffy Grid의 트랙·간격·배치와 Flex/텍스트 측정의 상호작용을 검증한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X10 JS 호스트 API 호환** — fetch·URL·TextEncoder·스토리지 등 지원하기로 정한 API와 비동기 오류를 구현한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X11 모바일 HMR·Fast Refresh** — Vite·Rspack 변경 통지를 모바일 개발 연결로 전달하고 JS 모듈 수락·정리, React 상태 보존, CSS·에셋 갱신과 실패 시 전체 리로드를 검증한다. 관련 계약: [0005-developer-tools.md](0005-developer-tools.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X12 V8 Inspector 연결** — 개발 빌드에만 Inspector 전송 경로를 열어 Chrome DevTools의 JS 중단점·스택·소스맵·콘솔·프로파일링을 Android·iOS에서 확인한다. 관련 계약: [0005-developer-tools.md](0005-developer-tools.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X13 스피논 UI 트리 조사** — 노드 ID·계산된 스타일·레이아웃·접근성 의미·프레임 시간을 개발 도구에서 조회한다. 브라우저 DOM/Elements 자동 지원으로 표시하지 않는다. 관련 계약: [0005-developer-tools.md](0005-developer-tools.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X14 CLI 기계 판독 계약** — devices·logs·inspect·profile·doctor에 구조화 출력, 안정된 종료 코드, 버전·대상 기기 선택과 오류 분류를 제공한다. 관련 계약: [0005-developer-tools.md](0005-developer-tools.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X15 로컬 MCP 서버** — CLI·개발 서비스와 같은 진단 계약을 재사용해 프로젝트 상태·기기·로그·UI 트리·성능 자료를 resources/tools로 노출한다. stdio 로컬 연결부터 시작하고 쓰기 작업과 공개 원격 노출은 별도 판단한다. 관련 계약: [0005-developer-tools.md](0005-developer-tools.md) · API 명세: 미작성 · 근거: 없음
- [ ] **X16 명세 적합성 묶음** — 요소·속성·CSS·이벤트·API·번들 형식의 예제와 예상 결과를 웹·Android·iOS에서 반복 실행하고 버전별 지원표와 연결한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **X17 기존 라우터 연결** — React Router·TanStack Router·Vue Router의 메모리 기록을 모바일 뒤로 가기·딥링크·링크에 연결한다. TanStack의 ReactDOM·앵커 의존을 검증한다. Svelte 컴포넌트용 어댑터를 별도로 만들고 SvelteKit의 파일 경로·load 기능은 별도 호환 범위를 정한다. 관련 계약: [0006-routing.md](0006-routing.md) · API 명세: 미작성 · 근거: 없음

## 6. 배포·출시
- [ ] **D01 네이티브 컴포넌트·WebView** — 지도·미디어·카메라·WebView 삽입과 화면 수명주기를 제공한다. 관련 계약: [0003-web-surface.md](0003-web-surface.md) · API 명세: 미작성 · 근거: 없음
- [ ] **D02 릴리스 스냅샷 매니페스트** — 기능별 진입점·청크 의존성, JS·CSS·폰트·이미지 해시, 엔진·네이티브 API 호환 버전과 서명을 기록한다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API 명세: 미작성 · 근거: 없음
- [ ] **D03 CLI 배포 명령과 패키징** — 앱 바이너리와 정책상 허용되는 OTA 릴리스를 생성·검증·서명한다. 변경된 청크·에셋만 업로드하고 기능별 채널·대상 집단을 지정한다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API 명세: 미작성 · 근거: 없음
- [ ] **D04 청크 OTA 설치와 롤백** — 없는 해시의 파일만 다운로드하고 검증된 릴리스 스냅샷을 원자적으로 활성화한다. 기능별 단계적 배포, 실패 감지·자동 중지와 이전 또는 내장 버전 복원을 구현한다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API 명세: 미작성 · 근거: 없음
- [ ] **D05 OTA 정책·보안 재검토** — 초기 정책 검토 이후 바뀐 기능과 원격 코드·권한 변경 범위를 출시 시점에 다시 확인한다. 관련 계약: [0004-runtime-build.md](0004-runtime-build.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **D06 CI·실기기 회귀** — Android/iOS 빌드, 화면 일치, 입력, 누수, 업데이트/롤백을 반복 검증한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **D07 최종 네 구현 비교** — React Native·ReactLynx·네이티브 기준 앱과 모든 지원 시나리오를 다시 측정한다. 관련 계약: [0001-conformance.md](0001-conformance.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음
- [ ] **D08 버전별 명세 사이트** — 저장소 Markdown 명세에서 검색 가능한 HTML 문서를 생성해 API·지원표·예제·마이그레이션·라이선스를 버전별로 공개한다. 관련 계약: [README.md](README.md) · API: 해당 없음 · 산출물: 미완료 · 근거: 없음

## 기존 PoC의 위치

[V8 연동 비교](https://github.com/ohah/spinon/tree/main/spikes/v8-language-bridge), [동적 UI 트리](https://github.com/ohah/spinon/tree/main/spikes/dynamic-tree), [스타일·레이아웃 실험](https://github.com/ohah/spinon/tree/main/spikes/style-layout)은 위 항목을 구현할 때 참고하는 증거다. 현재 공개 스피논 API의 세 플랫폼 적합성 완료를 증명하지 않는다.
