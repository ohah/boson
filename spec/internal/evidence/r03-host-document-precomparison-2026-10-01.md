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

## 검토 후 수정 사항

| 발견 | 수정 내용 | 근거 |
| --- | --- | --- |
| 변경 묶음 안에서 상태가 원래 값으로 돌아와도 revision이 증가할 수 있음 | 중간 작업이 아니라 최종 문서와 연결 표시 투영을 비교해 실제 변화가 있을 때만 revision을 올림 | `no_op_and_empty_batches_do_not_advance_revisions`; revision 소진 원자성 테스트 |
| 다른 Owner의 노드를 삽입 기준으로 지정해 형제 순서를 바꿀 수 있음 | 기준 노드도 현재 batch Owner와 일치하는지 검증 | `batches_preserve_mixed_owner_siblings_without_crossing_ownership` |
| 삽입·이동·분리 과정의 순서와 실패 원자성 위험 | self-reference, cycle, invalid reference, 같은 위치 이동, detached 재삽입 사례를 회귀 테스트로 고정 | `insert_before_uses_final_order_and_invalid_references_are_atomic`; `detached_changes_and_connected_changes_advance_separate_revisions` |
| 핸들 세대·텍스트 코드 단위·고갈 경계 누락 위험 | generation, UTF-16 surrogate, 마지막 NodeId, revision 고갈 사례와 실패 전후 snapshot 동일성을 고정 | `stale_generation_and_stale_revision_are_rejected`; `utf16_surrogate_units_survive_text_and_text_content_reads`; 고갈 테스트 |
| 1,666줄 문서 모듈의 책임 혼합 | facade·자료형·변경 적용·snapshot·테스트 모듈로 분리하고 기존 공개 경로 재수출 유지 | `document.rs` 167줄, `types.rs` 482줄, `mutation.rs` 422줄, `snapshot.rs` 140줄, `tests.rs` 491줄 |
| Rust 이름·진단 함수·unwrap·FFI 안전 계약의 Clippy 경고 | `DomString::from_str`를 `from_rust_str`로 변경, 진단 필드를 입력 구조체로 묶음, 불필요한 unwrap 제거, unsafe FFI의 `# Safety` 문서화 | `report_exposes_caller_owner_callback_threads_and_timings`; 전체 Clippy와 실험 feature Clippy |
| 규칙이 `AGENTS.md`에 중복될 위험과 Rust 도구 기준 부재 | `AGENTS.md`는 `docs/project-rules.md`를 가리키고 세부 규칙은 단일 문서에 둠. 루트 `rustfmt.toml`에 Edition 2024·100열 폭 지정 | `cargo fmt --all -- --check`; `git diff --check` |
| 예약 핸들을 실제 노드나 JS `createElement()`로 오해할 수 있음 | 핸들 예약은 노드·Owner·revision을 만들지 않고, 실제 노드 생성은 `CreateElement`/`CreateText` 커밋에서 이뤄진다고 명시. JS DOM 동작은 별도 façade 계약으로 남김 | `reserved_handle_is_not_a_node_until_creation_commits`; WHATWG DOM [`createElement()`](https://dom.spec.whatwg.org/#dom-document-createelement) |
| 실패 후 포기한 예약을 회수할 수 없음 | `cancel_node_handle_reservation()`을 추가. 취소 ID는 재사용하지 않고 문서 generation을 확인하며 revision을 바꾸지 않음 | `canceled_reservation_is_not_reused_or_created`; 실패 묶음 뒤 같은 핸들 재시도 단언 |

향후 JS API는 반환 직후의 동기 논리 조회에서 분리 노드를 보이게 해야 하며, GPU 프레임 반영은 늦어도 됩니다. 중간 상태를 앱이 관찰할 수 있는 DOM 호출을 하나의 묶음으로 합치면 안 됩니다. 이름 정규화·Web IDL 변환·DOMException·JS 래퍼 객체 정체성·GC·OwnerId 발급은 아직 구현되지 않았고 공개 지원으로 표시하지 않습니다.

현재 검증은 `cargo test --locked --workspace` 61개 통과, `cargo clippy --locked --workspace --all-targets -- -D warnings`, 실험 feature Clippy, `cargo fmt --all -- --check`, `git diff --check`, Android ARM64·iOS 기기·iOS 시뮬레이터 대상 `cargo check` 통과입니다. 앱 실행·V8·Stylo·GPU 통합 검증은 아닙니다.
