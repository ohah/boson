import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "acorn";

export const MODULE_GRAPH_CONTRACT = Object.freeze({
  name: "spinon.c02-bundler-module-graph",
  version: "0.1.0-draft",
});

export const MODULE_GRAPH_ADAPTER_VERSION = "0.1.0-spike";

const buildStatuses = new Set(["success", "failed"]);
const graphStatuses = new Set(["complete", "incomplete"]);
const moduleFormats = new Set(["esm", "other", "mixed", "unknown"]);
const edgeKinds = new Set(["static", "dynamic"]);
const chunkKinds = new Set(["entry", "static", "dynamic", "shared"]);
const identityStatuses = new Set(["stable", "unproven"]);
const nonJavaScriptDependencyKinds = new Set(["stylesheet", "asset"]);
const bundlerTools = new Set(["vite", "rspack"]);
const diagnosticCodes = new Set([
  "C02_GRAPH_CAPTURE_INCOMPLETE",
  "C02_GRAPH_UNRESOLVED_IMPORT",
  "C02_GRAPH_EXTERNAL_IMPORT",
  "C02_GRAPH_UNSUPPORTED_IMPORT",
  "C02_GRAPH_OUTPUT_NOT_ESM",
  "C02_GRAPH_TARGET_AMBIGUOUS",
  "C02_GRAPH_TARGET_CONFLICT",
  "C02_GRAPH_RESOURCE_MISSING",
  "C02_GRAPH_PROVENANCE_MISSING",
  "C02_GRAPH_OUTPUT_PARSE_FAILED",
]);

