import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createAdapterSnapshot } from "./adapter-contract.mjs";
import {
  computeBuildProfileSha256,
  computeSourceGraphSha256,
  createModuleGraphSnapshot,
} from "./module-graph-contract.mjs";
import { assertC02ResourceGraphJoin, createC02ResourceGraphJoin } from "./resource-graph-join.mjs";

const captureId = "11111111-1111-4111-8111-111111111111";
const fixtureSha256 = "a".repeat(64);
const profile = {
  configSources: [{ path: "spikes/css-bundler/join.config.mjs", sha256: "b".repeat(64) }],
  effectiveOptions: { mode: "production", format: "esm", entry: { main: "src/main.js" } },
};

function makeSnapshots() {
  const buildProfileSha256 = computeBuildProfileSha256(profile);
  const jsResources = [
    { id: "js:main", logicalId: null, identityStatus: "unproven", kind: "javascript", outputPath: "assets/main.js", mediaType: "text/javascript", bytes: 10, sha256: "1".repeat(64) },
    { id: "js:lazy", logicalId: null, identityStatus: "unproven", kind: "javascript", outputPath: "assets/lazy.js", mediaType: "text/javascript", bytes: 11, sha256: "2".repeat(64) },
  ];
  const sourceGraph = {
    scope: "javascript-module-dependencies",
    status: "complete",
    capture: "unit-fixture",
    moduleCount: 2,
    edgeCount: 1,
    excludedDependencyCount: 2,
    sha256: "0".repeat(64),
    modules: [
      { key: "src/main.js", outputChunkIds: ["module:entry"] },
      { key: "src/lazy.js", outputChunkIds: ["module:lazy"] },
    ],
    dependencies: [{
      referrerModuleKey: "src/main.js",
      kind: "dynamic",
      sourceSpecifier: "./lazy.js",
      resolvedModuleKey: "src/lazy.js",
      external: false,
      source: { file: "src/main.js", line: 1, column: 1 },
    }],
    excludedDependencies: [
      {
        referrerModuleKey: "src/main.js",
        kind: "static",
        sourceSpecifier: "./styles/main.css",
        targetKind: "stylesheet",
        resolvedResourceKey: "styles/main.css",
        source: { file: "src/main.js", line: 2, column: 1 },
      },
      {
        referrerModuleKey: "src/lazy.js",
        kind: "static",
        sourceSpecifier: "./assets/tree-shaken.svg",
        targetKind: "asset",
        resolvedResourceKey: "assets/tree-shaken.svg",
        source: { file: "src/lazy.js", line: 1, column: 1 },
      },
    ],
  };
  sourceGraph.sha256 = computeSourceGraphSha256(sourceGraph);

  const moduleGraphSnapshot = createModuleGraphSnapshot({
    build: {
      tool: "rspack",
      toolVersion: "2.2.7",
      adapterVersion: "0.1.0-spike",
      outputProfile: "esm-chunks",
      status: "success",
      fixtureSha256,
      profile: structuredClone(profile),
      buildProfileSha256,
      captureId,
    },
    sourceGraph,
    features: [{ id: "main", entrySourceKey: "src/main.js", entryChunkId: "module:entry" }],
    outputGraph: {
      status: "complete",
      moduleFormat: "esm",
      resources: jsResources,
      chunks: [
        {
          id: "module:entry",
          logicalId: null,
          identityStatus: "unproven",
          kind: "entry",
          moduleFormat: "esm",
          javascriptResourceId: "js:main",
          sourceModuleKeys: ["src/main.js"],
          dependencies: [{ kind: "dynamic", specifier: "./lazy.js", chunkId: "module:lazy" }],
        },
        {
          id: "module:lazy",
          logicalId: null,
          identityStatus: "unproven",
          kind: "dynamic",
          moduleFormat: "esm",
          javascriptResourceId: "js:lazy",
          sourceModuleKeys: ["src/lazy.js"],
          dependencies: [],
        },
      ],
    },
    diagnostics: [],
  });

  const resourceSnapshot = createAdapterSnapshot({
    build: {
      tool: "rspack",
      toolVersion: "2.2.7",
      adapterVersion: "0.1.0-spike",
      mode: "production",
      status: "success",
      fixtureSha256,
      captureId,
      profile: structuredClone(profile),
      buildProfileSha256,
    },
    resources: [
      { id: "js:main", kind: "javascript", outputPath: "assets/main.js", mediaType: "text/javascript", bytes: 10, sha256: "1".repeat(64), sourcePath: null },
      { id: "js:lazy", kind: "javascript", outputPath: "assets/lazy.js", mediaType: "text/javascript", bytes: 11, sha256: "2".repeat(64), sourcePath: null },
      { id: "css:main", kind: "stylesheet", outputPath: "assets/main.css", mediaType: "text/css", bytes: 20, sha256: "3".repeat(64), sourcePath: null },
      { id: "font:body", kind: "font", outputPath: "assets/body.woff2", mediaType: "font/woff2", bytes: 12, sha256: "4".repeat(64), sourcePath: "assets/body.woff2" },
      { id: "image:background", kind: "image", outputPath: "assets/background.svg", mediaType: "image/svg+xml", bytes: 13, sha256: "5".repeat(64), sourcePath: "assets/background.svg" },
    ],
    chunks: [
      { id: "resource-owner:entry", kind: "entry", javascriptResourceIds: ["js:main"], stylesheetResourceIds: ["css:main"], assetResourceIds: [] },
      { id: "resource-owner:lazy", kind: "dynamic", javascriptResourceIds: ["js:lazy"], stylesheetResourceIds: [], assetResourceIds: [] },
    ],
    stylesheets: [
      {
        id: "stylesheet:styles/main.css",
        sourcePath: "styles/main.css",
        sourceSha256: "6".repeat(64),
        outputResourceIds: ["css:main"],
        imports: [{
          specifier: "./tokens.css",
          classification: "local",
          targetSourcePath: "styles/tokens.css",
          conditions: null,
          source: { file: "styles/main.css", line: 1, column: 9 },
        }],
        references: [
          {
            property: "font-family",
            specifier: "../assets/body.woff2",
            classification: "local",
            resourceKind: "font",
            targetSourcePath: "assets/body.woff2",
            targetResourceId: "font:body",
            source: { file: "styles/main.css", line: 3, column: 15 },
          },
          {
            property: "background-image",
            specifier: "../assets/background.svg",
            classification: "local",
            resourceKind: "image",
            targetSourcePath: "assets/background.svg",
            targetResourceId: "image:background",
            source: { file: "styles/main.css", line: 4, column: 20 },
          },
        ],
      },
      {
        id: "stylesheet:styles/tokens.css",
        sourcePath: "styles/tokens.css",
        sourceSha256: "7".repeat(64),
        outputResourceIds: ["css:main"],
        imports: [],
        references: [],
      },
    ],
    cssModules: [],
    diagnostics: [],
  });
  return { resourceSnapshot, moduleGraphSnapshot };
}

