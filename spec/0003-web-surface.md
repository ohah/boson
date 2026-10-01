# 0003 · HTML·CSS·JavaScript API 표면

**상태:** 제안 · **명세 버전:** `0.1.0-draft`

## 공개 작성 문법

앱은 HTML 이름의 요소를 사용한다. React에서는 JSX/TSX의 `className`·`onClick`, Vue와 Svelte에서는 각자의 템플릿·이벤트 문법을 사용한다. 웹 빌드는 브라우저 DOM에 연결하고 모바일 빌드는 스피논 노드·GPU 장면에 연결한다. `<view>`를 기본 공개 요소로 도입하지 않는다.

| 요소 | 첫 목표 | 모바일 의미 | 아직 결정할 것 |
| --- | --- | --- | --- |
| `<div>` | 수직 구현 | 일반 배치 상자 | 내장 기본 규칙은 초안이며 Chromium 기준값과 실제 적용은 C01·C04에서 검증 |
| 텍스트 노드 | 수직 구현 | 내용·노드 ID·글리프 출력 | 인라인 조각·줄바꿈·선택 |
| `<button>` | 수직 구현 | GPU 화면, 클릭, 버튼 접근성 역할 | 포커스·키보드·`disabled`·기본 동작·기본 외형 |
| `<span>`, `<input>`, `<img>`, `<p>`, `<a>`, `<ul>`, `<li>` | 실사용 UI | 각각 인라인, 입력, 이미지, 문단, 링크, 목록 의미 | 태그별 속성·이벤트·접근성 세부 계약과 기본 외형 |