export function computeSourceGraphSha256(sourceGraph) {
  requireJsonDataGraph(sourceGraph);
  requireValue(sourceGraph && typeof sourceGraph === "object", "sourceGraph 객체가 필요합니다.");
  requireValue(Array.isArray(sourceGraph.modules), "sourceGraph.modules 배열이 필요합니다.");
  requireValue(Array.isArray(sourceGraph.dependencies), "sourceGraph.dependencies 배열이 필요합니다.");
  requireValue(Array.isArray(sourceGraph.excludedDependencies), "sourceGraph.excludedDependencies 배열이 필요합니다.");
  requireOnlyKeys(sourceGraph, [
    "scope", "status", "capture", "moduleCount", "edgeCount", "excludedDependencyCount", "sha256",
    "modules", "dependencies", "excludedDependencies",
  ], "sourceGraph");
  validateSourceGraphForDigest(sourceGraph);

  const payload = {
    scope: sourceGraph.scope,
    modules: sorted(sourceGraph.modules, (module) => module.key).map((module) => ({
      key: module.key,
      outputChunkIds: sortedStrings(module.outputChunkIds),
    })),
    dependencies: sorted(sourceGraph.dependencies, sourceEdgeKey).map((edge) => ({
      referrerModuleKey: edge.referrerModuleKey,
      kind: edge.kind,
      sourceSpecifier: edge.sourceSpecifier,
      resolvedModuleKey: edge.resolvedModuleKey,
      external: edge.external,
      source: canonicalSourceLocation(edge.source),
    })),
    excludedDependencies: sorted(sourceGraph.excludedDependencies, excludedEdgeKey).map((edge) => ({
      referrerModuleKey: edge.referrerModuleKey,
      kind: edge.kind,
      sourceSpecifier: edge.sourceSpecifier,
      targetKind: edge.targetKind,
      resolvedResourceKey: edge.resolvedResourceKey,
      source: canonicalSourceLocation(edge.source),
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function computeBuildProfileSha256(profile) {
  requireJsonDataGraph(profile);
  requireValue(profile && typeof profile === "object" && !Array.isArray(profile), "build.profile 객체가 필요합니다.");
  requireOnlyKeys(profile, ["configSources", "effectiveOptions"], "build.profile");
  requireValue(Array.isArray(profile.configSources) && profile.configSources.length > 0, "build.profile.configSources가 필요합니다.");
  requireValue(profile.effectiveOptions && typeof profile.effectiveOptions === "object" && !Array.isArray(profile.effectiveOptions), "build.profile.effectiveOptions 객체가 필요합니다.");
  requireValue(Object.keys(profile.effectiveOptions).length > 0, "build.profile.effectiveOptions가 비었습니다.");

  for (const source of profile.configSources) {
    requireValue(source && typeof source === "object", "build profile config source 객체가 필요합니다.");
    requireValue(typeof source.path === "string", "build profile config source path 문자열이 필요합니다.");
  }
  const paths = new Set();
  const configSources = sorted(profile.configSources, (source) => source.path).map((source) => {
    requireOnlyKeys(source, ["path", "sha256"], "build profile config source");
    requireRelativePath(source.path, "build profile config source path");
    requireSha256(source.sha256, `build profile config source sha256: ${source.path}`);
    requireValue(!paths.has(source.path), `중복 build profile config source: ${source.path}`);
    paths.add(source.path);
    return { path: source.path, sha256: source.sha256 };
  });
  const profileDescriptor = {
    configSources,
    effectiveOptions: profile.effectiveOptions,
  };
  return createHash("sha256").update(canonicalJsonString(profileDescriptor), "utf8").digest("hex");
}

export function createModuleGraphSnapshot(snapshot) {
  requireValue(snapshot && typeof snapshot === "object", "graph snapshot 객체가 필요합니다.");
  requireJsonDataGraph(snapshot);
  const input = { ...snapshot };
  if (!Object.hasOwn(snapshot, "contract")) input.contract = MODULE_GRAPH_CONTRACT;
  requireValue(input.contract?.name === MODULE_GRAPH_CONTRACT.name, "contract.name이 올바르지 않습니다.");
  requireValue(input.contract?.version === MODULE_GRAPH_CONTRACT.version, "contract.version이 올바르지 않습니다.");
  requireSnapshotArrays(input);

  const normalized = {
    ...input,
    sourceGraph: {
      ...input.sourceGraph,
      modules: sorted(input.sourceGraph.modules, (module) => module.key).map((module) => ({
        ...module,
        outputChunkIds: sortedStrings(module.outputChunkIds),
      })),
      dependencies: sorted(input.sourceGraph.dependencies, sourceEdgeKey),
      excludedDependencies: sorted(input.sourceGraph.excludedDependencies, excludedEdgeKey),
    },
    features: sorted(input.features, (feature) => feature.id),
    outputGraph: {
      ...input.outputGraph,
      resources: sorted(input.outputGraph.resources, (resource) => resource.id),
      chunks: sorted(input.outputGraph.chunks, (chunk) => chunk.id).map((chunk) => ({
        ...chunk,
        sourceModuleKeys: sortedStrings(chunk.sourceModuleKeys),
        dependencies: normalizeOutputEdges(chunk.dependencies),
      })),
    },
    diagnostics: sorted(input.diagnostics, diagnosticSortKey),
  };

  assertModuleGraphSnapshot(normalized);
  return normalized;
}

export function assertModuleGraphSnapshot(snapshot) {
  requireJsonDataGraph(snapshot);
  requireValue(snapshot && typeof snapshot === "object", "graph snapshot 객체가 필요합니다.");
  requireOnlyKeys(snapshot, ["contract", "build", "sourceGraph", "features", "outputGraph", "diagnostics"], "snapshot");
  requireValue(snapshot?.contract?.name === MODULE_GRAPH_CONTRACT.name, "contract.name이 올바르지 않습니다.");
  requireValue(snapshot?.contract?.version === MODULE_GRAPH_CONTRACT.version, "contract.version이 올바르지 않습니다.");
  requireOnlyKeys(snapshot.contract, ["name", "version"], "contract");
  requireValue(typeof snapshot.build === "object" && snapshot.build !== null, "build 객체가 필요합니다.");
  requireOnlyKeys(snapshot.build, ["tool", "toolVersion", "adapterVersion", "outputProfile", "status", "fixtureSha256", "profile", "buildProfileSha256"], "build");
  requireValue(bundlerTools.has(snapshot.build.tool), "build.tool은 vite 또는 rspack이어야 합니다.");
  requireValue(typeof snapshot.build.toolVersion === "string" && snapshot.build.toolVersion.length > 0, "build.toolVersion이 비었습니다.");
  requireValue(typeof snapshot.build.adapterVersion === "string" && snapshot.build.adapterVersion.length > 0, "build.adapterVersion이 비었습니다.");
  requireValue(typeof snapshot.build.outputProfile === "string" && snapshot.build.outputProfile.length > 0, "build.outputProfile이 비었습니다.");
  requireValue(buildStatuses.has(snapshot.build.status), "build.status가 올바르지 않습니다.");
  requireSha256(snapshot.build.fixtureSha256, "build.fixtureSha256");
  requireSha256(snapshot.build.buildProfileSha256, "build.buildProfileSha256");
  requireValue(snapshot.build.buildProfileSha256 === computeBuildProfileSha256(snapshot.build.profile), "build.buildProfileSha256가 정규 profile 내용과 다릅니다.");
  requireValue(Array.isArray(snapshot.features), "features 배열이 필요합니다.");
  requireValue(Array.isArray(snapshot.diagnostics), "diagnostics 배열이 필요합니다.");

  const sourceGraph = snapshot.sourceGraph;
  requireValue(sourceGraph && typeof sourceGraph === "object", "sourceGraph 객체가 필요합니다.");
  requireOnlyKeys(sourceGraph, ["scope", "status", "capture", "moduleCount", "edgeCount", "excludedDependencyCount", "sha256", "modules", "dependencies", "excludedDependencies"], "sourceGraph");
  requireValue(sourceGraph.scope === "javascript-module-dependencies", "sourceGraph.scope가 올바르지 않습니다.");
  requireValue(graphStatuses.has(sourceGraph.status), "sourceGraph.status가 올바르지 않습니다.");
  requireValue(typeof sourceGraph.capture === "string" && sourceGraph.capture.length > 0, "sourceGraph.capture가 비었습니다.");
  requireValue(Number.isInteger(sourceGraph.moduleCount) && sourceGraph.moduleCount >= 0, "sourceGraph.moduleCount가 잘못되었습니다.");
  requireValue(Number.isInteger(sourceGraph.edgeCount) && sourceGraph.edgeCount >= 0, "sourceGraph.edgeCount가 잘못되었습니다.");
  requireValue(Number.isInteger(sourceGraph.excludedDependencyCount) && sourceGraph.excludedDependencyCount >= 0, "sourceGraph.excludedDependencyCount가 잘못되었습니다.");
  requireSha256(sourceGraph.sha256, "sourceGraph.sha256");
  requireValue(Array.isArray(sourceGraph.modules), "sourceGraph.modules 배열이 필요합니다.");
  requireValue(Array.isArray(sourceGraph.dependencies), "sourceGraph.dependencies 배열이 필요합니다.");
  requireValue(Array.isArray(sourceGraph.excludedDependencies), "sourceGraph.excludedDependencies 배열이 필요합니다.");
  requireValue(sourceGraph.moduleCount === sourceGraph.modules.length, "sourceGraph.moduleCount가 실제 modules 수와 다릅니다.");
  requireValue(sourceGraph.edgeCount === sourceGraph.dependencies.length, "sourceGraph.edgeCount가 실제 dependencies 수와 다릅니다.");
  requireValue(sourceGraph.excludedDependencyCount === sourceGraph.excludedDependencies.length, "sourceGraph.excludedDependencyCount가 실제 제외 dependency 수와 다릅니다.");

  const sourceModules = new Map();
  for (const module of sourceGraph.modules) {
    requireValue(module && typeof module === "object", "source module 객체가 필요합니다.");
    requireOnlyKeys(module, ["key", "outputChunkIds"], "source module");
    requireModuleKey(module.key, "source module key");
    requireValue(!sourceModules.has(module.key), `중복 source module key: ${module.key}`);
    requireValue(Array.isArray(module.outputChunkIds), `source module outputChunkIds 배열이 필요합니다: ${module.key}`);
    requireUniqueStrings(module.outputChunkIds, `중복 output chunk ID: ${module.key}`);
    sourceModules.set(module.key, module);
  }

  for (const edge of sourceGraph.dependencies) {
    requireValue(edge && typeof edge === "object", "source dependency 객체가 필요합니다.");
    requireOnlyKeys(edge, ["referrerModuleKey", "kind", "sourceSpecifier", "resolvedModuleKey", "external", "source"], "source dependency");
    requireValue(sourceModules.has(edge.referrerModuleKey), `없는 source referrer: ${edge.referrerModuleKey}`);
    requireValue(edgeKinds.has(edge.kind), `잘못된 source dependency kind: ${edge.kind}`);
    requireValue(typeof edge.sourceSpecifier === "string" && edge.sourceSpecifier.length > 0, "sourceSpecifier가 비었습니다.");
    requireValue(edge.resolvedModuleKey === null || typeof edge.resolvedModuleKey === "string", "resolvedModuleKey가 잘못되었습니다.");
    if (edge.resolvedModuleKey !== null) requireModuleKey(edge.resolvedModuleKey, "resolvedModuleKey");
    requireValue(typeof edge.external === "boolean", "source dependency external 값이 필요합니다.");
    requireValue(edge.external || edge.resolvedModuleKey === null || sourceModules.has(edge.resolvedModuleKey), `없는 resolved source module: ${edge.resolvedModuleKey}`);
    requireSourceLocation(edge.source, `source dependency ${edge.sourceSpecifier}`);
  }
  for (const edge of sourceGraph.excludedDependencies) {
    requireValue(edge && typeof edge === "object", "excluded source dependency 객체가 필요합니다.");
    requireOnlyKeys(edge, ["referrerModuleKey", "kind", "sourceSpecifier", "targetKind", "resolvedResourceKey", "source"], "excluded source dependency");
    requireValue(sourceModules.has(edge.referrerModuleKey), `없는 excluded source referrer: ${edge.referrerModuleKey}`);
    requireValue(edgeKinds.has(edge.kind), `잘못된 excluded source dependency kind: ${edge.kind}`);
    requireValue(typeof edge.sourceSpecifier === "string" && edge.sourceSpecifier.length > 0, "excluded sourceSpecifier가 비었습니다.");
    requireValue(nonJavaScriptDependencyKinds.has(edge.targetKind), `분류할 수 없는 non-JavaScript dependency: ${edge.targetKind}`);
    requireValue(edge.resolvedResourceKey === null || typeof edge.resolvedResourceKey === "string", "excluded resolvedResourceKey가 잘못되었습니다.");
    if (edge.resolvedResourceKey !== null) requireModuleKey(edge.resolvedResourceKey, "excluded resolvedResourceKey");
    requireSourceLocation(edge.source, `excluded source dependency ${edge.sourceSpecifier}`);
  }
  requireValue(sourceGraph.sha256 === computeSourceGraphSha256(sourceGraph), "sourceGraph.sha256가 정규화 graph 내용과 다릅니다.");

  const outputGraph = snapshot.outputGraph;
  requireValue(outputGraph && typeof outputGraph === "object", "outputGraph 객체가 필요합니다.");
  requireOnlyKeys(outputGraph, ["status", "moduleFormat", "resources", "chunks"], "outputGraph");
  requireValue(graphStatuses.has(outputGraph.status), "outputGraph.status가 올바르지 않습니다.");
  requireValue(moduleFormats.has(outputGraph.moduleFormat), "outputGraph.moduleFormat이 올바르지 않습니다.");
  requireValue(Array.isArray(outputGraph.resources), "outputGraph.resources 배열이 필요합니다.");
  requireValue(Array.isArray(outputGraph.chunks), "outputGraph.chunks 배열이 필요합니다.");

  const resourcesById = new Map();
  const outputPaths = new Set();
  const resourceLogicalIds = new Set();
  for (const resource of outputGraph.resources) {
    requireValue(resource && typeof resource === "object", "output resource 객체가 필요합니다.");
    requireOnlyKeys(resource, ["id", "logicalId", "identityStatus", "kind", "outputPath", "mediaType", "bytes", "sha256"], "output resource");
    requireValue(typeof resource.id === "string" && resource.id.length > 0, "output resource id가 비었습니다.");
    requireValue(!resourcesById.has(resource.id), `중복 output resource id: ${resource.id}`);
    requireValue(resource.logicalId === null || typeof resource.logicalId === "string", `잘못된 resource logicalId: ${resource.id}`);
    requireValue(identityStatuses.has(resource.identityStatus), `잘못된 resource identityStatus: ${resource.id}`);
    requireValue(resource.identityStatus === "stable" ? resource.logicalId !== null : resource.logicalId === null, `resource logicalId와 identityStatus가 모순됩니다: ${resource.id}`);
    if (resource.logicalId !== null) {
      requireValue(resource.logicalId.length > 0, `stable resource logicalId가 비었습니다: ${resource.id}`);
      requireValue(!resourceLogicalIds.has(resource.logicalId), `중복 stable resource logicalId: ${resource.logicalId}`);
      resourceLogicalIds.add(resource.logicalId);
    }
    requireValue(resource.kind === "javascript", `지원하지 않는 C02.2 resource kind: ${resource.kind}`);
    requireValue(typeof resource.outputPath === "string", `output resource 경로가 비었습니다: ${resource.id}`);
    requireRelativePath(resource.outputPath, "output resource.outputPath");
    requireValue(!outputPaths.has(resource.outputPath), `중복 output resource 경로: ${resource.outputPath}`);
    requireValue(resource.mediaType === "text/javascript" || resource.mediaType === "application/javascript", `잘못된 JavaScript mediaType: ${resource.outputPath}`);
    requireValue(Number.isSafeInteger(resource.bytes) && resource.bytes >= 0, `잘못된 output byte 수: ${resource.outputPath}`);
    requireSha256(resource.sha256, `output resource.sha256: ${resource.outputPath}`);
    resourcesById.set(resource.id, resource);
    outputPaths.add(resource.outputPath);
  }

  const chunksById = new Map();
  const logicalIds = new Set();
  for (const chunk of outputGraph.chunks) {
    requireValue(chunk && typeof chunk === "object", "output chunk 객체가 필요합니다.");
    requireOnlyKeys(chunk, ["id", "logicalId", "identityStatus", "kind", "moduleFormat", "javascriptResourceId", "sourceModuleKeys", "dependencies"], "output chunk");
    requireValue(typeof chunk.id === "string" && chunk.id.length > 0, "output chunk id가 비었습니다.");
    requireValue(!chunksById.has(chunk.id), `중복 output chunk id: ${chunk.id}`);
    requireValue(chunkKinds.has(chunk.kind), `잘못된 output chunk kind: ${chunk.kind}`);
    requireValue(moduleFormats.has(chunk.moduleFormat), `잘못된 chunk moduleFormat: ${chunk.id}`);
    requireValue(chunk.logicalId === null || typeof chunk.logicalId === "string", `잘못된 logicalId: ${chunk.id}`);
    requireValue(identityStatuses.has(chunk.identityStatus), `잘못된 identityStatus: ${chunk.id}`);
    requireValue(chunk.identityStatus === "stable" ? chunk.logicalId !== null : chunk.logicalId === null, `logicalId와 identityStatus가 모순됩니다: ${chunk.id}`);
    if (chunk.logicalId !== null) {
      requireValue(chunk.logicalId.length > 0, `stable logicalId가 비었습니다: ${chunk.id}`);
      requireValue(!logicalIds.has(chunk.logicalId), `중복 stable logicalId: ${chunk.logicalId}`);
      logicalIds.add(chunk.logicalId);
    }
    requireValue(typeof chunk.javascriptResourceId === "string" && chunk.javascriptResourceId.length > 0, `javascriptResourceId가 비었습니다: ${chunk.id}`);
    requireValue(Array.isArray(chunk.sourceModuleKeys), `sourceModuleKeys 배열이 필요합니다: ${chunk.id}`);
    requireUniqueStrings(chunk.sourceModuleKeys, `중복 source module key: ${chunk.id}`);
    for (const moduleKey of chunk.sourceModuleKeys) requireValue(sourceModules.has(moduleKey), `없는 chunk source module: ${moduleKey}`);
    requireValue(Array.isArray(chunk.dependencies), `chunk dependencies 배열이 필요합니다: ${chunk.id}`);
    chunksById.set(chunk.id, chunk);
  }

  for (const module of sourceGraph.modules) {
    for (const chunkId of module.outputChunkIds) requireValue(chunksById.has(chunkId), `없는 module output chunk: ${module.key} -> ${chunkId}`);
  }
  const moduleChunksByKey = new Map(sourceGraph.modules.map((module) => [module.key, new Set(module.outputChunkIds)]));
  for (const chunk of outputGraph.chunks) {
    const resource = resourcesById.get(chunk.javascriptResourceId);
    requireValue(resource?.kind === "javascript", `chunk의 JavaScript resource가 없습니다: ${chunk.id}`);
    for (const moduleKey of chunk.sourceModuleKeys) requireValue(moduleChunksByKey.get(moduleKey)?.has(chunk.id), `source module과 output chunk 소속이 다릅니다: ${moduleKey} -> ${chunk.id}`);
  }
  for (const module of sourceGraph.modules) {
    for (const chunkId of module.outputChunkIds) requireValue(chunksById.get(chunkId)?.sourceModuleKeys.includes(module.key), `output chunk의 module membership이 다릅니다: ${module.key} -> ${chunkId}`);
  }

  const featureIds = new Set();
  for (const feature of snapshot.features) {
    requireValue(feature && typeof feature === "object", "feature 객체가 필요합니다.");
    requireOnlyKeys(feature, ["id", "entrySourceKey", "entryChunkId"], "feature");
    requireValue(typeof feature.id === "string" && feature.id.length > 0, "feature id가 비었습니다.");
    requireValue(!featureIds.has(feature.id), `중복 feature id: ${feature.id}`);
    requireValue(sourceModules.has(feature.entrySourceKey), `없는 feature entry source: ${feature.entrySourceKey}`);
    requireValue(chunksById.has(feature.entryChunkId), `없는 feature entry chunk: ${feature.entryChunkId}`);
    requireValue(moduleChunksByKey.get(feature.entrySourceKey)?.has(feature.entryChunkId), `feature entry source와 chunk 대응이 다릅니다: ${feature.id}`);
    requireValue(["entry", "dynamic"].includes(chunksById.get(feature.entryChunkId).kind), `feature entry chunk은 entry 또는 dynamic kind이어야 합니다: ${feature.id}`);
    featureIds.add(feature.id);
  }

  const edgeTargets = new Map();
  for (const chunk of outputGraph.chunks) {
    const duplicateEdges = new Set();
    for (const edge of chunk.dependencies) {
      requireValue(edge && typeof edge === "object", "output dependency 객체가 필요합니다.");
      requireOnlyKeys(edge, ["kind", "specifier", "chunkId"], "output dependency");
      requireValue(edgeKinds.has(edge.kind), `잘못된 output dependency kind: ${edge.kind}`);
      requireValue(typeof edge.specifier === "string" && edge.specifier.length > 0, "emitted specifier가 비었습니다.");
      requireValue(edge.chunkId === null || (typeof edge.chunkId === "string" && edge.chunkId.length > 0), "output dependency chunkId가 잘못되었습니다.");
      if (edge.chunkId !== null) requireValue(chunksById.has(edge.chunkId), `없는 output dependency target: ${edge.chunkId}`);
      const duplicateKey = JSON.stringify([edge.kind, edge.specifier, edge.chunkId]);
      requireValue(!duplicateEdges.has(duplicateKey), `중복 emitted dependency: ${chunk.id} ${edge.specifier}`);
      duplicateEdges.add(duplicateKey);
      const targetKey = JSON.stringify([chunk.id, edge.specifier]);
      const priorTarget = edgeTargets.get(targetKey);
      requireValue(!edgeTargets.has(targetKey) || priorTarget === edge.chunkId, `static/dynamic emitted target 충돌: ${chunk.id} ${edge.specifier}`);
      edgeTargets.set(targetKey, edge.chunkId);
      if (edge.chunkId === null) requireValue(snapshot.build.status === "failed", `성공 build에 target 없는 emitted dependency가 있습니다: ${chunk.id} ${edge.specifier}`);
      if (edge.chunkId !== null) {
        const referrerResource = resourcesById.get(chunk.javascriptResourceId);
        const resolvedTarget = resolveEmittedChunkTarget({
          referrerPath: referrerResource.outputPath,
          specifier: edge.specifier,
          chunks: outputGraph.chunks,
          resources: outputGraph.resources,
        });
        requireValue(resolvedTarget.status === "resolved" && resolvedTarget.chunkId === edge.chunkId, `emitted specifier와 output target이 일치하지 않습니다: ${chunk.id} ${edge.specifier}`);
      }
    }
  }

  for (const diagnostic of snapshot.diagnostics) {
    requireValue(diagnostic && typeof diagnostic === "object", "diagnostic 객체가 필요합니다.");
    requireOnlyKeys(diagnostic, ["severity", "code", "stage", "message", "source", "referrerModuleKey", "specifier"], "diagnostic");
    requireValue(typeof diagnostic.code === "string" && diagnostic.code.length > 0, "diagnostic code가 비었습니다.");
    requireValue(diagnosticCodes.has(diagnostic.code), `계약에 없는 diagnostic code: ${diagnostic.code}`);
    requireValue(diagnostic.severity === "error", `현재 blocking diagnostic는 error severity여야 합니다: ${diagnostic.code}`);
    requireValue(typeof diagnostic.stage === "string" && diagnostic.stage.length > 0, "diagnostic stage가 비었습니다.");
    requireValue(typeof diagnostic.message === "string" && diagnostic.message.length > 0, "diagnostic message가 비었습니다.");
    requireSourceLocation(diagnostic.source, `diagnostic ${diagnostic.code}`);
    requireValue(diagnostic.referrerModuleKey === null || typeof diagnostic.referrerModuleKey === "string", "diagnostic referrerModuleKey가 잘못되었습니다.");
    requireValue(diagnostic.specifier === null || typeof diagnostic.specifier === "string", "diagnostic specifier가 잘못되었습니다.");
  }

  if (snapshot.build.status === "success") {
    requireValue(sourceGraph.status === "complete", "성공 build의 sourceGraph는 complete여야 합니다.");
    requireValue(outputGraph.status === "complete", "성공 build의 outputGraph는 complete여야 합니다.");
    requireValue(outputGraph.moduleFormat === "esm", "성공 build는 outputGraph ESM이어야 합니다.");
    requireValue(outputGraph.chunks.every((chunk) => chunk.moduleFormat === "esm"), "성공 build의 모든 chunk는 ESM이어야 합니다.");
    requireValue(snapshot.features.length > 0 && outputGraph.chunks.length > 0, "성공 build에 feature entry 또는 output chunk가 없습니다.");
    requireValue(sourceGraph.excludedDependencies.every((edge) => edge.resolvedResourceKey !== null), "성공 build에 미해결 stylesheet 또는 asset dependency가 있습니다.");
    requireValue(outputGraph.resources.length === outputGraph.chunks.length, "성공 build의 JavaScript resource 수와 chunk 수가 다릅니다.");
    const referencedResourceIds = new Set(outputGraph.chunks.map((chunk) => chunk.javascriptResourceId));
    requireValue(outputGraph.resources.every((resource) => referencedResourceIds.has(resource.id)), "성공 build에 chunk가 참조하지 않는 JavaScript resource가 있습니다.");
    requireValue(sourceGraph.dependencies.every((edge) => !edge.external && edge.resolvedModuleKey !== null), "성공 build에 external 또는 미해결 source dependency가 있습니다.");
    requireValue(!snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error"), "성공 build에 error 진단이 있습니다.");
    const reachableChunkIds = new Set();
    const pendingChunkIds = snapshot.features.map((feature) => feature.entryChunkId);
    while (pendingChunkIds.length > 0) {
      const chunkId = pendingChunkIds.pop();
      if (reachableChunkIds.has(chunkId)) continue;
      reachableChunkIds.add(chunkId);
      for (const edge of chunksById.get(chunkId).dependencies) {
        if (edge.chunkId !== null) pendingChunkIds.push(edge.chunkId);
      }
    }
    requireValue(outputGraph.chunks.every((chunk) => reachableChunkIds.has(chunk.id)), "feature entry에서 도달할 수 없는 output chunk가 있습니다.");
  }
  if (snapshot.build.status === "failed") {
    requireValue(snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error"), "실패 build에 error diagnostic가 없습니다.");
  }
}

export function assertR15JavaScriptGraphInput(snapshot) {
  assertModuleGraphSnapshot(snapshot);
  requireValue(snapshot.build.status === "success", "R15 JavaScript graph 입력은 성공 build여야 합니다.");
  requireValue(snapshot.sourceGraph.status === "complete" && snapshot.outputGraph.status === "complete", "R15 JavaScript graph 입력은 모두 complete여야 합니다.");
  const requiresAppWideImpactFallback = [
    ...snapshot.outputGraph.chunks,
    ...snapshot.outputGraph.resources,
  ].some((item) => item.identityStatus !== "stable");
  return {
    snapshot,
    requiresAppWideImpactFallback,
    requiresResourceGraphJoin: true,
  };
}

export function parseEmittedEsm(input) {
  requireJsonDataGraph(input);
  requireValue(input && typeof input === "object" && !Array.isArray(input), "emitted JavaScript parser 입력 객체가 필요합니다.");
  const { code, fileName } = input;
  requireValue(typeof code === "string", "emitted JavaScript code 문자열이 필요합니다.");
  requireRelativePath(fileName, "emitted JavaScript fileName");

  let ast;
  try {
    ast = parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch (error) {
    return {
      status: "failed",
      imports: [],
      diagnostics: [{
        severity: "error",
        code: "C02_GRAPH_OUTPUT_PARSE_FAILED",
        stage: "output-parse",
        message: `최종 JavaScript를 ESM으로 분석하지 못했습니다: ${error.message}`,
        source: error.loc ? { file: fileName, line: error.loc.line, column: error.loc.column + 1 } : null,
        referrerModuleKey: null,
        specifier: null,
      }],
    };
  }

  const imports = [];
  const diagnostics = [];
  const pending = [ast];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) pending.push(node[index]);
      continue;
    }

    if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      const specifier = node.source?.value;
      if (typeof specifier === "string") {
        imports.push({
          kind: "static",
          specifier,
          source: { file: fileName, line: node.loc.start.line, column: node.loc.start.column + 1 },
        });
      }
      const attributes = node.attributes ?? node.assertions ?? [];
      if (attributes.length > 0) diagnostics.push(unsupportedImportDiagnostic(fileName, node, "최종 JavaScript에 지원하지 않는 import attribute가 있습니다.", specifier ?? null));
    }

    if (node.type === "ImportExpression") {
      if (node.source?.type !== "Literal" || typeof node.source.value !== "string") {
        diagnostics.push(unsupportedImportDiagnostic(fileName, node, "계산형 dynamic import는 출력 자원 하나에 연결할 수 없습니다.", null));
      } else {
        imports.push({
          kind: "dynamic",
          specifier: node.source.value,
          source: { file: fileName, line: node.loc.start.line, column: node.loc.start.column + 1 },
        });
      }
      if (node.options != null) diagnostics.push(unsupportedImportDiagnostic(fileName, node, "최종 JavaScript에 지원하지 않는 dynamic import 옵션이 있습니다.", node.source?.value ?? null));
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      if (value && typeof value === "object") pending.push(value);
    }
  }

  imports.sort((left, right) => left.source.line - right.source.line || left.source.column - right.source.column || compareStrings(left.kind, right.kind) || compareStrings(left.specifier, right.specifier));
  diagnostics.sort((left, right) => (left.source?.line ?? 0) - (right.source?.line ?? 0) || (left.source?.column ?? 0) - (right.source?.column ?? 0) || compareStrings(left.code, right.code));
  return { status: diagnostics.length === 0 ? "success" : "failed", imports, diagnostics };
}

export function resolveLocalOutputPath(input) {
  requireJsonDataGraph(input);
  requireValue(input && typeof input === "object" && !Array.isArray(input), "emitted path resolver 입력 객체가 필요합니다.");
  const { referrerPath, specifier } = input;
  if (typeof referrerPath !== "string" || typeof specifier !== "string") return null;
  try {
    requireRelativePath(referrerPath, "referrerPath");
  } catch {
    return null;
  }
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (specifier.includes("?") || specifier.includes("#")) return null;
  if (specifier.includes("\\") || specifier.includes("\0")) return null;
  const encodedPathname = specifier;
  if (/%(?:2f|5c|00)/i.test(encodedPathname)) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    return null;
  }
  if (!pathname || pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("\0")) return null;
  const finalSegment = pathname.split("/").at(-1);
  if (finalSegment === "" || finalSegment === "." || finalSegment === "..") return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(referrerPath), pathname));
  if (resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) return null;
  return resolved;
}

export function resolveEmittedChunkTarget(input) {
  requireJsonDataGraph(input);
  requireValue(input && typeof input === "object" && !Array.isArray(input), "emitted target resolver 입력 객체가 필요합니다.");
  const { referrerPath, specifier, chunks, resources } = input;
  requireValue(Array.isArray(chunks) && Array.isArray(resources), "emitted target 확인에 chunks·resources 배열이 필요합니다.");
  requireValue(resources.every((resource) => resource && typeof resource === "object" && !Array.isArray(resource)
    && typeof resource.id === "string" && resource.id.length > 0
    && typeof resource.kind === "string"
    && typeof resource.outputPath === "string"), "emitted target resource에는 id·kind·outputPath가 필요합니다.");
  requireValue(new Set(resources.map((resource) => resource.id)).size === resources.length, "emitted target resource id가 중복되었습니다.");
  requireValue(chunks.every((chunk) => chunk && typeof chunk === "object" && !Array.isArray(chunk)
    && typeof chunk.id === "string" && chunk.id.length > 0
    && typeof chunk.javascriptResourceId === "string" && chunk.javascriptResourceId.length > 0), "emitted target chunk에는 id와 javascriptResourceId가 필요합니다.");
  requireValue(new Set(chunks.map((chunk) => chunk.id)).size === chunks.length, "emitted target chunk id가 중복되었습니다.");
  const outputPath = resolveLocalOutputPath({ referrerPath, specifier });
  if (outputPath === null) return { status: "unresolved", outputPath: null, chunkId: null };
  const matches = resources.filter((resource) => resource.kind === "javascript" && resource.outputPath === outputPath);
  if (matches.length === 0) return { status: "unresolved", outputPath, chunkId: null };
  if (matches.length !== 1) return { status: "ambiguous", outputPath, chunkId: null };
  const chunkMatches = chunks.filter((chunk) => chunk.javascriptResourceId === matches[0].id);
  if (chunkMatches.length === 0) return { status: "unresolved", outputPath, chunkId: null };
  if (chunkMatches.length !== 1) return { status: "ambiguous", outputPath, chunkId: null };
  return { status: "resolved", outputPath, chunkId: chunkMatches[0].id };
}

function normalizeOutputEdges(edges) {
  requireValue(Array.isArray(edges), "output dependency 배열이 필요합니다.");
  const byKey = new Map();
  for (const edge of edges) {
    requireValue(edge && typeof edge === "object" && !Array.isArray(edge), "output dependency 객체가 필요합니다.");
    requireOnlyKeys(edge, ["kind", "specifier", "chunkId"], "output dependency");
    requireValue(edgeKinds.has(edge.kind), `잘못된 output dependency kind: ${edge.kind}`);
    requireValue(typeof edge.specifier === "string" && edge.specifier.length > 0, "emitted specifier가 비었습니다.");
    requireValue(edge.chunkId === null || (typeof edge.chunkId === "string" && edge.chunkId.length > 0), "output dependency chunkId가 잘못되었습니다.");
    byKey.set(JSON.stringify([edge.kind, edge.specifier, edge.chunkId]), edge);
  }
  return [...byKey.values()].sort((left, right) => compareStrings(outputEdgeKey(left), outputEdgeKey(right)));
}

function requireJsonDataGraph(value, ancestors = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    requireValue(value === null || ["string", "number", "boolean"].includes(typeof value), "snapshot은 JSON 원시 값만 포함할 수 있습니다.");
    return;
  }
  requireValue(!ancestors.has(value), "snapshot은 순환 참조를 포함할 수 없습니다.");
  ancestors.add(value);
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  requireValue(isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, "snapshot은 일반 JSON 객체와 배열만 포함할 수 있습니다.");
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (isArray && key === "length") {
      requireValue(descriptor && !descriptor.enumerable && Object.hasOwn(descriptor, "value"), "snapshot 배열의 length는 일반 데이터 필드여야 합니다.");
      continue;
    }
    requireValue(typeof key === "string", "snapshot은 symbol 필드를 포함할 수 없습니다.");
    requireValue(descriptor?.enumerable && Object.hasOwn(descriptor, "value"), "snapshot은 accessor 또는 비열거 필드를 포함할 수 없습니다.");
    if (isArray) requireValue(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length, "snapshot 배열은 빈 항목이나 추가 속성을 가질 수 없습니다.");
    requireJsonDataGraph(descriptor.value, ancestors);
  }
  if (isArray) requireValue(keys.length === value.length + 1, "snapshot 배열은 빈 항목을 가질 수 없습니다.");
  ancestors.delete(value);
}

