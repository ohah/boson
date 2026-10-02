import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertAdapterSnapshot } from "./adapter-contract.mjs";
import { assertC02ResourceGraphJoin, createC02ResourceGraphJoin } from "./resource-graph-join.mjs";
import { computeBuildProfileSha256 } from "./module-graph-contract.mjs";
import { assertDisjointBuildPaths } from "./vite-graph.config.mjs";
import { createViteSnapshot } from "./vite-resource-adapter.mjs";
import {
  captureViteResourceGraphJoin,
  VITE_RESOURCE_GRAPH_JOIN_PROFILE,
} from "./vite-resource-graph-join.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixture-resource-join");
let capture;
let fixtureDigestBefore;

test("Vite 한 번의 production build에서 JavaScript 그래프와 CSS 자원을 함께 수집한다", async (t) => {
  fixtureDigestBefore = await hashFixtureTree(fixtureRoot);
  capture = await captureViteResourceGraphJoin({ fixtureRoot });
  t.after(async () => {
    assert.equal(await hashFixtureTree(fixtureRoot), fixtureDigestBefore, "shared fixture를 수정하지 않아야 합니다.");
  });

  const { resourceSnapshot, moduleGraphSnapshot, joinedSnapshot, temporaryBuild } = capture;
  assertAdapterSnapshot(resourceSnapshot);
  assert.equal(resourceSnapshot.build.status, "success");
  assert.equal(moduleGraphSnapshot.build.status, "success");
  assert.equal(moduleGraphSnapshot.outputGraph.status, "complete");
  assert.deepEqual(moduleGraphSnapshot.diagnostics, []);
  assert.equal(resourceSnapshot.build.tool, "vite");
  assert.equal(resourceSnapshot.build.toolVersion, "8.3.1");
  assert.equal(resourceSnapshot.build.mode, "production");
  assert.equal(resourceSnapshot.build.captureId, capture.captureId);
  assert.equal(moduleGraphSnapshot.build.captureId, capture.captureId);
  assert.equal(moduleGraphSnapshot.build.outputProfile, VITE_RESOURCE_GRAPH_JOIN_PROFILE.name);
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.mode, "production");
  assert.deepEqual(resourceSnapshot.build.profile, moduleGraphSnapshot.build.profile);
  assert.equal(resourceSnapshot.build.buildProfileSha256, moduleGraphSnapshot.build.buildProfileSha256);
  assert.equal(resourceSnapshot.build.fixtureSha256, moduleGraphSnapshot.build.fixtureSha256);
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.capture.viteBuildCalls, 1);
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.capture.writeBundleCallCount, 1);
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.runtimeVersions.rolldown, "1.2.12");
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.resolvedViteConfig.build.manifest, true);
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.fixtureRoot, "$FIXTURE_ROOT");
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.outputDir, "$OUTPUT_DIR");
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.resolvedViteConfig.root, "$FIXTURE_ROOT");
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.resolvedViteConfig.build.outDir, "$OUTPUT_DIR");
  assert.equal(moduleGraphSnapshot.build.profile.effectiveOptions.resolvedViteConfig.environment.envDir, "$FIXTURE_ROOT");
  assert.deepEqual(moduleGraphSnapshot.build.profile.effectiveOptions.features, [
    { id: "main", entrySourceKey: "index.js" },
    { id: "lazy-feature", entrySourceKey: "features/lazy.js" },
  ]);
  assert.deepEqual(moduleGraphSnapshot.build.profile.effectiveOptions.outputProfile, VITE_RESOURCE_GRAPH_JOIN_PROFILE);
  assert.deepEqual(
    moduleGraphSnapshot.build.profile.effectiveOptions.resolvedViteConfig.plugins
      .map((plugin) => plugin.name)
      .filter((name) => name.startsWith("spinon-")),
    [
      "spinon-c02-vite-module-graph-fixture",
      "spinon-css-resource-adapter-vite-spike:source",
      "spinon-css-resource-adapter-vite-spike:module-exports",
      "spinon-css-resource-adapter-vite-spike:chunks",
      "spinon-c02-vite-module-graph",
    ],
    "resolved config에서 fixture resolver와 두 adapter의 실제 hook 순서를 확인합니다.",
  );
  assertC02ResourceGraphJoin(joinedSnapshot);

  const resourceJavaScript = resourceSnapshot.resources
    .filter((resource) => resource.kind === "javascript")
    .map(({ id, outputPath, mediaType, bytes, sha256 }) => ({ id, outputPath, mediaType, bytes, sha256 }))
    .sort(byOutputPath);
  const graphJavaScript = moduleGraphSnapshot.outputGraph.resources
    .map(({ id, outputPath, mediaType, bytes, sha256 }) => ({ id, outputPath, mediaType, bytes, sha256 }))
    .sort(byOutputPath);
  assert.deepEqual(resourceJavaScript, graphJavaScript, "JS resource ID와 실제 bytes/digest를 비교합니다.");
  for (const graphChunk of moduleGraphSnapshot.outputGraph.chunks) {
    const resourceChunk = resourceSnapshot.chunks.find((candidate) => candidate.javascriptResourceIds.includes(graphChunk.javascriptResourceId));
    assert.equal(resourceChunk?.kind, graphChunk.kind, `chunk owner 종류가 일치해야 합니다: ${graphChunk.id}`);
  }

  const sourceDependencies = moduleGraphSnapshot.sourceGraph.dependencies;
  assert.ok(sourceDependencies.some((edge) => edge.referrerModuleKey === "index.js"
    && edge.kind === "dynamic" && edge.resolvedModuleKey === "features/lazy.js"));
  assert.ok(sourceDependencies.some((edge) => edge.referrerModuleKey === "features/lazy.js"
    && edge.kind === "dynamic" && edge.resolvedModuleKey === "features/icon.js"));
  assert.ok(moduleGraphSnapshot.sourceGraph.excludedDependencies.some((edge) => edge.referrerModuleKey === "index.js"
    && edge.kind === "static" && edge.targetKind === "stylesheet" && edge.resolvedResourceKey === "styles/app.css"));
  assert.ok(moduleGraphSnapshot.sourceGraph.excludedDependencies.some((edge) => edge.referrerModuleKey === "features/lazy.js"
    && edge.kind === "static" && edge.targetKind === "stylesheet" && edge.resolvedResourceKey === "features/lazy.css"));
  assert.ok(moduleGraphSnapshot.sourceGraph.excludedDependencies.some((edge) => edge.referrerModuleKey === "features/icon.js"
    && edge.kind === "static" && edge.targetKind === "asset" && edge.resolvedResourceKey === "assets/icon.svg"));

  const sourceDynamicEdges = moduleGraphSnapshot.sourceGraph.dependencies.filter((edge) => edge.kind === "dynamic");
  assert.equal(sourceDynamicEdges.length, 2);
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
  assert.ok(appStylesheet?.outputResourceIds.length > 0);
  assert.ok(tokensStylesheet?.outputResourceIds.length > 0);
  assert.ok(lazyStylesheet?.outputResourceIds.length > 0);
  assert.ok(appStylesheet.imports.some((edge) => edge.classification === "local"
    && edge.targetSourcePath === "styles/tokens.css"));
  assert.ok(appStylesheet.outputResourceIds.some((id) => tokensStylesheet.outputResourceIds.includes(id)),
  "번들 CSS에서 @import 원본과 포함된 stylesheet output 연결을 확인합니다.");

  const resourcesById = new Map(resourceSnapshot.resources.map((resource) => [resource.id, resource]));
  const fontEdge = appStylesheet.references.find((edge) => edge.targetSourcePath === "assets/fixture.woff2");
  const backgroundEdge = appStylesheet.references.find((edge) => edge.targetSourcePath === "assets/background.svg");
  const lazyImageEdge = lazyStylesheet.references.find((edge) => edge.targetSourcePath === "assets/lazy.svg");
  assert.equal(resourcesById.get(fontEdge?.targetResourceId)?.kind, "font");
  assert.equal(resourcesById.get(backgroundEdge?.targetResourceId)?.kind, "image");
  assert.equal(resourcesById.get(lazyImageEdge?.targetResourceId)?.kind, "image");
  assert.ok(joinedSnapshot.resourceEdges.some((edge) => edge.kind === "asset-url" && edge.toResourceId === fontEdge.targetResourceId));
  assert.ok(joinedSnapshot.resourceEdges.some((edge) => edge.kind === "asset-url" && edge.toResourceId === backgroundEdge.targetResourceId));
  assert.ok(joinedSnapshot.resourceEdges.some((edge) => edge.kind === "asset-url" && edge.toResourceId === lazyImageEdge.targetResourceId));

  const iconAsset = resourceSnapshot.resources.find((resource) => resource.sourcePath === "assets/icon.svg");
  assert.equal(iconAsset?.kind, "image");
  assert.ok(resourceSnapshot.chunks.some((chunk) => chunk.assetResourceIds.includes(iconAsset.id)));
  assert.ok(joinedSnapshot.chunks.some((chunk) => chunk.assetResourceIds.includes(iconAsset.id)));

  assert.equal(temporaryBuild.fixtureIsolatedFromSource, true);
  assert.equal(temporaryBuild.outputIsSiblingOfFixture, true);
  await assert.rejects(access(temporaryBuild.containerPath), { code: "ENOENT" }, "private temp output은 capture 후 제거해야 합니다.");
  assert.equal(await hashFixtureTree(fixtureRoot), fixtureDigestBefore, "공유 fixture를 수정하거나 덮어쓰지 않아야 합니다.");
});

