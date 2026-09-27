# 네이티브 부트스트랩 검증 기록

**검증일:** 2026-09-28 · **대상:** Android·iOS 앱 시작 V8 smoke · **제품 기능 완료:** 아님

이 기록은 Bun 번들, Rust FFI, V8, 앱 호스트 사이의 시작 경로만 확인합니다. 화면 렌더링, 터치, GPU, 병렬 호출, iOS 실기기, OTA는 확인하지 않았습니다.

## 고정 도구와 런타임

| 항목 | 값 |
| --- | --- |
| Bun | `1.4.0` |
| Rust / Cargo | `1.96.1` |
| Java | Temurin `17.0.19+10` |
| Xcode | `26.2` (`17C52`) |
| V8 소스 | `tools/v8/v8-revision.txt`에 지정한 커밋 |
| Android SDK / NDK | API `36` / NDK `27.1.12297006` |
| Android 단말 | `SM-S731N`, Android `16`, API `36` |
| iOS 시뮬레이터 | iPhone `17 Pro`, iOS `26.2`, arm64 |

두 플랫폼의 이 빌드에서는 JIT를 사용합니다. GN 설정에서 Intl, Temporal, WebAssembly를 끕니다. iOS 실기기용 JIT 없는 설정은 별도 스크립트에만 있으며 이 검증 범위에 포함하지 않았습니다.

## 실행 결과

| 실행 | 결과 |
| --- | --- |
| `mise exec -- bun install --frozen-lockfile` | 잠금 파일 변경 없이 완료 |
| `mise exec -- bun run test` | Bun 1개 테스트·5개 단언, Rust 2개 테스트 통과 |
| `mise exec -- cargo fmt --all -- --check` | 통과 |
| `mise exec -- bun run docs:build` | RSPress 빌드 통과 |
| `mise exec -- bun run build:android` | Gradle `BUILD SUCCESSFUL`; APK 설치·실행 확인 |
| `mise exec -- bun run build:ios-sim` | Xcode `BUILD SUCCEEDED`; 시뮬레이터 앱 설치·실행 확인 |

Android 실기기 로그:

```text
SPINON_BOOTSTRAP_RESULT=nodes=2 last_node=8 tag=text text=이벤트:7
```

iOS 시뮬레이터 로그:

```text
SPINON_BOOTSTRAP_RESULT=nodes=2 last_node=8 tag=text text=이벤트:7
```

## 범위 제한

- Android는 arm64 실기기에서 확인했습니다. Android 에뮬레이터와 다른 ABI는 이 기록의 검증 대상이 아닙니다.
- iOS는 arm64 시뮬레이터에서 링크하고 실행했습니다. 실기기 서명·설치·JIT 정책은 확인하지 않았습니다.
- iOS 빌드는 Xcode의 App Intents 메타데이터 생략 및 V8 정적 라이브러리의 결정적 아카이브 타임스탬프 관련 경고를 출력했지만 앱 빌드와 실행은 성공했습니다.
- 이 결과로 `spec/STATUS.md`의 앱 사용자 기능을 완료 처리하지 않습니다.
