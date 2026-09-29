# R13 검증 기록 — 2026-09-29

## 환경

- Android Emulator `sdk_gphone64_arm64`, Android API 36, ARM64, Vulkan backend, `SwiftShader Device (LLVM 10.0.0)` CPU adapter.
- iPhone 17 Pro Simulator, iOS 26.2, Metal backend (`Apple iOS simulator GPU`).
- 양쪽 모두 로컬 Debug 앱입니다. 실기기 검증이나 성능 측정은 아닙니다.

## 검증

| 시나리오 | Android 에뮬레이터 | iOS 시뮬레이터 |
| --- | --- | --- |
| 첫 표면 표시와 중앙 GPU 도형 탭 후 색 전환 | 통과 — [첫 실행 화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-initial.png), [입력 후 화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-touch-portrait.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-lifecycle.log) | 통과 — 중앙 GPU 도형 탭 후 파란색에서 주황색으로 바뀌고 활성화 횟수가 1회로 표시됩니다. [입력 후 화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-touch-portrait.png) |
| 회전·크기 변경 후 화면 재생성 | 통과 — Activity와 `SurfaceHolder` 파괴·생성 후 새 렌더러 생성, [가로 화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-rotation-landscape.png), [회전 로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-rotation.log), [수명 로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-lifecycle.log) | 통과 — `CAMetalLayer` drawable 크기 재설정, [가로 화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-rotation-landscape.png), [회전 로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-rotation.log), [수명 로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-lifecycle.log) |
| Android 실제 분할 화면·구분선 크기 변경 | 부분 통과 — Spinon과 Chrome 작업이 모두 `multi-window`로 표시됩니다. 표면 `1080x1187 → 1080x735 → 1080x1187` 재생성을 확인했습니다. [탭 후 분할 화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-multiwindow-touch.png), [작은 패널의 UI 겹침](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-multiwindow-small-pane.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-multiwindow.log) | — |
| iPadOS Stage Manager 창 표시·크기 변경 | — | 부분 확인 — 앱을 부동 창으로 전환하고 `2752x2064` 표면 크기 로그 한 건을 확인했습니다. 반복적인 실시간 크기 변경 콜백은 확인하지 못했습니다. 물리 iPad 테스트가 아닙니다. |
| 백그라운드 복귀 | 통과 — surface 재생성·렌더러 재생성 후 화면 표시, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-background-resume.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-lifecycle.log) | 통과 — inactive/active 이후 재그리기, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-background-resume.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-lifecycle.log) |
| 창에서 분리·재부착 | `SurfaceHolder` 파괴·생성 경로는 Android 수명 로그에서 확인 | 개발용 실행 인자로 뷰를 창에서 분리한 뒤 재부착, 렌더러 generation 2 생성과 재그리기를 확인 — [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-window-cycle.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-window-cycle.log) |
| 표면 손실 주입 후 복구 | 통과 — [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-surface-recovery.png), [재검증 로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-surface-recovery.log) | 통과 — [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-surface-recovery.png), [재검증 로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-surface-recovery.log) |
| 장치 손실 상태 주입 후 복구 | 통과 — [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-device-recovery.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-device-loss.log) | 통과 — [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-device-recovery.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-device-loss.log) |
| 표면 재구성 필요 `-4` 주입 후 복구 | 통과 — generation 1에서 복구 시작, generation 2 생성 후 재그리기 성공, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-outdated-recovery.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-outdated-recovery.log) | 통과 — 같은 순서 확인, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-outdated-recovery.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-outdated-recovery.log) |
| 임시 오류 `-2`는 자동 복구하지 않음 | 통과 — generation 1 유지, 복구 시작 로그 없음. 이후 탭에서 같은 렌더러가 다시 그려 색과 입력 횟수가 바뀜, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-temporary-no-recovery.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-temporary-no-recovery.log) | 통과 — generation 1 유지, 복구 시작 로그 없음. 접근성 버튼 탭 뒤 같은 렌더러의 프레임 제출을 확인, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-temporary-no-recovery.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-temporary-no-recovery.log) |
| 복구 직후 재그리기도 실패 | 통과 — `-4`에서 generation 2 생성 뒤 `-3` 재그리기 오류를 기록하고 종료, generation 3·두 번째 복구 시도 없음, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-recovery-redraw-failed.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-recovery-redraw-failed.log) | 통과 — 같은 제한 동작 확인, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-recovery-redraw-failed.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-recovery-redraw-failed.log) |
| 복구 후 GPU 입력 | 통과 — 세로·가로 방향에서 탭 수 증가 확인 | 통과 — 세로·가로 방향에서 접근성 값과 R13 터치 로그 확인 |
| R08 기존 모드 회귀 | 통과 — Vulkan 렌더러·입력과 R08 접근성 이름 확인, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-r08-regression.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-android-r08-regression.log) | 통과 — Metal 렌더러·첫 프레임과 R08 접근성 이름 확인, [화면](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-r08-regression.png), [로그](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-r08-regression.log) |


