import assert from "node:assert/strict";
import test from "node:test";
import {
  assertModuleGraphSnapshot,
  assertR15JavaScriptGraphInput,
  computeBuildProfileSha256,
  computeSourceGraphSha256,
  createModuleGraphSnapshot,
  parseEmittedEsm,
  resolveLocalOutputPath,
  resolveEmittedChunkTarget,
} from "./module-graph-contract.mjs";

const entryPath = "assets/main.js";
const lazyPath = "assets/lazy-ab12.js";

function validSnapshot(overrides = {}) {
  const snapshot = {
    contract: { name: "spinon.c02-bundler-module-graph", version: "0.1.0-draft" },
    build: {
      tool: "vite",
      toolVersion: "8.3.1",
      adapterVersion: "0.1.0-spike",
      outputProfile: "esm-chunks",
      status: "success",
      fixtureSha256: "1".repeat(64),
      profile: {
        configSources: [{ path: "spikes/css-bundler/vite-graph.config.mjs", sha256: "2".repeat(64) }],
        effectiveOptions: { entryPoints: { main: "src/main.js" }, format: "esm" },
      },
      buildProfileSha256: "",
    },
    sourceGraph: {
      scope: "javascript-module-dependencies",
      status: "complete",
      capture: "fixture-module-graph",
      moduleCount: 2,
      edgeCount: 1,
      excludedDependencyCount: 0,
      sha256: "3".repeat(64),
      modules: [
        { key: "src/main.js", outputChunkIds: ["chunk:entry"] },
        { key: "src/lazy.js", outputChunkIds: ["chunk:lazy"] },
      ],
      dependencies: [
        {
          referrerModuleKey: "src/main.js",
          kind: "dynamic",
          sourceSpecifier: "./lazy.js",
          resolvedModuleKey: "src/lazy.js",
          external: false,
          source: { file: "src/main.js", line: 1, column: 1 },
        },
      ],
      excludedDependencies: [],
    },
    features: [{ id: "main", entrySourceKey: "src/main.js", entryChunkId: "chunk:entry" }],
    outputGraph: {
      status: "complete",
      moduleFormat: "esm",
      resources: [
        { id: "resource:assets/main.js", logicalId: "logical:main-js", identityStatus: "stable", kind: "javascript", outputPath: entryPath, mediaType: "text/javascript", bytes: 30, sha256: "4".repeat(64) },
        { id: "resource:assets/lazy-ab12.js", logicalId: null, identityStatus: "unproven", kind: "javascript", outputPath: lazyPath, mediaType: "text/javascript", bytes: 18, sha256: "5".repeat(64) },
      ],
      chunks: [
        {
          id: "chunk:entry",
          logicalId: "logical:main",
          identityStatus: "stable",
          kind: "entry",
          moduleFormat: "esm",
          javascriptResourceId: "resource:assets/main.js",
          sourceModuleKeys: ["src/main.js"],
          dependencies: [{ kind: "dynamic", specifier: "./lazy-ab12.js", chunkId: "chunk:lazy" }],
        },
        {
          id: "chunk:lazy",
          logicalId: "logical:lazy",
          identityStatus: "stable",
          kind: "dynamic",
          moduleFormat: "esm",
          javascriptResourceId: "resource:assets/lazy-ab12.js",
          sourceModuleKeys: ["src/lazy.js"],
          dependencies: [],
        },
      ],
    },
    diagnostics: [],
    ...overrides,
  };
  snapshot.build.buildProfileSha256 = computeBuildProfileSha256(snapshot.build.profile);
  refreshSourceDigest(snapshot);
  return snapshot;
}

function refreshSourceDigest(snapshot) {
  snapshot.sourceGraph.sha256 = computeSourceGraphSha256(snapshot.sourceGraph);
}

test("공통 module graph contract 상수는 adapter에서 변경할 수 없다", async () => {
  const contractModule = await import("./module-graph-contract.mjs");
  assert.equal(Object.isFrozen(contractModule.MODULE_GRAPH_CONTRACT), true);
  assert.throws(() => { contractModule.MODULE_GRAPH_CONTRACT.version = "mutated"; }, TypeError);
});

test("정상 그래프의 edge와 자원 참조를 정규화한다", () => {
  const snapshot = createModuleGraphSnapshot(validSnapshot());
  assert.deepEqual(snapshot.outputGraph.chunks.map((chunk) => chunk.id), ["chunk:entry", "chunk:lazy"]);
  assert.equal(snapshot.outputGraph.chunks[0].dependencies[0].specifier, "./lazy-ab12.js");
  assert.deepEqual(snapshot.outputGraph.resources.map((resource) => resource.outputPath), [lazyPath, entryPath]);
});

