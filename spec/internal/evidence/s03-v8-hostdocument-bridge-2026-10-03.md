# S03.1 · V8 HostDocument 변경 묶음 실행 근거

**검증일:** 2026-10-03 · **작업 범위:** 내부 V8↔Rust 변경 묶음 · **상태:** 구현 브랜치 검증 · **공개 DOM API:** 아님

이 기록은 S03.1 구현을 독립적인 30개 공격 관점으로 확인한 결과다. V8·Rust 입력 경계, 변경 원자성, FFI 포인터, UTF-16, revision, 양 플랫폼 실행을 각각 검사했다. 각 항목에 실행 테스트인지 정적 검토인지 표시해 근거의 범위를 구분한다. 성공 결과는 S03 전체, 공개 DOM 호환, GPU 출력 또는 성능 완료를 뜻하지 않는다.

## 실행 환경

- V8 `15.6` 후보 빌드, revision `7b50b62cb18f28617959e8452e2cd18195b38bcf`; Android ARM64와 iOS Simulator ARM64 빌드가 같은 revision을 사용했다.
- Android 16 / API 36 ARM64 에뮬레이터 `emulator-5554`; USB 실기기는 실행 대상으로 선택하지 않았다.
- iPhone 17 Pro / iOS 26.2 ARM64 시뮬레이터.
- 양쪽 GN 설정은 `v8_jitless = false`다. JITless 동작·실기기·성능 수치는 이번 근거에 포함하지 않는다.
- V8 fixture는 앱 시작 직후 입력 실패와 8종 변경을 실행하고, 이어 이벤트 callback 안에서 텍스트를 변경한다. 모든 실패 확인이 성공하지 않으면 부팅 결과를 출력하지 않는다.

## 적대적 검증 30회

1. **호출 인자 모양 · 실제 V8 fixture + 고정 V8 소스 검토** — 배열 대신 객체를 전달해 동기 `TypeError`와 무변경을 확인했다. V8 `Value::IsArray()`는 실제 `JSArray`인지 검사하므로 Proxy로 감싼 배열도 `As<Array>()` 캐스트 전에 거부된다.
2. **실수형 정수 입력 · 실제 V8 fixture** — 노드 ID `1.5`를 전달했다. 32비트 정수 파서가 거부했고 callback/문서 변경으로 이어지지 않았다.
3. **알 수 없는 작업 이름 · 실제 V8 fixture** — 32 코드 단위 안의 `unsupported`를 전달했다. 작업 분류에서 동기 거부했다.
4. **과도한 작업 이름 · 실제 V8 fixture + 코드 검토** — 33 UTF-16 코드 단위 문자열은 UTF-8 변환 전에 거부한다. 길이 검사를 변환 뒤에 수행해 큰 임시 문자열을 만드는 경로를 차단했다.
5. **희소 배열 · 실제 V8 fixture** — 길이 1의 빈 슬롯 배열을 전달했다. 슬롯 조회가 `undefined`를 반환해 거부했다.
6. **getter 중 배열 확장 · 실제 V8 fixture** — 첫 작업의 `type` getter가 원 배열에 300개 작업을 추가했다. 진입 때 저장한 원래 길이 1만 처리했고 revision을 바꾸지 않았다.
7. **getter 예외 정체성 · 실제 V8 fixture** — getter가 미리 만든 sentinel `Error` 객체를 던졌다. catch 지점의 객체 identity가 원본과 같았다.
8. **파싱 중 재진입 · 실제 V8 fixture** — getter에서 빈 변경 묶음을 중첩 호출했다. 내부 호출만 동기 거부되고 바깥의 getter/배열 처리 상태는 유지됐다.
9. **8종 명령 매핑 · 실제 V8 fixture** — `createElement`, `createText`, `append`, `insertBefore`, `remove`, `setText`, `setAttribute`, `removeAttribute`를 실행했다. V8→C ABI→Rust callback 전체가 성공했고 예상 영수증을 반환했다.
10. **최대 작업 수 초과 · 실제 V8 fixture** — 257개 작업을 전달했다. Rust callback 전에 거부됐고 문서 revision은 후속 영수증으로 보존을 확인했다.
11. **최대 작업 수 경계 · Rust 단위 테스트** — 256개 작업 묶음은 수락되어 256개 노드를 생성했다.
12. **이름 초과 경계 · Rust 단위 테스트** — UTF-16 1,025개 속성 이름을 제출했다. 노드 예약 전에 거부됐다.
13. **이름 허용 경계 · Rust 단위 테스트** — UTF-16 1,024개 속성 이름을 제출했다. 유효 변경으로 수락됐다.
14. **필드 값 초과 경계 · Rust 단위 테스트** — 1,048,577개 UTF-16 단위 값을 거부하고 연결 키·revision이 바뀌지 않음을 확인했다.
15. **필드 값 허용 경계 · Rust 단위 테스트** — 1,048,576개 UTF-16 단위 텍스트를 수락했다.
16. **묶음 총량 초과 · Rust 단위 테스트** — 두 텍스트 합계 1,100,001단위에서 거부하고 어떠한 노드 핸들도 예약하지 않았다.
17. **FFI 묶음 총량 · Rust callback 단위 테스트** — 포인터 입력을 Rust 문자열로 복사하는 동안 총량 상한을 적용했고, 초과 시 HostDocument revision이 그대로였다.
18. **V8 묶음 총량 · 실제 V8 fixture** — 600,000 + 500,001단위 텍스트를 거부했다. 이어진 빈 묶음 영수증에서 revision·노드 수가 이전의 성공한 묶음과 같았다.
19. **기본 HTML namespace의 총량 포함 · C++/Rust 정적 대조** — V8은 생략한 namespace를 실제 UTF-16 버퍼로 채우고 배치 총량에 포함한다. Rust 직접 경로도 namespace·이름·값을 합산한다.
20. **FFI 작업 배열 크기 · Rust 정적 검토** — 작업 수 상한을 `slice::from_raw_parts`보다 먼저 검사한다. 비정상 길이를 곱해 raw operation slice를 만들지 않는다.
21. **FFI operation 포인터 부재 · Rust 정적 검토** — `count > 0`인데 작업 포인터가 null이면 raw slice 접근 전에 거부한다. C++ 내부 caller가 유효한 버퍼 수명을 제공한다는 unsafe 전제는 별도 ABI 계약으로 남는다.
22. **FFI 문자열 포인터 부재 · Rust callback 단위 테스트** — 길이가 0이면 null 문자열 포인터를 허용하고, 길이가 양수면 null 포인터를 역참조하기 전에 거부했다.
23. **이름의 잘못된 surrogate · FFI 단위 테스트 + 실제 V8 fixture** — 짝이 맞지 않는 UTF-16 이름을 거부했다. 뒤이은 유효 변경과 이벤트가 계속 처리됐다.
24. **텍스트 값의 surrogate 보존 · Rust 단위 테스트 + 실제 V8 fixture** — 고립 surrogate가 든 UTF-16 텍스트 값을 저장·복원 경로에 통과시켰다. Rust `DomString` 단위 테스트에서 코드 단위 보존을 확인했다.
25. **외부 ID·순방향 참조 · Rust 단위 테스트** — 0·음수·중복 ID, 아직 생성되지 않은 ID 참조, 음수 부모를 각각 거부하고 문서 상태를 보존했다. 부모 ID 0은 HostRoot로 매핑된다.
26. **마지막 명령 실패 원자성 · Rust 단위 테스트 + V8 fixture** — 유효 생성·삽입 뒤 알 수 없는 ID를 참조하는 묶음은 트리·핸들·revision을 공개하지 않았다. 예약 취소 경로도 별도 확인했다.
27. **이동·순서·직접 부모 제한 · Rust 단위 테스트** — append 이동, `insertBefore`, `before: 0` 끝 삽입, 속성 제거와 잘못된 부모의 제거 요청을 확인했다. 최종 형제 순서가 기준 트리와 일치했다.
28. **분리 노드 수명 · Rust 단위 테스트** — 제거한 노드의 핸들을 유지해 다시 삽입할 수 있고, 이미 성공한 외부 ID는 분리 후 재사용할 수 없었다.
29. **revision·기준 실행 대조 · Rust 단위 테스트 + Android/iOS 실행** — 대응하는 직접 `HostDocument::commit`과 노드 종류·순서·속성·텍스트·revision 영수증을 비교했다. 빈 묶음과 같은 값 재설정은 revision을 올리지 않고, 이벤트 변경은 별도 revision을 올렸다.
30. **플랫폼 실행·스레드 한계 · Android/iOS 빌드와 실행 로그** — 두 플랫폼 모두 결과 `document_revision=3`, `render_tree_revision=2`, `document_nodes=3`을 기록했다. `is_main_thread=false`는 부팅 worker 확인이다. callback OS thread 번호 자체를 계측한 로그로 확대 해석하지 않는다.

