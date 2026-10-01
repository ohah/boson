# R03 HostDocument 구현 전 비교 모델

**작업:** R03 Rust 문서 모델 기반
**비교 기준:** 내부 인터페이스 `0003-shared-host-contract.md`의 원자 변경·혼합 자식·소유권·revision 규칙
**기준 실행:** `cargo test --locked -p spinon-core`
**대상:** Rust 코어 라이브러리; Android/iOS 연결은 이 변경 범위가 아님

## 현재 관찰

기존 `spinon_core::Tree`는 요소처럼 보이는 태그 노드와 노드별 선택 텍스트, 단일 연결 루트, 제거 시 재귀 삭제를 제공한다. 별도 `Text` 노드, namespace, 속성, 스타일 상태, 서로 다른 소유자의 형제 노드, 분리 노드 재삽입은 표현하지 않는다. 기준 테스트는 16개가 모두 통과했다. 기존 트리를 DOM 트리로 간주하지 않는다.

## 구현 전 합격 기준

1. 요소·텍스트 노드의 혼합 순서를 유지하고, 노드 핸들로 부모·형제·namespace·속성·상태를 조회한다.
2. 분리 생성·변경은 문서 revision만 올리고, 연결 표시 트리에 영향을 주는 변경은 문서와 표시 revision을 각각 한 번 올린다.
3. 제거는 노드를 폐기하지 않고 분리한다. 같은 문서 세대에서 ID를 다시 예약하거나 생성하지 않는다.
4. 서로 다른 소유자 노드는 내부 HostRoot 아래 형제로 공존하지만 다른 소유자의 서브트리를 변경할 수 없다.
5. 잘못된 revision·소유권·부모·순환·위치 중 하나라도 있으면 묶음 전체가 이전 트리와 revision을 보존한다.
6. 변경 없는 묶음과 실질 상태 변경이 없는 호출은 revision을 올리지 않는다.
7. 텍스트와 속성값은 UTF-16 코드 단위를 보존한다. CSSOM 객체·CSS 계산·레이아웃·GPU 연결이 제공됐다고 주장하지 않는다.

## 비교 방법과 허용치

이 범위에는 별도 브라우저 oracle이 없다. 판정은 위 내부 불변 조건으로 한다. 구조·노드 종류·소유자·속성·revision은 정확히 같아야 한다. 실패 묶음 전후 문서 snapshot의 동등성을 검사한다. 좌표·CSS 계산·픽셀 오차는 이 작업에서 측정하지 않는다.

## 재검증 기록

구현 후 `cargo test --locked -p spinon-core`는 **27개 테스트 모두 통과**했고, `cargo test --locked --workspace`는 전체 **59개 테스트 모두 통과**했다. `cargo fmt --all -- --check`와 `git diff --check`도 통과했다. Rust 코어는 Android ARM64, iOS device ARM64, iOS simulator ARM64 대상으로 각각 `cargo check --locked -p spinon-core --target ...`을 통과했다. 이 검증은 Rust 코어 컴파일이며 앱 패키지·V8·Stylo·GPU 통합 검증은 아니다. 실행 환경은 Apple Silicon Mac Studio, macOS `26.5.1` / Darwin `25.5.0`, Rust `1.96.1`이다.

## 적대적 검증 5회

| 회차 | 공격 관점 | 발견과 조치 | 확인 사례 |
| --- | --- | --- | --- |
| 1 | 원자성·revision | 서로 상쇄되는 속성 변경·트리 이동 작업도 revision을 올릴 수 있었다. 작업 중간 효과 대신 최종 문서와 연결 표시 투영을 baseline과 비교하도록 바꿨다. | `no_op_and_empty_batches_do_not_advance_revisions`, 순환·revision 소진 원자성 |
| 2 | 소유자 격리 | HostRoot의 다른 Owner 노드를 `before` 참조로 사용해 상대 노드와의 순서를 바꿀 수 있었다. 참조 노드도 변경 Owner와 일치하도록 검증한다. | `batches_preserve_mixed_owner_siblings_without_crossing_ownership` |
| 3 | 삽입·이동·분리 의미 | 자기 참조, 동일 위치, 같은 부모 재정렬, 잘못된 부모 참조, cycle, 분리 후 재삽입을 점검했다. 마지막 index 계산과 validation-before-mutation을 유지하고 각 경우를 fixture 테스트로 고정했다. | `insert_before_uses_final_order_and_invalid_references_are_atomic`, `detached_changes_and_connected_changes_advance_separate_revisions` |
| 4 | 데이터·핸들 신선도 | mixed Element/Text 순서, namespace 있는 속성, 요소 상태, 단독 UTF-16 surrogate, 다른 문서 generation과 오래된 revision을 확인했다. 정확한 code units와 잘못된 묶음의 이전 snapshot 보존을 요구한다. | `mixed_nodes_attributes_state_and_sibling_order_are_preserved`, `utf16_surrogate_units_survive_text_and_text_content_reads`, `stale_generation_and_stale_revision_are_rejected` |
| 5 | 경계·고갈·플랫폼 범위 | 마지막 nonzero NodeId, 두 revision의 소진, 전체 snapshot 복사와 미구현 GC·Owner 발급·플랫폼/Stylo 연결을 점검했다. 고갈도 원자 거부로 시험하고 미검증 범위를 내부 계약에 남겼다. | `node_id_allocator_uses_the_last_nonzero_id_then_stops`, `revision_exhaustion_never_publishes_a_partial_candidate`, 3 target `cargo check` |