test("반복 Vite capture는 임시 경로를 profile digest에서 제외하고 resource graph digest를 고정한다", async () => {
  const first = await captureViteResourceGraphJoin({ fixtureRoot });
  const second = await captureViteResourceGraphJoin({ fixtureRoot });

  assert.notEqual(first.captureId, second.captureId, "각 build는 별도 capture ID를 사용합니다.");
  assert.notEqual(first.temporaryBuild.containerPath, second.temporaryBuild.containerPath);
  assert.notEqual(first.temporaryBuild.fixturePath, second.temporaryBuild.fixturePath);
  assert.notEqual(first.temporaryBuild.outputPath, second.temporaryBuild.outputPath);
  assert.equal(first.resourceSnapshot.build.fixtureSha256, second.resourceSnapshot.build.fixtureSha256);
  assert.deepEqual(first.resourceSnapshot.build.profile, second.resourceSnapshot.build.profile);
  assert.equal(first.resourceSnapshot.build.buildProfileSha256, second.resourceSnapshot.build.buildProfileSha256);
  const profileJson = JSON.stringify(first.resourceSnapshot.build.profile);
  assert.equal(profileJson.includes(first.temporaryBuild.containerPath), false);
  assert.equal(profileJson.includes(second.temporaryBuild.containerPath), false);
  assert.deepEqual(resourceGraphShape(first.resourceSnapshot), resourceGraphShape(second.resourceSnapshot));
  assert.equal(resourceGraphDigest(first.resourceSnapshot), resourceGraphDigest(second.resourceSnapshot));
  assert.deepEqual(first.moduleGraphSnapshot.sourceGraph, second.moduleGraphSnapshot.sourceGraph);
  assert.deepEqual(first.moduleGraphSnapshot.outputGraph, second.moduleGraphSnapshot.outputGraph);
  assert.deepEqual(joinedGraphShape(first.joinedSnapshot), joinedGraphShape(second.joinedSnapshot));
});

