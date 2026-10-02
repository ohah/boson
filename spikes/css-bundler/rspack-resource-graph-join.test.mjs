import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { assertAdapterSnapshot } from "./adapter-contract.mjs";
import { assertC02ResourceGraphJoin, createC02ResourceGraphJoin } from "./resource-graph-join.mjs";
import { computeBuildProfileSha256 } from "./module-graph-contract.mjs";
import { captureRspackFixtureSnapshot } from "./rspack-module-graph-adapter.mjs";
import { createRspackGraphConfig, RSPACK_GRAPH_PROFILE_NAMES } from "./rspack-graph.config.mjs";
import { VITE_GRAPH_FEATURES } from "./vite-graph.config.mjs";
import {
  assertRspackStylesheetSourcesMatchFixture,
  attachStylesheetsToJavaScriptChunks,
  captureRspackResourceGraphJoin,
  RSPACK_RESOURCE_GRAPH_JOIN_FEATURES,
  RSPACK_RESOURCE_GRAPH_JOIN_PROFILE,
} from "./rspack-resource-graph-join.mjs";
import { createRspackBuildProfile } from "./rspack-module-graph-adapter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixture-resource-join");
let capture;
let fixtureBefore;
let temporaryRoot;
let temporaryEntriesBefore;

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spinon-rspack-join-test-"));
  fixtureBefore = await captureRspackFixtureSnapshot(fixtureRoot);
  temporaryEntriesBefore = await readdir(temporaryRoot);
  capture = await captureRspackResourceGraphJoin({ fixtureRoot, temporaryRoot });
});

