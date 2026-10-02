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
  const plugin = {
    apply(compiler) {
      compiler.hooks.thisCompilation.tap("SpinonCssResourceAdapterSpike", (compilation) => {
        cssModuleChunks.clear();
        compilation.hooks.afterSeal.tap("SpinonCssResourceAdapterSpike", () => {
          for (const module of compilation.modules) {
            if (!String(module.type ?? "").startsWith("css/")) continue;
            const identifier = module.resource ?? module.identifier?.();
            const sourcePath = sourcePathFromId(String(identifier ?? "").split("|").at(-1), fixtureRoot);
            if (!sourcePath || !/\.css$/i.test(sourcePath)) continue;
            const names = [...compilation.chunkGraph.getModuleChunksIterable(module)]
              .map((chunk) => chunk.name ?? String(chunk.id))
              .sort((left, right) => left.localeCompare(right));
            cssModuleChunks.set(sourcePath, names);
          }
        });
      });
    },
  };
  return { plugin, cssModuleChunks };
}

export async function createRspackSnapshot({ stats, outputDir, fixtureRoot, fixtureSha256, toolVersion, cssModuleChunks = new Map(), status = "success" }) {
  const statsAssets = stats.assets ?? [];
  const sourceByOutputPath = new Map(statsAssets
    .filter((asset) => asset.info?.sourceFilename)
    .map((asset) => [normalizeBundlerSourcePath(asset.name), normalizeBundlerSourcePath(asset.info.sourceFilename)]));
  const resources = await outputResources(outputDir, sourceByOutputPath);
  const resourcesByPath = new Map(resources.map((resource) => [resource.outputPath, resource]));
  const sourceResourceByPath = new Map(resources.filter((resource) => resource.sourcePath).map((resource) => [resource.sourcePath, resource]));
  const chunksByKey = new Map();
  for (const chunk of stats.chunks ?? []) {
    const name = chunk.names?.[0] ?? String(chunk.id);
    chunksByKey.set(name, chunk);
  }

  const chunks = [];
  for (const [name, chunk] of chunksByKey) {
    const files = (chunk.files ?? []).map(normalizeBundlerSourcePath);
    const javascriptResourceIds = files.filter((file) => /\.(?:js|mjs|cjs)$/i.test(file) && resourcesByPath.has(file)).map(resourceId);
    const stylesheetResourceIds = files.filter((file) => /\.css$/i.test(file) && resourcesByPath.has(file)).map(resourceId);
    const assetNames = statsAssets
      .filter((asset) => {
        const kind = resourcesByPath.get(normalizeBundlerSourcePath(asset.name))?.kind;
        const owners = [...(asset.auxiliaryChunkNames ?? []), ...(asset.chunkNames ?? [])];
        return owners.includes(name) && ["font", "image", "other"].includes(kind);
      })
      .map((asset) => normalizeBundlerSourcePath(asset.name));
    chunks.push({
      id: chunkId(name),
      kind: chunk.entry ? "entry" : chunk.initial ? "shared" : "dynamic",
      javascriptResourceIds,
      stylesheetResourceIds,
      assetResourceIds: assetNames.map(resourceId),
    });
  }

  const modules = (stats.modules ?? []).filter((module) => String(module.moduleType ?? "").startsWith("css/") && typeof module.source === "string");
  const stylesheets = [];
  const cssModules = [];
  for (const module of modules) {
    const sourcePath = moduleSourcePath(module.name);
    if (!sourcePath) continue;
    const code = module.source;
    const inspection = inspectCssSource({ code, sourcePath, rootDir: fixtureRoot });
    const moduleChunkNames = cssModuleChunks.get(sourcePath) ?? [];
    const outputResourceIds = moduleChunkNames.flatMap((name) => {
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
    const code = modules.find((module) => moduleSourcePath(module.name) === stylesheet.sourcePath)?.source ?? "";
    return inspectCssSource({ code, sourcePath: stylesheet.sourcePath, rootDir: fixtureRoot }).diagnostics;
  });
  return createAdapterSnapshot({
    build: { tool: "rspack", toolVersion, adapterVersion: CSS_RESOURCE_ADAPTER_VERSION, mode: "production", status, fixtureSha256 },
    resources,
    chunks,
    stylesheets,
    cssModules,
    diagnostics,
  });
}

function moduleSourcePath(name) {
  const normalized = normalizeBundlerSourcePath(name);
  if (!/^(?:src|node_modules)\/.+\.css$/i.test(normalized)) return null;
  return normalized;
}
