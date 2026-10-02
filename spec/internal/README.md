# 내부 인터페이스 명세

이 폴더에는 앱 작성자에게 공개하지 않는 Rust·C++·플랫폼 사이 호출 계약을 둡니다. 내부 ABI라도 호출자, 입력·출력, 소유권, 오류와 현재 한계를 기록합니다. 이 문서는 제품 API 지원 완료로 연결하지 않으며 상태 표시는 [공식 대장](../STATUS.md)을 따릅니다.

| 문서 | 범위 | 상태 |
| --- | --- | --- |
| [0001 · V8 부팅 실험](0001-v8-bootstrap.md) | Bun 번들, Rust FFI, V8 C++ 어댑터와 Android/iOS 빌드 smoke | 실험 전용 |
| [0002 · Rust 트리 코어](0002-rust-tree-core.md) | 노드 ID, 트리 구조, 원자적 변경 묶음과 revision | 실험 전용 |
| [0003 · 공통 문서·호스트 계약](0003-shared-host-contract.md) | DOM 호환 계층과 프레임워크 어댑터의 문서 모델, 소유권, 동기 변경과 이벤트 경계 | 제안 초안 |
| [0004 · R06 스레드·소유권 위험 분석](0004-thread-ownership-risks.md) | Isolate·문서·콜백·revision·비동기 완료·종료 경계의 위험과 검증 후보 | 검토 초안 · R06 미완료 |
| [0005 · V8 런타임 세션 실험](0005-v8-runtime-session.md) | 세션별 Isolate 소유 스레드, 용량 제한 우선순위 큐, 취소·종료 경계 | 실험 전용 · R06 미완료 · 시뮬레이터 실제 V8 단일 배치 우선순위 검증 통과 |
| [0006 · JavaScript 작업 스케줄러](0006-js-task-scheduler.md) | Chromium 참고 우선순위 선택과 앱 작업 출처·프레임·취소 경계 | 시뮬레이터 실제 V8 단일 배치와 등급별 FIFO 통과 · 지속 유입 기아 미검증 |
| [0007 · 내장 UA stylesheet 자원](0007-ua-stylesheet-resource.md) | 지원 HTML 기본 CSS 자원과 읽기 전용 FFI 인터페이스 | 내부 초안 · Stylo UA cascade 미연결 |
| [0008 · C02 Vite·Rspack CSS 비교 모델](0008-css-bundler-c02.md) | CSS 산출·자원·청크·오류 위치·resolver 비교 조건 | 내부 실험 계약 · C02 미완료 |
| [0009 · 레이아웃 엔진](0009-layout-engine.md) | 코어 트리·계산 스타일 스냅샷, Taffy 입력·출력·오류 경계 | 구현 초안 `0.1.0-draft` · 제한된 Flex subset |
| [0010 · C03 Stylo DOM adapter](0010-stylo-dom-adapter-c03.md) | HostDocument snapshot에서 Stylo 문서·노드·요소·선택자 DOM으로의 변환 계약 | 내부 구현 계약 초안 `0.1.0-draft` · C03 구현 완료, 계산 스타일 제외 |
| [0011 · C02 CSS 자원 어댑터](0011-css-resource-adapter-c02.md) | Vite·Rspack 산출을 빌드 단위 공통 CSS 자원 snapshot으로 정규화 | 내부 계약 후보 `0.1.0-draft` · fixture 스파이크 전용 · 제품 API 아님 |
| [0012 · C04 stylesheet 입력 목록](0012-stylesheet-registry-c04.md) | Stylo stylesheet 파싱, CSS 출처·등록 순서와 parser 진단 보존 | 내부 구현 계약 초안 `0.1.0-draft` · cascade 계산 미연결 |
| [0016 · C04 기본 stylesheet cascade](0016-c04-basic-cascade.md) | 불변 HostDocument revision의 UA·author·inline cascade와 whitelist computed-style snapshot | fixture 전용 내부 구현 계약 `0.1.0-draft` · Chromium 비교 통과 · 제품/API 연결 미완료 |
| [0013 · R15 청크 OTA 호환 모델](0013-r15-ota-chunk-compatibility.md) | 바이너리 호환 ID, 단일 target ESM specifier 매핑이 있는 기능·청크·자원 그래프, typed edge diff·영향 scope·최초/불확실 기준 fallback, 객체 차등 전달·전체 그래프 사전 확보·target별 stale/CAS publish 경계, 로컬 영속 저장·객체 재검증·용량 보호, 서명·압축 제한·상향 sequence rollback 및 offline authorization 미결정 | 내부 설계 제안 `0.1.0-draft` · 배포/로더/API 미구현 |
| [0014 · C02 번들러 모듈 그래프 adapter](0014-c02-bundler-module-graph.md) | 입력 resolver graph와 최종 emitted ESM graph를 분리해 기능·청크·specifier 대응 및 추출 실패를 기록 | 내부 실험 계약 `0.1.0-draft` · 구현·제품 API 미완료 |
| [R13 · 플랫폼 생명주기·GPU 복구](r13-platform-gpu-recovery.md) | wgpu 실험 ABI, 플랫폼 표면 수명과 복구 경계 | 실험 전용 |

## 검증 기록

