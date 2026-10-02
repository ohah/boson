import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { assertModuleGraphSnapshot } from "./module-graph-contract.mjs";
import { classifyViteResource, compareModuleInfoIds, createViteModuleGraphAdapter, isUncapturedJavaScriptOutputAsset, mapModuleInfoDependencies } from "./vite-module-graph-adapter.mjs";
import {
  createViteGraphBuildConfig,
  createViteGraphFixturePlugin,
  VITE_GRAPH_FEATURES,
  VITE_GRAPH_OUTPUT_PROFILE,
} from "./vite-graph.config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const fixtureSource = path.join(here, "fixture", "module-graph");
const packageFixture = path.join(fixtureSource, "package-fixtures", "exports-demo");
const viteVersion = JSON.parse(await readFile(new URL("./node_modules/vite/package.json", import.meta.url), "utf8")).version;
const rolldownVersion = JSON.parse(await readFile(new URL("./node_modules/rolldown/package.json", import.meta.url), "utf8")).version;

test("입력 dependency IDs와 최종 on-disk ESM graph를 분리하고 명시 feature를 연결한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const result = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  const { snapshot } = result;

  assertModuleGraphSnapshot(snapshot);
  assert.equal(snapshot.build.status, "success", JSON.stringify(snapshot.diagnostics, null, 2));
  assert.equal(snapshot.sourceGraph.status, "complete");
  assert.equal(snapshot.outputGraph.status, "complete");
  assert.equal(snapshot.sourceGraph.moduleCount, 14);
  assert.equal(snapshot.sourceGraph.edgeCount, 18);
  assert.equal(snapshot.sourceGraph.excludedDependencyCount, 2);
  assert.equal(snapshot.build.toolVersion, viteVersion);
  assert.equal(snapshot.build.profile.effectiveOptions.runtimeVersions.node, process.version);
  assert.equal(snapshot.build.profile.effectiveOptions.runtimeVersions.vite, viteVersion);
  assert.equal(snapshot.build.profile.effectiveOptions.runtimeVersions.rolldown, rolldownVersion);
  assert.equal(snapshot.build.profile.effectiveOptions.runtimeVersions.platform, process.platform);
  assert.equal(snapshot.build.profile.effectiveOptions.runtimeVersions.arch, process.arch);
  assert.deepEqual(snapshot.build.profile.effectiveOptions.features, VITE_GRAPH_FEATURES);
  assert.deepEqual(snapshot.build.profile.effectiveOptions.outputProfile, VITE_GRAPH_OUTPUT_PROFILE);
  assert.equal(snapshot.build.profile.effectiveOptions.capture.writeBundleCallCount, 1);
  const resolvedConfig = snapshot.build.profile.effectiveOptions.resolvedViteConfig;
  assert.equal(resolvedConfig.root, realpathSync(fixture.root));
  assert.equal(resolvedConfig.mode, "production");
  assert.equal(resolvedConfig.base, "./");
  assert.deepEqual(resolvedConfig.resolve.conditions, ["module", "browser", "development|production"]);
  assert.deepEqual(resolvedConfig.resolve.mainFields, ["browser", "module", "jsnext:main", "jsnext"]);
  assert.deepEqual(resolvedConfig.resolve.extensions, [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"]);
  assert.deepEqual(resolvedConfig.resolve.externalConditions, ["node", "module-sync"]);
  assert.deepEqual(resolvedConfig.define, {});
  assert.equal(resolvedConfig.environment.envDir, realpathSync(fixture.root));
  assert.deepEqual(resolvedConfig.css, { transformer: "postcss", preprocessorMaxWorkers: true, devSourcemap: false });
  assert.equal(resolvedConfig.build.assetsDir, "assets");
  assert.equal(resolvedConfig.build.cssMinify, false);
  assert.deepEqual(resolvedConfig.build.outputOptions[0], {
    format: "es",
    entryFileNames: "assets/[name].js",
    chunkFileNames: "assets/[name].js",
    assetFileNames: "assets/[name][extname]",
  });
  assert.equal(snapshot.build.profile.effectiveOptions.resolvedViteConfig.command, "build");
  assert.equal(snapshot.build.profile.effectiveOptions.resolvedViteConfig.build.write, true);
  assert.equal(snapshot.build.profile.effectiveOptions.resolvedViteConfig.build.outputOptions.length, 1);
  assert.equal(snapshot.build.profile.effectiveOptions.resolvedViteConfig.build.outputOptions[0].format, "es");
  assert.ok(resolvedConfig.plugins.some((plugin) => plugin.name === "spinon-c02-vite-module-graph-fixture" && plugin.options?.role === "fixture-resolver"));
  assert.ok(resolvedConfig.plugins.some((plugin) => plugin.name === "spinon-c02-vite-module-graph" && plugin.options?.role === "adapter"));
  assert.ok(resolvedConfig.plugins.some((plugin) => plugin.name === "spinon-c02-module-info-order-observer" && plugin.options?.subject === "ModuleInfo dependency ID ordering"));
  const observedIndex = result.moduleInfoObservations.get("index.js");
  assert.deepEqual(normalizeModuleInfoIds(observedIndex.importedIds, fixture.root), [
    "app.js",
    `virtual:${sha256("\0vite/preload-helper.js").slice(0, 24)}`,
  ], "이 값은 pinned fixture의 실제 관찰이며 Rolldown 배열 일반 순서 보장이 아님");
  assert.deepEqual(normalizeModuleInfoIds(observedIndex.dynamicallyImportedIds, fixture.root), ["features/lazy.js"]);
  assert.equal(result.moduleInfoObservations.rawModuleParsedCallbackCount, 16);
  assert.equal(result.moduleInfoObservations.rawStaticIdCount, 16);
  assert.equal(result.moduleInfoObservations.rawDynamicIdCount, 4);
  assert.equal(result.moduleInfoObservations.rawStaticDuplicateIdCount, 0);
  assert.equal(result.moduleInfoObservations.rawDynamicDuplicateIdCount, 0);
  assert.equal(result.r15JavaScriptQualification.requiresResourceGraphJoin, true);
  assert.equal(result.r15JavaScriptQualification.requiresAppWideImpactFallback, true);
  if (process.env.SPINON_GRAPH_EVIDENCE === "1") {
    const lockfile = await readFile(path.join(here, "bun.lock"));
    console.log(JSON.stringify({
      buildProfileSha256: snapshot.build.buildProfileSha256,
      fixtureSha256: snapshot.build.fixtureSha256,
      lockfileSha256: sha256(lockfile),
      toolchain: { node: process.version, vite: viteVersion, rolldown: rolldownVersion, platform: process.platform, architecture: process.arch },
      sourceGraph: {
        moduleCount: snapshot.sourceGraph.moduleCount,
        edgeCount: snapshot.sourceGraph.edgeCount,
        excludedDependencyCount: snapshot.sourceGraph.excludedDependencyCount,
        sha256: snapshot.sourceGraph.sha256,
      },
      outputGraph: snapshot.outputGraph.resources.map(({ outputPath, bytes, sha256: digest }) => ({ outputPath, bytes, sha256: digest })),
      moduleInfoOrder: {
        static: normalizeModuleInfoIds(result.moduleInfoObservations.get("index.js")?.importedIds ?? [], fixture.root),
        dynamic: normalizeModuleInfoIds(result.moduleInfoObservations.get("index.js")?.dynamicallyImportedIds ?? [], fixture.root),
      },
      rawCounts: {
        moduleParsedCallbackCount: result.moduleInfoObservations.rawModuleParsedCallbackCount,
        distinctModuleInfoIds: result.moduleInfoObservations.size,
        importedIdCount: result.moduleInfoObservations.rawStaticIdCount,
        dynamicallyImportedIdCount: result.moduleInfoObservations.rawDynamicIdCount,
        duplicateImportedIdCount: result.moduleInfoObservations.rawStaticDuplicateIdCount,
        duplicateDynamicallyImportedIdCount: result.moduleInfoObservations.rawDynamicDuplicateIdCount,
      },
      normalizedCounts: {
        sourceModules: snapshot.sourceGraph.moduleCount,
        sourceDependencies: snapshot.sourceGraph.edgeCount,
        excludedDependencies: snapshot.sourceGraph.excludedDependencyCount,
        outputChunks: snapshot.outputGraph.chunks.length,
        outputResources: snapshot.outputGraph.resources.length,
      },
      r15JavaScriptQualification: {
        requiresAppWideImpactFallback: result.r15JavaScriptQualification.requiresAppWideImpactFallback,
        requiresResourceGraphJoin: result.r15JavaScriptQualification.requiresResourceGraphJoin,
      },
      resolvedConfig: {
        root: resolvedConfig.root,
        command: resolvedConfig.command,
        mode: resolvedConfig.mode,
        base: resolvedConfig.base,
        conditions: resolvedConfig.resolve.conditions,
        resolverDefaults: {
          mainFields: resolvedConfig.resolve.mainFields,
          extensions: resolvedConfig.resolve.extensions,
          externalConditions: resolvedConfig.resolve.externalConditions,
        },
        environment: resolvedConfig.environment,
        define: resolvedConfig.define,
        css: resolvedConfig.css,
        buildOptions: {
          assetsDir: resolvedConfig.build.assetsDir,
          cssMinify: resolvedConfig.build.cssMinify,
          polyfillModulePreload: resolvedConfig.build.polyfillModulePreload,
          cssTarget: resolvedConfig.build.cssTarget,
          copyPublicDir: resolvedConfig.build.copyPublicDir,
          commonjsOptions: resolvedConfig.build.commonjsOptions,
        },
        outputOptions: resolvedConfig.build.outputOptions,
        pluginNames: resolvedConfig.plugins.map((plugin) => plugin.name),
        profiledPlugins: resolvedConfig.plugins.filter((plugin) => plugin.options !== null),
      },
      diagnostics: snapshot.diagnostics,
    }, null, 2));
  }
  assert.deepEqual(snapshot.features.map(({ id }) => id), ["lazy-feature", "main"]);
  assert.ok(snapshot.features.every((feature) => feature.entryChunkId));

  const dynamicSharedEdges = snapshot.sourceGraph.dependencies.filter((edge) =>
    ["styles-edge.js", "icon-edge.js"].includes(edge.referrerModuleKey)
      && edge.sourceSpecifier === "./shared.js" && edge.kind === "dynamic",
  );
  assert.equal(dynamicSharedEdges.length, 2);
  assert.deepEqual(dynamicSharedEdges.map((edge) => edge.resolvedModuleKey), ["shared.js", "shared.js"]);
  assert.ok(dynamicSharedEdges.every((edge) => edge.source === null), "moduleParsed transformed offsets are not presented as original source locations");
  assert.ok(snapshot.sourceGraph.dependencies.some((edge) => edge.sourceSpecifier === "@graph/alias.js" && edge.resolvedModuleKey === "alias.js"));
  assert.ok(snapshot.sourceGraph.dependencies.some((edge) => edge.sourceSpecifier === "@fixture/exports-demo" && edge.resolvedModuleKey.endsWith("node_modules/@fixture/exports-demo/dist/entry.js")));
  assert.ok(snapshot.sourceGraph.dependencies.some((edge) => edge.sourceSpecifier === "virtual:graph-value" && edge.resolvedModuleKey.startsWith("virtual:")));
  const generatedPreloadEdge = snapshot.sourceGraph.dependencies.find((edge) => edge.sourceSpecifier === "virtual:vite/preload-helper.js");
  assert.ok(generatedPreloadEdge?.resolvedModuleKey.startsWith("virtual:"));
  assert.ok(snapshot.sourceGraph.modules.some((module) => module.key === generatedPreloadEdge.resolvedModuleKey));
  assert.ok(snapshot.sourceGraph.excludedDependencies.some((edge) => edge.sourceSpecifier === "./styles/app.css" && edge.targetKind === "stylesheet" && edge.resolvedResourceKey === "styles/app.css"));
  assert.ok(snapshot.sourceGraph.excludedDependencies.some((edge) => edge.sourceSpecifier === "./assets/icon.svg" && edge.targetKind === "asset" && edge.resolvedResourceKey === "assets/icon.svg"));
  assert.ok(snapshot.sourceGraph.dependencies.some((edge) => edge.referrerModuleKey === "cycle-a.js" && edge.resolvedModuleKey === "cycle-b.js"));
  assert.ok(snapshot.sourceGraph.dependencies.some((edge) => edge.referrerModuleKey === "cycle-b.js" && edge.resolvedModuleKey === "cycle-a.js"));

  const treeShaken = snapshot.sourceGraph.modules.find((module) => module.key === "tree-shaken.js");
  assert.deepEqual(treeShaken?.outputChunkIds, []);
  assert.ok(snapshot.outputGraph.chunks.some((chunk) => chunk.kind === "dynamic"));
  const mainFeature = snapshot.features.find((feature) => feature.id === "main");
  const lazyFeature = snapshot.features.find((feature) => feature.id === "lazy-feature");
  const emittedLazyEdge = snapshot.outputGraph.chunks
    .find((chunk) => chunk.id === mainFeature.entryChunkId)
    ?.dependencies.find((edge) => edge.kind === "dynamic" && edge.chunkId === lazyFeature.entryChunkId);
  assert.ok(emittedLazyEdge, "최종 emitted ESM specifier가 dynamic feature chunk로 연결됨");
  assert.notEqual(emittedLazyEdge.specifier, "./features/lazy.js");

  const emittedFiles = new Map(result.outputEvidence.map((entry) => [entry.fileName, entry]));
  assert.equal(emittedFiles.size, snapshot.outputGraph.resources.length);
  for (const resource of snapshot.outputGraph.resources) {
    const evidence = emittedFiles.get(resource.outputPath);
    assert.ok(evidence);
    assert.equal(resource.bytes, evidence.bytes);
    assert.equal(resource.sha256, evidence.sha256);
  }
});

test("Vite worker JavaScript OutputAsset은 거부하고 CSS·SVG asset은 0011 범위로 남긴다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await writeFile(path.join(fixture.root, "worker.js"), 'self.onmessage = () => self.postMessage("worker");\n');
  const entryPath = path.join(fixture.root, "index.js");
  const entrySource = await readFile(entryPath, "utf8");
  await writeFile(entryPath, `${entrySource}\nglobalThis.__spinonGraphWorker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });\n`);

  const result = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  const outputItems = collectOutputItems(result.output);
  const workerAsset = outputItems.find((item) => item.type === "asset" && /worker.*\.js$/i.test(item.fileName));
  const mainChunk = findOutputChunk(result.output, "assets/main.js");

  assert.ok(workerAsset, "Vite가 worker JavaScript를 chunk가 아닌 OutputAsset으로 방출한다");
  assert.ok(mainChunk?.code.includes(path.posix.basename(workerAsset.fileName)), "최종 main chunk가 worker asset을 참조한다");
  assert.equal(result.snapshot.build.status, "failed");
  assert.equal(result.snapshot.outputGraph.status, "incomplete");
  assert.ok(result.snapshot.diagnostics.some((item) =>
    item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"
      && item.referrerModuleKey === `resource:${workerAsset.fileName}`
      && item.message.includes("JavaScript 확장자의 OutputAsset"),
  ));
  assert.equal(result.snapshot.sourceGraph.modules.some((module) => module.key === "worker.js"), false);
  assert.equal(result.snapshot.outputGraph.resources.some((resource) => resource.outputPath === workerAsset.fileName), false);
  assert.ok(outputItems.some((item) => item.type === "asset" && item.fileName.endsWith(".css")));
  assert.ok(outputItems.some((item) => item.type === "asset" && item.fileName.endsWith(".svg")));
});