test("같은 kind·specifier·target emitted edge는 한 번만 남긴다", () => {
  const graph = validSnapshot();
  graph.outputGraph.chunks[0].dependencies.push({ kind: "dynamic", specifier: "./lazy-ab12.js", chunkId: "chunk:lazy" });
  const snapshot = createModuleGraphSnapshot(graph);
  assert.equal(snapshot.outputGraph.chunks[0].dependencies.length, 1);
});

test("중복 emitted edge를 합치기 전에 각 원소의 닫힌 schema를 검사한다", () => {
  for (const malformedFirst of [true, false]) {
    const graph = validSnapshot();
    const edge = graph.outputGraph.chunks[0].dependencies[0];
    const malformed = { ...edge, unexpected: true };
    graph.outputGraph.chunks[0].dependencies = malformedFirst ? [malformed, edge] : [edge, malformed];
    assert.throws(() => createModuleGraphSnapshot(graph), /output dependency에 계약 외 필드가 있습니다/);
  }
});

test("snapshot 복사 전에 accessor·순환·비 JSON 객체를 거부한다", () => {
  const graph = validSnapshot();
  let getterWasCalled = false;
  Object.defineProperty(graph, "build", {
    enumerable: true,
    get() {
      getterWasCalled = true;
      return validSnapshot().build;
    },
  });
  assert.throws(() => createModuleGraphSnapshot(graph), /snapshot은 accessor 또는 비열거 필드를 포함할 수 없습니다/);
  assert.equal(getterWasCalled, false);
  const cyclic = validSnapshot();
  cyclic.debug = cyclic;
  assert.throws(() => createModuleGraphSnapshot(cyclic), /snapshot은 순환 참조를 포함할 수 없습니다/);
  const nonJson = validSnapshot();
  nonJson.build.profile.effectiveOptions.runtimeValue = new Date();
  assert.throws(() => createModuleGraphSnapshot(nonJson), /snapshot은 일반 JSON 객체와 배열만 포함할 수 있습니다/);
});

test("독립 snapshot 검증과 R15 gate는 배열 accessor를 실행하지 않는다", () => {
  for (const validate of [assertModuleGraphSnapshot, assertR15JavaScriptGraphInput]) {
    const graph = validSnapshot();
    const feature = graph.features[0];
    const features = [];
    features.length = 1;
    let getterWasCalled = false;
    Object.defineProperty(features, "0", {
      enumerable: true,
      get() {
        getterWasCalled = true;
        return feature;
      },
    });
    graph.features = features;

    assert.throws(() => validate(graph), /snapshot은 accessor 또는 비열거 필드를 포함할 수 없습니다/);
    assert.equal(getterWasCalled, false);
  }
});

test("source graph의 static·dynamic 같은 요청은 target이 같으면 보존한다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.dependencies.push({
    ...graph.sourceGraph.dependencies[0],
    kind: "static",
    source: { file: "src/main.js", line: 2, column: 1 },
  });
  graph.sourceGraph.edgeCount = 2;
  refreshSourceDigest(graph);
  const snapshot = createModuleGraphSnapshot(graph);
  assert.equal(snapshot.sourceGraph.dependencies.length, 2);
});

test("emitted static·dynamic 같은 specifier의 target 충돌은 거부한다", () => {
  const graph = validSnapshot();
  graph.outputGraph.chunks[0].dependencies.push({ kind: "static", specifier: "./lazy-ab12.js", chunkId: "chunk:entry" });
  assert.throws(() => createModuleGraphSnapshot(graph), /static\/dynamic emitted target 충돌/);
});

test("source module의 복수 출력 청크 소속을 보존한다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.modules[0].outputChunkIds.push("chunk:lazy");
  graph.outputGraph.chunks[1].sourceModuleKeys.push("src/main.js");
  refreshSourceDigest(graph);
  const snapshot = createModuleGraphSnapshot(graph);
  assert.deepEqual(snapshot.sourceGraph.modules.find((module) => module.key === "src/main.js").outputChunkIds, ["chunk:entry", "chunk:lazy"]);
  assert.deepEqual(snapshot.outputGraph.chunks[1].sourceModuleKeys, ["src/lazy.js", "src/main.js"]);
});

test("순환 emitted graph는 validator의 재귀 없이 허용한다", () => {
  const graph = validSnapshot();
  graph.outputGraph.chunks[1].dependencies.push({ kind: "static", specifier: "./main.js", chunkId: "chunk:entry" });
  const snapshot = createModuleGraphSnapshot(graph);
  assert.equal(snapshot.outputGraph.chunks[1].dependencies[0].chunkId, "chunk:entry");
});

test("CSS·asset 입력 edge는 JS graph edge와 구분한다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.excludedDependencyCount = 1;
  graph.sourceGraph.excludedDependencies.push({
    referrerModuleKey: "src/main.js",
    kind: "static",
    sourceSpecifier: "./screen.css",
    targetKind: "stylesheet",
    resolvedResourceKey: "src/screen.css",
    source: { file: "src/main.js", line: 3, column: 1 },
  });
  refreshSourceDigest(graph);
  assert.equal(createModuleGraphSnapshot(graph).sourceGraph.excludedDependencies[0].targetKind, "stylesheet");
});

