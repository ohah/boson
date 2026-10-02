import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rspack from "@rspack/core";
import { assertAdapterSnapshot, createAdapterSnapshot } from "./adapter-contract.mjs";
import { createC02ResourceGraphJoin, assertC02ResourceGraphJoin } from "./resource-graph-join.mjs";
import {
  assertR15JavaScriptGraphInput,
  computeBuildProfileSha256,
  createModuleGraphSnapshot,
} from "./module-graph-contract.mjs";
import {
  assertOutputDirectoryDoesNotOverlapFixture,
  captureRspackFixtureSnapshot,
  createRspackBuildProfile,
  createRspackModuleGraphPlugin,
  createRspackModuleGraphSnapshot,
  rspackVersion,
  runRspackCompiler,
} from "./rspack-module-graph-adapter.mjs";
import { createRspackSnapshot, createRspackResourceAdapter } from "./rspack-resource-adapter.mjs";
import { createRspackGraphConfig, RSPACK_GRAPH_PROFILE_NAMES } from "./rspack-graph.config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RSPACK_RESOURCE_GRAPH_JOIN_PROFILE = RSPACK_GRAPH_PROFILE_NAMES.modernModule;
export const RSPACK_RESOURCE_GRAPH_JOIN_FEATURES = Object.freeze([
  Object.freeze({ id: "main", entrySourceKey: "index.js" }),
  Object.freeze({ id: "lazy-feature", entrySourceKey: "features/lazy.js" }),
]);
const FIXTURE_NAME = "fixture-resource-join";

