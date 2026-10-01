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
| [0007 · 내장 UA stylesheet 자원](0007-ua-stylesheet-resource.md) | 지원 HTML 기본 CSS 자원과 읽기 전용 FFI 인터페이스 | 내부 초안 · Stylo 미연결 |
| [R13 · 플랫폼 생명주기·GPU 복구](r13-platform-gpu-recovery.md) | wgpu 실험 ABI, 플랫폼 표면 수명과 복구 경계 | 실험 전용 |

## 검증 기록

- [C01 · Chromium HTML UA 스타일 초기 비교](./evidence/css-c01-chromium-ua-2026-10-01.md) — macOS Chromium oracle와 고정 author baseline을 덮는 19개 computed value 비교 및 한계.

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
