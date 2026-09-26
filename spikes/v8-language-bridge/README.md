# Boson V8 언어 선택 실험

## 목적

C++ 단독, Rust+C++, Zig+C++가 동일한 Boson 최소 기능을 구현할 때의 연결 비용을 비교한다. 이 실험은 렌더러 성능 측정이 아니다.

## 동일한 기능

1. V8에서 JavaScript 문자열을 실행한다.
2. JavaScript의 `boson.createNode(1, "view")`가 네이티브 콜백을 호출한다.
3. 네이티브가 이벤트 `1`을 JavaScript 함수에 전달한다.
4. 그 함수가 `boson.createNode(2, "text")`를 호출한다.
5. 결과로 `node=1 tag=view`와 `node=2 tag=text`가 출력된다.

`include/boson_v8.h`가 Rust와 Zig에서 공유하는 C ABI 경계다. C++에는 같은 경계를 사용하는 예제와 V8 C++ API를 직접 사용하는 예제를 모두 둔다. 현재 경계는 문자열 평가와 단일 이벤트만 다루며, ES 모듈 로더·타이머·렌더링·레이아웃·OTA·UI 스레드 처리는 포함하지 않는다.

## 실행

macOS에서 Homebrew Node 라이브러리를 임시 V8 공급원으로 사용한다. `bash spikes/v8-language-bridge/build-host.sh`를 Boson 저장소 루트에서 실행한다. `NODE_PREFIX`로 Homebrew 설치 경로를 지정할 수 있다.

`bash spikes/v8-language-bridge/build-target-objects.sh`는 iOS 기기·시뮬레이터·Android ARM64용 C++ 어댑터와 언어별 오브젝트를 컴파일한다. `V8_HEADERS`에 동일 버전의 공식 V8 헤더 경로를 지정할 수 있다. 기본값인 Node 헤더를 사용한 대상별 오브젝트 컴파일은 **모바일 V8 링크나 앱 실행을 증명하지 않는다**.

## 확인된 결과

2026-09-26, macOS arm64에서 C++ 직접 연동, C++ 공통 경계, Rust+C++, Zig+C++ 네 실행 파일이 위의 동일한 출력으로 종료했다. 공식 V8 소스 커밋은 `7b50b62cb18f28617959e8452e2cd18195b38bcf`다.

iOS 시뮬레이터에서는 공식 V8 정적 라이브러리와 링크한 네 앱을 각각 설치·실행했다. 모든 앱에서 위 두 노드 출력과 `BOSON_V8_RESULT=0`을 확인했다. 시뮬레이터 빌드는 JIT가 켜져 있어 Apple `BrowserEngineCore` 프레임워크를 링크했다. 이 결과를 iOS 실제 기기의 JIT 없는 실행 결과로 간주하지 않는다.

실행 결과와 화면 캡처: [iOS 시뮬레이터 실행 기록](evidence/ios-simulator-results.md).

iOS 기기·시뮬레이터와 Android ARM64에서 세 언어의 오브젝트 컴파일을 확인했다. iOS 기기용 V8 정적 라이브러리와 Android용 V8 정적 라이브러리 빌드 및 최종 실행 결과는 별도로 기록한다.

Android V8 소스 빌드는 V8의 GN 설정이 macOS 호스트를 거부하므로 Linux 빌드 환경이 필요하다. iOS 기기용 V8은 JIT 없는 설정으로 빌드한다. 두 플랫폼에서 **같은 V8 소스 리비전**을 사용해야 비교 가능하다.

## 다음 판정 기준

각 조합에서 공식 V8 소스 빌드, 최종 링크, 실행, 오류 처리, 이벤트 콜백 수명, 빌드 시간 및 산출물 크기를 기록한다. 실행 성능은 동일한 JS 번들·동일한 V8 빌드 설정·동일 기기 조건을 갖춘 뒤 측정한다. 현재 macOS Node 라이브러리 결과를 모바일 앱 크기나 속도의 근거로 사용하지 않는다.

V8 소스·빌드 근거: [공식 소스 체크아웃](https://v8.dev/docs/source-code), [iOS 교차 컴파일](https://v8.dev/docs/cross-compile-ios), [Android ARM 교차 컴파일](https://v8.dev/docs/cross-compile-arm).
