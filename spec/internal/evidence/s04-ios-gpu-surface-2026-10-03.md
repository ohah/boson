# S04.5 iOS GPU surface 검증

## 판정 범위

iOS 개발 부트스트랩에 opt-in S04 fixture 경로를 연결했습니다. 고정 `S04FlexPaintV1`에서 만든 동일 `StaticRenderSnapshot`을 UIKit `CAMetalLayer`의 wgpu Metal 표면에 제출하고, 표면 로그와 별도 sRGB readback을 확인했습니다. 이 실행은 iOS 시뮬레이터 한 세대의 결과입니다. 실기기·성능·회전 재생성·표시 완료 callback·제품 CSS/runtime을 검증하지 않았습니다.

## 실행 환경

| 항목 | 값 |
| --- | --- |
| 빌드 도구 | Xcode 26.2, build 17C52 |
| iOS 대상 | iPhone 17 Pro / iOS 26.2 시뮬레이터, ARM64 |
| Surface | 1206×2622 pixel, density 3.0, generation 1 |
| Backend / adapter | Metal / `DiscreteGpu`, `Apple iOS simulator GPU` |
| Surface target | `Bgra8UnormSrgb`, `SurfaceColorSpace::Srgb` |
| Fixture | `S04-flex-paint-v1`, document revision 1, render tree revision 1 |
| CSS 색상 검증 | `301×40 Rgba8UnormSrgb`, stride 1280 bytes, 42개 고정 RGBA 표본 |

Adapter 이름과 device type은 시뮬레이터 보고값입니다. 실제 iPhone GPU의 사용이나 성능으로 해석하지 않습니다.

## 재현 명령

```sh
SPINON_ENABLE_S04_IOS_FIXTURE=1 mise exec -- bun run build:ios-sim
xcrun simctl install booted build/spinon/DerivedData/Build/Products/Debug-iphonesimulator/SpinonBootstrap.app
xcrun simctl launch --terminate-running-process booted dev.spinon.bootstrap --spinon-s04-ios
xcrun simctl spawn booted log show --style compact --last 2m --predicate 'process == "SpinonBootstrap" AND eventMessage CONTAINS "SPINON_S04"'
xcrun simctl io booted screenshot spec/internal/evidence/s04-ios-gpu-surface-2026-10-03.png
```

기본 feature-off 빌드는 다음처럼 확인했습니다.

```sh
mise exec -- bun run build:ios-sim
xcrun simctl install booted build/spinon/DerivedData/Build/Products/Debug-iphonesimulator/SpinonBootstrap.app
xcrun simctl launch --terminate-running-process booted dev.spinon.bootstrap --spinon-s04-ios
```

기본 빌드 실행은 `SPINON_S04_FIXTURE=disabled`를 기록하고 S04 Rust 경로를 호출하지 않았습니다. opt-in iOS 실행은 `s04-ios-fixture` Cargo feature를 사용합니다. Android는 `s04-android-fixture` alias를 유지하며 두 플랫폼 feature는 공통 내부 `s04-fixture`를 켭니다. 모든 feature의 기본값은 비활성입니다.

## 관찰 결과

원본 로그에 아래 조건이 기록됐습니다.

- `SPINON_S04_RENDERER=ready`, Metal adapter와 sRGB surface 구성
- generation 1에서 `acquire=Success`, `present=requested`, wgpu 진단 없음
- 같은 frame 제출의 비동기 readback `status=1`, 42개 표본 `rgba=exact`, 진단 없음
- 화면 캡처에서 빨강·파랑·초록 fixture 영역이 CAMetalLayer 표면에 나타남

`present=requested`는 제출 요청이지 화면 표시 완료 시각이 아닙니다. 캡처의 제목·상태 문구는 개발용 UIKit label이며 가운데 색상 영역은 wgpu 표면 결과입니다. readback은 전체 화면 byte 비교가 아니라 기존 계약의 42개 고정 표본 비교입니다.

동일 변경의 Rust 검증에서 `s04-ios-fixture`와 `s04-android-fixture` 각각 8개 테스트, 기본 feature 비활성 조합 2개, 세 조합의 Clippy와 `rustfmt`가 통과했습니다. 추가 generation 검사로 resize는 현재 surface generation보다 큰 값만 수락하고, 같거나 낮은 값은 거부합니다. Android의 현재 빌드에서 generation 1→2→3 회전 재생성도 다시 확인했습니다.

- 화면 캡처: [S04 iOS GPU surface](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-ios-gpu-surface-2026-10-03.png)
- 원본 Log: [S04 iOS GPU surface log](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-ios-gpu-surface-2026-10-03.log)
- 기본 빌드 비활성 로그: [iOS fixture disabled](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-ios-fixture-disabled-2026-10-03.log)

## 미검증 범위

- iOS 실기기와 실제 기기 GPU 드라이버
- 표면 회전·재부착별 generation 증가와 재-readback
- 전체 프레임 byte 일치, 표시 완료 callback과 commit-to-present 지연
- VoiceOver·접근성·IME·입력, 일반 CSS와 앱 runtime 연결

Android·iOS 시뮬레이터 캡처의 Chromium geometry 및 `StaticRenderSnapshot` 대조는 [S04.6 실행 근거](s04-cross-platform-comparison-2026-10-03.md)를 참조합니다.
