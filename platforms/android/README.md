# Android 빌드 골격

`app/`은 V8 정적 라이브러리와 Rust FFI를 묶어 앱 시작 때 예제 JavaScript를 한 번 실행하는 개발용 부트스트랩입니다. 이 앱의 빈 화면과 로그는 제품 렌더러가 아니며 Android 네이티브 UI 지원을 뜻하지 않습니다.

필요한 도구는 JDK 17, Android SDK 36, NDK `27.1.12297006`, Bun·Rust는 루트 `mise.toml`의 고정 버전입니다. Gradle Wrapper `8.13`과 Android Gradle Plugin `8.13.2`를 사용합니다. V8 소스 커밋·빌드 산출물 준비는 [V8 빌드 안내](../../native/v8/VERSION.md)를 따릅니다.

Android SDK에는 `platforms;android-36`, `build-tools;35.0.0`, `ndk;27.1.12297006`을 설치합니다. NDK 버전의 단일 원본은 `tools/android-ndk-version.txt`이고 Gradle과 네이티브 빌드가 같은 값을 읽습니다. SDK가 `~/Library/Android/sdk`가 아닌 경로에 있으면 `ANDROID_SDK_ROOT`를 지정합니다. `ANDROID_NDK_HOME`이 다른 버전을 가리키면 경고를 남기고 SDK에 설치한 고정 버전을 우선 사용합니다.

```sh
sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;35.0.0" "ndk;$(cat tools/android-ndk-version.txt)"
```

루트에서 `mise exec -- bun run build:android`로 APK를 빌드합니다. Gradle Wrapper의 `preBuild`가 Bun 번들 생성, Rust ARM64 정적 라이브러리 빌드, V8·JNI 공유 라이브러리 링크를 먼저 수행합니다. APK는 `platforms/android/app/build/outputs/apk/debug/app-debug.apk`에 생성됩니다.

기본 시작 smoke 로그는 `adb logcat -s SpinonBootstrap`에서 `SPINON_BOOTSTRAP_RESULT=nodes=2 last_node=8 tag=text text=이벤트:7`을 확인합니다. 기본 smoke 범위는 ARM64 단일 ABI이며 GPU·제품 입력·UI 트리·접근성·JIT 없는 기기 빌드는 포함하지 않습니다. 별도 R06 화면에서만 개발용 터치 버튼을 실행합니다. 구현 완료 표시는 [공식 상태 대장](../../spec/STATUS.md)과 [내부 V8 실행 인터페이스](../../spec/internal/0001-v8-bootstrap.md) 기준을 따릅니다.

## V8 실행 스레드 실험

개발용 APK에서 Rust 세션 스레드·입력·취소 화면을 열려면 아래 Intent를 사용합니다. 기본 시작 화면과 R10 실험 화면은 유지됩니다.

```sh
adb install -r platforms/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.spinon.bootstrap/.MainActivity --ez spinon_runtime_threads true
adb logcat -s SpinonBootstrap:I
```

화면에서 긴 JavaScript 실행 중 탭을 눌러 UI가 반응하는지 확인하고, 별도 취소 버튼을 누른 뒤 `owner_tid`가 유지되는지 로그를 확인합니다. 가짜 V8 단위 테스트는 제어 경로만 검증하므로 실제 V8이 실행된 에뮬레이터의 원본 로그도 확인합니다. Android 어댑터는 동기 FFI 호출을 4개 작업자와 최대 64개 대기 작업으로 제한하고, 취소는 별도 제어 실행기에서 보냅니다. [대기열 압력 원본 로그](../../spec/internal/evidence/r06-android-queue-pressure-2026-09-30.log)는 Android 16 에뮬레이터에서 70회 탭 주입, 화면 카운터 69회, 플랫폼 작업 2회 거부, V8 dispatch 67회 성공을 기록합니다. 이 수치는 플랫폼 대기열 실험이며 Rust 런타임 큐 포화를 뜻하지 않습니다. 범위와 한계는 [V8 실행 스레드 실험 명세](../../spec/internal/0005-v8-runtime-session.md)와 [R06 검증 근거](../../spec/internal/evidence/r06-v8-runtime-thread-2026-09-30.md)에 기록합니다.

### 실제 V8 우선순위 선택 검증

에뮬레이터에서 세 우선순위 선택 순서와 각 등급의 FIFO 순서를 확인하는 개발 진단 화면을 실행합니다.

```sh
adb shell am start -n dev.spinon.bootstrap/.MainActivity --ez spinon_priority_probe true
adb logcat -s SpinonBootstrap:I | rg 'SPINON_PRIORITY_PROBE'
```

진단은 실제 V8에서 실행 중인 JavaScript를 취소한 뒤, 우선순위를 섞어 접수한 6개 작업의 실행 순서를 검사합니다. 통과 로그는 `priority_probe=PASS`와 `user-blocking`, `user-visible`, `background` 순서 및 같은 등급의 접수 순서를 표시합니다. 일반 앱 API가 아닌 내부 검증 경로입니다. 2026-09-30 Android 16 ARM64 에뮬레이터에서 실제 V8 검증을 통과했습니다. 상세 결과·화면·원본 로그는 [우선순위 시뮬레이터 검증](../../spec/internal/evidence/r06-priority-simulators-2026-09-30.md)을 참고하세요. 이 단일 배치는 지속 유입 시 기아·공정성이나 실기기 성능을 검증하지 않습니다.
