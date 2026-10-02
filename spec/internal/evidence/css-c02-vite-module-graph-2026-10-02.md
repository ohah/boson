# C02 Vite 모듈 그래프 어댑터 실행 근거

**범위:** Vite 8.3.1/Rolldown 1.2.12 전용 내부 adapter 실험이다. 제품 API나 C02 완료, 전체 R15 OTA 적격 판정이 아니다.

## 실행 환경과 고정 profile

- `mise exec -- node --version`: Node.js `v24.20.0`
- OS/architecture: `darwin-arm64`
- Vite `8.3.1`, Rolldown `1.2.12`
- `spikes/css-bundler/package.json` SHA-256: `3ffdbf38f0b82cd19dcf77f40b0ccd42ac46dc35c3cb549ea0fe81fd60930204`
- `spikes/css-bundler/bun.lock` SHA-256: `e71ecca80fee83319fdde41ba33b6ad343b17d1bfd098f8fe1183ac5482ed145`
- Vite adapter SHA-256: `d81adcdf01d30ef03a560a46f8fb39f34966939da79b66677831910959413f26`
- Vite config SHA-256: `6e235d6e070cfc63ce0a3fc0944183d3b16334a40ba7b1c8fca731e6a460845f`
- Vite 전용 test file SHA-256: `09179656add84d0f174f793971536d720d3ff6eef0b99b3f5d7c5a5bbcb17b9d`. test source는 fixture/build 입력이 아니므로 build profile `configSources` digest에는 포함하지 않는다.
- 공통 contract helper SHA-256: `6e5cf5924a4c1b6aed863f858190d767a0967a097cefef8a3e615b186017e2a6`
- 정상 fixture tree digest: `e750a7f8fc8fee5fdee2556b227a00e85225a15ff706b8b54b576108e8e9169b`
- 통합 저장소에서 실행한 정상 build profile SHA-256: `cdb7efaa441ab27fc354c262bc763207b0fcd98b5e13d2981b9416c53e9c9fbd`

최종 evidence는 공통 contract와 Acorn `8.18.0` 직접 의존성을 포함한 통합 저장소에서 다시 생성했다. 임시 helper·Acorn symlink를 사용하지 않았다. 통합 build profile에는 실제 `mkdtemp` output 경로가 포함되므로 다른 실행의 profile digest와 달라질 수 있다. fixture/source graph/output digest는 경로와 무관하게 비교한다.

테스트는 build마다 `mkdtemp` 디렉터리를 만들며 각 source fixture와 `outDir`를 그 아래 서로 다른 직접 자식으로 둔다. profile은 실제 `configResolved` 값, feature 목록, output profile, fixture plugin 옵션, adapter/plugin 옵션, Node/Vite/Rolldown 버전, OS/architecture, 환경의 `NODE_ENV`, 실제 fixture/output 절대 경로를 기록한다. 그 profile의 digest는 실제 임시 경로가 달라지면 달라지는 것이 맞다. fixture graph와 emitted bytes digest는 임시 경로에 의존하지 않는다.

실제 resolved config에서 확인·검증한 주요 값은 `command=build`, `mode=production`, `base=./`, resolver conditions `module/browser/development|production`, main fields `browser/module/jsnext:main/jsnext`, 확장자 우선순위 `.mjs/.js/.mts/.ts/.jsx/.tsx/.json`, external conditions `node/module-sync`, dedupe·external·builtins 빈 목록, `preserveSymlinks=false`, `tsconfigPaths=false`, 빈 `define`, fixture root `envDir`, CSS transformer `postcss`, ESM format `es`, `target=esnext`, `minify=false`, CSS splitting enabled, `assetsDir=assets`, 단일 output이다. `modulePreload.polyfill=false`를 사용하며 Vite의 별도 legacy `polyfillModulePreload` 필드 값도 profile에 남긴다. Vite 8.3.1 built-in plugin 목록·순서는 pinned observation과 비교하며, 사용자 plugin은 이름·enforce 위치·선언된 profile options를 모두 profile에 담고 profile 밖 plugin이 발견되면 거부한다. Vite config의 주요 설정이나 output array가 예상 profile과 다르면 source/output capture가 성공하더라도 snapshot을 실패로 반환한다.

