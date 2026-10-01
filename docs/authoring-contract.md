# 스피논 앱 작성 문법 초안

이 문서는 앱 코드에 보이는 태그와 동작을 정한다. 아직 구현 완료 목록이 아니다. 모바일은 Rust 스피논 트리·GPU 장면을 사용하며, 그 트리에 연결되는 제한된 DOM API façade를 제안한다. 웹 빌드는 브라우저 DOM을 사용한다. 모바일이 브라우저 DOM 전체를 포함한다는 뜻은 아니다.

규범 계약의 첫 초안은 [스피논 명세](../spec/README.md)에 둔다. 이 문서는 작성 예시와 설계 이유를 설명한다.

태그별 차이는 [HTML·CSS 대응표](https://macstudio.tailed42f2.ts.net/spinon/compatibility.html), 실행 환경의 함수 차이는 [JS API 대응표](https://macstudio.tailed42f2.ts.net/spinon/js-api.html)에 별도로 기록한다.

[모바일 실행 구조도](https://macstudio.tailed42f2.ts.net/spinon/runtime.html)는 UI 변경과 입력 이벤트의 경계를 별도로 보여준다.

## 태그 선택

공개 태그는 `<view>`가 아닌 **표준 HTML 이름**을 쓴다. 첫 수직 구현은 `<div>`, `<button>`과 텍스트 노드를 지원한다. 앱 형태의 데모로 확장할 때 인라인 배치가 필요한 `<span>`과 `<input>`, `<img>`, `<p>`, `<a>`, `<ul>`, `<li>`를 추가한다. 그 밖의 태그는 모바일 빌드에서 지원되지 않는다고 진단한다. 지원 목록이 늘어날 때는 해당 태그의 화면·이벤트·접근성 의미를 함께 명세한다.

| 태그 | 모바일 의미 | 첫 목표 단계 |
| --- | --- | --- |
| `div` | 일반 배치 상자와 GPU 그리기 노드 | 수직 구현 |
| `span` | 인라인 텍스트 조각과 줄바꿈 | 실사용 UI |
| `button` | GPU로 그리는 버튼, 클릭 이벤트와 버튼 접근성 역할 | 수직 구현 |
| `input` | GPU로 그리는 한 줄 입력, OS 키보드·IME 연결 | 실사용 UI |
| `img` | 이미지 디코드·크기 측정·GPU 텍스처 | 실사용 UI |
| `p`, `ul`, `li` | 문단·목록 의미와 기본 배치 | 실사용 UI |
| `a` | 링크 의미와 탐색 이벤트. 내부 경로·외부 URL은 [라우팅 명세](../spec/0006-routing.md) 적용 | 실사용 UI |

`<div>`마다 Android View나 UIKit View를 만들지 않는다. 플랫폼에는 앱 창과 GPU 표면, 입력·접근성 연결 객체가 필요하다. `input`의 글자와 커서는 GPU로 그리되 키보드·한글 조합은 Android `InputConnection`과 iOS 텍스트 입력 계약을 연결해야 한다. 이 동작은 구현 전 검증 항목이다.

## 프레임워크별 작성 형태

React는 JSX/TSX에서 HTML 태그를 쓰고 `className`, `onClick`처럼 React의 웹 작성 형태를 따른다. 웹 빌드는 React DOM으로, 모바일 빌드는 스피논 React 호스트 어댑터로 연결한다.

```tsx
function Counter() {
  const [count, setCount] = useState(0);
  return <div className="screen"><button onClick={() => setCount(count + 1)}>{count}</button></div>;
}
```

Vue와 Svelte도 같은 HTML 태그를 각 프레임워크의 템플릿·이벤트 문법으로 작성한다. 이들의 어댑터는 별도 단계에서 구현한다. 공통 계약은 **태그의 의미·스타일·이벤트**이며, 세 프레임워크의 상태 관리 문법을 같게 만들지는 않는다.

## 스타일과 이벤트 계약

- 웹은 브라우저 CSS를 그대로 사용한다. 모바일은 번들 CSS를 Stylo의 선택자·계단식·상속·계산 스타일 경로에 연결하고, 별도 레이아웃·GPU 렌더 경로를 사용한다. 지원 요소의 UA 구조 규칙은 `spinon-style`에 컴파일 시 포함되어 있으나 아직 Stylo·레이아웃·GPU에 적용되지 않았다. 미지원 선언은 조용히 버리지 않고 진단한다.
- Tailwind CSS는 빌드가 생성한 CSS를 같은 변환기에 입력하는 방식으로 연동한다. 클래스 이름만 보고 스타일을 직접 추론하지 않는다. 웹 빌드에는 생성 CSS를 그대로 전달한다. 모바일은 각 유틸리티가 만든 선택자·선언·변수·계층을 지원할 때에만 호환이라고 표시한다.
- CSS 최종 목표는 고정 Chromium 기준 100% 동작 호환이다. 첫 구현은 기본 상자 모델·단위·Flex·색·글꼴부터 시작하며, 각 범위는 [CSS 호환 명세](../spec/0008-css-compatibility.md)와 [C01~C30 구현 대장](../spec/STATUS.md#css-구현-체크리스트)에서 관리한다. 현재 [스타일·레이아웃 실험](../spikes/style-layout/README.md)은 더 작은 부분집합만 처리한다.
- 표준 속성 이름을 우선 사용한다. `class`/`className`, `id`, `disabled`, `value`, `placeholder`, `src`, `alt`, `role`, `aria-*`의 의미를 태그별로 확인한다. 화면·접근성에 필요한 속성이 미지원이면 진단한다.
- 수직 구현의 이벤트는 클릭과 포인터 입력을 먼저 연결한다. 입력·포커스·키보드·스크롤 이벤트는 해당 태그를 추가할 때 웹과 모바일의 발생 순서 및 취소 가능 여부를 비교해 명세한다.
- 모바일의 `document`·`Node`·`Element` API 후보와 지원 경계는 [DOM 호환 명세](../spec/0007-dom-compatibility.md)에 둔다. 전체 `window`나 DOM 전체를 가정하지 않는다. DOM을 직접 만지는 라이브러리는 필요한 함수별로 호환성을 판정한다. 노드 측정·포커스·스크롤 같은 명령형 API는 공통 핸들·레이아웃 계약을 정한 뒤 제공한다.

## 플랫폼 컴포넌트

WebView·지도·카메라처럼 OS가 제공하는 화면은 별도의 명시적 컴포넌트 API로 삽입한다. 일반 HTML 태그를 플랫폼 뷰로 몰래 바꾸지 않는다. WebView는 주 렌더러가 아니다.

## 완료 판정

1. 같은 React 카운터 소스의 `<div>`, `<button>`과 텍스트 노드가 웹 DOM과 Android·iOS GPU 화면에서 표시되고 터치·텍스트·접근성 이름이 맞아야 한다.
2. 앱 형태의 데모에서는 `<input>`, `<img>`, 목록과 화면 이동까지 세 플랫폼에서 동작하고, 한글 IME·스크롤 상태·이미지 로딩 실패를 확인한다.
3. 지원하지 않는 태그·속성·CSS는 빌드나 개발 화면에서 식별 가능한 진단을 내야 한다. 조용히 누락된 상태로 호환성을 주장하지 않는다.