test("미분류 non-JavaScript dependency는 거부한다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.excludedDependencyCount = 1;
  graph.sourceGraph.excludedDependencies.push({
    referrerModuleKey: "src/main.js",
    kind: "static",
    sourceSpecifier: "./unknown.bin",
    targetKind: "unknown",
    resolvedResourceKey: "src/unknown.bin",
    source: null,
  });
  assert.throws(() => createModuleGraphSnapshot(graph), /분류할 수 없는 non-JavaScript dependency/);
});

test("excluded resource key는 정규화된 상대 키만 허용한다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.excludedDependencies.push({
    referrerModuleKey: "src/main.js",
    kind: "static",
    sourceSpecifier: "./screen.css",
    targetKind: "stylesheet",
    resolvedResourceKey: "../outside.css",
    source: null,
  });
  graph.sourceGraph.excludedDependencyCount = 1;
  assert.throws(() => createModuleGraphSnapshot(graph), /excluded resolvedResourceKey가 정규화되지 않았거나 입력 루트 밖/);
});

test("성공 build의 source module·chunk membership가 서로 맞아야 한다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.modules[1].outputChunkIds = [];
  refreshSourceDigest(graph);
  assert.throws(() => assertModuleGraphSnapshot(graph), /source module과 output chunk 소속이 다릅니다/);
});

test("실패 snapshot은 불완전 상태와 오류 진단을 보존한다", () => {
  const graph = validSnapshot();
  graph.build.status = "failed";
  graph.outputGraph.status = "incomplete";
  graph.outputGraph.moduleFormat = "other";
  graph.outputGraph.chunks[0].moduleFormat = "other";
  graph.diagnostics = [{
    severity: "error",
    code: "C02_GRAPH_OUTPUT_NOT_ESM",
    stage: "output-parse",
    message: "최종 청크가 ESM 형식이 아닙니다.",
    source: null,
    referrerModuleKey: null,
    specifier: null,
  }];
  assert.doesNotThrow(() => createModuleGraphSnapshot(graph));
});

test("실패 snapshot에도 최소 하나의 error diagnostic가 필요하다", () => {
  const graph = validSnapshot();
  graph.build.status = "failed";
  graph.sourceGraph.status = "incomplete";
  graph.outputGraph.status = "incomplete";
  graph.diagnostics = [];
  assert.throws(() => createModuleGraphSnapshot(graph), /실패 build에 error diagnostic가 없습니다/);
});

test("blocking 진단은 warning으로 낮춰 성공 snapshot을 통과할 수 없다", () => {
  const graph = validSnapshot({ diagnostics: [{
    severity: "warning",
    code: "C02_GRAPH_EXTERNAL_IMPORT",
    stage: "source",
    message: "외부 import는 성공 graph를 차단해야 합니다.",
    source: null,
    referrerModuleKey: "src/main.js",
    specifier: "react",
  }] });
  assert.throws(() => createModuleGraphSnapshot(graph), /blocking diagnostic는 error severity여야 합니다/);
});

test("검증되지 않은 chunk identity는 null logical ID만 허용한다", () => {
  const graph = validSnapshot();
  graph.outputGraph.chunks[0].logicalId = "logical:main";
  graph.outputGraph.chunks[0].identityStatus = "unproven";
  assert.throws(() => createModuleGraphSnapshot(graph), /logicalId와 identityStatus가 모순/);
});

test("정규 source graph digest는 배열 순서와 위치 객체 삽입 순서에 좌우되지 않는다", () => {
  const graph = validSnapshot();
  const reordered = structuredClone(graph.sourceGraph);
  reordered.modules.reverse();
  reordered.modules[1].outputChunkIds.reverse();
  reordered.dependencies[0].source = { column: 1, file: "src/main.js", line: 1 };
  assert.equal(computeSourceGraphSha256(graph.sourceGraph), computeSourceGraphSha256(reordered));
});

test("source module 정렬은 UTF-16이 아니라 Unicode 코드 포인트 순서를 따른다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.modules.push(
    { key: "\u{10000}.js", outputChunkIds: ["chunk:lazy"] },
    { key: "\uE000.js", outputChunkIds: ["chunk:lazy"] },
  );
  graph.sourceGraph.moduleCount = graph.sourceGraph.modules.length;
  graph.sourceGraph.edgeCount = graph.sourceGraph.dependencies.length;
  graph.outputGraph.chunks[1].sourceModuleKeys.push("\u{10000}.js", "\uE000.js");
  refreshSourceDigest(graph);

  const snapshot = createModuleGraphSnapshot(graph);
  assert.deepEqual(snapshot.sourceGraph.modules.slice(2).map((module) => module.key), ["\uE000.js", "\u{10000}.js"]);
});