test("JavaScript OutputAsset 확장자와 query가 붙은 경로를 놓치지 않고 stylesheet·image는 제외한다", () => {
  for (const fileName of ["worker.js", "worker.mjs", "worker.cjs", "worker.jsx", "worker.ts", "worker.js?raw", "worker.JS#fragment"]) {
    assert.equal(isUncapturedJavaScriptOutputAsset(fileName), true, fileName);
  }
  for (const fileName of ["styles.css", "icon.svg", "font.woff2", "bundle.js.map", "asset.bin", null]) {
    assert.equal(isUncapturedJavaScriptOutputAsset(fileName), false, String(fileName));
  }
});

test("Rolldown region comment의 절대 fixture 경로만 AST comment range에서 정규화해 다른 temp root의 output SHA를 고정한다", async (t) => {
  const first = await makeFixture();
  const second = await makeFixture();
  t.after(async () => Promise.all([cleanupFixture(first.container), cleanupFixture(second.container)]));
  const firstRun = await runBuild({ fixtureRoot: first.root, outputDir: first.output });
  const secondRun = await runBuild({ fixtureRoot: second.root, outputDir: second.output });
  assert.equal(firstRun.snapshot.build.status, "success", JSON.stringify(firstRun.snapshot.diagnostics, null, 2));
  assert.equal(secondRun.snapshot.build.status, "success", JSON.stringify(secondRun.snapshot.diagnostics, null, 2));
  assert.deepEqual(
    firstRun.snapshot.outputGraph.resources.map(({ outputPath, bytes, sha256 }) => ({ outputPath, bytes, sha256 })),
    secondRun.snapshot.outputGraph.resources.map(({ outputPath, bytes, sha256 }) => ({ outputPath, bytes, sha256 })),
  );
  assert.equal(firstRun.snapshot.sourceGraph.sha256, secondRun.snapshot.sourceGraph.sha256);
  assert.deepEqual(firstRun.snapshot.sourceGraph, secondRun.snapshot.sourceGraph);
  assert.notEqual(firstRun.snapshot.build.buildProfileSha256, secondRun.snapshot.build.buildProfileSha256, "profile records the actual fixture/output roots");
});

