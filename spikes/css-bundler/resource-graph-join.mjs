import { createHash } from "node:crypto";
import { assertAdapterSnapshot, createAdapterSnapshot } from "./adapter-contract.mjs";
import {
  computeBuildProfileSha256,
  createModuleGraphSnapshot,
} from "./module-graph-contract.mjs";

export const C02_RESOURCE_GRAPH_JOIN_CONTRACT = Object.freeze({
  name: "spinon.c02-resource-graph-join",
  version: "0.1.0-draft",
});

const JOIN_CODES = new Set([
  "C02_JOIN_BUILD_MISMATCH",
  "C02_JOIN_GRAPH_INCOMPLETE",
  "C02_JOIN_JS_RESOURCE_MISMATCH",
  "C02_JOIN_RESOURCE_MISSING",
  "C02_JOIN_TARGET_AMBIGUOUS",
  "C02_JOIN_RESOURCE_KIND_UNSUPPORTED",
  "C02_JOIN_EXTERNAL_RESOURCE",
  "C02_JOIN_ORPHAN_RESOURCE",
]);
const RUNTIME_RESOURCE_KINDS = new Set(["javascript", "stylesheet", "font", "image"]);
const CSS_ASSET_KINDS = new Set(["font", "image"]);
const BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * 같은 production build에서 수집한 0011·0014 snapshot을 build-local graph로 결합한다.
 * 제품 OTA manifest나 빌드 간 stable ID는 만들지 않는다.
 */
export function createC02ResourceGraphJoin(input) {
  const args = cloneJsonData(input, "join input");
  requireOnlyKeys(args, ["resourceSnapshot", "moduleGraphSnapshot"], "join input");
  const rawResource = cloneJsonData(args.resourceSnapshot, "resourceSnapshot");
  const rawModuleGraph = cloneJsonData(args.moduleGraphSnapshot, "moduleGraphSnapshot");
  const build = assertMatchingBuildMetadata(rawResource, rawModuleGraph);
  const moduleGraph = validateModuleGraph(rawModuleGraph);
  const normalizedResource = validateResourceGraph(rawResource);

  const { moduleChunkToResourceChunk } = matchJavaScriptChunks(
    normalizedResource,
    moduleGraph,
  );
  validateExcludedDependencies(normalizedResource, moduleGraph, moduleChunkToResourceChunk);
  const joinedResources = collectRuntimeResources(normalizedResource, moduleGraph);
  const resourcesById = new Map(joinedResources.map((resource) => [resource.id, resource]));
  const resourceEdges = createCssResourceEdges(normalizedResource, resourcesById);
  const chunks = moduleGraph.outputGraph.chunks.map((chunk) => {
    const resourceChunk = moduleChunkToResourceChunk.get(chunk.id);
    if (!resourceChunk) {
      fail("C02_JOIN_JS_RESOURCE_MISMATCH", `0014 chunk의 0011 owner chunk가 없습니다: ${chunk.id}`);
    }
    return {
      ...cloneJsonData(chunk, `chunk ${chunk.id}`),
      stylesheetResourceIds: [...resourceChunk.stylesheetResourceIds],
      assetResourceIds: [...resourceChunk.assetResourceIds],
    };
  }).sort((left, right) => compareStrings(left.id, right.id));
  const features = buildFeatureClosures(moduleGraph.features, chunks, joinedResources, resourceEdges);
  const provenance = {
    excludedDependencies: cloneJsonData(rawModuleGraph.sourceGraph.excludedDependencies, "excludedDependencies"),
    stylesheets: rawResource.stylesheets.map((stylesheet) => ({
      id: stylesheet.id,
      sourcePath: stylesheet.sourcePath,
      imports: cloneJsonData(stylesheet.imports, `stylesheet imports ${stylesheet.sourcePath}`),
      references: cloneJsonData(stylesheet.references, `stylesheet references ${stylesheet.sourcePath}`),
    })),
  };
  const snapshot = {
    contract: { ...C02_RESOURCE_GRAPH_JOIN_CONTRACT },
    build,
    sourceDigests: {
      moduleGraphSha256: sha256(canonicalJson(rawModuleGraph)),
      resourceGraphSha256: sha256(canonicalJson(rawResource)),
    },
    features,
    chunks,
    resources: joinedResources,
    resourceEdges: resourceEdges.sort(compareResourceEdges),
    provenance,
    diagnostics: [],
  };
  assertC02ResourceGraphJoin(snapshot);
  return snapshot;
}

/** 조인 결과의 닫힌 schema, 참조 종류, feature reachability를 재검증한다. */
export function assertC02ResourceGraphJoin(snapshot) {
  const value = cloneJsonData(snapshot, "join snapshot");
  requireOnlyKeys(value, [
    "contract", "build", "sourceDigests", "features", "chunks", "resources",
    "resourceEdges", "provenance", "diagnostics",
  ], "join snapshot");
  requireJoin(value.contract?.name === C02_RESOURCE_GRAPH_JOIN_CONTRACT.name
    && value.contract?.version === C02_RESOURCE_GRAPH_JOIN_CONTRACT.version,
  "C02_JOIN_GRAPH_INCOMPLETE", "join contract 식별자가 올바르지 않습니다.");
  requireOnlyKeys(value.contract, ["name", "version"], "join contract");

  validateJoinedBuild(value.build);
  requireOnlyKeys(value.sourceDigests, ["moduleGraphSha256", "resourceGraphSha256"], "sourceDigests");
  requireJoin(SHA256_PATTERN.test(value.sourceDigests?.moduleGraphSha256 ?? "")
    && SHA256_PATTERN.test(value.sourceDigests?.resourceGraphSha256 ?? ""),
  "C02_JOIN_GRAPH_INCOMPLETE", "sourceDigests에는 SHA-256 두 개가 필요합니다.");
  for (const field of ["features", "chunks", "resources", "resourceEdges", "diagnostics"]) {
    requireJoin(Array.isArray(value[field]), "C02_JOIN_GRAPH_INCOMPLETE", `${field} 배열이 필요합니다.`);
  }
  requireJoin(value.features.length > 0 && value.chunks.length > 0 && value.resources.length > 0,
    "C02_JOIN_GRAPH_INCOMPLETE", "성공 join에는 feature, chunk, runtime resource가 하나 이상 필요합니다.");
  requireJoin(value.diagnostics.length === 0, "C02_JOIN_GRAPH_INCOMPLETE", "성공 join에는 blocking 진단이 없어야 합니다.");
  validateProvenance(value.provenance);

  const resourcesById = validateJoinedResources(value.resources);
  const chunksById = validateJoinedChunks(value.chunks, resourcesById);
  validateResourceEdges(value.resourceEdges, resourcesById);
  validateJoinedFeatures(value.features, chunksById, resourcesById, value.resourceEdges);

  const reachableChunks = new Set(value.features.flatMap((feature) => feature.chunkIds));
  const reachableResources = new Set(value.features.flatMap((feature) => feature.resourceIds));
  requireJoin(value.chunks.every((chunk) => reachableChunks.has(chunk.id)),
    "C02_JOIN_ORPHAN_RESOURCE", "feature entry에서 도달할 수 없는 JS chunk가 있습니다.");
  requireJoin(value.resources.every((resource) => reachableResources.has(resource.id)),
    "C02_JOIN_ORPHAN_RESOURCE", "feature entry에서 도달할 수 없는 runtime resource가 있습니다.");
  return true;
}