test("export된 source graph digest 함수도 malformed graph를 거부한다", () => {
  assert.throws(() => computeSourceGraphSha256({
    scope: "javascript-module-dependencies",
    modules: [{ key: "src/main.js" }],
    dependencies: [],
    excludedDependencies: [],
  }), /outputChunkIds 배열이 필요합니다/);

  const dangling = validSnapshot();
  dangling.sourceGraph.dependencies[0].resolvedModuleKey = "src/missing.js";
  assert.throws(() => computeSourceGraphSha256(dangling.sourceGraph), /없는 resolved source module/);

  const untrackedMetadata = validSnapshot().sourceGraph;
  untrackedMetadata.privatePath = "/private/worktree";
  assert.throws(() => computeSourceGraphSha256(untrackedMetadata), /sourceGraph에 계약 외 필드가 있습니다/);
});

test("독립 digest 함수는 accessor가 있는 입력을 읽지 않는다", () => {
  const graph = validSnapshot();
  let sourceGetterWasCalled = false;
  const sourceGraph = { ...graph.sourceGraph };
  Object.defineProperty(sourceGraph, "scope", {
    enumerable: true,
    get() {
      sourceGetterWasCalled = true;
      return "javascript-module-dependencies";
    },
  });
  assert.throws(() => computeSourceGraphSha256(sourceGraph), /snapshot은 accessor 또는 비열거 필드를 포함할 수 없습니다/);
  assert.equal(sourceGetterWasCalled, false);

  let profileGetterWasCalled = false;
  const profile = { ...graph.build.profile };
  Object.defineProperty(profile, "effectiveOptions", {
    enumerable: true,
    get() {
      profileGetterWasCalled = true;
      return { format: "esm" };
    },
  });
  assert.throws(() => computeBuildProfileSha256(profile), /snapshot은 accessor 또는 비열거 필드를 포함할 수 없습니다/);
  assert.equal(profileGetterWasCalled, false);
});

test("source location의 계약 외 속성은 digest나 snapshot에 숨겨지지 않는다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.dependencies[0].source.debugPath = "/private/worktree";
  assert.throws(() => computeSourceGraphSha256(graph.sourceGraph), /source 위치에 계약 외 필드/);
  assert.throws(() => createModuleGraphSnapshot(graph), /source 위치에 계약 외 필드/);

  const hidden = validSnapshot();
  Object.defineProperty(hidden.sourceGraph.dependencies[0].source, "privatePath", { value: "/private/worktree" });
  assert.throws(() => createModuleGraphSnapshot(hidden), /snapshot은 accessor 또는 비열거 필드를 포함할 수 없습니다/);

  const symbol = validSnapshot();
  symbol.outputGraph.chunks[0].dependencies[0][Symbol("adapter")] = "hidden";
  assert.throws(() => createModuleGraphSnapshot(symbol), /snapshot은 symbol 필드를 포함할 수 없습니다/);
});

test("source 위치 줄·열은 안전한 정수 범위를 벗어나지 않는다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.dependencies[0].source.line = 1e100;
  assert.throws(() => computeSourceGraphSha256(graph.sourceGraph), /source line이 잘못되었습니다/);
  assert.throws(() => assertModuleGraphSnapshot(graph), /source line이 잘못되었습니다/);

  const invalidColumn = validSnapshot();
  invalidColumn.sourceGraph.dependencies[0].source.column = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => computeSourceGraphSha256(invalidColumn.sourceGraph), /source column이 잘못되었습니다/);
  assert.throws(() => assertModuleGraphSnapshot(invalidColumn), /source column이 잘못되었습니다/);
});

test("source graph digest가 내용과 다르면 snapshot을 거부한다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.dependencies[0].sourceSpecifier = "./tampered.js";
  assert.throws(() => createModuleGraphSnapshot(graph), /sourceGraph.sha256가 정규화 graph 내용과 다릅니다/);
});

test("snapshot 계약에 없는 필드는 digest 밖의 정보를 몰래 보존하지 않는다", () => {
  const graph = validSnapshot();
  graph.build.platform = "android";
  assert.throws(() => createModuleGraphSnapshot(graph), /계약 외 필드/);

  const edgeGraph = validSnapshot();
  edgeGraph.outputGraph.chunks[0].dependencies[0].collectorHint = "not-contractual";
  assert.throws(() => createModuleGraphSnapshot(edgeGraph), /계약 외 필드/);
});

test("contract 생략은 draft 기본값을 쓰지만 명시적 null은 거부한다", () => {
  const withoutContract = validSnapshot();
  delete withoutContract.contract;
  assert.equal(createModuleGraphSnapshot(withoutContract).contract.version, "0.1.0-draft");

  const explicitNull = validSnapshot();
  explicitNull.contract = null;
  assert.throws(() => createModuleGraphSnapshot(explicitNull), /contract.name이 올바르지 않습니다/);
});

