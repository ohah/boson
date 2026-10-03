# S02.2 · 스타일·환경 revision 전달과 stale 결과 차단

이 기록은 `StyleRevision`·`EnvironmentRevision`이 cascade에서 layout 결과와 S04 fixture snapshot까지 보존되고, admission 시 현재 입력과 다르면 snapshot 생성을 거부하는지 확인합니다. 사용자 runtime 입력 관리자나 Android·iOS 표시 큐를 검증하는 자료는 아닙니다.

## 비교 모델

실행 전에 고정한 내부 불변 조건과 현재·stale 입력 표는 [사전 비교 기준](s02-layout-revision-precomparison-2026-10-04.md)에 있습니다. 새 [revision gate fixture](../../../../tests/fixtures/css/s04/layout-revision-gate.v1.json)는 현재 tuple 허용, style/environment 단독 변경 거부, revision을 잘못 재사용한 viewport 폭·높이·배율 변경 거부를 지정합니다. 기존 S04 화면 fixture와 Chromium reference는 수정하지 않았습니다.

## 적대적 경계 점검

각 항목은 서로 다른 입력·소유권·출력 실패 경계를 확인합니다.

| 순번 | 공격 입력 또는 불변 조건 | 확인 결과 |
| --- | --- | --- |
| 1 | `StyleRevision`을 `EnvironmentRevision` 자리에 바꾸어 전달 | 별도 nominal type이라 컴파일 단계에서 혼용할 수 없습니다. |
| 2 | owner의 최초 값과 문서 세대 경계를 혼동 | 초기 값은 0이며 비교 출처 tuple이 `DocumentGeneration`도 함께 포함합니다. |
| 3 | `u64::MAX` 다음 번호를 만들어 wrap시키기 | 양 revision의 `checked_next()`는 `None`을 반환합니다. wrapping 증가나 외부 raw 생성자는 없습니다. |
| 4 | DOM 속성 변경을 stylesheet revision만 올려 추적 | 문서 소유 revision과 DOM 외 스타일 입력 revision을 명세에서 분리하고 중복 반영을 금지합니다. |
| 5 | stylesheet 순서·내용·UA profile 변경을 document revision으로 추적 | 스타일 입력 소유자의 `StyleRevision`으로 분류하고, 현재 자동 관리자가 없음을 명세합니다. |
| 6 | surface별 독립 style counter로 같은 문서의 입력을 잘못 결합 | 같은 문서의 모든 surface가 공유하는 style sequence를 계약에 기록합니다. 자동 발급 구현은 아직 없습니다. |
| 7 | surface resize·재생성마다 환경 revision을 재사용 | 한 문서 세대의 surface 전체가 공유하는 환경 sequence와 재생성 후 재사용 금지를 명세합니다. |
| 8 | 입력이 바뀌지 않았는데 임의로 revision을 올리거나, 바뀌었는데 올리지 않음 | 유효 입력 변경 때만 올리는 소유자 의무를 명세합니다. 이 정책을 실행하는 제품 manager는 아직 없습니다. |
| 9 | 계산에 새 viewport를 쓰고 환경 revision만 이전 값으로 재사용 | 폭·높이·device scale을 모두 비교하며 새 fixture의 세 stale 사례가 `CssViewport` 오류로 거부됩니다. |
| 10 | viewport 내부 revision과 `LayoutInputRevision.environment`를 다르게 전달 | 둘 중 하나가 current stamp와 불일치하면 `EnvironmentRevision` 오류로 거부됩니다. |
| 11 | NaN·무한대·0·음수 viewport를 오래된 revision 오류로 위장 | viewport 유효성 검사가 revision 비교보다 먼저 실행되어 `InvalidViewport`로 거부됩니다. |
| 12 | Tree 입력과 HostDocument 입력의 출처를 같은 revision으로 혼동 | source enum이 두 입력을 구분하고 HostDocument는 generation·document·render revision을 모두 저장합니다. |
| 13 | layout 생성자가 스타일·환경 revision을 기본값으로 조용히 채움 | `from_tree`·`from_host_document` 모두 두 revision을 명시 인자로 요구합니다. |
| 14 | cascade가 계산된 style revision을 버리거나 viewport 환경 revision을 누락 | `ComputedStyleSnapshot`에 양 축을 보존하며 nonzero 통합 테스트가 확인합니다. |
| 15 | style-to-layout projection이 revision을 새 값으로 대체 | projection 입력부터 layout 입력까지 전달한 값을 유지하며 nonzero test가 확인합니다. |
| 16 | layout 계산이 source만 echo하고 style/environment를 누락 | `LayoutOutput`은 입력의 전체 `LayoutInputRevision`을 복사합니다. 그 값의 일부를 최신 값으로 덮어쓰지 않습니다. |
| 17 | 다른 HostDocument의 current stamp를 제공 | current source를 전달된 실제 문서 snapshot에서 다시 만들어 비교하고 불일치 시 거부합니다. |
| 18 | 문서 generation·document revision·render-tree revision 중 한 축만 오래된 계산 결과에 남김 | 기존 각 축 검사와 변형 결과 테스트가 축별 mismatch에서 실패를 확인합니다. |
| 19 | computed style과 현재 style/environment/viewport가 다르지만 frame은 유효함 | style revision, environment revision, viewport 전체가 각각 같아야 하며 다르면 snapshot 생성을 거부합니다. |
| 20 | layout output만 다른 source/style/environment stamp를 echo하거나 일부 frame·mapping이 빠짐 | 전체 stamp와 node/style/frame 집합을 검증한 뒤에만 snapshot을 만들며, 오류 경로는 부분 결과를 반환하지 않습니다. |

추가로 서로 일치하는 초기 tuple과 nonzero style/environment tuple은 admission을 통과합니다. revision mismatch 테스트는 잘못된 source, 각 document revision 축, layout echo의 각 축을 따로 변형합니다. 기존 S04의 색상·좌표 oracle 및 S04.4 Android/S04.5 iOS GPU fixture는 그대로 두었습니다.

## 실행 결과

| 확인 | 결과 |
| --- | --- |
| `cargo fmt --all -- --check` | 통과 |
| `cargo test --locked --workspace` | 125개 단위 테스트 통과, 실패 0개 |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | 통과 |
| `cargo check --locked --manifest-path spikes/wgpu-backend/Cargo.toml` | 통과; 변경된 S04 snapshot spike 연결 포함 |
| `git diff --check` | 통과 |

revision gate JSON SHA-256: `a52a0b764a31bf3441c57806a311820202e0400d3d49c7a8e98e236787e6a524`.

기존 화면 fixture SHA-256는 JSON `a4abee019ac584a9be64862d59ae4255e0d5fa23e3ac50ff2f91be12c8a53de9`, CSS `827b7e12ddf39af8adee483bc223a4ed025fd1e9a8536780736dc838097aeb90`이며 기준 고정 뒤 변경되지 않았습니다.

## 남은 검증 경계

이번 변경에는 style/environment revision을 발급하는 제품 owner, 여러 owner의 원자 snapshot, 입력 변경 시 계산 취소·재예약, UI/GPU queue의 최종 revision 재검증이 없습니다. 계산 결과가 완료된 뒤 fixture snapshot admission에서 동기적으로 stale 여부만 판정합니다. Android·iOS 빌드와 simulator/device 화면은 이 Rust 계약 변경에서 실행하지 않았고, 이 기록은 해당 플랫폼 runtime에서의 경합 안전성이나 실제 화면 폐기를 증명하지 않습니다.
