import { createAdapterSnapshot, CSS_RESOURCE_ADAPTER_VERSION } from "./adapter-contract.mjs";
import { inspectCssSource } from "./css-source.mjs";
import {
  chunkId,
  normalizeBundlerSourcePath,
  outputResources,
  resourceId,
  sha256,
  sourcePathFromId,
} from "./adapter-support.mjs";

export function createRspackResourceAdapter({ fixtureRoot }) {
  const cssModuleChunks = new Map();
  const cssModuleSources = new Map();
  const cssModuleOutputPaths = new Map();
  const captureState = { compilation: null };
  const plugin = {
    apply(compiler) {
      compiler.hooks.thisCompilation.tap("SpinonCssResourceAdapterSpike", (compilation) => {
        cssModuleChunks.clear();
        cssModuleSources.clear();
        cssModuleOutputPaths.clear();
        compilation.hooks.afterSeal.tap("SpinonCssResourceAdapterSpike", () => {
          captureState.compilation = compilation;
          for (const module of compilation.modules) {
            if (!String(module.type ?? "").startsWith("css/")) continue;
            const identifier = module.resource ?? module.identifier?.();
            const sourcePath = sourcePathFromId(String(identifier ?? "").split("|").at(-1), fixtureRoot);
            if (!sourcePath || !/\.css$/i.test(sourcePath)) continue;
            const originalSource = module.originalSource?.();
            const source = originalSource?.source?.();
            if (typeof source === "string" || Buffer.isBuffer(source)) {
              cssModuleSources.set(sourcePath, Buffer.isBuffer(source) ? source.toString("utf8") : source);
            }
            const chunks = [...compilation.chunkGraph.getModuleChunksIterable(module)];
            const names = chunks
              .map((chunk) => chunk.name ?? String(chunk.id))
              .sort((left, right) => left.localeCompare(right));
            cssModuleChunks.set(sourcePath, names);
            const outputPaths = [...new Set(chunks.flatMap((chunk) => [...(chunk.files ?? [])])
              .map(normalizeBundlerSourcePath)
              .filter((file) => /\.css$/i.test(file)))].sort((left, right) => left.localeCompare(right));
            cssModuleOutputPaths.set(sourcePath, outputPaths);
          }
        });
      });
    },
  };
  return { plugin, cssModuleChunks, cssModuleSources, cssModuleOutputPaths, captureState };
}

