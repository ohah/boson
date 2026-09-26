# iOS 시뮬레이터 실행 기록

2026-09-26, iPhone 17 Pro 시뮬레이터(iOS 26.2, Apple Silicon Mac)에서 공식 V8 소스 커밋 `7b50b62cb18f28617959e8452e2cd18195b38bcf`로 빌드한 정적 라이브러리를 사용했다. `build-ios-sim.sh`로 네 앱을 빌드하고 각각 설치·실행했다.

| 방식 | 표준 출력 | 앱 종료 기록 |
| --- | --- | --- |
| C++에서 V8 API 직접 호출 | `node=1 tag=view`, `node=2 tag=text` | `BOSON_V8_RESULT=0` |
| C++ 공통 C ABI 경계 | `node=1 tag=view`, `node=2 tag=text` | `BOSON_V8_RESULT=0` |
| Rust + C++ 경계 | `node=1 tag=view`, `node=2 tag=text` | `BOSON_V8_RESULT=0` |
| Zig + C++ 경계 | `node=1 tag=view`, `node=2 tag=text` | `BOSON_V8_RESULT=0` |

위 출력은 각 앱 실행 직후 저장한 `build/v8-language-bridge/ios-sim/{cpp_direct,cpp,rust,zig}.stdout`와 `.stderr`에서 확인했다. `BOSON_V8_RESULT=0`은 앱이 JavaScript 평가와 콜백 결과를 기록한 값이다. 화면 캡처는 [Zig 앱 실행 화면](ios-simulator-zig.png)이다. 화면 문구는 앱 자체의 결과 표시이며 실제 노드 생성은 위 로그로 확인한다.

이 기록은 시뮬레이터에서 V8 링크와 JavaScript↔네이티브 호출이 동작했음을 보여준다. iOS 실기기 실행과 Android 최종 링크·실행은 아직 확인하지 않았다. 렌더러 성능이나 네 방식의 상대 속도도 측정하지 않았다.