after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("Rspack 한 번의 production build에서 JS graph와 CSS resource를 함께 capture하고 join한다", async () => {
  const { resourceSnapshot, moduleGraphSnapshot, joinedSnapshot } = capture;

  assert.deepEqual(capture.captureEvidence, { sameCompilationObject: true });
  assert.equal(resourceSnapshot.build.status, "success");
  assert.equal(moduleGraphSnapshot.build.status, "success");
  assert.equal(resourceSnapshot.build.tool, "rspack");
  assert.equal(resourceSnapshot.build.mode, "production");
  assert.equal(resourceSnapshot.build.captureId, capture.captureId);
  assert.equal(moduleGraphSnapshot.build.captureId, capture.captureId);
  assert.equal(moduleGraphSnapshot.build.outputProfile, RSPACK_RESOURCE_GRAPH_JOIN_PROFILE);
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.mode, "production");
  assert.deepEqual(resourceSnapshot.build.profile, moduleGraphSnapshot.build.profile);
  assert.equal(resourceSnapshot.build.buildProfileSha256, moduleGraphSnapshot.build.buildProfileSha256);
  assert.equal(resourceSnapshot.build.fixtureSha256, moduleGraphSnapshot.build.fixtureSha256);
  assert.deepEqual(moduleGraphSnapshot.build.profile.effectiveOptions.entry, { main: "index.js" });
  assert.deepEqual(moduleGraphSnapshot.build.profile.effectiveOptions.features, RSPACK_RESOURCE_GRAPH_JOIN_FEATURES);
  assert.deepEqual(RSPACK_RESOURCE_GRAPH_JOIN_FEATURES, VITE_GRAPH_FEATURES,
    "Rspack과 Vite는 같은 feature id와 source root를 비교해야 합니다.");
  assert.ok(moduleGraphSnapshot.build.profile.configSources.some((source) =>
    source.path === "spikes/css-bundler/resource-graph-join.mjs"));
  assert.ok(moduleGraphSnapshot.build.profile.effectiveOptions.plugins.includes("SpinonRspackModuleGraphAdapter:capture-only"));
  assert.ok(moduleGraphSnapshot.build.profile.effectiveOptions.plugins.includes("SpinonCssResourceAdapterSpike:capture-only"));
  assert.ok(moduleGraphSnapshot.build.profile.effectiveOptions.module.rules.some((rule) =>
    rule.type === "asset/resource" && rule.test === "/\\.(?:svg|png|jpe?g|gif|webp|avif|ico)$/i"));
  assert.equal(moduleGraphSnapshot.outputGraph.status, "complete");
  assert.equal(moduleGraphSnapshot.outputGraph.moduleFormat, "esm");
  assert.deepEqual(moduleGraphSnapshot.diagnostics, []);
  assertC02ResourceGraphJoin(joinedSnapshot);

  const outputChunksById = new Map(moduleGraphSnapshot.outputGraph.chunks.map((chunk) => [chunk.id, chunk]));
  assert.deepEqual(sortFeatureSummaries(moduleGraphSnapshot.features), sortFeatureSummaries(RSPACK_RESOURCE_GRAPH_JOIN_FEATURES));
  for (const [featureId, expectedKind] of [["main", "entry"], ["lazy-feature", "dynamic"]]) {
    const feature = moduleGraphSnapshot.features.find((item) => item.id === featureId);
    const entryChunk = outputChunksById.get(feature.entryChunkId);
    assert.equal(entryChunk.kind, expectedKind, `${feature.id} entry kind`);
    assert.ok(entryChunk.sourceModuleKeys.includes(feature.entrySourceKey));
  }
  assert.deepEqual(sortFeatureSummaries(joinedSnapshot.features), sortFeatureSummaries(RSPACK_RESOURCE_GRAPH_JOIN_FEATURES));

  const resourceJavaScript = resourceSnapshot.resources
    .filter((resource) => resource.kind === "javascript")
    .map(({ id, outputPath, mediaType, bytes, sha256 }) => ({ id, outputPath, mediaType, bytes, sha256 }))
    .sort((left, right) => left.outputPath.localeCompare(right.outputPath));
  const graphJavaScript = moduleGraphSnapshot.outputGraph.resources
    .map(({ id, outputPath, mediaType, bytes, sha256 }) => ({ id, outputPath, mediaType, bytes, sha256 }))
    .sort((left, right) => left.outputPath.localeCompare(right.outputPath));
  assert.deepEqual(resourceJavaScript, graphJavaScript);

  const sourceDependencies = moduleGraphSnapshot.sourceGraph.dependencies;
  assert.ok(sourceDependencies.some((edge) => edge.referrerModuleKey === "index.js"
    && edge.kind === "dynamic" && edge.resolvedModuleKey === "features/lazy.js"));
  assert.ok(sourceDependencies.some((edge) => edge.referrerModuleKey === "features/lazy.js"
    && edge.kind === "dynamic" && edge.resolvedModuleKey === "features/icon.js"));
  assert.ok(moduleGraphSnapshot.sourceGraph.excludedDependencies.some((edge) => edge.referrerModuleKey === "features/icon.js"
    && edge.kind === "static" && edge.targetKind === "asset" && edge.resolvedResourceKey === "assets/icon.svg"));

  const outputChunks = moduleGraphSnapshot.outputGraph.chunks;
  const dynamicEdges = outputChunks.flatMap((chunk) => chunk.dependencies
    .filter((edge) => edge.kind === "dynamic")
    .map((edge) => ({ source: chunk, target: outputChunks.find((candidate) => candidate.id === edge.chunkId) })));
  assert.ok(dynamicEdges.some(({ source, target }) => source.sourceModuleKeys.includes("index.js")
    && target?.sourceModuleKeys.includes("features/lazy.js")));
  assert.ok(dynamicEdges.some(({ source, target }) => source.sourceModuleKeys.includes("features/lazy.js")
    && target?.sourceModuleKeys.includes("features/icon.js")));

  const stylesheetBySource = new Map(resourceSnapshot.stylesheets.map((stylesheet) => [stylesheet.sourcePath, stylesheet]));
  const appStylesheet = stylesheetBySource.get("styles/app.css");
  const tokensStylesheet = stylesheetBySource.get("styles/tokens.css");
  const lazyStylesheet = stylesheetBySource.get("features/lazy.css");
  assert.ok(resourceSnapshot.chunks.some((chunk) => chunk.javascriptResourceIds.length === 0
    && chunk.stylesheetResourceIds.length > 0), "Rspack CSS-only chunk를 별도 관찰해야 합니다.");
  assert.ok(appStylesheet?.outputResourceIds.length > 0);
  assert.ok(tokensStylesheet?.outputResourceIds.length > 0);
  assert.ok(lazyStylesheet?.outputResourceIds.length > 0);
  const graphChunkForFeature = (id) => {
    const feature = moduleGraphSnapshot.features.find((item) => item.id === id);
    return outputChunksById.get(feature.entryChunkId);
  };
  const resourceChunkForGraphChunk = (graphChunk) => resourceSnapshot.chunks.find((chunk) =>
    chunk.javascriptResourceIds.includes(graphChunk.javascriptResourceId));
  const mainResourceChunk = resourceChunkForGraphChunk(graphChunkForFeature("main"));
  const lazyResourceChunk = resourceChunkForGraphChunk(graphChunkForFeature("lazy-feature"));
  assert.ok(appStylesheet.outputResourceIds.some((id) => mainResourceChunk.stylesheetResourceIds.includes(id)));
  assert.ok(lazyStylesheet.outputResourceIds.some((id) => lazyResourceChunk.stylesheetResourceIds.includes(id)));
  assert.ok(appStylesheet.imports.some((edge) => edge.classification === "local"
    && edge.targetSourcePath === "styles/tokens.css"));
  assert.ok(joinedSnapshot.resourceEdges.some((edge) => edge.kind === "stylesheet-import"
    && appStylesheet.outputResourceIds.includes(edge.fromResourceId)
    && tokensStylesheet.outputResourceIds.includes(edge.toResourceId)));

  const resourcesById = new Map(resourceSnapshot.resources.map((resource) => [resource.id, resource]));
  const fontEdge = appStylesheet.references.find((edge) => edge.targetSourcePath === "assets/fixture.woff2");
  const backgroundEdge = appStylesheet.references.find((edge) => edge.targetSourcePath === "assets/background.svg");
  const lazyImageEdge = lazyStylesheet.references.find((edge) => edge.targetSourcePath === "assets/lazy.svg");
  assert.equal(resourcesById.get(fontEdge?.targetResourceId)?.kind, "font");
  assert.equal(resourcesById.get(backgroundEdge?.targetResourceId)?.kind, "image");
  assert.equal(resourcesById.get(lazyImageEdge?.targetResourceId)?.kind, "image");

  const joinedLazyFeature = joinedSnapshot.features.find((feature) => feature.id === "lazy-feature");
  assert.ok(lazyStylesheet.outputResourceIds.some((id) => joinedLazyFeature.resourceIds.includes(id)));
  assert.ok(joinedLazyFeature.resourceIds.includes(resourcesById.get(lazyImageEdge.targetResourceId).id));

  const iconAsset = resourceSnapshot.resources.find((resource) => resource.sourcePath === "assets/icon.svg");
  assert.equal(iconAsset?.kind, "image");
  assert.ok(resourceSnapshot.chunks.some((chunk) => chunk.assetResourceIds.includes(iconAsset.id)));
  assert.doesNotThrow(() => assertRspackStylesheetSourcesMatchFixture(resourceSnapshot.stylesheets, fixtureBefore.fileBytesByPath));

  assert.deepEqual(await readdir(temporaryRoot), temporaryEntriesBefore, "capture 전용 임시 output 디렉터리는 build 후 제거되어야 합니다.");
  assert.equal((await captureRspackFixtureSnapshot(fixtureRoot)).sha256, fixtureBefore.sha256, "공유 fixture 파일을 수정하거나 덮어쓰지 않아야 합니다.");
});