export async function createRspackSnapshot({
  stats,
  outputDir,
  fixtureRoot,
  fixtureSha256,
  toolVersion,
  cssModuleChunks = new Map(),
  cssModuleSources = new Map(),
  cssModuleOutputPaths = null,
  useRawChunkIds = false,
  status = "success",
  captureMetadata = null,
}) {
  const statsAssets = stats.assets ?? [];
  const sourceByOutputPath = new Map(statsAssets
    .filter((asset) => asset.info?.sourceFilename)
    .map((asset) => [normalizeBundlerSourcePath(asset.name), normalizeBundlerSourcePath(asset.info.sourceFilename)]));
  const resources = await outputResources(outputDir, sourceByOutputPath);
  const resourcesByPath = new Map(resources.map((resource) => [resource.outputPath, resource]));
  const sourceResourceByPath = new Map(resources.filter((resource) => resource.sourcePath).map((resource) => [resource.sourcePath, resource]));
  const chunksByKey = new Map();
  const chunkNameCounts = new Map();
  for (const chunk of stats.chunks ?? []) {
    const name = chunk.names?.[0] ?? String(chunk.id);
    chunkNameCounts.set(name, (chunkNameCounts.get(name) ?? 0) + 1);
  }
  for (const chunk of stats.chunks ?? []) {
    const name = chunk.names?.[0] ?? String(chunk.id);
    chunksByKey.set(useRawChunkIds ? `${name}\0${chunk.id}` : name, chunk);
  }

  const chunks = [];
  for (const chunk of chunksByKey.values()) {
    const name = chunk.names?.[0] ?? String(chunk.id);
    const files = (chunk.files ?? []).map(normalizeBundlerSourcePath);
    const javascriptResourceIds = files.filter((file) => /\.(?:js|mjs|cjs)$/i.test(file) && resourcesByPath.has(file)).map(resourceId);
    const stylesheetResourceIds = files.filter((file) => /\.css$/i.test(file) && resourcesByPath.has(file)).map(resourceId);
    const assetNames = statsAssets
      .filter((asset) => {
        const kind = resourcesByPath.get(normalizeBundlerSourcePath(asset.name))?.kind;
        if (!(kind === "font" || kind === "image" || kind === "other")) return false;
        const ownerIds = [...(asset.chunks ?? []), ...(asset.auxiliaryChunks ?? [])].map(String);
        if (ownerIds.length > 0) return ownerIds.includes(String(chunk.id));
        const owners = [...(asset.auxiliaryChunkNames ?? []), ...(asset.chunkNames ?? [])];
        return owners.includes(name) && chunkNameCounts.get(name) === 1;
      })
      .map((asset) => normalizeBundlerSourcePath(asset.name));
    chunks.push({
      id: chunkId(useRawChunkIds ? String(chunk.id) : name),
      kind: chunk.entry ? "entry" : chunk.initial ? "shared" : "dynamic",
      javascriptResourceIds,
      stylesheetResourceIds,
      assetResourceIds: assetNames.map(resourceId),
    });
  }

  const modules = (stats.modules ?? [])
    .filter((module) => String(module.moduleType ?? "").startsWith("css/"))
    .map((module) => {
      const sourcePath = moduleSourcePath(module.name);
      if (!sourcePath) return null;
      const source = typeof module.source === "string" ? module.source : cssModuleSources.get(sourcePath);
      if (typeof source !== "string") throw new Error(`Rspack CSS module 원본 source를 capture하지 못했습니다: ${sourcePath}`);
      return { ...module, sourcePath, source };
    })
    .filter(Boolean);
  const stylesheets = [];
  const cssModules = [];
  for (const module of modules) {
    const sourcePath = module.sourcePath;
    const code = module.source;
    const inspection = inspectCssSource({ code, sourcePath, rootDir: fixtureRoot });
    const outputResourceIds = cssModuleOutputPaths?.has(sourcePath)
      ? (cssModuleOutputPaths.get(sourcePath) ?? [])
        .filter((file) => resourcesByPath.has(file))
        .map(resourceId)
      : (cssModuleChunks.get(sourcePath) ?? []).flatMap((name) => {
        const chunk = (stats.chunks ?? []).find((candidate) => (candidate.names ?? []).includes(name));
        return (chunk?.files ?? [])
          .map(normalizeBundlerSourcePath)
          .filter((file) => /\.css$/i.test(file) && resourcesByPath.has(file))
          .map(resourceId);
      });
    stylesheets.push({
      id: `stylesheet:${sourcePath}`,
      sourcePath,
      sourceSha256: sha256(Buffer.from(code)),
      outputResourceIds,
      imports: inspection.imports,
      references: inspection.references.map((edge) => ({
        ...edge,
        targetResourceId: edge.targetSourcePath ? sourceResourceByPath.get(edge.targetSourcePath)?.id ?? null : null,
      })),
    });

    if (/\.module\.css$/i.test(sourcePath)) {
      const exports = Array.isArray(module.providedExports) ? module.providedExports.filter((item) => item !== "default") : [];
      const hasDefault = Array.isArray(module.providedExports) && module.providedExports.includes("default");
      cssModules.push({
        sourcePath,
        apiShape: exports.length && hasDefault ? "named+default" : exports.length ? "named" : hasDefault ? "default" : "unknown",
        exports,
      });
    }
  }

  const diagnostics = stylesheets.flatMap((stylesheet) => {
    const code = modules.find((module) => module.sourcePath === stylesheet.sourcePath)?.source ?? "";
    return inspectCssSource({ code, sourcePath: stylesheet.sourcePath, rootDir: fixtureRoot }).diagnostics;
  });
  return createAdapterSnapshot({
    build: {
      tool: "rspack",
      toolVersion,
      adapterVersion: CSS_RESOURCE_ADAPTER_VERSION,
      mode: "production",
      status,
      fixtureSha256,
      ...(captureMetadata ?? {}),
    },
    resources,
    chunks,
    stylesheets,
    cssModules,
    diagnostics,
  });
}

function moduleSourcePath(name) {
  const normalized = normalizeBundlerSourcePath(name);
  if (!/\.css$/i.test(normalized) || normalized.startsWith("/") || normalized.includes("\\")
    || normalized.includes("?") || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return normalized;
}
