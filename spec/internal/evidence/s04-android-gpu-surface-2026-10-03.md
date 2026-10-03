# S04.4 Android GPU surface 검증

## 판정 범위

Android API 36 ARM64 에뮬레이터에서 고정 S04 `StaticRenderSnapshot`을 `wgpu` surface에 제출하고, 별도의 301×40 `Rgba8UnormSrgb` readback 대상으로 CSS paint bytes를 대조했습니다. 앱 화면의 색상 막대는 GPU surface screenshot으로 확인했습니다. 앱 전체 렌더러, 공개 API, 일반 CSS 지원 또는 하드웨어 GPU 성능의 완료 근거는 아닙니다.

## 실행 환경

| 항목 | 값 |
| --- | --- |
| Android | API 36, `sdk_gphone64_arm64` 에뮬레이터 |
| Surface 크기 | 1080×2400 pixel, density 2.625; 회전 후 2400×1080 pixel |
| Backend | Vulkan |
| Adapter | `Cpu`, `llvmpipe (LLVM 21.1.4, 128 bits)` |
| Surface target | `Rgba8UnormSrgb`, `SurfaceColorSpace::Srgb` |
| Fixture | `S04-flex-paint-v1`, 문서 revision 1, render tree revision 1 |
| 고정 fixture/reference | [0019 S04 계약](../0019-s04-css-layout-gpu-slice.md), [Chromium reference](https://github.com/ohah/spinon/blob/main/tests/fixtures/css/references/s04-flex-paint-v1-chromium-154.0.8037.95-a4abee019ac5-827b7e12ddf3-affc6715a14a.json) |

Vulkan backend는 에뮬레이터에서 CPU `llvmpipe` adapter를 반환했습니다. 따라서 이번 결과는 API·surface·색상 경로의 에뮬레이터 검증이고, 실제 Android GPU 드라이버나 성능 결과는 아닙니다.

## 실행과 관찰

S04 fixture는 선택 Cargo feature로만 빌드했습니다.

```sh
mise exec -- env SPINON_ENABLE_S04_ANDROID_FIXTURE=1 bun run build:android
adb install -r platforms/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.spinon.bootstrap/.MainActivity --ez spinon_s04 true --ei spinon_r08_backend 1
```

화면 캡처에서 GPU surface의 Flex 자식 세 색상 영역을 확인했습니다. 회전 전 세로 surface generation 1, 가로 generation 2, 복귀한 세로 generation 3에서 각각 `acquire=Success`, `present=requested`와 비어 있는 wgpu 진단을 기록했습니다.

각 generation의 비동기 readback은 `301×40` sRGB target에서 성공했습니다. 복사 행 stride는 1280 bytes이고, 고정 x 위치 14개와 y 위치 3개, 총 42개 표본의 RGBA 값을 snapshot paint bytes와 정확히 비교했습니다. `Queue::present` 기록은 표시 요청이며 표시 완료 callback은 아닙니다. 화면 캡처는 surface에 색상 영역이 실제 보인 별도 증거입니다.

PR #44의 Android 상태 문구 수정 빌드를 API 36 ARM64 에뮬레이터에서 다시 실행했습니다. 하단 문구가 `readback 진행 중`에서 비동기 readback 완료 후 `S04 색상 readback 통과 · 42개 sRGB 표본`으로 바뀌었고, 최신 실행에서도 generation 1의 42개 표본이 정확히 일치했습니다. 이 실행의 [상태 문구 갱신 화면](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-gpu-surface-2026-10-03.png)과 [원본 Logcat](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-readback-status-2026-10-03.log)을 보관합니다.

- 화면 캡처: [S04 Android GPU surface](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-gpu-surface-2026-10-03.png)
- 원본 Logcat: [S04 Android GPU surface log](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-gpu-surface-2026-10-03.log)
- 상태 문구 갱신 실행 Logcat: [S04 Android readback status log](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-readback-status-2026-10-03.log)
- 기본 빌드 feature-off 확인: [JNI 비활성 안내 log](https://github.com/ohah/spinon/blob/main/spec/internal/evidence/s04-android-fixture-disabled-2026-10-03.log)

캡처 당시 에뮬레이터에서 TalkBack이 켜져 있어 시스템 포커스 강조가 화면에 함께 보입니다. 이 강조는 fixture 색상이나 layout snapshot의 일부가 아닙니다.

## 실행 검증

```sh
mise exec -- cargo test --manifest-path spikes/wgpu-backend/Cargo.toml --locked --features s04-android-fixture --lib
mise exec -- cargo clippy --manifest-path spikes/wgpu-backend/Cargo.toml --locked --features s04-android-fixture --all-targets -- -D warnings
mise exec -- cargo test --manifest-path spikes/wgpu-backend/Cargo.toml --locked --lib
mise exec -- cargo fmt --manifest-path spikes/wgpu-backend/Cargo.toml -- --check
```

현재 공통 Rust 코드에서 Android·iOS alias 각각의 feature 활성 테스트 8개, 기본 feature 비활성 테스트 2개와 Clippy·rustfmt를 통과했습니다. 세대가 같거나 낮은 resize를 거부하는 단위 테스트도 포함합니다. feature 활성 Android ARM64 debug APK를 새 코드로 다시 빌드해 API 36 에뮬레이터에서 generation 1→2→3 표면 제출과 generation별 42개 readback을 확인했습니다. `SPINON_ENABLE_S04_ANDROID_FIXTURE=0` 기본 Android 빌드 및 비활성 JNI 응답도 별도 실행에서 확인했습니다. 이 feature는 `#[cfg(test)]` 단위 테스트 전용이 아니라, 내부 S04 fixture 경로를 Android 앱에 선택적으로 포함하는 빌드 기능입니다.

## 미검증 범위

- Android 실기기 및 hardware GPU adapter
- iOS 실기기 및 하드웨어 GPU
- 전체 프레임 readback byte 비교; 이번 readback 판정은 고정 42개 표본입니다.
- 실제 화면 표시 시각, hit-test, DOM/JS 입력, 동적 scene 갱신, 일반 CSS 지원
- 기본 빌드의 S04 JNI 진입은 비활성 안내를 반환합니다. fixture를 보려면 feature를 켜고 다시 빌드해야 합니다.

Android·iOS 시뮬레이터 캡처의 Chromium geometry 및 `StaticRenderSnapshot` 대조는 [S04.6 실행 근거](s04-cross-platform-comparison-2026-10-03.md)를 참조합니다.
