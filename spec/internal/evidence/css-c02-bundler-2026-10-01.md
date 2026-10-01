# C02 · Vite·Rspack CSS 산출 비교

**결과:** production 산출 사례와 fixture adapter 비교 통과 · **C02 제품 구현:** 미완료 · **주요 제한:** 임의 프로젝트 resolver·OTA 통합

이 실험은 [C02 비교 모델](../0008-css-bundler-c02.md) v3의 같은 fixture를 Vite와 Rspack으로 각각 production build 했다. 두 도구의 manifest·chunk graph와 입력 CSS parser 결과를 [공통 내부 계약 후보](../0011-css-resource-adapter-c02.md)의 snapshot으로 정규화했다. 결과 JSON의 `run.input`에는 fixture 전체 파일 목록·크기·SHA-256을, 각 snapshot에는 그 inventory digest와 정규화한 원본·산출물 해시를 기록한다. 실행 설정과 의존성 잠금은 스파이크 코드·`bun.lock`에 보관한다.

## 환경과 실행

- macOS arm64, Node.js `24.20.0`, Bun `1.4.2`
- Vite `8.3.1`, Rspack `2.2.7`, PostCSS `8.5.28`, `postcss-value-parser` `4.2.0`을 `spikes/css-bundler/bun.lock`에 고정
- 양쪽 모두 기본 production CSS 최소화, CSS code splitting, 자원 인라인 비활성화, CSS·JavaScript source map 설정
- fixture: 기본 CSS와 로컬 `@import`, CSS Module, 공유 CSS·JavaScript chunk, `import()`로만 로드되는 기능 CSS, 로컬 SVG·WOFF2 파일, 외부 URL 두 종류, 누락 로컬 URL 진단 사례

```sh
cd spikes/css-bundler
mise exec -- bun install --frozen-lockfile
mise exec -- bun run compare
mise exec -- bun run test
```

`bun run compare`는 두 번들러를 실제 빌드하고 산출 manifest·entry/dynamic/shared chunk·자원·해시와 누락 자원 진단을 검사한다. `bun run test`는 `@import` 조건 보존, 선언 내용이 속성명과 겹치는 경우와 CRLF·CR·form-feed 원본 위치, URL 분류, snapshot 계약·참조 무결성을 실행한다. 실행 결과를 이 문서와 JSON으로 다시 기록한다. 출력 디렉터리는 `spikes/css-bundler/.output/`이다.

## 확인 결과