test("같은 fixture root/profile의 반복 build에서 output bytes digest가 같다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const first = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  const second = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  assert.equal(first.snapshot.build.status, "success", JSON.stringify(first.snapshot.diagnostics, null, 2));
  assert.equal(second.snapshot.build.status, "success", JSON.stringify(second.snapshot.diagnostics, null, 2));
  assert.equal(first.snapshot.build.buildProfileSha256, second.snapshot.build.buildProfileSha256);
  assert.deepEqual(
    first.snapshot.outputGraph.resources.map(({ outputPath, bytes, sha256 }) => ({ outputPath, bytes, sha256 })),
    second.snapshot.outputGraph.resources.map(({ outputPath, bytes, sha256 }) => ({ outputPath, bytes, sha256 })),
  );
  assert.equal(first.snapshot.sourceGraph.sha256, second.snapshot.sourceGraph.sha256);
  assert.deepEqual(first.snapshot.sourceGraph, second.snapshot.sourceGraph);
});

test("동일 source specifier의 static/dynamic target conflict를 ModuleInfo ID로 감지한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await writeFile(path.join(fixture.root, "index.js"), [
    'import { conflictValue } from "virtual:conflicting-target";',
    'export const loadConflict = () => import("virtual:conflicting-target");',
    "export { conflictValue };",
    "",
  ].join("\n"));
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, conflict: true });
  assert.equal(snapshot.build.status, "failed");
  assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_TARGET_CONFLICT" && item.stage === "source"));
  assert.deepEqual(snapshot.features, [], "실패 snapshot은 null entry feature를 반환하지 않음");
});

test("external dependency는 source capture에서 분류하고 성공 snapshot을 거부한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await writeFile(path.join(fixture.root, "index.js"), 'import { runtimeValue } from "external:runtime"; export { runtimeValue };\n');
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, external: ["external:runtime"] });
  assert.equal(snapshot.build.status, "failed");
  assert.ok(snapshot.sourceGraph.dependencies.some((edge) => edge.sourceSpecifier === "external:runtime" && edge.external));
  assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_EXTERNAL_IMPORT" && item.stage === "source"));
});

test("unresolved input과 output target은 각각 실패 snapshot으로 보존한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await writeFile(path.join(fixture.root, "index.js"), 'import "./missing-module.js"; export const entryValue = 1;\n');
  const input = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  assert.equal(input.snapshot.build.status, "failed");
  assert.ok(input.snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNRESOLVED_IMPORT" || item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"));

  await cleanupFixture(fixture.container);
  const outputFixture = await makeFixture();
  t.after(() => cleanupFixture(outputFixture.container));
  const output = await runBuild({
    fixtureRoot: outputFixture.root,
    outputDir: outputFixture.output,
    injectUnresolvedOutputImport: true,
  });
  assert.equal(output.snapshot.build.status, "failed");
  assert.ok(output.snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNRESOLVED_IMPORT" && item.stage === "output" && item.specifier === "./not-emitted.js"));
});

