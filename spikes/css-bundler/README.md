# Vite·Rspack CSS 산출 실험

동일 CSS fixture를 Vite와 Rspack의 production build로 산출해 CSS Modules, 로컬 CSS import, 이미지·폰트 URL, entry·동적 chunk, source map과 오류 진단을 비교한다. 이 스파이크는 번들러 adapter나 사용자 API가 아니다.

```sh
cd spikes/css-bundler
bun install --frozen-lockfile
bun run compare
```

의존성은 전용 `bun.lock`에서 Vite `8.3.1`, Rspack `2.2.7`로 고정한다. `mise.toml`이 정한 Bun `1.4.0`과 Node.js `24.20.0`을 사용한다. `.output/`에 두 production 산출물과 정규화 비교 JSON을 만들고, `spec/internal/evidence/css-c02-bundler-2026-10-01.json`을 갱신한다.

비교 모델은 [C02 내부 명세](../../spec/internal/0008-css-bundler-c02.md), 결과와 현재 공백은 [C02 비교 기록](../../spec/internal/evidence/css-c02-bundler-2026-10-01.md)에 있다. M6 CSS 원본 오류 위치가 아직 맞지 않고, 모바일·OTA 경로는 검증하지 않았다. 따라서 [C02](../../spec/STATUS.md)의 공식 완료 상태는 계속 미완료다.