export async function captureRspackResourceGraphJoin({
  fixtureRoot = path.join(here, FIXTURE_NAME),
  temporaryRoot = os.tmpdir(),
} = {}) {
  const canonicalFixtureRoot = await realpath(fixtureRoot);
  const fixtureBefore = await captureRspackFixtureSnapshot(canonicalFixtureRoot);
  const temporaryRootMetadata = await stat(temporaryRoot);
  if (!temporaryRootMetadata.isDirectory()) throw new Error("temporaryRoot는 기존 디렉터리여야 합니다.");
  const canonicalTemporaryRoot = await realpath(temporaryRoot);
  await assertOutputDirectoryDoesNotOverlapFixture({
    fixtureRoot: canonicalFixtureRoot,
    outputDir: path.join(canonicalTemporaryRoot, `spinon-rspack-c02-join-preflight-${randomUUID()}`),
  });
  const outputContainer = await mkdtemp(path.join(canonicalTemporaryRoot, "spinon-rspack-c02-join-"));

  try {
    const outputDir = path.join(outputContainer, "output");
    await assertOutputDirectoryDoesNotOverlapFixture({ fixtureRoot: canonicalFixtureRoot, outputDir });

    const captureId = randomUUID();
    const features = RSPACK_RESOURCE_GRAPH_JOIN_FEATURES;
    const supportedFeatureEntrypoints = [
      { ...features[0], chunkKind: "entry" },
      { ...features[1], chunkKind: "dynamic" },
    ];
    const graphCaptureState = { value: null };
    const graphPlugin = createRspackModuleGraphPlugin({
      fixtureRoot: canonicalFixtureRoot,
      captureState: graphCaptureState,
      fixtureSourceByPath: fixtureBefore.fileBytesByPath,
    });
    const resourceAdapter = createRspackResourceAdapter({ fixtureRoot: canonicalFixtureRoot });
    const { config, profile: profileFingerprint } = createRspackGraphConfig({
      profile: RSPACK_RESOURCE_GRAPH_JOIN_PROFILE,
      outputDir,
      fixtureRoot: canonicalFixtureRoot,
      graphPlugin,
      entry: { main: "index.js" },
      preserveModulesRoot: ".",
      additionalPlugins: [resourceAdapter.plugin],
      additionalPluginNames: ["SpinonCssResourceAdapterSpike:capture-only"],
      additionalModuleRules: [{
        test: /\.(?:svg|png|jpe?g|gif|webp|avif|ico)$/i,
        type: "asset/resource",
      }],
    });
    const featuresAndVersions = await Promise.all([
      rspackVersion(),
      createRspackBuildProfile(profileFingerprint, features, [
        ["spikes/css-bundler/rspack-resource-adapter.mjs", "rspack-resource-adapter.mjs"],
        ["spikes/css-bundler/rspack-resource-graph-join.mjs", "rspack-resource-graph-join.mjs"],
        ["spikes/css-bundler/resource-graph-join.mjs", "resource-graph-join.mjs"],
        ["spikes/css-bundler/adapter-contract.mjs", "adapter-contract.mjs"],
        ["spikes/css-bundler/css-source.mjs", "css-source.mjs"],
      ]),
    ]);
    const [toolVersion, buildProfile] = featuresAndVersions;
    const buildProfileSha256 = computeBuildProfileSha256(buildProfile);

    const buildResult = await runRspackCompiler(config);
    if (buildResult.hasErrors) {
      const messages = (buildResult.json.errors ?? []).map((error) => error.message).filter(Boolean);
      throw new Error(`Rspack resource+graph production build가 실패했습니다.${messages.length ? `\n${messages.join("\n")}` : ""}`);
    }
    if (!graphCaptureState.valueCompilation
      || graphCaptureState.valueCompilation !== graphCaptureState.compilation
      || graphCaptureState.valueCompilation !== resourceAdapter.captureState.compilation) {
      throw new Error("Rspack graph와 CSS resource collector가 같은 compilation을 관찰하지 않았습니다.");
    }
    if (!graphCaptureState.value) throw new Error("Rspack graph collector가 같은 compilation에서 capture하지 않았습니다.");
    const compilationGraph = graphCaptureState.value;
    const fixtureAfter = await captureRspackFixtureSnapshot(canonicalFixtureRoot);
    if (fixtureAfter.sha256 !== fixtureBefore.sha256) {
      throw new Error("Rspack capture 도중 fixture가 변경되어 build provenance를 확정할 수 없습니다.");
    }

    const moduleGraphDraft = await createRspackModuleGraphSnapshot({
      stats: buildResult.json,
      buildHasErrors: buildResult.hasErrors,
      compilationGraph,
      fixtureRoot: canonicalFixtureRoot,
      outputDir,
      profile: profileFingerprint.name,
      buildProfile,
      features,
      supportedFeatureEntrypoints,
      toolVersion,
      fixtureSha256: fixtureBefore.sha256,
      buildProfileSha256,
      captureId,
    });
    const moduleGraphSnapshot = createModuleGraphSnapshot(moduleGraphDraft);
    if (moduleGraphSnapshot.build.status === "success") assertR15JavaScriptGraphInput(moduleGraphSnapshot);

    const rawResourceSnapshot = await createRspackSnapshot({
      stats: buildResult.json,
      outputDir,
      fixtureRoot: canonicalFixtureRoot,
      fixtureSha256: fixtureBefore.sha256,
      toolVersion,
      cssModuleChunks: resourceAdapter.cssModuleChunks,
      cssModuleSources: resourceAdapter.cssModuleSources,
      cssModuleOutputPaths: resourceAdapter.cssModuleOutputPaths,
      useRawChunkIds: true,
      status: "success",
      captureMetadata: { captureId, profile: buildProfile, buildProfileSha256 },
    });
    assertRspackStylesheetSourcesMatchFixture(rawResourceSnapshot.stylesheets, fixtureBefore.fileBytesByPath);
    const resourceSnapshot = attachStylesheetsToJavaScriptChunks(rawResourceSnapshot, moduleGraphSnapshot);
    assertAdapterSnapshot(resourceSnapshot);

    const joinedSnapshot = createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot });
    assertC02ResourceGraphJoin(joinedSnapshot);
    return {
      captureId,
      resourceSnapshot,
      moduleGraphSnapshot,
      joinedSnapshot,
      captureEvidence: { sameCompilationObject: true },
    };
  } finally {
    await rm(outputContainer, { recursive: true, force: true });
  }
}

