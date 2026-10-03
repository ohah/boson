# S04.2·S04.3 CSS fixture와 CPU RenderSnapshot 실행 근거

## 범위

고정 CSS fixture의 Stylo cascade·Taffy geometry·typed sRGB paint를 `StaticRenderSnapshot`으로 결합하는 CPU 경로를 확인했습니다. 이 근거는 Android/iOS `wgpu` 표면 제출, GPU readback, 실제 화면, 제품 CSS 지원을 검증하지 않습니다.

## 고정 입력과 Chromium 기준

| 항목 | 값 |
| --- | --- |
| fixture | `S04-flex-paint-v1`, 301×40 CSS px, device scale factor 1 |
| fixture SHA-256 | `a4abee019ac584a9be64862d59ae4255e0d5fa23e3ac50ff2f91be12c8a53de9` |
| CSS SHA-256 | `827b7e12ddf39af8adee483bc223a4ed025fd1e9a8536780736dc838097aeb90` |
| Chromium | Chrome `154.0.8037.95`, revision `@05d469856e75794131cc2e5d9b2f6b6f10a70388` |
| Chromium 실행 파일 SHA-256 | `affc6715a14a423f5207014ae4b86ddad028e70b04b13572d60d35d8ac728f91` |
| 실행 조건 | macOS arm64, Chromium offline, `en-US`, UTC, light scheme |
| reference ID | `s04-flex-paint-v1-chromium-154.0.8037.95-a4abee019ac5-827b7e12ddf3-affc6715a14a` |
| reference SHA-256 | `20a55f01c35bd0b6546026bb7d6a68d0a2bfc0f4010984573ca0ac791cc85b05` |

기준 geometry는 부모 `301×40`, 자식 A `(x=0,w=48.5)`, B `(x=53.5,w=97)`, C `(x=155.5,w=145.5)`이며 네 노드 모두 `y=0`, `height=40`입니다. 모든 x/y/width/height 좌표를 각자 최대 0.5 CSS px 오차로 비교합니다. 노드 평균으로 개별 오차를 감추지 않습니다.

Chrome `getComputedStyle()`은 이 flex fixture의 자식 `width`·`height`에 사용값을 반환하는 반면 Stylo cascade snapshot은 레이아웃 전 computed value를 반환합니다. 그러므로 두 property는 computed serialization 비교에서 제외하고, Taffy 최종 frame을 Chromium `getBoundingClientRect()`와 별도로 비교합니다. 선택한 나머지 computed property와 배경색 문자열은 정확 일치합니다.

## 실행 결과

실행 환경은 Bun `1.4.2`, Node `v24.20.0`, Rust/Cargo `1.96.1`입니다.

| 명령 | 결과 |
| --- | --- |
| `cargo fmt --all -- --check` | 통과 |
| `bun run test` | JS 1개, CSS reference 도구 3개, Rust workspace 테스트 121개 통과 |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | 통과, 경고 없음 |
| S04 Chromium reference 캡처를 임시 출력 디렉터리에 재실행 후 기존 파일과 `cmp` | 바이트 단위 일치 |

S04 Rust 테스트는 fixture/reference hash와 선택 computed style, 색 변환, 좌표, CSS px viewport, source revision, node 순서와 전체 snapshot을 확인합니다. 실패 경계는 오래된 generation/document/render/layout revision, 잘못된 profile, cascade 진단, 잘못된 viewport/root/provenance, 누락·추가·중복 style/frame/node, fixture mapping 오류, 텍스트, RGB·alpha CSS syntax, 비유한·음수 frame, 빈 scene과 불연속 paint order를 포함합니다.

## 별도 적대 검토 항목

1. **C04 회귀 분리:** 기존 `FlexLayoutV1` 함수가 새 배경색 선언을 받지 않고 S04 전용 entrypoint만 새 profile을 받는지 확인했습니다. C04 fixture/reference는 변경하지 않았습니다.
2. **지원 CSS allowlist:** author stylesheet의 at-rule·중첩 규칙·허용 목록 밖 선언이 거부되는지 기존 Stylo rule 검사와 대조했습니다.
3. **색상 문법:** author `background-color`에서 정확히 불투명 6자리 hex만 허용하고 `rgb()`, alpha hex, `!important`, 뒤따르는 토큰을 거부하는 테스트를 확인했습니다.
4. **Stylo 경계:** paint 값이 computed color에서 나오고 CSS 직렬화 문자열을 재파싱하지 않는지 코드와 typed `OpaqueCssSrgb` 테스트를 대조했습니다.
5. **색상 채널:** encoded sRGB byte 순서와 alpha 1 조건, 비유한·범위 밖 channel 거부를 검사했습니다.
6. **parse 진단:** cascade 진단이 있는 style snapshot을 renderer adapter가 전체 실패로 돌려보내는 테스트를 추가했습니다.
7. **문서 세대:** 다른 `HostDocument` generation의 style 결과를 reject하는 실패 테스트를 확인했습니다.
8. **문서 revision:** 논리 문서 revision 불일치가 snapshot 생성 전 거부되는 테스트를 추가했습니다.
9. **표시 트리 revision:** render-tree revision 불일치가 거부되는 테스트를 추가했습니다.
10. **레이아웃 출처:** HostDocument가 아닌 layout source revision을 거부하는 테스트를 추가했습니다.
11. **root와 node kind:** 연결된 요소 root를 요구하고 분리된 handle 및 text node를 거부하는 경계를 확인했습니다.
12. **fixture mapping:** 길이·빈 ID·중복 ID·중복 NodeId·preorder 불일치 모두 오류를 반환하는 테스트를 추가했습니다.
13. **computed-style 집합:** 중복, 누락, 하위 트리 밖 style node를 거부하는 테스트를 확인했습니다.
14. **layout 집합:** 누락·하위 트리 밖 frame을 거부하는 테스트를 확인했습니다.
15. **frame 수치:** NaN frame은 adapter에서, 무한·음수 크기와 유한한 x/y·width·height의 합이 `f32` 범위를 넘는 frame은 생성자에서 거부되는 테스트를 확인했습니다.
16. **viewport 수치:** NaN·0 viewport와 무한 device scale 입력의 실패 경계를 확인했습니다.
17. **snapshot 순서와 공집합:** 중복 노드, 연속하지 않는 paint order, 빈 scene이 거부되는 단위 테스트를 확인했습니다.
18. **fractional geometry:** 48.5·97·145.5 CSS px 소수 폭이 반올림 없이 Chromium oracle과 비교되는지 fixture 테스트를 확인했습니다.
19. **oracle 재현과 보존:** 캡처를 임시 디렉터리에 재실행해 고정 reference와 바이트가 같은지 확인했습니다. 기본 경로는 `wx`로 생성해 기존 reference를 덮어쓰지 않습니다.
20. **상태 과장 방지:** 명세와 상태 대장에서 S04.2·S04.3 CPU fixture 범위만 완료로 표시하고 S04.4·S04.5 GPU 연결과 실제 색상 readback은 미완료로 남겼습니다.

## 남은 검증

- Android `wgpu` surface 획득·제출·present 요청과 실제 GPU readback 및 캡처
- iOS `wgpu` surface 획득·제출·present 요청과 실제 GPU readback 및 캡처
- 두 플랫폼 결과와 CPU snapshot의 교차 대조
- 실기기 결과, 제품 CSS·DOM·프레임워크 API, 연속 frame 처리

따라서 S04 전체와 CSS 제품 지원은 미완료입니다.