function join(overrides = {}) {
  const snapshots = makeSnapshots();
  return createC02ResourceGraphJoin({ ...snapshots, ...overrides });
}

function expectJoinCode(action, code) {
  assert.throws(action, (error) => error.code === code && error.diagnostic?.code === code);
}

function digestJsonTree(value) {
  return createHash("sha256").update(JSON.stringify(sortObjectKeys(value)), "utf8").digest("hex");
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]));
  }
  return value;
}

test("한 production build 안에서 JS resource ID를 키로 chunk와 stylesheet·CSS 자원을 결합한다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  const joined = createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot });

  assert.deepEqual(joined.contract, { name: "spinon.c02-resource-graph-join", version: "0.1.0-draft" });
  assert.equal(joined.build.mode, "production");
  assert.equal(joined.chunks.find((chunk) => chunk.id === "module:entry").stylesheetResourceIds[0], "css:main");
  assert.notEqual(joined.chunks[0].id, "resource-owner:entry", "번들러 chunk ID는 join key로 사용하지 않는다.");
  assert.deepEqual(joined.resourceEdges.map(({ kind, fromResourceId, toResourceId }) => ({ kind, fromResourceId, toResourceId })), [
    { kind: "asset-url", fromResourceId: "css:main", toResourceId: "image:background" },
    { kind: "asset-url", fromResourceId: "css:main", toResourceId: "font:body" },
  ]);
  assert.deepEqual(joined.features[0].chunkIds, ["module:entry", "module:lazy"]);
  assert.deepEqual(joined.features[0].resourceIds, ["css:main", "font:body", "image:background", "js:lazy", "js:main"]);
  assert.deepEqual(joined.provenance.excludedDependencies, moduleGraphSnapshot.sourceGraph.excludedDependencies);
  assert.deepEqual(joined.provenance.stylesheets[0].imports, resourceSnapshot.stylesheets[0].imports);
  assert.deepEqual(joined.provenance.stylesheets[0].references, resourceSnapshot.stylesheets[0].references);
  assert.equal(joined.resourceEdges.some((edge) => edge.kind === "stylesheet-import"), false,
    "같은 outputResourceId로 합쳐진 local @import는 edge 없이 provenance로 남긴다.");
  assert.equal(joined.resources.some((resource) => resource.sourcePath === "assets/tree-shaken.svg"), false,
    "출력 소유자가 없는 asset 입력 edge는 provenance만 남긴다.");
  assert.equal(assertC02ResourceGraphJoin(joined), true);
});

