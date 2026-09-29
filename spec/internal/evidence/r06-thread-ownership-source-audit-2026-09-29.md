# R06 스레드·소유권 소스 감사 — 2026-09-29

## 판정 범위

이 기록은 저장소 코드와 고정 V8 헤더를 읽어 현재 경계를 분류한 정적 검토입니다. 다중 스레드·비동기 경합을 실행하지 않았고 R06 완료 증거가 아닙니다. 기능 구현이나 API 지원 주장으로 사용하지 않습니다.

## 확인한 소스

| 대상 | 확인 내용 |
| --- | --- |
| [`spec/internal/0001-v8-bootstrap.md`](../0001-v8-bootstrap.md) | 현재 부팅은 생성·평가·이벤트 전달·해제가 한 동기 호출 안에 있고, 취소·다중 스레드 호출·Isolate 재사용을 아직 정의하지 않습니다. |
| [`native/v8/src/spinon_v8.cc`](https://github.com/ohah/spinon/blob/ff2edb842c60039844105eec31c41983ca838c84/native/v8/src/spinon_v8.cc) | 프로세스 V8 초기화에는 `std::call_once`가 있지만, 런타임이 Isolate·Context·함수 `Global`을 소유하는 동작을 직렬화하지는 않습니다. `eval`·`dispatch`·`free`가 호출 스레드에서 바로 V8을 사용하고 Isolate 소유 스레드 assertion, Locker, 작업 큐는 없습니다. `free`는 `Global::Reset()` 후 `Dispose()`를 바로 호출합니다. |
| [`crates/spinon-ffi/src/lib.rs`](https://github.com/ohah/spinon/blob/ff2edb842c60039844105eec31c41983ca838c84/crates/spinon-ffi/src/lib.rs) | 콜백 사용자 데이터는 `spinon_app_run()`의 지역 `CallbackState`입니다. C++에서 오는 콜백은 JS 평가·dispatch 중 동기 호출되고 V8 런타임은 함수 반환 전에 해제됩니다. |
| [`platforms/android/app/src/main/cpp/spinon_jni.cc`](https://github.com/ohah/spinon/blob/ff2edb842c60039844105eec31c41983ca838c84/platforms/android/app/src/main/cpp/spinon_jni.cc), [`platforms/ios/Sources/SpinonRunner.mm`](https://github.com/ohah/spinon/blob/ff2edb842c60039844105eec31c41983ca838c84/platforms/ios/Sources/SpinonRunner.mm) | 두 네이티브 래퍼가 `spinon_app_run()`을 직접 호출합니다. 래퍼 자체는 별도 직렬 실행기나 런타임 handle 수명을 정의하지 않습니다. |
| [`crates/spinon-core/src/tree.rs`](https://github.com/ohah/spinon/blob/ff2edb842c60039844105eec31c41983ca838c84/crates/spinon-core/src/tree.rs) | `Tree::commit(&mut self, ...)`는 이전 revision을 거부하고 복사본 검증 후 전체 커밋합니다. 내부 lock·FFI 호출 큐·OwnerId는 없습니다. |
| [`spec/internal/0003-shared-host-contract.md`](../0003-shared-host-contract.md) | 동기 논리 조회, 원자 변경, Isolate 실행 경로로의 입력 전달을 제안하나 실행기 thread, 취소·종료 경합, 전역 revision을 쓰는 여러 Owner의 복구는 미결정입니다. |
| [`spec/internal/r13-platform-gpu-recovery.md`](../r13-platform-gpu-recovery.md) | R13 wgpu 실험 handle은 UI thread에서 직렬 호출합니다. 동시 draw·resize·destroy와 실제 비동기 장치 손실 경합은 검증 범위 밖이라고 기록합니다. |

## V8 기준

저장소 고정 리비전 `tools/v8/v8-revision.txt`와 로컬 소스 checkout의 `HEAD`는 모두 `7b50b62cb18f28617959e8452e2cd18195b38bcf`입니다. 이는 저장소 문서가 V8 15.6.0 후보 빌드라 부르는 개발 기준이며, 릴리스 호환 약속이 아닙니다.

해당 리비전의 V8 헤더는 다음을 설명합니다.

- [`v8-locker.h`](https://chromium.googlesource.com/v8/v8/+/7b50b62cb18f28617959e8452e2cd18195b38bcf/include/v8-locker.h): 다중 스레드 환경에서 같은 Isolate 사용을 `v8::Locker`로 한 번에 한 thread만 들어가게 직렬화합니다.
- [`v8-isolate.h`](https://chromium.googlesource.com/v8/v8/+/7b50b62cb18f28617959e8452e2cd18195b38bcf/include/v8-isolate.h): Isolate가 어떤 thread에서도 진입 중이지 않아야 `Dispose()`할 수 있습니다. `TerminateExecution()`은 `Locker`가 없는 thread에서도 부를 수 있습니다.

이 문구는 V8 API 제약을 요약할 뿐, 스피논이 Locker를 써야 한다거나 현재 V8 연결이 안전하다는 판정은 아닙니다. Locker, 전용 thread, 실행 중 종료의 상대 성능·안전성은 이 감사에서 비교하지 않았습니다.

## 증거 한계

- `spinon_app_run()` 현재 경로는 수명이 짧은 동기 smoke입니다. 장기 실행 runtime handle이나 비동기 Fetch·타이머·Promise 호스트는 없습니다.
- 코드에 Locker·명시적 queue·thread assertion이 없다는 사실만으로 데이터 경합이 실제 발생했다고 단정하지 않았습니다. 현재 호출 빈도와 thread id도 계측하지 않았습니다.
- V8의 `TerminateExecution()`이 API로 존재하는 것과 안전한 앱 취소 계약은 다릅니다. 이미 수행된 JS·네이티브 부수 효과를 되돌리는지, 그 뒤 Context·Promise·Isolate를 어떻게 정리할지는 확인하지 않았습니다.
- R13의 UI-thread 직렬 호출은 그 실험용 wgpu handle의 제약입니다. Android GLES 경로, 미래 렌더러, JS runtime의 소유 thread를 대신 정의하지 않습니다.
- Android 에뮬레이터, iOS 시뮬레이터, Android 실기기, iOS 실기기에서 경합·취소·종료 검증을 수행하지 않았습니다.

## 적대적 문서 검토 5회

1. **상태와 지원 범위:** 새 산출물이 R06 완료나 공개 API 지원으로 오해될 수 있는지 검토했습니다. `spec/STATUS.md`는 체크하지 않고 내부 검토 초안과 정적 증거만 연결했습니다.
2. **V8 thread 보장:** `std::call_once`와 V8 런타임 직렬화를 같은 보장으로 취급할 수 있는지 확인했습니다. 프로세스 전역 초기화와 각 Isolate의 호출 경계를 분리해 적었습니다.
3. **객체·callback 수명:** stack `user_data`, persistent `Global`, 종료 뒤 늦은 callback을 대조했습니다. 비동기 메시지에 raw pointer나 V8 값을 싣지 않는 후보와 세대 만료 폐기 규칙을 추가했습니다.
4. **revision·취소 경합:** commit 원자성과 렌더 snapshot 최신성을 같은 revision 하나로 단정하거나, stale batch를 안전하게 재실행할 수 있는지 공격적으로 검토했습니다. document/render/environment revision을 분리하고 자동 재실행을 제외했으며 Owner 간 충돌 복구는 선택지로 남겼습니다.
5. **플랫폼·실행 증거:** R13 wgpu UI-thread 실험을 모든 GPU·OS 입력 경로로 일반화할 수 있는지 확인했습니다. 근거 범위를 해당 실험으로 제한하고 실제 Android/iOS 기기 경합을 실행하지 않았음을 명시했습니다.

다섯 검토에서 확인한 과장 위험을 문서의 상태·근거·미결정 항목에 반영했습니다. 검토는 정적 문서 일관성 점검이며 동시성 실행 검증은 아닙니다.

## 문서 검사

- R06 권고와 미결정 항목을 [스레드·소유권 위험 분석](../0004-thread-ownership-risks.md)에 기록했습니다.
- 실행 테스트를 추가하거나 실행하지 않았습니다. source audit 이외의 런타임 증거는 없습니다.
