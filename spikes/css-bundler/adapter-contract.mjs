export const CSS_RESOURCE_CONTRACT = {
  name: "spinon.css-resource-adapter",
  version: "0.1.0-draft",
};
export const CSS_RESOURCE_ADAPTER_VERSION = "0.1.0-spike";

const classifications = new Set(["local", "external", "data", "fragment", "unresolved", "dynamic"]);
const resourceKinds = new Set(["stylesheet", "javascript", "font", "image", "html", "source-map", "other"]);
const chunkKinds = new Set(["entry", "dynamic", "shared"]);
const diagnosticSeverities = new Set(["error", "warning", "info"]);

export function createAdapterSnapshot(snapshot) {
  requireValue(snapshot && typeof snapshot === "object", "snapshot 객체가 필요합니다.");
  const input = { ...snapshot, contract: snapshot.contract ?? CSS_RESOURCE_CONTRACT };
  assertAdapterSnapshot(input);
  const normalized = {
    ...input,
    resources: sorted(input.resources, (item) => item.outputPath),
    chunks: sorted(input.chunks, (item) => item.id).map((item) => ({
      ...item,
      javascriptResourceIds: sortedStrings(item.javascriptResourceIds),
      stylesheetResourceIds: sortedStrings(item.stylesheetResourceIds),
      assetResourceIds: sortedStrings(item.assetResourceIds),
    })),
    stylesheets: sorted(input.stylesheets, (item) => item.sourcePath).map((item) => ({
      ...item,
      outputResourceIds: sortedStrings(item.outputResourceIds),
      imports: sorted(item.imports, (edge) => `${edge.source.line}:${edge.source.column}:${edge.specifier ?? ""}`),
      references: sorted(item.references, (edge) => `${edge.source.line}:${edge.source.column}:${edge.specifier ?? ""}`),
    })),
    cssModules: sorted(input.cssModules, (item) => item.sourcePath).map((item) => ({
      ...item,
      exports: sortedStrings(item.exports),
    })),
    diagnostics: sorted(input.diagnostics, (item) => `${item.source.file}:${item.source.line}:${item.source.column}:${item.code}`),
  };
  assertAdapterSnapshot(normalized);
  return normalized;
}