test("captureId와 JavaScript output bytes가 다른 snapshot 조인을 거부한다", () => {
  const wrongCapture = structuredClone(capture.resourceSnapshot);
  wrongCapture.build.captureId = "00000000-0000-4000-8000-000000000000";
  assert.throws(
    () => createC02ResourceGraphJoin({ resourceSnapshot: wrongCapture, moduleGraphSnapshot: capture.moduleGraphSnapshot }),
    (error) => error.code === "C02_JOIN_BUILD_MISMATCH",
  );

  const changedJavaScript = structuredClone(capture.resourceSnapshot);
  changedJavaScript.resources.find((resource) => resource.kind === "javascript").bytes += 1;
  assert.throws(
    () => createC02ResourceGraphJoin({ resourceSnapshot: changedJavaScript, moduleGraphSnapshot: capture.moduleGraphSnapshot }),
    (error) => error.code === "C02_JOIN_JS_RESOURCE_MISMATCH",
  );
});

test("profile digest가 틀린 capture metadata를 resource validator가 거부한다", () => {
  const wrongProfile = structuredClone(capture.moduleGraphSnapshot);
  wrongProfile.build.buildProfileSha256 = "0".repeat(64);
  const wrongResourceProfile = structuredClone(capture.resourceSnapshot);
  wrongResourceProfile.build.buildProfileSha256 = "0".repeat(64);
  assert.throws(() => createC02ResourceGraphJoin({
    resourceSnapshot: wrongResourceProfile,
    moduleGraphSnapshot: wrongProfile,
  }), (error) => error.code === "C02_JOIN_BUILD_MISMATCH");
});

