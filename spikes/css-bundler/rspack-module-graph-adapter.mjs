import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import rspack from "@rspack/core";
import { parse } from "acorn";
import { listFiles, sourcePathFromId } from "./adapter-support.mjs";
import { createRspackGraphConfig, RSPACK_GRAPH_PROFILE_NAMES } from "./rspack-graph.config.mjs";
import {
  assertR15JavaScriptGraphInput,
  computeBuildProfileSha256,
  computeSourceGraphSha256,
  createModuleGraphSnapshot,
  parseEmittedEsm,
  resolveLocalOutputPath,
  resolveEmittedChunkTarget,
} from "./module-graph-contract.mjs";

export const RSPACK_MODULE_GRAPH_ADAPTER_VERSION = "0.1.0-spike";
const CONTRACT = { name: "spinon.c02-bundler-module-graph", version: "0.1.0-draft" };
const JAVASCRIPT_TYPES = new Set(["javascript/auto", "javascript/dynamic", "javascript/esm"]);

export async function buildRspackModuleGraph({
  profile = RSPACK_GRAPH_PROFILE_NAMES.modernModule,
  fixtureRoot,
  outputDir,
  features = [{ id: "main", entrySourceKey: "src/main.js" }],
}) {
  assertSupportedFeatureInputs(features);
  await assertOutputDirectoryDoesNotOverlapFixture({ fixtureRoot, outputDir });
  const canonicalFixtureRoot = await realpath(fixtureRoot);
  const fixtureSnapshot = await captureFixtureSnapshot(canonicalFixtureRoot);
  const virtualModules = await readFixtureVirtualModules(canonicalFixtureRoot, fixtureSnapshot.virtualManifestBytes);
  const captureState = { value: null };
  const graphPlugin = createRspackModuleGraphPlugin({
    fixtureRoot: canonicalFixtureRoot,
    captureState,
    virtualSourceByPath: virtualModules,
    fixtureSourceByPath: fixtureSnapshot.fileBytesByPath,
  });
  const { config, profile: profileFingerprint } = createRspackGraphConfig({
    profile,
    outputDir,
    fixtureRoot: canonicalFixtureRoot,
    graphPlugin,
    virtualModules,
  });
  const [toolVersion, buildProfile] = await Promise.all([
    rspackVersion(),
    createBuildProfile(profileFingerprint, features),
  ]);
  const buildProfileSha256 = computeBuildProfileSha256(buildProfile);
  await reserveOutputDirectory({ fixtureRoot: canonicalFixtureRoot, outputDir });
  const stats = await runCompiler(config);
  let compilationGraph = captureState.value;
  try {
    const postBuildFixtureSnapshot = await captureFixtureSnapshot(canonicalFixtureRoot);
    if (postBuildFixtureSnapshot.sha256 !== fixtureSnapshot.sha256) {
      compilationGraph ??= { diagnostics: [] };
      compilationGraph.diagnostics ??= [];
      compilationGraph.diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "build",
        "Rspack build 중 fixture 파일 집합 또는 bytes가 바뀌어 build 입력 provenance를 확정할 수 없습니다.",
      ));
    }
  } catch (error) {
    compilationGraph ??= { diagnostics: [] };
    compilationGraph.diagnostics ??= [];
    compilationGraph.diagnostics.push(diagnostic(
      "C02_GRAPH_CAPTURE_INCOMPLETE",
      "build",
      `Rspack build 후 fixture digest를 다시 확인하지 못했습니다: ${error.message}`,
    ));
  }
  const snapshot = await createRspackModuleGraphSnapshot({
    stats: stats.json,
    buildHasErrors: stats.hasErrors,
    compilationGraph,
    fixtureRoot: canonicalFixtureRoot,
    outputDir,
    profile: profileFingerprint.name,
    buildProfile,
    features,
    toolVersion,
    fixtureSha256: fixtureSnapshot.sha256,
    buildProfileSha256,
  });
  const normalized = createModuleGraphSnapshot(snapshot);
  if (normalized.build.status === "success") assertR15JavaScriptGraphInput(normalized);
  return normalized;
}

export function createRspackModuleGraphPlugin({ fixtureRoot, captureState, virtualSourceByPath = {}, fixtureSourceByPath }) {
  return {
    apply(compiler) {
      compiler.hooks.thisCompilation.tap("SpinonRspackModuleGraphAdapter", (compilation) => {
        compilation.hooks.afterSeal.tapPromise("SpinonRspackModuleGraphAdapter", async () => {
          captureState.value = await captureRspackCompilationGraph(compilation, fixtureRoot, {
            virtualSourceByPath,
            fixtureSourceByPath,
          });
        });
      });
    },
  };
}

