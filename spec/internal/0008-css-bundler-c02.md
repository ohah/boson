# C02 · Vite·Rspack CSS 산출 비교 모델

**문서 상태:** 내부 실험 계약 · **제품 API:** 없음 · **C02 완료 판정:** 아님

이 문서는 Vite와 Rspack의 CSS 산출물을 같은 입력으로 비교하는 재현 가능한 실험 기준이다. 관찰 결과는 두 번들러의 기본 산출 기능을 설명할 뿐, 스피논의 제품 번들러 어댑터나 모바일 CSS 로더가 구현됐음을 뜻하지 않는다. 스파이크에서 공통 정규화에 쓸 입력·출력 경계는 [C02 CSS 자원 어댑터 내부 계약](./0011-css-resource-adapter-c02.md)에 둔다. 이 계약은 OTA 매니페스트 계약을 대체하지 않는다.

## 고정 입력과 환경

- 도구: Vite `8.3.1`, Rspack `2.2.7`, Node.js `24.20.0`, Bun `1.4.2`; 의존성은 스파이크 전용 잠금 파일에 고정한다.
- 같은 애플리케이션 fixture를 두 빌드에 넣는다. 입력은 일반 CSS import, CSS Module의 `card`·`featured` 로컬 키, 로컬 `@import`, 공유 스타일과 명시적으로 분리한 shared JavaScript 모듈, 동적 import로만 도달하는 기능 스타일, 로컬 SVG 이미지와 WOFF2 확장자 자원을 포함한다. Vite는 HTML 진입점을, Rspack은 이에 대응하는 JavaScript 진입점을 사용한다.
- resolver fixture는 `@theme/theme.css` alias와 `@fixture/theme/theme.css` package `exports`를 JavaScript 진입점에서 import한다. package template은 `spikes/css-bundler/package-fixtures/`에 보관하고 실행 때 fixture의 `node_modules/`에 복사해 digest에 포함한다. 패키지 CSS는 다시 상대 `@import`로 `tokens.css`를 참조한다. 선택된 세 원본 CSS 파일, entry chunk의 산출 CSS 연결, 최종 CSS marker를 두 번들러에서 검사한다.
- 외부 CSS `@import`와 외부 이미지 URL은 `.invalid` 도메인을 사용한다. 실험은 URL 문자열을 빌드 도구가 로컬 자원으로 바꾸거나 실제로 가져오지 않고 외부 참조로 남기는지 확인한다. 런타임 네트워크 정책 검증은 범위 밖이다.
- 각 빌드는 production mode의 기본 CSS 최소화, CSS code splitting 활성화, 자원 인라인 비활성화, CSS·JS source map 생성을 사용한다. 출력물은 `spikes/css-bundler/.output/`에 만든다.

## 비교 모델과 판정 기준