test("Vite 결합 검증기는 capture·profile·JavaScript bytes 불일치를 거부한다", () => {
  assert.ok(capture, "첫 test가 joined capture를 만들었습니다.");
  const wrongCapture = structuredClone(capture.resourceSnapshot);
  wrongCapture.build.captureId = "00000000-0000-4000-8000-000000000000";
  assert.throws(() => createC02ResourceGraphJoin({
    resourceSnapshot: wrongCapture,
    moduleGraphSnapshot: capture.moduleGraphSnapshot,
  }), (error) => error.code === "C02_JOIN_BUILD_MISMATCH");

  const wrongProfile = structuredClone(capture.moduleGraphSnapshot);
  wrongProfile.build.profile.effectiveOptions.mode = "development";
  wrongProfile.build.buildProfileSha256 = computeBuildProfileSha256(wrongProfile.build.profile);
  assert.throws(() => createC02ResourceGraphJoin({
    resourceSnapshot: capture.resourceSnapshot,
    moduleGraphSnapshot: wrongProfile,
  }), (error) => error.code === "C02_JOIN_BUILD_MISMATCH");

  const changedBytes = structuredClone(capture.resourceSnapshot);
  changedBytes.resources.find((resource) => resource.kind === "javascript").bytes += 1;
  assert.throws(() => createC02ResourceGraphJoin({
    resourceSnapshot: changedBytes,
    moduleGraphSnapshot: capture.moduleGraphSnapshot,
  }), (error) => error.code === "C02_JOIN_JS_RESOURCE_MISMATCH");
});