export async function captureRspackCompilationGraph(compilation, fixtureRoot, {
  virtualSourceByPath = {},
  fixtureSourceByPath = null,
} = {}) {
  const inputSourceSnapshot = fixtureSourceByPath instanceof Map
    ? fixtureSourceByPath
    : (await captureFixtureSnapshot(fixtureRoot)).fileBytesByPath;
  const diagnostics = [];
  const allJavaScriptModules = new Set([...compilation.modules].filter((module) => JAVASCRIPT_TYPES.has(module.type)));
  const sourceModules = [...allJavaScriptModules]
    .filter((module) => JAVASCRIPT_TYPES.has(module.type))
    .map((module) => ({ module, key: sourceKeyFromResource(module.resource, fixtureRoot) }))
    .filter(({ module, key }) => {
      if (key !== null) return true;
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "source-graph",
        `Rspack JavaScript module이 fixture 루트 안의 source key로 정규화되지 않았거나 virtual module입니다: ${module.identifier?.() ?? module.type}`,
      ));
      return false;
    });
  const moduleByKey = new Map();
  for (const item of sourceModules) {
    if (moduleByKey.has(item.key)) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "source-graph",
        `서로 다른 Rspack module이 같은 source key로 합쳐집니다: ${item.key}`,
        item.key,
      ));
      continue;
    }
    moduleByKey.set(item.key, item.module);
  }

  const rspackChunks = new Map();
  for (const chunk of compilation.chunks) {
    if (chunk.id === null || chunk.id === undefined) {
      diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "source-graph", "Rspack chunk에 build-local id가 없습니다."));
      continue;
    }
    const rawId = String(chunk.id);
    const id = chunkId(chunk.id);
    if (rspackChunks.has(rawId)) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "source-graph",
        `서로 다른 Rspack raw chunk id가 문자열 정규화 뒤 충돌합니다: ${rawId}`,
      ));
      continue;
    }
    rspackChunks.set(rawId, { id, name: chunk.name ?? null, rawIdType: typeof chunk.id });
  }

  const outputChunkIdsByModule = new Map([...moduleByKey.keys()].map((key) => [key, new Set()]));
  const orderedMemberships = new Map([...moduleByKey.keys()].map((key) => [key, new Set()]));
  const directMemberships = new Map([...moduleByKey.keys()].map((key) => [key, new Set()]));
  const rawMemberships = new Map([...moduleByKey.keys()].map((key) => [key, new Set()]));
  for (const chunk of compilation.chunks) {
    if (chunk.id === null || chunk.id === undefined) continue;
    const id = chunkId(chunk.id);
    let modules;
    try {
      modules = compilation.chunkGraph.getOrderedChunkModulesIterable(
        chunk,
      (left, right) => compareStrings(left.identifier?.() ?? "", right.identifier?.() ?? ""),
      );
    } catch (error) {
      diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "source-graph", `chunkGraph 모듈 열거에 실패했습니다: ${error.message}`));
      continue;
    }
    const seenInChunk = new Set();
    for (const module of modules) {
      for (const nested of flattenConcatenatedModules(module)) {
        if (!nested || typeof nested.resource !== "string" || nested.resource.length === 0) {
          if (!allJavaScriptModules.has(nested)) {
            diagnostics.push(diagnostic(
              "C02_GRAPH_CAPTURE_INCOMPLETE",
              "chunk-graph",
              `chunkGraph에 resource key가 없는 JavaScript 또는 virtual module이 있습니다: ${nested?.identifier?.() ?? nested?.type ?? "알 수 없는 module"}`,
            ));
          }
          continue;
        }
        const key = sourceKeyFromResource(nested.resource, fixtureRoot);
        if (key === null || !moduleByKey.has(key)) continue;
        if (seenInChunk.has(key)) {
          diagnostics.push(diagnostic(
            "C02_GRAPH_CAPTURE_INCOMPLETE",
            "chunk-graph",
            `chunkGraph가 같은 source module을 한 chunk에 중복 열거했습니다: ${key} -> ${id}`,
            key,
          ));
        }
        seenInChunk.add(key);
        outputChunkIdsByModule.get(key).add(id);
        orderedMemberships.get(key).add(id);
        rawMemberships.get(key).add("chunkGraph.getOrderedChunkModulesIterable");
      }
    }
  }

  for (const [key, module] of moduleByKey) {
    try {
      for (const chunk of compilation.chunkGraph.getModuleChunksIterable(module)) {
        if (chunk.id === null || chunk.id === undefined) continue;
        const chunkInfo = rspackChunks.get(String(chunk.id));
        if (!chunkInfo) {
          diagnostics.push(diagnostic(
            "C02_GRAPH_CAPTURE_INCOMPLETE",
            "chunk-graph",
            `module chunk membership가 compilation.chunks에 없습니다: ${key} -> ${String(chunk.id)}`,
            key,
          ));
          continue;
        }
        if (directMemberships.get(key).has(chunkInfo.id)) {
          diagnostics.push(diagnostic(
            "C02_GRAPH_CAPTURE_INCOMPLETE",
            "chunk-graph",
            `chunkGraph가 같은 source module의 direct chunk membership를 중복 반환했습니다: ${key} -> ${chunkInfo.id}`,
            key,
          ));
        }
        directMemberships.get(key).add(chunkInfo.id);
        outputChunkIdsByModule.get(key).add(chunkInfo.id);
        rawMemberships.get(key).add("chunkGraph.getModuleChunksIterable");
      }
    } catch (error) {
      diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "source-graph", `module chunk membership 조회에 실패했습니다: ${error.message}`, key));
    }
  }

  for (const key of moduleByKey.keys()) {
    const ordered = orderedMemberships.get(key);
    const direct = directMemberships.get(key);
    if (!sameStringSet(ordered, direct)) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "chunk-graph",
        `chunkGraph의 열거 membership와 module membership가 일치하지 않습니다: ${key}`,
        key,
      ));
    }
  }

  const dependencies = new Map();
  const excludedDependencies = new Map();
  const rawConnectionsByModule = new Map();
  let observedConnectionCount = 0;
  const moduleKeyByObject = new Map([...moduleByKey].map(([key, module]) => [module, key]));
  for (const module of allJavaScriptModules) {
    try {
      const connections = compilation.moduleGraph.getOutgoingConnections(module);
      rawConnectionsByModule.set(module, connections);
      observedConnectionCount += connections.length;
    } catch (error) {
      rawConnectionsByModule.set(module, null);
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "source-graph",
        `JavaScript module의 raw moduleGraph outgoing connection 조회에 실패했습니다: ${error.message}`,
        moduleKeyByObject.get(module) ?? null,
      ));
    }
  }
  for (const [referrerModuleKey, module] of moduleByKey) {
    const sourceOccurrences = captureSourceImportOccurrences(
      module,
      referrerModuleKey,
      diagnostics,
      virtualSourceByPath,
      inputSourceSnapshot,
    );
    const connections = rawConnectionsByModule.get(module);
    if (!connections) continue;
    for (const connection of connections) {
      if (dependencyKind(connection.dependency?.type) || isSpecifierDependency(connection.dependency?.type)) continue;
      diagnostics.push(diagnostic(
        "C02_GRAPH_UNSUPPORTED_IMPORT",
        "source-graph",
        `Rspack JavaScript dependency를 지원하는 static/dynamic 요청으로 분류하지 못했습니다: ${connection.dependency?.type ?? "type 없음"}`,
        referrerModuleKey,
        typeof connection.dependency?.request === "string" ? connection.dependency.request : null,
        sourceLocation(connection.dependency?.loc, referrerModuleKey),
      ));
    }
    const occurrenceConnections = bindSourceOccurrences(
      sourceOccurrences,
      connections,
      referrerModuleKey,
      fixtureRoot,
      diagnostics,
    );
    const targetsByRequest = new Map();
    for (const { connection, occurrence } of occurrenceConnections) {
      const dependency = connection.dependency;
      const sourceSpecifier = dependency?.request;
      const kind = dependencyKind(dependency?.type);
      const source = occurrence.source;
      if (!kind || typeof sourceSpecifier !== "string" || sourceSpecifier.length === 0) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_UNSUPPORTED_IMPORT",
          "source-graph",
          `Rspack JavaScript dependency를 지원하는 static/dynamic 요청으로 분류하지 못했습니다: ${dependency?.type ?? "type 없음"}`,
          referrerModuleKey,
          typeof sourceSpecifier === "string" ? sourceSpecifier : null,
          source,
        ));
        continue;
      }

      const targetModule = connection.resolvedModule ?? connection.module ?? null;
      const requestKey = `${kind}\0${sourceSpecifier}`;
      const targetIdentity = sourceTargetIdentity(targetModule, fixtureRoot);
      if (!targetsByRequest.has(requestKey)) targetsByRequest.set(requestKey, new Set());
      targetsByRequest.get(requestKey).add(targetIdentity);

      if (dependency.attributes?.length > 0 || dependency.assertions?.length > 0 || dependency.phase) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_UNSUPPORTED_IMPORT",
          "source-graph",
          "Rspack dependency API에서 지원하지 않는 import attribute 또는 import phase가 관찰되었습니다.",
          referrerModuleKey,
          sourceSpecifier,
          source,
        ));
      }

      if (isExternalModule(targetModule)) {
        const edge = { referrerModuleKey, kind, sourceSpecifier, resolvedModuleKey: null, external: true, source };
        dependencies.set(sourceEdgeKey(edge), edge);
        diagnostics.push(diagnostic(
          "C02_GRAPH_EXTERNAL_IMPORT",
          "source-graph",
          `외부 module 요청은 C02 JS graph에 포함할 수 없습니다: ${sourceSpecifier}`,
          referrerModuleKey,
          sourceSpecifier,
          source,
        ));
        continue;
      }

      if (targetModule && !JAVASCRIPT_TYPES.has(targetModule.type)) {
        const targetKind = nonJavaScriptTargetKind(targetModule.type);
        const targetKey = sourceKeyFromResource(targetModule.resource, fixtureRoot);
        if (targetKind) {
          const edge = {
            referrerModuleKey,
            kind,
            sourceSpecifier,
            targetKind,
            resolvedResourceKey: targetKey,
            source,
          };
          excludedDependencies.set(excludedEdgeKey(edge), edge);
          if (targetKey === null) {
            diagnostics.push(diagnostic(
              "C02_GRAPH_CAPTURE_INCOMPLETE",
              "source-graph",
              `JavaScript 외 dependency를 분류했지만 fixture 내부 resource key로 해소하지 못했습니다: ${sourceSpecifier}`,
              referrerModuleKey,
              sourceSpecifier,
              source,
            ));
          }
        } else {
          diagnostics.push(diagnostic(
          "C02_GRAPH_UNSUPPORTED_IMPORT",
          "source-graph",
          `JavaScript dependency 대상 module type은 관찰했지만 C02.2 stylesheet/asset 종류로 분류할 수 없습니다: ${targetModule.type}`,
          referrerModuleKey,
          sourceSpecifier,
          source,
          ));
        }
        continue;
      }

      const resolvedModuleKey = sourceKeyFromResource(targetModule?.resource, fixtureRoot);
      const edge = {
        referrerModuleKey,
        kind,
        sourceSpecifier,
        resolvedModuleKey,
        external: false,
        source,
      };
      dependencies.set(sourceEdgeKey(edge), edge);
      if (!targetModule || resolvedModuleKey === null) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_UNRESOLVED_IMPORT",
          "source-graph",
          `JavaScript 요청이 fixture 안의 출력 대상 module로 연결되지 않았습니다: ${sourceSpecifier}`,
          referrerModuleKey,
          sourceSpecifier,
          source,
        ));
      } else if (!moduleByKey.has(resolvedModuleKey)) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_CAPTURE_INCOMPLETE",
          "source-graph",
          `해결된 JavaScript 대상 module이 관찰된 source module 집합에 없습니다: ${resolvedModuleKey}`,
          referrerModuleKey,
          sourceSpecifier,
          source,
        ));
      }
    }

    for (const connection of connections) {
      if (!isSpecifierDependency(connection.dependency?.type)) continue;
      const dependency = connection.dependency;
      const sourceSpecifier = dependency.request;
      const requestKey = `static\0${sourceSpecifier ?? ""}`;
      const occurrences = sourceOccurrences.get(requestKey) ?? [];
      const targets = targetsByRequest.get(requestKey);
      const targetModule = connection.resolvedModule ?? connection.module ?? null;
      const targetIdentity = sourceTargetIdentity(targetModule, fixtureRoot);
      if (occurrences.length === 0 || !targets || targets.size === 0) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_CAPTURE_INCOMPLETE",
          "source-graph",
          `Rspack import specifier 보조 connection이 원본 static 요청 occurrence에 연결되지 않습니다: ${sourceSpecifier ?? "요청 없음"}`,
          referrerModuleKey,
          typeof sourceSpecifier === "string" ? sourceSpecifier : null,
        ));
      } else if (targets.size !== 1 || !targets.has(targetIdentity)) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_TARGET_CONFLICT",
          "source-graph",
          `Rspack import specifier 보조 connection의 target이 canonical 요청 connection과 다릅니다: ${sourceSpecifier}`,
          referrerModuleKey,
          sourceSpecifier,
        ));
      }
    }
  }

  const modules = [...moduleByKey.keys()].sort(compareStrings).map((key) => ({
    key,
    outputChunkIds: [...outputChunkIdsByModule.get(key)].sort(compareStrings),
  }));
  const normalizedDependencies = [...dependencies.values()].sort(sourceEdgeOrder);
  const normalizedExcludedDependencies = [...excludedDependencies.values()].sort(excludedEdgeOrder);
  detectSourceTargetConflicts(normalizedDependencies, normalizedExcludedDependencies, diagnostics);
  const normalizedGraph = {
    scope: "javascript-module-dependencies",
    modules,
    dependencies: normalizedDependencies,
    excludedDependencies: normalizedExcludedDependencies,
  };
  return {
    graph: normalizedGraph,
    diagnostics,
    observedModuleCount: compilation.modules.size,
    observedJavaScriptModuleCount: allJavaScriptModules.size,
    normalizedJavaScriptModuleCount: modules.length,
    observedConnectionCount,
    outputMembershipCaptureMethods: [...new Set([...rawMemberships.values()].flatMap((methods) => [...methods]))].sort(compareStrings),
  };
}

