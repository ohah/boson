# C02.3 JavaScript·CSS 자원 그래프 결합 실행 근거

**범위:** 고정 fixture에서 Vite와 Rspack의 0011·0014 snapshot을 한 번의 production build로 결합한 내부 실험이다. 제품 번들러 API, 전체 프로젝트 호환성, R15 논리 ID 또는 OTA 지원 완료를 뜻하지 않는다.

## 비교 모델과 실행 환경

- 기준 계약: [C02 비교 모델](../0008-css-bundler-c02.md), [0011 CSS 자원 snapshot](../0011-css-resource-adapter-c02.md), [0014 JavaScript graph snapshot](../0014-c02-bundler-module-graph.md), [0015 결합 계약](../0015-c02-resource-graph-join.md).
- 비교 입력: `spikes/css-bundler/fixture-resource-join/`의 같은 JS·CSS·font·image fixture. 각 번들러에서 실제 production build를 한 번 실행하며 JS graph와 CSS resource collector를 같은 capture ID·fixture digest·정규 profile digest로 묶는다.
- 실행 환경: macOS `26.5.1`, `darwin-arm64`, Node.js `v24.20.0`, Bun `1.4.2`, Vite `8.3.1` / Rolldown `1.2.12`, Rspack `2.2.7`.
- `spikes/css-bundler/package.json` SHA-256: `3ffdbf38f0b82cd19dcf77f40b0ccd42ac46dc35c3cb549ea0fe81fd60930204`.
- `spikes/css-bundler/bun.lock` SHA-256: `e71ecca80fee83319fdde41ba33b6ad343b17d1bfd098f8fe1183ac5482ed145`.
- fixture tree SHA-256: `ad2946ed004051106cafbe9c7aa928511d681f864920e055c0dfa9fbe39e3c8a`.
- capture별 snapshot, output resource 전체 byte 수·SHA-256 및 profile/graph digest: [기계 판독 결과](css-c02-resource-graph-join-2026-10-02.json). JSON 파일 SHA-256: `719220281e7e6b71447a2e713a9d580794151e4f7ead9a86b0c94d11cc577d57`.

기계 판독 결과의 `resourceGraphSha256`, `moduleGraphSha256`, `joinedGraphSha256`는 `captureId` 하나만 제거한 snapshot을 재귀적 키 정렬 JSON으로 정규화해 계산한다. joined digest는 capture ID를 제거한 0011·0014 snapshot digest도 다시 계산해 포함한다. 반복 capture 회귀 테스트는 임시 경로가 profile에 섞이지 않고 정규 snapshot digest가 두 빌드 사이에서 같은지 확인한다. capture UUID 자체는 빌드마다 달라야 한다.

## 관찰 결과

| 번들러 | Build profile SHA-256 | 0011 resource graph SHA-256 | 0014 source graph SHA-256 | 0014 output graph SHA-256 | 결합 graph SHA-256 | 출력 자원 / chunk / 자원 edge |
| --- | --- | --- | --- | --- | --- | ---: |
| Vite 8.3.1 / Rolldown 1.2.12 | `bbcef3f2c5b2b86f8044bcdacea14a674b55ace50d05a93dbd217fe31921386b` | `02121128e4f8a17fd0d578853ec1d0f4347d5c5507c946841586b89d928d0880` | `df415de70b5575729fafe59fbc479dd0a398f5da82130eb7ba757947761fad36` | `0d794958b25ce93c9e8b876514abb506d60af93e7b03930efb3c28a1bb57e816` | `7b02bb8c0b3bb0ab1d862b7fa48e50bf7e692b31a36f1f3b09eae4cbfbaaf251` | 10 / 4 / 3 |
| Rspack 2.2.7 | `8d77c15427008535968549e4dafffff1e550a7ac06d4a1b455c1266ca3c9cf8d` | `fbd84367d8607222fa2a4a2c3f7225893b34f23a0b4e6aaf433cb14112c822e7` | `167055038366fdade6fb7ad1999eb0756efad974855cf503843d4d62cfdd8498` | `d080ab56b6e29635f0dca0935905cb4b38d616753e205ba54707c1eff5656d06` | `9bb3184ea2979ad5921b365ade1f6ba1a41ad3b008a4dc2170c9fef6f1130845` | 12 / 5 / 4 |