test("capture·tool·fixture·profile 또는 production mode가 다르면 join을 거부한다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  const changedCapture = structuredClone(resourceSnapshot);
  changedCapture.build.captureId = "22222222-2222-4222-8222-222222222222";
  expectJoinCode(() => createC02ResourceGraphJoin({ resourceSnapshot: changedCapture, moduleGraphSnapshot }), "C02_JOIN_BUILD_MISMATCH");

  const changedMode = structuredClone(moduleGraphSnapshot);
  changedMode.build.profile.effectiveOptions.mode = "development";
  changedMode.build.buildProfileSha256 = computeBuildProfileSha256(changedMode.build.profile);
  expectJoinCode(() => createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot: changedMode }), "C02_JOIN_BUILD_MISMATCH");
});

test("JSON의 own __proto__ 값과 profile digest를 보존하고 accessor 인자를 실행하지 않는다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  const specialProfile = structuredClone(profile);
  Object.defineProperty(specialProfile.effectiveOptions, "__proto__", {
    value: { marker: "kept-as-data" },
    enumerable: true,
  });
  const profileDigest = computeBuildProfileSha256(specialProfile);
  for (const snapshot of [resourceSnapshot, moduleGraphSnapshot]) {
    snapshot.build.profile = structuredClone(specialProfile);
    snapshot.build.buildProfileSha256 = profileDigest;
  }
  const joined = createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot });
  assert.equal(Object.hasOwn(joined.build.profile.effectiveOptions, "__proto__"), true);
  assert.deepEqual(joined.build.profile.effectiveOptions.__proto__, { marker: "kept-as-data" });
  assert.equal(joined.build.buildProfileSha256, profileDigest);
  assert.equal(joined.sourceDigests.resourceGraphSha256, digestJsonTree(resourceSnapshot));
  assert.equal(joined.sourceDigests.moduleGraphSha256, digestJsonTree(moduleGraphSnapshot));

  let getterCalled = false;
  const accessorInput = {};
  Object.defineProperty(accessorInput, "resourceSnapshot", {
    enumerable: true,
    get() {
      getterCalled = true;
      return resourceSnapshot;
    },
  });
  Object.defineProperty(accessorInput, "moduleGraphSnapshot", { enumerable: true, value: moduleGraphSnapshot });
  expectJoinCode(() => createC02ResourceGraphJoin(accessorInput), "C02_JOIN_GRAPH_INCOMPLETE");
  assert.equal(getterCalled, false);
});

test("경로의 빈 segment, 상위 경로, 역슬래시와 Windows drive 모양을 거부한다", () => {
  const valid = join();
  for (const outputPath of ["assets//main.js", "assets/", "assets/../main.js", "assets\\main.js", "assets/\nmain.js", "C:/assets/main.js", "C:main.js", "assets/C:main.js"]) {
    const tampered = structuredClone(valid);
    tampered.resources.find((resource) => resource.id === "js:main").outputPath = outputPath;
    expectJoinCode(() => assertC02ResourceGraphJoin(tampered), "C02_JOIN_GRAPH_INCOMPLETE");
  }
  const driveSource = structuredClone(valid);
  driveSource.provenance.stylesheets[0].sourcePath = "C:/styles/main.css";
  expectJoinCode(() => assertC02ResourceGraphJoin(driveSource), "C02_JOIN_GRAPH_INCOMPLETE");
});

