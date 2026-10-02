import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import test from "node:test";
import {
  assertR15JavaScriptGraphInput,
  computeBuildProfileSha256,
  computeSourceGraphSha256,
  createModuleGraphSnapshot,
} from "./module-graph-contract.mjs";
import {
  buildRspackModuleGraph,
  captureRspackCompilationGraph,
  createRspackModuleGraphSnapshot,
  assertOutputDirectoryDoesNotOverlapFixture,
  detectOutputTargetConflicts,
} from "./rspack-module-graph-adapter.mjs";
import { createRspackGraphConfig, RSPACK_GRAPH_PROFILE_NAMES } from "./rspack-graph.config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixture-rspack-graph");

test("modern-module 출력은 실제 ESM edge·resource digest와 입력 graph를 분리한다", async () => {
  const outputDir = await temporaryOutput("modern");
  try {
    const snapshot = await buildRspackModuleGraph({
      profile: RSPACK_GRAPH_PROFILE_NAMES.modernModule,
      fixtureRoot,
      outputDir,
    });

    assert.equal(snapshot.build.status, "success", JSON.stringify({ diagnostics: snapshot.diagnostics, chunks: snapshot.outputGraph.chunks }, null, 2));
    assert.deepEqual(snapshot.build.profile.effectiveOptions.runtimeVersions, {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    });
    assert.equal(snapshot.build.profile.effectiveOptions.output.clean, false);
    assert.equal(snapshot.sourceGraph.status, "complete");
    assert.equal(snapshot.outputGraph.status, "complete");
    assert.equal(snapshot.outputGraph.moduleFormat, "esm");
    assert.deepEqual(snapshot.diagnostics, []);
    const javaScriptGraphInput = assertR15JavaScriptGraphInput(snapshot);
    assert.equal(javaScriptGraphInput.requiresAppWideImpactFallback, true);
    assert.equal(javaScriptGraphInput.requiresResourceGraphJoin, true);
    const unresolvedExcluded = structuredClone(snapshot);
    unresolvedExcluded.sourceGraph.excludedDependencies[0].resolvedResourceKey = null;
    unresolvedExcluded.sourceGraph.sha256 = computeSourceGraphSha256(unresolvedExcluded.sourceGraph);
    assert.throws(() => assertR15JavaScriptGraphInput(unresolvedExcluded), /미해결 stylesheet 또는 asset dependency/);
    assert.equal(snapshot.features.length, 1);
    assert.equal(snapshot.features[0].id, "main");
    assert.equal(snapshot.features[0].entrySourceKey, "src/main.js");
    assert.equal(snapshot.sourceGraph.edgeCount, 18);
    assert.equal(snapshot.sourceGraph.excludedDependencyCount, 1);
    assert.deepEqual(snapshot.sourceGraph.excludedDependencies[0], {
      referrerModuleKey: "src/main.js",
      kind: "static",
      sourceSpecifier: "./screen.css",
      targetKind: "stylesheet",
      resolvedResourceKey: "src/screen.css",
      source: { file: "src/main.js", line: 10, column: 1 },
    });

    assert.ok(snapshot.sourceGraph.dependencies.some((edge) =>
      edge.sourceSpecifier === "@spinon/exports-fixture"
      && edge.resolvedModuleKey === "node_modules/@spinon/exports-fixture/src/index.js"));
    assert.ok(snapshot.sourceGraph.dependencies.some((edge) =>
      edge.sourceSpecifier === "./virtual-entry.js" && edge.resolvedModuleKey === "src/virtual-entry.js"));
    assert.ok(snapshot.sourceGraph.dependencies.some((edge) =>
      edge.referrerModuleKey === "src/same.js" && edge.resolvedModuleKey === "src/shared.js"));
    assert.ok(snapshot.sourceGraph.dependencies.some((edge) =>
      edge.referrerModuleKey === "src/shared.js" && edge.resolvedModuleKey === "src/same.js"));

    const sourceSameEdges = snapshot.sourceGraph.dependencies.filter((edge) => edge.sourceSpecifier === "@graph/same.js");
    assert.deepEqual(sourceSameEdges.map((edge) => edge.kind).sort(), ["dynamic", "dynamic", "static", "static"]);
    assert.deepEqual(new Set(sourceSameEdges.map((edge) => edge.resolvedModuleKey)), new Set(["src/same.js"]));
    assert.equal(new Set(sourceSameEdges.map((edge) => `${edge.source.line}:${edge.source.column}`)).size, 4);

    const entryChunk = snapshot.outputGraph.chunks.find((chunk) => chunk.id === snapshot.features[0].entryChunkId);
    const emittedSameEdges = entryChunk.dependencies.filter((edge) => edge.specifier === "./same.js");
    assert.deepEqual(emittedSameEdges.map((edge) => edge.kind).sort(), ["dynamic", "static"]);
    assert.equal(new Set(emittedSameEdges.map((edge) => edge.chunkId)).size, 1);
    assert.equal(snapshot.outputGraph.chunks.find((chunk) => chunk.id === emittedSameEdges[0].chunkId).javascriptResourceId, "resource:same.js");
    assert.ok(!entryChunk.dependencies.some((edge) => edge.specifier === "@graph/same.js"));
    assert.ok(snapshot.sourceGraph.dependencies.some((edge) => edge.resolvedModuleKey === "src/re-export.js"));
    assert.equal(snapshot.sourceGraph.modules.find((module) => module.key === "src/tree-shaken.js").outputChunkIds.length, 0);

    const metaResource = snapshot.outputGraph.resources.find((resource) => resource.outputPath.endsWith("module-meta.js"));
    assert.ok(metaResource);
    const metaCode = await readFile(path.join(outputDir, metaResource.outputPath), "utf8");
    assert.match(metaCode, /\bawait\b/);
    assert.equal(snapshot.outputGraph.chunks.find((chunk) => chunk.javascriptResourceId === metaResource.id)?.moduleFormat, "esm");
    const sideEffectChunk = snapshot.outputGraph.chunks.find((chunk) => chunk.sourceModuleKeys.includes("src/side-effect.js"));
    assert.equal(sideEffectChunk?.moduleFormat, "esm");
    const sideEffectResource = snapshot.outputGraph.resources.find((resource) => resource.id === sideEffectChunk.javascriptResourceId);
    assert.match(await readFile(path.join(outputDir, sideEffectResource.outputPath), "utf8"), /console\.log/);
    const dynamicOnlyChunk = snapshot.outputGraph.chunks.find((chunk) => chunk.sourceModuleKeys.includes("src/dynamic-only.js"));
    assert.equal(dynamicOnlyChunk?.moduleFormat, "esm");
    assert.ok(dynamicOnlyChunk.dependencies.some((edge) => edge.kind === "dynamic"));

    for (const resource of snapshot.outputGraph.resources) {
      const bytes = await readFile(path.join(outputDir, resource.outputPath));
      assert.equal(resource.bytes, bytes.byteLength);
      assert.equal(resource.sha256, createHash("sha256").update(bytes).digest("hex"));
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("반복 modern-module build의 입력·profile·출력 digest가 같다", async () => {
  const outputA = await temporaryOutput("repeat-a");
  const outputB = await temporaryOutput("repeat-b");
  try {
    const [first, second] = await Promise.all([
      buildRspackModuleGraph({ profile: RSPACK_GRAPH_PROFILE_NAMES.modernModule, fixtureRoot, outputDir: outputA }),
      buildRspackModuleGraph({ profile: RSPACK_GRAPH_PROFILE_NAMES.modernModule, fixtureRoot, outputDir: outputB }),
    ]);
    const comparable = (snapshot) => {
      const resourcePathById = new Map(snapshot.outputGraph.resources.map((resource) => [resource.id, resource.outputPath]));
      return {
        fixtureSha256: snapshot.build.fixtureSha256,
        profile: snapshot.build.profile,
        buildProfileSha256: snapshot.build.buildProfileSha256,
        sourceGraphSha256: snapshot.sourceGraph.sha256,
        resources: snapshot.outputGraph.resources.map(({ outputPath, bytes, sha256 }) => ({ outputPath, bytes, sha256 })),
        chunks: snapshot.outputGraph.chunks.map((chunk) => ({
          resource: resourcePathById.get(chunk.javascriptResourceId),
          kind: chunk.kind,
          moduleFormat: chunk.moduleFormat,
          sourceModuleKeys: chunk.sourceModuleKeys,
          dependencies: chunk.dependencies.map((edge) => ({
            ...edge,
            target: edge.chunkId === null
              ? null
              : resourcePathById.get(snapshot.outputGraph.chunks.find((candidate) => candidate.id === edge.chunkId)?.javascriptResourceId),
          })),
        })).sort((left, right) => left.resource < right.resource ? -1 : left.resource > right.resource ? 1 : 0),
      };
    };
    assert.deepEqual(comparable(first), comparable(second));
  } finally {
    await Promise.all([
      rm(path.dirname(outputA), { recursive: true, force: true }),
      rm(path.dirname(outputB), { recursive: true, force: true }),
    ]);
  }
});

test("기본 runtime 출력은 최종 ESM graph를 입증하지 못해 거부한다", async () => {
  const outputDir = await temporaryOutput("runtime");
  try {
    const snapshot = await buildRspackModuleGraph({
      profile: RSPACK_GRAPH_PROFILE_NAMES.runtime,
      fixtureRoot,
      outputDir,
    });
    assert.equal(snapshot.build.status, "failed");
    assert.equal(snapshot.sourceGraph.status, "complete");
    assert.equal(snapshot.outputGraph.status, "incomplete");
    assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_OUTPUT_NOT_ESM"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("output.module의 runtime 계산형 import는 실제 ESM graph로 승인하지 않는다", async () => {
  const outputDir = await temporaryOutput("output-module");
  try {
    const snapshot = await buildRspackModuleGraph({
      profile: RSPACK_GRAPH_PROFILE_NAMES.module,
      fixtureRoot,
      outputDir,
    });
    assert.equal(snapshot.build.status, "failed");
    assert.equal(snapshot.outputGraph.status, "incomplete");
    assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNSUPPORTED_IMPORT"));
    assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_OUTPUT_NOT_ESM"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("같은 원본 referrer/specifier의 static·dynamic target 충돌을 거부한다", async () => {
  const main = fixtureModule("src/main.js");
  const same = fixtureModule("src/same.js");
  const shared = fixtureModule("src/shared.js");
  const connections = new Map([
    [main, [
      { dependency: { type: "esm import", request: "@graph/same.js" }, resolvedModule: same },
      { dependency: { type: "esm import", request: "@graph/same.js" }, resolvedModule: same },
      { dependency: { type: "import()", request: "@graph/same.js" }, resolvedModule: shared },
      { dependency: { type: "import()", request: "@graph/same.js" }, resolvedModule: shared },
    ]],
    [same, []],
    [shared, []],
  ]);
  const compilation = {
    modules: new Set([main, same, shared]),
    chunks: [],
    moduleGraph: { getOutgoingConnections: (module) => connections.get(module) ?? [] },
    chunkGraph: { getModuleChunksIterable: () => [] },
  };

  const result = await captureRspackCompilationGraph(compilation, fixtureRoot);
  assert.ok(result.diagnostics.some((item) => item.code === "C02_GRAPH_TARGET_CONFLICT" && item.stage === "source-graph"));
});

test("위치 없는 반복 connection 수가 원본 occurrence와 다르면 불완전으로 닫는다", async () => {
  const main = fixtureModule("src/main.js");
  const same = fixtureModule("src/same.js");
  const compilation = {
    modules: new Set([main, same]),
    chunks: [],
    moduleGraph: {
      getOutgoingConnections: (module) => module === main
        ? [{ dependency: { type: "import()", request: "@graph/same.js" }, resolvedModule: same }]
        : [],
    },
    chunkGraph: { getModuleChunksIterable: () => [] },
  };
  const result = await captureRspackCompilationGraph(compilation, fixtureRoot);
  assert.ok(result.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "source-graph"));
});

test("같은 source 위치의 중복 canonical connection은 같은 target이어도 불완전으로 닫는다", async () => {
  const temporary = await createFixtureBuild("duplicate-located-canonical", {
    "src/main.js": 'import { value } from "./target.js";\n',
    "src/target.js": "export const value = true;\n",
  });
  const mainPath = path.join(temporary.fixtureRoot, "src", "main.js");
  const targetPath = path.join(temporary.fixtureRoot, "src", "target.js");
  const mainSource = readFileSync(mainPath, "utf8");
  const main = {
    resource: mainPath,
    type: "javascript/esm",
    identifier: () => mainPath,
    originalSource: () => ({ source: () => Buffer.from(mainSource) }),
  };
  const target = {
    resource: targetPath,
    type: "javascript/esm",
    identifier: () => targetPath,
    originalSource: () => ({ source: () => readFileSync(targetPath) }),
  };
  const sourceNode = parse(mainSource, { ecmaVersion: "latest", sourceType: "module", locations: true }).body[0];
  const dependency = {
    type: "esm import",
    request: "./target.js",
    loc: {
      start: { line: sourceNode.loc.start.line, column: sourceNode.loc.start.column + 1 },
      end: { line: sourceNode.loc.end.line, column: sourceNode.loc.end.column + 1 },
    },
  };
  const compilation = {
    modules: new Set([main, target]),
    chunks: [],
    moduleGraph: {
      getOutgoingConnections: (module) => module === main
        ? [
          { dependency, resolvedModule: target },
          { dependency: { ...dependency }, resolvedModule: target },
        ]
        : [],
    },
    chunkGraph: { getModuleChunksIterable: () => [] },
  };

  try {
    const result = await captureRspackCompilationGraph(compilation, temporary.fixtureRoot);
    assert.ok(result.diagnostics.some((item) =>
      item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"
      && item.stage === "source-graph"
      && item.message.includes("여러 canonical Rspack connection")));
    assert.equal(result.graph.dependencies.length, 0);
  } finally {
    await temporary.cleanup();
  }
});

test("excluded stylesheet가 fixture resource key로 해소되지 않으면 source graph를 불완전 처리한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-unresolved-css-"));
  const customFixtureRoot = path.join(root, "fixture");
  const sourceDirectory = path.join(customFixtureRoot, "src");
  const sourcePath = path.join(sourceDirectory, "main.js");
  const outsideStylesheetPath = path.join(root, "outside.css");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(sourcePath, 'import "./outside.css";\n');
  await writeFile(outsideStylesheetPath, ".outside { color: red; }\n");
  const main = {
    resource: sourcePath,
    type: "javascript/esm",
    identifier: () => sourcePath,
    originalSource: () => ({ source: () => readFileSync(sourcePath) }),
  };
  const stylesheet = {
    resource: outsideStylesheetPath,
    type: "css/auto",
    identifier: () => outsideStylesheetPath,
  };
  const compilation = {
    modules: new Set([main, stylesheet]),
    chunks: [],
    moduleGraph: {
      getOutgoingConnections: (module) => module === main
        ? [{ dependency: { type: "esm import", request: "./outside.css" }, resolvedModule: stylesheet }]
        : [],
    },
    chunkGraph: { getModuleChunksIterable: () => [] },
  };
  try {
    const result = await captureRspackCompilationGraph(compilation, customFixtureRoot);
    assert.equal(result.graph.excludedDependencies[0].resolvedResourceKey, null);
    assert.ok(result.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "source-graph"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("emitted ESM의 기존 CSS target을 누락하지 않고 C02.2 범위 밖으로 거부한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-non-js-target-"));
  const outputDir = path.join(root, "output");
  await mkdir(outputDir, { recursive: true });
  try {
    await writeFile(path.join(outputDir, "main.js"), 'import "./screen.css"; export const ready = true;\n');
    await writeFile(path.join(outputDir, "screen.css"), ".screen { display: block; }\n");
    const profile = {
      configSources: [{ path: "fixture/config.mjs", sha256: "a".repeat(64) }],
      effectiveOptions: { moduleFormat: "esm" },
    };
    const partial = await createRspackModuleGraphSnapshot({
      stats: {
        assets: [{ name: "main.js" }, { name: "screen.css" }],
        chunks: [{ id: 1, entry: true, initial: true, files: ["main.js"] }],
        errors: [],
      },
      compilationGraph: {
        graph: {
          scope: "javascript-module-dependencies",
          modules: [{ key: "src/main.js", outputChunkIds: ["chunk:1"] }],
          dependencies: [],
          excludedDependencies: [],
        },
        diagnostics: [],
      },
      fixtureRoot,
      outputDir,
      profile: "emitted-css-fixture",
      buildProfile: profile,
      features: [{ id: "main", entrySourceKey: "src/main.js" }],
      toolVersion: "2.2.7",
      fixtureSha256: "b".repeat(64),
      buildProfileSha256: computeBuildProfileSha256(profile),
    });
    const snapshot = createModuleGraphSnapshot(partial);
    assert.equal(snapshot.build.status, "failed");
    assert.equal(snapshot.outputGraph.status, "incomplete");
    assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_UNSUPPORTED_IMPORT" && item.stage === "output-graph"));
    assert.deepEqual(snapshot.outputGraph.chunks[0].dependencies, [
      { kind: "static", specifier: "./screen.css", chunkId: null },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture digest가 파일 symlink와 symlink root를 읽기 전에 거부한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-fixture-symlink-"));
  const fixture = path.join(root, "fixture");
  const sourceDirectory = path.join(fixture, "src");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(path.join(sourceDirectory, "main.js"), "export const ready = true;\n");
  await writeFile(path.join(sourceDirectory, "same.js"), "export const same = true;\n");
  const fileLink = path.join(sourceDirectory, "linked.js");
  const rootLink = path.join(root, "fixture-link");
  await symlink(path.join(sourceDirectory, "same.js"), fileLink);
  await symlink(fixture, rootLink);
  try {
    await assert.rejects(
      buildRspackModuleGraph({ fixtureRoot: fixture, outputDir: path.join(root, "output") }),
      /fixture 항목은 일반 파일이어야 합니다: src\/linked\.js/,
    );
    await assert.rejects(
      buildRspackModuleGraph({ fixtureRoot: rootLink, outputDir: path.join(root, "root-output") }),
      /fixture root는 일반 디렉터리여야 합니다/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output clean은 fixture·프로젝트·보호 경로의 실제 경로 overlap을 compiler 전에 거부한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-clean-guard-"));
  const fixture = path.join(root, "fixture");
  const source = path.join(fixture, "src", "main.js");
  const sentinel = path.join(fixture, "sentinel.txt");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "export const ready = true;\n");
  await writeFile(sentinel, "preserve fixture\n");
  const paths = [fixture, root, path.join(fixture, "new", "output")];

  try {
    for (const outputDir of paths) {
      await assert.rejects(
        buildRspackModuleGraph({ fixtureRoot: fixture, outputDir }),
        /outputDir와 보호 경로가 실제 경로에서 겹쳐 output\.clean을 안전하게 실행할 수 없습니다/,
      );
      assert.equal(await readFile(sentinel, "utf8"), "preserve fixture\n");
    }
    await assert.rejects(lstat(path.join(fixture, "new")), { code: "ENOENT" });
    await assert.rejects(
      assertOutputDirectoryDoesNotOverlapFixture({
        fixtureRoot: fixture,
        outputDir: path.join(path.dirname(tmpdir()), "outside-temporary-root", "output"),
      }),
      /outputDir는 OS 임시 디렉터리 내부의 전용 하위 경로여야 합니다/,
    );

    const protectedProject = path.join(root, "project");
    const protectedFixture = path.join(root, "other-fixture");
    const projectSentinel = path.join(protectedProject, "keep.txt");
    await mkdir(protectedProject);
    await mkdir(protectedFixture);
    await writeFile(projectSentinel, "preserve project\n");
    const symlinkParent = path.join(root, "project-alias");
    await symlink(protectedProject, symlinkParent);
    for (const outputDir of [
      protectedProject,
      path.dirname(protectedProject),
      path.join(protectedProject, "not-created"),
      path.join(symlinkParent, "not-created"),
    ]) {
      await assert.rejects(
        assertOutputDirectoryDoesNotOverlapFixture({
          fixtureRoot: protectedFixture,
          outputDir,
          protectedRoots: [protectedProject],
        }),
        /outputDir와 보호 경로가 실제 경로에서 겹쳐 output\.clean을 안전하게 실행할 수 없습니다/,
      );
      assert.equal(await readFile(projectSentinel, "utf8"), "preserve project\n");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("기존 임시 output 디렉터리는 build 전에 거부해 sentinel을 보존한다", async () => {
  const temporary = await createFixtureBuild("preexisting-output-sentinel", {
    "src/main.js": "export const ready = true;\n",
  });
  const sentinel = path.join(temporary.outputDir, "keep.txt");
  await mkdir(temporary.outputDir, { recursive: true });
  await writeFile(sentinel, "preserve output\n");
  try {
    await assert.rejects(
      buildRspackModuleGraph({ fixtureRoot: temporary.fixtureRoot, outputDir: temporary.outputDir }),
      /outputDir는 build 시작 전에 존재하지 않는 전용 경로여야 합니다/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "preserve output\n");
  } finally {
    await temporary.cleanup();
  }
});

test("같은 output 경로를 동시에 요청하면 한 build만 디렉터리 소유권을 얻는다", async () => {
  const temporary = await createFixtureBuild("exclusive-output-reservation", {
    "src/main.js": "export const ready = true;\n",
  });
  try {
    const results = await Promise.allSettled([
      buildRspackModuleGraph({ fixtureRoot: temporary.fixtureRoot, outputDir: temporary.outputDir }),
      buildRspackModuleGraph({ fixtureRoot: temporary.fixtureRoot, outputDir: temporary.outputDir }),
    ]);
    const successes = results.filter((result) => result.status === "fulfilled");
    const failures = results.filter((result) => result.status === "rejected");
    assert.equal(successes.length, 1, JSON.stringify(results, null, 2));
    assert.equal(successes[0].value.build.status, "success");
    assert.equal(failures.length, 1);
    assert.match(failures[0].reason.message, /outputDir/);
  } finally {
    await temporary.cleanup();
  }
});

test("fixture digest는 계약 필드 순서와 Unicode code point 경로 순서를 따른다", async () => {
  const files = {
    "src/main.js": "export const ready = true;\n",
    "src/\uE000.js": "export const bmp = true;\n",
    "src/😀.js": "export const astral = true;\n",
  };
  const temporary = await createFixtureBuild("fixture-unicode-order", files);
  try {
    const snapshot = await buildRspackModuleGraph({ fixtureRoot: temporary.fixtureRoot, outputDir: temporary.outputDir });
    const compareCodePoints = (left, right) => {
      const leftPoints = Array.from(left, (value) => value.codePointAt(0));
      const rightPoints = Array.from(right, (value) => value.codePointAt(0));
      const sharedLength = Math.min(leftPoints.length, rightPoints.length);
      for (let index = 0; index < sharedLength; index += 1) {
        if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
      }
      return leftPoints.length - rightPoints.length;
    };
    const inventory = Object.entries(files).map(([relativePath, source]) => {
      const bytes = Buffer.from(source, "utf8");
      return {
        path: relativePath,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }).sort((left, right) => compareCodePoints(left.path, right.path));
    const expectedFixtureSha256 = createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
    assert.equal(snapshot.build.status, "success", JSON.stringify(snapshot.diagnostics, null, 2));
    assert.equal(snapshot.build.fixtureSha256, expectedFixtureSha256);
  } finally {
    await temporary.cleanup();
  }
});

test("Rspack output root, file, directory symlink는 bytes 수집 전에 거부한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-output-symlink-"));
  const fixtureRootForSnapshot = path.join(root, "fixture");
  const outside = path.join(root, "outside");
  const realOutput = path.join(root, "real-output");
  const fileLinkOutput = path.join(root, "file-link-output");
  const directoryLinkOutput = path.join(root, "directory-link-output");
  const rootLink = path.join(root, "root-link");
  await mkdir(path.join(fixtureRootForSnapshot, "src"), { recursive: true });
  await mkdir(outside);
  await mkdir(realOutput);
  await mkdir(fileLinkOutput);
  await mkdir(directoryLinkOutput);
  await writeFile(path.join(fixtureRootForSnapshot, "src", "main.js"), "export const ready = true;\n");
  await writeFile(path.join(outside, "main.js"), "export const secret = 'outside';\n");
  await writeFile(path.join(outside, "asset.js"), "export const nested = true;\n");
  await symlink(path.join(outside, "main.js"), path.join(fileLinkOutput, "main.js"));
  await symlink(outside, path.join(directoryLinkOutput, "assets"));
  await symlink(realOutput, rootLink);

  const profile = {
    configSources: [{ path: "fixture/config.mjs", sha256: "a".repeat(64) }],
    effectiveOptions: { moduleFormat: "esm" },
  };
  const createSnapshot = (outputDir, outputPath = "main.js") => createRspackModuleGraphSnapshot({
    stats: {
      assets: [{ name: outputPath }],
      chunks: [{ id: 1, entry: true, initial: true, files: [outputPath] }],
      errors: [],
    },
    compilationGraph: {
      graph: {
        scope: "javascript-module-dependencies",
        modules: [{ key: "src/main.js", outputChunkIds: ["chunk:1"] }],
        dependencies: [],
        excludedDependencies: [],
      },
      diagnostics: [],
    },
    fixtureRoot: fixtureRootForSnapshot,
    outputDir,
    profile: "symlink-output-fixture",
    buildProfile: profile,
    features: [{ id: "main", entrySourceKey: "src/main.js" }],
    toolVersion: "2.2.7",
    fixtureSha256: "b".repeat(64),
    buildProfileSha256: computeBuildProfileSha256(profile),
  });

  try {
    const cases = [
      [fileLinkOutput, "main.js"],
      [directoryLinkOutput, "assets/main.js"],
      [rootLink, "main.js"],
    ];
    for (const [outputDir, outputPath] of cases) {
      const snapshot = await createSnapshot(outputDir, outputPath);
      assert.equal(snapshot.build.status, "failed");
      assert.equal(snapshot.outputGraph.resources.length, 0);
      assert.ok(snapshot.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "output-graph"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resource-less virtual JavaScript module은 chunkGraph 순회에서 안정 진단으로 닫는다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-virtual-module-"));
  const customFixture = path.join(root, "fixture");
  const mainPath = path.join(customFixture, "src", "main.js");
  await mkdir(path.dirname(mainPath), { recursive: true });
  await writeFile(mainPath, "export const ready = true;\n");
  const main = {
    resource: mainPath,
    type: "javascript/esm",
    identifier: () => mainPath,
    originalSource: () => ({ source: () => readFileSync(mainPath) }),
  };
  const virtual = {
    type: "javascript/esm",
    identifier: () => "virtual spinon generated module",
  };
  const container = {
    type: "javascript/esm",
    modules: [virtual],
    identifier: () => "concatenated container",
  };
  const chunk = { id: 1, name: "main" };
  const compilation = {
    modules: new Set([main, container]),
    chunks: [chunk],
    moduleGraph: {
      getOutgoingConnections: (module) => module === container ? [{ dependency: { type: "synthetic raw connection" } }] : [],
    },
    chunkGraph: {
      getOrderedChunkModulesIterable: () => [main, container],
      getModuleChunksIterable: (module) => module === main ? [chunk] : [],
    },
  };
  try {
    const result = await captureRspackCompilationGraph(compilation, customFixture);
    assert.ok(result.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "source-graph" && item.message.includes("virtual module")));
    assert.ok(result.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "chunk-graph" && item.message.includes("virtual spinon generated module")));
    assert.equal(result.observedJavaScriptModuleCount, 2);
    assert.equal(result.normalizedJavaScriptModuleCount, 1);
    assert.equal(result.graph.modules.length, 1);
    assert.equal(result.observedConnectionCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("truthy non-string JavaScript resource는 예외 대신 안정 진단으로 닫는다", async () => {
  const temporary = await createFixtureBuild("non-string-resource", {
    "src/main.js": "export const ready = true;\n",
  });
  const malformed = {
    resource: { path: path.join(temporary.fixtureRoot, "src", "main.js") },
    type: "javascript/esm",
    identifier: () => "synthetic non-string resource module",
  };
  try {
    const result = await captureRspackCompilationGraph({
      modules: new Set([malformed]),
      chunks: [],
      moduleGraph: { getOutgoingConnections: () => [] },
      chunkGraph: { getModuleChunksIterable: () => [] },
    }, temporary.fixtureRoot);
    assert.ok(result.diagnostics.some((item) =>
      item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"
      && item.stage === "source-graph"
      && item.message.includes("synthetic non-string resource module")));
    assert.deepEqual(result.graph.modules, []);
  } finally {
    await temporary.cleanup();
  }
});

test("virtual source fallback은 fixture manifest 경로와 compiler bytes가 정확히 일치할 때만 허용한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-virtual-source-"));
  const customFixture = path.join(root, "fixture");
  const mainPath = path.join(customFixture, "src", "main.js");
  const virtualPath = path.join(customFixture, "src", "generated.js");
  const virtualSource = "export const generated = true;\n";
  await mkdir(path.dirname(mainPath), { recursive: true });
  await writeFile(mainPath, 'import { generated } from "./generated.js";\nexport const ready = generated;\n');
  const main = {
    resource: mainPath,
    type: "javascript/esm",
    identifier: () => mainPath,
    originalSource: () => ({ source: () => readFileSync(mainPath) }),
  };
  const virtual = {
    resource: virtualPath,
    type: "javascript/esm",
    identifier: () => virtualPath,
    originalSource: () => ({ source: () => virtualSource }),
  };
  const compilation = {
    modules: new Set([main, virtual]),
    chunks: [],
    moduleGraph: {
      getOutgoingConnections: (module) => module === main
        ? [{ dependency: { type: "esm import", request: "./generated.js" }, resolvedModule: virtual }]
        : [],
    },
    chunkGraph: { getModuleChunksIterable: () => [] },
  };
  try {
    const accepted = await captureRspackCompilationGraph(compilation, customFixture, {
      virtualSourceByPath: { [virtualPath]: virtualSource },
    });
    assert.equal(accepted.graph.dependencies[0].resolvedModuleKey, "src/generated.js");
    assert.ok(!accepted.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.referrerModuleKey === "src/generated.js"));

    const undeclared = await captureRspackCompilationGraph(compilation, customFixture);
    assert.ok(undeclared.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.referrerModuleKey === "src/generated.js"));

    const mismatch = await captureRspackCompilationGraph(compilation, customFixture, {
      virtualSourceByPath: { [virtualPath]: "export const generated = false;\n" },
    });
    assert.ok(mismatch.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.referrerModuleKey === "src/generated.js"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Rspack external module connection은 bare/external edge 진단으로 분류한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-external-module-"));
  const customFixture = path.join(root, "fixture");
  const mainPath = path.join(customFixture, "src", "main.js");
  await mkdir(path.dirname(mainPath), { recursive: true });
  await writeFile(mainPath, 'import "https://cdn.example.invalid/runtime.js";\nexport const ready = true;\n');
  const main = {
    resource: mainPath,
    type: "javascript/esm",
    identifier: () => mainPath,
    originalSource: () => ({ source: () => readFileSync(mainPath) }),
  };
  const external = {
    type: "javascript/dynamic",
    identifier: () => 'external "https://cdn.example.invalid/runtime.js"',
  };
  const compilation = {
    modules: new Set([main]),
    chunks: [],
    moduleGraph: {
      getOutgoingConnections: (module) => module === main
        ? [{ dependency: { type: "esm import", request: "https://cdn.example.invalid/runtime.js" }, resolvedModule: external }]
        : [],
    },
    chunkGraph: { getModuleChunksIterable: () => [] },
  };
  try {
    const result = await captureRspackCompilationGraph(compilation, customFixture);
    assert.ok(result.diagnostics.some((item) => item.code === "C02_GRAPH_EXTERNAL_IMPORT" && item.specifier === "https://cdn.example.invalid/runtime.js"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("반복 unresolved source specifier는 각 원본 위치 진단을 보존한다", async () => {
  const temporary = await createFixtureBuild("duplicate-unresolved", {
    "src/main.js": 'import "./missing.js";\nimport "./missing.js";\nexport const ready = true;\n',
  });
  try {
    const snapshot = await buildRspackModuleGraph({ fixtureRoot: temporary.fixtureRoot, outputDir: temporary.outputDir });
    const diagnostics = snapshot.diagnostics.filter((item) =>
      item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"
      && item.stage === "source-graph"
      && item.specifier === "./missing.js"
      && item.source !== null);
    assert.deepEqual(diagnostics.map((item) => item.source?.line).sort(), [1, 2], JSON.stringify(snapshot.diagnostics, null, 2));
  } finally {
    await temporary.cleanup();
  }
});

test("0014 실패 fixture는 bare/unresolved, non-literal dynamic, attributes와 non-JS 경계를 거부한다", async () => {
  const cases = [
    ["bare", 'import value from "spinon-missing-package";\nexport default value;\n', "C02_GRAPH_UNRESOLVED_IMPORT"],
    ["unresolved", 'import "./missing.js";\nexport const ready = true;\n', "C02_GRAPH_UNRESOLVED_IMPORT"],
    ["dynamic", 'const target = "./lazy.js";\nexport const load = () => import(target);\n', "C02_GRAPH_UNSUPPORTED_IMPORT"],
    ["attributes", 'import config from "./config.json" with { type: "json" };\nexport default config;\n', "C02_GRAPH_UNSUPPORTED_IMPORT"],
    ["non-js", 'import config from "./config.json";\nexport default config;\n', "C02_GRAPH_UNSUPPORTED_IMPORT"],
  ];
  for (const [name, source, expectedCode] of cases) {
    const extraFiles = name === "attributes" || name === "non-js"
      ? { "src/config.json": '{"ready":true}\n' }
      : {};
    const temporary = await createFixtureBuild(name, { "src/main.js": source, ...extraFiles });
    try {
      const snapshot = await buildRspackModuleGraph({ fixtureRoot: temporary.fixtureRoot, outputDir: temporary.outputDir });
      assert.equal(snapshot.build.status, "failed", `${name} fixture should fail`);
      assert.ok(snapshot.diagnostics.some((item) => item.code === expectedCode), `${name}: ${expectedCode}\n${JSON.stringify(snapshot.diagnostics, null, 2)}`);
    } finally {
      await temporary.cleanup();
    }
  }
});

test("Acorn이 import phase 구문을 파싱하지 못하면 unsupported 진단으로 닫는다", async () => {
  const temporary = await createFixtureBuild("import-phase", {
    "src/main.js": 'import defer * as deferred from "./same.js";\nexport const ready = deferred;\n',
    "src/same.js": "export const value = true;\n",
  });
  const mainPath = path.join(temporary.fixtureRoot, "src", "main.js");
  const main = {
    resource: mainPath,
    type: "javascript/esm",
    identifier: () => mainPath,
    originalSource: () => ({ source: () => readFileSync(mainPath) }),
  };
  try {
    const result = await captureRspackCompilationGraph({
      modules: new Set([main]),
      chunks: [],
      moduleGraph: { getOutgoingConnections: () => [] },
      chunkGraph: { getModuleChunksIterable: () => [] },
    }, temporary.fixtureRoot);
    assert.ok(result.diagnostics.some((item) =>
      item.code === "C02_GRAPH_UNSUPPORTED_IMPORT"
      && item.stage === "source-graph"
      && item.message.includes("Acorn")));
  } finally {
    await temporary.cleanup();
  }
});

test("중복 virtual manifest 경로를 compiler 실행 전에 거부한다", async () => {
  const temporary = await createFixtureBuild("duplicate-virtual-manifest", {
    "src/main.js": "export const ready = true;\n",
    "virtual-modules.json": JSON.stringify({
      modules: [
        { path: "src/generated.js", source: "export const first = true;\n" },
        { path: "src/generated.js", source: "export const second = true;\n" },
      ],
    }),
  });
  try {
    await assert.rejects(
      buildRspackModuleGraph({ fixtureRoot: temporary.fixtureRoot, outputDir: temporary.outputDir }),
      /virtual module path가 중복 선언되었습니다: src\/generated\.js/,
    );
    await assert.rejects(lstat(temporary.outputDir), { code: "ENOENT" });
  } finally {
    await temporary.cleanup();
  }
});

test("고정된 main entry와 일치하지 않는 feature 선언을 compiler 실행 전에 거부한다", async () => {
  const temporary = await createFixtureBuild("feature-entry-mismatch", {
    "src/main.js": "export const ready = true;\n",
    "src/other.js": "export const other = true;\n",
  });
  try {
    await assert.rejects(
      buildRspackModuleGraph({
        fixtureRoot: temporary.fixtureRoot,
        outputDir: temporary.outputDir,
        features: [{ id: "other", entrySourceKey: "src/other.js" }],
      }),
      /단일 entry "main" -> "src\/main\.js" feature만 지원/,
    );
    await assert.rejects(lstat(temporary.outputDir), { code: "ENOENT" });
  } finally {
    await temporary.cleanup();
  }
});

test("compiler originalSource bytes를 fixture 시작 snapshot과 대조하고 누락·불일치를 거부한다", async () => {
  const temporary = await createFixtureBuild("compiler-source-bytes", {
    "src/main.js": "export const ready = true;\n",
  });
  const sourcePath = path.join(temporary.fixtureRoot, "src", "main.js");
  const expectedBytes = readFileSync(sourcePath);
  const createCompilation = (originalSource) => {
    const module = {
      resource: sourcePath,
      type: "javascript/esm",
      identifier: () => sourcePath,
      originalSource,
    };
    return {
      modules: new Set([module]),
      chunks: [],
      moduleGraph: { getOutgoingConnections: () => [] },
      chunkGraph: { getModuleChunksIterable: () => [] },
    };
  };

  try {
    for (const source of [expectedBytes, Uint8Array.from(expectedBytes), expectedBytes.toString("utf8")]) {
      const result = await captureRspackCompilationGraph(
        createCompilation(() => ({ source: () => source })),
        temporary.fixtureRoot,
        { fixtureSourceByPath: new Map([["src/main.js", expectedBytes]]) },
      );
      assert.ok(!result.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "source-graph"));
    }

    const mismatch = await captureRspackCompilationGraph(
      createCompilation(() => ({ source: () => Buffer.from("export const ready = false;\n") })),
      temporary.fixtureRoot,
      { fixtureSourceByPath: new Map([["src/main.js", expectedBytes]]) },
    );
    assert.ok(mismatch.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.message.includes("bytes가 build 시작 시 fixture snapshot과 다릅니다")));

    const unavailable = await captureRspackCompilationGraph(
      createCompilation(() => null),
      temporary.fixtureRoot,
      { fixtureSourceByPath: new Map([["src/main.js", expectedBytes]]) },
    );
    assert.ok(unavailable.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.message.includes("compiler 원본 bytes를 확인할 수 없습니다")));
  } finally {
    await temporary.cleanup();
  }
});

test("고정 Rspack config는 CSS 외 JS 입력을 바꾸는 loader 규칙을 두지 않는다", () => {
  const fixtureRootForConfig = path.join(tmpdir(), "spinon-rspack-config-contract");
  const graphPlugin = { apply() {} };
  const { config } = createRspackGraphConfig({
    profile: RSPACK_GRAPH_PROFILE_NAMES.modernModule,
    outputDir: path.join(fixtureRootForConfig, "output"),
    fixtureRoot: fixtureRootForConfig,
    graphPlugin,
  });
  assert.equal(config.module.rules.length, 1);
  assert.equal(String(config.module.rules[0].test), "/\\.css$/i");
  assert.equal(config.module.rules[0].type, "css/auto");
  assert.equal("loader" in config.module.rules[0], false);
  assert.equal("use" in config.module.rules[0], false);
  assert.equal(config.output.clean, false);
  assert.deepEqual(config.plugins, [graphPlugin]);
});

test("source chunk membership 누락·중복과 raw id 형식 충돌을 adapter 진단으로 닫는다", async () => {
  const main = fixtureModule("src/main.js");
  const chunk = { id: 1, name: "main" };
  const compile = ({ chunks = [chunk], ordered = [main], direct = [chunk] } = {}) => captureRspackCompilationGraph({
    modules: new Set([main]),
    chunks,
    moduleGraph: { getOutgoingConnections: () => [] },
    chunkGraph: {
      getOrderedChunkModulesIterable: () => ordered,
      getModuleChunksIterable: () => direct,
    },
  }, fixtureRoot);

  const missing = await compile({ direct: [] });
  assert.ok(missing.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "chunk-graph" && item.message.includes("일치하지 않습니다")));

  const unknownDirectMembership = await compile({ ordered: [], direct: [{ id: 404 }] });
  assert.ok(unknownDirectMembership.diagnostics.some((item) =>
    item.code === "C02_GRAPH_CAPTURE_INCOMPLETE"
    && item.stage === "chunk-graph"
    && item.message.includes("compilation.chunks에 없습니다")));

  const duplicate = await compile({ ordered: [main, main] });
  assert.ok(duplicate.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "chunk-graph" && item.message.includes("중복 열거")));

  const collidingIds = await compile({ chunks: [{ id: 1 }, { id: "1" }] });
  assert.ok(collidingIds.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "source-graph" && item.message.includes("문자열 정규화 뒤 충돌")));
});

test("output chunk membership·resource orphan·중복 owner와 stats raw id 충돌은 snapshot에서 진단한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-output-graph-edges-"));
  const fixture = path.join(root, "fixture");
  const output = path.join(root, "output");
  await mkdir(path.join(fixture, "src"), { recursive: true });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(fixture, "src", "main.js"), "export const main = true;\n");
  await writeFile(path.join(output, "main.js"), "export const main = true;\n");
  await writeFile(path.join(output, "orphan.js"), "export const orphan = true;\n");

  const profile = { configSources: [{ path: "fixture/config.mjs", sha256: "a".repeat(64) }], effectiveOptions: { moduleFormat: "esm" } };
  const makeSnapshot = async ({ chunks, outputChunkIds = ["chunk:1"], assets = ["main.js", "orphan.js"] }) => {
    const partial = await createRspackModuleGraphSnapshot({
      stats: { assets: assets.map((name) => ({ name })), chunks, errors: [] },
      compilationGraph: {
        graph: {
          scope: "javascript-module-dependencies",
          modules: [{ key: "src/main.js", outputChunkIds }],
          dependencies: [],
          excludedDependencies: [],
        },
        diagnostics: [],
      },
      fixtureRoot: fixture,
      outputDir: output,
      profile: "synthetic-output-graph",
      buildProfile: profile,
      features: [{ id: "main", entrySourceKey: "src/main.js" }],
      toolVersion: "2.2.7",
      fixtureSha256: "b".repeat(64),
      buildProfileSha256: computeBuildProfileSha256(profile),
    });
    return createModuleGraphSnapshot(partial);
  };

  try {
    const missing = await makeSnapshot({
      chunks: [{ id: 1, entry: true, initial: true, files: ["main.js"] }],
      outputChunkIds: ["chunk:404"],
    });
    assert.ok(missing.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "chunk-graph" && item.message.includes("대응하지 않습니다")));
    assert.ok(missing.diagnostics.some((item) => item.code === "C02_GRAPH_RESOURCE_MISSING" && item.stage === "output-graph" && item.message.includes("연결되지 않았습니다")));

    const duplicateMembership = await makeSnapshot({
      chunks: [{ id: 1, entry: true, initial: true, files: ["main.js"] }],
      outputChunkIds: ["chunk:1", "chunk:1"],
    });
    assert.ok(duplicateMembership.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "chunk-graph" && item.message.includes("membership가 중복")));

    const duplicateOwners = await makeSnapshot({
      chunks: [
        { id: 1, entry: true, initial: true, files: ["main.js"] },
        { id: 2, initial: false, files: ["main.js"] },
      ],
      assets: ["main.js"],
    });
    assert.ok(duplicateOwners.diagnostics.some((item) => item.code === "C02_GRAPH_TARGET_AMBIGUOUS" && item.stage === "output-graph" && item.message.includes("여러 Rspack chunk")));

    const collidingStatsIds = await makeSnapshot({
      chunks: [
        { id: 1, entry: true, initial: true, files: ["main.js"] },
        { id: "1", initial: false, files: ["main.js"] },
      ],
      assets: ["main.js"],
    });
    assert.ok(collidingStatsIds.diagnostics.some((item) => item.code === "C02_GRAPH_CAPTURE_INCOMPLETE" && item.stage === "output-graph" && item.message.includes("문자열 정규화 뒤 충돌")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adapter output-target consistency gate는 static·dynamic specifier target 충돌을 진단한다", () => {
  const diagnostics = [];
  detectOutputTargetConflicts([{
    id: "chunk:entry",
    dependencies: [
      { kind: "static", specifier: "./target.js", chunkId: "chunk:static" },
      { kind: "dynamic", specifier: "./target.js", chunkId: "chunk:dynamic" },
    ],
  }], diagnostics);
  assert.ok(diagnostics.some((item) =>
    item.code === "C02_GRAPH_TARGET_CONFLICT"
    && item.stage === "output-graph"
    && item.specifier === "./target.js"));
});

test("nearest existing output ancestor의 symlink는 realpath 기준으로 overlap 판정한다", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "spinon-rspack-clean-symlink-parent-"));
  const fixtureRootForCheck = path.join(root, "fixture");
  const protectedRoot = path.join(root, "protected-project");
  const link = path.join(root, "project-alias");
  await mkdir(fixtureRootForCheck);
  await mkdir(protectedRoot);
  await writeFile(path.join(protectedRoot, "sentinel"), "keep\n");
  await symlink(protectedRoot, link);
  try {
    await assert.rejects(
      assertOutputDirectoryDoesNotOverlapFixture({
        fixtureRoot: fixtureRootForCheck,
        outputDir: path.join(link, "not-created", "output"),
        protectedRoots: [protectedRoot],
      }),
      /outputDir와 보호 경로가 실제 경로에서 겹쳐 output\.clean을 안전하게 실행할 수 없습니다/,
    );
    assert.equal(await readFile(path.join(protectedRoot, "sentinel"), "utf8"), "keep\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fixtureModule(relativePath) {
  const resource = path.join(fixtureRoot, relativePath);
  return {
    resource,
    type: "javascript/esm",
    identifier: () => resource,
    originalSource: () => ({ source: () => readFileSync(resource) }),
  };
}

async function temporaryOutput(name) {
  const root = await mkdtemp(path.join(tmpdir(), `spinon-rspack-graph-${name}-`));
  return path.join(root, "output");
}

async function createFixtureBuild(name, files) {
  const root = await mkdtemp(path.join(tmpdir(), `spinon-rspack-fixture-${name}-`));
  const fixtureRoot = path.join(root, "fixture");
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return {
    fixtureRoot,
    outputDir: path.join(root, "output"),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