두 번들러에서 feature ID와 entry source는 `main → index.js`, `lazy-feature → features/lazy.js`로 같았다. `index.js → features/lazy.js → features/icon.js` 동적 JS edge와 각 feature chunk의 stylesheet·font·image 관계가 닫혔다. 번들러별 chunk ID·출력 layout·profile digest는 달라 직접 동등성을 주장하지 않는다. 교차 번들러 비교는 공통 fixture의 입력 관계와 각자 최종 산출 bytes를 별도로 확인하는 방식이다.

두 빌드 모두 같은 bytes로 내보낸 공통 자산은 다음과 같다.

| 출력 경로 | 종류 | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/background.svg` | image | 108 | `803e39f6f41ec1d831a13c2c21d789da72ed48172d99c7c46b9ec55664dfdec2` |
| `assets/fixture.woff2` | font | 102 | `bc54552e1d3e1337b484a8b1fce3d2126cf7669c27fe1bf523b659a404bf251e` |
| `assets/icon.svg` | image | 109 | `970052ddcb980e5ec5a31174e68700234bb58b53e69b27387dc3b5b8a7ead4b8` |
| `assets/lazy.svg` | image | 108 | `d170ebce4812d66fdadb6252eb7579fddeb2496713d679cc0ed6b7a11c545b9d` |

CSS output 차이는 각각의 snapshot 안에서 정확히 연결했다. Vite는 `styles/tokens.css`의 규칙을 `assets/main.css`로 인라인하고, Rspack은 `styles/app.css`와 `styles/tokens.css`를 별도 파일로 내보낸다. 따라서 이 결과는 두 도구가 같은 CSS bytes를 방출한다는 주장이 아니다. 개별 CSS 산출물 digest는 위 JSON에서 확인할 수 있다. font fixture는 번들러의 asset 분류·복사·연결만 시험하며 실제 font parser나 화면 글리프 렌더링을 검증하지 않는다.

## 실패 경계와 기존 회귀

공통 join은 capture·tool version·production mode·fixture/profile digest, JS 출력 resource 전체 집합과 byte count·SHA-256이 다르면 거부한다. Rspack은 두 collector가 같은 compilation 객체를 본 사실을 검사한다. Vite manifest의 CSS·asset 경로·소유자가 불명확하거나 출력 파일이 없을 때, Rspack CSS 원문이 시작 fixture bytes와 다를 때도 실패한다. 두 어댑터 모두 활성 external/unresolved CSS `@import`·`url()`, 모호한 source target, 누락·중복 owner, orphan runtime resource, 위험한 output path와 symlink를 성공으로 반환하지 않는다. 실패한 Vite/Rspack build 뒤 임시 output container가 정리되고 fixture 원본이 유지되는지도 확인했다.

통합 suite 실행 전에 기존 Rspack C02.2 adapter 테스트 3개가 checkout에 없는 `@spinon/exports-fixture`로 실패하는 것을 확인했다. 테스트는 이제 `package-fixtures/`의 고정 package와 ESM 프로젝트 metadata를 OS 임시 fixture에 복사한 뒤 빌드한다. 기존 fixture를 수정하지 않고 C02.2 adapter의 30개 회귀 테스트를 모두 통과시킨다.

## 검증 명령과 한계

```sh
cd spikes/css-bundler
mise exec -- node record-resource-graph-join.mjs
mise exec -- bun run test
```

- Vite 결합 adapter 48/48, Rspack 결합 adapter 10/10, 공통 join contract 26/26, 기존 Rspack module graph adapter 30/30이 통과했다. 통합 CSS bundler suite는 **163/163 통과**했다.
- `record-resource-graph-join.mjs`는 별도 Vite·Rspack production build 결과, profile·fixture·그래프 digest와 출력 자원 inventory를 JSON으로 남긴다. 반복 안정성은 전용 tests가 두 번의 실제 build를 비교한다.
- 결과는 고정된 한 fixture, macOS arm64, 위 번들러 버전 및 production ESM profile에 한정된다. 사용자 플러그인·임의 resolver·symlink package·CSS Modules 조합·동적 CSS 생성·다른 OS와 버전, 최종 R15 logical ID, 제품 번들러 API, X01 loader, CSS cascade/rendering, OTA 생성·배포·활성화·rollback은 검증하지 않았다. 외부 CSS 자원 loader는 미구현이며 네트워크 요청을 하지 않는다.
