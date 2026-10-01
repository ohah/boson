import fs from "node:fs/promises";
import path from "node:path";
import { createAdapterSnapshot, CSS_RESOURCE_ADAPTER_VERSION, CSS_RESOURCE_CONTRACT } from "./adapter-contract.mjs";
import { inspectCssSource, resolveLocalCssImport } from "./css-source.mjs";
import {
  chunkId,
  normalizeBundlerSourcePath,
  outputResources,
  resourceId,
  sha256,
  sourcePathFromId,
} from "./adapter-support.mjs";

const ADAPTER_NAME = "spinon-css-resource-adapter-vite-spike";

export function createViteResourceAdapter({ fixtureRoot, failOnMissing = false }) {
  const sources = new Map();
  const cssModules = new Map();
  const outputChunks = [];
  const root = path.resolve(fixtureRoot);

  async function addSource(sourcePath, code = null) {
    if (sources.has(sourcePath)) return;
    const sourceCode = code ?? await fs.readFile(path.join(root, ...sourcePath.split("/")), "utf8");
    const inspection = inspectCssSource({ code: sourceCode, sourcePath, rootDir: root });
    sources.set(sourcePath, { sourcePath, code: sourceCode, inspection });
    for (const edge of inspection.imports) {
      const importedPath = resolveLocalCssImport(edge);
      if (importedPath) await addSource(importedPath);
    }
  }

  const collectSource = {
    name: `${ADAPTER_NAME}:source`,
    enforce: "pre",
    buildStart() {
      sources.clear();
      cssModules.clear();
      outputChunks.length = 0;
    },
    async transform(code, id) {
      const sourcePath = sourcePathFromId(id, root);
      if (!sourcePath || path.posix.extname(sourcePath).toLowerCase() !== ".css") return null;
      await addSource(sourcePath, code);
      const record = sources.get(sourcePath);
      const missing = record.inspection.diagnostics[0];
      if (failOnMissing && missing) {
        this.error({
          plugin: ADAPTER_NAME,
          id,
          message: missing.message,
          loc: { file: id, line: missing.source.line, column: missing.source.column - 1 },
        });
      }
      return null;
    },
  };

  const collectModuleExports = {
    name: `${ADAPTER_NAME}:module-exports`,
    enforce: "post",
    transform(code, id) {
      const sourcePath = sourcePathFromId(id, root);
      if (!sourcePath || !/\.module\.css$/i.test(sourcePath)) return null;
      const exports = [...code.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g)].map((match) => match[1]);
      const hasDefault = /\bexport\s+default\b/.test(code);
      const hasNamed = exports.length > 0;
      cssModules.set(sourcePath, {
        sourcePath,
        apiShape: hasNamed && hasDefault ? "named+default" : hasNamed ? "named" : hasDefault ? "default" : "unknown",
        exports,
      });
      return null;
    },
  };

  const collectChunkGraph = {
    name: `${ADAPTER_NAME}:chunks`,
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        outputChunks.push({
          fileName: normalizeBundlerSourcePath(output.fileName),
          name: output.name,
          isEntry: output.isEntry,
          isDynamicEntry: output.isDynamicEntry,
          modulePaths: Object.keys(output.modules)
            .map((id) => sourcePathFromId(id, root))
            .filter(Boolean),
        });
      }
    },
  };

  return {
    plugins: [collectSource, collectModuleExports, collectChunkGraph],
    sources,
    cssModules,
    outputChunks,
    addSource,
    async snapshot({ manifest, outputDir, fixtureSha256, toolVersion, status = "success" }) {
      return createViteSnapshot({ adapter: this, manifest, outputDir, fixtureSha256, toolVersion, status });
    },
  };
}

