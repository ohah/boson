# 내부 인터페이스 0009 · 레이아웃 엔진

**버전:** `0.1.0-draft` · **상태:** 구현 초안 · **구현:** `crates/spinon-layout` · **대상:** Rust 코어 내부

이 문서는 코어 트리와 레이아웃 계산기 사이의 입력·출력 계약을 정합니다. 앱 작성자용 CSS 지원이나 공개 API를 선언하지 않습니다.

## 책임과 연결

- `spinon-core::Tree`가 노드 ID, 태그, 자식 순서와 구조 revision을 소유합니다.
- `LayoutInput::from_tree`는 그 트리와 호출자가 제공한 계산 스타일 맵을 읽어 불변 스냅샷을 만듭니다. 코어 트리를 다시 만들지 않으며 자식 순서를 보존합니다.
- 모든 트리 노드에 스타일이 하나씩 있어야 합니다. 누락 스타일과 트리에 없는 노드의 추가 스타일은 `from_tree`가 오류로 반환합니다. 길이 값·루트 크기·수동 구성 입력의 그래프는 `LayoutEngine::compute`에서 검증합니다.
- 스냅샷은 `Tree::revision()`을 담고 `LayoutOutput`이 같은 revision을 돌려줍니다. 이는 구조 revision만 식별합니다. 스타일 revision·환경 revision은 아직 없으므로 호출자는 더 새로운 스타일·환경 입력에 낡은 결과를 적용하지 않도록 관리해야 합니다.
- `LayoutEngine`은 엔진과 무관한 내부 경계이며 현재 구현은 `TaffyLayoutEngine`입니다. Taffy 타입은 이 크레이트 밖으로 노출하지 않습니다.

```rust
let input = LayoutInput::from_tree(&tree, viewport, &computed_styles)?;
let output = TaffyLayoutEngine.compute(&input)?;
assert_eq!(output.tree_revision, input.tree_revision());
```

## 입력 계약 `0.1.0-draft`

한 계산 입력은 루트 ID, 양수·유한 viewport, 트리 revision, 모든 노드의 스타일을 포함합니다. 루트의 고정 너비·높이는 viewport와 정확히 같아야 합니다. viewport와 스타일 값은 같은 좌표 단위를 사용합니다. 이 계약은 CSS px을 Android dp나 iOS point로 변환하지 않습니다.

현재 표현 가능한 스타일은 다음과 같습니다.

| 필드 | 현재 동작 |
| --- | --- |
| `width`, `height` | `Auto` 또는 음수가 아닌 유한 고정 길이. 백분율은 없음 |
| `flex_direction` | `row`, `column` |
| `direction` | `ltr`, `rtl` |
| `padding` | 네 방향의 음수가 아닌 유한 길이 |
| `gap` | `row`, `column` gap. 음수가 아닌 유한 길이 |
| `flex_grow` | 0 이상 유한 값 |
| 표시·정렬 기본값 | 모든 노드는 Flex 컨테이너, `align-items: stretch`, `flex-wrap: nowrap`, `flex-shrink: 0`, border-box |

입력에는 중복 ID, 없는 자식, 중복 자식, 복수 부모, 루트의 부모, 고립 노드와 순환을 허용하지 않습니다. `LayoutInput` 필드는 외부에서 바꿀 수 없고 `from_tree`가 코어 스냅샷을 만듭니다. 엔진은 Taffy에 전달하기 전에 연결 그래프와 계산 스타일을 검증합니다.

## 출력 계약

- 성공하면 모든 입력 노드에 대해 루트 왼쪽 위 기준의 절대 `x`, `y`, `width`, `height`를 반환합니다.
- 프레임은 입력에서 쓴 같은 좌표 단위의 `f32`이며 Taffy 반올림을 끕니다. 기기 픽셀 스냅과 GPU 변환은 후속 렌더러 책임입니다.
- 모든 출력 값은 유한해야 합니다. 일부 프레임만 성공으로 반환하지 않습니다.
- 현재 호출마다 Taffy 트리를 새로 만들고 전체 계산합니다. 부분 무효화, 캐시, 프레임 병합 또는 성능 보장은 없습니다.

## 오류와 실패 경계

| 경우 | 결과 |
| --- | --- |
| viewport가 0 이하·NaN·무한대 | `InvalidViewport` |
| 트리의 루트 또는 노드별 계산 스타일이 없음 | `EmptyTree`, `MissingStyle` |
| 스타일 맵에 코어 트리 외 노드가 있음 | `UnknownStyleNode` |
| 입력 ID·연결 그래프가 잘못됨 | 해당 `MissingRoot`, `DuplicateNode`, `MissingChild`, `DuplicateChild`, `RootHasParent`, `MultipleParents`, `DetachedNode`, `Cycle`, `UnreachableNode` |
| 루트 크기가 viewport와 다름 | `RootSizeMismatch` |
| 음수 또는 유한하지 않은 길이·간격·grow | `InvalidStyle` |
| Taffy가 오류를 반환하거나 계산 중 panic | `Taffy`, `TaffyPanicked` |
| 계산 프레임 누락 또는 NaN·무한대 | `MissingComputedLayout`, `NonFiniteFrame` |

계산 실패는 새로 만든 임시 Taffy 트리 안에서 종료되며 호출자에게 프레임을 반환하지 않습니다. panic 변환은 Rust unwind 설정에서만 복구를 시도합니다. `panic=abort` 빌드에서 외부 panic 복구를 보장하지 않습니다.

## 현재 미지원

이 인터페이스는 CSS parser/cascade, selector, 상속, CSS 변수·단위, percentage, margin, border, min/max constraints, flex shrink, wrapping, 정렬 선택, position, overflow·scroll, Grid, Block, 글꼴 shaping, 텍스트/이미지 intrinsic measurement를 제공하지 않습니다. `Auto` leaf의 콘텐츠 기반 측정도 없습니다. 그러므로 일반 웹 Flexbox 동등성, 완성된 CSS 엔진 또는 사용자 UI 지원으로 해석하면 안 됩니다.

## 의존성과 비교 기준

제품 workspace는 `taffy = 0.14.0`을 정확히 고정하고 기본 기능을 끈 뒤 `std`, `flexbox`, `taffy_tree`만 켭니다. Lightning CSS 파서나 웹뷰는 런타임 의존성에 포함되지 않습니다. 이전 행·열 PoC는 `spikes/dynamic-tree/rust/tree.rs`에 보존하며, 공유된 정수 LTR fixture에서 Taffy 결과와 비교합니다. 별도의 151.5 CSS px 너비에 flex-grow 자식 셋을 둔 소수 분배 fixture는 Chromium과 Taffy만 비교합니다. 기존 엔진은 정수 크기와 제한된 행·열만 처리하므로 이 비교는 작은 fixture의 회귀 확인이지 브라우저/CSS 전체 적합성이나 속도 비교가 아닙니다.

fixture와 브라우저 좌표, 테스트 결과는 [S02 근거](evidence/s02-taffy-layout-2026-09-30.md)에 기록합니다. 이 구현은 `spec/STATUS.md`의 S02 완료 표시나 공개 Flex/CSS API 지원을 뜻하지 않습니다.