export function assertAdapterSnapshot(snapshot) {
  requireValue(snapshot && typeof snapshot === "object", "snapshot 객체가 필요합니다.");
  requireSnapshotArrays(snapshot);
  requireValue(snapshot?.contract?.name === CSS_RESOURCE_CONTRACT.name, "contract.name이 올바르지 않습니다.");
  requireValue(snapshot?.contract?.version === CSS_RESOURCE_CONTRACT.version, "contract.version이 올바르지 않습니다.");
  requireValue(typeof snapshot?.build === "object" && snapshot.build !== null, "build 객체가 필요합니다.");
  requireValue(typeof snapshot?.build?.tool === "string" && snapshot.build.tool.length > 0, "build.tool이 비었습니다.");
  requireValue(typeof snapshot?.build?.toolVersion === "string" && snapshot.build.toolVersion.length > 0, "build.toolVersion이 비었습니다.");
  requireValue(typeof snapshot?.build?.adapterVersion === "string" && snapshot.build.adapterVersion.length > 0, "build.adapterVersion이 비었습니다.");
  requireValue(typeof snapshot?.build?.mode === "string" && snapshot.build.mode.length > 0, "build.mode가 비었습니다.");
  requireValue(["success", "failed"].includes(snapshot?.build?.status), "build.status가 올바르지 않습니다.");
  requireValue(/^[a-f0-9]{64}$/.test(snapshot?.build?.fixtureSha256 ?? ""), "build.fixtureSha256은 SHA-256이어야 합니다.");
  const hasJoinProfile = snapshot.build.profile !== undefined || snapshot.build.buildProfileSha256 !== undefined;
  if (hasJoinProfile) {
    requireValue(typeof snapshot.build.captureId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.build.captureId), "결합 profile의 build.captureId는 UUID여야 합니다.");
    requireValue(snapshot.build.profile && typeof snapshot.build.profile === "object" && !Array.isArray(snapshot.build.profile), "build.profile 객체가 필요합니다.");
    requireValue(/^[a-f0-9]{64}$/.test(snapshot.build.buildProfileSha256 ?? ""), "build.buildProfileSha256은 SHA-256이어야 합니다.");
  } else {
    requireValue(snapshot.build.captureId === undefined, "build.captureId를 쓰려면 build.profile과 buildProfileSha256가 필요합니다.");
  }
  for (const diagnostic of snapshot.diagnostics) {
    requireValue(diagnostic && typeof diagnostic === "object", "diagnostic 객체가 필요합니다.");
    requireValue(diagnosticSeverities.has(diagnostic.severity), `잘못된 진단 severity: ${diagnostic.severity}`);
    requireValue(typeof diagnostic.code === "string" && diagnostic.code.length > 0, "진단 코드가 비었습니다.");
    requireSourceLocation(diagnostic.source, diagnostic.source?.file);
  }

  const resourcesById = new Map();
  const resourcePaths = new Set();
  for (const resource of snapshot.resources ?? []) {
    requireValue(typeof resource?.id === "string" && resource.id.length > 0, "resource.id가 비었습니다.");
    requireValue(!resourcesById.has(resource.id), `중복 resource id: ${resource.id}`);
    requireValue(typeof resource.outputPath === "string", `resource.outputPath가 비었습니다: ${resource.id}`);
    requireValue(!resourcePaths.has(resource.outputPath), `중복 resource outputPath: ${resource.outputPath}`);
    requireValue(resourceKinds.has(resource.kind), `알 수 없는 resource kind: ${resource.kind}`);
    requireRelativePath(resource.outputPath, "resource.outputPath");
    requireValue(typeof resource.mediaType === "string" && resource.mediaType.includes("/"), `잘못된 MIME: ${resource.outputPath}`);
    requireValue(Number.isInteger(resource.bytes) && resource.bytes >= 0, `잘못된 byte 수: ${resource.outputPath}`);
    requireSha256(resource.sha256, `resource.sha256: ${resource.outputPath}`);
    requireValue(resource.sourcePath === null || typeof resource.sourcePath === "string", `잘못된 resource.sourcePath: ${resource.outputPath}`);
    if (resource.sourcePath !== null) requireRelativePath(resource.sourcePath, "resource.sourcePath");
    resourcesById.set(resource.id, resource);
    resourcePaths.add(resource.outputPath);
  }

  const chunksById = new Set();
  const chunkStylesheetIds = new Set();
  for (const chunk of snapshot.chunks ?? []) {
    requireValue(typeof chunk?.id === "string" && chunk.id.length > 0, "chunk.id가 비었습니다.");
    requireValue(!chunksById.has(chunk.id), `중복 chunk id: ${chunk.id}`);
    chunksById.add(chunk.id);
    requireValue(chunkKinds.has(chunk.kind), `알 수 없는 chunk kind: ${chunk.kind}`);
    for (const field of ["javascriptResourceIds", "stylesheetResourceIds", "assetResourceIds"]) {
      requireStringArray(chunk[field], `chunk.${field}: ${chunk.id}`);
      requireUnique(chunk[field], `중복 chunk.${field}: ${chunk.id}`);
    }
    for (const id of chunk.javascriptResourceIds ?? []) requireResourceKind(resourcesById, id, "javascript");
    for (const id of chunk.stylesheetResourceIds ?? []) {
      requireResourceKind(resourcesById, id, "stylesheet");
      chunkStylesheetIds.add(id);
    }
    for (const id of chunk.assetResourceIds ?? []) {
      const resource = requireResource(resourcesById, id);
      requireValue(["font", "image", "other"].includes(resource.kind), `chunk asset 종류가 잘못되었습니다: ${id}`);
    }
  }

  const stylesheetPaths = new Set();
  const stylesheetIds = new Set();
  for (const stylesheet of snapshot.stylesheets ?? []) {
    requireValue(typeof stylesheet?.id === "string" && stylesheet.id.length > 0, "stylesheet.id가 비었습니다.");
    requireValue(!stylesheetIds.has(stylesheet.id), `중복 stylesheet id: ${stylesheet.id}`);
    stylesheetIds.add(stylesheet.id);
    requireValue(!stylesheetPaths.has(stylesheet.sourcePath), `중복 stylesheet sourcePath: ${stylesheet.sourcePath}`);
    stylesheetPaths.add(stylesheet.sourcePath);
    requireRelativePath(stylesheet.sourcePath, "stylesheet.sourcePath");
    requireSha256(stylesheet.sourceSha256, `stylesheet.sourceSha256: ${stylesheet.sourcePath}`);
    requireStringArray(stylesheet.outputResourceIds, `stylesheet.outputResourceIds: ${stylesheet.sourcePath}`);
    requireUnique(stylesheet.outputResourceIds, `중복 stylesheet.outputResourceIds: ${stylesheet.sourcePath}`);
    requireValue(Array.isArray(stylesheet.imports), `stylesheet.imports 배열이 없습니다: ${stylesheet.sourcePath}`);
    requireValue(Array.isArray(stylesheet.references), `stylesheet.references 배열이 없습니다: ${stylesheet.sourcePath}`);
    for (const id of stylesheet.outputResourceIds ?? []) {
      requireResourceKind(resourcesById, id, "stylesheet");
      requireValue(chunkStylesheetIds.has(id), `원본 stylesheet와 연결된 출력이 chunk에 없습니다: ${id}`);
    }
    for (const [edgeKind, edges] of [["import", stylesheet.imports], ["reference", stylesheet.references]]) {
      for (const edge of edges) {
        requireValue(edge && typeof edge === "object", "CSS edge 객체가 필요합니다.");
        requireValue(classifications.has(edge.classification), `잘못된 참조 분류: ${edge.classification}`);
        requireValue(typeof edge.specifier === "string" || edge.specifier === null, "참조 specifier가 잘못되었습니다.");
        requireSourceLocation(edge.source, stylesheet.sourcePath);
        requireValue(edge.targetSourcePath === null || typeof edge.targetSourcePath === "string", "참조 targetSourcePath가 잘못되었습니다.");
        if (edge.targetSourcePath !== null) requireRelativePath(edge.targetSourcePath, "reference.targetSourcePath");
        if (edge.classification === "local") {
          requireValue(edge.targetSourcePath !== null, `로컬 참조의 입력 경로가 없습니다: ${edge.specifier}`);
        } else {
          requireValue(edge.targetSourcePath === null, `로컬이 아닌 참조에 입력 경로가 있습니다: ${edge.specifier}`);
        }
        if (edgeKind === "reference" && snapshot.build.status === "success" && edge.classification === "local") {
          requireValue(typeof edge.targetResourceId === "string" && edge.targetResourceId.length > 0, `로컬 자원의 출력 ID가 없습니다: ${edge.specifier}`);
        }
        if (edgeKind === "import") {
          requireValue(edge.targetResourceId === undefined || edge.targetResourceId === null, `@import edge에는 output resource ID를 둘 수 없습니다: ${edge.specifier}`);
        }
        if (edge.targetResourceId !== undefined && edge.targetResourceId !== null) {
          requireValue(edge.classification === "local", `로컬이 아닌 참조에 targetResourceId가 있습니다: ${edge.specifier}`);
          const targetResource = requireResource(resourcesById, edge.targetResourceId);
          if (edge.targetSourcePath !== null) {
            requireValue(targetResource.sourcePath === edge.targetSourcePath, `입력 자원과 출력 resource의 source가 다릅니다: ${edge.specifier}`);
          }
        }
        if (edge.classification === "unresolved") {
          const hasDiagnostic = snapshot.diagnostics.some((item) => item.code === "CSS_RESOURCE_NOT_FOUND"
            && item.source.file === edge.source.file && item.source.line === edge.source.line && item.source.column === edge.source.column);
          requireValue(hasDiagnostic, `미해결 참조 진단이 없습니다: ${edge.specifier}`);
        }
      }
    }
  }

  for (const stylesheet of snapshot.stylesheets ?? []) {
    for (const edge of stylesheet.imports ?? []) {
      if (edge.classification === "local" && /\.css$/i.test(edge.targetSourcePath ?? "")) {
        requireValue(stylesheetPaths.has(edge.targetSourcePath), `로컬 @import source가 snapshot에 없습니다: ${edge.targetSourcePath}`);
      }
    }
  }

  const cssModulePaths = new Set();
  for (const module of snapshot.cssModules ?? []) {
    requireValue(typeof module?.sourcePath === "string" && module.sourcePath.length > 0, "cssModule.sourcePath가 비었습니다.");
    requireValue(!cssModulePaths.has(module.sourcePath), `중복 CSS Module sourcePath: ${module.sourcePath}`);
    cssModulePaths.add(module.sourcePath);
    requireRelativePath(module.sourcePath, "cssModule.sourcePath");
    requireValue(stylesheetPaths.has(module.sourcePath), `CSS Module stylesheet source가 없습니다: ${module.sourcePath}`);
    requireValue(["named", "default", "named+default", "unknown"].includes(module.apiShape), `잘못된 CSS Module API 모양: ${module.apiShape}`);
    requireStringArray(module.exports, `CSS Module exports: ${module.sourcePath}`);
    requireUnique(module.exports, `중복 CSS Module export: ${module.sourcePath}`);
    requireValue(["named", "named+default"].includes(module.apiShape) === (module.exports.length > 0), `CSS Module export 키와 API 모양이 맞지 않습니다: ${module.sourcePath}`);
  }

  requireValue(snapshot.build.status !== "success" || (snapshot.diagnostics ?? []).every((item) => item.severity !== "error"), "성공한 빌드 snapshot에 error 진단이 있습니다.");
  requireValue(snapshot.build.status !== "failed" || (snapshot.diagnostics ?? []).some((item) => item.severity === "error"), "실패한 빌드 snapshot에 error 진단이 없습니다.");
}