export async function createRspackModuleGraphSnapshot({
  stats,
  buildHasErrors = false,
  compilationGraph,
  fixtureRoot,
  outputDir,
  profile,
  buildProfile,
  features,
  toolVersion,
  fixtureSha256,
  buildProfileSha256,
}) {
  assertSupportedFeatureInputs(features);
  const diagnostics = [...(compilationGraph?.diagnostics ?? [])];
  if (buildHasErrors && (stats?.errors ?? []).length > 0) {
    for (const error of stats.errors) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "build",
        `Rspack production build가 실패했습니다: ${error.message ?? "원인 메시지 없음"}`,
      ));
    }
  } else if (buildHasErrors) {
    diagnostics.push(diagnostic(
      "C02_GRAPH_CAPTURE_INCOMPLETE",
      "build",
      "Rspack production build가 실패했지만 stats에 오류 원문이 없습니다.",
    ));
  }
  const sourceGraphCaptured = compilationGraph?.graph ?? null;
  const sourceModules = sourceGraphCaptured?.modules ?? [];
  const statsChunks = stats?.chunks ?? [];
  const statsAssetPaths = new Set((stats?.assets ?? []).map((asset) => normalizeOutputPath(asset.name)));
  const chunkRows = new Map();
  const outputResourceRows = [];
  const resourceByPath = new Map();
  const emittedInventory = await collectOutputInventory(outputDir, diagnostics);
  const emittedPaths = new Set(emittedInventory.paths);

  for (const outputPath of emittedPaths) {
    if (!/\.(?:js|mjs|cjs)$/i.test(outputPath)) continue;
    const bytes = await readValidatedOutputFile(emittedInventory, outputPath, diagnostics);
    if (bytes === null) continue;
    const resource = {
      id: resourceId(outputPath),
      logicalId: null,
      identityStatus: "unproven",
      kind: "javascript",
      outputPath,
      mediaType: "text/javascript",
      bytes: bytes.byteLength,
      sha256: digest(bytes),
    };
    outputResourceRows.push(resource);
    resourceByPath.set(outputPath, { resource, bytes, code: bytes.toString("utf8") });
  }
  outputResourceRows.sort((left, right) => compareStrings(left.outputPath, right.outputPath));

  for (const outputPath of statsAssetPaths) {
    if (isJavaScriptOutputPath(outputPath) && !resourceByPath.has(outputPath)) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_RESOURCE_MISSING",
        "output-graph",
        `Rspack stats에 선언된 JavaScript asset bytes를 출력 디렉터리에서 찾지 못했습니다: ${outputPath}`,
      ));
    }
  }

  const chunkIdByRspackId = new Map();
  for (const chunk of statsChunks) {
    if (chunk.id === null || chunk.id === undefined) {
      diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", "Rspack stats에 chunk id가 없습니다."));
      continue;
    }
    const rawId = String(chunk.id);
    if (chunkIdByRspackId.has(rawId)) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "output-graph",
        `서로 다른 Rspack stats raw chunk id가 문자열 정규화 뒤 충돌합니다: ${rawId}`,
      ));
      continue;
    }
    chunkIdByRspackId.set(rawId, chunkId(chunk.id));
  }

  const resourceOwners = new Map();
  for (const statsChunk of statsChunks) {
    const id = chunkIdByRspackId.get(String(statsChunk.id));
    if (!id) continue;
    const files = (statsChunk.files ?? []).map(normalizeOutputPath);
    const declaredJavaScriptPaths = files.filter((file) => isJavaScriptOutputPath(file) && statsAssetPaths.has(file));
    const javascriptPaths = declaredJavaScriptPaths.filter((file) => resourceByPath.has(file));
    for (const outputPath of declaredJavaScriptPaths) {
      if (!resourceByPath.has(outputPath)) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_RESOURCE_MISSING",
          "output-graph",
          `Rspack stats chunk이 선언한 JavaScript asset bytes를 출력 디렉터리에서 찾지 못했습니다: ${outputPath}`,
        ));
      }
    }
    if (javascriptPaths.length > 1) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_TARGET_AMBIGUOUS",
        "output-graph",
        `Rspack chunk이 여러 JavaScript output resource를 소유합니다: ${id}`,
      ));
    }
    for (const outputPath of javascriptPaths) {
      if (!resourceOwners.has(outputPath)) resourceOwners.set(outputPath, []);
      resourceOwners.get(outputPath).push(id);
    }
    if (javascriptPaths.length === 0) continue;
    const javascriptResource = resourceByPath.get(javascriptPaths[0]).resource;
    const moduleFormat = "unknown";
    chunkRows.set(id, {
      id,
      logicalId: null,
      identityStatus: "unproven",
      kind: chunkKind(statsChunk),
      moduleFormat,
      javascriptResourceId: javascriptResource.id,
      sourceModuleKeys: [],
      dependencies: [],
    });
  }

  for (const [outputPath, owners] of resourceOwners) {
    if (owners.length > 1) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_TARGET_AMBIGUOUS",
        "output-graph",
        `JavaScript output resource가 여러 Rspack chunk에 연결됩니다: ${outputPath}`,
      ));
    }
  }

  const outputChunkIdsByModule = new Map(sourceModules.map((module) => [module.key, []]));
  for (const module of sourceModules) {
    if (!Array.isArray(module.outputChunkIds)) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "chunk-graph",
        `source module의 output chunk membership 배열이 없습니다: ${module.key}`,
        module.key,
      ));
      continue;
    }
    if (new Set(module.outputChunkIds).size !== module.outputChunkIds.length) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "chunk-graph",
        `source module의 output chunk membership가 중복되었습니다: ${module.key}`,
        module.key,
      ));
    }
    for (const id of module.outputChunkIds) {
      if (!chunkRows.has(id)) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_CAPTURE_INCOMPLETE",
          "chunk-graph",
          `source module membership가 JavaScript output chunk에 대응하지 않습니다: ${module.key} -> ${id}`,
          module.key,
        ));
        continue;
      }
      outputChunkIdsByModule.get(module.key).push(id);
      chunkRows.get(id).sourceModuleKeys.push(module.key);
    }
  }

  const parsedRows = new Map();
  const emittedModuleTargets = new Set();
  for (const resource of outputResourceRows) {
    const output = resourceByPath.get(resource.outputPath);
    const parsed = parseEmittedEsm({ code: output.code, fileName: resource.outputPath });
    diagnostics.push(...parsed.diagnostics);
    let moduleFormat = parsed.status === "success" ? "other" : "unknown";
    let nativeModuleSyntax = false;
    if (parsed.status === "success") {
      try {
        const ast = parse(output.code, { ecmaVersion: "latest", sourceType: "module", locations: true });
        nativeModuleSyntax = hasNativeModuleSyntax(ast);
      } catch {
        nativeModuleSyntax = false;
      }
      moduleFormat = nativeModuleSyntax ? "esm" : "other";
    }
    parsedRows.set(resource.outputPath, { parsed, moduleFormat, nativeModuleSyntax });
  }

  for (const [id, chunk] of chunkRows) {
    const resource = outputResourceRows.find((candidate) => candidate.id === chunk.javascriptResourceId);
    const parsed = resource ? parsedRows.get(resource.outputPath) : null;
    chunk.moduleFormat = parsed?.moduleFormat ?? "unknown";
    if (!resource || !parsed) {
      diagnostics.push(diagnostic("C02_GRAPH_RESOURCE_MISSING", "output-graph", `chunk의 JavaScript resource bytes 또는 ESM parse 결과가 없습니다: ${id}`));
      continue;
    }
    for (const emitted of parsed.parsed.imports) {
      const targetPath = resolveLocalOutputPath({ referrerPath: resource.outputPath, specifier: emitted.specifier });
      if (targetPath === null) {
        const code = isExternalSpecifier(emitted.specifier) ? "C02_GRAPH_EXTERNAL_IMPORT" : "C02_GRAPH_UNRESOLVED_IMPORT";
        diagnostics.push(diagnostic(code, "output-graph", `emitted ESM specifier를 출력 루트 내부 파일로 연결하지 못했습니다: ${emitted.specifier}`, null, emitted.specifier, emitted.source));
        chunk.dependencies.push({ kind: emitted.kind, specifier: emitted.specifier, chunkId: null });
        continue;
      }
      if (!resourceByPath.has(targetPath)) {
        if (emittedPaths.has(targetPath)) {
          diagnostics.push(diagnostic(
            "C02_GRAPH_UNSUPPORTED_IMPORT",
            "output-graph",
            `emitted ESM specifier가 C02.2 JavaScript graph 밖의 출력 자원을 가리킵니다. 0011 자원 adapter 처리가 필요합니다: ${emitted.specifier}`,
            null,
            emitted.specifier,
            emitted.source,
          ));
          chunk.dependencies.push({ kind: emitted.kind, specifier: emitted.specifier, chunkId: null });
          continue;
        }
        diagnostics.push(diagnostic("C02_GRAPH_UNRESOLVED_IMPORT", "output-graph", `emitted specifier 대상 JavaScript resource가 없습니다: ${emitted.specifier}`, null, emitted.specifier, emitted.source));
        chunk.dependencies.push({ kind: emitted.kind, specifier: emitted.specifier, chunkId: null });
        continue;
      }
      const target = resolveEmittedChunkTarget({
        referrerPath: resource.outputPath,
        specifier: emitted.specifier,
        chunks: [...chunkRows.values()],
        resources: outputResourceRows,
      });
      if (target.status !== "resolved") {
        const code = target.status === "ambiguous" ? "C02_GRAPH_TARGET_AMBIGUOUS" : "C02_GRAPH_UNRESOLVED_IMPORT";
        diagnostics.push(diagnostic(
          code,
          "output-graph",
          `emitted specifier가 출력 target 하나로 연결되지 않습니다 (${target.status}): ${emitted.specifier}`,
          null,
          emitted.specifier,
          emitted.source,
        ));
        chunk.dependencies.push({ kind: emitted.kind, specifier: emitted.specifier, chunkId: null });
        continue;
      }
      chunk.dependencies.push({ kind: emitted.kind, specifier: emitted.specifier, chunkId: target.chunkId });
      emittedModuleTargets.add(target.chunkId);
    }
  }

  for (const targetChunkId of emittedModuleTargets) {
    const targetChunk = chunkRows.get(targetChunkId);
    if (targetChunk) targetChunk.moduleFormat = "esm";
  }

  for (const resource of outputResourceRows) {
    if ((resourceOwners.get(resource.outputPath) ?? []).length === 0) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_RESOURCE_MISSING",
        "output-graph",
        `JavaScript output resource가 Rspack stats chunk에 연결되지 않았습니다: ${resource.outputPath}`,
      ));
    }
  }

  const normalizedOutputChunks = [...chunkRows.values()].map((chunk) => ({
    ...chunk,
    sourceModuleKeys: [...new Set(chunk.sourceModuleKeys)].sort(compareStrings),
    dependencies: dedupeOutputEdges(chunk.dependencies),
  }));
  detectOutputTargetConflicts(normalizedOutputChunks, diagnostics);

  const outputFormats = normalizedOutputChunks.map((chunk) => chunk.moduleFormat);
  const allOutputChunksEsm = outputFormats.length > 0 && outputFormats.every((format) => format === "esm");
  const hasNativeModuleEntrySyntax = [...chunkRows.values()].some((chunk) => {
    if (chunk.kind !== "entry") return false;
    const resource = outputResourceRows.find((candidate) => candidate.id === chunk.javascriptResourceId);
    return resource ? parsedRows.get(resource.outputPath)?.nativeModuleSyntax === true : false;
  });
  const esmProfileProven = allOutputChunksEsm && hasNativeModuleEntrySyntax;
  if (!esmProfileProven) {
    diagnostics.push(diagnostic(
      "C02_GRAPH_OUTPUT_NOT_ESM",
      "output-profile",
      `Rspack ${profile} profile에서 entry의 native module 문법과 모든 emitted chunk의 ESM module 관계를 최종 bytes로 입증하지 못했습니다.`,
    ));
  }

  const normalizedSourceModules = sourceModules.map((module) => ({
    key: module.key,
    outputChunkIds: [...new Set(outputChunkIdsByModule.get(module.key) ?? [])].sort(compareStrings),
  }));
  const sourceGraphStatus = compilationGraph && !buildHasErrors && !diagnostics.some((item) =>
    ["source-graph", "chunk-graph"].includes(item.stage)
    && ["C02_GRAPH_CAPTURE_INCOMPLETE", "C02_GRAPH_UNSUPPORTED_IMPORT"].includes(item.code))
    ? "complete"
    : "incomplete";
  const outputGraphStatus = esmProfileProven && !diagnostics.some((item) => item.severity === "error" && ["output-graph", "output-parse"].includes(item.stage))
    ? "complete"
    : "incomplete";
  const sourceGraphBase = {
    scope: "javascript-module-dependencies",
    status: sourceGraphStatus,
    capture: "Rspack 2.2.7 compilation.modules + moduleGraph.getOutgoingConnections + chunkGraph.getOrderedChunkModulesIterable/getModuleChunksIterable",
    moduleCount: normalizedSourceModules.length,
    edgeCount: sourceGraphCaptured?.dependencies?.length ?? 0,
    excludedDependencyCount: sourceGraphCaptured?.excludedDependencies?.length ?? 0,
    modules: normalizedSourceModules,
    dependencies: sourceGraphCaptured?.dependencies ?? [],
    excludedDependencies: sourceGraphCaptured?.excludedDependencies ?? [],
  };
  const sourceGraph = {
    ...sourceGraphBase,
    sha256: computeSourceGraphSha256(sourceGraphBase),
  };
  const outputGraph = {
    status: outputGraphStatus,
    moduleFormat: allOutputChunksEsm ? "esm" : outputFormats.includes("esm") ? "mixed" : outputFormats.some((format) => format === "unknown") ? "unknown" : "other",
    resources: outputResourceRows,
    chunks: normalizedOutputChunks,
  };

  const normalizedFeatures = [];
  for (const feature of features) {
    const sourceModule = normalizedSourceModules.find((module) => module.key === feature.entrySourceKey);
    const entryCandidates = sourceModule?.outputChunkIds
      .map((id) => chunkRows.get(id))
      .filter((chunk) => chunk && chunk.kind === "entry") ?? [];
    if (!sourceModule || entryCandidates.length !== 1) {
      diagnostics.push(diagnostic(
        entryCandidates.length > 1 ? "C02_GRAPH_TARGET_AMBIGUOUS" : "C02_GRAPH_UNRESOLVED_IMPORT",
        "feature-entry",
        `명시된 feature entry source가 Rspack entry chunk 하나로 연결되지 않았습니다: ${feature.entrySourceKey}`,
        feature.entrySourceKey,
      ));
      continue;
    }
    normalizedFeatures.push({
      id: feature.id,
      entrySourceKey: feature.entrySourceKey,
      entryChunkId: entryCandidates[0].id,
    });
  }

  const errorDiagnostics = dedupeDiagnostics(diagnostics);
  const buildStatus = buildHasErrors || errorDiagnostics.some((item) => item.severity === "error") ? "failed" : "success";
  return {
    contract: CONTRACT,
    build: {
      tool: "rspack",
      toolVersion,
      adapterVersion: RSPACK_MODULE_GRAPH_ADAPTER_VERSION,
      outputProfile: profile,
      status: buildStatus,
      fixtureSha256,
      profile: buildProfile,
      buildProfileSha256,
    },
    sourceGraph,
    features: normalizedFeatures,
    outputGraph,
    diagnostics: errorDiagnostics,
  };
}

