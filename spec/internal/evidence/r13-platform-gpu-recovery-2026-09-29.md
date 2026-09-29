# R13 검증 기록 — 2026-09-29

## 환경

- Android Emulator `sdk_gphone64_arm64`, Android API 36, ARM64, Vulkan backend, `SwiftShader Device (LLVM 10.0.0)` CPU adapter.
- iPhone 17 Pro Simulator, iOS 26.2, Metal backend (`Apple iOS simulator GPU`).
- 양쪽 모두 로컬 Debug 앱입니다. 실기기 검증이나 성능 측정은 아닙니다.

## 검증

| 시나리오 | Android 에뮬레이터 | iOS 시뮬레이터 |
| --- | --- | --- |
| 첫 표면 생성과 화면 표시 | 통과 — [첫 실행 화면](r13-android-initial.png), [입력 후 화면](r13-android-touch-portrait.png), [로그](r13-android-lifecycle.log) | 통과 — [입력 후 화면](r13-ios-touch-portrait.png) |
| 회전·크기 변경 후 화면 재생성 | 통과 — Activity와 `SurfaceHolder` 파괴·생성 후 새 렌더러 생성, [가로 화면](r13-android-rotation-landscape.png), [회전 로그](r13-android-rotation.log), [수명 로그](r13-android-lifecycle.log) | 통과 — `CAMetalLayer` drawable 크기 재설정, [가로 화면](r13-ios-rotation-landscape.png), [회전 로그](r13-ios-rotation.log), [수명 로그](r13-ios-lifecycle.log) |
| 백그라운드 복귀 | 통과 — surface 재생성·렌더러 재생성 후 화면 표시, [화면](r13-android-background-resume.png), [로그](r13-android-lifecycle.log) | 통과 — inactive/active 이후 재그리기, [화면](r13-ios-background-resume.png), [로그](r13-ios-lifecycle.log) |
| 표면 손실 주입 후 복구 | 통과 — [화면](r13-android-surface-recovery.png), [로그](r13-android-surface.log) | 통과 — [화면](r13-ios-surface-recovery.png), [로그](r13-ios-surface.log) |
| 장치 손실 상태 주입 후 복구 | 통과 — [화면](r13-android-device-recovery.png), [로그](r13-android-device-loss.log) | 통과 — [화면](r13-ios-device-recovery.png), [로그](r13-ios-device-loss.log) |
| 복구 후 GPU 입력 | 통과 — 세로·가로 방향에서 탭 수 증가 확인 | 통과 — 세로·가로 방향에서 접근성 값과 R13 터치 로그 확인 |
| R08 기존 모드 회귀 | 통과 — Vulkan 렌더러·입력과 R08 접근성 이름 확인, [화면](r13-android-r08-regression.png), [로그](r13-android-r08-regression.log) | 통과 — Metal 렌더러·첫 프레임과 R08 접근성 이름 확인, [화면](r13-ios-r08-regression.png), [로그](r13-ios-r08-regression.log) |

주입한 오류는 운영체제나 GPU 드라이버의 실제 표면·장치 손실이 아닙니다. 주입은 호스트의 오류 분기와 렌더러 재생성 경계를 확인합니다. 세부 ABI와 남은 범위는 [R13 내부 명세](../r13-platform-gpu-recovery.md)에 적었습니다.

## 재현 명령

```sh
mise exec -- bun run test
cargo test --manifest-path spikes/wgpu-backend/Cargo.toml --locked
mise exec -- bun run build:android
mise exec -- bun run build:ios-sim
```

Android 에뮬레이터에서 표면 손실을 주입하려면 다음을 실행합니다.

```sh
adb shell am start -W -n dev.spinon.bootstrap/.MainActivity \
  --ez spinon_r13 true --ei spinon_r13_failure 1
```

장치 손실 상태 주입 값은 `--ei spinon_r13_failure 2`입니다. iOS 시뮬레이터는 앱 실행 인자로 `--spinon-r13 --spinon-r13-failure=surface` 또는 `device`를 전달합니다.

## 결과 해석

- 테스트: JavaScript 1건, Rust workspace 26건, wgpu 실험 1건 통과.
- Android Debug APK와 iOS Simulator Debug app 빌드 통과.
- R13 모드 분기 변경 후 기존 R08 모드도 양쪽 시뮬레이터에서 별도로 실행했습니다. 기존 R08 라벨과 렌더러 생성이 유지되고 R13 모드가 켜지지 않는 것을 확인했습니다.
- 회전 후 Activity가 재생성되면 데모의 탭 횟수는 초기화됩니다. 재생성 뒤 입력 자체는 다시 동작합니다.
- iOS 창 분리·재부착과 실제 드라이버 GPU 손실은 자동화하거나 재현하지 않았으므로 제품 안정성 근거에 포함하지 않습니다.

## 적대적 검토 5회

1. **상태 대장·계약·증거 연결:** R13만 완료 처리했고, 내부 ABI와 검증 기록을 서로 연결했습니다. 제품 지원 완료로 오해할 표현은 없습니다.
2. **오류 코드·FFI 경계:** `-3/-4/-5` 복구 대상과 `-2` 임시 오류가 코드·명세에서 일치합니다. 렌더러 호출은 UI 스레드에서 직렬화하고, 비동기 장치 손실 콜백은 원자 상태만 갱신합니다.
3. **Android 수명·복구:** 일시 중지 중 그리기를 막고 표면 재생성·복귀 뒤 재시도합니다. 복구는 한 번만 수행하며 실패를 반복 재시도하지 않습니다.
4. **iOS 수명·모드 격리:** 첫 검토에서 R13 수명주기 처리가 R08 경로에도 번지는 점과 R08 앱 시작 시 비활성 상태가 첫 그리기를 막을 수 있는 점을 찾아 수정했습니다. 최종 빌드에서 두 모드의 회귀 로그와 화면을 다시 확인했습니다.
5. **증거·주장 범위:** Android는 SwiftShader CPU 어댑터, iOS는 시뮬레이터 GPU입니다. 장치 손실은 상태 주입이며 실기기 성능·실제 드라이버 손실·iOS 창 분리 경로를 검증했다는 주장은 하지 않습니다.

검토에서 찾은 모드 격리 결함을 수정한 뒤 Android·iOS 빌드, Rust/Bun 테스트와 양 플랫폼 R08 화면을 다시 확인했습니다. 위에 적은 환경·재현 한계는 남아 있습니다.