function assertMatchingBuildMetadata(resourceSnapshot, moduleGraphSnapshot) {
  const resourceBuild = resourceSnapshot?.build;
  const moduleBuild = moduleGraphSnapshot?.build;
  requireJoin(resourceBuild && moduleBuild, "C02_JOIN_BUILD_MISMATCH", "두 snapshot build metadata가 필요합니다.");
  const required = ["captureId", "tool", "toolVersion", "fixtureSha256", "profile", "buildProfileSha256"];
  for (const field of required) {
    requireJoin(Object.hasOwn(resourceBuild, field) && Object.hasOwn(moduleBuild, field),
      "C02_JOIN_BUILD_MISMATCH", `양 snapshot에 build.${field}가 필요합니다.`);
  }
  requireJoin(resourceBuild.captureId === moduleBuild.captureId && BUILD_ID_PATTERN.test(resourceBuild.captureId),
    "C02_JOIN_BUILD_MISMATCH", "양 snapshot의 production captureId가 같은 UUID v4가 아닙니다.");
  requireJoin(resourceBuild.tool === moduleBuild.tool
    && resourceBuild.toolVersion === moduleBuild.toolVersion,
  "C02_JOIN_BUILD_MISMATCH", "번들러 종류 또는 정확한 버전이 다릅니다.");
  requireJoin(resourceBuild.fixtureSha256 === moduleBuild.fixtureSha256
    && SHA256_PATTERN.test(resourceBuild.fixtureSha256 ?? ""),
  "C02_JOIN_BUILD_MISMATCH", "fixture digest가 같지 않거나 SHA-256 형식이 아닙니다.");
  requireJoin(canonicalJson(resourceBuild.profile) === canonicalJson(moduleBuild.profile),
    "C02_JOIN_BUILD_MISMATCH", "양 snapshot의 build profile 내용이 다릅니다.");
  requireJoin(resourceBuild.buildProfileSha256 === moduleBuild.buildProfileSha256
    && SHA256_PATTERN.test(resourceBuild.buildProfileSha256 ?? ""),
  "C02_JOIN_BUILD_MISMATCH", "양 snapshot의 build profile digest가 같지 않습니다.");
  let calculatedProfileDigest;
  try {
    calculatedProfileDigest = computeBuildProfileSha256(moduleBuild.profile);
  } catch (error) {
    fail("C02_JOIN_BUILD_MISMATCH", `build profile을 검증할 수 없습니다: ${error.message}`);
  }
  requireJoin(calculatedProfileDigest === moduleBuild.buildProfileSha256,
    "C02_JOIN_BUILD_MISMATCH", "buildProfileSha256가 profile 내용과 일치하지 않습니다.");
  requireJoin(resourceBuild.mode === "production"
    && moduleBuild.profile?.effectiveOptions?.mode === "production",
  "C02_JOIN_BUILD_MISMATCH", "양 snapshot이 같은 production mode build를 가리키지 않습니다.");
  return {
    captureId: resourceBuild.captureId,
    tool: resourceBuild.tool,
    toolVersion: resourceBuild.toolVersion,
    mode: "production",
    fixtureSha256: resourceBuild.fixtureSha256,
    profile: cloneJsonData(moduleBuild.profile, "build profile"),
    buildProfileSha256: resourceBuild.buildProfileSha256,
  };
}

function validateModuleGraph(rawSnapshot) {
  requireJoin(rawSnapshot && typeof rawSnapshot === "object" && rawSnapshot.build,
    "C02_JOIN_GRAPH_INCOMPLETE", "0014 module graph snapshot 형식이 올바르지 않습니다.");
  try {
    const normalized = createModuleGraphSnapshot(rawSnapshot);
    requireJoin(normalized.sourceGraph.status === "complete",
      "C02_JOIN_GRAPH_INCOMPLETE", "0014 sourceGraph가 complete 상태가 아닙니다.");
    requireJoin(normalized.outputGraph.status === "complete",
      "C02_JOIN_GRAPH_INCOMPLETE", "0014 outputGraph가 complete 상태가 아닙니다.");
    requireJoin(normalized.build.status === "success",
      "C02_JOIN_GRAPH_INCOMPLETE", "0014 build가 성공하지 않았습니다.");
    requireJoin(!normalized.diagnostics.some((item) => item.severity === "error"),
      "C02_JOIN_GRAPH_INCOMPLETE", "0014 module graph에 blocking error 진단이 있습니다.");
    return normalized;
  } catch (error) {
    fail("C02_JOIN_GRAPH_INCOMPLETE", `0014 module graph snapshot이 유효하지 않습니다: ${error.message}`);
  }
}

function validateResourceGraph(rawSnapshot) {
  try {
    const normalized = createAdapterSnapshot(rawSnapshot);
    assertAdapterSnapshot(normalized);
    requireJoin(normalized.build.status === "success",
      "C02_JOIN_GRAPH_INCOMPLETE", "0011 resource snapshot build가 성공하지 않았습니다.");
    requireJoin(!normalized.diagnostics.some((item) => item.severity === "error"),
      "C02_JOIN_GRAPH_INCOMPLETE", "0011 resource snapshot에 blocking 진단이 있습니다.");
    return normalized;
  } catch (error) {
    if (error?.code && JOIN_CODES.has(error.code)) throw error;
    fail("C02_JOIN_GRAPH_INCOMPLETE", `0011 resource snapshot이 유효하지 않습니다: ${error.message}`);
  }
}