test("계산형 dynamic import와 import attributes는 source graph에 성공적으로 통과하지 않는다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await writeFile(path.join(fixture.root, "index.js"), 'export const loadByName = (name) => import(name);\n');
  const dynamic = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  assert.equal(dynamic.snapshot.build.status, "failed");
  assert.ok(dynamic.snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNSUPPORTED_IMPORT"));

  await cleanupFixture(fixture.container);
  const attributeFixture = await makeFixture();
  t.after(() => cleanupFixture(attributeFixture.container));
  await writeFile(path.join(attributeFixture.root, "data.json"), '{"value":1}\n');
  await writeFile(path.join(attributeFixture.root, "index.js"), 'import data from "./data.json" with { type: "json" }; export { data };\n');
  const attribute = await runBuild({ fixtureRoot: attributeFixture.root, outputDir: attributeFixture.output });
  assert.equal(attribute.snapshot.build.status, "failed");
  assert.ok(attribute.snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNSUPPORTED_IMPORT"));

  await cleanupFixture(attributeFixture.container);
  const phaseFixture = await makeFixture();
  t.after(() => cleanupFixture(phaseFixture.container));
  await writeFile(path.join(phaseFixture.root, "index.js"), 'import defer * as deferred from "./shared.js"; export { deferred };\n');
  const phase = await runBuild({ fixtureRoot: phaseFixture.root, outputDir: phaseFixture.output });
  assert.equal(phase.snapshot.build.status, "failed");
  assert.ok(phase.snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNSUPPORTED_IMPORT" || item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"));
});

test("unknown module type dependency는 성공 graph로 잘못 분류하지 않는다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await writeFile(path.join(fixture.root, "index.js"), 'import { unknownValue } from "./unknown-module.spinon"; export { unknownValue };\n');
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, unknownModuleType: true });
  assert.equal(snapshot.build.status, "failed");
  assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNSUPPORTED_IMPORT" || item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"));
});

test("CSS inline query는 JS edge로 보존하고 SVG component query는 JS moduleType일 때 유지한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await writeFile(path.join(fixture.root, "query-edge.js"), [
    'import inlineCss from "./styles/app.css?inline";',
    "export const queryValue = inlineCss;",
    "",
  ].join("\n"));
  await writeFile(path.join(fixture.root, "index.js"), [
    'import { queryValue } from "./query-edge.js";',
    'const loadFeature = () => import("./features/lazy.js");',
    "globalThis.__spinonGraphFixture = { queryValue, loadFeature };",
    "",
  ].join("\n"));
  const result = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  assert.equal(result.snapshot.build.status, "success", JSON.stringify({ diagnostics: result.snapshot.diagnostics, sourceModules: result.snapshot.sourceGraph.modules, outputGraph: result.snapshot.outputGraph }, null, 2));
  assert.ok(result.snapshot.sourceGraph.dependencies.some((edge) => edge.sourceSpecifier === "./styles/app.css?inline" && edge.resolvedModuleKey.startsWith("styles/app.css#query-")));
  assert.equal(classifyViteResource("/fixture/assets/icon.svg?component", { moduleType: "js" }, "/fixture").status, "none");
});

test("지원하지 않는 CSS query는 실패하고 SVG url query는 0011용 canonical key로 연결한다", async (t) => {
  const cssFixture = await makeFixture();
  t.after(() => cleanupFixture(cssFixture.container));
  await writeFile(path.join(cssFixture.root, "index.js"), 'import "./styles/app.css?module"; export const loadFeature = () => import("./features/lazy.js");\n');
  const css = await runBuild({ fixtureRoot: cssFixture.root, outputDir: cssFixture.output });
  assert.equal(css.snapshot.build.status, "failed");
  assert.ok(css.snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNSUPPORTED_IMPORT" && /CSS query/.test(item.message)));

  const assetFixture = await makeFixture();
  t.after(() => cleanupFixture(assetFixture.container));
  await writeFile(path.join(assetFixture.root, "index.js"), 'import iconUrl from "./assets/icon.svg?url"; const loadFeature = () => import("./features/lazy.js"); globalThis.__spinonGraphFixture = { iconUrl, loadFeature };\n');
  const asset = await runBuild({ fixtureRoot: assetFixture.root, outputDir: assetFixture.output });
  assert.equal(asset.snapshot.build.status, "success", JSON.stringify(asset.snapshot.diagnostics, null, 2));
  assert.ok(asset.snapshot.sourceGraph.excludedDependencies.some((edge) => edge.sourceSpecifier === "./assets/icon.svg?url"
    && edge.targetKind === "asset" && edge.resolvedResourceKey === "assets/icon.svg"));
});

test("WASM 확장자와 moduleType은 각각 C02에서 unsupported로 분류한다", () => {
  assert.equal(classifyViteResource("/fixture/assets/module.wasm", { moduleType: "asset" }, "/fixture").status, "unsupported");
  assert.equal(classifyViteResource("/fixture/assets/module.bin", { moduleType: "wasm" }, "/fixture").status, "unsupported");
});

test("output resource file symlink는 따라가지 않고 실패한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, outputSymlink: "file" });
  assert.equal(snapshot.build.status, "failed");
  assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_RESOURCE_MISSING" && /symlink/.test(item.message)));
});

test("output 경로 중간의 directory symlink도 따라가지 않고 실패한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, outputSymlink: "directory" });
  assert.equal(snapshot.build.status, "failed");
  assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_RESOURCE_MISSING" && /symlink/.test(item.message)));
});

test("emptyOutDir가 fixture와 같은·상위·symlink 별칭 경로를 지우기 전에 거부한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));

  const nestedOutput = path.join(fixture.root, "dangerous-output");
  await mkdir(nestedOutput);
  await writeFile(path.join(nestedOutput, "keep.txt"), "nested sentinel");
  assert.throws(
    () => createViteGraphBuildConfig({ fixtureRoot: fixture.root, outputDir: nestedOutput }),
    /fixture\/source root와 겹칩니다/,
  );
  assert.equal(await readFile(path.join(nestedOutput, "keep.txt"), "utf8"), "nested sentinel");

  const ancestorOutput = fixture.container;
  await writeFile(path.join(ancestorOutput, "ancestor-sentinel.txt"), "ancestor sentinel");
  assert.throws(
    () => createViteGraphBuildConfig({ fixtureRoot: fixture.root, outputDir: ancestorOutput }),
    /fixture\/source root와 겹칩니다/,
  );
  assert.equal(await readFile(path.join(ancestorOutput, "ancestor-sentinel.txt"), "utf8"), "ancestor sentinel");

  const alias = path.join(fixture.container, "fixture-alias");
  await symlink(fixture.root, alias, "dir");
  const aliasOutput = path.join(alias, "alias-output");
  await mkdir(aliasOutput);
  await writeFile(path.join(aliasOutput, "keep.txt"), "alias sentinel");
  assert.throws(
    () => createViteGraphBuildConfig({ fixtureRoot: fixture.root, outputDir: aliasOutput }),
    /fixture\/source root와 겹칩니다/,
  );
  assert.equal(await readFile(path.join(aliasOutput, "keep.txt"), "utf8"), "alias sentinel");
});