export function assertRspackStylesheetSourcesMatchFixture(stylesheets, fixtureSourceByPath) {
  if (!Array.isArray(stylesheets) || !(fixtureSourceByPath instanceof Map)) {
    throw new Error("Rspack CSS provenance 검증에 stylesheet 배열과 fixture source map이 필요합니다.");
  }
  for (const stylesheet of stylesheets) {
    const fixtureBytes = fixtureSourceByPath.get(stylesheet.sourcePath);
    if (!Buffer.isBuffer(fixtureBytes)) {
      throw new Error(`Rspack stylesheet 입력이 고정 fixture에 없습니다: ${stylesheet.sourcePath}`);
    }
    const expectedSha256 = createHash("sha256").update(fixtureBytes).digest("hex");
    if (stylesheet.sourceSha256 !== expectedSha256) {
      throw new Error(`Rspack stylesheet 원본 bytes가 fixture snapshot과 다릅니다: ${stylesheet.sourcePath}`);
    }
  }
}

export function attachStylesheetsToJavaScriptChunks(resourceSnapshot, moduleGraphSnapshot) {
  const stylesheetsBySourcePath = new Map(resourceSnapshot.stylesheets
    .map((stylesheet) => [stylesheet.sourcePath, stylesheet]));
  const sourceModulesByKey = new Map(moduleGraphSnapshot.sourceGraph.modules
    .map((module) => [module.key, module]));
  const graphChunksById = new Map(moduleGraphSnapshot.outputGraph.chunks.map((chunk) => [chunk.id, chunk]));
  const resourceChunksByJavaScriptId = new Map();
  for (const resourceChunk of resourceSnapshot.chunks) {
    for (const javascriptResourceId of resourceChunk.javascriptResourceIds) {
      if (resourceChunksByJavaScriptId.has(javascriptResourceId)) {
        throw new Error(`Rspack JavaScript resource의 0011 chunk owner가 중복됩니다: ${javascriptResourceId}`);
      }
      resourceChunksByJavaScriptId.set(javascriptResourceId, resourceChunk);
    }
  }
  const stylesheetIdsByChunk = new Map();

  for (const dependency of moduleGraphSnapshot.sourceGraph.excludedDependencies) {
    if (dependency.targetKind !== "stylesheet") continue;
    const sourceModule = sourceModulesByKey.get(dependency.referrerModuleKey);
    const stylesheet = stylesheetsBySourcePath.get(dependency.resolvedResourceKey);
    if (!sourceModule || !stylesheet || sourceModule.outputChunkIds.length === 0 || stylesheet.outputResourceIds.length === 0) continue;
    for (const graphChunkId of sourceModule.outputChunkIds) {
      const graphChunk = graphChunksById.get(graphChunkId);
      if (!graphChunk) {
        throw new Error(`Rspack stylesheet referrer가 없는 0014 output chunk를 가리킵니다: ${dependency.referrerModuleKey} -> ${graphChunkId}`);
      }
      const ownerChunk = resourceChunksByJavaScriptId.get(graphChunk.javascriptResourceId);
      if (!ownerChunk || ownerChunk.javascriptResourceIds.length !== 1) {
        throw new Error(`Rspack stylesheet owner를 JavaScript resource ID로 단일 연결하지 못했습니다: ${dependency.referrerModuleKey} -> ${graphChunk.javascriptResourceId}`);
      }
      const outputIds = stylesheetIdsByChunk.get(ownerChunk.id) ?? new Set(ownerChunk.stylesheetResourceIds);
      for (const resourceId of stylesheet.outputResourceIds) outputIds.add(resourceId);
      stylesheetIdsByChunk.set(ownerChunk.id, outputIds);
    }
  }

  return createAdapterSnapshot({
    ...resourceSnapshot,
    chunks: resourceSnapshot.chunks.map((chunk) => ({
      ...chunk,
      stylesheetResourceIds: [...(stylesheetIdsByChunk.get(chunk.id) ?? chunk.stylesheetResourceIds)],
    })),
  });
}