정상 실행에서 resolved plugin descriptor에는 Vite built-in 35개와 다음 사용자 plugin 3개가 포함됐다. fixture resolver는 `conflict=false`, API observer는 `ModuleInfo dependency ID ordering` 관찰 목적, adapter는 `main`·`lazy-feature` entry와 고정 output profile을 기록했다. 사용자 plugin 3개의 실제 이름·hook 위치·옵션과 모든 builtin 이름/순서는 `build.profile.effectiveOptions.resolvedViteConfig.plugins`에 들어가며, Vite built-in 순서가 pinned observation과 다르면 실패한다.

## 입력 dependency의 대응 규칙

입력 graph는 `moduleParsed`의 JavaScript AST import/export occurrence와 `ModuleInfo.importedIds`·`dynamicallyImportedIds`를 kind별로 대응한다. `this.resolve()`를 다시 부르지 않는다. 관찰 ID 개수와 AST occurrence 개수가 다르거나, 같은 referrer/kind 안에 서로 다른 target ID가 둘 이상 있어 occurrence별 대응을 알 수 없으면 `C02_GRAPH_CAPTURE_INCOMPLETE`로 실패한다. 같은 target ID가 반복된 occurrence는 Map으로 합치지 않고 각각 보존한다. build 종료 때 재관찰한 ID 목록이 달라지거나 배열 순서가 바뀌어도 실패 처리한다.

설치된 Rolldown `1.2.12` type declaration은 두 ID 필드를 `string[]`로 기술하지만 순서 보장을 선언하지 않는다 (`node_modules/rolldown/dist/shared/define-config-kIZKjX8Q.d.mts`의 `importedIds`·`dynamicallyImportedIds`; binding declaration에도 같은 필드가 있다). 따라서 fixture에서 관찰한 목록을 일반 API 순서 보장으로 확대하지 않는다. 정상 fixture의 `index.js`는 generated helper를 제외하고 static target 하나(`app.js`)와 dynamic target 하나(`features/lazy.js`)만 가져 매핑이 모호하지 않다. 두 개의 다른 occurrence/target을 둔 synthetic fixture와 ID 목록을 뒤집은 fixture는 둘 다 `ambiguous`로 실패한다. 동일 target 반복 fixture는 두 source occurrence를 유지하며, pinned build에서 수가 다르면 incomplete로 실패한다.

Vite 8.3.1의 raw `index.js` static ID 목록에는 AST source에 없는 정확한 ID `\0vite/preload-helper.js`가 관찰됐다. 어댑터는 이 exact allowlist ID를 버리지 않고 virtual module/edge로 기록한다. prefix가 비슷한 다른 ID는 generated ID로 간주하지 않는다. 생성 module의 code나 graph membership를 확인할 수 없으면 실패한다. synthetic `virtual:vite/preload-helper.js` edge는 앱 원문의 import 요청을 복원했다는 뜻이 아니다.

`moduleParsed.info.code`는 transform 뒤 코드일 수 있으므로 source 위치를 `null`로 남긴다. 줄을 하나 앞에 추가하는 transform fixture에서도 원본 위치를 추정하지 않았다. source specifier는 이 pinned parser/compiler dependency record에서 읽은 문자열이다. transform 이전의 앱 원문 문자열이라고 보장하지 않는다.

## Resource query와 module type 경계

- 보통 CSS와 SVG import는 각각 `stylesheet`·`asset` kind의 `excludedDependencies`로 분류하고 fixture-relative resource key를 보존한다. 이 edge는 0011 resource graph와 별도 join이 필요하다.
- 실제 Vite fixture의 CSS `?inline` 요청은 JavaScript dependency edge로 남는다.
- 알 수 없는 CSS query 조합은 unsupported로 실패한다.
- 실제 SVG `?url` fixture는 Vite가 asset identity를 증명한 경우 `assets/icon.svg?url`을 `assets/icon.svg` resource key로 정규화한다. query를 제거한 key가 0011에 전달될 join key라는 점만 확인했다. 0011 graph join이나 최종 asset OTA 배포 적격은 이 adapter 범위 밖이다.
- SVG `?component`는 `moduleType=js`이고 Vite asset metadata가 없을 때만 JS module로 취급하는 direct classifier fixture를 둔다. 실제 SVG component compiler plugin과의 통합 호환성을 증명하지 않는다.
- `.wasm` 확장자와 `moduleType=wasm`은 각각 unsupported로 판정하는 direct classifier fixture가 있다. 미지의 module type도 성공 graph에 들어가지 않는다.