test("emptyOutDir는 worktree의 .git 및 OS 임시 디렉터리 밖 경로를 설정 단계에서 거부한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));

  const gitOutput = path.join(repositoryRoot, ".git");
  assert.throws(
    () => createViteGraphBuildConfig({ fixtureRoot: fixture.root, outputDir: gitOutput }),
    /worktree root와 겹칩니다/,
  );

  const outsideTempOutput = path.join(os.homedir(), "spinon-c02-output-outside-temp");
  assert.throws(
    () => createViteGraphBuildConfig({ fixtureRoot: fixture.root, outputDir: outsideTempOutput }),
    /OS 임시 디렉터리 안의 전용 outputDir만 허용합니다/,
  );
});

test("moduleParsed 누락 및 transform 실패는 partial snapshot과 진단을 보존한다", async (t) => {
  const missing = await makeFixture();
  t.after(() => cleanupFixture(missing.container));
  const missingRun = await runBuild({ fixtureRoot: missing.root, outputDir: missing.output, failModuleParsed: true });
  assert.equal(missingRun.snapshot.build.status, "failed");
  assert.deepEqual(missingRun.snapshot.features, []);
  assert.ok(missingRun.snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"));

  const transform = await makeFixture();
  t.after(() => cleanupFixture(transform.container));
  const transformRun = await runBuild({ fixtureRoot: transform.root, outputDir: transform.output, failTransform: true });
  assert.equal(transformRun.snapshot.build.status, "failed");
  assert.deepEqual(transformRun.snapshot.features, []);
  assert.ok(transformRun.snapshot.diagnostics.some((item) => item.stage === "build" && item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"));
});

test("앞선 transform이 줄을 추가해도 원본 source 위치를 추측하지 않는다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, prependNewline: true });
  assert.equal(snapshot.build.status, "success", JSON.stringify(snapshot.diagnostics, null, 2));
  assert.ok(snapshot.sourceGraph.dependencies.length > 0);
  assert.ok(snapshot.sourceGraph.dependencies.every((edge) => edge.source === null));
});

test("plugin이 주입한 output cycle edge는 metadata 불일치로 실패시키면서 bytes와 파싱 edge를 보존한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, injectOutputCycle: true });
  assert.equal(snapshot.build.status, "failed", JSON.stringify(snapshot.diagnostics, null, 2));
  const entry = snapshot.outputGraph.chunks.find((chunk) => chunk.kind === "entry");
  const dynamic = snapshot.outputGraph.chunks.find((chunk) => chunk.kind === "dynamic");
  assert.ok(entry && dynamic);
  assert.ok(entry.dependencies.some((edge) => edge.kind === "dynamic" && edge.chunkId === dynamic.id));
  assert.ok(dynamic.dependencies.some((edge) => edge.kind === "static" && edge.chunkId === entry.id));
  assert.equal(snapshot.outputGraph.status, "incomplete");
  assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "output"));
});

test("최종 emitted specifier와 다른 output chunk를 연결한 conflict snapshot은 공통 검증이 거부한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  assert.equal(snapshot.build.status, "success", JSON.stringify(snapshot.diagnostics, null, 2));
  const malformed = structuredClone(snapshot);
  const entry = malformed.outputGraph.chunks.find((chunk) => chunk.kind === "entry");
  const edge = entry.dependencies.find((dependency) => dependency.kind === "dynamic");
  assert.ok(edge);
  edge.chunkId = entry.id;
  assert.throws(() => assertModuleGraphSnapshot(malformed), /emitted specifier와 output target이 일치하지 않습니다/);
});

test("feature entry에서 도달하지 않는 output chunk는 공통 validator가 거부한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  assert.equal(snapshot.build.status, "success", JSON.stringify(snapshot.diagnostics, null, 2));
  const malformed = structuredClone(snapshot);
  const orphanPath = "assets/orphan.js";
  const orphanResourceId = `resource:${orphanPath}`;
  malformed.outputGraph.resources.push({
    id: orphanResourceId,
    logicalId: null,
    identityStatus: "unproven",
    kind: "javascript",
    outputPath: orphanPath,
    mediaType: "text/javascript",
    bytes: 0,
    sha256: sha256(Buffer.alloc(0)),
  });
  malformed.outputGraph.chunks.push({
    id: `chunk:${orphanPath}`,
    logicalId: null,
    identityStatus: "unproven",
    kind: "shared",
    moduleFormat: "esm",
    javascriptResourceId: orphanResourceId,
    sourceModuleKeys: [],
    dependencies: [],
  });
  assert.throws(() => assertModuleGraphSnapshot(malformed), /도달할 수 없는 output chunk/);
});

test("ModuleInfo mismatch 진단은 referrer record key를 유지한다", () => {
  const diagnostics = [];
  compareModuleInfoIds(
    { key: "src/parent.js", staticIds: ["src/original.js"], dynamicIds: [] },
    { importedIds: ["src/changed.js"], dynamicallyImportedIds: [] },
    diagnostics,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].referrerModuleKey, "src/parent.js");
  assert.equal(diagnostics[0].stage, "source");
  assert.equal(diagnostics[0].specifier, null, "여러 관찰 ID 배열을 단일 source specifier 필드에 넣지 않음");
});

test("ModuleInfo dependency ID 배열 순서에 대한 가정을 하지 않고 모호한 occurrence 연결을 거부한다", () => {
  const occurrences = [
    { kind: "static", specifier: "./alpha.js", offset: 10 },
    { kind: "static", specifier: "./beta.js", offset: 30 },
  ];
  const forward = mapModuleInfoDependencies(occurrences, ["/fixture/alpha.js", "/fixture/beta.js"]);
  const reversed = mapModuleInfoDependencies(occurrences, ["/fixture/beta.js", "/fixture/alpha.js"]);
  assert.equal(forward.status, "ambiguous");
  assert.equal(reversed.status, "ambiguous");
  assert.equal(mapModuleInfoDependencies(occurrences, ["/fixture/shared.js", "/fixture/shared.js"]).status, "mapped");

  const diagnostics = [];
  compareModuleInfoIds(
    { key: "src/parent.js", staticIds: ["/fixture/alpha.js", "/fixture/beta.js"], dynamicIds: [] },
    { importedIds: ["/fixture/beta.js", "/fixture/alpha.js"], dynamicallyImportedIds: [] },
    diagnostics,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].specifier, null);
});

