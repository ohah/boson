# 터치 → JavaScript → 네이티브 화면 PoC

## 확인하려는 경계

두 모바일 플랫폼에서 같은 `touch.js`를 V8으로 실행한다. 네이티브 버튼을 실제로 누르면 노드 ID `1`이 JavaScript 이벤트 핸들러로 전달된다. JavaScript는 누른 횟수를 늘리고 `boson.setText()`를 호출한다. 네이티브 콜백이 화면의 글자를 `Taps: 0`에서 `Taps: 1`, `Taps: 2`로 바꾼다.

```text
UIKit UIButton / Android Button
  → boson_touch_dispatch(runtime, 1)
  → V8의 boson.onEvent 핸들러
  → boson.setText("Taps: n")
  → UIKit UILabel / Android TextView
```

| 방식 | V8 연결 | iOS 시뮬레이터 | Android ARM64 에뮬레이터 |
| --- | --- | --- | --- |
| `cpp_direct` | C++에서 V8 API 직접 호출 | 실제 터치 2회, `Taps: 2` | 실제 터치 2회, `Taps: 2` |
| `cpp` | C++ → 공통 C ABI → V8 | 실제 터치 2회, `Taps: 2` | 실제 터치 2회, `Taps: 2` |
| `rust` | Rust → 공통 C ABI → V8 | 실제 터치 2회, `Taps: 2` | 실제 터치 2회, `Taps: 2` |
| `zig` | Zig → 공통 C ABI → V8 | 실제 터치 2회, `Taps: 2` | 실제 터치 2회, `Taps: 2` |

2026-09-26에 iPhone 17 Pro 시뮬레이터(iOS 26.2)와 Android 16 API 36 ARM64 에뮬레이터에서 확인했다. 각 방식의 로그에 `BOSON_TOUCH_RESULT=0`이 두 번 남았다. [iOS 로그와 화면](evidence/ios-simulator-results.md), [Android 로그와 화면](evidence/android-emulator-results.md)을 함께 보관한다. V8 소스 커밋은 `7b50b62cb18f28617959e8452e2cd18195b38bcf`다.

## 로컬 빌드와 실행

먼저 [V8 언어 연결 실험](../v8-language-bridge/README.md)의 공식 V8 소스 및 모바일용 정적 라이브러리를 준비한다. 저장소 루트에서 실행한다.

```sh
bash spikes/touch-js-ui/build-ios-sim.sh
bash spikes/touch-js-ui/build-android.sh
```

iOS는 `build/touch-js-ui/ios-sim/{방식}.app`에, Android는 `build/touch-js-ui/android/{방식}.apk`에 산출된다. iOS 시뮬레이터 실행 예:

```sh
xcrun simctl install booted build/touch-js-ui/ios-sim/zig.app
xcrun simctl launch --console booted dev.boson.touch.zig
```

Android 에뮬레이터 실행 예:

```sh
adb install -r build/touch-js-ui/android/zig.apk
adb shell am start -n dev.boson.touch.zig/dev.boson.touch.TouchActivity
adb logcat -d -s BosonTouch:I '*:S'
```

화면에서 `Tap`을 두 번 누르면 `Taps: 2`가 보여야 한다. iOS의 `boson-counter` 접근성 ID와 Android의 `boson-counter:Taps: 2` 접근성 설명으로 화면 상태도 읽을 수 있다.

## 현재 범위

네이티브 버튼과 텍스트는 각 앱이 미리 만든다. `boson.createNode()`는 아직 노드 ID와 태그를 로그로만 기록한다. 따라서 이 결과는 JS 이벤트 재진입과 네이티브 화면 변경을 입증하지만, JS 선언으로 임의의 UI 트리나 레이아웃을 만들고 변경하는 렌더러까지 입증하지 않는다. 현재 이벤트 처리는 UI 스레드에서 동기 실행된다. iOS 실기기 터치, OTA, 번들러 호환성, 성능 비교는 이 실험에서 확인하지 않았다.

[후속 Android 동적 트리 PoC](../dynamic-tree/README.md)는 Rust 코어가 JS 노드 생성·삭제와 제한된 행·열 레이아웃을 담당하고, Android 실기기 화면에서 그 변화를 확인한다.