function flattenConcatenatedModules(module, visited = new Set()) {
  if (!module || visited.has(module)) return [];
  visited.add(module);
  const nestedModules = module.modules;
  if (Array.isArray(nestedModules) && nestedModules.length > 0) {
    return nestedModules.flatMap((nested) => flattenConcatenatedModules(nested, visited));
  }
  return [module];
}

function dependencyKind(type) {
  if (typeof type !== "string") return null;
  if (/^import\(\)(?: |$)/.test(type)) return "dynamic";
  if (["esm import", "esm export import"].includes(type)) return "static";
  return null;
}

function isSpecifierDependency(type) {
  return ["esm import specifier", "esm export import specifier"].includes(type);
}

function sourceTargetIdentity(module, fixtureRoot) {
  if (isExternalModule(module)) return "external";
  if (!module) return "unresolved";
  const key = sourceKeyFromResource(module.resource, fixtureRoot);
  if (JAVASCRIPT_TYPES.has(module.type)) return `module:${key ?? "<outside-fixture>"}`;
  return `${nonJavaScriptTargetKind(module.type) ?? `type:${module.type}`}:${key ?? "<outside-fixture>"}`;
}

function sourceKeyFromResource(resource, fixtureRoot) {
  return typeof resource === "string" && resource.length > 0
    ? sourcePathFromId(resource, fixtureRoot)
    : null;
}