function matchJavaScriptChunks(resourceSnapshot, moduleGraphSnapshot) {
  const moduleResources = moduleGraphSnapshot.outputGraph.resources;
  const resourceResources = resourceSnapshot.resources.filter((resource) => resource.kind === "javascript");
  const moduleById = uniqueMap(moduleResources, (resource) => resource.id, "C02_JOIN_JS_RESOURCE_MISMATCH", "0014 JavaScript resource ID");
  const resourceById = uniqueMap(resourceResources, (resource) => resource.id, "C02_JOIN_JS_RESOURCE_MISMATCH", "0011 JavaScript resource ID");
  requireJoin(moduleById.size === resourceById.size
    && [...moduleById.keys()].every((id) => resourceById.has(id)),
  "C02_JOIN_JS_RESOURCE_MISMATCH", "두 snapshot의 JavaScript resource ID 집합이 다릅니다.");
  for (const [id, moduleResource] of moduleById) {
    const resource = resourceById.get(id);
    for (const field of ["id", "outputPath", "kind", "mediaType", "bytes", "sha256"]) {
      requireJoin(moduleResource[field] === resource[field], "C02_JOIN_JS_RESOURCE_MISMATCH",
        `JavaScript resource ${id}의 ${field} 값이 다릅니다.`);
    }
  }

  const resourceChunkByJavaScriptId = new Map();
  const allResourcesById = uniqueMap(resourceSnapshot.resources,
    (resource) => resource.id, "C02_JOIN_GRAPH_INCOMPLETE", "resource ID");
  for (const chunk of resourceSnapshot.chunks) {
    for (const id of chunk.assetResourceIds) {
      const asset = allResourcesById.get(id);
      requireJoin(asset?.kind !== "other", "C02_JOIN_RESOURCE_KIND_UNSUPPORTED",
        `chunk가 지원하지 않는 other 자원을 참조합니다: ${id}`);
    }
  }
  for (const chunk of resourceSnapshot.chunks) {
    for (const id of chunk.javascriptResourceIds) {
      const owners = resourceChunkByJavaScriptId.get(id) ?? [];
      owners.push(chunk);
      resourceChunkByJavaScriptId.set(id, owners);
    }
  }
  const moduleChunkToResourceChunk = new Map();
  const moduleChunksById = uniqueMap(moduleGraphSnapshot.outputGraph.chunks,
    (chunk) => chunk.id, "C02_JOIN_JS_RESOURCE_MISMATCH", "0014 chunk ID");
  const moduleOwnersByResourceId = new Map();
  for (const chunk of moduleGraphSnapshot.outputGraph.chunks) {
    const owners = moduleOwnersByResourceId.get(chunk.javascriptResourceId) ?? [];
    owners.push(chunk);
    moduleOwnersByResourceId.set(chunk.javascriptResourceId, owners);
  }
  for (const resource of moduleResources) {
    const resourceOwners = resourceChunkByJavaScriptId.get(resource.id) ?? [];
    const moduleOwners = moduleOwnersByResourceId.get(resource.id) ?? [];
    requireJoin(resourceOwners.length === 1 && moduleOwners.length === 1,
      "C02_JOIN_JS_RESOURCE_MISMATCH", `JavaScript resource ${resource.id}는 양 snapshot에서 각각 한 chunk에만 속해야 합니다.`);
    moduleChunkToResourceChunk.set(moduleOwners[0].id, resourceOwners[0]);
  }
  requireJoin(resourceChunkByJavaScriptId.size === moduleById.size
    && moduleChunkToResourceChunk.size === moduleChunksById.size,
  "C02_JOIN_JS_RESOURCE_MISMATCH", "0011·0014 chunk와 JavaScript resource 연결이 일대일로 닫히지 않습니다.");
  return { moduleChunkToResourceChunk };
}

function validateExcludedDependencies(resourceSnapshot, moduleGraphSnapshot, moduleChunkToResourceChunk) {
  const stylesheetsBySourcePath = uniqueMap(resourceSnapshot.stylesheets,
    (stylesheet) => stylesheet.sourcePath, "C02_JOIN_GRAPH_INCOMPLETE", "stylesheet sourcePath");
  const sourceModulesByKey = uniqueMap(moduleGraphSnapshot.sourceGraph.modules,
    (module) => module.key, "C02_JOIN_GRAPH_INCOMPLETE", "source module key");
  const moduleChunksById = uniqueMap(moduleGraphSnapshot.outputGraph.chunks,
    (chunk) => chunk.id, "C02_JOIN_JS_RESOURCE_MISMATCH", "0014 chunk ID");

  for (const dependency of moduleGraphSnapshot.sourceGraph.excludedDependencies) {
    if (dependency.targetKind !== "stylesheet") continue;
    const sourceModule = sourceModulesByKey.get(dependency.referrerModuleKey);
    requireJoin(Boolean(sourceModule), "C02_JOIN_GRAPH_INCOMPLETE",
      `stylesheet dependency referrer source module이 없습니다: ${dependency.referrerModuleKey}`);
    // 소스 전용 또는 트리 셰이킹된 참조자는 런타임 소유권을 증명할 수 없으므로 입력 간선을 출처 정보로만 보존합니다.
    if (sourceModule.outputChunkIds.length === 0) continue;

    const stylesheet = stylesheetsBySourcePath.get(dependency.resolvedResourceKey);
    requireJoin(Boolean(stylesheet), "C02_JOIN_RESOURCE_MISSING",
      `emitted referrer의 stylesheet source row가 없습니다: ${dependency.resolvedResourceKey}`);
    // 소스 행은 입력이 관찰되었음을 증명하지만, 출력 집합이 비어 있으면 런타임 소유자는 없습니다.
    if (stylesheet.outputResourceIds.length === 0) continue;

    const attachedByReferrer = new Set();
    for (const chunkId of sourceModule.outputChunkIds) {
      const moduleChunk = moduleChunksById.get(chunkId);
      requireJoin(Boolean(moduleChunk), "C02_JOIN_JS_RESOURCE_MISMATCH",
        `stylesheet dependency referrer가 없는 output chunk를 가리킵니다: ${chunkId}`);
      const resourceChunk = moduleChunkToResourceChunk.get(moduleChunk.id);
      requireJoin(Boolean(resourceChunk), "C02_JOIN_JS_RESOURCE_MISMATCH",
        `stylesheet dependency referrer의 0011 chunk 대응이 없습니다: ${chunkId}`);
      for (const id of resourceChunk.stylesheetResourceIds) attachedByReferrer.add(id);
    }
    requireJoin(stylesheet.outputResourceIds.some((id) => attachedByReferrer.has(id)),
      "C02_JOIN_RESOURCE_MISSING",
      `활성 stylesheet dependency가 referrer JS chunk의 stylesheet ownership과 연결되지 않습니다: ${dependency.referrerModuleKey} -> ${dependency.resolvedResourceKey}`);
  }
  // 에셋 excludedDependencies는 입력 출처 정보입니다. 출력 런타임 도달성은 0011 청크 소유권으로만 확정합니다.
}

