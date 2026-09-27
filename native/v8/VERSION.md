# V8 빌드 기준

모바일 빌드 골격은 [V8 공식 저장소](https://chromium.googlesource.com/v8/v8)의 `tools/v8/v8-revision.txt`에 고정한 커밋을 사용합니다. 현재 커밋은 V8 `15.6.0` 후보 빌드에 해당하며, 기존 Android·iOS 스파이크에서 양쪽 링크를 확인한 기준입니다.

이 고정값은 첫 빌드 연결을 재현하기 위한 실험 기준입니다. 정식 릴리스 버전이나 안정 API 호환 약속이 아닙니다. 저장소에는 V8 소스와 산출물을 넣지 않으며, `build/v8-source/v8`에 checkout하고 플랫폼별 GN 설정으로 라이브러리를 생성합니다. V8 소스와 의존성은 `tools/v8/checkout.sh`로 준비합니다.

먼저 `mise.toml`에 고정한 도구를 설치하고 V8 checkout과 의존성을 준비합니다.

```sh
mise install
bash tools/v8/checkout.sh
```

Android V8 라이브러리:

```sh
bash tools/v8/build-android-macos.sh
```

iOS 시뮬레이터 V8 라이브러리:

```sh
bash tools/v8/build-ios-iphonesimulator.sh
```

Android SDK에는 `platforms;android-36`, `build-tools;35.0.0`, `ndk;27.1.12297006`을 설치합니다. Android NDK 버전의 기계 판독 원본은 `tools/android-ndk-version.txt`입니다. iOS 앱 빌드에는 Xcode 26.2와 iOS 18 SDK가 필요합니다. V8 첫 컴파일은 개발 머신에서 수행하며 소스·산출물은 저장소의 `build/` 아래에만 둡니다.

V8 C++ API 사용과 C ABI 경계는 [내부 V8 실행 인터페이스](../../spec/internal/0001-v8-bootstrap.md)에 기록합니다. `spinon` 전역 객체는 빌드·플랫폼 연결을 확인하는 예제 전용 호스트 표면이며, 공개 JS API가 아닙니다.