test("build profile digest는 객체 키와 config source 순서에 좌우되지 않는다", () => {
  const graph = validSnapshot();
  const reordered = structuredClone(graph.build.profile);
  reordered.configSources.reverse();
  reordered.effectiveOptions = { format: "esm", entryPoints: { main: "src/main.js" } };
  assert.equal(computeBuildProfileSha256(graph.build.profile), computeBuildProfileSha256(reordered));
});

test("build profile 변경이나 JSON이 아닌 값은 digest 검증에서 거부한다", () => {
  const graph = validSnapshot();
  graph.build.profile.effectiveOptions.format = "iife";
  assert.throws(() => createModuleGraphSnapshot(graph), /buildProfileSha256가 정규 profile 내용과 다릅니다/);

  const cyclic = { option: "esm" };
  cyclic.self = cyclic;
  assert.throws(() => computeBuildProfileSha256({ configSources: [{ path: "config.mjs", sha256: "1".repeat(64) }], effectiveOptions: cyclic }), /순환 참조/);
  assert.throws(() => computeBuildProfileSha256({ configSources: [{ path: "config.mjs", sha256: "1".repeat(64) }], effectiveOptions: { option: 1.5 } }), /안전한 정수/);
});

test("build profile 배열은 sparse index 또는 사용자 속성으로 빈 배열 digest와 충돌하지 않는다", () => {
  const sparse = [];
  sparse.length = 1;
  sparse.extra = "숨은 값";
  const profile = {
    configSources: [{ path: "spikes/css-bundler/vite-graph.config.mjs", sha256: "2".repeat(64) }],
    effectiveOptions: { values: sparse },
  };
  assert.throws(() => computeBuildProfileSha256(profile), /배열은 빈 항목이나 추가 속성을 가질 수 없습니다/);
});

test("build profile에 기록한 설정 파일 digest 변경도 snapshot을 거부한다", () => {
  const graph = validSnapshot();
  graph.build.profile.configSources[0].sha256 = "6".repeat(64);
  assert.throws(() => createModuleGraphSnapshot(graph), /buildProfileSha256가 정규 profile 내용과 다릅니다/);
});

test("build profile digest의 입력 파일 경로와 중복은 검증한다", () => {
  const profile = {
    configSources: [
      { path: "../config.mjs", sha256: "1".repeat(64) },
      { path: "../config.mjs", sha256: "2".repeat(64) },
    ],
    effectiveOptions: { format: "esm" },
  };
  assert.throws(() => computeBuildProfileSha256(profile), /출력 루트 밖|중복 build profile config source/);
});

test("정규화된 source module key만 허용한다", () => {
  for (const key of ["../outside.js", "src/../outside.js", "src//main.js", "src/./main.js", "src\\main.js", "src/\0main.js"]) {
    const graph = validSnapshot();
    graph.sourceGraph.modules[0].key = key;
    graph.sourceGraph.dependencies[0].referrerModuleKey = key;
    graph.sourceGraph.dependencies[0].source.file = key;
    assert.throws(() => createModuleGraphSnapshot(graph), /정규화되지 않았거나 입력 루트 밖|절대 경로 또는 비정상 키/);
  }
});

test("source module의 중복 output chunk membership를 조용히 제거하지 않는다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.modules[0].outputChunkIds.push("chunk:entry");
  assert.throws(() => createModuleGraphSnapshot(graph), /중복 output chunk ID/);
});

test("stable logical ID는 비어 있거나 서로 중복될 수 없다", () => {
  const empty = validSnapshot();
  empty.outputGraph.chunks[0].logicalId = "";
  assert.throws(() => createModuleGraphSnapshot(empty), /stable logicalId가 비었습니다/);

  const duplicate = validSnapshot();
  duplicate.outputGraph.chunks[1].logicalId = "logical:main";
  assert.throws(() => createModuleGraphSnapshot(duplicate), /중복 stable logicalId/);
});

test("resource byte 수는 정확히 표현 가능한 안전 정수여야 한다", () => {
  const graph = validSnapshot();
  graph.outputGraph.resources[0].bytes = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => createModuleGraphSnapshot(graph), /잘못된 output byte 수/);

  const boundary = validSnapshot();
  boundary.outputGraph.resources[0].bytes = Number.MAX_SAFE_INTEGER;
  assert.doesNotThrow(() => createModuleGraphSnapshot(boundary));
});

test("resource stable ID도 검증하고 미증명 ID는 R15 영향 범위 fallback을 요구한다", () => {
  const graph = validSnapshot();
  const gate = assertR15JavaScriptGraphInput(graph);
  assert.equal(gate.requiresAppWideImpactFallback, true);
  assert.equal(gate.requiresResourceGraphJoin, true);

  graph.outputGraph.resources[1].logicalId = "logical:lazy-js";
  graph.outputGraph.resources[1].identityStatus = "stable";
  assert.equal(assertR15JavaScriptGraphInput(graph).requiresAppWideImpactFallback, false);

  graph.outputGraph.resources[1].logicalId = "logical:main-js";
  assert.throws(() => createModuleGraphSnapshot(graph), /중복 stable resource logicalId/);
});