test("단일 output profile은 writeBundle 한 번만 허용하고 추가 plugin 설정을 거부한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const multiple = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, multipleOutputs: true });
  assert.equal(multiple.snapshot.build.status, "failed");
  assert.equal(multiple.snapshot.build.profile.effectiveOptions.capture.writeBundleCallCount, 1);
  assert.ok(multiple.snapshot.diagnostics.some((item) => item.stage === "config" && /output 하나/.test(item.message)));

  await cleanupFixture(fixture.container);
  const duplicateCallFixture = await makeFixture();
  t.after(() => cleanupFixture(duplicateCallFixture.container));
  const duplicateCall = await runBuild({ fixtureRoot: duplicateCallFixture.root, outputDir: duplicateCallFixture.output, duplicateWriteBundleCall: true });
  assert.equal(duplicateCall.snapshot.build.status, "failed");
  assert.equal(duplicateCall.snapshot.build.profile.effectiveOptions.capture.writeBundleCallCount, 2);
  assert.ok(duplicateCall.snapshot.diagnostics.some((item) => item.stage === "output" && /writeBundle 호출/.test(item.message)));

  const unprofiled = await makeFixture();
  t.after(() => cleanupFixture(unprofiled.container));
  const extra = await runBuild({ fixtureRoot: unprofiled.root, outputDir: unprofiled.output, addUnprofiledPlugin: true });
  assert.equal(extra.snapshot.build.status, "failed");
  assert.ok(extra.snapshot.diagnostics.some((item) => item.stage === "config" && /descriptor 없이/.test(item.message)));
});

test("fixture 밖 source module은 inventory 경계 밖이라 실패한다", async (t) => {
  const fixture = await makeFixture();
  const outsidePath = path.join(path.dirname(fixture.root), "outside-module.js");
  t.after(async () => {
    await cleanupFixture(fixture.container);
    await rm(outsidePath, { force: true });
  });
  await writeFile(outsidePath, "export const outsideValue = 1;\n");
  await writeFile(path.join(fixture.root, "index.js"), 'import { outsideValue } from "virtual:outside-source"; export { outsideValue };\n');
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, outsideDependency: true });
  assert.equal(snapshot.build.status, "failed");
  assert.ok(snapshot.diagnostics.some((item) => item.stage === "source" && /fixture 밖의 파일 module dependency/.test(item.message)));
});

test("fixture inventory는 symlink dependency를 포함하지 않고 실패한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await symlink(path.join(fixture.root, "shared.js"), path.join(fixture.root, "linked.js"));
  await writeFile(path.join(fixture.root, "index.js"), 'import { sharedValue } from "./linked.js"; export { sharedValue };\n');
  await assert.rejects(runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output }), /일반 파일.*아닌 항목/);
});

test("누락 module membership과 누락 output resource를 공통 validator 및 byte reader가 거부한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const successful = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  assert.equal(successful.snapshot.build.status, "success", JSON.stringify(successful.snapshot.diagnostics, null, 2));

  const missingMembership = structuredClone(successful.snapshot);
  const member = missingMembership.sourceGraph.modules.find((module) => module.outputChunkIds.length > 0);
  assert.ok(member);
  member.outputChunkIds = [];
  assert.throws(() => assertModuleGraphSnapshot(missingMembership));

  const duplicateMembership = structuredClone(successful.snapshot);
  const duplicateModule = duplicateMembership.sourceGraph.modules.find((module) => module.outputChunkIds.length > 0);
  duplicateModule.outputChunkIds.push(duplicateModule.outputChunkIds[0]);
  assert.throws(() => assertModuleGraphSnapshot(duplicateMembership));

  const missingSnapshotResource = structuredClone(successful.snapshot);
  missingSnapshotResource.outputGraph.resources.pop();
  assert.throws(() => assertModuleGraphSnapshot(missingSnapshotResource));

  const missingResourceFixture = await makeFixture();
  t.after(() => cleanupFixture(missingResourceFixture.container));
  const missingResource = await runBuild({
    fixtureRoot: missingResourceFixture.root,
    outputDir: missingResourceFixture.output,
    missingOutputResource: true,
  });
  assert.equal(missingResource.snapshot.build.status, "failed");
  assert.ok(missingResource.snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_RESOURCE_MISSING"));
});

test("동일 source occurrence를 Map으로 합치지 않고 보존하거나 수 불일치로 실패한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  await writeFile(path.join(fixture.root, "index.js"), [
    'import { sharedValue as first } from "./shared.js";',
    'import { sharedValue as second } from "./shared.js";',
    "export const values = [first, second];",
    'export const loadFeature = () => import("./features/lazy.js");',
    "",
  ].join("\n"));
  const { snapshot } = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output });
  const duplicateEdges = snapshot.sourceGraph.dependencies.filter((edge) =>
    edge.referrerModuleKey === "index.js" && edge.kind === "static" && edge.sourceSpecifier === "./shared.js",
  );
  assert.equal(duplicateEdges.length, 2);
  if (snapshot.build.status === "success") {
    assert.equal(duplicateEdges[0].resolvedModuleKey, duplicateEdges[1].resolvedModuleKey);
  } else {
    assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"));
  }
});

test("중복 feature ID와 빈 feature 목록은 실패 처리한다", async (t) => {
  const fixture = await makeFixture();
  t.after(() => cleanupFixture(fixture.container));
  const duplicate = [
    { id: "same", entrySourceKey: "index.js" },
    { id: "same", entrySourceKey: "features/lazy.js" },
  ];
  const duplicateRun = await runBuild({ fixtureRoot: fixture.root, outputDir: fixture.output, features: duplicate });
  assert.equal(duplicateRun.snapshot.build.status, "failed");
  assert.ok(duplicateRun.snapshot.diagnostics.some((item) => item.stage === "config"));

  await cleanupFixture(fixture.container);
  const emptyFixture = await makeFixture();
  t.after(() => cleanupFixture(emptyFixture.container));
  const emptyRun = await runBuild({ fixtureRoot: emptyFixture.root, outputDir: emptyFixture.output, features: [] });
  assert.equal(emptyRun.snapshot.build.status, "failed");
  assert.deepEqual(emptyRun.snapshot.features, []);
});

