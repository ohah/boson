# C04 · Stylo stylesheet 입력 목록 검증

**측정일:** 2026-10-01 · **범위:** `spinon-style` 단위 실행 · **C04 완료:** 아니요

## 확인한 동작

- Stylo `0.22.0` stylesheet parser에 UTF-8 원문, base URL, `UserAgent`/`Author` 출처를 전달한다.
- author·UA·author 순서로 교차 등록한 입력의 전체 추가 순번(0, 1, 2)과 파싱된 `StylesheetContents.origin`을 확인한다. 출처별 cascade 우선순위는 계산하지 않는다.
- 대문자 host·기본 port·dot segment가 포함된 기준 URL을 URL 표준 파서가 정규화한 값으로 목록에 보존한다.
- stylesheet ID 중복과 상대 URL 입력은 거부되며 기존 목록은 유지된다.
- 잘못된 선언 `.title { color: red;\n width: ???; }`은 parser diagnostic 위치 `(line: 1, column: 2)`를 보존하면서 stylesheet의 규칙을 유지한다. 줄은 0부터, 열은 1부터 센다.
- 로더가 없는 `@import` 입력은 진단되고, 뒤에 있는 author 규칙은 파싱된다. API에 자원 로더가 없고 Stylo에 `AllowImportRules::No`를 전달하므로 이 경계에 URL 요청 경로는 없다.

## 실행

```sh
mise exec -- cargo test -p spinon-style
```

결과: 11개 단위 테스트 통과. 새 registry 사례 4개와 C03 Stylo DOM adapter 사례 7개를 포함한다.

워크스페이스 검증도 실행했다: `cargo test --locked --workspace`, `cargo clippy --locked --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`. `spinon-style`은 iOS 기기(`aarch64-apple-ios`), iOS 시뮬레이터(`aarch64-apple-ios-sim`), Android ARM64(`aarch64-linux-android`) 대상으로 각각 `cargo check --locked`를 통과했다. 이는 대상별 컴파일 확인이며 앱 실행·화면 동작 검증은 아니다.

## 한계

이 검증은 Chromium과 computed CSS 값을 비교하지 않는다. Stylo selector matcher·Stylist cascade, specificity, `!important`, inheritance, UA cascade 적용, `@import` 자원 해석, layout, GPU, Android/iOS 앱 실행은 아직 연결하지 않았다. 따라서 CSS 기능 지원이나 C04 완료 근거가 아니다. 다음 단계의 cascade 구현 전에 C01 기준 fixture에 같은 선언의 computed value oracle을 추가한다.
