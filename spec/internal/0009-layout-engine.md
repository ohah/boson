# 내부 인터페이스 0009 · 레이아웃 엔진

**버전:** `0.3.0-draft` · **상태:** 구현 초안 · **구현:** `crates/spinon-layout` · **대상:** Rust 코어 내부

이 문서는 코어 트리와 레이아웃 계산기 사이의 입력·출력 계약을 정합니다. 앱 작성자용 CSS 지원이나 공개 API를 선언하지 않습니다.

## 책임과 연결

- `spinon-core::Tree`가 노드 ID, 태그, 자식 순서와 구조 revision을 소유합니다.
- `LayoutInput::from_tree`는 그 트리와 호출자가 제공한 계산 스타일 맵을 읽어 불변 스냅샷을 만듭니다. 코어 트리를 다시 만들지 않으며 자식 순서를 보존합니다.
- 모든 트리 노드에 스타일이 하나씩 있어야 합니다. 누락 스타일과 트리에 없는 노드의 추가 스타일은 `from_tree`가 오류로 반환합니다. 길이 값·루트 크기·수동 구성 입력의 그래프는 `LayoutEngine::compute`에서 검증합니다.
- `LayoutInput::from_host_document`는 `HostDocumentSnapshot`에서 지정한 HostRoot 직속 요소 하위 트리와 호출자가 제공한 계산 스타일 맵을 읽어 같은 입력 노드 형식으로 투영합니다. 요소의 자식 순서를 보존하며 코어 문서를 복제하거나 다시 만들지 않습니다.
- HostDocument 입력의 선택 하위 트리에 텍스트 노드가 있으면 입력 전체를 `UnsupportedTextNode`로 거부합니다. 텍스트를 무시하거나 요소의 자식 순서를 바꾸지 않습니다. 스타일 누락과 선택한 하위 트리 밖 스타일은 각각 `MissingStyle`, `UnknownStyleNode`로 반환합니다.
- `LayoutInputRevision`은 입력 출처를 구분합니다. `Tree` 입력은 구조 `Revision`을, HostDocument 입력은 `DocumentGeneration`·`DocumentRevision`·`RenderTreeRevision`을 보존하고 여기에 `StyleRevision`·`EnvironmentRevision`을 덧붙입니다. `LayoutOutput`은 입력 stamp 전체를 그대로 돌려줍니다.
- 문서 구조·속성·상태는 `spinon-core::HostDocument`의 문서/표시 revision 소유입니다. stylesheet 목록·순서·내용, UA/style profile 같은 DOM 문서 바깥 스타일 입력은 스타일 입력 소유자가 `StyleRevision`으로 식별합니다. 한 문서의 모든 surface는 하나의 스타일 입력 sequence를 공유하며 surface별 다른 viewport 효과는 environment 입력으로 구분합니다. DOM 안의 변경은 문서 revision으로 추적하고 같은 원인을 `StyleRevision`에 중복 반영하지 않습니다. 현재 코어는 이 소유권 경계만 제공하며 stylesheet 내용과 revision이 일치하는지 자동 검증하지 않으므로 입력 소유자가 유효 입력이 바뀔 때 반드시 revision을 올려야 합니다.
- viewport와 레이아웃 계산에 전달하는 플랫폼 환경 snapshot은 플랫폼 환경 소유자가 `EnvironmentRevision`으로 식별합니다. 현재 연결된 `CssViewport` 값은 CSS px 너비·높이와 device scale factor뿐입니다. 이후 환경 값이 실제 계산 입력이 되면 같은 불변 snapshot과 revision에 포함합니다. 런타임 소유자가 아직 없어 값을 자동으로 묶거나 비교하지 않으며, revision을 넘기는 호출부가 내용 변경을 정확히 반영해야 합니다.
- `spinon-layout`은 revision 번호를 발급하거나 증가시키지 않습니다. 각 입력 소유자는 최초 상태 0에서 시작하고 입력 상태가 바뀔 때만 `checked_next()` 결과를 공개합니다. `u64`가 소진되면 증가·공개를 실패 처리하며 wrap이나 번호 재사용을 허용하지 않습니다. 비교는 같은 `DocumentGeneration` 안에서만 의미가 있습니다. 한 문서의 여러 surface가 동시에 존재할 수 있으므로 환경 revision은 surface별 별도 카운터가 아니라 문서 세대 전체의 단일 단조 증가 sequence입니다. surface 재생성만으로 revision을 초기화하지 않습니다. Surface 식별·수명은 별도 `SurfaceGeneration` 계약이 연결될 때 추가합니다.
- `LayoutEngine`은 엔진과 무관한 내부 경계이며 현재 구현은 `TaffyLayoutEngine`입니다. Taffy 타입은 이 크레이트 밖으로 노출하지 않습니다.
- C04.2 `spinon-style-to-layout`은 `spinon-style` computed-style profile을 검증하고 `LayoutStyle`로 변환한 뒤 이 크레이트에 전달합니다. `spinon-layout`은 CSS 문법·cascade를 참조하지 않습니다.