test("joined graph가 orphan runtime resource와 외부 CSS URL을 거부한다", () => {
  const orphaned = structuredClone(capture.joinedSnapshot);
  const orphan = structuredClone(orphaned.resources.find((resource) => resource.kind === "stylesheet"));
  orphan.id = "resource:orphan.css";
  orphan.outputPath = "orphan.css";
  orphaned.resources.push(orphan);
  assert.throws(() => assertC02ResourceGraphJoin(orphaned),
    (error) => error.code === "C02_JOIN_ORPHAN_RESOURCE");

  const externalCss = structuredClone(capture.resourceSnapshot);
  const appStylesheet = externalCss.stylesheets.find((stylesheet) => stylesheet.sourcePath === "styles/app.css");
  const background = appStylesheet.references.find((edge) => edge.targetSourcePath === "assets/background.svg");
  background.classification = "external";
  background.targetSourcePath = null;
  delete background.targetResourceId;
  assert.throws(() => createC02ResourceGraphJoin({
    resourceSnapshot: externalCss,
    moduleGraphSnapshot: capture.moduleGraphSnapshot,
  }), (error) => error.code === "C02_JOIN_EXTERNAL_RESOURCE");
});

test("Rspack CSS module source가 fixture snapshot bytes와 다르거나 fixture 밖이면 거부한다", () => {
  const alteredFixture = new Map(fixtureBefore.fileBytesByPath);
  alteredFixture.set("styles/app.css", Buffer.from(".app { color: red; }\n"));
  assert.throws(
    () => assertRspackStylesheetSourcesMatchFixture(capture.resourceSnapshot.stylesheets, alteredFixture),
    /원본 bytes가 fixture snapshot과 다릅니다: styles\/app\.css/,
  );

  const missingFixtureSource = new Map(fixtureBefore.fileBytesByPath);
  missingFixtureSource.delete("features/lazy.css");
  assert.throws(
    () => assertRspackStylesheetSourcesMatchFixture(capture.resourceSnapshot.stylesheets, missingFixtureSource),
    /stylesheet 입력이 고정 fixture에 없습니다: features\/lazy\.css/,
  );
});

test("0011 stylesheet owner는 번들러 chunk ID가 달라도 JS resource ID로 연결한다", () => {
  const resourceSnapshot = structuredClone(capture.resourceSnapshot);
  resourceSnapshot.chunks = resourceSnapshot.chunks.map((chunk) => ({
    ...chunk,
    id: `resource-adapter:${chunk.id}`,
  }));
  const remappedResourceSnapshot = attachStylesheetsToJavaScriptChunks(resourceSnapshot, capture.moduleGraphSnapshot);
  assertAdapterSnapshot(remappedResourceSnapshot);
  const joinedSnapshot = createC02ResourceGraphJoin({
    resourceSnapshot: remappedResourceSnapshot,
    moduleGraphSnapshot: capture.moduleGraphSnapshot,
  });
  assertC02ResourceGraphJoin(joinedSnapshot);
});