function collectRuntimeResources(resourceSnapshot, moduleGraphSnapshot) {
  const output = moduleGraphSnapshot.outputGraph.resources.map((resource) => cloneJsonData(resource, "JavaScript output resource"));
  for (const resource of resourceSnapshot.resources) {
    if (!RUNTIME_RESOURCE_KINDS.has(resource.kind) || resource.kind === "javascript") continue;
    output.push(cloneJsonData(resource, "CSS/media output resource"));
  }
  const ids = new Set();
  const paths = new Set();
  for (const resource of output) {
    requireJoin(!ids.has(resource.id), "C02_JOIN_JS_RESOURCE_MISMATCH", `runtime resource ID가 중복됩니다: ${resource.id}`);
    requireJoin(!paths.has(resource.outputPath), "C02_JOIN_JS_RESOURCE_MISMATCH", `runtime output 경로가 중복됩니다: ${resource.outputPath}`);
    ids.add(resource.id);
    paths.add(resource.outputPath);
  }
  const resourcesById = new Map(output.map((resource) => [resource.id, resource]));
  const stylesheetOwners = new Set(resourceSnapshot.stylesheets.flatMap((stylesheet) => stylesheet.outputResourceIds));
  for (const resource of output) {
    if (resource.kind === "stylesheet") {
      requireJoin(stylesheetOwners.has(resource.id), "C02_JOIN_GRAPH_INCOMPLETE",
        `source stylesheet provenance가 없는 CSS output resource입니다: ${resource.id}`);
    }
  }
  return output.sort((left, right) => compareStrings(left.id, right.id));
}

function createCssResourceEdges(resourceSnapshot, joinedResourcesById) {
  const stylesheetBySourcePath = uniqueMap(resourceSnapshot.stylesheets,
    (stylesheet) => stylesheet.sourcePath, "C02_JOIN_GRAPH_INCOMPLETE", "stylesheet sourcePath");
  const resourceById = uniqueMap(resourceSnapshot.resources,
    (resource) => resource.id, "C02_JOIN_GRAPH_INCOMPLETE", "resource ID");
  const edges = [];

  for (const stylesheet of resourceSnapshot.stylesheets) {
    const parentOutputIds = stylesheet.outputResourceIds;
    if (parentOutputIds.length === 0) continue;
    for (const id of parentOutputIds) {
      requireJoin(joinedResourcesById.get(id)?.kind === "stylesheet",
        "C02_JOIN_RESOURCE_MISSING", `활성 stylesheet의 출력 resource가 없습니다: ${id}`);
    }
    for (const edge of stylesheet.imports) {
      if (edge.classification === "local") {
        const targetStylesheet = stylesheetBySourcePath.get(edge.targetSourcePath);
        requireJoin(targetStylesheet, "C02_JOIN_RESOURCE_MISSING", `@import source stylesheet가 없습니다: ${edge.targetSourcePath}`);
        requireJoin(targetStylesheet.outputResourceIds.length > 0,
          "C02_JOIN_RESOURCE_MISSING", `활성 @import target에 출력 stylesheet가 없습니다: ${edge.targetSourcePath}`);
        requireJoin(parentOutputIds.length === 1 && targetStylesheet.outputResourceIds.length === 1,
          "C02_JOIN_TARGET_AMBIGUOUS", `@import source와 target의 출력 대응이 유일하지 않습니다: ${stylesheet.sourcePath} -> ${edge.targetSourcePath}`);
        const fromResourceId = parentOutputIds[0];
        const toResourceId = targetStylesheet.outputResourceIds[0];
        requireJoin(joinedResourcesById.get(toResourceId)?.kind === "stylesheet",
          "C02_JOIN_RESOURCE_KIND_UNSUPPORTED", `@import target은 stylesheet여야 합니다: ${toResourceId}`);
        if (fromResourceId !== toResourceId) {
          edges.push({
            fromResourceId,
            toResourceId,
            kind: "stylesheet-import",
            specifier: edge.specifier,
            conditions: edge.conditions ?? null,
            source: cloneJsonData(edge.source, "@import source location"),
          });
        }
      } else if (["external", "unresolved"].includes(edge.classification)) {
        fail("C02_JOIN_EXTERNAL_RESOURCE", `활성 stylesheet에 외부 또는 미해결 @import가 있습니다: ${edge.specifier}`);
      } else if (!["data", "fragment"].includes(edge.classification)) {
        fail("C02_JOIN_RESOURCE_MISSING", `활성 @import target을 정적 자원으로 확정할 수 없습니다: ${edge.specifier}`);
      }
    }

    for (const edge of stylesheet.references) {
      if (edge.classification === "local") {
        const target = resourceById.get(edge.targetResourceId);
        requireJoin(Boolean(target), "C02_JOIN_RESOURCE_MISSING", `활성 CSS URL의 출력 resource가 없습니다: ${edge.specifier}`);
        const sourcePathCandidates = resourceSnapshot.resources.filter((resource) => resource.sourcePath === edge.targetSourcePath);
        requireJoin(sourcePathCandidates.length > 0,
          "C02_JOIN_RESOURCE_MISSING", `CSS URL targetSourcePath에 해당하는 출력 resource가 없습니다: ${edge.targetSourcePath}`);
        requireJoin(sourcePathCandidates.length === 1,
          "C02_JOIN_TARGET_AMBIGUOUS", `CSS URL targetSourcePath가 여러 출력 resource에 대응합니다: ${edge.targetSourcePath}`);
        requireJoin(sourcePathCandidates[0].id === edge.targetResourceId,
          "C02_JOIN_RESOURCE_MISSING", `CSS URL targetResourceId가 targetSourcePath의 유일한 출력 resource와 다릅니다: ${edge.specifier}`);
        requireJoin(CSS_ASSET_KINDS.has(target.kind), "C02_JOIN_RESOURCE_KIND_UNSUPPORTED",
          `CSS URL target kind가 font/image가 아닙니다: ${edge.specifier}`);
        requireJoin(joinedResourcesById.has(target.id),
          "C02_JOIN_RESOURCE_MISSING", `활성 CSS URL의 출력 resource가 없습니다: ${edge.specifier}`);
        requireJoin(target.sourcePath === edge.targetSourcePath,
          "C02_JOIN_RESOURCE_MISSING", `CSS URL의 sourcePath와 출력 resource가 다릅니다: ${edge.specifier}`);
        requireJoin(CSS_ASSET_KINDS.has(edge.resourceKind)
          && target.kind === edge.resourceKind,
        "C02_JOIN_RESOURCE_KIND_UNSUPPORTED", `CSS URL target은 선언된 font/image 종류와 일치해야 합니다: ${edge.specifier}`);
        for (const fromResourceId of parentOutputIds) {
          edges.push({
            fromResourceId,
            toResourceId: target.id,
            kind: "asset-url",
            specifier: edge.specifier,
            conditions: null,
            source: cloneJsonData(edge.source, "CSS URL source location"),
          });
        }
      } else if (["external", "unresolved"].includes(edge.classification)) {
        fail("C02_JOIN_EXTERNAL_RESOURCE", `활성 stylesheet에 외부 또는 미해결 CSS URL이 있습니다: ${edge.specifier}`);
      } else if (!["data", "fragment"].includes(edge.classification)) {
        fail("C02_JOIN_RESOURCE_MISSING", `활성 CSS URL target을 정적 자원으로 확정할 수 없습니다: ${edge.specifier}`);
      }
    }
  }
  return edges;
}