test("R15 JavaScript graph 입력 gate는 실패 snapshot을 거부한다", () => {
  const graph = validSnapshot();
  graph.build.status = "failed";
  graph.sourceGraph.status = "incomplete";
  graph.outputGraph.status = "incomplete";
  graph.diagnostics = [{
    severity: "error",
    code: "C02_GRAPH_CAPTURE_INCOMPLETE",
    stage: "source-capture",
    message: "fixture graph capture가 완전하지 않습니다.",
    source: null,
    referrerModuleKey: null,
    specifier: null,
  }];
  assert.throws(() => assertR15JavaScriptGraphInput(graph), /R15 JavaScript graph 입력은 성공 build여야 합니다/);
});

test("미해결 stylesheet·asset은 성공 graph가 될 수 없고 해결된 edge는 자원 graph join을 요구한다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.excludedDependencies = [{
    referrerModuleKey: "src/main.js",
    kind: "static",
    sourceSpecifier: "./theme.css",
    targetKind: "stylesheet",
    resolvedResourceKey: null,
    source: { file: "src/main.js", line: 2, column: 1 },
  }];
  graph.sourceGraph.excludedDependencyCount = 1;
  refreshSourceDigest(graph);
  assert.throws(() => createModuleGraphSnapshot(graph), /성공 build에 미해결 stylesheet 또는 asset dependency/);

  graph.sourceGraph.excludedDependencies[0].resolvedResourceKey = "src/theme.css";
  refreshSourceDigest(graph);
  const accepted = createModuleGraphSnapshot(graph);
  assert.equal(assertR15JavaScriptGraphInput(accepted).requiresResourceGraphJoin, true);
});

test("성공 snapshot은 모든 JavaScript resource와 chunk를 일대일로 참조한다", () => {
  const graph = validSnapshot();
  graph.outputGraph.chunks[0].dependencies = [];
  graph.outputGraph.chunks[1].javascriptResourceId = "resource:assets/main.js";
  assert.throws(() => createModuleGraphSnapshot(graph), /chunk의 JavaScript resource가 없습니다|chunk가 참조하지 않는 JavaScript resource/);
});

test("최종 emitted specifier가 실제 target chunk resource 경로와 일치해야 한다", () => {
  const graph = validSnapshot();
  graph.outputGraph.chunks[0].dependencies[0].specifier = "./main.js";
  assert.throws(() => createModuleGraphSnapshot(graph), /emitted specifier와 output target이 일치하지 않습니다/);
});

test("명시된 feature entry chunk는 entry 또는 dynamic kind일 수 있다", () => {
  const graph = validSnapshot();
  graph.features.push({ id: "lazy-feature", entrySourceKey: "src/lazy.js", entryChunkId: "chunk:lazy" });
  assert.doesNotThrow(() => createModuleGraphSnapshot(graph));

  graph.outputGraph.chunks[1].kind = "shared";
  assert.throws(() => createModuleGraphSnapshot(graph), /feature entry chunk은 entry 또는 dynamic kind이어야 합니다/);
});

test("모든 성공 output chunk는 기능 entry에서 도달 가능해야 한다", () => {
  const graph = validSnapshot();
  graph.outputGraph.chunks[0].dependencies = [];
  assert.throws(() => createModuleGraphSnapshot(graph), /도달할 수 없는 output chunk/);
});

test("성공 source graph는 external dependency를 허용하지 않는다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.dependencies[0].external = true;
  refreshSourceDigest(graph);
  graph.outputGraph.chunks[0].dependencies = [];
  assert.throws(() => createModuleGraphSnapshot(graph), /external 또는 미해결 source dependency/);
});

test("feature entry는 지정한 source module을 실제로 포함한 chunk여야 한다", () => {
  const graph = validSnapshot();
  graph.features[0].entryChunkId = "chunk:lazy";
  assert.throws(() => createModuleGraphSnapshot(graph), /feature entry source와 chunk 대응이 다릅니다/);
});

test("최종 JS AST에서 static·re-export·literal dynamic import를 구분한다", () => {
  const result = parseEmittedEsm({
    fileName: entryPath,
    code: [
      'import "./static.js";',
      'export { value } from "./shared.js";',
      'export * from "./all.js";',
      'async function load() { return import("./lazy.js"); }',
      'const sample = "import(\\\"./not-an-edge.js\\\")";',
      '// import("./comment.js")',
    ].join("\n"),
  });
  assert.equal(result.status, "success");
  assert.deepEqual(result.imports.map(({ kind, specifier }) => `${kind}:${specifier}`), [
    "static:./static.js",
    "static:./shared.js",
    "static:./all.js",
    "dynamic:./lazy.js",
  ]);
  assert.equal(result.imports[3].source.line, 4);
});