test("두 production capture의 UUID를 제외한 0011·0014·joined graph가 같은 digest를 만든다", async () => {
  const secondCapture = await captureRspackResourceGraphJoin({ fixtureRoot, temporaryRoot });
  assert.notEqual(capture.captureId, secondCapture.captureId);
  assert.equal(capture.moduleGraphSnapshot.build.fixtureSha256, secondCapture.moduleGraphSnapshot.build.fixtureSha256);
  assert.deepEqual(capture.moduleGraphSnapshot.build.profile, secondCapture.moduleGraphSnapshot.build.profile);
  assert.equal(capture.moduleGraphSnapshot.build.buildProfileSha256, secondCapture.moduleGraphSnapshot.build.buildProfileSha256);
  assert.deepEqual(capture.moduleGraphSnapshot.build.profile.effectiveOptions.features, RSPACK_RESOURCE_GRAPH_JOIN_FEATURES);
  assert.deepEqual(RSPACK_RESOURCE_GRAPH_JOIN_FEATURES, VITE_GRAPH_FEATURES);

  const firstResourceGraph = snapshotWithoutCaptureId(capture.resourceSnapshot);
  const secondResourceGraph = snapshotWithoutCaptureId(secondCapture.resourceSnapshot);
  const firstModuleGraph = snapshotWithoutCaptureId(capture.moduleGraphSnapshot);
  const secondModuleGraph = snapshotWithoutCaptureId(secondCapture.moduleGraphSnapshot);
  assert.deepEqual(firstResourceGraph, secondResourceGraph, "0011 resource graph의 captureId 외 필드는 같아야 합니다.");
  assert.equal(stableDigest(firstResourceGraph), stableDigest(secondResourceGraph), "0011 resource graph digest가 같아야 합니다.");
  assert.deepEqual(firstModuleGraph, secondModuleGraph, "0014 source/output graph의 captureId 외 필드는 같아야 합니다.");
  assert.equal(stableDigest(firstModuleGraph), stableDigest(secondModuleGraph), "0014 source/output graph digest가 같아야 합니다.");

  const firstJoined = semanticJoinedGraph(capture, firstResourceGraph, firstModuleGraph);
  const secondJoined = semanticJoinedGraph(secondCapture, secondResourceGraph, secondModuleGraph);
  assert.deepEqual(firstJoined, secondJoined, "joined graph의 captureId와 그로부터 파생된 component digest 외 필드는 같아야 합니다.");
  assert.equal(stableDigest(firstJoined), stableDigest(secondJoined), "UUID를 제외한 정규 joined graph digest가 같아야 합니다.");
  assert.deepEqual(await readdir(temporaryRoot), temporaryEntriesBefore, "반복 capture가 임시 output 디렉터리를 남기지 않아야 합니다.");
});

