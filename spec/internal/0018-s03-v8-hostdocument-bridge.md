# 0018 · S03.1 V8에서 HostDocument 변경 묶음 호출

**인터페이스 버전:** `0.1.0` · **상태:** 구현·시뮬레이터 검증 완료 · **공개 API:** 아님 · **상태 대장:** S03.1

## 목적과 경계

V8에서 동기 JavaScript 호출 한 번으로 Rust `HostDocument` 변경 묶음을 제출하고, 커밋 영수증을 같은 호출에서 받는 내부 연결을 정의한다. 이 작업은 JavaScript 작성 코드를 위한 API가 아니며 `Document`·`Node`·`Element` DOM 래퍼, React/Vue/Svelte 어댑터, GPU 표시, 표준 이벤트 호환을 구현하지 않는다.

검증 런타임 세션 하나에는 테스트용 `HostDocument`와 단일 `OwnerId`를 둔다. 이것은 앱별 표시 루트나 제품 런타임의 문서 소유 정책을 확정하지 않는다. 기존 V8 전용 실행 스레드에서만 문서 callback을 호출한다. 플랫폼 UI thread는 문서 커밋을 동기 대기하지 않는다.

## 내부 호출 형태

```js
const receipt = spinon.__internal.commitDocumentBatch([
  { type: "createElement", id: 1, name: "div" },
  { type: "createText", id: 2, data: "ready" },
  { type: "append", parent: 0, node: 1 },
  { type: "append", parent: 1, node: 2 },
  { type: "setAttribute", node: 1, name: "class", value: "card" },
]);
```

`id`는 한 V8 세션 안에서만 쓰는 양의 32비트 연결 키다. Rust `NodeId` 자체가 아니며 Rust 내부 핸들은 FFI 밖으로 노출하지 않는다. `parent: 0`은 보이지 않는 HostRoot다. 성공한 생성에 쓴 연결 키는 분리 후에도 그 세션이 끝날 때까지 유지하고 재사용하지 않는다. 실패한 묶음은 연결 키를 등록하지 않는다. `nodeCount`는 연결 여부와 무관하게 세션에서 생성되어 보존 중인 노드 수다.

지원하는 작업은 `createElement`, `createText`, `append`, `insertBefore`, `remove`, `setText`, `setAttribute`, `removeAttribute`다. HTML 요소의 기본 namespace는 `http://www.w3.org/1999/xhtml`이며 선택 입력으로 다른 namespace를 줄 수 있다. 속성 이름은 namespace 없는 이름만 지원한다. 이름과 namespace는 잘못된 surrogate를 거부하는 문자열이며 Rust에 UTF-8로 저장한다. 텍스트와 속성 값은 짝이 맞지 않는 surrogate를 포함해 UTF-16 코드 단위를 보존한다.

한 묶음에는 최대 256개 작업과 전체 UTF-16 문자열 코드 단위 1,048,576개를 허용한다. 총량에는 기본 HTML namespace를 포함해 실제 전달하는 모든 문자열을 센다. 각 이름·namespace는 최대 1,024개, 각 텍스트·속성 값은 최대 1,048,576개 코드 단위다. `type` 분류 문자열은 최대 32개 코드 단위이며 UTF-8 변환 전에 길이를 검사한다. 인자는 V8의 실제 Array 객체여야 하며 Proxy로 감싼 배열은 배열 검사에서 거부한다. 길이 제한을 넘으면 Rust 문서 상태를 바꾸기 전에 동기 오류로 거부한다. V8은 호출 시점의 배열 길이를 한 번 읽고 그 개수만 처리한다. 배열 슬롯·작업 필드를 읽을 때 JavaScript getter가 실행될 수 있다. getter가 던진 원래 예외를 전파하고, 입력을 읽는 동안 재진입한 문서 묶음 호출은 거부한다. getter의 임의 부수 효과까지 되돌린다는 보장은 없다.

`append`는 기존 부모에서 노드를 옮기며 `insertBefore`의 `before: 0`은 끝 삽입이다. `remove`는 지정 부모의 직접 자식만 분리하고 노드와 연결 키를 보존한다. 폐기·GC는 제공하지 않는다. Text가 아닌 노드의 `setText`, 잘못된 부모·자식·기준 노드, 중복 ID, 알 수 없는 ID, 잘못된 이름은 묶음 전체를 거부한다.

