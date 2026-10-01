# C02 · Vite·Rspack CSS 산출 비교

**결과:** production 산출 그래프의 주요 사례 통과 · **C02 제품 구현:** 미완료 · **남은 차이:** CSS 원본 진단 위치

이 실험은 [C02 비교 모델](../0008-css-bundler-c02.md) v2의 같은 fixture를 Vite와 Rspack으로 각각 production build 했다. 모든 fixture, 설정, lockfile과 정규화된 원본·산출물 SHA-256은 [결과 JSON](./css-c02-bundler-2026-10-01.json)에 보관한다.

## 환경과 실행

- macOS arm64, Node.js `24.20.0`, Bun `1.4.0`
- Vite `8.3.1`, Rspack `2.2.7`을 `spikes/css-bundler/bun.lock`에 고정
- 양쪽 모두 기본 production CSS 최소화, CSS code splitting, 자원 인라인 비활성화, CSS·JavaScript source map 설정
- fixture: 기본 CSS와 로컬 `@import`, CSS Module, 공유 CSS, `import()`로만 로드되는 기능 CSS, 로컬 SVG·WOFF2 파일, 외부 URL 두 종류, 누락 로컬 URL 진단 사례

```sh
cd spikes/css-bundler
bun install --frozen-lockfile
bun run compare
```

`bun run compare`는 두 번들러를 실제 빌드하고 산출 manifest·chunk·자원·해시와 누락 자원 진단을 검사한다. 실행 결과를 이 문서와 JSON으로 다시 기록한다. 출력 디렉터리는 `spikes/css-bundler/.output/`이다.

## 확인 결과

| 모델 | 결과 | 관찰 |
| --- | --- | --- |
| M1 · 동일 입력 빌드 | 통과 | 양쪽 production build 성공. 원본 fixture 17개 파일 해시 저장. |
| M2 · CSS Module named import | 통과 | `card`, `featured`를 양쪽 CSS와 JavaScript 산출물에서 연결. 생성 클래스 식별자는 Vite `_card_…`, `_featured_…`, Rspack `csPk0D`, `i57fPC`로 다름. |
| M2a · CSS Module default import | 설정 차이 확인 | Vite 기본 설정은 객체 import 통과. Rspack 기본은 `default` export 부재로 실패하고 `module.parser['css/auto'].namedExports: false`를 추가한 설정은 통과. Rspack 공식 문서도 해당 옵션을 설명한다. |
| M3 · `@import` | 통과 | 로컬 `tokens.css` 선언은 entry CSS로 합쳐짐. 외부 `.invalid` CSS import는 CSS의 외부 URL 참조로 남음. |
| M4 · 로컬 자원 | 통과 | SVG 3개와 WOFF2 파일이 각각 별도 산출되고 CSS URL이 실제 파일을 가리킴. 출력 자원의 SHA-256이 원본과 일치. WOFF2 fixture는 형식 식별·추출만 보는 불투명 바이트이며 폰트 디코딩을 시험하지 않음. |
| M5 · 동적 CSS chunk | 통과 | 두 도구에서 초기 CSS와 `import()` 기능 CSS가 분리됨. `lazy-feature` 규칙과 그 SVG는 기능 CSS/자원에 귀속. 공통 스타일은 초기 CSS에 한 번만 나타남. |
| M6 · 원본 위치 | **공백** | Rspack은 CSS map에서 원본 파일 목록을 내고, 없는 SVG 요청은 `broken.css:2:24`로 빌드를 실패시킴. Vite CSS map 파일과 `sourceMappingURL`이 나오지 않았고, 없는 SVG는 빌드를 성공시킨 채 참조를 남기며 일반 경고만 출력했다. 그 경고에는 원본 stylesheet 경로·줄·열이 없음. |
| M7 · 외부 URL | 통과 | 외부 CSS·이미지 URL은 CSS 텍스트에서 외부 참조로 보존되며 로컬 산출 자원으로 바뀌지 않음. 이 실험은 런타임 네트워크 호출 정책을 검사하지 않음. |

Rspack의 stats에는 `tokens.css`의 `base.css` import 및 외부 `css-import` 모듈이 나타났다. Vite manifest는 entry/dynamic chunk별 CSS와 자산은 연결하지만, CSS 원본 모듈 키와 내부 import edge를 노출하지 않았다. 따라서 두 도구에는 각자 다른 수집기를 두고, 최종 그래프 계약에서 공통 형식으로 정규화해야 한다.

Vite는 기본 설정에서 `.module.css`를 객체로 import하는 방식을 문서화한다. Rspack은 기본적으로 named exports를 쓰며 `namedExports: false`로 default import도 허용한다. 이 설정 차이는 어댑터 구성에 포함해야 한다. [Vite CSS 문서](https://vite.dev/guide/features#css), [Rspack CSS Modules 문서](https://www.rspack.org/guide/languages/css#css-modules).

## 판정과 남은 범위

M1~M5와 M7의 production 산출 실험은 통과했다. M6의 진단 차이를 닫기 전까지 원본 오류 위치 보존을 C02에서 구현 완료 처리하면 안 된다. 다음 구현 전 단계에서는 Vite의 CSS 원본 출처를 안정적으로 모으는 방법, 누락 로컬 자원의 실패·경고 계약, CSS map 처리 기준을 비교 모델에 추가로 고정해야 한다.

아직 구현·검증하지 않은 항목: Spinon Vite/Rspack adapter API, R15·X01·D02 최종 기능 그래프 직렬화, JavaScript inline style 자원 수명, OTA delta 설치·활성화, 개발 서버/HMR, 브라우저 화면·Stylo CSS 계산, Android/iOS 패키징, 원격 URL fetch. 따라서 C02는 [상태 대장](../../STATUS.md)에서 계속 미완료다.

버전 참고: [Vite `8.3.1` 릴리스](https://github.com/vitejs/vite/releases/tag/v8.3.1), [Rspack `2.2.7` 릴리스](https://github.com/web-infra-dev/rspack/releases/tag/v2.2.7).
