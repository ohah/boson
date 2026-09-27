# 내부 인터페이스 0001 · V8 부팅 실험

**상태:** 실험 전용 · **인터페이스 버전:** `0.1.0-draft` · **공개 API:** 아님

이 문서는 Android·iOS 빌드 골격에서 V8 정적 라이브러리, C++ 엔진 어댑터, Rust `spinon-ffi` 정적 라이브러리 사이의 호출 규약을 고정합니다. 이 실험 표면은 제품의 UI 트리·이벤트 API나 안정 ABI를 약속하지 않습니다.

## 빌드 기준

- V8 소스 고정 커밋의 기계 판독 원본은 `tools/v8/v8-revision.txt`이고, 설명은 `native/v8/VERSION.md`에 둡니다. C++ API는 `native/v8/include/spinon_v8.h`에 선언합니다.
- C ABI는 `crates/spinon-ffi/include/spinon_ffi.h`에 선언합니다.
- JavaScript 예제는 `examples/bootstrap/app.js`이며 Bun으로 브라우저 대상 단일 파일을 생성합니다.
- Android 실기기는 ARM64, iOS 시뮬레이터는 ARM64를 초기 실행 대상으로 합니다. 두 실행 대상은 JIT 빌드이며, iOS 기기용 V8 설정은 JIT 없는 별도 빌드입니다. 이 검증에서는 iOS 실기기 앱 실행을 확인하지 않습니다.
- Android JNI는 Java의 `StandardCharsets.UTF_8` 바이트 배열로 양방향 문자열을 전달해 JNI Modified UTF-8 변환을 피합니다.

## 호출과 소유권

1. 앱 호스트가 번들 JavaScript UTF-8 문자열을 `spinon_app_run`에 전달합니다.
2. Rust가 스택 수명의 콜백 상태를 만들고 `spinon_v8_runtime_new`를 호출합니다.
3. C++ 어댑터가 V8 `Isolate`와 `Context`를 소유하며, Rust는 V8 핸들이나 포인터를 보관하지 않습니다.
4. 실행 중 V8은 Rust 콜백을 동기 호출합니다. 콜백 사용자 데이터는 `spinon_app_run`이 반환하기 전까지만 유효합니다.
5. Rust가 JavaScript 이벤트 핸들러를 동기 호출하고 결과를 호스트 버퍼에 NUL 종료 UTF-8 문자열로 복사합니다.
6. 성공·오류와 무관하게 Rust가 V8 런타임을 해제합니다. V8 프로세스 전역 플랫폼은 앱 프로세스 종료까지 유지합니다.

`spinon_app_run`은 성공 `0`, 인자 오류 `-1`, V8 생성 실패 `-2`, 출력 버퍼 부족 `-3`, 평가·이벤트 오류 `-4`를 반환합니다. 평가·이벤트 오류 메시지는 결과 버퍼에 들어갑니다. 호출자는 결과 버퍼를 호출 전 할당하고, 성공·오류 문자열을 읽기 전까지 유지해야 합니다.

## 실험용 JavaScript 호스트 표면

| 함수 | 인자 | 효과 | 오류 |
| --- | --- | --- | --- |
| `spinon.createNode(id, tag)` | 정수 ID, 문자열 태그 | Rust 콜백으로 노드 생성 로그를 전달 | 인자 형식이 다르면 JS 예외 |
| `spinon.setText(text)` | 문자열 | Rust 콜백으로 텍스트를 전달 | 인자 형식이 다르면 JS 예외 |
| `spinon.onEvent(handler)` | 함수 | 한 개의 이벤트 핸들러를 V8 Global 핸들로 보관 | 함수가 아니면 JS 예외 |

앱 시작 시 예제 스크립트를 평가한 다음 네이티브가 ID `7` 이벤트를 한 번 전달합니다. 예제 응답 `이벤트:7`은 UTF-8 문자열이 Android JNI·V8·Rust와 iOS·V8·Rust 경계를 통과하는지 확인합니다. 이 동작은 링크 smoke 경로이며 실제 터치, 화면 표시, 병렬 이벤트 안전성 또는 제품 이벤트 의미를 검증하지 않습니다. 현재 구현은 한 스레드에서 생성·평가·이벤트 전달·해제를 순서대로 수행합니다.

## 오류·미지원

- JavaScript 구문·실행 오류와 이벤트 핸들러 예외는 V8 메시지를 결과 문자열에 기록합니다.
- C ABI의 JavaScript 원본과 문자열 콜백은 NUL 종료 UTF-8 C 문자열입니다. 이 내부 인터페이스는 문자열 안의 U+0000을 보존하지 않습니다.
- Android와 iOS용 GN 설정에서는 Intl, Temporal, WebAssembly 지원을 꺼 둡니다. 이 부트스트랩의 JS 호환 범위는 해당 V8 빌드 설정을 기준으로 합니다.
- iOS 앱 타깃은 `BrowserEngineCore`를 링크합니다. 이 부트스트랩에서 시뮬레이터 링크·실행만 확인했으며, 실기기 배포 권한이나 App Store 정책 적합성은 확인하지 않았습니다. 관련 정책 검토는 `spec/STATUS.md`의 R09에 남아 있습니다.
- 이 실험은 ES module 로더, 타이머, 네트워크, DOM, CSS, GPU, OTA를 제공하지 않습니다.
- V8 플랫폼 초기화의 실패 복구, isolate 재사용, 다중 스레드 호출, 취소, 소스맵·스택 매핑은 아직 정의하지 않았습니다.
- 이 문서와 테스트는 `spec/STATUS.md`의 앱 사용자용 기능 완료를 의미하지 않습니다.