function nonJavaScriptTargetKind(type) {
  if (typeof type !== "string") return null;
  if (type.startsWith("css/")) return "stylesheet";
  if (type.startsWith("asset")) return "asset";
  return null;
}

function isExternalModule(module) {
  if (!module) return false;
  const identifier = String(module.identifier?.() ?? "");
  return identifier.startsWith("external ") || identifier.startsWith("external| ") || module.externalType !== undefined;
}

function sourceLocation(loc, file) {
  if (!loc?.start || !Number.isInteger(loc.start.line) || !Number.isInteger(loc.start.column)) return null;
  return { file, line: loc.start.line, column: loc.start.column };
}

function captureSourceImportOccurrences(module, sourceKey, diagnostics, virtualSourceByPath = {}, fixtureSourceByPath = new Map()) {
  const occurrences = new Map();
  if (!module.resource) return occurrences;
  let expectedBytes = fixtureSourceByPath.get(sourceKey);
  if (expectedBytes === undefined) {
    const virtualSource = virtualSourceByPath[path.resolve(module.resource)];
    if (typeof virtualSource === "string") expectedBytes = Buffer.from(virtualSource, "utf8");
  }
  if (!Buffer.isBuffer(expectedBytes)) {
    diagnostics.push(diagnostic(
      "C02_GRAPH_CAPTURE_INCOMPLETE",
      "source-graph",
      `fixture snapshot에서 Rspack source module bytes를 찾을 수 없습니다: ${sourceKey}`,
      sourceKey,
    ));
    return occurrences;
  }

  let actualBytes;
  try {
    const content = module.originalSource?.()?.source?.();
    if (content === undefined || content === null) throw new Error("Rspack module.originalSource() bytes를 사용할 수 없습니다.");
    if (Buffer.isBuffer(content)) actualBytes = content;
    else if (typeof content === "string") actualBytes = Buffer.from(content, "utf8");
    else if (ArrayBuffer.isView(content)) actualBytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    else throw new Error("Rspack module.originalSource()가 문자열 또는 byte array를 반환하지 않았습니다.");
  } catch (error) {
    diagnostics.push(diagnostic(
      "C02_GRAPH_CAPTURE_INCOMPLETE",
      "source-graph",
      `Rspack source module의 compiler 원본 bytes를 확인할 수 없습니다: ${error.message}`,
      sourceKey,
    ));
    return occurrences;
  }

  if (!actualBytes.equals(expectedBytes)) {
    diagnostics.push(diagnostic(
      "C02_GRAPH_CAPTURE_INCOMPLETE",
      "source-graph",
      `Rspack compiler source bytes가 build 시작 시 fixture snapshot과 다릅니다: ${sourceKey}`,
      sourceKey,
    ));
    return occurrences;
  }
  const source = actualBytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(actualBytes)) {
    diagnostics.push(diagnostic(
      "C02_GRAPH_CAPTURE_INCOMPLETE",
      "source-graph",
      `Rspack source module이 유효한 UTF-8 JavaScript bytes가 아닙니다: ${sourceKey}`,
      sourceKey,
    ));
    return occurrences;
  }

  let ast;
  try {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (error) {
    diagnostics.push(diagnostic(
      "C02_GRAPH_UNSUPPORTED_IMPORT",
      "source-graph",
      `Acorn이 원본 모듈의 import phase·attribute를 확인하지 못해 입력 graph를 닫았습니다: ${error.message}`,
      sourceKey,
    ));
    return occurrences;
  }

  const pending = [ast];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) pending.push(node[index]);
      continue;
    }
    let kind = null;
    let specifier = null;
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)) {
      kind = "static";
      specifier = node.source?.value;
      if ((node.attributes ?? node.assertions ?? []).length > 0) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_UNSUPPORTED_IMPORT",
          "source-graph",
          "원본 JavaScript에 지원하지 않는 import attribute가 있습니다.",
          sourceKey,
          typeof specifier === "string" ? specifier : null,
          sourceNodeLocation(node, sourceKey),
        ));
      }
    } else if (node.type === "ImportExpression") {
      kind = "dynamic";
      specifier = node.source?.type === "Literal" && typeof node.source.value === "string" ? node.source.value : null;
      if (specifier === null || node.options != null) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_UNSUPPORTED_IMPORT",
          "source-graph",
          "원본 dynamic import가 literal specifier 하나로 정해지지 않거나 import 옵션을 포함합니다.",
          sourceKey,
          null,
          sourceNodeLocation(node, sourceKey),
        ));
      }
    }
    if (kind && typeof specifier === "string") {
      const key = `${kind}\0${specifier}`;
      if (!occurrences.has(key)) occurrences.set(key, []);
      occurrences.get(key).push({
        source: sourceNodeLocation(node, sourceKey),
        start: node.start,
        end: node.end,
        startLine: node.loc?.start?.line,
        endLine: node.loc?.end?.line,
        startColumn: node.loc?.start?.column + 1,
        endColumn: node.loc?.end?.column + 1,
      });
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end"].includes(key)) continue;
      if (value && typeof value === "object") pending.push(value);
    }
  }
  for (const values of occurrences.values()) {
    values.sort((left, right) => left.start - right.start || left.end - right.end);
  }
  return occurrences;
}

