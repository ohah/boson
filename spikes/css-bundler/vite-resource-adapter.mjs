import fs from "node:fs/promises";
import { constants, realpathSync } from "node:fs";
import path from "node:path";
import { createAdapterSnapshot, CSS_RESOURCE_ADAPTER_VERSION, CSS_RESOURCE_CONTRACT } from "./adapter-contract.mjs";
import { inspectCssSource, resolveLocalCssImport } from "./css-source.mjs";
import {
  chunkId,
  normalizeBundlerSourcePath,
  listFiles,
  mediaTypeForPath,
  resourceId,
  resourceKindFromOutput,
  sha256,
  sourcePathFromId,
} from "./adapter-support.mjs";

const ADAPTER_NAME = "spinon-css-resource-adapter-vite-spike";

export function createViteResourceAdapter({ fixtureRoot, failOnMissing = false }) {
  const sources = new Map();
  const cssModules = new Map();
  const outputChunks = [];
  const transformedCssSources = new Set();
  const root = realpathSync(path.resolve(fixtureRoot));

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
      transformedCssSources.clear();
    },
    async transform(code, id) {
      const sourcePath = sourcePathForViteId(id, root);
      if (!sourcePath || path.posix.extname(sourcePath).toLowerCase() !== ".css") return null;
      transformedCssSources.add(sourcePath);
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
      const sourcePath = sourcePathForViteId(id, root);
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
            .map((id) => sourcePathForViteId(id, root))
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
    transformedCssSources,
    addSource,
    async snapshot({ manifest, outputDir, fixtureSha256, toolVersion, status = "success", captureMetadata = null }) {
      return createViteSnapshot({ adapter: this, manifest, outputDir, fixtureSha256, toolVersion, status, captureMetadata });
    },
  };
}

function sourcePathForViteId(id, root) {
  const withoutQuery = String(id).split("?", 1)[0].replaceAll("\\", "/");
  const absolutePath = path.isAbsolute(withoutQuery) ? path.resolve(withoutQuery) : path.resolve(root, withoutQuery);
  let canonicalPath = absolutePath;
  try {
    canonicalPath = realpathSync(absolutePath);
  } catch {
    // Vite virtual ID와 없는 경로는 sourcePathFromId 또는 CSS 원본 판정에서 거부합니다.
  }
  return sourcePathFromId(canonicalPath, root);
}