function buildFeatureClosures(features, chunks, resources, resourceEdges) {
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const resourceEdgesBySource = groupBy(resourceEdges, (edge) => edge.fromResourceId);
  const output = features.map((feature) => {
    const chunkIds = new Set();
    const pendingChunks = [feature.entryChunkId];
    while (pendingChunks.length > 0) {
      const chunkId = pendingChunks.pop();
      if (chunkIds.has(chunkId)) continue;
      const chunk = chunksById.get(chunkId);
      requireJoin(Boolean(chunk), "C02_JOIN_RESOURCE_MISSING", `feature entry graph의 chunk가 없습니다: ${chunkId}`);
      chunkIds.add(chunkId);
      for (const edge of chunk.dependencies) if (edge.chunkId !== null) pendingChunks.push(edge.chunkId);
    }
    const resourceIds = new Set();
    const pendingResources = [];
    for (const chunkId of chunkIds) {
      const chunk = chunksById.get(chunkId);
      pendingResources.push(chunk.javascriptResourceId, ...chunk.stylesheetResourceIds, ...chunk.assetResourceIds);
    }
    while (pendingResources.length > 0) {
      const resourceId = pendingResources.pop();
      if (resourceIds.has(resourceId)) continue;
      resourceIds.add(resourceId);
      for (const edge of resourceEdgesBySource.get(resourceId) ?? []) pendingResources.push(edge.toResourceId);
    }
    return {
      ...cloneJsonData(feature, `feature ${feature.id}`),
      chunkIds: [...chunkIds].sort(compareStrings),
      resourceIds: [...resourceIds].sort(compareStrings),
    };
  }).sort((left, right) => compareStrings(left.id, right.id));
  const allChunkIds = new Set(output.flatMap((feature) => feature.chunkIds));
  const allResourceIds = new Set(output.flatMap((feature) => feature.resourceIds));
  requireJoin(chunks.every((chunk) => allChunkIds.has(chunk.id)),
    "C02_JOIN_ORPHAN_RESOURCE", "feature entry에서 도달할 수 없는 JS chunk가 있습니다.");
  requireJoin(resources.every((resource) => allResourceIds.has(resource.id)),
    "C02_JOIN_ORPHAN_RESOURCE", "feature entry에서 도달할 수 없는 runtime resource가 있습니다.");
  return output;
}

function validateJoinedBuild(build) {
  requireOnlyKeys(build, ["captureId", "tool", "toolVersion", "mode", "fixtureSha256", "profile", "buildProfileSha256"], "build");
  requireJoin(typeof build.captureId === "string" && BUILD_ID_PATTERN.test(build.captureId)
    && ["vite", "rspack"].includes(build.tool)
    && typeof build.toolVersion === "string" && build.toolVersion.length > 0
    && build.mode === "production"
    && SHA256_PATTERN.test(build.fixtureSha256 ?? "")
    && SHA256_PATTERN.test(build.buildProfileSha256 ?? ""),
  "C02_JOIN_BUILD_MISMATCH", "joined build metadata가 올바르지 않습니다.");
  let digest;
  try {
    digest = computeBuildProfileSha256(build.profile);
  } catch (error) {
    fail("C02_JOIN_BUILD_MISMATCH", `joined build profile을 검증할 수 없습니다: ${error.message}`);
  }
  requireJoin(digest === build.buildProfileSha256, "C02_JOIN_BUILD_MISMATCH", "joined build profile digest가 일치하지 않습니다.");
}

function validateProvenance(provenance) {
  requireOnlyKeys(provenance, ["excludedDependencies", "stylesheets"], "provenance");
  requireJoin(Array.isArray(provenance?.excludedDependencies) && Array.isArray(provenance?.stylesheets),
    "C02_JOIN_GRAPH_INCOMPLETE", "provenance source arrays가 필요합니다.");
  const paths = new Set();
  for (const stylesheet of provenance.stylesheets) {
    requireOnlyKeys(stylesheet, ["id", "sourcePath", "imports", "references"], "stylesheet provenance");
    requireJoin(typeof stylesheet.id === "string" && typeof stylesheet.sourcePath === "string"
      && Array.isArray(stylesheet.imports) && Array.isArray(stylesheet.references),
    "C02_JOIN_GRAPH_INCOMPLETE", "stylesheet provenance record가 올바르지 않습니다.");
    requireRelativePath(stylesheet.sourcePath, "stylesheet provenance sourcePath");
    requireJoin(!paths.has(stylesheet.sourcePath), "C02_JOIN_GRAPH_INCOMPLETE", `중복 stylesheet provenance sourcePath: ${stylesheet.sourcePath}`);
    paths.add(stylesheet.sourcePath);
    for (const edge of stylesheet.imports) validateCssProvenanceEdge(edge, stylesheet.sourcePath, "import");
    for (const edge of stylesheet.references) validateCssProvenanceEdge(edge, stylesheet.sourcePath, "reference");
  }
  for (const dependency of provenance.excludedDependencies) {
    requireOnlyKeys(dependency, [
      "referrerModuleKey", "kind", "sourceSpecifier", "targetKind", "resolvedResourceKey", "source",
    ], "excluded dependency provenance");
    requireJoin(typeof dependency.referrerModuleKey === "string" && dependency.referrerModuleKey.length > 0
      && ["static", "dynamic"].includes(dependency.kind)
      && typeof dependency.sourceSpecifier === "string" && dependency.sourceSpecifier.length > 0
      && ["stylesheet", "asset"].includes(dependency.targetKind)
      && typeof dependency.resolvedResourceKey === "string" && dependency.resolvedResourceKey.length > 0,
    "C02_JOIN_GRAPH_INCOMPLETE", "excluded dependency provenance record가 올바르지 않습니다.");
    requireRelativePath(dependency.referrerModuleKey, "excluded dependency referrerModuleKey");
    requireRelativePath(dependency.resolvedResourceKey, "excluded dependency resolvedResourceKey");
    validateOptionalSourceLocation(dependency.source, "excluded dependency source");
  }
}