function bindSourceOccurrences(sourceOccurrences, connections, referrerModuleKey, fixtureRoot, diagnostics) {
  const byOccurrence = new Map();
  const canonicalByKey = new Map();
  for (const connection of connections) {
    const dependency = connection.dependency;
    if (isSpecifierDependency(dependency?.type)) continue;
    const kind = dependencyKind(dependency?.type);
    const specifier = dependency?.request;
    if (!kind || typeof specifier !== "string" || specifier.length === 0) continue;
    const key = `${kind}\0${specifier}`;
    if (!canonicalByKey.has(key)) canonicalByKey.set(key, []);
    canonicalByKey.get(key).push(connection);
  }

  for (const [key, occurrences] of sourceOccurrences) {
    const connectionsForKey = canonicalByKey.get(key) ?? [];
    const mappedConnections = new Map(occurrences.map((occurrence) => [occurrence, []]));
    const unlocated = [];
    for (const connection of connectionsForKey) {
      const loc = connection.dependency?.loc;
      if (!loc?.start || !loc?.end) {
        unlocated.push(connection);
        continue;
      }
      const matches = occurrences.filter((occurrence) => dependencyLocationMatches(loc, occurrence));
      if (matches.length !== 1) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_CAPTURE_INCOMPLETE",
          "source-graph",
          `Rspack connection 위치가 원본 import occurrence 하나로 연결되지 않습니다 (${matches.length}개): ${connection.dependency?.request}`,
          referrerModuleKey,
          connection.dependency?.request ?? null,
          sourceLocation(loc, referrerModuleKey),
        ));
        continue;
      }
      mappedConnections.get(matches[0]).push(connection);
    }

    const unmatchedOccurrences = occurrences.filter((occurrence) => mappedConnections.get(occurrence).length === 0);
    if (unlocated.length > 0) {
      const targetIdentities = new Set(unlocated.map((connection) => sourceTargetIdentity(
        connection.resolvedModule ?? connection.module ?? null,
        fixtureRoot,
      )));
      if (unlocated.length !== unmatchedOccurrences.length || targetIdentities.size !== 1) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_CAPTURE_INCOMPLETE",
          "source-graph",
          `위치 없는 Rspack connection과 원본 occurrence를 일대일로 결정할 수 없습니다: ${key.split("\0")[1]}`,
          referrerModuleKey,
          key.split("\0")[1],
        ));
      } else {
        unmatchedOccurrences.forEach((occurrence, index) => {
          mappedConnections.get(occurrence).push(unlocated[index]);
        });
      }
    }

    for (const occurrence of occurrences) {
      const mapped = mappedConnections.get(occurrence);
      if (mapped.length === 0) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_CAPTURE_INCOMPLETE",
          "source-graph",
          `원본 import occurrence에 대응하는 canonical Rspack connection이 없습니다: ${key.split("\0")[1]}`,
          referrerModuleKey,
          key.split("\0")[1],
          occurrence.source,
        ));
        continue;
      }
      if (mapped.length > 1) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_CAPTURE_INCOMPLETE",
          "source-graph",
          `여러 canonical Rspack connection이 하나의 원본 import occurrence에 연결됩니다: ${key.split("\0")[1]}`,
          referrerModuleKey,
          key.split("\0")[1],
          occurrence.source,
        ));
        continue;
      }
      const targetIdentities = new Set(mapped.map((connection) => sourceTargetIdentity(
        connection.resolvedModule ?? connection.module ?? null,
        fixtureRoot,
      )));
      if (targetIdentities.size !== 1) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_TARGET_CONFLICT",
          "source-graph",
          `하나의 원본 import occurrence에 연결된 Rspack connection이 서로 다른 target을 가리킵니다: ${key.split("\0")[1]}`,
          referrerModuleKey,
          key.split("\0")[1],
          occurrence.source,
        ));
        continue;
      }
      byOccurrence.set(occurrence, mapped[0]);
    }
  }

  for (const [key, connectionsForKey] of canonicalByKey) {
    if (!sourceOccurrences.has(key)) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_CAPTURE_INCOMPLETE",
        "source-graph",
        `canonical Rspack connection을 원본 AST occurrence로 연결할 수 없습니다: ${key.split("\0")[1]}`,
        referrerModuleKey,
        key.split("\0")[1],
      ));
    }
  }

  return [...byOccurrence].map(([occurrence, connection]) => ({ occurrence, connection }));
}

function dependencyLocationMatches(loc, occurrence) {
  const start = { line: loc.start.line, column: loc.start.column };
  const end = { line: loc.end.line, column: loc.end.column };
  const occurrenceStart = { line: occurrence.startLine, column: occurrence.startColumn };
  const occurrenceEnd = { line: occurrence.endLine, column: occurrence.endColumn };
  return positionEqual(start, occurrenceStart)
    && positionEqual(end, occurrenceEnd);
}

function positionEqual(left, right) {
  return left.line === right.line && left.column === right.column;
}

function sameStringSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sourceNodeLocation(node, file) {
  if (!node.loc?.start) return null;
  return { file, line: node.loc.start.line, column: node.loc.start.column + 1 };
}

function sourceEdgeKey(edge) {
  return `${edge.referrerModuleKey}\0${edge.kind}\0${edge.sourceSpecifier}\0${edge.resolvedModuleKey ?? ""}\0${edge.external}\0${sourceLocationKey(edge.source)}`;
}

function excludedEdgeKey(edge) {
  return `${edge.referrerModuleKey}\0${edge.kind}\0${edge.sourceSpecifier}\0${edge.targetKind}\0${edge.resolvedResourceKey ?? ""}\0${sourceLocationKey(edge.source)}`;
}

function sourceLocationKey(source) {
  return source === null ? "" : `${source.file}:${source.line}:${source.column}`;
}

function sourceEdgeOrder(left, right) {
  return compareStrings(sourceEdgeKey(left), sourceEdgeKey(right));
}

function excludedEdgeOrder(left, right) {
  return compareStrings(excludedEdgeKey(left), excludedEdgeKey(right));
}

function detectSourceTargetConflicts(dependencies, excludedDependencies, diagnostics) {
  const targetsByRequest = new Map();
  const sourceEdges = [
    ...dependencies.map((edge) => ({
      referrerModuleKey: edge.referrerModuleKey,
      sourceSpecifier: edge.sourceSpecifier,
      target: edge.external ? "external" : `module:${edge.resolvedModuleKey ?? "<unresolved>"}`,
      kind: edge.kind,
      source: edge.source,
    })),
    ...excludedDependencies.map((edge) => ({
      referrerModuleKey: edge.referrerModuleKey,
      sourceSpecifier: edge.sourceSpecifier,
      target: `${edge.targetKind}:${edge.resolvedResourceKey ?? "<unresolved>"}`,
      kind: edge.kind,
      source: edge.source,
    })),
  ];
  for (const edge of sourceEdges) {
    const key = `${edge.referrerModuleKey}\0${edge.sourceSpecifier}`;
    const previous = targetsByRequest.get(key);
    if (previous && previous.target !== edge.target) {
      diagnostics.push(diagnostic(
        "C02_GRAPH_TARGET_CONFLICT",
        "source-graph",
        `같은 원본 referrer/specifier가 dependency kind에 따라 다른 target을 가리킵니다: ${edge.sourceSpecifier}`,
        edge.referrerModuleKey,
        edge.sourceSpecifier,
        edge.source,
      ));
      continue;
    }
    if (!previous) targetsByRequest.set(key, edge);
  }
}

function chunkId(id) {
  return `chunk:${String(id)}`;
}