export async function createViteSnapshot({ adapter, manifest, outputDir, fixtureSha256, toolVersion, status }) {
  const sourceByOutputPath = new Map();
  for (const entry of Object.values(manifest ?? {})) {
    if (entry.src && entry.file) sourceByOutputPath.set(entry.file, normalizeBundlerSourcePath(entry.src));
  }
  const resources = await outputResources(outputDir, sourceByOutputPath);
  const resourcesByPath = new Map(resources.map((resource) => [resource.outputPath, resource]));
  const sourceResourceByPath = new Map(resources.filter((resource) => resource.sourcePath).map((resource) => [resource.sourcePath, resource]));
  const chunkByJsFile = new Map(adapter.outputChunks.map((chunk) => [chunk.fileName, chunk]));
  const manifestEntries = Object.entries(manifest ?? {}).filter(([, entry]) => chunkByJsFile.has(entry.file));
  const manifestByJsFile = new Map(manifestEntries.map(([key, entry]) => [entry.file, { key, entry }]));
  const missingManifestChunks = [...chunkByJsFile.keys()].filter((fileName) => !manifestByJsFile.has(fileName));
  if (missingManifestChunks.length > 0) {
    throw new Error(`Vite manifest에 출력 chunk가 없습니다: ${missingManifestChunks.join(", ")}`);
  }
  const chunks = [];
  const outputBySource = new Map();

  for (const [, item] of manifestByJsFile) {
    const { key, entry } = item;
    const chunk = chunkByJsFile.get(entry.file);
    const kind = entry.isEntry ? "entry" : entry.isDynamicEntry ? "dynamic" : "shared";
    const javascriptResourceIds = [entry.file].map(resourceId).filter((id) => resourcesByPath.has(id.slice("resource:".length)));
    const stylesheetResourceIds = (entry.css ?? []).map(resourceId).filter((id) => resourcesByPath.has(id.slice("resource:".length)));
    const assetResourceIds = (entry.assets ?? [])
      .map(resourceId)
      .filter((id) => {
        const resource = resourcesByPath.get(id.slice("resource:".length));
        return resource && ["font", "image", "other"].includes(resource.kind);
      });
    const id = chunkId(key);
    chunks.push({ id, kind, javascriptResourceIds, stylesheetResourceIds, assetResourceIds });
    for (const sourcePath of chunk?.modulePaths ?? []) {
      if (!/\.css$/i.test(sourcePath)) continue;
      const existing = outputBySource.get(sourcePath) ?? new Set();
      for (const resource of stylesheetResourceIds) existing.add(resource);
      outputBySource.set(sourcePath, existing);
    }
  }

  propagateImportedStylesheets(adapter.sources, outputBySource);
  const stylesheets = [...adapter.sources.values()].map(({ sourcePath, code, inspection }) => ({
    id: `stylesheet:${sourcePath}`,
    sourcePath,
    sourceSha256: sha256(Buffer.from(code)),
    outputResourceIds: [...(outputBySource.get(sourcePath) ?? [])],
    imports: inspection.imports.map((edge) => ({ ...edge })),
    references: inspection.references.map((edge) => ({
      ...edge,
      targetResourceId: edge.targetSourcePath ? sourceResourceByPath.get(edge.targetSourcePath)?.id ?? null : null,
    })),
  }));

  const diagnostics = [...adapter.sources.values()].flatMap(({ inspection }) => inspection.diagnostics);
  const cssModules = [...adapter.cssModules.values()];
  return createAdapterSnapshot({
    contract: CSS_RESOURCE_CONTRACT,
    build: { tool: "vite", toolVersion, adapterVersion: CSS_RESOURCE_ADAPTER_VERSION, mode: "production", status, fixtureSha256 },
    resources,
    chunks,
    stylesheets,
    cssModules,
    diagnostics,
  });
}

function propagateImportedStylesheets(sources, outputBySource) {
  for (let pass = 0; pass < sources.size; pass += 1) {
    let changed = false;
    for (const [sourcePath, record] of sources) {
      const sourceOutputs = outputBySource.get(sourcePath);
      if (!sourceOutputs?.size) continue;
      for (const edge of record.inspection.imports) {
        if (edge.classification !== "local" || !edge.targetSourcePath) continue;
        const target = outputBySource.get(edge.targetSourcePath) ?? new Set();
        const before = target.size;
        for (const resourceId of sourceOutputs) target.add(resourceId);
        if (target.size !== before) {
          outputBySource.set(edge.targetSourcePath, target);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}