function validateCssProvenanceEdge(edge, stylesheetPath, kind) {
  requireJoin(edge && typeof edge === "object" && !Array.isArray(edge),
    "C02_JOIN_GRAPH_INCOMPLETE", `stylesheet ${kind} provenance object가 필요합니다: ${stylesheetPath}`);
  requireJoin(["local", "external", "data", "fragment", "unresolved", "dynamic"].includes(edge.classification)
    && (typeof edge.specifier === "string" || edge.specifier === null)
    && (typeof edge.targetSourcePath === "string" || edge.targetSourcePath === null),
  "C02_JOIN_GRAPH_INCOMPLETE", `stylesheet ${kind} provenance 필드가 올바르지 않습니다: ${stylesheetPath}`);
  requireJoin(edge.classification === "local" ? typeof edge.targetSourcePath === "string" : edge.targetSourcePath === null,
    "C02_JOIN_GRAPH_INCOMPLETE", `stylesheet ${kind} provenance targetSourcePath가 classification과 맞지 않습니다: ${stylesheetPath}`);
  if (edge.targetSourcePath !== null) requireRelativePath(edge.targetSourcePath, `stylesheet ${kind} targetSourcePath`);
  if (kind === "import") {
    requireJoin(edge.targetResourceId === undefined || edge.targetResourceId === null,
      "C02_JOIN_GRAPH_INCOMPLETE", `@import provenance에 output resource ID가 있습니다: ${stylesheetPath}`);
    requireJoin(edge.conditions === null || typeof edge.conditions === "string",
      "C02_JOIN_GRAPH_INCOMPLETE", `@import conditions가 올바르지 않습니다: ${stylesheetPath}`);
  } else {
    requireJoin(typeof edge.property === "string" && edge.property.length > 0
      && ["font", "image", "other"].includes(edge.resourceKind),
    "C02_JOIN_GRAPH_INCOMPLETE", `CSS URL provenance property/resourceKind가 올바르지 않습니다: ${stylesheetPath}`);
    requireJoin(edge.classification !== "local" || (typeof edge.targetResourceId === "string" && edge.targetResourceId.length > 0),
      "C02_JOIN_GRAPH_INCOMPLETE", `local CSS URL provenance에 targetResourceId가 없습니다: ${stylesheetPath}`);
    requireJoin(edge.targetResourceId === undefined || edge.targetResourceId === null || edge.classification === "local",
      "C02_JOIN_GRAPH_INCOMPLETE", `non-local CSS URL provenance에 targetResourceId가 있습니다: ${stylesheetPath}`);
  }
  validateOptionalSourceLocation(edge.source, `stylesheet ${kind} source`);
  requireJoin(edge.source?.file === stylesheetPath,
    "C02_JOIN_GRAPH_INCOMPLETE", `stylesheet ${kind} source file가 stylesheet와 다릅니다: ${stylesheetPath}`);
}

function validateOptionalSourceLocation(source, name) {
  requireJoin(source === null || (source && typeof source === "object" && !Array.isArray(source)),
    "C02_JOIN_GRAPH_INCOMPLETE", `${name} source 위치가 올바르지 않습니다.`);
  if (source === null) return;
  requireOnlyKeys(source, ["file", "line", "column"], name);
  requireRelativePath(source.file, `${name}.file`);
  requireJoin(Number.isSafeInteger(source.line) && source.line > 0
    && Number.isSafeInteger(source.column) && source.column > 0,
  "C02_JOIN_GRAPH_INCOMPLETE", `${name} line/column이 올바르지 않습니다.`);
}

function validateJoinedResources(resources) {
  const byId = new Map();
  const outputPaths = new Set();
  for (const resource of resources) {
    requireJoin(resource && typeof resource === "object", "C02_JOIN_GRAPH_INCOMPLETE", "runtime resource object가 필요합니다.");
    requireJoin(RUNTIME_RESOURCE_KINDS.has(resource.kind), "C02_JOIN_RESOURCE_KIND_UNSUPPORTED", `지원하지 않는 runtime resource kind입니다: ${resource.kind}`);
    requireOnlyKeys(resource, resource.kind === "javascript"
      ? ["id", "logicalId", "identityStatus", "kind", "outputPath", "mediaType", "bytes", "sha256"]
      : ["id", "kind", "outputPath", "mediaType", "bytes", "sha256", "sourcePath"], "runtime resource");
    requireJoin(typeof resource.id === "string" && resource.id.length > 0
      && typeof resource.outputPath === "string" && typeof resource.mediaType === "string"
      && Number.isSafeInteger(resource.bytes) && resource.bytes >= 0
      && SHA256_PATTERN.test(resource.sha256 ?? ""),
    "C02_JOIN_GRAPH_INCOMPLETE", "runtime resource 필드가 올바르지 않습니다.");
    requireRelativePath(resource.outputPath, "runtime resource.outputPath");
    requireJoin(resource.mediaType.includes("/"), "C02_JOIN_GRAPH_INCOMPLETE", `resource MIME이 올바르지 않습니다: ${resource.id}`);
    requireJoin(!byId.has(resource.id), "C02_JOIN_JS_RESOURCE_MISMATCH", `중복 runtime resource ID: ${resource.id}`);
    requireJoin(!outputPaths.has(resource.outputPath), "C02_JOIN_GRAPH_INCOMPLETE", `중복 runtime output path: ${resource.outputPath}`);
    if (resource.kind === "javascript") {
      requireJoin(["stable", "unproven"].includes(resource.identityStatus)
        && (resource.identityStatus === "stable"
          ? typeof resource.logicalId === "string" && resource.logicalId.length > 0
          : resource.logicalId === null),
      "C02_JOIN_GRAPH_INCOMPLETE", `JavaScript resource identity 상태가 올바르지 않습니다: ${resource.id}`);
    } else {
      requireJoin(resource.sourcePath === null || typeof resource.sourcePath === "string",
        "C02_JOIN_GRAPH_INCOMPLETE", `resource.sourcePath가 올바르지 않습니다: ${resource.id}`);
      if (resource.sourcePath !== null) requireRelativePath(resource.sourcePath, "runtime resource.sourcePath");
    }
    byId.set(resource.id, resource);
    outputPaths.add(resource.outputPath);
  }
  return byId;
}