iOS의 [세로 화면 캡처](https://github.com/ohah/spinon/blob/feat/r13-platform-gpu-recovery/spec/internal/evidence/r13-ios-touch-portrait.png)는 중앙 GPU 도형을 한 번 탭한 뒤의 상태입니다. 도형은 주황색이고 활성화 횟수는 1회입니다. Android에서도 같은 중앙 영역 탭 뒤 색상과 횟수가 바뀌는 것을 확인했습니다.
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

오류 주입값은 표면 손실 `1`, 장치 손실 `2`, `SurfaceOutdated`에 대응하는 `-4` `3`, 임시 오류 `-2` `4`입니다. iOS 인자는 각각 `surface`, `device`, `outdated`, `temporary`입니다. 복구 뒤 재그리기 오류도 확인하려면 Android에 `--ei spinon_r13_recovery_failure 1`을, iOS에 `--spinon-r13-recovery-failure=surface`를 추가합니다. 세부 값과 해석은 [R13 내부 명세](../r13-platform-gpu-recovery.md)를 따릅니다.

iOS 창 분리·재부착 경로는 다음 개발용 진단 인자로 실행합니다.

```sh
xcrun simctl launch booted dev.spinon.bootstrap --spinon-r13 --spinon-r13-window-cycle
```

## 결과 해석

- 재검증 후 테스트: JavaScript 1건, Rust workspace 26건, wgpu 실험 2건 통과.
- Android Debug APK와 iOS Simulator Debug app 빌드 통과.
- 추가 호스트 검증에서 양 플랫폼의 `-4` 복구 완료, `-2` 자동 복구 제외와 다음 입력 후 generation 1 렌더러 재사용, 복구 후 재그리기 실패 종료를 로그와 화면으로 확인했습니다. 재그리기 실패는 generation 2에서 끝났고 자동 재귀 복구를 시작하지 않았습니다.
- iOS 창 분리·재부착을 위한 개발용 `--spinon-r13-window-cycle` 진단 경로를 추가하고 시뮬레이터에서 실행했습니다. 기존 렌더러를 분리 시 해제하고 재부착 후 generation 2 렌더러가 생성되는 로그를 확인했습니다.
- R13 모드 분기 변경 후 기존 R08 모드도 양쪽 시뮬레이터에서 별도로 실행했습니다. 기존 R08 라벨과 렌더러 생성이 유지되고 R13 모드가 켜지지 않는 것을 확인했습니다.
- iOS의 `SPINON_R13_FRAME=submitted` 로그는 Rust `queue.submit`·`queue.present` 반환까지를 뜻하며 실제 compositor 표시 완료 증거는 아닙니다.
- 회전 후 Activity가 재생성되면 데모의 탭 횟수는 초기화됩니다. 재생성 뒤 입력 자체는 다시 동작합니다.
- FFI 핸들 호출은 UI 스레드에서 직렬화하는 계약입니다. 동시 `draw`·`resize`·`destroy` 경합은 시험하지 않았고, 장치 손실 주입도 실제 wgpu 비동기 콜백과 UI 스레드의 경합을 재현하지 않습니다.
- 실제 GPU 드라이버가 만든 손실과 실기기 동작은 검증하지 않았습니다. Android 에뮬레이터 분할 화면은 확인했지만 작은 패널에서 데모 레이아웃이 겹칩니다. iPadOS Stage Manager는 부동 창 진입만 확인했으며 반복 크기 변경과 외부 디스플레이 흐름은 검증하지 않았으므로 제품 안정성 근거에 포함하지 않습니다.

## 적대적 검토 5회

1. **상태 대장·계약·증거 연결:** R13만 완료 처리했고, 내부 ABI와 검증 기록을 서로 연결했습니다. 제품 지원 완료로 오해할 표현은 없습니다.
2. **오류 코드·FFI 경계:** `-3/-4/-5` 복구 대상과 `-2` 임시 오류가 코드·명세에서 일치합니다. 렌더러 호출은 UI 스레드에서 직렬화하고, 비동기 장치 손실 콜백은 원자 상태만 갱신합니다. 동시 FFI 경합과 실제 비동기 콜백 경합은 이 실험에서 실행하지 않았습니다.
3. **Android 수명·복구:** 일시 중지 중 그리기를 막고 표면 재생성·복귀 뒤 재시도합니다. 복구는 한 번만 수행하며 실패를 반복 재시도하지 않습니다.
4. **iOS 수명·모드 격리:** 첫 검토에서 R13 수명주기 처리가 R08 경로에도 번지는 점과 R08 앱 시작 시 비활성 상태가 첫 그리기를 막을 수 있는 점을 찾아 수정했습니다. 최종 빌드에서 두 모드의 회귀 로그와 화면을 다시 확인했습니다.
5. **증거·주장 범위:** Android는 SwiftShader CPU 어댑터, iOS는 시뮬레이터 GPU입니다. 장치 손실과 `SurfaceOutdated`는 상태 주입이며 실기기 성능이나 실제 드라이버 손실을 검증했다는 주장은 하지 않습니다. Android 에뮬레이터 분할 화면과 표면 재생성을 확인했지만 작은 창에서 데모 콘텐츠가 겹칩니다. iPad Stage Manager는 창 진입과 크기 로그 한 건만 확인했고, 반복 크기 조절·외부 디스플레이·실제 기기는 검증하지 않았습니다.

검토에서 찾은 모드 격리 결함을 수정한 뒤 Android·iOS 빌드, Rust/Bun 테스트와 양 플랫폼 R08 화면을 다시 확인했습니다. 위에 적은 환경·재현 한계는 남아 있습니다.