test("계산형 dynamic import는 실패 진단을 만든다", () => {
  const result = parseEmittedEsm({ fileName: entryPath, code: "export function load(name) { return import(name); }" });
  assert.equal(result.status, "failed");
  assert.equal(result.diagnostics[0].code, "C02_GRAPH_UNSUPPORTED_IMPORT");
});

test("import attributes와 dynamic import 옵션은 성공 graph에서 거부한다", () => {
  const staticResult = parseEmittedEsm({
    fileName: entryPath,
    code: 'import data from "./data.json" with { type: "json" };',
  });
  assert.equal(staticResult.status, "failed");
  assert.equal(staticResult.diagnostics[0].code, "C02_GRAPH_UNSUPPORTED_IMPORT");

  const dynamicResult = parseEmittedEsm({
    fileName: entryPath,
    code: 'import("./data.json", { with: { type: "json" } });',
  });
  assert.equal(dynamicResult.status, "failed");
  assert.equal(dynamicResult.diagnostics[0].code, "C02_GRAPH_UNSUPPORTED_IMPORT");
});

test("파서가 지원하지 않는 module syntax도 성공으로 오인하지 않는다", () => {
  const result = parseEmittedEsm({
    fileName: entryPath,
    code: 'import data from "./data.json" assert { type: "json" };',
  });
  assert.equal(result.status, "failed");
  assert.equal(result.diagnostics[0].code, "C02_GRAPH_OUTPUT_PARSE_FAILED");
});

test("파싱할 수 없는 emitted module은 ESM parse 실패로 닫는다", () => {
  const result = parseEmittedEsm({ fileName: entryPath, code: "export const = ;" });
  assert.equal(result.status, "failed");
  assert.equal(result.diagnostics[0].code, "C02_GRAPH_OUTPUT_PARSE_FAILED");
});

test("최종 emitted AST parser의 파일명은 빌드 상대 경로여야 한다", () => {
  assert.throws(() => parseEmittedEsm({ fileName: "/tmp/spinon/main.js", code: "export {};" }), /출력 루트 밖|상대 경로가 잘못되었습니다/);
  assert.throws(() => parseEmittedEsm({ fileName: "C:/outside.js", code: "export {};" }), /Windows drive path/);
});

test("알려지지 않은 diagnostic code는 계약 snapshot에 들어갈 수 없다", () => {
  const graph = validSnapshot();
  graph.diagnostics = [{
    severity: "warning",
    code: "C02_GRAPH_TYPO",
    stage: "source-capture",
    message: "unknown diagnostic",
    source: null,
    referrerModuleKey: null,
    specifier: null,
  }];
  assert.throws(() => createModuleGraphSnapshot(graph), /계약에 없는 diagnostic code/);
});

test("상대 emitted specifier를 안전하게 자원 경로로 해석한다", () => {
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "../shared/a%20b.js" }), "shared/a b.js");
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "../../../outside.js" }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "https://example.invalid/a.js" }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "./bad%2.js" }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "./%2e%2e/%2e%2e/outside.js" }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "./nested%2Fmodule.js" }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "./lazy/.." }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "./lazy/." }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "./lazy/" }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: "../entry.js", specifier: "./lazy.js" }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "./asset.js?rev=1#module" }), null);
  assert.equal(resolveLocalOutputPath({ referrerPath: entryPath, specifier: "./asset.js#module" }), null);
});

test("공개 parser와 경로 resolver는 accessor 입력을 평가하지 않는다", () => {
  const options = {
    code: 'import "./lazy.js";',
    fileName: "assets/main.js",
    referrerPath: "assets/main.js",
    specifier: "./lazy.js",
    chunks: [],
    resources: [],
  };
  for (const resolve of [parseEmittedEsm, resolveLocalOutputPath, resolveEmittedChunkTarget]) {
    let getterWasCalled = false;
    const input = { ...options };
    Object.defineProperty(input, "specifier", {
      enumerable: true,
      get() {
        getterWasCalled = true;
        return "./lazy.js";
      },
    });
    assert.throws(() => resolve(input), /snapshot은 accessor 또는 비열거 필드를 포함할 수 없습니다/);
    assert.equal(getterWasCalled, false);
  }

  let parserGetterWasCalled = false;
  const parserInput = { fileName: "assets/main.js" };
  Object.defineProperty(parserInput, "code", {
    enumerable: true,
    get() {
      parserGetterWasCalled = true;
      return 'import "./lazy.js";';
    },
  });
  assert.throws(() => parseEmittedEsm(parserInput), /snapshot은 accessor 또는 비열거 필드를 포함할 수 없습니다/);
  assert.equal(parserGetterWasCalled, false);
});

