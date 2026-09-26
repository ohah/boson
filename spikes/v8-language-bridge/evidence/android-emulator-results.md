# Android 에뮬레이터 실행 기록

2026-09-26, Android 16(API 36) ARM64 에뮬레이터에서 공식 V8 소스 커밋 `7b50b62cb18f28617959e8452e2cd18195b38bcf`를 사용한 네 실행 파일을 각각 실행했다. [원본 실행 로그](android-emulator-results.log)에 네 방식 모두 `node=1 tag=view`, `node=2 tag=text`, `EXIT_CODE=0`이 기록돼 있다.

| 방식 | Android 실행 | 디버그 심볼 제거 후 파일 크기 |
| --- | --- | ---: |
| C++에서 V8 API 직접 호출 | 성공 | 22,868,184바이트 |
| C++ 공통 C ABI 경계 | 성공 | 22,868,184바이트 |
| Rust + C++ 경계 | 성공 | 23,146,712바이트 |
| Zig + C++ 경계 | 성공 | 22,868,184바이트 |

이 실행 파일들은 화면이 없는 네이티브 PoC다. `adb push`로 `/data/local/tmp`에 복사해 실행했으며, Android 앱 패키지나 실제 UI 렌더링을 검증한 결과는 아니다. 파일 크기는 이 작은 정적 링크 예제에서 측정한 값이고 최종 앱 크기나 성능 비교로 일반화할 수 없다.

## 로컬 빌드 조건

Mac에서 `build-v8-android-macos.sh`로 Android ARM64용 V8 정적 라이브러리와 libc++ 라이브러리를 빌드했다. 현재 V8의 GN은 Android 대상 빌드에서 Linux 호스트만 허용한다. 스크립트는 빌드 중 해당 검사만 임시로 해제하고 종료 시 원본 파일을 복원한다. Mac에 설치된 Android NDK를 빌드 경로에 임시로 연결하고, V8의 C++ 헤더 및 링커를 사용한다. 이는 공식 지원 빌드 경로가 아닌 실험적 교차 빌드다.

V8은 상대 C++ 가상 테이블 ABI를 사용하므로 예제의 C++ 연결부도 같은 `-fexperimental-relative-c++-abi-vtables` 옵션으로 컴파일했다. 이 옵션이 빠졌을 때는 노드 로그 이후 종료 과정에서 `SIGSEGV`가 발생했고, 옵션을 맞춘 뒤 네 방식 모두 정상 종료했다. Android 최소 API는 빌드 설정상 29다.

재현 명령(동일 커밋의 V8 체크아웃과 Android 의존성이 준비된 상태):

```sh
bash spikes/v8-language-bridge/build-v8-android-macos.sh
V8_ANDROID_CHECKOUT="$PWD/build/v8-source/v8" \
  V8_ANDROID_OUT=out/boson-android-mac \
  bash spikes/v8-language-bridge/build-android.sh
```

이 PoC에서 확인한 것은 V8의 JS 평가, JS→네이티브 노드 콜백, 네이티브→JS 이벤트 호출 및 정상 종료다. 터치, 레이아웃, 렌더링, UI 성능은 아직 측정하지 않았다.