| 모델 | 결과 | 관찰 |
| --- | --- | --- |
| M1 · 동일 입력 빌드 | 통과 | 양쪽 production build 성공. 원본 fixture 18개 파일 해시 저장. |
| M2 · CSS Module named import | 통과 | `card`, `featured`를 양쪽 CSS와 JavaScript 산출물에서 연결. 생성 클래스 식별자는 Vite `_card_…`, `_featured_…`, Rspack `csPk0D`, `i57fPC`로 다름. |
| M2a · CSS Module default import | 설정 차이 확인 | Vite 기본 설정은 객체 import 통과. Rspack 기본은 `default` export 부재로 실패하고 `module.parser['css/auto'].namedExports: false`를 추가한 설정은 통과. Rspack 공식 문서도 해당 옵션을 설명한다. |
| M3 · `@import` | 통과 | 로컬 `tokens.css` 선언은 entry CSS로 합쳐짐. 외부 `.invalid` CSS import의 URL·`layer()`·`supports()`·media 조건이 최종 CSS에 남음. Vite는 `(min-width: 1px)`를 `(width >= 1px)`로 축약했고 Rspack은 원래 표기를 유지했다. CSSWG Media Queries Level 4는 두 표기가 동등하다고 정의한다. [CSSWG 명세](https://drafts.csswg.org/mediaqueries/). snapshot에는 원본 조건 suffix도 보존됨. |
| M4 · 로컬 자원 | 통과 | SVG 3개와 WOFF2 파일이 각각 별도 산출되고 CSS URL이 실제 파일을 가리킴. 출력 자원의 SHA-256이 원본과 일치. WOFF2 fixture는 형식 식별·추출만 보는 불투명 바이트이며 폰트 디코딩을 시험하지 않음. |
| M5 · 동적 CSS chunk | 통과 | 두 도구에서 초기 CSS와 `import()` 기능 CSS가 분리됨. `lazy-feature` 규칙과 그 SVG는 기능 CSS/자원에 귀속. 공통 스타일은 초기 CSS에 한 번만 나타남. |
| M6 · 원본 위치 | 통과 | 두 snapshot 모두 5개 CSS 원본의 `@import` 2개와 `url()` 5개의 파일·줄·열을 기록. 누락 URL은 `src/diagnostics/broken.css:2:25`로 정규화됨. Rspack native 진단은 0-based column `24`, Vite 기본은 위치 없는 경고였고 fixture adapter가 양쪽 원본 위치를 일치시킴. |
| M7 · 외부 URL | 통과 | 외부 CSS·이미지 URL은 CSS 텍스트에서 외부 참조로 보존되며 로컬 산출 자원으로 바뀌지 않음. 이 실험은 런타임 네트워크 호출 정책을 검사하지 않음. |
| M8 · 공통 snapshot | 통과 | 두 snapshot의 schema·상대 경로·SHA-256·source 위치·resource 참조를 검사. 원본 CSS 모듈→산출 CSS와 entry/dynamic/shared chunk→JS·CSS·asset 연결을 모두 확인. |

Vite collector는 CSS 입력 plugin hook으로 원본 텍스트와 named/default exports를 수집하고 Rollup 출력 chunk modules와 manifest로 자원 관계를 만든다. 수동으로 분리한 공통 JavaScript 모듈을 실제 production fixture에 넣어 정적 shared chunk도 누락되지 않는지 확인했다. Rspack collector는 CSS 모듈 source/export를 stats에서 받고 compilation의 `chunkGraph.getModuleChunksIterable`로 원본 CSS의 실제 청크 소속을 연결한다. 따라서 Rspack source map은 source-to-output 관계 추론에 사용하지 않으며, 양쪽 원본 위치는 입력 CSS parser에서 생성한다. CSS 산출 파일명·클래스 hash는 번들러별로 다르므로 공통 ID로 취급하지 않는다.

기본 번들러 동작도 별도 보존했다. Vite 단독은 누락 URL에 경고하고 참조를 산출 CSS에 남겨 빌드를 성공시킨다. fixture용 Vite adapter는 같은 상대 URL을 원본 CSS 위치와 함께 build error로 바꾼다. Rspack은 기본부터 build error를 내며 source 위치를 제공한다. 이 차이를 감추지 않고 default 결과와 adapter 결과를 각각 기록했다.

Vite는 기본 설정에서 `.module.css`를 객체로 import하는 방식을 문서화한다. Rspack은 기본적으로 named exports를 쓰며 `namedExports: false`로 default import도 허용한다. 이 설정 차이는 어댑터 구성에 포함해야 한다. [Vite CSS 문서](https://vite.dev/guide/features#css), [Rspack CSS Modules 문서](https://www.rspack.org/guide/languages/css#css-modules).

## 판정과 남은 범위

M1~M8은 현재 fixture와 도구 버전에서 통과했다. 이는 어댑터 계약 후보를 시험한 것이며 C02 제품 구현 완료를 뜻하지 않는다. CSS source map 유무가 달라도 parser 원본 위치는 보존될 수 있음을 확인했다. 검증 과정에서 `@import url()` suffix에 닫는 괄호가 섞이던 위치 계산과 Vite shared chunk 누락을 고쳐 fixture와 snapshot에서 확인했다. 계약 검증도 제공된 버전을 덮어쓰지 않고 필수 배열·참조·source path를 검사하도록 보강했다.

스파이크의 resolver는 fixture 안의 단순 상대·루트 상대 경로만 직접 확인한다. alias, package exports, symlink, query suffix, plugin 가상 자원, package exports 조건별 resolver, 한 입력이 여러 산출로 변환되는 경우의 정확한 edge는 제품 계약으로 검증하지 않았다. 잘못된 CSS 문법을 두 번들러 진단으로 정규화하는 경우도 검증하지 않았다. 아직 구현·검증하지 않은 항목: 제품 Vite/Rspack 패키지 API, R15·X01·D02 최종 기능 그래프 직렬화, JavaScript inline style 자원 수명, OTA delta 설치·활성화, 개발 서버/HMR, 브라우저 화면·Stylo CSS 계산, Android/iOS 패키징, 원격 URL fetch. 따라서 C02는 [상태 대장](../../STATUS.md)에서 계속 미완료다.

버전 참고: [Vite `8.3.1` 릴리스](https://github.com/vitejs/vite/releases/tag/v8.3.1), [Rspack `2.2.7` 릴리스](https://github.com/web-infra-dev/rspack/releases/tag/v2.2.7).