test("failed·incomplete 0014 capture와 오류 진단은 join할 수 없다", () => {
  const errorDiagnostic = {
    severity: "error",
    code: "C02_GRAPH_CAPTURE_INCOMPLETE",
    stage: "capture",
    message: "unit failure",
    source: null,
    referrerModuleKey: null,
    specifier: null,
  };
  const failed = makeSnapshots();
  failed.moduleGraphSnapshot.build.status = "failed";
  failed.moduleGraphSnapshot.diagnostics = [errorDiagnostic];
  expectJoinCode(() => createC02ResourceGraphJoin(failed), "C02_JOIN_GRAPH_INCOMPLETE");

  const incompleteSource = makeSnapshots();
  incompleteSource.moduleGraphSnapshot.build.status = "failed";
  incompleteSource.moduleGraphSnapshot.sourceGraph.status = "incomplete";
  incompleteSource.moduleGraphSnapshot.diagnostics = [errorDiagnostic];
  expectJoinCode(() => createC02ResourceGraphJoin(incompleteSource), "C02_JOIN_GRAPH_INCOMPLETE");

  const incompleteOutput = makeSnapshots();
  incompleteOutput.moduleGraphSnapshot.build.status = "failed";
  incompleteOutput.moduleGraphSnapshot.outputGraph.status = "incomplete";
  incompleteOutput.moduleGraphSnapshot.diagnostics = [errorDiagnostic];
  expectJoinCode(() => createC02ResourceGraphJoin(incompleteOutput), "C02_JOIN_GRAPH_INCOMPLETE");
});

test("failed 0011 resource build와 error diagnostic가 있으면 join을 거부한다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  resourceSnapshot.build.status = "failed";
  resourceSnapshot.diagnostics = [{
    severity: "error",
    code: "CSS_RESOURCE_NOT_FOUND",
    message: "unit failure",
    source: { file: "styles/main.css", line: 1, column: 1 },
  }];
  expectJoinCode(() => createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot }), "C02_JOIN_GRAPH_INCOMPLETE");
});

test("독립 join validator는 비어 있는 성공 feature·chunk·resource 그래프를 거부한다", () => {
  for (const field of ["features", "chunks", "resources"]) {
    const tampered = structuredClone(join());
    tampered[field] = [];
    expectJoinCode(() => assertC02ResourceGraphJoin(tampered), "C02_JOIN_GRAPH_INCOMPLETE");
  }
});

test("JavaScript output resource 집합과 파일 지문이 정확히 같아야 한다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  const changed = structuredClone(resourceSnapshot);
  changed.resources.find((resource) => resource.id === "js:main").bytes += 1;
  expectJoinCode(() => createC02ResourceGraphJoin({ resourceSnapshot: changed, moduleGraphSnapshot }), "C02_JOIN_JS_RESOURCE_MISMATCH");
});

test("chunk 연결은 ID 문자열이 아닌 JavaScript resource ID로 유일해야 한다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  resourceSnapshot.chunks[1].javascriptResourceIds.push("js:main");
  expectJoinCode(() => createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot }), "C02_JOIN_JS_RESOURCE_MISMATCH");
});

test("한 0011 owner chunk에 여러 JavaScript resource가 있어도 각 resource ID 매핑은 유일하다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  resourceSnapshot.chunks = [{
    id: "resource-owner:combined",
    kind: "entry",
    javascriptResourceIds: ["js:main", "js:lazy"],
    stylesheetResourceIds: ["css:main"],
    assetResourceIds: [],
  }];
  const joined = createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot });
  assert.deepEqual(joined.chunks.map((chunk) => chunk.stylesheetResourceIds), [["css:main"], ["css:main"]]);
});

test("서로 다른 unique @import output은 stylesheet edge가 되고 여러 output 후보는 실패한다", () => {
  const separate = makeSnapshots();
  separate.resourceSnapshot.resources.push({
    id: "css:tokens",
    kind: "stylesheet",
    outputPath: "assets/tokens.css",
    mediaType: "text/css",
    bytes: 7,
    sha256: "d".repeat(64),
    sourcePath: null,
  });
  separate.resourceSnapshot.chunks[0].stylesheetResourceIds.push("css:tokens");
  separate.resourceSnapshot.stylesheets[1].outputResourceIds = ["css:tokens"];
  const joined = createC02ResourceGraphJoin(separate);
  assert.ok(joined.resourceEdges.some((edge) => edge.kind === "stylesheet-import"
    && edge.fromResourceId === "css:main" && edge.toResourceId === "css:tokens"));

  const ambiguous = makeSnapshots();
  ambiguous.resourceSnapshot.resources.push({
    id: "css:tokens-copy",
    kind: "stylesheet",
    outputPath: "assets/tokens-copy.css",
    mediaType: "text/css",
    bytes: 7,
    sha256: "e".repeat(64),
    sourcePath: null,
  });
  ambiguous.resourceSnapshot.chunks[0].stylesheetResourceIds.push("css:tokens-copy");
  ambiguous.resourceSnapshot.stylesheets[1].outputResourceIds.push("css:tokens-copy");
  expectJoinCode(() => createC02ResourceGraphJoin(ambiguous), "C02_JOIN_TARGET_AMBIGUOUS");
});