function chunkKind(chunk) {
  if (chunk.entry) return "entry";
  if (chunk.initial === false) return "dynamic";
  return "static";
}

function assertSupportedFeatureInputs(features) {
  if (Array.isArray(features)
    && features.length === 1
    && features[0]?.id === "main"
    && features[0]?.entrySourceKey === "src/main.js") return;
  throw new Error('Rspack profile은 현재 단일 entry "main" -> "src/main.js" feature만 지원합니다.');
}

function resourceId(outputPath) {
  return `resource:${outputPath}`;
}

function normalizeOutputPath(outputPath) {
  return String(outputPath ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function isJavaScriptOutputPath(outputPath) {
  return /\.(?:js|mjs|cjs)$/i.test(outputPath);
}

function isExternalSpecifier(specifier) {
  return !specifier.startsWith("./") && !specifier.startsWith("../");
}

function dedupeOutputEdges(edges) {
  const byKey = new Map();
  for (const edge of edges) byKey.set(`${edge.kind}\0${edge.specifier}\0${edge.chunkId ?? ""}`, edge);
  return [...byKey.values()].sort((left, right) => compareStrings(
    `${left.specifier}\0${left.kind}\0${left.chunkId ?? ""}`,
    `${right.specifier}\0${right.kind}\0${right.chunkId ?? ""}`,
  ));
}

export function detectOutputTargetConflicts(chunks, diagnostics) {
  for (const chunk of chunks) {
    const targets = new Map();
    for (const edge of chunk.dependencies) {
      const key = `${chunk.id}\0${edge.specifier}`;
      if (targets.has(key) && targets.get(key) !== edge.chunkId) {
        diagnostics.push(diagnostic(
          "C02_GRAPH_TARGET_CONFLICT",
          "output-graph",
          `같은 emitted specifier가 static/dynamic 종류에 따라 다른 target을 가리킵니다: ${edge.specifier}`,
          null,
          edge.specifier,
        ));
      } else {
        targets.set(key, edge.chunkId);
      }
    }
  }
}

function diagnostic(code, stage, message, referrerModuleKey = null, specifier = null, source = null) {
  return { severity: "error", code, stage, message, source, referrerModuleKey, specifier };
}

function dedupeDiagnostics(diagnostics) {
  const byKey = new Map();
  for (const item of diagnostics) {
    const key = `${item.severity}\0${item.stage}\0${item.code}\0${item.referrerModuleKey ?? ""}\0${item.specifier ?? ""}\0${diagnosticSourceKey(item.source)}\0${item.message}`;
    byKey.set(key, item);
  }
  return [...byKey.values()].sort((left, right) => compareStrings(
    `${left.stage}\0${left.code}\0${left.referrerModuleKey ?? ""}\0${left.specifier ?? ""}\0${diagnosticSourceKey(left.source)}`,
    `${right.stage}\0${right.code}\0${right.referrerModuleKey ?? ""}\0${right.specifier ?? ""}\0${diagnosticSourceKey(right.source)}`,
  ));
}

function diagnosticSourceKey(source) {
  return source === null ? "" : `${source.file}:${source.line}:${source.column}`;
}

async function runCompiler(config) {
  const compiler = rspack(config);
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) {
        compiler.close(() => reject(error));
        return;
      }
      if (!stats) {
        compiler.close(() => reject(new Error("Rspack이 stats를 반환하지 않았습니다.")));
        return;
      }
      const json = stats.toJson(config.stats);
      const hasErrors = stats.hasErrors();
      compiler.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve({ json, hasErrors });
      });
    });
  });
}

async function rspackVersion() {
  const resolved = fileURLToPath(import.meta.resolve("@rspack/core"));
  const packagePath = path.resolve(path.dirname(resolved), "..", "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  return packageJson.version;
}

async function captureFixtureSnapshot(fixtureRoot) {
  const rootMetadata = await lstat(fixtureRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`fixture root는 일반 디렉터리여야 합니다: ${fixtureRoot}`);
  }
  const inventory = [];
  let virtualManifestBytes = null;
  const fileBytesByPath = new Map();
  for (const file of await listFiles(fixtureRoot)) {
    const absolutePath = path.join(fixtureRoot, file);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`fixture 항목은 일반 파일이어야 합니다: ${file}`);
    }
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      const openedMetadata = await handle.stat();
      if (!openedMetadata.isFile() || openedMetadata.dev !== metadata.dev || openedMetadata.ino !== metadata.ino) {
        throw new Error(`fixture 항목이 검증 후 바뀌었습니다: ${file}`);
      }
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    inventory.push({ path: file, bytes: bytes.byteLength, sha256: digest(bytes) });
    fileBytesByPath.set(file, bytes);
    if (file === "virtual-modules.json") virtualManifestBytes = bytes;
  }
  inventory.sort((left, right) => compareStrings(left.path, right.path));
  return { sha256: digest(JSON.stringify(inventory)), virtualManifestBytes, fileBytesByPath };
}

async function readFixtureVirtualModules(fixtureRoot, manifestBytes) {
  if (manifestBytes === null) return {};
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (!manifest || !Array.isArray(manifest.modules)) {
    throw new Error("virtual-modules.json에는 modules 배열이 필요합니다.");
  }
  const entries = {};
  const declaredPaths = new Set();
  for (const item of manifest.modules) {
    if (!item || typeof item.path !== "string" || typeof item.source !== "string") {
      throw new Error("virtual module에는 path와 source 문자열이 필요합니다.");
    }
    const relativePath = normalizeOutputPath(item.path);
    const absolutePath = safeOutputPath(fixtureRoot, relativePath);
    if (absolutePath === null || !/\.(?:js|mjs)$/i.test(relativePath)) {
      throw new Error(`virtual module path는 fixture 내부 JavaScript 파일이어야 합니다: ${item.path}`);
    }
    if (declaredPaths.has(absolutePath)) {
      throw new Error(`virtual module path가 중복 선언되었습니다: ${relativePath}`);
    }
    declaredPaths.add(absolutePath);
    try {
      await lstat(absolutePath);
      throw new Error(`virtual module path가 실제 fixture 파일과 충돌합니다: ${relativePath}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    entries[absolutePath] = item.source;
  }
  return entries;
}

export async function assertOutputDirectoryDoesNotOverlapFixture({ fixtureRoot, outputDir, protectedRoots = [] }) {
  if (typeof fixtureRoot !== "string" || typeof outputDir !== "string") {
    throw new Error("fixtureRoot와 outputDir 경로가 필요합니다.");
  }
  const fixtureMetadata = await lstat(fixtureRoot);
  if (!fixtureMetadata.isDirectory() || fixtureMetadata.isSymbolicLink()) {
    throw new Error(`fixture root는 일반 디렉터리여야 합니다: ${fixtureRoot}`);
  }
  const outputRealPath = await prospectiveRealPath(outputDir);
  const temporaryRoot = await realpath(tmpdir());
  if (outputRealPath === temporaryRoot || !pathContains(temporaryRoot, outputRealPath)) {
    throw new Error(`outputDir는 OS 임시 디렉터리 내부의 전용 하위 경로여야 합니다: ${outputDir}`);
  }
  const adapterDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(adapterDirectory, "../..");
  const roots = [fixtureRoot, projectRoot, ...protectedRoots];
  for (const protectedRoot of new Set(roots.map((root) => path.resolve(root)))) {
    const metadata = await lstat(protectedRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`보호 경로는 일반 디렉터리여야 합니다: ${protectedRoot}`);
    }
    const actualProtectedRoot = await realpath(protectedRoot);
    if (pathsOverlap(actualProtectedRoot, outputRealPath)) {
      throw new Error(`outputDir와 보호 경로가 실제 경로에서 겹쳐 output.clean을 안전하게 실행할 수 없습니다: ${protectedRoot}`);
    }
  }
  try {
    await lstat(outputDir);
    throw new Error(`outputDir는 build 시작 전에 존재하지 않는 전용 경로여야 합니다: ${outputDir}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function reserveOutputDirectory({ fixtureRoot, outputDir, protectedRoots = [] }) {
  try {
    await mkdir(outputDir, { recursive: false });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`outputDir 전용 경로를 원자적으로 확보하지 못했습니다: ${outputDir}`);
    }
    throw error;
  }

  const metadata = await lstat(outputDir);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`원자적으로 확보한 outputDir가 일반 디렉터리가 아닙니다: ${outputDir}`);
  }
  const outputRealPath = await realpath(outputDir);
  const temporaryRoot = await realpath(tmpdir());
  if (outputRealPath === temporaryRoot || !pathContains(temporaryRoot, outputRealPath)) {
    throw new Error(`원자적으로 확보한 outputDir가 OS 임시 디렉터리 밖에 있습니다: ${outputDir}`);
  }
  const adapterDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(adapterDirectory, "../..");
  for (const protectedRoot of new Set([fixtureRoot, projectRoot, ...protectedRoots].map((root) => path.resolve(root)))) {
    const actualProtectedRoot = await realpath(protectedRoot);
    if (pathsOverlap(actualProtectedRoot, outputRealPath)) {
      throw new Error(`원자적으로 확보한 outputDir가 보호 경로와 실제 경로에서 겹칩니다: ${protectedRoot}`);
    }
  }
}