- [C01 · Chromium HTML UA 스타일 초기 비교](./evidence/css-c01-chromium-ua-2026-10-01.md) — macOS Chromium oracle와 고정 author baseline을 덮는 19개 computed value 비교 및 한계.
- [C01.2 · Chromium 단위·Flexbox·Grid 기준](./evidence/css-c01-layout-2026-10-02.md) — Chrome 154.0.8037.95의 `rem`·`em`·퍼센트·분수 Flexbox/Grid 기준값 41개와 CSS px 좌표 오차 계약. Spinon/Taffy 비교는 포함하지 않음.
- [C02 · Vite·Rspack CSS 산출 비교](./evidence/css-c02-bundler-2026-10-01.md) — production fixture의 CSS Modules·자원·청크, 기본 진단 차이와 공통 snapshot 원본 위치 근거.
- [C02.1 · Vite·Rspack CSS resolver 비교](./evidence/css-c02-resolver-2026-10-02.md) — fixture alias·package `exports`로 선택한 CSS 및 내부 `@import`의 production graph·snapshot 연결 근거.
- [C02.2 · 공통 모듈 그래프 계약 검증기](./evidence/css-c02-module-graph-contract-2026-10-02.md) — 0014 snapshot 검증·digest·최종 ESM AST parser와 통합 suite 결과.
- [C02.2 · Vite module graph adapter](./evidence/css-c02-vite-module-graph-2026-10-02.md) — Vite 8.3.1/Rolldown 1.2.12 fixture의 입력 graph·출력 ESM·resource digest 근거.
- [C02.2 · Rspack module graph adapter](./evidence/css-c02-rspack-module-graph-2026-10-02.md) — Rspack 2.2.7 fixture의 입력 graph·ESM profile 판정·출력 bytes 근거.
- [C03 · HostDocument Stylo DOM adapter](./evidence/css-c03-stylo-dom-adapter-2026-10-01.md) — Stylo DOM/selector trait 구현, 고정 snapshot fixture, 실제 selector matcher 결과와 대상별 컴파일 결과.
- [C04 · stylesheet 입력 목록](./evidence/css-c04-stylesheet-registry-2026-10-01.md) — Stylo 출처·등록 순서·진단 보존과 처리기가 없는 `@import`의 경계 검증.
- [C04.1 · 기본 cascade slice](./evidence/css-c04-basic-cascade-2026-10-03.md) — fixed Chromium reference의 computed value 80개와 Stylo 내부 cascade 비교 및 제한.
- [R15 · 청크 OTA 호환 모델](./evidence/r15-ota-chunk-model-2026-10-02.md) — 기존 OTA·C02 문서 사이의 그래프·기능 rollout·runtime 호환·서명/rollback 경계를 정리한 설계 추적 근거. 실행 기능 검증은 포함하지 않음.

- [R10 · Taffy 적합성 실험](./evidence/taffy-r10-2026-09-28.md) — 시뮬레이터·에뮬레이터 로그, 화면 캡처, fixture 범위와 해석 한계.
- [R03 · 공통 호스트 계약 검토](./evidence/r03-host-contract-review-2026-09-29.md) — 제안 계약을 기존 DOM·Rust 트리·렌더러 계획과 대조한 문서 검토 기록.
- [R06 · 스레드·소유권 소스 감사](./evidence/r06-thread-ownership-source-audit-2026-09-29.md) — V8·Rust FFI·트리·GPU 코드를 대조한 정적 조사. 경합을 실행 검증하지 않음.
- [R06 · V8 런타임 세션 실험](./evidence/r06-v8-runtime-thread-2026-09-30.md) — Android 16 에뮬레이터와 iOS 26.2 시뮬레이터의 취소·입력·세션 재생성 근거와 한계.
- [R06 · Chromium 참고 우선순위 큐](./evidence/r06-task-scheduler-2026-09-30.md) — strict-priority/FIFO 선택기, fake V8 순서 테스트, 분리 후 Rust 33개 테스트와 초기 Android·iOS 결과.
- [R06 · 실제 V8 우선순위 시뮬레이터 검증](./evidence/r06-priority-simulators-2026-09-30.md) — Android 16 에뮬레이터와 iPhone 17 Pro / iOS 26.2 시뮬레이터에서 혼합 여섯 작업의 실제 V8 선택 순서와 등급별 FIFO를 확인한 후속 기록.
- `evidence/r06-priority-android-emulator-2026-09-30.log` · `evidence/spinon-r06-priority-android-2026-09-30.png` · `evidence/r06-priority-ios-simulator-2026-09-30.log` · `evidence/spinon-r06-priority-ios-simulator-2026-09-30.png` — 원본 로그와 화면 캡처.
- `evidence/r06-ios-simulator-post-split-2026-09-30.log` · `evidence/spinon-r06-ios-post-split-2026-09-30.png` — 저장 공간 확보 뒤 현재 런타임 분리 코드로 수행한 iOS 26.2 시뮬레이터 검증 원본 로그와 화면.
- `evidence/r06-android-queue-pressure-2026-09-30.log` — 무한 JavaScript 중 주입한 UI 탭, 접수된 이벤트, 플랫폼 대기열의 명시적 거부와 세션 종료 원본 로그(저장소 파일).
- [R13 · 플랫폼 생명주기·GPU 복구](./evidence/r13-platform-gpu-recovery-2026-09-29.md) — 회전·백그라운드·오류 주입·입력 복구의 로그와 화면 캡처.
- [S02 · Taffy 레이아웃 연결](./evidence/s02-taffy-layout-2026-09-30.md) — Chromium 기준 fixture, Taffy·기존 행/열 엔진의 좌표 비교와 한계.
- `evidence/s02-basic-flex-chrome-2026-09-30.png` — 같은 fixture의 Headless Chrome 캡처.
