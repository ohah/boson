# S02 · 레이아웃 입력 revision 비교 기준

이 기준은 스타일·환경 입력이 바뀐 뒤 이전 계산 결과가 S04 `StaticRenderSnapshot` 생성 단계에 들어가지 않는지 확인하기 위해 검증 실행 전에 고정합니다. Chromium 좌표 비교가 아니라 내부 상태 일관성 비교입니다. 기존 S04 CSS·Chromium fixture는 변경하지 않습니다.

| 시나리오 | 계산 결과 출처 | admission 시점 현재 입력 | 기대 결과 |
| --- | --- | --- | --- |
| 현재 결과 | 문서·스타일·환경 revision과 viewport가 현재 값과 동일 | 같은 전체 입력 | snapshot 생성 |
| 스타일 변경 중 계산 | 계산 스타일 revision 0 | 현재 스타일 revision 1, 나머지 동일 | `StyleRevision` 오류, snapshot 없음 |
| 환경 변경 중 계산 | 환경 revision 0의 viewport | 현재 환경 revision 1, 나머지 동일 | `EnvironmentRevision` 오류, snapshot 없음 |
| revision 누락 회귀 | 환경 revision 0, 너비 301 CSS px | 환경 revision을 잘못 재사용하고 너비만 302 CSS px로 전달 | `CssViewport` 오류, snapshot 없음 |
| 높이 revision 누락 회귀 | 환경 revision 0, 높이 40 CSS px | 환경 revision을 재사용하고 높이만 41 CSS px로 전달 | `CssViewport` 오류, snapshot 없음 |
| backing scale revision 누락 회귀 | 환경 revision 0, scale 1 | 환경 revision을 재사용하고 scale만 2로 전달 | `CssViewport` 오류, snapshot 없음 |
| layout echo 불일치 | computed style과 layout의 style 또는 환경 revision이 다름 | computed style 입력과 동일 | 해당 layout revision 오류, snapshot 없음 |
| 문서 변경 중 계산 | 기존 HostDocument generation/document/render revision | 새 HostDocument snapshot | 기존 문서 revision 검사 오류, snapshot 없음 |

스타일·환경 카운터는 각각 `0`부터 시작하며 유효 입력 값이 바뀔 때만 소유자가 checked increment합니다. `u64` 끝에서 증가할 수 없으면 입력 상태 공개를 실패 처리하고 번호를 순환하거나 재사용하지 않습니다. revision 비교는 같은 `DocumentGeneration`에서만 유효합니다. 한 문서의 모든 surface는 단일 style sequence를 공유합니다. 여러 surface가 있는 문서에서도 환경 revision은 surface별 카운터를 분리하지 않고 문서 세대 안에서 단일 단조 증가 sequence를 사용해야 식별자 충돌을 막을 수 있습니다. surface 재생성도 카운터를 초기화하지 않습니다. 이 보수적 전역 sequence는 다른 surface 변경 때 재계산을 유발할 수 있으며, `SurfaceGeneration`을 포함하는 per-surface token은 별도 후속 결정입니다.

이 고정 기준은 제품 런타임의 비동기 경합, 환경 snapshot의 원자적 수집, GPU 표시 완료 또는 프레임 대기열의 stale 폐기를 주장하지 않습니다. 이번 테스트는 기존 계산 helper와 snapshot adapter의 admission 경계만 확인합니다.