function validateJoinedChunks(chunks, resourcesById) {
  const byId = new Map();
  for (const chunk of chunks) {
    requireOnlyKeys(chunk, [
      "id", "logicalId", "identityStatus", "kind", "moduleFormat", "javascriptResourceId",
      "sourceModuleKeys", "dependencies", "stylesheetResourceIds", "assetResourceIds",
    ], "joined chunk");
    requireJoin(typeof chunk.id === "string" && chunk.id.length > 0 && !byId.has(chunk.id),
      "C02_JOIN_GRAPH_INCOMPLETE", `중복이거나 비어 있는 joined chunk ID: ${chunk.id}`);
    requireJoin(["entry", "static", "dynamic", "shared"].includes(chunk.kind)
      && (typeof chunk.logicalId === "string" || chunk.logicalId === null),
    "C02_JOIN_GRAPH_INCOMPLETE", `joined chunk identity 또는 kind가 올바르지 않습니다: ${chunk.id}`);
    requireJoin(["stable", "unproven"].includes(chunk.identityStatus)
      && (chunk.identityStatus === "stable"
        ? typeof chunk.logicalId === "string" && chunk.logicalId.length > 0
        : chunk.logicalId === null)
      && chunk.moduleFormat === "esm",
    "C02_JOIN_GRAPH_INCOMPLETE", `joined chunk identity 상태 또는 module format이 올바르지 않습니다: ${chunk.id}`);
    requireJoin(Array.isArray(chunk.dependencies) && Array.isArray(chunk.sourceModuleKeys)
      && Array.isArray(chunk.stylesheetResourceIds) && Array.isArray(chunk.assetResourceIds),
    "C02_JOIN_GRAPH_INCOMPLETE", `joined chunk 관계 배열이 없습니다: ${chunk.id}`);
    for (const field of ["sourceModuleKeys", "stylesheetResourceIds", "assetResourceIds"]) {
      requireJoin(chunk[field].every((item) => typeof item === "string" && item.length > 0)
        && new Set(chunk[field]).size === chunk[field].length,
      "C02_JOIN_GRAPH_INCOMPLETE", `joined chunk ${field}가 유효하지 않거나 중복됩니다: ${chunk.id}`);
    }
    for (const sourceModuleKey of chunk.sourceModuleKeys) requireRelativePath(sourceModuleKey, "chunk.sourceModuleKeys item");
    const js = resourcesById.get(chunk.javascriptResourceId);
    requireJoin(js?.kind === "javascript", "C02_JOIN_RESOURCE_MISSING", `chunk JavaScript resource가 없습니다: ${chunk.id}`);
    for (const id of chunk.stylesheetResourceIds) {
      requireJoin(resourcesById.get(id)?.kind === "stylesheet", "C02_JOIN_RESOURCE_MISSING", `chunk stylesheet resource가 없습니다: ${id}`);
    }
    for (const id of chunk.assetResourceIds) {
      const asset = resourcesById.get(id);
      requireJoin(Boolean(asset), "C02_JOIN_RESOURCE_MISSING", `chunk asset resource가 없습니다: ${id}`);
      requireJoin(CSS_ASSET_KINDS.has(asset.kind), "C02_JOIN_RESOURCE_KIND_UNSUPPORTED", `chunk asset kind는 font/image여야 합니다: ${id}`);
    }
    byId.set(chunk.id, chunk);
  }
  for (const chunk of chunks) {
    for (const dependency of chunk.dependencies) {
      requireOnlyKeys(dependency, ["kind", "specifier", "chunkId"], "chunk dependency");
      requireJoin(["static", "dynamic"].includes(dependency.kind)
        && typeof dependency.specifier === "string" && dependency.specifier.length > 0,
      "C02_JOIN_GRAPH_INCOMPLETE", `chunk dependency가 올바르지 않습니다: ${chunk.id}`);
      requireJoin(typeof dependency.chunkId === "string" && byId.has(dependency.chunkId),
        "C02_JOIN_RESOURCE_MISSING", `chunk dependency target가 없습니다: ${dependency.chunkId}`);
    }
  }
  return byId;
}

function validateResourceEdges(edges, resourcesById) {
  for (const edge of edges) {
    requireOnlyKeys(edge, ["fromResourceId", "toResourceId", "kind", "specifier", "conditions", "source"], "resource edge");
    const from = resourcesById.get(edge.fromResourceId);
    const to = resourcesById.get(edge.toResourceId);
    requireJoin(from?.kind === "stylesheet" && Boolean(to),
      "C02_JOIN_RESOURCE_MISSING", `CSS resource edge의 source/target가 없습니다: ${edge.fromResourceId} -> ${edge.toResourceId}`);
    if (edge.kind === "stylesheet-import") {
      requireJoin(to.kind === "stylesheet", "C02_JOIN_RESOURCE_KIND_UNSUPPORTED", "stylesheet-import target은 stylesheet여야 합니다.");
    } else if (edge.kind === "asset-url") {
      requireJoin(CSS_ASSET_KINDS.has(to.kind), "C02_JOIN_RESOURCE_KIND_UNSUPPORTED", "asset-url target은 font 또는 image여야 합니다.");
    } else {
      fail("C02_JOIN_GRAPH_INCOMPLETE", `알 수 없는 resource edge kind입니다: ${edge.kind}`);
    }
    requireJoin(typeof edge.specifier === "string" && edge.specifier.length > 0
      && (edge.conditions === null || typeof edge.conditions === "string")
      && edge.source && typeof edge.source.file === "string"
      && Number.isSafeInteger(edge.source.line) && edge.source.line > 0
      && Number.isSafeInteger(edge.source.column) && edge.source.column > 0,
    "C02_JOIN_GRAPH_INCOMPLETE", "resource edge의 원본 위치·specifier가 올바르지 않습니다.");
    requireOnlyKeys(edge.source, ["file", "line", "column"], "resource edge source");
    requireRelativePath(edge.source.file, "resource edge source.file");
  }
}

