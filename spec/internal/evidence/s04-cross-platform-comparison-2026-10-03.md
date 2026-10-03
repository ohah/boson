# S04.6 Android·iOS 교차 플랫폼 대조

## 판정

Android와 iOS 시뮬레이터 화면에서 같은 `S04-flex-paint-v1`의 네이티브 GPU 색상 영역을 Chromium geometry 기준 및 `StaticRenderSnapshot` 프레임과 대조했습니다. 두 화면 모두 고정 색상의 위치·크기가 각 좌표별 `0.5 CSS px` 허용 오차 안에 있고, 캡처 픽셀의 RGB가 fixture 색상과 정확히 같습니다. 두 플랫폼의 비동기 readback 로그도 각자 42개 RGBA 표본과 진단 없음으로 완료됐습니다.

이는 저장된 시뮬레이터 캡처와 실행 로그의 대조입니다. 전체 화면을 Android와 iOS 간 바이트 단위로 비교하거나 실기기 GPU를 검증한 것은 아닙니다.

## 비교 입력

| 항목 | 값 |
| --- | --- |
| fixture | [S04-flex-paint-v1](https://github.com/ohah/spinon/blob/main/tests/fixtures/css/s04/flex-paint.v1.json), 301×40 CSS px |
| Chromium | Chrome `154.0.8037.95`, revision `@05d469856e75794131cc2e5d9b2f6b6f10a70388` |
| 기준 reference SHA-256 | [Chromium reference](https://github.com/ohah/spinon/blob/main/tests/fixtures/css/references/s04-flex-paint-v1-chromium-154.0.8037.95-a4abee019ac5-827b7e12ddf3-affc6715a14a.json) · `20a55f01c35bd0b6546026bb7d6a68d0a2bfc0f4010984573ca0ac791cc85b05` |
| Android | API 36 ARM64 emulator, 1080×2400 px, density `2.6250`, Vulkan `llvmpipe` CPU adapter |
| iOS | iPhone 17 Pro / iOS 26.2 simulator, 1206×2622 px, density `3.0000`, Metal simulator adapter |
| 화면 픽셀 추출 | macOS 호스트 Python 3와 Pillow `11.3.0`; 저장소 런타임 의존성은 추가하지 않음 |

Chromium reference와 CPU snapshot의 기준 frame은 다음과 같습니다. 각 노드의 frame은 root-relative CSS px입니다.

| 노드 | x | y | width | height | CSS 색상 |
| --- | ---: | ---: | ---: | ---: | --- |
| `flex-parent` | 0 | 0 | 301 | 40 | `#111827` |
| `flex-a` | 0 | 0 | 48.5 | 40 | `#e11d48` |
| `flex-b` | 53.5 | 0 | 97 | 40 | `#2563eb` |
| `flex-c` | 155.5 | 0 | 145.5 | 40 | `#16a34a` |

## 캡처 픽셀 대조

화면 PNG에서 세 fixture 색상의 정확한 RGB 픽셀을 찾아 각 색상 영역의 경계를 측정했습니다. bounding box는 원본 이미지 좌표의 양 끝 픽셀을 포함합니다. 각 플랫폼의 가장 왼쪽·위쪽 fixture 색상 픽셀을 crop 원점으로 삼고, 로그의 density로 픽셀 경계를 CSS px로 환산했습니다. 픽셀 격자 양자화는 허용 오차에 포함했습니다.

| 플랫폼·노드 | 원본 PNG 색상 영역 bounding box (px, 양 끝 포함) | 환산 x (CSS px) | 환산 width (CSS px) | y / height (CSS px) | Chromium·snapshot 최대 좌표 오차 |
| --- | --- | ---: | ---: | --- | ---: |
| Android `flex-a` | x `145–271`, y `1147–1251` | 0.000 | 48.381 | 0 / 40 | 0.119 CSS px |
| Android `flex-b` | x `285–539`, y `1147–1251` | 53.333 | 97.143 | 0 / 40 | 0.167 CSS px |
| Android `flex-c` | x `553–934`, y `1147–1251` | 155.429 | 145.524 | 0 / 40 | 0.071 CSS px |
| iOS `flex-a` | x `151–296`, y `1251–1370` | 0.000 | 48.667 | 0 / 40 | 0.167 CSS px |
| iOS `flex-b` | x `312–602`, y `1251–1370` | 53.667 | 97.000 | 0 / 40 | 0.167 CSS px |
| iOS `flex-c` | x `618–1053`, y `1251–1370` | 155.667 | 145.333 | 0 / 40 | 0.167 CSS px |

각 색상 픽셀은 해당 fixture의 sRGB bytes와 정확히 일치했습니다. Android 색상 영역의 픽셀 수는 빨강 `13,335`, 파랑 `26,775`, 초록 `40,110`이며 iOS는 각각 `17,520`, `34,920`, `52,320`입니다. 배경 gap 표본도 부모 색상 `#111827`의 `(17, 24, 39)`와 일치합니다. 캡처 PNG의 alpha는 모두 `255`였습니다.

최대 좌표 오차는 Android `0.167 CSS px`, iOS `0.167 CSS px`로, fixture 기준 `0.5 CSS px` 이내입니다. 측정 결과는 정수 물리 픽셀 경계에서 환산한 값이며 subpixel 위치를 GPU screenshot이 직접 보존한다고 주장하지 않습니다. 기준 frame과 불변 `StaticRenderSnapshot`의 동일성은 [S04.2·S04.3 실행 근거](s04-css-layout-render-snapshot-2026-10-03.md)와 `spinon-style-to-render` fixture 테스트가 담당합니다.

## 실행 로그와 캡처 연결

두 platform log 모두 `fixture=S04-flex-paint-v1`, `document_revision=1`, `render_tree_revision=1`, `frame_sequence=1`, `acquire=Success`, `present=requested`, `samples=42`, `rgba=exact`, `diagnostics=none`을 기록했습니다. Android 화면 하단에는 이번 PR에서 추가한 `S04 색상 readback 통과 · 42개 sRGB 표본`이 보입니다.

| 자료 | SHA-256 |
| --- | --- |
| Android 캡처 파일 [`s04-android-gpu-surface-2026-10-03.png`](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-gpu-surface-2026-10-03.png) | `56948f69b833042168cc24902ca78f2431a271372c56165ff45211413d519871` |
| iOS 캡처 파일 [`s04-ios-gpu-surface-2026-10-03.png`](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-ios-gpu-surface-2026-10-03.png) | `b729e171bd2b230db09f3639edc017c9043e2e2753023bf3089d16732d1b0962` |
| Android surface 로그 [`s04-android-gpu-surface-2026-10-03.log`](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-gpu-surface-2026-10-03.log) | `b7e01be6d1c2cdd1e6d895efae32f9d81b6ea164373df80f5a904b1b8dc8f837` |
| Android 상태 문구 로그 [`s04-android-readback-status-2026-10-03.log`](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-readback-status-2026-10-03.log) | `563841bd5f09a83440952f0cbc6fabd201eb903f0e5804885a79efedc8b7ea75` |
| iOS surface 로그 [`s04-ios-gpu-surface-2026-10-03.log`](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-ios-gpu-surface-2026-10-03.log) | `e6e92a84a39fca15614516986943aca041f7abcaafe6db6619792690b8fc6f25` |

## 검증 범위와 한계

- 기존 고정 reference를 사용했으며 reference·fixture·`StaticRenderSnapshot` 코드는 바꾸지 않았습니다.
- Android는 API 36 emulator의 `llvmpipe` CPU adapter입니다. iOS는 시뮬레이터가 보고한 Metal adapter입니다. 어느 쪽도 실기기 GPU 결과가 아닙니다.
- 캡처는 서로 다른 해상도·density·OS chrome을 포함하므로 전체 화면끼리 픽셀 비교하지 않았습니다. fixture의 색상 영역만 공통 CSS px 좌표로 정규화했습니다.
- Android 캡처의 제목 주변 초록 포커스 테두리는 TalkBack 시스템 표시이며 CSS border나 GPU fixture가 아닙니다. iOS 캡처의 상태 영역·Dynamic Island도 fixture 밖 OS chrome입니다.
- `present=requested`와 캡처는 GPU 제출 요청 및 캡처 시점의 화면을 증명합니다. 프레임 표시 완료 callback·표시 시각·commit-to-present 지연은 증명하지 않습니다.
- 실행 로그는 fixture ID, document/render revision, frame sequence와 surface generation을 기록하지만 `StaticRenderSnapshot` digest는 기록하지 않습니다. 비교 결과는 저장된 캡처의 좌표·색을 고정 frame과 대조한 것이며, 캡처와 snapshot의 바이트 정체성까지 증명하지 않습니다.
- 각 platform 내부 readback은 계약에 고정한 42개 표본만 검사했습니다. 전체 offscreen frame의 모든 byte가 platform 간 같은지 검증한 것은 아닙니다.
- 일반 좌표계의 세로 원점·비대칭 y 배치는 이 fixture에 없으므로 검증하지 않았습니다. 연속 frame, 동적 CSS, hit-test·JS 이벤트, 제품 runtime은 S04.7 이후 별도 계약입니다.

## 실행한 검증

```sh
mise exec -- cargo test --locked -p spinon-style-to-render fixed_s04_fixture_matches_chromium_and_builds_a_complete_static_snapshot
git diff --check
```

Rust fixture 검증은 고정 Chromium geometry와 `StaticRenderSnapshot` 생성 경로를 통과했습니다. 시뮬레이터 실행 자체는 기존 platform 원본 로그와 위 캡처를 사용해 대조했으며, 새 앱 빌드는 하지 않았습니다.