function sourceEdgeKey(edge) {
  return JSON.stringify([edge.referrerModuleKey, edge.kind, edge.sourceSpecifier, edge.resolvedModuleKey, edge.external, sourceLocationKey(edge.source)]);
}

function excludedEdgeKey(edge) {
  return JSON.stringify([edge.referrerModuleKey, edge.kind, edge.sourceSpecifier, edge.targetKind, edge.resolvedResourceKey, sourceLocationKey(edge.source)]);
}

function outputEdgeKey(edge) {
  return JSON.stringify([edge.specifier, edge.kind, edge.chunkId]);
}

function diagnosticSortKey(diagnostic) {
  return JSON.stringify([
    diagnostic.stage,
    diagnostic.code,
    diagnostic.referrerModuleKey,
    diagnostic.specifier,
    diagnostic.source,
    diagnostic.severity,
    diagnostic.message,
  ]);
}

function sourceLocationKey(source) {
  return source == null ? null : [source.file, source.line, source.column];
}

function canonicalSourceLocation(source) {
  return source == null ? null : { file: source.file, line: source.line, column: source.column };
}

function compareStrings(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function validateSourceGraphForDigest(sourceGraph) {
  requireValue(sourceGraph.scope === "javascript-module-dependencies", "sourceGraph.scope가 올바르지 않습니다.");
  const modules = new Map();
  for (const module of sourceGraph.modules) {
    requireValue(module && typeof module === "object", "source module 객체가 필요합니다.");
    requireOnlyKeys(module, ["key", "outputChunkIds"], "source module");
    requireModuleKey(module.key, "source module key");
    requireValue(Array.isArray(module.outputChunkIds), `source module outputChunkIds 배열이 필요합니다: ${module.key}`);
    requireUniqueStrings(module.outputChunkIds, `중복 output chunk ID: ${module.key}`);
    requireValue(!modules.has(module.key), `중복 source module key: ${module.key}`);
    modules.set(module.key, module);
  }
  for (const edge of sourceGraph.dependencies) {
    requireValue(edge && typeof edge === "object", "source dependency 객체가 필요합니다.");
    requireOnlyKeys(edge, ["referrerModuleKey", "kind", "sourceSpecifier", "resolvedModuleKey", "external", "source"], "source dependency");
    requireValue(modules.has(edge.referrerModuleKey), `없는 source referrer: ${edge.referrerModuleKey}`);
    requireValue(edgeKinds.has(edge.kind), `잘못된 source dependency kind: ${edge.kind}`);
    requireValue(typeof edge.sourceSpecifier === "string" && edge.sourceSpecifier.length > 0, "sourceSpecifier가 비었습니다.");
    requireValue(edge.resolvedModuleKey === null || typeof edge.resolvedModuleKey === "string", "resolvedModuleKey가 잘못되었습니다.");
    if (edge.resolvedModuleKey !== null) requireModuleKey(edge.resolvedModuleKey, "resolvedModuleKey");
    requireValue(typeof edge.external === "boolean", "source dependency external 값이 필요합니다.");
    requireValue(edge.external || edge.resolvedModuleKey === null || modules.has(edge.resolvedModuleKey), `없는 resolved source module: ${edge.resolvedModuleKey}`);
    requireSourceLocation(edge.source, `source dependency ${edge.sourceSpecifier}`);
  }
  for (const edge of sourceGraph.excludedDependencies) {
    requireValue(edge && typeof edge === "object", "excluded source dependency 객체가 필요합니다.");
    requireOnlyKeys(edge, ["referrerModuleKey", "kind", "sourceSpecifier", "targetKind", "resolvedResourceKey", "source"], "excluded source dependency");
    requireValue(modules.has(edge.referrerModuleKey), `없는 excluded source referrer: ${edge.referrerModuleKey}`);
    requireValue(edgeKinds.has(edge.kind), `잘못된 excluded source dependency kind: ${edge.kind}`);
    requireValue(typeof edge.sourceSpecifier === "string" && edge.sourceSpecifier.length > 0, "excluded sourceSpecifier가 비었습니다.");
    requireValue(nonJavaScriptDependencyKinds.has(edge.targetKind), `분류할 수 없는 non-JavaScript dependency: ${edge.targetKind}`);
    requireValue(edge.resolvedResourceKey === null || typeof edge.resolvedResourceKey === "string", "excluded resolvedResourceKey가 잘못되었습니다.");
    if (edge.resolvedResourceKey !== null) requireModuleKey(edge.resolvedResourceKey, "excluded resolvedResourceKey");
    requireSourceLocation(edge.source, `excluded source dependency ${edge.sourceSpecifier}`);
  }
}

function canonicalJsonString(value, ancestors = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    requireValue(Number.isSafeInteger(value), "build profile 숫자는 안전한 정수여야 합니다.");
    return String(value);
  }
  requireValue(value && typeof value === "object", "build profile은 JSON 값만 포함할 수 있습니다.");
  requireValue(!ancestors.has(value), "build profile에 순환 참조가 있습니다.");
  ancestors.add(value);
  let serialized;
  if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      requireValue(keys.length === value.length + 1 && keys.includes("length"), "build profile 배열은 빈 항목과 추가 속성을 가질 수 없습니다.");
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        requireValue(descriptor?.enumerable && Object.hasOwn(descriptor, "value") && keys[index] !== undefined, "build profile 배열은 빈 항목과 추가 속성을 가질 수 없습니다.");
      }
      requireValue(keys.filter((key) => key !== "length").every((key, index) => key === String(index)), "build profile 배열은 빈 항목과 추가 속성을 가질 수 없습니다.");
      serialized = `[${value.map((item) => canonicalJsonString(item, ancestors)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    requireValue(prototype === Object.prototype || prototype === null, "build profile은 일반 JSON 객체만 포함할 수 있습니다.");
    const keys = Reflect.ownKeys(value);
    requireValue(keys.every((key) => typeof key === "string"), "build profile 객체는 문자열 키만 포함할 수 있습니다.");
    const fields = [];
    for (const key of keys.sort(compareStrings)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireValue(descriptor?.enumerable && Object.hasOwn(descriptor, "value"), `build profile 속성은 열거 가능한 값이어야 합니다: ${key}`);
      fields.push(`${JSON.stringify(key)}:${canonicalJsonString(descriptor.value, ancestors)}`);
    }
    serialized = `{${fields.join(",")}}`;
  }
  ancestors.delete(value);
  return serialized;
}

function unsupportedImportDiagnostic(fileName, node, message, specifier) {
  return {
    severity: "error",
    code: "C02_GRAPH_UNSUPPORTED_IMPORT",
    stage: "output-parse",
    message,
    source: node.loc?.start ? { file: fileName, line: node.loc.start.line, column: node.loc.start.column + 1 } : null,
    referrerModuleKey: null,
    specifier,
  };
}

function requireSnapshotArrays(snapshot) {
  for (const [key, value] of Object.entries({
    features: snapshot.features,
    diagnostics: snapshot.diagnostics,
    sourceGraphModules: snapshot.sourceGraph?.modules,
    sourceGraphDependencies: snapshot.sourceGraph?.dependencies,
    sourceGraphExcludedDependencies: snapshot.sourceGraph?.excludedDependencies,
    outputGraphResources: snapshot.outputGraph?.resources,
    outputGraphChunks: snapshot.outputGraph?.chunks,
  })) requireValue(Array.isArray(value), `${key} 배열이 필요합니다.`);
  requireValue(snapshot.sourceGraph && typeof snapshot.sourceGraph === "object", "sourceGraph 객체가 필요합니다.");
  requireValue(snapshot.outputGraph && typeof snapshot.outputGraph === "object", "outputGraph 객체가 필요합니다.");
  for (const module of snapshot.sourceGraph.modules) {
    requireValue(module && typeof module === "object", "source module 객체가 필요합니다.");
    requireValue(typeof module.key === "string", "source module key 문자열이 필요합니다.");
    requireValue(Array.isArray(module.outputChunkIds), `source module outputChunkIds 배열이 필요합니다: ${module.key}`);
  }
  for (const edge of [...snapshot.sourceGraph.dependencies, ...snapshot.sourceGraph.excludedDependencies]) {
    requireValue(edge && typeof edge === "object", "source dependency 객체가 필요합니다.");
  }
  for (const feature of snapshot.features) {
    requireValue(feature && typeof feature === "object" && typeof feature.id === "string", "feature id 문자열이 필요합니다.");
  }
  for (const resource of snapshot.outputGraph.resources) {
    requireValue(resource && typeof resource === "object" && typeof resource.id === "string", "output resource id 문자열이 필요합니다.");
  }
  for (const chunk of snapshot.outputGraph.chunks) {
    requireValue(chunk && typeof chunk === "object" && typeof chunk.id === "string", "output chunk id 문자열이 필요합니다.");
    requireValue(Array.isArray(chunk.sourceModuleKeys), `sourceModuleKeys 배열이 필요합니다: ${chunk.id}`);
    requireValue(Array.isArray(chunk.dependencies), `chunk dependencies 배열이 필요합니다: ${chunk.id}`);
    for (const edge of chunk.dependencies) requireValue(edge && typeof edge === "object", `output dependency 객체가 필요합니다: ${chunk.id}`);
  }
  for (const diagnostic of snapshot.diagnostics) {
    requireValue(diagnostic && typeof diagnostic === "object", "diagnostic 객체가 필요합니다.");
  }
}

function requireSourceLocation(source, name) {
  requireValue(source === null || (source && typeof source === "object"), `${name} source 위치가 잘못되었습니다.`);
  if (source === null) return;
  requireOnlyKeys(source, ["file", "line", "column"], `${name} source 위치`);
  requireModuleKey(source.file, `${name} source file`);
  requireValue(Number.isSafeInteger(source.line) && source.line > 0, `${name} source line이 잘못되었습니다.`);
  requireValue(Number.isSafeInteger(source.column) && source.column > 0, `${name} source column이 잘못되었습니다.`);
}

function requireRelativePath(value, name) {
  requireValue(typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.includes("\0"), `${name} 상대 경로가 잘못되었습니다.`);
  requireValue(!/^[A-Za-z]:/.test(value), `${name} Windows drive path는 상대 경로가 아닙니다.`);
  requireValue(!path.posix.isAbsolute(value) && value !== ".." && !value.startsWith("../"), `${name} 경로가 출력 루트 밖입니다.`);
  requireValue(path.posix.normalize(value) === value && !value.split("/").some((segment) => segment === "" || segment === "." || segment === ".."), `${name} 경로가 정규화되지 않았습니다.`);
}

function requireModuleKey(value, name) {
  requireValue(typeof value === "string" && value.length > 0, `${name}가 비었습니다.`);
  requireValue(!/[\\\u0000-\u001f\u007f]/.test(value) && !/^(?:[A-Za-z]:|\/)/.test(value), `${name}가 절대 경로 또는 비정상 키입니다.`);
  requireValue(!value.split("/").some((segment) => segment === "" || segment === "." || segment === ".."), `${name}가 정규화되지 않았거나 입력 루트 밖입니다.`);
}

function requireSha256(value, name) {
  requireValue(/^[a-f0-9]{64}$/.test(value ?? ""), `${name}은 소문자 SHA-256이어야 합니다.`);
}

function requireUniqueStrings(values, message) {
  requireValue(values.every((item) => typeof item === "string" && item.length > 0), message);
  requireValue(new Set(values).size === values.length, message);
}

function sorted(values, keyOf) {
  return [...values].sort((left, right) => compareStrings(keyOf(left), keyOf(right)));
}

function sortedStrings(values) {
  return [...values].sort(compareStrings);
}

function requireOnlyKeys(value, allowedKeys, name) {
  const allowed = new Set(allowedKeys);
  for (const key of Reflect.ownKeys(value)) {
    requireValue(typeof key === "string" && allowed.has(key), `${name}에 계약 외 필드가 있습니다: ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor?.enumerable && Object.hasOwn(descriptor, "value"), `${name} 필드는 열거 가능한 값이어야 합니다: ${key}`);
  }
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