test("Rspack output profile fingerprint가 임시 output 경로에 의존하지 않는다", async () => {
  const features = RSPACK_RESOURCE_GRAPH_JOIN_FEATURES;
  const makeProfile = async (outputDir) => {
    const graphPlugin = { apply() {} };
    const resourcePlugin = { apply() {} };
    const { profile } = createRspackGraphConfig({
      profile: RSPACK_GRAPH_PROFILE_NAMES.modernModule,
      outputDir,
      fixtureRoot,
      graphPlugin,
      entry: { main: "index.js" },
      preserveModulesRoot: ".",
      additionalPlugins: [resourcePlugin],
      additionalPluginNames: ["SpinonCssResourceAdapterSpike:capture-only"],
      additionalModuleRules: [{ test: /\.(?:svg|png|jpe?g|gif|webp|avif|ico)$/i, type: "asset/resource" }],
    });
    const buildProfile = await createRspackBuildProfile(profile, features, [
      ["spikes/css-bundler/rspack-resource-adapter.mjs", "rspack-resource-adapter.mjs"],
      ["spikes/css-bundler/rspack-resource-graph-join.mjs", "rspack-resource-graph-join.mjs"],
      ["spikes/css-bundler/resource-graph-join.mjs", "resource-graph-join.mjs"],
      ["spikes/css-bundler/adapter-contract.mjs", "adapter-contract.mjs"],
      ["spikes/css-bundler/css-source.mjs", "css-source.mjs"],
    ]);
    return { profile, buildProfile, digest: computeBuildProfileSha256(buildProfile) };
  };
  const first = await makeProfile(path.join(temporaryRoot, "output-a"));
  const second = await makeProfile(path.join(temporaryRoot, "output-b"));
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first.profile).includes(temporaryRoot), false);
  assert.equal(JSON.stringify(first.buildProfile).includes(temporaryRoot), false);
});

test("OS temp 밖의 fixture 또는 프로젝트 경로는 output 생성 전에 차단한다", async () => {
  const projectRoot = path.resolve(here, "../..");
  const fixtureEntriesBefore = await readdir(fixtureRoot);
  const projectEntriesBefore = await readdir(projectRoot);

  await assert.rejects(
    captureRspackResourceGraphJoin({ fixtureRoot, temporaryRoot: fixtureRoot }),
    /OS 임시 디렉터리 내부|보호 경로에서 겹칩니다/,
  );
  await assert.rejects(
    captureRspackResourceGraphJoin({ fixtureRoot, temporaryRoot: projectRoot }),
    /OS 임시 디렉터리 내부|보호 경로에서 겹칩니다/,
  );

  assert.deepEqual(await readdir(fixtureRoot), fixtureEntriesBefore);
  assert.deepEqual(await readdir(projectRoot), projectEntriesBefore);
  assert.equal((await captureRspackFixtureSnapshot(fixtureRoot)).sha256, fixtureBefore.sha256);
});

test("Rspack production compile 실패 시 상세 오류를 보존하고 임시 output을 지운다", async () => {
  const failedFixtureRoot = path.join(temporaryRoot, "fixture-failed-build");
  await cp(fixtureRoot, failedFixtureRoot, { recursive: true, errorOnExist: true, force: false });
  await writeFile(path.join(failedFixtureRoot, "features", "lazy.js"), 'import "./missing.js";\n');
  const temporaryEntriesBeforeBuild = await readdir(temporaryRoot);
  try {
    await assert.rejects(
      captureRspackResourceGraphJoin({ fixtureRoot: failedFixtureRoot, temporaryRoot }),
      /Rspack resource\+graph production build가 실패했습니다[\s\S]*missing\.js/,
    );
    assert.deepEqual(await readdir(temporaryRoot), temporaryEntriesBeforeBuild,
      "실패한 production build의 전용 output container를 정리해야 합니다.");
  } finally {
    await rm(failedFixtureRoot, { recursive: true, force: true });
  }
});

function snapshotWithoutCaptureId(snapshot) {
  const normalized = structuredClone(snapshot);
  delete normalized.build.captureId;
  return normalized;
}

function semanticJoinedGraph(captureResult, resourceGraph, moduleGraph) {
  const joined = snapshotWithoutCaptureId(captureResult.joinedSnapshot);
  // sourceDigests는 전체 입력 snapshot을 포함하므로 capture UUID만 제거한 뒤 다시 계산합니다.
  joined.sourceDigests = {
    moduleGraphSha256: stableDigest(moduleGraph),
    resourceGraphSha256: stableDigest(resourceGraph),
  };
  return joined;
}

function stableDigest(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareStrings).map((key) => [key, sortObjectKeys(value[key])]));
  }
  return value;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortFeatureSummaries(features) {
  return features.map(({ id, entrySourceKey }) => ({ id, entrySourceKey }))
    .sort((left, right) => compareStrings(left.id, right.id));
}
