# Vite·Rspack CSS 산출 실험

동일 fixture를 Vite와 Rspack의 production build로 산출해 CSS Modules, 로컬 CSS import, 이미지·폰트 URL, entry·dynamic·shared chunk, source map과 오류 진단을 비교한다. Vite 플러그인과 Rspack stats 수집기를 통해 두 결과를 임시 공통 snapshot으로 정규화한다. 이 코드는 fixture 전용 prototype이며 제품 번들러 adapter나 사용자 API가 아니다.

```sh
cd spikes/css-bundler
mise exec -- bun install --frozen-lockfile
mise exec -- bun run compare
mise exec -- bun run test
```

의존성은 전용 `bun.lock`에서 Vite `8.3.1`, Rspack `2.2.7`, PostCSS `8.5.28`, `postcss-value-parser` `4.2.0`으로 고정한다. `mise.toml`이 정한 Bun `1.4.2`와 Node.js `24.20.0`을 사용한다. `.output/`에 두 production 산출물과 정규화 비교 JSON을 만들고, `spec/internal/evidence/css-c02-bundler-2026-10-01.json`을 갱신한다.

비교 모델은 [C02 내부 명세](../../spec/internal/0008-css-bundler-c02.md), snapshot 필드는 [어댑터 내부 계약 후보](../../spec/internal/0011-css-resource-adapter-c02.md), 결과와 한계는 [C02 비교 기록](../../spec/internal/evidence/css-c02-bundler-2026-10-01.md)에 있다. 비교는 M1~M8을 검사하고, CSS import 조건·참조 위치·실패 위치·snapshot 참조 무결성을 테스트한다. package/alias resolver, 최종 OTA 그래프, 모바일 연결은 검증하지 않았으므로 [C02](../../spec/STATUS.md)의 공식 완료 상태는 계속 미완료다.