async function runBuild({
  fixtureRoot,
  outputDir,
  conflict = false,
  external = [],
  injectUnresolvedOutputImport = false,
  failModuleParsed = false,
  failTransform = false,
  prependNewline = false,
  injectOutputCycle = false,
  outputSymlink = null,
  unknownModuleType = false,
  multipleOutputs = false,
  addUnprofiledPlugin = false,
  outsideDependency = false,
  missingOutputResource = false,
  duplicateWriteBundleCall = false,
  features = VITE_GRAPH_FEATURES,
}) {
  const moduleInfoObservations = new Map();
  Object.assign(moduleInfoObservations, {
    rawModuleParsedCallbackCount: 0,
    rawStaticIdCount: 0,
    rawDynamicIdCount: 0,
    rawStaticDuplicateIdCount: 0,
    rawDynamicDuplicateIdCount: 0,
  });
  const plugins = [moduleInfoObservationPlugin(moduleInfoObservations, fixtureRoot), createViteGraphFixturePlugin({ conflict })];
  if (failModuleParsed) plugins.push(failModuleParsedPlugin());
  if (failTransform) plugins.push(failingTransformPlugin());
  if (prependNewline) plugins.push(prependNewlinePlugin());
  if (injectUnresolvedOutputImport) plugins.push(unresolvedOutputImportPlugin());
  if (injectOutputCycle) plugins.push(outputCyclePlugin());
  if (outputSymlink) plugins.push(outputSymlinkPlugin(outputSymlink));
  if (missingOutputResource) plugins.push(missingOutputResourcePlugin());
  if (unknownModuleType) plugins.push(unknownModuleTypePlugin());
  const config = createViteGraphBuildConfig({ fixtureRoot, outputDir, plugins });
  config.build.rollupOptions.external = external;
  if (outsideDependency) config.plugins.unshift(outsideDependencyPlugin(path.join(path.dirname(fixtureRoot), "outside-module.js")));
  const adapter = createViteModuleGraphAdapter({ fixtureRoot, features, outputProfile: VITE_GRAPH_OUTPUT_PROFILE });
  config.plugins.push(adapter.plugin);
  if (duplicateWriteBundleCall) config.plugins.push(duplicateWriteBundlePlugin(adapter.plugin));
  adapter.setExpectedConfig(config);
  if (addUnprofiledPlugin) config.plugins.unshift({ name: "spinon-c02-unprofiled-fixture-plugin", transform() { return null; } });
  if (multipleOutputs) {
    const primary = config.build.rollupOptions.output;
    config.build.rollupOptions.output = [primary, {
      ...primary,
      entryFileNames: "secondary/[name].js",
      chunkFileNames: "secondary/[name].js",
    }];
  }
  const fixtureInventory = await inventoryFixture(fixtureRoot);
  const fixtureSha256 = sha256(JSON.stringify(fixtureInventory));
  const fixtureOptions = { conflict, external, injectUnresolvedOutputImport, failModuleParsed, failTransform, prependNewline, injectOutputCycle, outputSymlink, unknownModuleType, multipleOutputs, addUnprofiledPlugin, outsideDependency, missingOutputResource, duplicateWriteBundleCall };
  let output;
  let buildStatus = "success";
  try {
    output = await build(config);
  } catch (error) {
    buildStatus = "failed";
    adapter.recordBuildFailure(error);
  }
  const profile = await makeBuildProfile({ fixtureRoot, outputDir, fixtureOptions, profileObservations: adapter.profileObservations(), features });
  const snapshot = adapter.snapshot({ fixtureSha256, profile, viteVersion, buildStatus });
  const r15JavaScriptQualification = snapshot.build.status === "success" ? adapter.assessR15JavaScriptInput(snapshot) : null;
  const outputEvidence = [];
  for (const resource of snapshot.outputGraph.resources) {
    const bytes = await readFile(path.join(outputDir, ...resource.outputPath.split("/"))).catch(() => Buffer.alloc(0));
    outputEvidence.push({ fileName: resource.outputPath, bytes: bytes.byteLength, sha256: sha256(bytes) });
    assert.equal(resource.bytes, bytes.byteLength, `실제 디스크 byte count: ${resource.outputPath}`);
    assert.equal(resource.sha256, sha256(bytes), `실제 디스크 SHA: ${resource.outputPath}`);
    const bundleChunk = findOutputChunk(output, resource.outputPath);
    if (snapshot.build.status === "success") assert.ok(bundleChunk, `Vite build API에 emitted chunk가 있음: ${resource.outputPath}`);
    if (!bundleChunk) continue;
    assert.equal(Buffer.byteLength(bundleChunk.code, "utf8"), bytes.byteLength, `build API와 디스크 byte count: ${resource.outputPath}`);
    assert.equal(sha256(Buffer.from(bundleChunk.code, "utf8")), sha256(bytes), `build API와 디스크 SHA: ${resource.outputPath}`);
  }
  return { snapshot, outputEvidence, output, r15JavaScriptQualification, moduleInfoObservations, profileObservations: adapter.profileObservations() };
}

async function makeBuildProfile({ fixtureRoot, outputDir, fixtureOptions, profileObservations, features }) {
  const configPaths = [
    "spikes/css-bundler/vite-module-graph-adapter.mjs",
    "spikes/css-bundler/vite-graph.config.mjs",
    "spikes/css-bundler/module-graph-contract.mjs",
    "spikes/css-bundler/package.json",
    "spikes/css-bundler/bun.lock",
  ];
  const configSources = [];
  for (const relativePath of configPaths) {
    const bytes = await readFile(path.join(repositoryRoot, relativePath));
    configSources.push({ path: relativePath, sha256: sha256(bytes) });
  }
  return {
    configSources,
    effectiveOptions: {
      fixtureRoot: path.resolve(fixtureRoot),
      outputDir: path.resolve(outputDir),
      entryPoints: { main: path.join(path.resolve(fixtureRoot), "index.js") },
      fixtureRoot: path.resolve(fixtureRoot),
      features: structuredClone(features),
      outputProfile: structuredClone(VITE_GRAPH_OUTPUT_PROFILE),
      fixturePluginOptions: fixtureOptions,
      resolvedViteConfig: profileObservations.resolvedViteConfig,
      capture: { writeBundleCallCount: profileObservations.writeBundleCallCount },
      runtimeVersions: { node: process.version, vite: viteVersion, rolldown: rolldownVersion, platform: process.platform, arch: process.arch },
      environment: { nodeEnv: process.env.NODE_ENV ?? "undefined" },
    },
  };
}

function failModuleParsedPlugin() {
  return profiledPlugin({
    name: "spinon-c02-module-parsed-failure-fixture",
    moduleParsed(info) {
      if (path.basename(info.id) === "index.js") throw new Error("fixture stops before adapter moduleParsed");
    },
  }, { role: "failure-fixture", failurePoint: "moduleParsed" });
}

function failingTransformPlugin() {
  return profiledPlugin({
    name: "spinon-c02-transform-failure-fixture",
    enforce: "pre",
    transform(_code, id) {
      if (path.basename(id) === "index.js") throw new Error("fixture transform failure");
      return null;
    },
  }, { role: "failure-fixture", failurePoint: "transform" });
}

function prependNewlinePlugin() {
  return profiledPlugin({
    name: "spinon-c02-newline-transform-fixture",
    enforce: "pre",
    transform(code, id) {
      if (path.basename(id) !== "index.js") return null;
      return { code: `\n${code}`, map: null };
    },
  }, { role: "transform-fixture", prependNewline: true });
}

function unresolvedOutputImportPlugin() {
  return profiledPlugin({
    name: "spinon-c02-unresolved-output-import-fixture",
    renderChunk(code, chunk) {
      if (!chunk.isEntry) return null;
      return { code: `import "./not-emitted.js";\n${code}`, map: null };
    },
  }, { role: "output-fixture", unresolvedImport: "./not-emitted.js" });
}