async function prospectiveRealPath(inputPath) {
  const absolutePath = path.resolve(inputPath);
  let existingPath = absolutePath;
  const missingSegments = [];
  let metadata;
  while (true) {
    try {
      metadata = await lstat(existingPath);
      break;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = path.dirname(existingPath);
      if (parent === existingPath) throw error;
      missingSegments.unshift(path.basename(existingPath));
      existingPath = parent;
    }
  }

  if (missingSegments.length === 0 && (metadata.isSymbolicLink() || !metadata.isDirectory())) {
    throw new Error(`outputDir는 symlink가 아닌 일반 디렉터리여야 합니다: ${inputPath}`);
  }
  const existingRealPath = await realpath(existingPath);
  const existingTargetMetadata = await stat(existingRealPath);
  if (!existingTargetMetadata.isDirectory()) {
    throw new Error(`outputDir의 가장 가까운 기존 상위 경로가 디렉터리가 아닙니다: ${existingPath}`);
  }
  return path.resolve(existingRealPath, ...missingSegments);
}

function pathsOverlap(left, right) {
  return pathContains(left, right) || pathContains(right, left);
}

function pathContains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function collectOutputInventory(outputDir, diagnostics) {
  let rootMetadata;
  try {
    rootMetadata = await lstat(outputDir);
  } catch (error) {
    diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", `Rspack output root를 확인할 수 없습니다: ${error.message}`));
    return { outputDir, rootRealPath: null, paths: [] };
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", "Rspack output root가 symlink이거나 일반 디렉터리가 아닙니다."));
    return { outputDir, rootRealPath: null, paths: [] };
  }

  let rootRealPath;
  let files;
  try {
    rootRealPath = await realpath(outputDir);
    files = await listFiles(rootRealPath);
  } catch (error) {
    diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", `Rspack output inventory를 수집할 수 없습니다: ${error.message}`));
    return { outputDir, rootRealPath: null, paths: [] };
  }

  const paths = [];
  for (const rawPath of files) {
    const outputPath = normalizeOutputPath(rawPath);
    const absolutePath = safeOutputPath(rootRealPath, outputPath);
    if (absolutePath === null) {
      diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", `Rspack output 항목이 root 밖 경로를 지정합니다: ${rawPath}`));
      continue;
    }
    try {
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", `Rspack output 항목은 symlink가 아닌 일반 파일이어야 합니다: ${outputPath}`));
        continue;
      }
      const resolvedPath = await realpath(absolutePath);
      if (!pathContains(rootRealPath, resolvedPath)) {
        diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", `Rspack output 항목의 실제 경로가 output root 밖입니다: ${outputPath}`));
        continue;
      }
      paths.push(outputPath);
    } catch (error) {
      diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", `Rspack output 항목을 검증할 수 없습니다 (${outputPath}): ${error.message}`));
    }
  }
  return { outputDir, rootRealPath, paths: paths.sort(compareStrings) };
}

async function readValidatedOutputFile(inventory, outputPath, diagnostics) {
  const absolutePath = safeOutputPath(inventory.rootRealPath, outputPath);
  if (!inventory.rootRealPath || !inventory.paths.includes(outputPath) || absolutePath === null) {
    diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", `검증되지 않은 output 파일을 읽으려 했습니다: ${outputPath}`));
    return null;
  }
  try {
    const rootMetadata = await lstat(inventory.outputDir);
    const currentRoot = await realpath(inventory.outputDir);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || currentRoot !== inventory.rootRealPath) {
      throw new Error("output root가 inventory 수집 뒤 바뀌었습니다.");
    }
    const segments = outputPath.split("/");
    let current = inventory.rootRealPath;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      const component = await lstat(current);
      if (component.isSymbolicLink()) throw new Error(`경로 요소가 symlink입니다: ${segments.slice(0, index + 1).join("/")}`);
      if (index < segments.length - 1 && !component.isDirectory()) throw new Error("상위 경로 요소가 디렉터리가 아닙니다.");
    }
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("일반 파일이 아니거나 symlink입니다.");
    const resolvedPath = await realpath(absolutePath);
    if (!pathContains(inventory.rootRealPath, resolvedPath)) throw new Error("실제 파일 경로가 output root 밖입니다.");
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const openedMetadata = await handle.stat();
      if (!openedMetadata.isFile()) throw new Error("open 이후 일반 파일임을 확인하지 못했습니다.");
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch (error) {
    diagnostics.push(diagnostic("C02_GRAPH_CAPTURE_INCOMPLETE", "output-graph", `Rspack output 파일을 안전하게 읽을 수 없습니다 (${outputPath}): ${error.message}`));
    return null;
  }
}

function safeOutputPath(rootRealPath, outputPath) {
  if (typeof rootRealPath !== "string" || !outputPath || path.posix.isAbsolute(outputPath)) return null;
  const segments = outputPath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  const candidate = path.resolve(rootRealPath, ...segments);
  return pathContains(rootRealPath, candidate) && candidate !== rootRealPath ? candidate : null;
}

function hasNativeModuleSyntax(ast) {
  if (ast.body.some((node) => [
    "ImportDeclaration",
    "ExportNamedDeclaration",
    "ExportDefaultDeclaration",
    "ExportAllDeclaration",
  ].includes(node.type))) return true;

  const pending = [{ node: ast, insideFunction: false }];
  while (pending.length > 0) {
    const { node, insideFunction } = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const child of node) pending.push({ node: child, insideFunction });
      continue;
    }
    if (node.type === "MetaProperty" && node.meta?.name === "import" && node.property?.name === "meta") return true;
    if (!insideFunction && (node.type === "AwaitExpression" || (node.type === "ForOfStatement" && node.await))) return true;
    const childIsFunction = insideFunction || ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end"].includes(key)) continue;
      if (value && typeof value === "object") pending.push({ node: value, insideFunction: childIsFunction });
    }
  }
  return false;
}

async function createBuildProfile(effectiveOptions, features) {
  const adapterDirectory = path.dirname(fileURLToPath(import.meta.url));
  const configSources = [
    ["spikes/css-bundler/rspack-module-graph-adapter.mjs", "rspack-module-graph-adapter.mjs"],
    ["spikes/css-bundler/rspack-graph.config.mjs", "rspack-graph.config.mjs"],
    ["spikes/css-bundler/module-graph-contract.mjs", "module-graph-contract.mjs"],
    ["spikes/css-bundler/adapter-support.mjs", "adapter-support.mjs"],
    ["spikes/css-bundler/package.json", "package.json"],
    ["spikes/css-bundler/bun.lock", "bun.lock"],
  ];
  const sources = await Promise.all(configSources.map(async ([relativePath, localPath]) => ({
    path: relativePath,
    sha256: digest(await readFile(path.join(adapterDirectory, localPath))),
  })));
  return {
    configSources: sources,
    effectiveOptions: {
      ...effectiveOptions,
      features,
      runtimeVersions: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    },
  };
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareStrings).map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function compareStrings(left, right) {
  const leftPoints = Array.from(String(left), (value) => value.codePointAt(0));
  const rightPoints = Array.from(String(right), (value) => value.codePointAt(0));
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}