```rust
let input = LayoutInput::from_tree(
    &tree,
    viewport,
    &computed_styles,
    style_revision,
    environment_revision,
)?;
let output = TaffyLayoutEngine.compute(&input)?;
assert_eq!(output.revision, input.revision());
```

HostDocument 입력은 `HostDocumentSnapshot`, 해당 snapshot에 속한 HostRoot 직속 요소 handle, 같은 요소 하위 트리의 스타일 맵을 받습니다. HostDocument 원본의 generation·node ID·자식 순서·revision은 그대로 유지합니다. 이 변환은 CSS cascade 결과를 만들지 않으며 `LayoutStyle`은 여전히 호출자가 전달합니다.

```rust
let snapshot = document.snapshot();
let input = LayoutInput::from_host_document(
    &snapshot,
    root,
    viewport,
    &layout_styles,
    style_revision,
    environment_revision,
)?;
let output = TaffyLayoutEngine.compute(&input)?;
assert_eq!(output.revision, input.revision());
```

예시의 `root`는 `snapshot`에서 유효한 HostRoot 직속 요소 handle이며 선택한 subtree에는 텍스트 노드가 없습니다.

## 입력 계약 `0.3.0-draft`

한 계산 입력은 루트 ID, 양수·유한 viewport, `LayoutInputRevision`, 모든 요소 노드의 스타일을 포함합니다. revision은 source·style·environment 세 축을 각각 보존합니다. 루트의 고정 너비·높이는 viewport와 정확히 같아야 합니다. viewport와 스타일 값은 같은 좌표 단위를 사용합니다. 이 계약은 CSS px을 Android dp나 iOS point로 변환하지 않습니다.

현재 표현 가능한 스타일은 다음과 같습니다.

| 필드 | 현재 동작 |
| --- | --- |
| `display` | `flex`, `block`, `none`. `block`은 기본 block formatting 동등성을 뜻하지 않음 |
| `box_sizing` | `border-box`, `content-box` |
| `width`, `height`, `flex_basis` | `Auto` 또는 음수가 아닌 유한 고정 길이. 백분율은 없음 |
| `flex_direction` | `row`, `column` |
| `direction` | `ltr`, `rtl` |
| `padding` | 네 방향의 음수가 아닌 유한 길이 |
| `gap` | `row`, `column` gap. 음수가 아닌 유한 길이 |
| `flex_grow`, `flex_shrink` | 0 이상 유한 값 |
| 기본값 | `display:flex`, `align-items:stretch`, `flex-wrap:nowrap`, `flex-shrink:0`, `box-sizing:border-box` |

입력에는 중복 ID, 없는 자식, 중복 자식, 복수 부모, 루트의 부모, 고립 노드와 순환을 허용하지 않습니다. `LayoutInput` 필드는 외부에서 바꿀 수 없고 `from_tree` 또는 `from_host_document`가 코어 snapshot을 투영합니다. 엔진은 Taffy에 전달하기 전에 연결 그래프와 계산 스타일을 검증합니다.

## 출력 계약

- 성공하면 모든 입력 노드에 대해 루트 왼쪽 위 기준의 절대 `x`, `y`, `width`, `height`와 계산에 사용한 `LayoutInputRevision` 전체를 반환합니다. 출력 revision 일부를 생략하거나 최신 revision으로 덮어쓰지 않습니다.
- 프레임은 입력에서 쓴 같은 좌표 단위의 `f32`이며 Taffy 반올림을 끕니다. 기기 픽셀 스냅과 GPU 변환은 후속 렌더러 책임입니다.
- 모든 출력 값은 유한해야 합니다. 일부 프레임만 성공으로 반환하지 않습니다.
- 현재 호출마다 Taffy 트리를 새로 만들고 전체 계산합니다. 부분 무효화, 캐시, 프레임 병합 또는 성능 보장은 없습니다.

## 오류와 실패 경계

| 경우 | 결과 |
| --- | --- |
| viewport가 0 이하·NaN·무한대 | `InvalidViewport` |
| 트리의 루트 또는 노드별 계산 스타일이 없음 | `EmptyTree`, `MissingStyle` |
| 스타일 맵에 코어 트리 외 노드가 있음 | `UnknownStyleNode` |
| HostDocument root가 현재 snapshot의 HostRoot 직속 요소가 아님 | `InvalidHostDocumentRoot` |
| 선택한 HostDocument 하위 트리에 텍스트 노드가 있음 | `UnsupportedTextNode` |
| 입력 ID·연결 그래프가 잘못됨 | 해당 `MissingRoot`, `DuplicateNode`, `MissingChild`, `DuplicateChild`, `RootHasParent`, `MultipleParents`, `DetachedNode`, `Cycle`, `UnreachableNode` |
| 루트 크기가 viewport와 다름 | `RootSizeMismatch` |
| 음수 또는 유한하지 않은 길이·간격·grow | `InvalidStyle` |
| Taffy가 오류를 반환하거나 계산 중 panic | `Taffy`, `TaffyPanicked` |
| 계산 프레임 누락 또는 NaN·무한대 | `MissingComputedLayout`, `NonFiniteFrame` |