## 순서·원자성·영수증

- 최대 256개 작업을 하나의 동기 호출로 제출한다. 이 호출은 비동기 작업이나 microtask 경계를 만들지 않는다.
- Rust는 현재 문서 revision을 기준으로 전체 묶음을 검증하고 한 번에 커밋한다. 한 작업이라도 실패하면 트리, 연결 키 표, `DocumentRevision`, `RenderTreeRevision`을 모두 이전 값으로 보존한다.
- 성공 영수증은 `changed`, `documentRevision`, `renderTreeRevision`, `nodeCount`를 반환한다. 세 정수 필드는 JavaScript `BigInt`다.
- 빈 묶음과 실질 변경이 없는 묶음은 성공하지만 revision을 증가시키지 않는다. 분리 노드만 바뀌면 `DocumentRevision`만 바뀔 수 있고 `RenderTreeRevision`은 유지된다.
- 한 스크립트가 커밋 뒤 나중에 예외를 던져도 이미 성공한 커밋은 되돌리지 않는다. 원자성 범위는 각 `commitDocumentBatch` 호출 하나다.

잘못된 배열·작업·필드와 Rust 검증 실패는 JavaScript `Error` 또는 입력 형식용 `TypeError`로 동기 전달한다. 오류 메시지는 내부 진단이며 DOM `DOMException` 종류·코드·표준 메시지 호환을 뜻하지 않는다. 프로세스 메모리 부족과 allocator abort 복구는 보장하지 않으며 원자성 기준은 정상 반환되는 검증·커밋 오류다.

## 이벤트 검증 경계

기존 `spinon.onEvent(handler)`와 런타임 세션의 내부 `dispatch`는 V8 재진입·콜백 실행 경로를 확인하는 진단용 hook으로 유지한다. handler는 정수 식별자를 받으며, 이 식별자가 DOM 이벤트의 target·currentTarget이라는 뜻은 아니다. 버블링·캡처·기본 동작·취소·포인터 이벤트·접근성 활성화는 지원 범위가 아니다. 이벤트 handler 호출 중에는 `commitDocumentBatch`를 호출할 수 있으며, 그 호출도 별도의 원자 변경 묶음이다.

## 비교 모델과 적합성 기준

DOM 공개 호환을 주장하지 않으므로 이 adapter의 독립 Chromium API oracle은 두지 않는다. 규범 기준은 `HostDocument` 변경 묶음 계약과 이 문서의 입력 예제다. adapter 검증은 직접 Rust `HostDocument::commit`으로 만든 대응 문서와 노드 종류·순서·속성·텍스트·연결 여부·영수증 revision을 비교한다. 고정 JavaScript fixture는 지원 작업 순서와 실패 묶음을 표현하고 Android·iOS 시뮬레이터에서 같은 V8 호출을 실행한다.

통과 조건:

1. 성공 묶음의 관찰 트리와 모든 영수증 값이 직접 Rust 기준 실행과 일치한다.
2. 잘못된 마지막 작업을 포함한 묶음은 앞선 생성·수정도 공개하지 않고 모든 revision을 유지한다.
3. 제거한 노드는 다시 삽입할 수 있고, 성공한 연결 키와 노드 정체성은 세션 안에서 재사용하지 않는다.
4. JavaScript 예외·이벤트 callback 실행 뒤에도 다음 유효 묶음이 처리된다.
5. iOS·Android 시뮬레이터에서 문서 callback이 동기 V8 평가·이벤트 경로 안에서 실행된다. 플랫폼 로그는 부팅 작업이 메인 UI thread 밖에서 시작된 것을 확인한다. callback의 OS thread 숫자를 별도로 계측한 결과는 아니다. 이 결과는 실기기 성능·JITless·GPU 표시를 입증하지 않는다.

실행 결과와 기기·OS·V8 revision·명령·원본 로그는 [S03.1 실행 근거](evidence/s03-v8-hostdocument-bridge-2026-10-03.md)에 기록한다. S03 전체 완료는 이 하위 작업만으로 판정하지 않는다.