## 실행 결과

| 검증 | 결과 |
| --- | --- |
| `mise exec -- cargo fmt --all -- --check` | 통과 |
| `mise exec -- cargo clippy --locked --workspace --all-targets -- -D warnings` | 통과 |
| `mise exec -- bun run test` | JS 1개, CSS reference 3개, Rust workspace 107개 통과 |
| `mise exec -- bun run build:android` | Android ARM64 debug APK 빌드 통과 |
| Android 16 / API 36 ARM64 에뮬레이터 설치·실행 | V8 smoke 결과·이벤트 callback 확인 |
| `mise exec -- bun run build:ios-sim` | iOS Simulator ARM64 빌드 통과 |
| iPhone 17 Pro / iOS 26.2 시뮬레이터 설치·실행 | V8 smoke 결과·이벤트 callback 확인 |

원본 플랫폼 로그: [Android](s03-v8-hostdocument-bridge-android-2026-10-03.log) · [iOS](s03-v8-hostdocument-bridge-ios-2026-10-03.log).

## 검토 중 수정한 결함

- 작업 `type` 문자열의 길이를 변환 전에 제한해 큰 임시 UTF-8 문자열 생성을 막았다.
- 500줄을 넘긴 Rust 단위 테스트를 명령 경계 테스트 파일로 분리했다.
- Clippy가 발견한 `to_*(&mut self)` 이름 오해를 실제 예약·변환 동작을 나타내는 `build_core_operation`으로 고쳤다.
- Bun의 가짜 호스트가 새 입력 계약과 8종 명령을 처리하지 못해 fixture를 구현 계약과 맞췄다.

## 남은 검증 경계

이 구현은 세션 내부 진단용 연결이다. 실제 DOM 래퍼·JS 노드 객체 수명·다중 Owner 동시 갱신·레이아웃/CSS/GPU 반영·공개 API 호환은 포함하지 않는다. Android와 iOS는 시뮬레이터/에뮬레이터에서 확인했다. 두 V8 빌드 모두 `v8_jitless = false`이며 JITless, 실기기 성능, callback OS thread ID 별도 계측은 확인하지 않았다. 프로세스 OOM 복구는 계약에 포함하지 않는다. Android release Rust profile은 `panic=abort`이므로 Rust panic 후 앱 상태를 복구한다고 주장하지 않는다.
