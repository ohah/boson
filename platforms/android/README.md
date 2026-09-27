# Android 빌드 골격

`app/`은 V8 정적 라이브러리와 Rust FFI를 묶어 앱 시작 때 예제 JavaScript를 한 번 실행하는 개발용 부트스트랩입니다. 이 앱의 빈 화면과 로그는 제품 렌더러가 아니며 Android 네이티브 UI 지원을 뜻하지 않습니다.

필요한 도구는 JDK 17, Android SDK 36, NDK `27.1.12297006`, Bun·Rust는 루트 `mise.toml`의 고정 버전입니다. Gradle Wrapper `8.13`과 Android Gradle Plugin `8.13.2`를 사용합니다. V8 소스 커밋·빌드 산출물 준비는 [V8 빌드 안내](../../native/v8/VERSION.md)를 따릅니다.

Android SDK에는 `platforms;android-36`, `build-tools;35.0.0`, `ndk;27.1.12297006`을 설치합니다. NDK 버전의 단일 원본은 `tools/android-ndk-version.txt`이고 Gradle과 네이티브 빌드가 같은 값을 읽습니다. SDK가 `~/Library/Android/sdk`가 아닌 경로에 있으면 `ANDROID_SDK_ROOT`를 지정합니다. `ANDROID_NDK_HOME`이 다른 버전을 가리키면 경고를 남기고 SDK에 설치한 고정 버전을 우선 사용합니다.

```sh
sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;35.0.0" "ndk;$(cat tools/android-ndk-version.txt)"
```

루트에서 `mise exec -- bun run build:android`로 APK를 빌드합니다. Gradle Wrapper의 `preBuild`가 Bun 번들 생성, Rust ARM64 정적 라이브러리 빌드, V8·JNI 공유 라이브러리 링크를 먼저 수행합니다. APK는 `platforms/android/app/build/outputs/apk/debug/app-debug.apk`에 생성됩니다.

실행 로그는 `adb logcat -s SpinonBootstrap`에서 `SPINON_BOOTSTRAP_RESULT=nodes=2 last_node=8 tag=text text=이벤트:7`을 확인합니다. 현재 범위는 ARM64 단일 ABI의 시작 smoke이며 GPU·입력·UI 트리·접근성·JIT 없는 기기 빌드는 포함하지 않습니다. 구현 완료 표시는 [공식 상태 대장](../../spec/STATUS.md)과 [내부 V8 실행 인터페이스](../../spec/internal/0001-v8-bootstrap.md) 기준을 따릅니다.