test("emitted literal specifier를 실제 JS resource와 output chunk에 연결한다", () => {
  const graph = validSnapshot();
  assert.deepEqual(resolveEmittedChunkTarget({
    referrerPath: entryPath,
    specifier: "./lazy-ab12.js",
    chunks: graph.outputGraph.chunks,
    resources: graph.outputGraph.resources,
  }), { status: "resolved", outputPath: lazyPath, chunkId: "chunk:lazy" });
  assert.deepEqual(resolveEmittedChunkTarget({
    referrerPath: entryPath,
    specifier: "react",
    chunks: graph.outputGraph.chunks,
    resources: graph.outputGraph.resources,
  }), { status: "unresolved", outputPath: null, chunkId: null });

  const duplicateResource = { ...graph.outputGraph.resources[1], id: "resource:duplicate", logicalId: "logical:duplicate" };
  assert.deepEqual(resolveEmittedChunkTarget({
    referrerPath: entryPath,
    specifier: "./lazy-ab12.js",
    chunks: [
      ...graph.outputGraph.chunks,
      { ...graph.outputGraph.chunks[1], id: "chunk:duplicate", javascriptResourceId: duplicateResource.id },
    ],
    resources: [...graph.outputGraph.resources, duplicateResource],
  }), { status: "ambiguous", outputPath: lazyPath, chunkId: null });
});

test("emitted target resolver는 ID가 빠진 resource·chunk를 성공 매핑에서 제외하지 않는다", () => {
  assert.throws(() => resolveEmittedChunkTarget({
    referrerPath: entryPath,
    specifier: "./lazy-ab12.js",
    resources: [{ id: "resource:lazy", kind: "javascript", outputPath: lazyPath }],
    chunks: [{ javascriptResourceId: "resource:lazy" }],
  }), /chunk에는 id와 javascriptResourceId가 필요합니다/);

  assert.throws(() => resolveEmittedChunkTarget({
    referrerPath: entryPath,
    specifier: "./lazy-ab12.js",
    resources: [{ kind: "javascript", outputPath: lazyPath }],
    chunks: [{ id: "chunk:lazy", javascriptResourceId: "resource:lazy" }],
  }), /resource에는 id·kind·outputPath가 필요합니다/);

  assert.throws(() => resolveEmittedChunkTarget({
    referrerPath: entryPath,
    specifier: "./lazy-ab12.js",
    resources: [
      { id: "resource:lazy", kind: "javascript", outputPath: lazyPath },
      { id: "resource:lazy", kind: "stylesheet", outputPath: "assets/lazy.css" },
    ],
    chunks: [{ id: "chunk:lazy", javascriptResourceId: "resource:lazy" }],
  }), /resource id가 중복되었습니다/);

  assert.throws(() => resolveEmittedChunkTarget({
    referrerPath: entryPath,
    specifier: "./lazy-ab12.js",
    resources: [{ id: "resource:lazy", kind: "javascript", outputPath: lazyPath }],
    chunks: [
      { id: "chunk:lazy", javascriptResourceId: "resource:lazy" },
      { id: "chunk:lazy", javascriptResourceId: "resource:other" },
    ],
  }), /chunk id가 중복되었습니다/);
});

test("URL 정규화상 디렉터리인 emitted specifier는 같은 문자열 경로 자원에 연결하지 않는다", () => {
  for (const specifier of ["./lazy/..", "./lazy/."]) {
    assert.deepEqual(resolveEmittedChunkTarget({
      referrerPath: "assets/main.js",
      specifier,
      chunks: [{ id: "chunk:directory", javascriptResourceId: "resource:directory" }],
      resources: [{ id: "resource:directory", kind: "javascript", outputPath: specifier.endsWith("..") ? "assets" : "assets/lazy" }],
    }), { status: "unresolved", outputPath: null, chunkId: null });
  }
});

test("자원 절대 경로와 traversal은 거부한다", () => {
  const graph = validSnapshot();
  graph.outputGraph.resources[0].outputPath = "../outside.js";
  assert.throws(() => createModuleGraphSnapshot(graph), /출력 루트 밖/);

  const directoryPath = validSnapshot();
  directoryPath.outputGraph.resources[0].outputPath = "assets/";
  assert.throws(() => createModuleGraphSnapshot(directoryPath), /정규화되지 않았습니다/);
});

test("외부 source import와 실패한 output edge는 성공 graph로 승격하지 않는다", () => {
  const graph = validSnapshot();
  graph.sourceGraph.dependencies[0].external = true;
  graph.sourceGraph.dependencies[0].resolvedModuleKey = null;
  refreshSourceDigest(graph);
  graph.outputGraph.chunks[0].dependencies[0].chunkId = null;
  assert.throws(() => createModuleGraphSnapshot(graph), /성공 build에 target 없는 emitted dependency/);
});