test("Vite 임시 output 경로 검증은 공유 fixture와 저장소 경로를 거부한다", async () => {
  assert.throws(() => assertDisjointBuildPaths(fixtureRoot, path.join(fixtureRoot, "output")), /fixture\/source root/);
  assert.throws(() => assertDisjointBuildPaths(fixtureRoot, path.join(os.homedir(), ".spinon-vite-join-unsafe-output")), /OS 임시 디렉터리/);

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spinon-vite-safe-path-test-"));
  try {
    const temporaryFixture = path.join(temporaryRoot, "fixture");
    const temporaryOutput = path.join(temporaryRoot, "output");
    await import("node:fs/promises").then(({ cp }) => cp(fixtureRoot, temporaryFixture, { recursive: true }));
    assert.doesNotThrow(() => assertDisjointBuildPaths(temporaryFixture, temporaryOutput));
    await assert.rejects(access(temporaryOutput), { code: "ENOENT" }, "검증은 임시 output을 생성하지 않습니다.");
    assert.equal((await stat(temporaryRoot)).isDirectory(), true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Vite manifest 경로는 정규 상대경로이고 JS chunk 소유자가 유일해야 합니다", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "spinon-vite-manifest-test-"));
  const adapter = { outputChunks: [{ fileName: "assets/main.js", modulePaths: [] }], sources: new Map(), cssModules: new Map() };
  try {
    await assert.rejects(createViteSnapshot({
      adapter,
      manifest: {
        "index.js": { file: "assets/main.js" },
        "duplicate.js": { file: "assets/main.js" },
      },
      outputDir,
      fixtureSha256: "0".repeat(64),
      toolVersion: "8.3.1",
      status: "success",
    }), /manifest JS chunk owner가 중복됩니다/);

    for (const field of ["css", "assets"]) {
      for (const unsafePath of ["../outside.css", "C:/outside.css"]) {
        await assert.rejects(createViteSnapshot({
          adapter: { outputChunks: [], sources: new Map(), cssModules: new Map() },
          manifest: { "index.js": { file: "assets/main.js", [field]: [unsafePath] } },
          outputDir,
          fixtureSha256: "0".repeat(64),
          toolVersion: "8.3.1",
          status: "success",
        }), /안전한 상대 POSIX 경로여야 합니다/);
      }
    }

    await assert.rejects(createViteSnapshot({
      adapter: { outputChunks: [], sources: new Map(), cssModules: new Map() },
      manifest: { "index.js": { file: "assets/main.js", isEntry: "true" } },
      outputDir,
      fixtureSha256: "0".repeat(64),
      toolVersion: "8.3.1",
      status: "success",
    }), /isEntry 값이 boolean이 아닙니다/);

    await mkdir(path.join(outputDir, "assets"), { recursive: true });
    await writeFile(path.join(outputDir, "assets", "main.js"), "export {};\n");
    for (const field of ["css", "assets"]) {
      await assert.rejects(createViteSnapshot({
        adapter: { outputChunks: [{ fileName: "assets/main.js", modulePaths: [] }], sources: new Map(), cssModules: new Map() },
        manifest: { "index.js": { file: "assets/main.js", isEntry: true, [field]: [`assets/missing.${field === "css" ? "css" : "woff2"}`] } },
        outputDir,
        fixtureSha256: "0".repeat(64),
        toolVersion: "8.3.1",
        status: "success",
      }), new RegExp(`Vite manifest ${field === "css" ? "CSS" : "asset"} output이 없거나`));
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("Vite resource adapter는 임시 output 바깥을 가리키는 symlink를 읽지 않습니다", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spinon-vite-output-symlink-test-"));
  const outputDir = path.join(temporaryRoot, "output");
  const outsideFile = path.join(temporaryRoot, "outside.css");
  try {
    await mkdir(path.join(outputDir, "assets"), { recursive: true });
    await writeFile(outsideFile, "body { color: red; }");
    await symlink(outsideFile, path.join(outputDir, "assets", "escaped.css"));
    await assert.rejects(createViteSnapshot({
      adapter: { outputChunks: [], sources: new Map(), cssModules: new Map() },
      manifest: {},
      outputDir,
      fixtureSha256: "0".repeat(64),
      toolVersion: "8.3.1",
      status: "success",
    }), /Vite output symlink는 resource로 읽지 않습니다/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("실패한 Vite build도 private capture container를 정리합니다", async () => {
  const temporaryFixture = await mkdtemp(path.join(os.tmpdir(), "spinon-vite-failed-fixture-"));
  const listContainers = async () => (await readdir(os.tmpdir())).filter((name) => name.startsWith("spinon-vite-c02-join-")).sort();
  try {
    const before = await listContainers();
    await assert.rejects(captureViteResourceGraphJoin({ fixtureRoot: temporaryFixture }), /Vite joined production build가 실패했습니다/);
    assert.deepEqual(await listContainers(), before, "build 실패 후 임시 container가 남지 않아야 합니다.");
  } finally {
    await rm(temporaryFixture, { recursive: true, force: true });
  }
});

function byOutputPath(left, right) {
  return left.outputPath < right.outputPath ? -1 : left.outputPath > right.outputPath ? 1 : 0;
}

function resourceGraphShape(snapshot) {
  return {
    resources: snapshot.resources,
    chunks: snapshot.chunks,
    stylesheets: snapshot.stylesheets,
    cssModules: snapshot.cssModules,
    diagnostics: snapshot.diagnostics,
  };
}

function resourceGraphDigest(snapshot) {
  return createHash("sha256").update(stableJson(resourceGraphShape(snapshot))).digest("hex");
}

function joinedGraphShape(snapshot) {
  return {
    features: snapshot.features,
    chunks: snapshot.chunks,
    resources: snapshot.resources,
    resourceEdges: snapshot.resourceEdges,
    provenance: snapshot.provenance,
    diagnostics: snapshot.diagnostics,
  };
}

function stableJson(value) {
  return JSON.stringify(sortJsonKeys(value));
}

function sortJsonKeys(value) {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJsonKeys(value[key])]));
  }
  return value;
}

async function hashFixtureTree(root) {
  const entries = [];
  for (const relativePath of await listFiles(root)) {
    const bytes = await readFile(path.join(root, ...relativePath.split("/")));
    entries.push({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