검토 후 남은 제품 게이트는 Stylo DOM trait 연결, C03 적합성 fixture, OwnerId 발급·복구, 노드 회수/메모리 상한, 비용을 개선할 불변·부분 snapshot, V8/Android/iOS 앱 통합이다. 이 R03 코어 결과만으로 DOM 또는 CSS 지원을 완료 표시하지 않는다.

## 모듈화·Rust 도구 추가 적대적 검증 5회 — 2026-10-01

이번 재검토는 기존 동작 검증을 재사용하지 않고 `document.rs` 구조 분리, Rust 관례, FFI 안전 경계와 빌드 도구 규칙을 별도 공격 관점으로 확인했다.

| 회차 | 공격 관점 | 발견과 조치 | 확인 근거 |
| --- | --- | --- | --- |
| 1 | 1,666줄 문서 모듈의 변경 영향과 책임 혼합 | 공개 모듈 facade, 자료형, 변경 적용, snapshot 조회, 테스트로 나눴다. 내부 자료형 접근은 하위 모듈에 한정했고 공개 API 재수출은 기존 경로를 유지했다. | `document.rs` 167줄, `document/types.rs` 482줄, `document/mutation.rs` 422줄, `document/snapshot.rs` 140줄, `document/tests.rs` 491줄; 코어 테스트 27개 통과 |
| 2 | API 이름이 표준 trait와 혼동되는지 | `DomString::from_str`는 `FromStr` 구현처럼 보인다는 Clippy 지적을 받았다. `from_rust_str`로 이름을 바꾸고 `From<&str>`·`From<String>` 변환은 유지했다. | 전체 워크스페이스 Clippy 및 테스트 통과 |
| 3 | 진단 출력 인자 순서·누락 위험 | 11개 위치 인자를 받던 런타임 진단 포맷 함수를 `OperationReport` 입력 구조체로 바꿨다. 기존 보고 필드를 명시적으로 옮기고 호출 스레드·대기 시간·V8 시간 회귀 단언을 유지했다. | `report_exposes_caller_owner_callback_threads_and_timings`; 런타임 테스트 6개 통과 |
| 4 | unwrap과 FFI 포인터 계약의 안전성 | 레거시 트리의 검사 후 `expect` 두 곳을 분기 기반으로 바꾸고, 공개 unsafe C 함수에 포인터 길이·문자열 계약을 `# Safety`로 문서화했다. | 기본 및 `r10-experiment` FFI Clippy 통과; 전체 Clippy `-D warnings` 통과 |
| 5 | 규칙 중복·포매터 설정·플랫폼별 컴파일 누락 | `AGENTS.md`는 규칙 문서 링크만 유지하고 상세 규칙은 `docs/project-rules.md`에 모았다. 루트 `rustfmt.toml`에 Edition 2024와 100열 폭을 고정했다. | `cargo fmt --all -- --check`, `git diff --check`, 전체 테스트 59개, iOS 기기·시뮬레이터 및 Android ARM64 `cargo check` 통과 |

전체 Clippy 명령은 `cargo clippy --locked --workspace --all-targets -- -D warnings`이고, 실험 feature의 추가 경로는 `cargo clippy --locked -p spinon-ffi --all-targets --all-features -- -D warnings`로 확인했다. 이 검증은 Rust 워크스페이스 기준이며 모바일 앱 실행·V8 통합·Stylo 통합을 대신하지 않는다.
