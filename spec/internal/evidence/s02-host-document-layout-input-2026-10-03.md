# S02.1 · HostDocument layout 입력 비교 모델

**대상:** HostDocument 요소 하위 트리에서 Taffy 입력으로의 구조 투영 · **상태:** 구현·실행 완료

## 문제와 범위

Stylo C03/C04는 `HostDocumentSnapshot`을 입력으로 받지만 기존 Taffy adapter는 S01 `Tree`만 받는다. 두 경로가 노드 ID·자식 순서·revision을 어떻게 보존하는지 같은 문서 구조로 비교한다. 이 작업은 계층 연결만 다루며 CSS computed style 변환이나 UA stylesheet 렌더링을 주장하지 않는다.

## 비교 모델과 사전 판정 기준

하나의 fixture 그래프를 `Tree`와 `HostDocument` 양쪽에 구성한다. 두 입력은 root ID가 1이고 자식 ID 순서는 `[3, 2]`인 요소 세 개로 고정한다. 각 노드에 같은 `LayoutStyle`을 제공하고 같은 viewport로 기존 `TaffyLayoutEngine`을 호출한다.

| 관찰값 | 사전 기대값 | 실패 판정 |
| --- | --- | --- |
| 입력 root·요소 ID·자식 ID 순서 | 두 adapter에서 완전히 같음 | 하나라도 다르면 실패 |
| 동일 Taffy 엔진의 출력 프레임 | node별 `x`, `y`, `width`, `height`가 정확히 같음 | 값 또는 node 집합 차이가 있으면 실패 |
| HostDocument source revision | generation·문서 revision·표시 트리 revision을 모두 반환 | 누락·뒤바뀜이면 실패 |
| root 범위 밖 또는 없는 스타일 ID | `UnknownStyleNode` | 성공 입력으로 받아들이면 실패 |
| 필요한 요소 스타일 누락 | `MissingStyle` | 일부 노드만 성공 처리하면 실패 |
| 선택한 하위 트리의 텍스트 노드 | `UnsupportedTextNode`로 전체 입력 거부 | 텍스트를 조용히 버리거나 부분 트리를 만들면 실패 |
| HostRoot 직속이 아닌 root | `InvalidHostDocumentRoot` | 임의 하위 요소를 문서 root로 허용하면 실패 |

등가 비교는 구조 projection 자체의 오차를 판정한다. 이전 S02 Chromium fixture는 Taffy 결과를 검증하는 독립 oracle이며 이번 adapter가 CSS·브라우저 동작을 확장했다는 판정에는 사용하지 않는다.

## 관찰 결과

- 서로 다른 생성 순서의 세 요소를 같은 HostDocument와 S01 `Tree`에 구성했다. 입력 노드 ID 정렬, root ID, 각 노드의 style과 자식 순서 `[3, 2]`가 일치했다.
- 양쪽 입력의 Taffy `LayoutOutput.frames` map은 완전히 같았다. root `(0, 0, 100, 80)`, 첫 자식 `(5, 2, 30, 20)`, 다음 자식 `(42, 2, 20, 20)`으로 고정 기대값도 정확히 맞았다.
- 연결되지 않은 요소를 추가해 문서 revision만 늘린 snapshot에서 `DocumentRevision`과 `RenderTreeRevision`을 각각 보존했다. 동일한 node ID·revision을 가진 별도 HostDocument 결과는 generation이 달라 서로 다른 source revision으로 식별된다. 선택한 하위 트리 밖 요소의 스타일은 `UnknownStyleNode`로 거부했다.
- 누락 스타일은 `MissingStyle`, 하위 요소·다른 문서 generation의 handle·분리된 요소 root는 `InvalidHostDocumentRoot`, 포함된 텍스트 노드는 `UnsupportedTextNode`로 입력 전체를 거부했다.

| 실행 | 결과 |
| --- | --- |
| `mise exec -- cargo test --locked -p spinon-layout` | layout 17개 테스트 통과 |
| `mise exec -- cargo test --locked --workspace` | workspace 전체 78개 테스트 통과, 실패 0 |
| `mise exec -- cargo clippy --locked --workspace --all-targets -- -D warnings` | 통과 |
| `mise exec -- cargo fmt --all -- --check` | 통과 |
| `mise exec -- cargo check --locked -p spinon-layout --target aarch64-apple-ios-sim` | iOS Simulator ARM64용 `spinon-layout` 크레이트 컴파일 통과 |
| `mise exec -- cargo check --locked -p spinon-layout --target aarch64-linux-android` | Android ARM64용 `spinon-layout` 크레이트 컴파일 통과 |
| `git diff --check` | 통과 |

## 범위 제외

텍스트 shaping/intrinsic measurement, CSS cascade snapshot 변환, `display:inline`·`display:block` 지원, stylesheet registry/runtime 연결, Android·iOS 앱과 GPU 경로는 이번 입력 adapter에 포함하지 않는다. 기존 `Tree` adapter는 후속 비교와 이전 실험 호환을 위해 유지한다.

두 모바일 결과는 Rust 크레이트 cross-check이며 앱 빌드·설치·시뮬레이터 또는 실기기 화면 실행은 포함하지 않는다.
