# C01 첫 비교 fixture

`supported-html-ua.html`은 현재 내장 UA 스타일 초안에 선언된 9개 HTML 태그의 Chromium 계산값을 모으는 원본 입력입니다.

- oracle 수집기: [`tools/css-reference/capture.mjs`](../../../../tools/css-reference/capture.mjs)
- 비교할 선언: 태그 선택자 일치 집합과 내장 프로필이 선언한 computed CSS 값
- 현재 기록 범위: `div`, `span`, `a`, `img`, `button`, `input`, `p`, `ul`, `li`
- 의도적으로 제외: 레이아웃 좌표·텍스트 metrics·폼 컨트롤 모양·GPU 픽셀. 각각의 비교 경로가 구현되기 전에는 기준 결과라고 가장하지 않습니다.
- author stylesheet와 원격 자원은 fixture에 없습니다.

Chromium 실행 조건과 관찰값은 `references/<reference-id>/ua-supported-elements.json`에 고정합니다. 브라우저 업데이트는 기존 결과를 덮어쓰지 않고 새 reference-id 디렉터리를 만듭니다. 한 브라우저·한 OS의 이 초기 스냅샷은 전체 CSS inventory나 Android/iOS 동등성 완료를 뜻하지 않으므로 `C01`은 미완료로 유지합니다.