지원 HTML 요소에 적용할 구조적 UA 규칙은 [`spinon-style` 내장 stylesheet 초안](https://github.com/ohah/spinon/blob/main/crates/spinon-style/resources/ua/supported-elements-v0.css)으로 관리한다. 이 자원은 Rust 바이너리에 포함되지만 Stylo cascade나 화면에는 아직 연결되지 않았다. 폼 컨트롤의 외형·링크 상태별 표현도 미구현이다. 세부 범위는 [CSS 호환 명세](0008-css-compatibility.md)와 [구현 상태 대장](STATUS.md)의 C01·C04를 따른다.

첫 수직 구현 외의 요소를 조용히 일반 `<div>`처럼 바꾸지 않는다. 지원되지 않는 요소와 화면에 영향을 주는 속성은 빌드 또는 개발 실행에서 진단한다. 제한된 `document`·노드 API 후보는 [DOM 호환 명세](0007-dom-compatibility.md)에 별도로 제안한다. 이 제안은 전체 브라우저 DOM이나 모든 태그 조회 기능이 있다는 뜻이 아니다.

## CSS 처리 단계

최종 목표는 버전을 고정한 Chromium과 CSS 관찰 동작을 100% 맞추는 것이며, 현재 지원이나 첫 릴리스 범위를 뜻하지 않는다. 기능군과 완료 우선순위는 [CSS 호환 명세](0008-css-compatibility.md), 지원 상태는 [구현 상태 대장](STATUS.md#css-구현-체크리스트)에 둔다.

웹 빌드는 브라우저 CSS 엔진을 사용한다. 모바일은 Spinon 문서 트리를 Stylo에 연결해 선택자·계단식·상속·계산 스타일을 구하고, 자체 변환 계층에서 Taffy와 추가 레이아웃 알고리즘으로 연결한다. 페인트 속성은 GPU 렌더 경로에서 별도로 처리한다. Stylo가 CSS를 파싱하거나 계산하는 것만으로 렌더링 지원을 표시하지 않는다. 모바일 런타임은 Blitz DOM에 의존하지 않는다.

Vite·Rspack은 CSS import·모듈·에셋·청크 관계를 보존한다. Lightning CSS는 의미를 바꾸는 변환을 Chromium 기준과 동등하다고 확인한 범위에서만 사용할 수 있다. 구현은 기본 상자 모델·단위·Flex·색·글꼴부터 시작하고, Grid·인라인 서식·반응형·애니메이션·고급 레이아웃으로 확장한다. 각 기능은 fixture로 검증하기 전까지 제안 또는 미검증이며 첫 릴리스 포함 여부는 별도 결정이다.

Tailwind는 별도 모바일 렌더러가 아니다. Tailwind가 **생성한 CSS**가 같은 변환 경로에 들어간다. 유틸리티 하나가 사용하는 선택자·선언·값·변수·계층이 모두 지원될 때만 그 유틸리티를 지원이라고 표시한다. Preflight, 테마 변수, 반응형·상태 변형은 별도 항목으로 판정한다.

## JavaScript와 호스트 API

V8의 ECMAScript 언어 기능과 스피논이 제공해야 하는 호스트 기능을 구분한다. `Promise`, `Map`, `ArrayBuffer`, `globalThis` 같은 언어 기능의 존재가 `fetch`, 타이머, `URL`, `console`, DOM을 자동으로 제공하지 않는다.

첫 수직 구현은 JS 이벤트 콜백, 마이크로태스크 체크포인트, 타이머, 예외·콘솔 출력을 목표로 한다. `fetch`, 저장소, 바이너리·네트워크 객체는 각각 입력·결과·오류·취소·백그라운드 동작을 정의한 뒤 지원 여부를 표시한다. 모바일 `document`는 전체 브라우저 문서가 아니라 [별도 명세](0007-dom-compatibility.md)의 제한된 호환 façade 후보로 다룬다. 전체 `window`, 서비스 워커, Canvas/WebGL/WebGPU는 모바일 기본 API로 약속하지 않는다. GPU 내부 구현이 앱 공개 WebGPU를 뜻하지 않는다.

### 엔진 연결과 사용자 확장 경계 제안

V8 임베딩에는 엔진별 C++ 어댑터가 필요하다. 이 경계는 V8 Isolate·Context와 JS 값·함수의 수명 및 Rust 호스트 호출을 연결하는 내부 구현이며 React Native의 JSI를 가져다 쓰거나 공개 API로 노출한다는 뜻이 아니다. JSI는 React Native가 JavaScript와 C++ 객체를 연결하는 인터페이스다. 스피논은 V8을 직접 임베딩하므로 V8 API에 맞는 내부 연결이 필요하다.

앱 개발자가 Kotlin·Swift·Rust·C++로 고유 기능을 추가하는 요구는 별도의 **버전 있는 플랫폼 모듈 계약**으로 받는다. 이 계약은 JS 타입 선언·빌드 시 바인딩 생성·플랫폼별 등록·비동기 결과 전달을 엔진 어댑터 뒤에 둔다. 입력·출력·오류·권한·취소·thread affinity·Isolate 수명·앱 종료·바이너리 호환성을 명시한다. 앱 코드는 버전 있는 TypeScript/JavaScript 표면만 사용하고 V8 핸들, Rust 포인터, 내부 C ABI를 직접 소유하지 않는다.

이미지·카메라 프레임 같은 대용량 데이터의 복사를 피할 필요가 생기면 일반 모듈 호출과 분리해 소유권·해제·역압력을 갖춘 불투명 핸들이나 공유 버퍼 경로를 검토한다. 기본 모듈 API를 모든 호출의 zero-copy 경로로 설계하지 않는다. 모듈 등록 형식과 코드 생성기는 [JS API 구현 체크리스트의 J15](STATUS.md#javascript-api-구현-체크리스트)에서 X08의 하위 작업으로 추적하며 아직 공개 지원 API가 아니다. 세부 JS API 작업 항목은 [JS API 구현 체크리스트](STATUS.md#javascript-api-구현-체크리스트)에 둔다.

### Fetch 호스트 API 제안

웹의 `fetch()`는 브라우저 호스트 API다. V8을 임베딩하는 것만으로 제공되지 않는다. 모바일에서도 웹과 같은 호출 표면을 제공하려면 JS의 `fetch`·`Request`·`Response`·`Headers`와 취소 신호를 스피논 호스트 API로 연결해야 한다. 정확한 첫 API 범위와 본문 스트림 지원은 미정이며 현재 지원 API가 아니다.

이 경로는 UI 트리와 분리한다. V8의 Promise·객체 표면 → 버전 있는 `NetworkHost` 요청/응답 계약 → Android·iOS 또는 공통 네트워크 전송 구현으로 나눈다. 기본 URL, 리다이렉트, 헤더, 본문, 취소, 앱 백그라운드 전환, TLS 오류, 쿠키·자격 증명, CORS/출처 정책을 각 계층의 책임과 적합성 사례로 정한다. HTTP 비성공 상태는 Fetch 의미에 맞게 Response로 돌려주고, 전송 실패·취소는 별도로 다룬다.

비동기 응답·오류·취소 결과는 V8 Isolate의 소유 실행 경로에 작업으로 전달해 Promise를 처리해야 한다. Promise reaction은 해당 실행 경로의 V8 마이크로태스크 규칙을 따라야 한다. 네트워크 작업 스레드가 V8 객체나 콜백을 직접 만지는 구조는 호스트 계약으로 가정하지 않는다. Isolate 종료·앱 재시작·OTA 교체와 경합할 때 요청 취소, Promise 결과 폐기 또는 거부, 콜백 해제 규칙을 정하고 검증한다. 이 규칙이 UI 스레드 차단을 요구하지 않는지도 실기기에서 확인한다.

WHATWG Fetch 전체는 브라우저 환경, 출처 정책, 스트림과 여러 웹 표준에 걸친 큰 계약이다. 첫 구현의 범위를 정하지 않고 `fetch()` 함수만 추가해서 호환을 주장하지 않는다. [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/)를 기준으로 포함·제외 항목을 정하고, 웹·Android·iOS의 결과·오류·취소·본문 소비를 비교한 뒤 API 명세를 분리한다. 이 작업은 HTML 파서나 DOM 트리를 바꾸지 않으며 Blink·WebView 삽입을 요구하지 않는다.

브라우저와 같은 이름의 API라도 앱 권한·쿠키·출처·수명주기 때문에 동작이 다르면 `차이`로 기록한다. 모바일 전용 기능은 웹 API 이름을 흉내 내지 않고 명시적 플랫폼 모듈에서 제공한다.

`<a>`의 앱 내부 이동, 외부 URL, 시스템 뒤로 가기와 딥링크는 [라우팅 계약](0006-routing.md)에 따른다. 모바일에 `window.location`·`window.history` 전체가 있다고 가정하지 않는다.

## 적합성 자료

[HTML·CSS 대응표](https://macstudio.tailed42f2.ts.net/spinon/compatibility.html)와 [JS API 대응표](https://macstudio.tailed42f2.ts.net/spinon/js-api.html)는 기능 후보를 살펴보는 비규범 미리보기다. 이 사이트의 내용이 `spec/`의 목표 범위·지원 상태를 변경하지 않는다. 현재 표의 단계 표시는 구현 증거가 아니다. R01의 목표 범위와 기능별 버전·플랫폼 적합성 표는 저장소의 `spec/`을 원본으로 작성하고 이 명세에 연결한다.