test("active CSS URL의 같은 sourcePath에 복수 output resource가 있으면 모호성으로 실패한다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  resourceSnapshot.resources.push({
    id: "image:background-copy",
    kind: "image",
    outputPath: "assets/background-copy.svg",
    mediaType: "image/svg+xml",
    bytes: 13,
    sha256: "8".repeat(64),
    sourcePath: "assets/background.svg",
  });
  expectJoinCode(() => createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot }), "C02_JOIN_TARGET_AMBIGUOUS");
});

test("active CSS external reference와 unsupported other target은 fail-closed 처리한다", () => {
  const external = makeSnapshots();
  external.resourceSnapshot.stylesheets[0].references[0] = {
    property: "font-family",
    specifier: "https://cdn.example.invalid/body.woff2",
    classification: "external",
    resourceKind: "font",
    targetSourcePath: null,
    targetResourceId: null,
    source: { file: "styles/main.css", line: 3, column: 15 },
  };
  expectJoinCode(() => createC02ResourceGraphJoin(external), "C02_JOIN_EXTERNAL_RESOURCE");

  const unsupported = makeSnapshots();
  unsupported.resourceSnapshot.resources.find((resource) => resource.id === "image:background").kind = "other";
  expectJoinCode(() => createC02ResourceGraphJoin(unsupported), "C02_JOIN_RESOURCE_KIND_UNSUPPORTED");
});

test("chunk이 other asset을 소유하면 실패하지만 소유되지 않은 other output은 runtime에서 제외한다", () => {
  const linked = makeSnapshots();
  linked.resourceSnapshot.resources.push({
    id: "other:payload",
    kind: "other",
    outputPath: "assets/payload.bin",
    mediaType: "application/octet-stream",
    bytes: 1,
    sha256: "9".repeat(64),
    sourcePath: "assets/payload.bin",
  });
  linked.resourceSnapshot.chunks[1].assetResourceIds.push("other:payload");
  expectJoinCode(() => createC02ResourceGraphJoin(linked), "C02_JOIN_RESOURCE_KIND_UNSUPPORTED");

  const unowned = makeSnapshots();
  unowned.resourceSnapshot.resources.push({
    id: "other:debug",
    kind: "other",
    outputPath: "assets/debug.bin",
    mediaType: "application/octet-stream",
    bytes: 1,
    sha256: "a".repeat(64),
    sourcePath: "assets/debug.bin",
  });
  const joined = createC02ResourceGraphJoin(unowned);
  assert.equal(joined.resources.some((resource) => resource.id === "other:debug"), false);
});

test("활성 stylesheet excluded edge는 원본 source row와 referrer chunk의 stylesheet ownership을 교차 검증한다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  resourceSnapshot.chunks[0].stylesheetResourceIds = [];
  resourceSnapshot.chunks[1].stylesheetResourceIds = ["css:main"];
  expectJoinCode(() => createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot }), "C02_JOIN_RESOURCE_MISSING");

  const missingSource = makeSnapshots();
  missingSource.resourceSnapshot.stylesheets = missingSource.resourceSnapshot.stylesheets.filter((sheet) => sheet.sourcePath !== "styles/main.css");
  expectJoinCode(() => createC02ResourceGraphJoin(missingSource), "C02_JOIN_RESOURCE_MISSING");
});

test("orphan runtime resource와 손상한 reachability closure를 거부한다", () => {
  const { resourceSnapshot, moduleGraphSnapshot } = makeSnapshots();
  resourceSnapshot.resources.push({
    id: "font:orphan",
    kind: "font",
    outputPath: "assets/orphan.woff2",
    mediaType: "font/woff2",
    bytes: 3,
    sha256: "c".repeat(64),
    sourcePath: "assets/orphan.woff2",
  });
  expectJoinCode(() => createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot }), "C02_JOIN_ORPHAN_RESOURCE");

  const valid = join();
  valid.features[0].resourceIds = ["js:main"];
  expectJoinCode(() => assertC02ResourceGraphJoin(valid), "C02_JOIN_GRAPH_INCOMPLETE");
});