function outputCyclePlugin() {
  return profiledPlugin({
    name: "spinon-c02-output-cycle-fixture",
    renderChunk(code, chunk) {
      if (!chunk.isDynamicEntry) return null;
      return { code: `${code}\nimport "./main.js";\n`, map: null };
    },
  }, { role: "output-fixture", cycleTarget: "./main.js" });
}

function unknownModuleTypePlugin() {
  return profiledPlugin({
    name: "spinon-c02-unknown-module-type-fixture",
    load(id) {
      if (!id.endsWith("unknown-module.spinon")) return null;
      return { code: "export const unknownValue = 1;", moduleType: "unknown" };
    },
  }, { role: "failure-fixture", moduleType: "unknown" });
}

function outputSymlinkPlugin(kind) {
  return profiledPlugin({
    name: `spinon-c02-output-${kind}-symlink-fixture`,
    async writeBundle(options) {
      const root = path.resolve(options.dir);
      const assets = path.join(root, "assets");
      if (kind === "file") {
        const outputFile = path.join(assets, "main.js");
        const outsideFile = path.join(root, "..", "outside-main.js");
        await cp(outputFile, outsideFile);
        await rm(outputFile);
        await symlink(outsideFile, outputFile);
        return;
      }
      const outsideDirectory = path.join(root, "..", "outside-assets");
      await cp(assets, outsideDirectory, { recursive: true });
      await rm(assets, { recursive: true });
      await symlink(outsideDirectory, assets, "dir");
    },
  }, { role: "output-integrity-fixture", symlinkKind: kind });
}

function missingOutputResourcePlugin() {
  return profiledPlugin({
    name: "spinon-c02-output-missing-resource-fixture",
    async writeBundle(options) {
      await rm(path.join(options.dir, "assets", "main.js"));
    },
  }, { role: "output-integrity-fixture", missingResource: "assets/main.js" });
}

function outsideDependencyPlugin(outsidePath) {
  return profiledPlugin({
    name: "spinon-c02-outside-source-module-fixture",
    resolveId(source) {
      if (source === "virtual:outside-source") return outsidePath;
      return null;
    },
  }, { role: "failure-fixture", outsideDependency: path.basename(outsidePath) });
}

function moduleInfoObservationPlugin(observations, fixtureRoot) {
  return profiledPlugin({
    name: "spinon-c02-module-info-order-observer",
    moduleParsed(info) {
      const importedIds = [...(info.importedIds ?? [])];
      const dynamicallyImportedIds = [...(info.dynamicallyImportedIds ?? [])];
      observations.rawModuleParsedCallbackCount += 1;
      observations.rawStaticIdCount += importedIds.length;
      observations.rawDynamicIdCount += dynamicallyImportedIds.length;
      observations.rawStaticDuplicateIdCount += importedIds.length - new Set(importedIds.map(String)).size;
      observations.rawDynamicDuplicateIdCount += dynamicallyImportedIds.length - new Set(dynamicallyImportedIds.map(String)).size;
      observations.set(normalizeObservedModuleKey(info.id, fixtureRoot), {
        id: info.id,
        importedIds,
        dynamicallyImportedIds,
        moduleType: info.moduleType ?? null,
        hasViteAssetMeta: info.meta?.["vite:asset"] === true,
      });
    },
  }, { role: "api-observation", subject: "ModuleInfo dependency ID ordering" });
}

function duplicateWriteBundlePlugin(adapterPlugin) {
  return profiledPlugin({
    name: "spinon-c02-duplicate-write-bundle-hook-fixture",
    writeBundle(options, bundle) {
      adapterPlugin.writeBundle.call(this, options, bundle);
    },
  }, { role: "output-fixture", duplicateWriteBundleCall: true });
}

function profiledPlugin(plugin, options) {
  plugin.spinonC02ProfileOptions = structuredClone(options);
  return plugin;
}

function collectOutputItems(output) {
  const items = [];
  const pending = Array.isArray(output) ? [...output] : [output];
  while (pending.length > 0) {
    const item = pending.pop();
    if (Array.isArray(item)) {
      pending.push(...item);
    } else if (Array.isArray(item?.output)) {
      pending.push(...item.output);
    } else if (item?.type === "chunk" || item?.type === "asset") {
      items.push(item);
    }
  }
  return items;
}

function findOutputChunk(output, fileName) {
  return collectOutputItems(output).find((item) => item.type === "chunk" && item.fileName === fileName) ?? null;
}

async function makeFixture() {
  const container = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "spinon-c02-vite-")));
  const root = path.join(container, "fixture");
  const output = path.join(container, "output");
  await cp(fixtureSource, root, { recursive: true });
  const packageTarget = path.join(root, "node_modules", "@fixture", "exports-demo");
  await mkdir(path.dirname(packageTarget), { recursive: true });
  await cp(packageFixture, packageTarget, { recursive: true });
  return { container, root, output };
}

function normalizeModuleInfoIds(ids, fixtureRoot) {
  return ids.map((id) => {
    const value = String(id).replaceAll("\\", "/");
    if (value.startsWith("\0")) return `virtual:${sha256(value).slice(0, 24)}`;
    const pathname = value.split(/[?#]/, 1)[0];
    let canonicalRoot = path.resolve(fixtureRoot);
    let canonicalPath = path.resolve(pathname);
    try {
      canonicalRoot = realpathSync(canonicalRoot);
      canonicalPath = realpathSync(canonicalPath);
    } catch {}
    const relative = path.relative(canonicalRoot, canonicalPath);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.replaceAll("\\", "/") : value;
  });
}

function normalizeObservedModuleKey(id, fixtureRoot) {
  const value = String(id).replaceAll("\\", "/");
  if (value.startsWith("\0")) return `virtual:${sha256(value).slice(0, 24)}`;
  const pathname = value.split(/[?#]/, 1)[0];
  let canonicalRoot = path.resolve(fixtureRoot);
  let canonicalPath = path.resolve(pathname);
  try {
    canonicalRoot = realpathSync(canonicalRoot);
    canonicalPath = realpathSync(canonicalPath);
  } catch {}
  const relative = path.relative(canonicalRoot, canonicalPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return value;
  return relative.replaceAll("\\", "/");
}

async function cleanupFixture(container) {
  await rm(container, { recursive: true, force: true });
}

async function inventoryFixture(root) {
  const files = [];
  async function visit(current, relative = "") {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => compareCodepoint(left.name, right.name));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(path.join(current, entry.name), childRelative);
      } else if (entry.isFile()) {
        const bytes = await readFile(path.join(current, entry.name));
        files.push({ path: childRelative, bytes: bytes.byteLength, sha256: sha256(bytes) });
      } else {
        throw new Error(`fixture에 일반 파일/디렉터리가 아닌 항목이 있습니다: ${childRelative}`);
      }
    }
  }
  await visit(root);
  return files.sort((left, right) => compareCodepoint(left.path, right.path));
}

function compareCodepoint(left, right) {
  const a = Array.from(left, (value) => value.codePointAt(0));
  const b = Array.from(right, (value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
