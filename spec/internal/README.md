# 내부 인터페이스 명세

이 폴더에는 앱 작성자에게 공개하지 않는 Rust·C++·플랫폼 사이 호출 계약을 둡니다. 내부 ABI라도 호출자, 입력·출력, 소유권, 오류와 현재 한계를 기록합니다. 이 문서는 제품 API 지원 완료로 연결하지 않으며 상태 표시는 [공식 대장](../STATUS.md)을 따릅니다.

| 문서 | 범위 | 상태 |
| --- | --- | --- |
| [0001 · V8 부팅 실험](0001-v8-bootstrap.md) | Bun 번들, Rust FFI, V8 C++ 어댑터와 Android/iOS 빌드 smoke | 실험 전용 |
| [0002 · Rust 트리 코어](0002-rust-tree-core.md) | 노드 ID, 트리 구조, 원자적 변경 묶음과 revision | 실험 전용 |
| [0003 · 공통 문서·호스트 계약](0003-shared-host-contract.md) | DOM 호환 계층과 프레임워크 어댑터의 문서 모델, 소유권, 동기 변경과 이벤트 경계 | 제안 초안 |
| [0004 · R06 스레드·소유권 위험 분석](0004-thread-ownership-risks.md) | Isolate·문서·콜백·revision·비동기 완료·종료 경계의 위험과 검증 후보 | 검토 초안 · R06 미완료 |
| [R13 · 플랫폼 생명주기·GPU 복구](r13-platform-gpu-recovery.md) | wgpu 실험 ABI, 플랫폼 표면 수명과 복구 경계 | 실험 전용 |

## 검증 기록

- [R10 · Taffy 적합성 실험](./evidence/taffy-r10-2026-09-28.md) — 시뮬레이터·에뮬레이터 로그, 화면 캡처, fixture 범위와 해석 한계.
- [R03 · 공통 호스트 계약 검토](./evidence/r03-host-contract-review-2026-09-29.md) — 제안 계약을 기존 DOM·Rust 트리·렌더러 계획과 대조한 문서 검토 기록.
- [R06 · 스레드·소유권 소스 감사](./evidence/r06-thread-ownership-source-audit-2026-09-29.md) — V8·Rust FFI·트리·GPU 코드를 대조한 정적 조사. 경합을 실행 검증하지 않음.
- [R13 · 플랫폼 생명주기·GPU 복구](./evidence/r13-platform-gpu-recovery-2026-09-29.md) — 회전·백그라운드·오류 주입·입력 복구의 로그와 화면 캡처.