| ID | 관찰값 | 통과 조건 |
| --- | --- | --- |
| M1 | 도구 버전·fixture inventory digest·출력 자원 목록과 SHA-256 | 두 빌드가 성공하고 같은 전체 fixture inventory digest를 기록한다. 번들 파일 이름·코드 해시는 서로 같을 것을 요구하지 않는다. |
| M2 | CSS Module named import | 두 빌드 모두 named import 로컬 키 `card`, `featured`를 산출 CSS 선택자와 JS 사용 위치에 연결한다. 생성 클래스명은 번들러별로 기록하며 같을 것을 요구하지 않는다. |
| M2a | CSS Module default object import | Vite 기본 설정과 Rspack 기본 설정, Rspack의 `namedExports: false` 호환 설정을 각각 빌드해 API 형태별 성공 여부와 해결 설정을 기록한다. 번들러 기본값의 차이는 숨기지 않는다. |
| M3 | 로컬·외부 `@import` | import된 토큰 선언이 최종 CSS에 포함되고 외부 `.invalid` import의 URL·`layer()`·`supports()`·media 조건이 최종 CSS에 보존된다. 두 번들러가 media 조건을 다르게 표기하면 CSSWG에서 동등하다고 정의한 문법을 확인한다. |
| M4 | 이미지·폰트 URL | 로컬 SVG와 WOFF2 자원이 별도 산출물로 존재하고, CSS URL이 해당 파일을 가리키며 SHA-256·원본 확장자를 기록한다. 폰트 바이트의 유효성·OS 글꼴 로딩은 시험하지 않는다. |
| M5 | entry·동적 chunk 소유 관계 | 초기 스타일과 동적 기능 스타일의 산출 CSS 자원을 구분하고, 기능 스타일이 기능 동적 chunk를 불러오는 번들러 산출물에 연결된다. 공유 스타일의 실제 귀속·중복 제거는 그대로 기록하며 사전 기대값에 맞춰 조정하지 않는다. |
| M6 | CSS 원본 위치 | CSS 원본에서 얻은 import·URL 참조 위치와 미해결 로컬 자원 진단을 공통 계약의 파일·줄·열로 보존한다. source map 유무와 원본 목록은 보조 관찰값으로 별도 기록한다. |
| M7 | 외부 URL 보존 | 외부 `.invalid` URL이 외부 참조로 출력되며 로컬 해시 자원으로 변환되지 않는다. 실험 코드는 외부 네트워크 요청 기능을 제공하지 않는다. |
| M8 | 자원 어댑터 snapshot | 두 번들러 결과가 버전 있는 내부 계약을 통과하고, 끊긴 resource ID·절대 경로·잘못된 source 위치 없이 CSS 모듈·source·entry/dynamic/shared chunk·자원 관계와 `@import` 조건 suffix를 기록한다. |
| M9 | 번들러 기본 resolver로 찾은 CSS 입력 | fixture의 Vite/Rspack alias와 `package.json` `exports`를 통해 가져온 CSS가 두 snapshot에 fixture 상대 경로로 각각 한 번 기록되고, entry chunk의 산출 CSS와 marker가 연결된다. Vite transform hook과 Rspack stats의 실제 CSS module 경로도 기록해 직접 import된 alias/package CSS가 native build graph에 들어왔음을 확인한다. |

M1~M9는 비교의 하드 조건이다. M2a는 기본 설정 차이를 관찰하고 Rspack 호환 옵션도 별도로 시험한다. M6의 정규 원본 위치는 번들러 source map에 의존하지 않고 어댑터가 입력 CSS의 파서 위치를 보존해 만든다. 번들러 고유 진단이 다른 경우 원래 동작과 어댑터 진단을 나눠 기록한다. source map은 디버깅 보조 산출물이며 공통 계약의 필수 입력이 아니다. M9는 fixture 안에 실파일로 둔 패키지만 대상으로 하며 symlink 패키지, plugin 가상 모듈, package exports 조건 조합, fixture 밖 의존성 탐색은 판정하지 않는다. 렌더링 픽셀, Stylo 계산값, DOM runtime 적용, OTA manifest 통합, Android·iOS 빌드는 이 비교에서 주장하지 않는다. 조건 하나라도 실패하면 비교 명령도 실패하고 원본 산출물·도구 오류를 조사한다. 실제 기본 동작이 다르면 그 차이를 결과에 남긴다.

## 실행과 증거

```sh
cd spikes/css-bundler
mise exec -- bun install --frozen-lockfile
mise exec -- bun run compare
```

스파이크 코드와 fixture는 `spikes/css-bundler/`에 있다. 실행 결과의 정규화 JSON과 해석은 [C02 비교 기록](./evidence/css-c02-bundler-2026-10-01.md)에서 연결한다. 이 모델은 사용자 API나 기능 완료 기준을 추가하지 않는다. 최종 자원 그래프 직렬화는 R15·X01·D02 계약이 정해진 뒤 별도 비교 모델로 검증해야 한다.