## 최종 emitted ESM과 bytes

최종 JS graph는 `writeBundle` 뒤 실제 output 파일을 symlink를 따라가지 않고 다시 읽어 만든다. 각 regular file의 byte count/SHA-256을 계산하고 Vite build API의 `OutputChunk.code`와 디스크 bytes가 일치하는지 검사한다. Acorn이 최종 ESM의 literal import를 읽으며, 공통 `resolveEmittedChunkTarget`이 emitted specifier를 실제 output path 하나로 해석한다. source specifier와 emitted specifier의 문자열은 달라도 되며, target path가 하나로 확인되면 된다. 남은 계산형 import, unresolved JS target, output metadata 불일치, 비-JS asset import는 실패시킨다.

`writeBundle`에서 최종 output bundle의 item 종류도 검사한다. Worker fixture는 main chunk에서 `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`를 실행하고, Vite가 `assets/worker-<hash>.js`를 chunk가 아닌 JavaScript `OutputAsset`으로 방출하는 것을 재현했다. 이 JS asset은 입력 source module graph와 chunk graph에 나타나지 않으므로 `C02_GRAPH_CAPTURE_INCOMPLETE`로 실패시킨다. `.js`·`.mjs`·`.cjs`·`.jsx`·`.ts` 확장자와 query/fragment 접미 경로를 직접 검사하며, CSS·SVG·font 및 source map 같은 비-JS asset은 이 차단에 걸리지 않고 0011/별도 범위에 남는다. Worker graph 자체는 아직 지원하지 않는다.

정상 fixture에서 관찰한 결과:

| 값 | 결과 |
| --- | ---: |
| raw `moduleParsed` callback | 16 |
| raw distinct `ModuleInfo` IDs | 16 |
| raw static imported IDs / duplicates | 16 / 0 |
| raw dynamic imported IDs / duplicates | 4 / 0 |
| normalized source modules | 14 |
| normalized JavaScript dependencies | 18 |
| normalized excluded CSS/asset dependencies | 2 |
| output JS chunks/resources | 2 / 2 |
| source graph SHA-256 | `8e3a44a4a78b622f6a6d570baad853b48f654cc0f09386be1ff044d038bb0050` |
| R15 JavaScript-only gate | 통과; app-wide impact fallback 필요 |
| 0011 resource join | 필요 |

통합 재실행은 `SPINON_GRAPH_EVIDENCE=1`과 `입력 dependency` 이름 필터를 사용했다. 통합 profile digest는 `cdb7efaa441ab27fc354c262bc763207b0fcd98b5e13d2981b9416c53e9c9fbd`, package/lock digest는 위 표지와 같다. package의 Acorn direct pin과 최종 공통 validator를 포함한 상태에서 같은 fixture의 14 modules·18 JavaScript edges·2 excluded resource edges와 두 emitted chunk를 다시 관찰했다. raw hook/API 관찰값과 정규화 배열 길이는 위 표의 기준을 따른다.

raw API 숫자는 hook callback과 ID 배열에서 센 값이고, normalized counts는 0014 snapshot 배열의 item 수다. raw static 16 + dynamic 4는 normalized JS dependencies 18 + excluded resources 2와 일치했다. 이는 이 fixture에서 중복 제거가 발생하지 않았음을 나타내며, 다른 fixture에 대한 보장은 아니다. 정상 fixture의 `index.js` 관찰 static IDs는 `app.js`와 generated preload helper이고, dynamic ID는 `features/lazy.js`다.