계산 실패는 새로 만든 임시 Taffy 트리 안에서 종료되며 호출자에게 프레임을 반환하지 않습니다. panic 변환은 Rust unwind 설정에서만 복구를 시도합니다. `panic=abort` 빌드에서 외부 panic 복구를 보장하지 않습니다.

## revision 갱신과 오래된 결과 차단

계산을 비동기로 수행하는 호출자는 문서 snapshot, 스타일 revision, 환경 revision과 실제 viewport 값을 한 시점의 현재 입력으로 묶어 보관해야 합니다. 계산 중 현재 입력이 바뀌었으면 이전 결과를 재계산 대상으로 돌리되, 새 입력에 일부 프레임만 섞어 넣으면 안 됩니다.

현재 S04 fixture admission API인 `spinon-style-to-render::build_s04_static_render_snapshot`은 호출자가 전달한 `CurrentLayoutInputs`와 계산 결과의 스타일 revision·environment revision·viewport를 비교합니다. 불일치하면 `SnapshotMismatch`를 반환하고 `StaticRenderSnapshot`을 만들지 않습니다. HostDocument generation/document/render revision과 layout의 전체 입력 stamp도 별도로 검증합니다. 값이 유한하지 않으면 revision 비교 전에 viewport 오류로 거부합니다.

이 admission 검사는 계산 결과가 완성된 뒤 fixture snapshot으로 들어가는 동기 경계입니다. 아직 제품용 현재 입력 소유자, 여러 소유자의 원자적 snapshot 수집, 런타임 계산 취소·재예약, GPU frame queue에서의 최종 재검증은 구현하지 않았습니다. 따라서 이 검사를 제품 비동기 경합 또는 화면 표시 stale 폐기 완료로 해석하면 안 됩니다. [고정 비교 기준](evidence/s02-layout-revision-precomparison-2026-10-04.md)과 [실행 근거](evidence/s02-layout-revision-gate-2026-10-04.md)를 따릅니다.

## 현재 미지원

이 인터페이스는 CSS parser/cascade 결과를 직접 받거나 변환하지 않습니다. CSS parser/cascade, selector, 상속, CSS 변수·단위 변환, percentage, margin, border, min/max constraints, flex wrapping, 일반 정렬, position, overflow·scroll, Grid, 완전한 Block formatting, 글꼴 shaping, 텍스트/이미지 intrinsic measurement를 제공하지 않습니다. HostDocument의 텍스트 노드를 레이아웃 입력으로 받지 않으며 `Auto` leaf의 콘텐츠 기반 측정도 없습니다. 그러므로 일반 웹 Flexbox 동등성, 완성된 CSS 엔진 또는 사용자 UI 지원으로 해석하면 안 됩니다.

## 의존성과 비교 기준

제품 workspace는 `taffy = 0.14.0`을 정확히 고정하고 기본 기능을 끈 뒤 `std`, `flexbox`, `block_layout`, `taffy_tree`를 켭니다. `block_layout`은 Taffy 입력 변환과 제한 fixture에 필요하지만 일반 Block formatting 지원 판정은 별도입니다. Lightning CSS 파서나 웹뷰는 런타임 의존성에 포함되지 않습니다. 이전 행·열 PoC는 `spikes/dynamic-tree/rust/tree.rs`에 보존하며, 공유된 정수 LTR fixture에서 Taffy 결과와 비교합니다. 별도의 151.5 CSS px 너비에 flex-grow 자식 셋을 둔 소수 분배 fixture는 Chromium과 Taffy만 비교합니다. 기존 엔진은 정수 크기와 제한된 행·열만 처리하므로 이 비교는 작은 fixture의 회귀 확인이지 브라우저/CSS 전체 적합성이나 속도 비교가 아닙니다.

기존 Tree 입력과 HostDocument 입력의 projection·revision 보존·Taffy 출력 동등성은 [HostDocument 입력 비교 모델](evidence/s02-host-document-layout-input-2026-10-03.md)에 기록합니다. 브라우저 좌표 비교는 [기존 S02 근거](evidence/s02-taffy-layout-2026-09-30.md)와 [C04.2 computed style layout adapter 근거](evidence/css-c04-style-layout-bridge-2026-10-03.md)에 둡니다. 이 구현은 S02 전체 완료, C04 전체 cascade runtime 연결 또는 공개 Flex/CSS API 지원을 뜻하지 않습니다.