export async function createViteSnapshot({ adapter, manifest, outputDir, fixtureSha256, toolVersion, status, captureMetadata = null }) {
  const manifestEntries = validateViteManifest(manifest, adapter.outputChunks);
  const sourceByOutputPath = new Map();
  for (const { src, file } of manifestEntries) {
    if (src) {
      if (sourceByOutputPath.has(file)) throw new Error(`Vite manifest output source 소유 관계가 중복됩니다: ${file}`);
      sourceByOutputPath.set(file, src);
    }
  }
  const resources = await readViteOutputResources(outputDir, sourceByOutputPath);
  const resourcesByPath = new Map(resources.map((resource) => [resource.outputPath, resource]));
  for (const { key, file } of manifestEntries) {
    if (!resourcesByPath.has(file)) throw new Error(`Vite manifest가 없는 output을 가리킵니다: ${key} -> ${file}`);
  }
  const sourceResourceByPath = new Map(resources.filter((resource) => resource.sourcePath).map((resource) => [resource.sourcePath, resource]));
  const chunkByJsFile = new Map(adapter.outputChunks.map((chunk) => [normalizeBundlerSourcePath(chunk.fileName), chunk]));
  const manifestByJsFile = new Map(manifestEntries
    .filter(({ file }) => chunkByJsFile.has(file))
    .map((manifestEntry) => [manifestEntry.file, manifestEntry]));
  const missingManifestChunks = [...chunkByJsFile.keys()].filter((fileName) => !manifestByJsFile.has(fileName));
  if (missingManifestChunks.length > 0) {
    throw new Error(`Vite manifest에 출력 chunk가 없습니다: ${missingManifestChunks.join(", ")}`);
  }
  const chunks = [];
  const outputBySource = new Map();

  for (const [file, item] of manifestByJsFile) {
    const { key, entry, css, assets } = item;
    const chunk = chunkByJsFile.get(file);
    const kind = entry.isEntry === true ? "entry" : entry.isDynamicEntry === true ? "dynamic" : "shared";
    if (!resourcesByPath.has(file)) throw new Error(`Vite manifest JS output이 없습니다: ${file}`);
    const javascriptResourceIds = [resourceId(file)];
    const stylesheetResourceIds = css.map((outputPath) => {
      const resource = resourcesByPath.get(outputPath);
      if (!resource || resource.kind !== "stylesheet") {
        throw new Error(`Vite manifest CSS output이 없거나 stylesheet가 아닙니다: ${outputPath}`);
      }
      return resource.id;
    });
    const assetResourceIds = assets.map((outputPath) => {
      const resource = resourcesByPath.get(outputPath);
      if (!resource || !["font", "image", "other"].includes(resource.kind)) {
        throw new Error(`Vite manifest asset output이 없거나 지원하지 않는 종류입니다: ${outputPath}`);
      }
      return resource.id;
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
    build: {
      tool: "vite",
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

function validateViteManifest(manifest, outputChunks) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Vite production manifest는 object여야 합니다.");
  }
  const outputChunkFiles = new Set();
  for (const chunk of outputChunks) {
    const file = normalizeBundlerSourcePath(chunk.fileName);
    if (outputChunkFiles.has(file)) throw new Error(`Vite output chunk file이 중복됩니다: ${file}`);
    outputChunkFiles.add(file);
  }

  const manifestEntries = [];
  const manifestOwnerByChunkFile = new Map();
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.file !== "string") {
      throw new Error(`Vite manifest entry.file이 없습니다: ${key}`);
    }
    const file = normalizeManifestPath(entry.file, `manifest ${key}.file`);
    const normalizedOutputs = {};
    for (const field of ["css", "assets"]) {
      if (entry[field] !== undefined && (!Array.isArray(entry[field]) || entry[field].some((value) => typeof value !== "string"))) {
        throw new Error(`Vite manifest ${field} 목록이 올바르지 않습니다: ${key}`);
      }
      normalizedOutputs[field] = (entry[field] ?? []).map((value, index) => normalizeManifestPath(value, `manifest ${key}.${field}[${index}]`));
    }
    if (entry.src !== undefined && typeof entry.src !== "string") {
      throw new Error(`Vite manifest entry.src가 문자열이 아닙니다: ${key}`);
    }
    for (const field of ["isEntry", "isDynamicEntry"]) {
      if (entry[field] !== undefined && typeof entry[field] !== "boolean") {
        throw new Error(`Vite manifest ${field} 값이 boolean이 아닙니다: ${key}`);
      }
    }
    const src = entry.src === undefined ? null : normalizeManifestPath(entry.src, `manifest ${key}.src`);
    if (manifestOwnerByChunkFile.has(file) && outputChunkFiles.has(file)) {
      throw new Error(`Vite manifest JS chunk owner가 중복됩니다: ${file}`);
    }
    if (outputChunkFiles.has(file)) manifestOwnerByChunkFile.set(file, key);
    manifestEntries.push({ key, entry, file, src, css: normalizedOutputs.css, assets: normalizedOutputs.assets });
  }
  return manifestEntries;
}

function normalizeManifestPath(value, label) {
  const normalized = normalizeBundlerSourcePath(value);
  const segments = normalized.split("/");
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)
    || normalized.includes("\0") || segments.some((segment) => !segment || segment === ".." || segment === ".")) {
    throw new Error(`Vite ${label}는 안전한 상대 POSIX 경로여야 합니다: ${value}`);
  }
  return normalized;
}

async function readViteOutputResources(outputDir, sourceByOutputPath) {
  const rootMetadata = await fs.lstat(outputDir);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`Vite output root는 symlink가 아닌 디렉터리여야 합니다: ${outputDir}`);
  }
  const canonicalRoot = await fs.realpath(outputDir);
  const resources = [];
  for (const outputPath of await listFiles(canonicalRoot)) {
    if (outputPath.startsWith(".vite/")) continue;
    const bytes = await readViteOutputFile(canonicalRoot, outputPath);
    resources.push({
      id: resourceId(outputPath),
      kind: resourceKindFromOutput(outputPath),
      outputPath,
      mediaType: mediaTypeForPath(outputPath),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      sourcePath: sourceByOutputPath.get(outputPath) ?? null,
    });
  }
  return resources.sort((left, right) => left.outputPath < right.outputPath ? -1 : left.outputPath > right.outputPath ? 1 : 0);
}

async function readViteOutputFile(outputRoot, outputPath) {
  const segments = outputPath.split("/");
  let current = outputRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const metadata = await fs.lstat(current);
    const isFinal = index === segments.length - 1;
    if (metadata.isSymbolicLink()) throw new Error(`Vite output symlink는 resource로 읽지 않습니다: ${outputPath}`);
    if (!isFinal && !metadata.isDirectory()) throw new Error(`Vite output 경로 중간 항목이 디렉터리가 아닙니다: ${outputPath}`);
    if (isFinal && !metadata.isFile()) throw new Error(`Vite output resource가 일반 파일이 아닙니다: ${outputPath}`);
  }
  const handle = await fs.open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedMetadata = await handle.stat();
    const pathMetadata = await fs.lstat(current);
    if (!openedMetadata.isFile() || pathMetadata.isSymbolicLink()
      || openedMetadata.dev !== pathMetadata.dev || openedMetadata.ino !== pathMetadata.ino) {
      throw new Error(`Vite output resource가 검증 후 바뀌었습니다: ${outputPath}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
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