| 실제 emitted JS resource | bytes | SHA-256 |
| --- | ---: | --- |
| `assets/lazy.js` | 168 | `27fb1a62fcc5bb4d54ff1a192fa4846a0d8e3d9e77f32ec43c23d5b911aec113` |
| `assets/main.js` | 2711 | `2d84980b3ae23981d6a4acd8db0396a706889c8cf8ed849d5e55521c22bf26c8` |

같은 fixture/profile의 반복 build와 서로 다른 임시 root의 build에서 output path/byte count/output SHA와 normalized source graph/SHA가 같았다. 서로 다른 root의 profile digest는 root 경로가 기록되므로 다르다. Rolldown의 `//#region` 절대 경로 표식만 Acorn AST가 찾은 comment range에서 `fixture/<relative path>` 형태로 바꿨다. 문자열이나 코드 범위는 정규화하지 않았다.

fixture의 tree-shaken 입력 모듈은 source graph에 남고 `outputChunkIds=[]`로 기록된다. source cycle은 입력 graph에서 보존한다. 별도 output-cycle negative fixture는 plugin이 `OutputChunk` metadata와 불일치하는 import를 bytes에 직접 주입하므로 adapter가 capture incomplete로 실패한다. 그 주입 결과를 정상 번들 동작으로 해석하지 않는다. malformed target을 다른 chunk로 바꾼 snapshot, 누락·중복 module membership, 누락 output resource, feature에서 도달하지 않는 chunk는 common validator/byte reader가 거부한다.

## 실패와 파일 경계 확인

전용 fixture는 external·unresolved 입력 edge, unresolved 최종 ESM import, 계산형 dynamic import, import attributes/phase, unknown module type, moduleParsed 누락, transform 실패, source/output cycle, same-source static/dynamic target conflict, multi-output config, 중복 writeBundle 호출, profile 외 plugin, fixture 밖 dependency, fixture symlink, output resource/parent symlink, 빈/중복 feature ID를 각각 다룬다. 실패 snapshot은 진단을 보존하고 feature entry를 반환하지 않는다.

`emptyOutDir`는 fixture/source root, 패키지/worktree root와 같거나 하위·상위인 output, symlink alias, `.git`, 임시 디렉터리 밖 경로를 Vite build 전 config 단계에서 거부한다. 허용 output은 OS 임시 root의 직접 자식인 mode `0700`·현재 사용자 소유 `mkdtemp` container 안에서 fixture와 sibling으로만 만든다. output root와 각 path component는 `lstat`·`realpath`로 확인하고 symlink를 거부하며 regular file은 `O_NOFOLLOW`로 연다. reader는 parent-directory file descriptor를 고정하지 않는다. mode `0700` temporary container가 다른 UID의 교체를 제한하지만, 같은 UID 프로세스가 확인 직후 parent path를 바꾸는 race는 막았다고 주장하지 않는다. 이 임시 output 경계에서 남는 비차단 한계다.

## 검증 명령과 남은 범위

Vite adapter test file은 **30/30 통과**했다. Acorn pin과 최종 공통 contract를 포함한 통합 저장소에서 `mise exec -- bun run test`를 실행해 CSS/resource, 공통 contract, Rspack, Vite 검사를 합쳐 **130/130 통과**했다. 반복/different-root hash fixture, query/failure fixture, Worker OutputAsset 누락 회귀도 포함된다. evidence capture는 통합 dependency tree에서 다시 실행했다.

```sh
cd spikes/css-bundler
mise exec -- node --check vite-module-graph-adapter.mjs
mise exec -- node --check vite-graph.config.mjs
mise exec -- node --check vite-module-graph-adapter.test.mjs
mise exec -- env SPINON_GRAPH_EVIDENCE=1 node --test --test-name-pattern='입력 dependency' vite-module-graph-adapter.test.mjs
mise exec -- node --test
```

이 실행은 Vite `8.3.1`/Rolldown `1.2.12`, 한 fixture, macOS arm64 profile에 한정된다. 다른 plugin 조합·toolchain·OS, 전체 CSS/asset graph, full R15 resource join, 제품 번들러 API, OTA 배포 또는 모든 Rspack profile과의 동등성을 증명하지 않는다.