function requireSnapshotArrays(snapshot) {
  for (const field of ["resources", "chunks", "stylesheets", "cssModules", "diagnostics"]) {
    requireValue(Array.isArray(snapshot[field]), `${field} 배열이 필요합니다.`);
  }
}

function requireStringArray(value, field) {
  requireValue(Array.isArray(value), `${field} 배열이 필요합니다.`);
  requireValue(value.every((item) => typeof item === "string" && item.length > 0), `${field}에는 비어 있지 않은 문자열만 허용합니다.`);
}

function requireUnique(values, message) {
  requireValue(new Set(values).size === values.length, message);
}

function requireResource(resourcesById, id) {
  const resource = resourcesById.get(id);
  requireValue(Boolean(resource), `존재하지 않는 resource id: ${id}`);
  return resource;
}

function requireResourceKind(resourcesById, id, kind) {
  const resource = requireResource(resourcesById, id);
  requireValue(resource.kind === kind, `${id}의 종류가 ${kind}이 아닙니다.`);
  return resource;
}

function requireSourceLocation(source, expectedFile) {
  requireValue(source && source.file === expectedFile, `원본 위치 파일이 맞지 않습니다: ${expectedFile}`);
  requireRelativePath(source.file, "source.file");
  requireValue(Number.isInteger(source.line) && source.line > 0, `잘못된 source line: ${source.file}`);
  requireValue(Number.isInteger(source.column) && source.column > 0, `잘못된 source column: ${source.file}`);
}

function requireRelativePath(value, field) {
  requireValue(typeof value === "string" && value.length > 0, `${field}가 비었습니다.`);
  requireValue(!value.includes("\\") && !value.startsWith("/") && !value.split("/").includes(".."), `${field}는 상대 POSIX 경로여야 합니다: ${value}`);
  requireValue(!value.split("/").includes(".") && !value.includes("//"), `${field}는 정규화된 POSIX 경로여야 합니다: ${value}`);
}

function requireSha256(value, field) {
  requireValue(/^[a-f0-9]{64}$/.test(value ?? ""), `${field}은 SHA-256이어야 합니다.`);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(`CSS 자원 계약 검증 실패: ${message}`);
}

function sorted(items, key) {
  return [...(items ?? [])].sort((left, right) => key(left).localeCompare(key(right)));
}

function sortedStrings(items) {
  return [...(items ?? [])].sort((left, right) => left.localeCompare(right));
}
