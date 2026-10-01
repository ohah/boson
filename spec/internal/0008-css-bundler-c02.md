# C02 · Vite·Rspack CSS 산출 비교 모델

**문서 상태:** 내부 실험 계약 · **제품 API:** 없음 · **C02 완료 판정:** 아님

이 문서는 Vite와 Rspack의 CSS 산출물을 같은 입력으로 비교하는 재현 가능한 실험 기준이다. 관찰 결과는 두 번들러의 기본 산출 기능을 설명할 뿐, 스피논의 번들러 어댑터나 모바일 CSS 로더가 구현됐음을 뜻하지 않는다.

## 고정 입력과 환경

- 도구: Vite `8.3.1`, Rspack `2.2.7`, Node.js `24.20.0`, Bun `1.4.0`; 의존성은 스파이크 전용 잠금 파일에 고정한다.
- 같은 HTML 진입점과 JavaScript 모듈을 두 빌드에 넣는다. 입력은 일반 CSS import, CSS Module의 `card`·`featured` 로컬 키, 로컬 `@import`, 공유 스타일, 동적 import로만 도달하는 기능 스타일, 로컬 SVG 이미지와 WOFF2 확장자 자원을 포함한다.
- 외부 CSS `@import`와 외부 이미지 URL은 `.invalid` 도메인을 사용한다. 실험은 URL 문자열을 빌드 도구가 로컬 자원으로 바꾸거나 실제로 가져오지 않고 외부 참조로 남기는지 확인한다. 런타임 네트워크 정책 검증은 범위 밖이다.
- 각 빌드는 production mode의 기본 CSS 최소화, CSS code splitting 활성화, 자원 인라인 비활성화, CSS·JS source map 생성을 사용한다. 출력물은 `spikes/css-bundler/.output/`에 만든다.

## 비교 모델과 판정 기준

| ID | 관찰값 | 통과 조건 |
| --- | --- | --- |
| M1 | 도구 버전·입력 해시·출력 자원 목록과 SHA-256 | 두 빌드가 성공하고 같은 원본 입력 해시를 기록한다. 번들 파일 이름·코드 해시는 서로 같을 것을 요구하지 않는다. |
| M2 | CSS Module named import | 두 빌드 모두 named import 로컬 키 `card`, `featured`를 산출 CSS 선택자와 JS 사용 위치에 연결한다. 생성 클래스명은 번들러별로 기록하며 같을 것을 요구하지 않는다. |
| M2a | CSS Module default object import | Vite 기본 설정과 Rspack 기본 설정, Rspack의 `namedExports: false` 호환 설정을 각각 빌드해 API 형태별 성공 여부와 해결 설정을 기록한다. 번들러 기본값의 차이는 숨기지 않는다. |
| M3 | 로컬 `@import` | import된 토큰 선언이 최종 CSS에 포함되고 외부 `.invalid` import는 로컬 CSS 노드·파일로 분류되지 않는다. |
| M4 | 이미지·폰트 URL | 로컬 SVG와 WOFF2 자원이 별도 산출물로 존재하고, CSS URL이 해당 파일을 가리키며 SHA-256·원본 확장자를 기록한다. 폰트 바이트의 유효성·OS 글꼴 로딩은 시험하지 않는다. |
| M5 | entry·동적 chunk 소유 관계 | 초기 스타일과 동적 기능 스타일의 산출 CSS 자원을 구분하고, 기능 스타일이 기능 동적 chunk를 불러오는 번들러 산출물에 연결된다. 공유 스타일의 실제 귀속·중복 제거는 그대로 기록하며 사전 기대값에 맞춰 조정하지 않는다. |
| M6 | source map 원본 | 산출 CSS/JS source map의 원본 목록에서 원래 CSS 입력 경로를 확인한다. 줄·열 단위 진단 정밀도는 별도 결과로 기록한다. |
| M7 | 외부 URL 보존 | 외부 `.invalid` URL이 외부 참조로 출력되며 로컬 해시 자원으로 변환되지 않는다. 실험 코드는 외부 네트워크 요청 기능을 제공하지 않는다. |

M1~M5·M7은 산출물을 검증하는 하드 조건이다. M2a는 기본 설정 차이를 관찰하고 Rspack 호환 옵션도 별도로 시험한다. M6는 CSS source map과 깨진 URL 진단의 경로·줄·열을 측정하며, 어느 번들러에서든 원본 위치가 확인되지 않으면 공백으로 남긴다. 렌더링 픽셀, Stylo 계산값, DOM runtime 적용, OTA manifest 통합, Android·iOS 빌드는 이 비교에서 주장하지 않는다. 하드 조건 하나라도 실패하면 전체 비교를 실패시키고 원본 산출물·도구 오류를 조사한다. 실제 기본 동작이 다르면 그 차이를 결과에 남기며 플러그인이나 사후 보정으로 숨기지 않는다.

## 실행과 증거

```sh
cd spikes/css-bundler
bun install --frozen-lockfile
bun run compare
```

스파이크 코드와 fixture는 `spikes/css-bundler/`에 있다. 실행 결과의 정규화 JSON과 해석은 [C02 비교 기록](./evidence/css-c02-bundler-2026-10-01.md)에서 연결한다. 이 모델은 사용자 API나 기능 완료 기준을 추가하지 않는다. 최종 자원 그래프 직렬화는 R15·X01·D02 계약이 정해진 뒤 별도 비교 모델로 검증해야 한다.