function validateJoinedFeatures(features, chunksById, resourcesById, resourceEdges) {
  const ids = new Set();
  for (const feature of features) {
    requireOnlyKeys(feature, ["id", "entrySourceKey", "entryChunkId", "chunkIds", "resourceIds"], "joined feature");
    requireJoin(typeof feature.id === "string" && feature.id.length > 0 && !ids.has(feature.id),
      "C02_JOIN_GRAPH_INCOMPLETE", `중복이거나 비어 있는 feature ID: ${feature.id}`);
    ids.add(feature.id);
    requireJoin(typeof feature.entrySourceKey === "string" && feature.entrySourceKey.length > 0,
      "C02_JOIN_GRAPH_INCOMPLETE", `feature entrySourceKey가 올바르지 않습니다: ${feature.id}`);
    requireRelativePath(feature.entrySourceKey, "feature.entrySourceKey");
    requireJoin(chunksById.has(feature.entryChunkId), "C02_JOIN_RESOURCE_MISSING", `feature entry chunk가 없습니다: ${feature.entryChunkId}`);
    const entryChunk = chunksById.get(feature.entryChunkId);
    requireJoin(["entry", "dynamic"].includes(entryChunk.kind)
      && entryChunk.sourceModuleKeys.includes(feature.entrySourceKey),
    "C02_JOIN_GRAPH_INCOMPLETE", `feature entry source와 chunk 대응이 올바르지 않습니다: ${feature.id}`);
    requireJoin(Array.isArray(feature.chunkIds) && Array.isArray(feature.resourceIds),
      "C02_JOIN_GRAPH_INCOMPLETE", `feature closure 배열이 없습니다: ${feature.id}`);
    requireJoin(new Set(feature.chunkIds).size === feature.chunkIds.length
      && new Set(feature.resourceIds).size === feature.resourceIds.length,
    "C02_JOIN_GRAPH_INCOMPLETE", `feature closure에 중복 ID가 있습니다: ${feature.id}`);
    for (const chunkId of feature.chunkIds) requireJoin(chunksById.has(chunkId), "C02_JOIN_RESOURCE_MISSING", `feature chunk가 없습니다: ${chunkId}`);
    for (const resourceId of feature.resourceIds) requireJoin(resourcesById.has(resourceId), "C02_JOIN_RESOURCE_MISSING", `feature resource가 없습니다: ${resourceId}`);
  }
  const expected = buildFeatureClosures(features.map(({ id, entrySourceKey, entryChunkId }) => ({ id, entrySourceKey, entryChunkId })),
    [...chunksById.values()], [...resourcesById.values()], resourceEdges);
  for (let index = 0; index < expected.length; index += 1) {
    const actual = features.find((feature) => feature.id === expected[index].id);
    requireJoin(canonicalJson(actual.chunkIds) === canonicalJson(expected[index].chunkIds)
      && canonicalJson(actual.resourceIds) === canonicalJson(expected[index].resourceIds),
    "C02_JOIN_GRAPH_INCOMPLETE", `feature reachability closure가 계산값과 다릅니다: ${actual.id}`);
  }
}

function uniqueMap(items, keyOf, code, label) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    requireJoin(typeof key === "string" && key.length > 0 && !map.has(key), code, `중복이거나 비어 있는 ${label}: ${key}`);
    map.set(key, item);
  }
  return map;
}

function groupBy(items, keyOf) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }
  return grouped;
}

function compareResourceEdges(left, right) {
  const leftKey = canonicalJson([left.fromResourceId, left.kind, left.specifier, left.toResourceId, left.source]);
  const rightKey = canonicalJson([right.fromResourceId, right.kind, right.specifier, right.toResourceId, right.source]);
  return compareStrings(leftKey, rightKey);
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

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneJsonData(value, name, ancestors = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    requireJoin(Number.isFinite(value), "C02_JOIN_GRAPH_INCOMPLETE", `${name}에 유한하지 않은 숫자가 있습니다.`);
    return value;
  }
  requireJoin(typeof value === "object", "C02_JOIN_GRAPH_INCOMPLETE", `${name}은 JSON data tree여야 합니다.`);
  requireJoin(!ancestors.has(value), "C02_JOIN_GRAPH_INCOMPLETE", `${name}에 순환 참조가 있습니다.`);
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  requireJoin(isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
    "C02_JOIN_GRAPH_INCOMPLETE", `${name}에 일반 JSON object가 아닌 값이 있습니다.`);
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  const output = isArray ? [] : {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (isArray && key === "length") {
      requireJoin(descriptor && !descriptor.enumerable && Object.hasOwn(descriptor, "value"),
        "C02_JOIN_GRAPH_INCOMPLETE", `${name} 배열 length가 일반 data field가 아닙니다.`);
      continue;
    }
    requireJoin(typeof key === "string" && descriptor?.enumerable && Object.hasOwn(descriptor, "value"),
      "C02_JOIN_GRAPH_INCOMPLETE", `${name}에 symbol, accessor 또는 숨은 field가 있습니다.`);
    if (isArray) requireJoin(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length,
      "C02_JOIN_GRAPH_INCOMPLETE", `${name} 배열에 빈 항목 또는 추가 속성이 있습니다.`);
    const cloned = cloneJsonData(descriptor.value, `${name}.${key}`, ancestors);
    if (isArray) output[Number(key)] = cloned;
    else Object.defineProperty(output, key, {
      value: cloned,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (isArray) requireJoin(keys.length === value.length + 1,
    "C02_JOIN_GRAPH_INCOMPLETE", `${name} 배열에 빈 항목이 있습니다.`);
  ancestors.delete(value);
  return output;
}

function requireOnlyKeys(value, allowed, name) {
  requireJoin(value && typeof value === "object" && !Array.isArray(value),
    "C02_JOIN_GRAPH_INCOMPLETE", `${name} object가 필요합니다.`);
  const allowedSet = new Set(allowed);
  requireJoin(Object.keys(value).every((key) => allowedSet.has(key)),
    "C02_JOIN_GRAPH_INCOMPLETE", `${name}에 계약 밖 field가 있습니다.`);
  requireJoin(allowed.every((key) => Object.hasOwn(value, key)),
    "C02_JOIN_GRAPH_INCOMPLETE", `${name} 필드가 누락되었습니다.`);
}

function requireRelativePath(value, name) {
  const segments = typeof value === "string" ? value.split("/") : [];
  requireJoin(typeof value === "string" && value.length > 0
    && !value.startsWith("/") && !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value)
    && !/(^|\/)[A-Za-z]:/i.test(value)
    && segments.every((part) => part.length > 0 && part !== ".." && part !== "."),
  "C02_JOIN_GRAPH_INCOMPLETE", `${name}는 정규화된 상대 POSIX 경로여야 합니다: ${value}`);
}

function requireJoin(condition, code, message) {
  if (!condition) fail(code, message);
}

function fail(code, message) {
  const validCode = JOIN_CODES.has(code) ? code : "C02_JOIN_GRAPH_INCOMPLETE";
  const error = new Error(message);
  error.code = validCode;
  error.diagnostic = {
    severity: "error",
    code: validCode,
    stage: "resource-join",
    message,
    source: null,
    referrerModuleKey: null,
    specifier: null,
  };
  error.diagnostics = [error.diagnostic];
  throw error;
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
