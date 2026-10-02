import { createHash } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { parse as parseJavaScript } from "acorn";
import {
  MODULE_GRAPH_ADAPTER_VERSION,
  MODULE_GRAPH_CONTRACT,
  assertR15JavaScriptGraphInput,
  computeBuildProfileSha256,
  computeSourceGraphSha256,
  createModuleGraphSnapshot,
  parseEmittedEsm,
  resolveEmittedChunkTarget,
} from "./module-graph-contract.mjs";

export const VITE_MODULE_GRAPH_ADAPTER_VERSION = MODULE_GRAPH_ADAPTER_VERSION;
export const VITE_MODULE_GRAPH_CONTRACT = MODULE_GRAPH_CONTRACT;

const ADAPTER_NAME = "spinon-c02-vite-module-graph";
const JAVA_SCRIPT_MODULE_TYPES = new Set(["js", "jsx", "ts", "tsx", "json"]);
const STYLE_MODULE_TYPES = new Set(["css", "css-module", "sass", "scss", "less", "styl", "pcss", "postcss"]);
const STYLE_EXTENSIONS = new Set([".css", ".pcss", ".postcss", ".scss", ".sass", ".less", ".styl"]);
const ASSET_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp", ".woff", ".woff2", ".ttf", ".otf", ".eot"]);
const JAVASCRIPT_OUTPUT_ASSET_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".mjsx", ".ts", ".mts", ".cts", ".tsx", ".es", ".es6"]);
const KNOWN_INJECTED_IDS = new Set(["\0vite/preload-helper.js", "\0rolldown/runtime.js"]);
const VITE_BUILTIN_PLUGIN_ORDER = [
  "vite:optimized-deps", "vite:watch-package-data", "vite:pre-alias", "alias", "vite:resolve-builtin:get-environment",
  "vite:resolve-builtin", "vite:html-inline-proxy", "vite:css", "builtin:oxc-runtime", "vite:oxc", "builtin:vite-json",
  "vite:wasm-helper", "vite:worker", "vite:asset", "vite:forward-console", "vite:define", "vite:css-post",
  "vite:build-html", "vite:worker-import-meta-url", "vite:asset-import-meta-url", "vite:prepare-out-dir",
  "vite:rollup-options-plugins", "vite:dynamic-import-vars", "vite:import-glob", "vite:build-import-analysis",
  "native:import-analysis-build", "vite:terser", "vite:license", "native:manifest", "vite:ssr-manifest",
  "native:reporter", "builtin:vite-load-fallback", "vite:client-inject", "vite:css-analysis", "vite:import-analysis",
];
const VITE_BUILTIN_PLUGIN_NAMES = new Set(VITE_BUILTIN_PLUGIN_ORDER);

export function createViteModuleGraphAdapter({ fixtureRoot, features, outputProfile }) {
  const root = canonicalFilesystemPath(path.resolve(fixtureRoot));
  const sourceModules = new Map();
  const sourceResourceModules = new Set();
  const transformedModules = new Map();
  const sourceOccurrences = [];
  const sourceDiagnostics = [];
  const configDiagnostics = [];
  const outputDiagnostics = [];
  let outputGraph = emptyOutputGraph();
  let pendingOutput = null;
  let buildFailed = false;
  let expectedConfig = null;
  let resolvedViteConfig = null;
  let writeBundleCallCount = 0;

  const featureDiagnostics = validateFeatures(features);
  sourceDiagnostics.push(...featureDiagnostics);

function moduleKey(id) {
    const rawId = normalizeId(String(id));
    if (rawId.startsWith("\0")) return `virtual:${sha256(rawId).slice(0, 24)}`;
    const queryAt = rawId.search(/[?#]/);
    const pathname = queryAt === -1 ? rawId : rawId.slice(0, queryAt);
    const suffix = queryAt === -1 ? "" : rawId.slice(queryAt);
    if (path.isAbsolute(pathname)) {
      const absolute = canonicalFilesystemPath(path.resolve(pathname));
      const relative = toPosix(path.relative(root, absolute));
      if (relative && relative !== ".." && !relative.startsWith("../") && !path.posix.isAbsolute(relative)) {
        return suffix ? `${relative}#query-${sha256(suffix).slice(0, 12)}` : relative;
      }
      return `module:${sha256(`${absolute}${suffix}`).slice(0, 24)}`;
    }
    const normalized = path.posix.normalize(pathname.replace(/^\.\//, ""));
    if (normalized && normalized !== "." && normalized !== ".." && !normalized.startsWith("../") && !normalized.startsWith("/")) {
      return suffix ? `${normalized}#query-${sha256(suffix).slice(0, 12)}` : normalized;
    }
    return `virtual:${sha256(rawId).slice(0, 24)}`;
  }

  function reset() {
    sourceModules.clear();
    sourceResourceModules.clear();
    transformedModules.clear();
    sourceOccurrences.length = 0;
    sourceDiagnostics.length = 0;
    sourceDiagnostics.push(...featureDiagnostics);
    sourceDiagnostics.push(...configDiagnostics);
    outputDiagnostics.length = 0;
    outputGraph = emptyOutputGraph();
    pendingOutput = null;
    buildFailed = false;
    writeBundleCallCount = 0;
  }

  const plugin = {
    name: ADAPTER_NAME,
    enforce: "post",
    apply: "build",

    spinonC02ProfileOptions: {
      role: "adapter",
      features: structuredClone(features),
      outputProfile: structuredClone(outputProfile),
    },

    buildStart() {
      reset();
    },

    configResolved(config) {
      configDiagnostics.length = 0;
      resolvedViteConfig = summarizeResolvedViteConfig(config);
      validateResolvedViteConfig(config, expectedConfig, root, outputProfile, configDiagnostics);
    },

    transform(code, id) {
      if (isKnownBundlerInjectedModule(id)) return null;
      const resource = classifyViteResource(id, {}, root);
      if (resource.status !== "none") return null;
      transformedModules.set(canonicalModuleId(id), { id, code });
      // dependency ID의 근거는 moduleParsed에서만 확정한다.
      return null;
    },

    async moduleParsed(info) {
      const generatedModule = isKnownBundlerInjectedModule(info.id);
      if (!generatedModule && !String(info.id).startsWith("\0")) {
        const sourcePathStatus = await inspectFixtureSourcePath(root, info.id);
        if (sourcePathStatus.status !== "inside") {
          addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", sourcePathStatus.message, {
            referrerModuleKey: moduleKey(info.id),
          });
          return;
        }
      }
      if (info.code == null) {
        if (generatedModule) addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", "인식한 Vite 생성 virtual module에 읽을 수 있는 moduleParsed code가 없습니다.", {
          referrerModuleKey: moduleKey(info.id),
        });
        return;
      }

      const key = moduleKey(info.id);
      const moduleType = info.moduleType;
      const resource = classifyViteResource(info.id, info, root);
      if (resource.status === "resource") {
        sourceResourceModules.add(canonicalModuleId(info.id));
        return;
      }
      if (resource.status === "unsupported") {
        addDiagnostic(sourceDiagnostics, "C02_GRAPH_UNSUPPORTED_IMPORT", "source", resource.message, {
          referrerModuleKey: key,
        });
        return;
      }
      if (moduleType && !JAVA_SCRIPT_MODULE_TYPES.has(moduleType)) {
        addDiagnostic(sourceDiagnostics, "C02_GRAPH_UNSUPPORTED_IMPORT", "source", `지원하지 않는 입력 module type입니다: ${moduleType}`, {
          referrerModuleKey: key,
        });
        return;
      }

      let ast;
      try {
        ast = this.parse(info.code, { sourceType: "unambiguous", lang: languageForId(info.id) });
      } catch (error) {
        addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", `Vite moduleParsed 코드를 파싱할 수 없습니다: ${error.message}`, {
          referrerModuleKey: key,
        });
        return;
      }

      const parsed = collectImportOccurrences(ast, (code, message, specifier = null) => {
        addDiagnostic(sourceDiagnostics, code, "source", message, {
          referrerModuleKey: key,
          specifier,
        });
      });
      const record = {
        key,
        id: info.id,
        staticIds: [...(info.importedIds ?? [])],
        dynamicIds: [...(info.dynamicallyImportedIds ?? [])],
        outputChunkIds: new Set(),
      };
      sourceModules.set(canonicalModuleId(info.id), record);
      transformedModules.delete(canonicalModuleId(info.id));

      for (const kind of ["static", "dynamic"]) {
        const occurrences = parsed.filter((item) => item.kind === kind);
        const allIds = kind === "static" ? record.staticIds : record.dynamicIds;
        const ids = allIds.filter((dependencyId) => !isKnownBundlerInjectedModule(dependencyId));
        const mapping = mapModuleInfoDependencies(occurrences, ids);
        if (mapping.status !== "mapped") {
          addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", mapping.message, {
            referrerModuleKey: key,
          });
        }
        for (let index = 0; index < occurrences.length; index += 1) {
          sourceOccurrences.push({
            referrerModuleKey: key,
            kind,
            sourceSpecifier: occurrences[index].specifier,
            resolvedModuleKey: null,
            external: false,
            targetId: mapping.status === "mapped" ? mapping.targetIds[index] : null,
            targetResourceKind: null,
            source: null,
          });
        }
        for (const dependencyId of allIds.filter(isKnownBundlerInjectedModule)) {
          const targetKey = moduleKey(dependencyId);
          sourceOccurrences.push({
            referrerModuleKey: key,
            kind,
            sourceSpecifier: generatedSpecifierForId(dependencyId),
            resolvedModuleKey: targetKey,
            external: false,
            targetId: dependencyId,
            targetResourceKind: null,
            source: null,
            generated: true,
          });
        }
      }
    },

    buildEnd(error) {
      if (error) {
        buildFailed = true;
        addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "build", `Vite build가 실패했습니다: ${error.message}`);
      }
      for (const record of sourceModules.values()) {
        const current = this.getModuleInfo(record.id);
        if (!current) {
          addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", "moduleParsed 모듈을 buildEnd graph에서 다시 확인할 수 없습니다.", {
            referrerModuleKey: record.key,
          });
          continue;
        }
        compareModuleInfoIds(record, current, sourceDiagnostics);
      }
      for (const [canonicalId, candidate] of transformedModules) {
        if (sourceModules.has(canonicalId)) continue;
        addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", "transform에서 본 JavaScript 모듈의 moduleParsed capture가 없습니다.", {
          referrerModuleKey: moduleKey(candidate.id),
        });
      }
      for (const occurrence of sourceOccurrences) {
        if (!occurrence.targetId) continue;
        const targetInfo = this.getModuleInfo(occurrence.targetId);
        const resource = classifyViteResource(occurrence.targetId, targetInfo, root);
        if (resource.status === "resource") {
          occurrence.targetResourceKind = resource.kind;
          occurrence.resolvedModuleKey = resource.key;
          sourceResourceModules.add(canonicalModuleId(occurrence.targetId));
          continue;
        }
        if (resource.status === "unsupported") {
          addDiagnostic(sourceDiagnostics, "C02_GRAPH_UNSUPPORTED_IMPORT", "source", resource.message, {
            referrerModuleKey: occurrence.referrerModuleKey,
            specifier: occurrence.sourceSpecifier,
          });
          continue;
        }
        if (sourceModules.has(canonicalModuleId(occurrence.targetId))) {
          occurrence.resolvedModuleKey = moduleKey(occurrence.targetId);
          continue;
        }
        if (targetInfo?.moduleType && !JAVA_SCRIPT_MODULE_TYPES.has(targetInfo.moduleType)) {
          addDiagnostic(sourceDiagnostics, "C02_GRAPH_UNSUPPORTED_IMPORT", "source", `지원하지 않는 dependency module type입니다: ${targetInfo.moduleType}`, {
            referrerModuleKey: occurrence.referrerModuleKey,
            specifier: occurrence.sourceSpecifier,
          });
          continue;
        }
        if (!targetInfo) {
          addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", "Vite ModuleInfo dependency가 source moduleParsed 수집 결과에 없습니다.", {
            referrerModuleKey: occurrence.referrerModuleKey,
            specifier: occurrence.sourceSpecifier,
          });
          addDiagnostic(sourceDiagnostics, "C02_GRAPH_UNRESOLVED_IMPORT", "source", "Vite ModuleInfo dependency ID가 source module graph에 없습니다.", {
            referrerModuleKey: occurrence.referrerModuleKey,
            specifier: occurrence.sourceSpecifier,
          });
          continue;
        }
        if (targetInfo.code == null) {
          occurrence.external = true;
          addDiagnostic(sourceDiagnostics, "C02_GRAPH_EXTERNAL_IMPORT", "source", "Vite ModuleInfo dependency가 external로 남아 있습니다.", {
            referrerModuleKey: occurrence.referrerModuleKey,
            specifier: occurrence.sourceSpecifier,
          });
          continue;
        }
        addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", "Vite ModuleInfo dependency는 존재하지만 moduleParsed source capture가 없습니다.", {
          referrerModuleKey: occurrence.referrerModuleKey,
          specifier: occurrence.sourceSpecifier,
        });
      }
      detectSourceTargetConflicts(sourceOccurrences, sourceDiagnostics);
    },

    renderChunk(code) {
      return normalizeRolldownRegionComments(code, root);
    },

    writeBundle(options, bundle) {
      writeBundleCallCount += 1;
      if (writeBundleCallCount !== 1) {
        pendingOutput = null;
        addDiagnostic(outputDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "output", `단일 output profile인데 writeBundle 호출이 ${writeBundleCallCount}회 관찰됐습니다.`);
        return;
      }
      const outputDirectoryValue = options.dir ?? (options.file ? path.dirname(options.file) : null);
      for (const item of Object.values(bundle)) {
        if (item.type !== "asset" || !isUncapturedJavaScriptOutputAsset(item.fileName)) continue;
        addDiagnostic(outputDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "output", `JavaScript 확장자의 OutputAsset은 C02.2 chunk/module graph에 연결할 수 없어 성공 처리하지 않습니다: ${item.fileName}`, {
          referrerModuleKey: `resource:${toPosix(item.fileName)}`,
        });
      }
      pendingOutput = {
        outputDirectory: outputDirectoryValue ? path.resolve(outputDirectoryValue) : null,
        outputs: Object.values(bundle).map((item) => item.type === "chunk"
          ? {
              type: "chunk",
              fileName: toPosix(item.fileName),
              isEntry: Boolean(item.isEntry),
              isDynamicEntry: Boolean(item.isDynamicEntry),
              moduleIds: Object.keys(item.modules),
              imports: [...(item.imports ?? [])].map(toPosix),
              dynamicImports: [...(item.dynamicImports ?? [])].map(toPosix),
            }
          : { type: "asset", fileName: toPosix(item.fileName) }),
      };
    },

    async closeBundle() {
      if (pendingOutput && writeBundleCallCount === 1) await captureOutputGraph(pendingOutput, this, sourceModules, sourceResourceModules, outputDiagnostics, moduleKey, (graph) => {
        outputGraph = graph;
      });
    },
  };

  function snapshot({ fixtureSha256, profile, viteVersion, buildStatus = "success" }) {
    if (buildStatus === "success" && !buildFailed && writeBundleCallCount !== 1) {
      addDiagnostic(outputDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "output", `고정 output profile은 writeBundle 1회를 요구하지만 ${writeBundleCallCount}회를 관찰했습니다.`);
    }
    if (resolvedViteConfig === null) {
      addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "config", "Vite configResolved effective configuration을 관찰하지 못했습니다.");
    }
    const diagnostics = sortDiagnostics([...sourceDiagnostics, ...outputDiagnostics]);
    const failed = buildStatus !== "success" || buildFailed || diagnostics.some((item) => item.severity === "error");
    const sourceGraph = createSourceGraph(sourceModules, sourceOccurrences, {
      status: failed ? "incomplete" : "complete",
    });
    let output = outputGraph;
    if (output.resources.length === 0 && output.chunks.length === 0) output = emptyOutputGraph();
    const provisional = {
      contract: VITE_MODULE_GRAPH_CONTRACT,
      build: {
        tool: "vite",
        toolVersion: viteVersion,
        adapterVersion: VITE_MODULE_GRAPH_ADAPTER_VERSION,
        outputProfile: outputProfile?.name ?? "vite-esm",
        status: failed ? "failed" : "success",
        fixtureSha256,
        profile,
        buildProfileSha256: computeBuildProfileSha256(profile),
      },
      sourceGraph,
      features: failed ? [] : mapFeatures(features, sourceModules, output.chunks),
      outputGraph: output,
      diagnostics,
    };
    let normalized;
    try {
      normalized = createModuleGraphSnapshot(provisional);
      if (!failed) assessR15JavaScriptInput(normalized);
      return normalized;
    } catch (error) {
      if (!failed) {
        addDiagnostic(outputDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "snapshot", `공통 graph/R15 JavaScript 검증이 거부했습니다: ${error.message}`);
        const failureDiagnostics = sortDiagnostics([...sourceDiagnostics, ...outputDiagnostics]);
        const failedSnapshot = {
          ...provisional,
          build: { ...provisional.build, status: "failed" },
          features: [],
          diagnostics: failureDiagnostics,
        };
        try {
          return createModuleGraphSnapshot(failedSnapshot);
        } catch (secondError) {
          return makeMinimalFailureSnapshot(failedSnapshot, secondError);
        }
      }
      return makeMinimalFailureSnapshot(provisional, error);
    }
  }

  function recordBuildFailure(error) {
    buildFailed = true;
    addDiagnostic(sourceDiagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "build", `Vite build가 예외로 종료됐습니다: ${error.message}`);
  }

  function assessR15JavaScriptInput(snapshotValue) {
    return assertR15JavaScriptGraphInput(snapshotValue);
  }

  function setExpectedConfig(config) {
    expectedConfig = summarizePlannedViteConfig(config);
  }

  function profileObservations() {
    return {
      resolvedViteConfig: resolvedViteConfig ? structuredClone(resolvedViteConfig) : null,
      writeBundleCallCount,
    };
  }

  return { plugin, snapshot, recordBuildFailure, assessR15JavaScriptInput, setExpectedConfig, profileObservations };
}

function splitModuleId(id) {
  const value = normalizeId(String(id));
  const suffixIndex = value.search(/[?#]/);
  const pathname = suffixIndex === -1 ? value : value.slice(0, suffixIndex);
  const query = suffixIndex !== -1 && value[suffixIndex] === "?" ? value.slice(suffixIndex + 1).split("#", 1)[0] : "";
  const queryKeys = new Set();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const [rawKey] = pair.split("=", 1);
    try {
      queryKeys.add(decodeURIComponent(rawKey.replaceAll("+", " ")));
    } catch {
      queryKeys.add(rawKey);
    }
  }
  return { pathname, queryKeys };
}

async function inspectFixtureSourcePath(fixtureRoot, id) {
  const { pathname } = splitModuleId(id);
  if (!path.isAbsolute(pathname)) {
    return { status: "outside", message: "non-virtual module id에 실제 fixture 파일 경로가 없습니다." };
  }
  const rootRealPath = await realpath(fixtureRoot);
  const candidate = path.resolve(pathname);
  const lexicalRelative = path.relative(rootRealPath, candidate);
  if (!isRelativePathInside(lexicalRelative)) {
    return { status: "outside", message: "fixture 밖의 파일 module dependency는 inventory에 포함되지 않아 거부했습니다." };
  }
  let current = rootRealPath;
  for (const segment of lexicalRelative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      return { status: "outside", message: "fixture module path를 lstat로 확인할 수 없어 거부했습니다." };
    }
    if (stat.isSymbolicLink()) return { status: "outside", message: "fixture source dependency 경로의 symlink는 inventory 밖 대상을 숨길 수 있어 거부했습니다." };
    const canonical = await realpath(current);
    if (!isRelativePathInside(path.relative(rootRealPath, canonical))) {
      return { status: "outside", message: "fixture module의 realpath가 inventory root 밖으로 벗어나 거부했습니다." };
    }
  }
  const finalStat = await lstat(current);
  if (!finalStat.isFile()) return { status: "outside", message: "fixture module source가 일반 파일이 아니어서 거부했습니다." };
  return { status: "inside" };
}

function canonicalFixtureResourceKey(id, fixtureRoot) {
  if (!fixtureRoot) return null;
  const { pathname } = splitModuleId(id);
  if (!path.isAbsolute(pathname)) return null;
  const canonical = canonicalFilesystemPath(path.resolve(pathname));
  const relative = toPosix(path.relative(fixtureRoot, canonical));
  if (!isRelativePathInside(relative) || path.posix.isAbsolute(relative)) return null;
  return relative;
}

function isRelativePathInside(relative) {
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !relative.startsWith("../") && !path.isAbsolute(relative);
}

async function captureOutputGraph(pending, pluginContext, sourceModules, sourceResourceModules, diagnostics, moduleKey, publish) {
  const bundleChunks = pending.outputs.filter((item) => item.type === "chunk");
  if (!pending.outputDirectory) {
    addDiagnostic(diagnostics, "C02_GRAPH_RESOURCE_MISSING", "output", "writeBundle hook에 출력 디렉터리가 없습니다.");
    publish(emptyOutputGraph());
    return;
  }

  const resources = [];
  const chunkDescriptors = [];
  const bytesByPath = new Map();
  for (const item of bundleChunks) {
    let bytes;
    try {
      bytes = await readOutputBytesWithoutSymlinks(pending.outputDirectory, item.fileName);
    } catch (error) {
      addDiagnostic(diagnostics, "C02_GRAPH_RESOURCE_MISSING", "output", `실제 출력 파일이 일반 파일 경로가 아니거나 읽을 수 없습니다: ${error.message}`, {
        referrerModuleKey: `chunk:${item.fileName}`,
      });
      continue;
    }
    const code = bytes.toString("utf8");
    const parsed = parseEmittedEsm({ code, fileName: item.fileName });
    diagnostics.push(...parsed.diagnostics.map((entry) => ({ ...entry, referrerModuleKey: `chunk:${item.fileName}` })));
    const resource = {
      id: `resource:${item.fileName}`,
      logicalId: null,
      identityStatus: "unproven",
      kind: "javascript",
      outputPath: item.fileName,
      mediaType: "text/javascript",
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    };
    resources.push(resource);
    bytesByPath.set(item.fileName, { bytes, parsed, resource });
    chunkDescriptors.push({
      id: `chunk:${item.fileName}`,
      logicalId: null,
      identityStatus: "unproven",
      kind: item.isEntry ? "entry" : item.isDynamicEntry ? "dynamic" : "shared",
      moduleFormat: parsed.status === "success" ? "esm" : "unknown",
      javascriptResourceId: resource.id,
      sourceModuleKeys: [],
      dependencies: [],
      output: item,
    });
  }

  const chunksByPath = new Map(chunkDescriptors.map((chunk) => [chunk.output.fileName, chunk]));
  for (const chunk of chunkDescriptors) {
    for (const id of chunk.output.moduleIds) {
      if (sourceResourceModules.has(canonicalModuleId(id))) continue;
      const sourceRecord = sourceModules.get(canonicalModuleId(id));
      if (!sourceRecord) {
        if (isKnownBundlerInjectedModule(id)) continue;
        addDiagnostic(diagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "output", "output chunk module membership가 moduleParsed 기록에 없습니다.", {
          referrerModuleKey: moduleKey(id),
        });
        continue;
      }
      sourceRecord.outputChunkIds.add(chunk.id);
      chunk.sourceModuleKeys.push(sourceRecord.key);
    }
    chunk.sourceModuleKeys = uniqueCodepointSorted(chunk.sourceModuleKeys);
  }

  for (const chunk of chunkDescriptors) {
    const outputFile = bytesByPath.get(chunk.output.fileName);
    if (!outputFile) continue;
    for (const edge of outputFile.parsed.imports) {
      const resolved = resolveEmittedChunkTarget({
        referrerPath: chunk.output.fileName,
        specifier: edge.specifier,
        chunks: chunkDescriptors.map(({ output, ...value }) => value),
        resources,
      });
      if (resolved.status === "unresolved") {
        const assetTarget = resolveOutputAsset(pending.outputs, chunk.output.fileName, edge.specifier);
        addDiagnostic(diagnostics, assetTarget
          ? "C02_GRAPH_UNSUPPORTED_IMPORT"
          : "C02_GRAPH_UNRESOLVED_IMPORT", "output", assetTarget
          ? "최종 ESM import가 JavaScript 이외의 출력 자원을 가리킵니다. C02.2에서는 0011 join 전까지 성공 처리할 수 없습니다."
          : "최종 emitted ESM specifier를 JavaScript output chunk 하나에 연결하지 못했습니다.", {
          referrerModuleKey: chunk.id,
          specifier: edge.specifier,
          source: edge.source,
        });
        continue;
      }
      if (resolved.status === "ambiguous") {
        addDiagnostic(diagnostics, "C02_GRAPH_TARGET_AMBIGUOUS", "output", "최종 emitted ESM specifier가 복수 JavaScript resource에 대응합니다.", {
          referrerModuleKey: chunk.id,
          specifier: edge.specifier,
          source: edge.source,
        });
        continue;
      }
      const metadata = edge.kind === "static" ? chunk.output.imports : chunk.output.dynamicImports;
      if (!metadata.includes(resolved.outputPath)) {
        addDiagnostic(diagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "output", "최종 ESM import target이 Vite OutputChunk metadata와 다릅니다.", {
          referrerModuleKey: chunk.id,
          specifier: edge.specifier,
          source: edge.source,
        });
      }
      chunk.dependencies.push({ kind: edge.kind, specifier: edge.specifier, chunkId: resolved.chunkId });
    }
  }

  detectOutputTargetConflicts(chunkDescriptors, diagnostics);
  const chunks = chunkDescriptors.map(({ output, ...chunk }) => chunk);
  const graph = {
    status: diagnostics.length === 0 && chunks.every((chunk) => chunk.moduleFormat === "esm") ? "complete" : "incomplete",
    moduleFormat: diagnostics.length === 0 && chunks.length > 0 && chunks.every((chunk) => chunk.moduleFormat === "esm") ? "esm" : "unknown",
    resources,
    chunks,
  };
  publish(graph);
}

function createSourceGraph(sourceModules, sourceOccurrences, { status }) {
  const modules = [...sourceModules.values()].map((record) => ({
    key: record.key,
    outputChunkIds: uniqueCodepointSorted([...record.outputChunkIds]),
  }));
  const dependencies = [];
  const excludedDependencies = [];
  for (const occurrence of sourceOccurrences) {
    if (occurrence.targetResourceKind) {
      excludedDependencies.push({
        referrerModuleKey: occurrence.referrerModuleKey,
        kind: occurrence.kind,
        sourceSpecifier: occurrence.sourceSpecifier,
        targetKind: occurrence.targetResourceKind,
        resolvedResourceKey: occurrence.resolvedModuleKey,
        source: null,
      });
    } else {
      dependencies.push({
        referrerModuleKey: occurrence.referrerModuleKey,
        kind: occurrence.kind,
        sourceSpecifier: occurrence.sourceSpecifier,
        resolvedModuleKey: occurrence.resolvedModuleKey,
        external: occurrence.external,
        source: null,
      });
    }
  }
  const graph = {
    scope: "javascript-module-dependencies",
    status,
    capture: "vite-moduleParsed-ModuleInfo-importedIds-and-writeBundle-bytes",
    moduleCount: modules.length,
    edgeCount: dependencies.length,
    excludedDependencyCount: excludedDependencies.length,
    sha256: "0".repeat(64),
    modules,
    dependencies,
    excludedDependencies,
  };
  graph.sha256 = computeSourceGraphSha256(graph);
  return graph;
}

function mapFeatures(features, sourceModules, chunks) {
  const output = [];
  for (const feature of features) {
    const moduleRecord = [...sourceModules.values()].find((record) => record.key === feature.entrySourceKey);
    const candidates = moduleRecord ? [...moduleRecord.outputChunkIds] : [];
    const matches = chunks.filter((chunk) => candidates.includes(chunk.id) && ["entry", "dynamic"].includes(chunk.kind));
    output.push({
      id: feature.id,
      entrySourceKey: feature.entrySourceKey,
      entryChunkId: matches.length === 1 ? matches[0].id : null,
    });
  }
  return output;
}

function validateFeatures(features) {
  const diagnostics = [];
  if (!Array.isArray(features) || features.length === 0) {
    addDiagnostic(diagnostics, "C02_GRAPH_PROVENANCE_MISSING", "config", "명시적인 feature entry가 하나 이상 필요합니다.");
    return diagnostics;
  }
  const ids = new Set();
  for (const feature of features) {
    if (!feature || typeof feature.id !== "string" || !feature.id || typeof feature.entrySourceKey !== "string" || !feature.entrySourceKey) {
      addDiagnostic(diagnostics, "C02_GRAPH_PROVENANCE_MISSING", "config", "feature에는 비어 있지 않은 id와 entrySourceKey가 필요합니다.");
      continue;
    }
    if (ids.has(feature.id)) addDiagnostic(diagnostics, "C02_GRAPH_PROVENANCE_MISSING", "config", `중복 feature id입니다: ${feature.id}`);
    ids.add(feature.id);
  }
  return diagnostics;
}

function collectImportOccurrences(ast, onUnsupported) {
  const result = [];
  walkAst(ast, (node) => {
    if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      if (!node.source) return;
      const specifier = stringLiteralValue(node.source);
      if (specifier === null) {
        onUnsupported("C02_GRAPH_UNSUPPORTED_IMPORT", "정적 import/export source가 문자열 literal이 아닙니다.");
        return;
      }
      if (node.phase && node.phase !== "evaluation") {
        onUnsupported("C02_GRAPH_UNSUPPORTED_IMPORT", `지원하지 않는 import phase입니다: ${node.phase}`, specifier);
      }
      if ((node.attributes?.length ?? 0) > 0 || (node.assertions?.length ?? 0) > 0) {
        onUnsupported("C02_GRAPH_UNSUPPORTED_IMPORT", "import attributes는 현재 profile에서 지원하지 않습니다.", specifier);
      }
      result.push({ kind: "static", specifier, offset: node.start ?? 0 });
      return;
    }
    if (node.type !== "ImportExpression") return;
    const specifier = stringLiteralValue(node.source);
    if (specifier === null) {
      onUnsupported("C02_GRAPH_UNSUPPORTED_IMPORT", "계산형 dynamic import는 고정된 source graph target으로 수집할 수 없습니다.");
      return;
    }
    if (node.phase) onUnsupported("C02_GRAPH_UNSUPPORTED_IMPORT", `지원하지 않는 dynamic import phase입니다: ${node.phase}`, specifier);
    if (node.options != null || (node.attributes?.length ?? 0) > 0) {
      onUnsupported("C02_GRAPH_UNSUPPORTED_IMPORT", "dynamic import options/attributes는 현재 profile에서 지원하지 않습니다.", specifier);
    }
    result.push({ kind: "dynamic", specifier, offset: node.start ?? 0 });
  });
  return result.sort((left, right) => left.offset - right.offset);
}

export function mapModuleInfoDependencies(occurrences, ids) {
  if (occurrences.length !== ids.length) {
    return {
      status: ids.length > occurrences.length ? "unmatched-id" : "unmatched-occurrence",
      message: `AST occurrence 수(${occurrences.length})와 ModuleInfo ID 수(${ids.length})가 달라 매핑할 수 없습니다.`,
    };
  }
  if (occurrences.length === 0) return { status: "mapped", targetIds: [] };
  const uniqueTargets = new Set(ids.map(canonicalModuleId));
  if (uniqueTargets.size > 1) {
    return {
      status: "ambiguous",
      message: "같은 referrer/kind에 서로 다른 specifier와 ModuleInfo target이 여러 개 있어 비보장 배열 순서로 연결하지 않았습니다.",
    };
  }
  return { status: "mapped", targetIds: occurrences.map(() => ids[0]) };
}

export function compareModuleInfoIds(record, current, diagnostics) {
  for (const [kind, recorded, now] of [
    ["static", record.staticIds, current.importedIds ?? []],
    ["dynamic", record.dynamicIds, current.dynamicallyImportedIds ?? []],
  ]) {
    if (recorded.length === now.length && recorded.every((id, index) => canonicalModuleId(id) === canonicalModuleId(now[index]))) continue;
    addDiagnostic(diagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "source", `buildEnd에서 관찰한 ${kind} ModuleInfo ID 목록이 moduleParsed 시점과 다릅니다. 관찰 ID 수=${now.length}.`, {
      referrerModuleKey: record.key,
      specifier: null,
    });
  }
}

function summarizePlannedViteConfig(config) {
  return {
    root: path.resolve(config.root),
    mode: config.mode,
    base: config.base,
    resolveConditions: [...(config.resolve?.conditions ?? [])],
    aliases: normalizeAliases(config.resolve?.alias ?? []),
    build: {
      write: config.build?.write,
      outDir: config.build?.outDir ? path.resolve(config.build.outDir) : null,
      emptyOutDir: config.build?.emptyOutDir,
      target: config.build?.target,
      minify: config.build?.minify,
      cssCodeSplit: config.build?.cssCodeSplit,
      assetsInlineLimit: config.build?.assetsInlineLimit,
      sourcemap: config.build?.sourcemap,
      modulePreload: stableConfigValue(config.build?.modulePreload),
      rollupOptions: stableConfigValue(config.build?.rollupOptions ?? {}),
    },
    plugins: (config.plugins ?? []).map(profilePluginDescriptor),
  };
}

function summarizeResolvedViteConfig(config) {
  const outputOption = config.build.rollupOptions.output;
  const outputOptions = (Array.isArray(outputOption) ? outputOption : outputOption ? [outputOption] : [])
    .map((output) => stableConfigValue(output));
  return {
    root: path.resolve(config.root),
    mode: config.mode,
    command: config.command,
    configFile: config.configFile ?? null,
    base: config.base,
    resolve: {
      conditions: [...config.resolve.conditions],
      aliases: normalizeAliases(config.resolve.alias),
      externalConditions: stableConfigValue(config.resolve.externalConditions),
      extensions: stableConfigValue(config.resolve.extensions),
      mainFields: stableConfigValue(config.resolve.mainFields),
      dedupe: stableConfigValue(config.resolve.dedupe),
      noExternal: stableConfigValue(config.resolve.noExternal),
      external: stableConfigValue(config.resolve.external),
      preserveSymlinks: stableConfigValue(config.resolve.preserveSymlinks),
      tsconfigPaths: stableConfigValue(config.resolve.tsconfigPaths),
      builtins: stableConfigValue(config.resolve.builtins),
    },
    define: stableConfigValue(config.define ?? {}),
    environment: {
      envDir: canonicalFilesystemPath(path.resolve(config.envDir)),
      envPrefix: stableConfigValue(config.envPrefix),
      keepProcessEnv: stableConfigValue(config.keepProcessEnv),
    },
    css: stableConfigValue(config.css),
    build: {
      write: config.build.write,
      outDir: path.resolve(config.build.outDir),
      assetsDir: config.build.assetsDir,
      emptyOutDir: config.build.emptyOutDir,
      target: stableConfigValue(config.build.target),
      minify: stableConfigValue(config.build.minify),
      cssCodeSplit: config.build.cssCodeSplit,
      cssMinify: stableConfigValue(config.build.cssMinify),
      assetsInlineLimit: config.build.assetsInlineLimit,
      sourcemap: stableConfigValue(config.build.sourcemap),
      modulePreload: stableConfigValue(config.build.modulePreload),
      polyfillModulePreload: stableConfigValue(config.build.polyfillModulePreload),
      lib: stableConfigValue(config.build.lib),
      ssr: stableConfigValue(config.build.ssr),
      ssrEmitAssets: stableConfigValue(config.build.ssrEmitAssets),
      emitAssets: stableConfigValue(config.build.emitAssets),
      copyPublicDir: stableConfigValue(config.build.copyPublicDir),
      reportCompressedSize: stableConfigValue(config.build.reportCompressedSize),
      manifest: stableConfigValue(config.build.manifest),
      ssrManifest: stableConfigValue(config.build.ssrManifest),
      watch: stableConfigValue(config.build.watch),
      commonjsOptions: stableConfigValue(config.build.commonjsOptions),
      cssTarget: stableConfigValue(config.build.cssTarget),
      rollupOptions: stableConfigValue(config.build.rollupOptions ?? {}),
      rolldownOptions: stableConfigValue(config.build.rolldownOptions ?? {}),
      outputOptions,
    },
    plugins: config.plugins.map(profilePluginDescriptor),
  };
}

function validateResolvedViteConfig(config, expected, fixtureRoot, outputProfile, diagnostics) {
  const fail = (message) => addDiagnostic(diagnostics, "C02_GRAPH_CAPTURE_INCOMPLETE", "config", message);
  if (!expected) {
    fail("Vite configResolved 전에 기대 설정을 고정하지 않았습니다.");
    return;
  }

  const checks = [
    [path.resolve(config.root) === path.resolve(fixtureRoot), "configResolved root가 fixture root와 다릅니다."],
    [config.command === "build", "configResolved command가 build가 아닙니다."],
    [config.mode === expected.mode && config.mode === "production", "configResolved mode가 profile의 production과 다릅니다."],
    [config.base === expected.base && config.base === "./", "configResolved base가 고정 profile과 다릅니다."],
    [JSON.stringify(config.resolve.conditions) === JSON.stringify(expected.resolveConditions), "configResolved resolver conditions가 계획 설정과 다릅니다."],
    [canonicalFilesystemPath(path.resolve(config.build.outDir)) === canonicalFilesystemPath(expected.build.outDir), "configResolved outDir가 계획 설정과 다릅니다."],
    [config.build.write === true && config.build.write === expected.build.write, "configResolved build.write가 true가 아닙니다."],
    [config.build.emptyOutDir === true && config.build.emptyOutDir === expected.build.emptyOutDir, "configResolved emptyOutDir가 true가 아닙니다."],
    [config.build.target === outputProfile.target && config.build.target === expected.build.target, "configResolved build target이 output profile과 다릅니다."],
    [config.build.minify === outputProfile.minify && config.build.minify === expected.build.minify, "configResolved minify가 output profile과 다릅니다."],
    [config.build.cssCodeSplit === outputProfile.cssCodeSplit && config.build.cssCodeSplit === expected.build.cssCodeSplit, "configResolved cssCodeSplit이 output profile과 다릅니다."],
    [config.build.assetsInlineLimit === 0 && config.build.assetsInlineLimit === expected.build.assetsInlineLimit, "configResolved assetsInlineLimit이 0이 아닙니다."],
    [config.build.sourcemap === false && config.build.sourcemap === expected.build.sourcemap, "configResolved sourcemap이 false가 아닙니다."],
    [stableJson(config.build.modulePreload) === stableJson(expected.build.modulePreload), "configResolved modulePreload가 계획 설정과 다릅니다."],
  ];
  for (const [valid, message] of checks) if (!valid) fail(message);

  const expectedResolveDefaults = {
    externalConditions: ["node", "module-sync"],
    extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
    mainFields: ["browser", "module", "jsnext:main", "jsnext"],
    dedupe: [],
    noExternal: [],
    external: [],
    preserveSymlinks: false,
    tsconfigPaths: false,
    builtins: [],
  };
  for (const [key, expectedValue] of Object.entries(expectedResolveDefaults)) {
    if (stableJson(config.resolve[key]) !== stableJson(expectedValue)) fail(`configResolved resolve.${key}가 pinned profile 기본값과 다릅니다.`);
  }
  if (Object.keys(config.define ?? {}).length > 0) fail("configResolved define은 고정 fixture에서 비어 있어야 합니다.");
  if (canonicalFilesystemPath(path.resolve(config.envDir)) !== canonicalFilesystemPath(fixtureRoot)) fail("configResolved envDir가 fixture root와 다릅니다.");
  if (config.envPrefix !== undefined || config.keepProcessEnv !== undefined) fail("configResolved environment prefix/process env 설정이 pinned profile과 다릅니다.");
  if (stableJson(config.css) !== stableJson({ transformer: "postcss", preprocessorMaxWorkers: true, devSourcemap: false })) {
    fail("configResolved CSS transform 옵션이 pinned fixture profile과 다릅니다.");
  }
  if (config.build.assetsDir !== "assets" || config.build.cssMinify !== false || config.build.polyfillModulePreload !== true
    || config.build.lib !== false || config.build.ssr !== false || config.build.ssrEmitAssets !== false || config.build.emitAssets !== true
    || config.build.copyPublicDir !== true || config.build.manifest !== false || config.build.ssrManifest !== false
    || config.build.watch != null || config.build.cssTarget !== "esnext") {
    fail("configResolved build의 resource/format defaults가 pinned fixture profile과 다릅니다.");
  }

  const actualAliases = normalizeAliases(config.resolve.alias);
  const actualUserAliases = actualAliases.filter((alias) => !isViteBuiltinAlias(alias));
  const actualBuiltinAliases = actualAliases.filter(isViteBuiltinAlias);
  if (stablePathJson(actualUserAliases) !== stablePathJson(expected.aliases)) fail("configResolved 사용자 alias가 계획 설정과 다릅니다.");
  if (actualBuiltinAliases.length !== 2 || !actualBuiltinAliases.some((alias) => stableJson(alias.find) === stableJson({ regexp: "^\\/?@vite\\/env", flags: "" }))
    || !actualBuiltinAliases.some((alias) => stableJson(alias.find) === stableJson({ regexp: "^\\/?@vite\\/client", flags: "" }))) {
    fail("Vite built-in alias 목록이 pinned profile에서 관찰한 값과 다릅니다.");
  }

  const actualBuiltinPluginOrder = config.plugins.filter((plugin) => VITE_BUILTIN_PLUGIN_NAMES.has(plugin.name)).map((plugin) => plugin.name);
  if (stableJson(actualBuiltinPluginOrder) !== stableJson(VITE_BUILTIN_PLUGIN_ORDER)) {
    fail("Vite built-in plugin 이름·순서가 pinned Vite 8.3.1 profile과 다릅니다.");
  }

  const actualRollupOptions = config.build.rollupOptions ?? {};
  const expectedRollupOptions = JSON.parse(JSON.stringify(expected.build.rollupOptions));
  const allowedRollupKeys = new Set([...Object.keys(expectedRollupOptions), "platform"]);
  if (Object.keys(actualRollupOptions).some((key) => !allowedRollupKeys.has(key))) fail("configResolved rollupOptions에 profile 밖 설정이 있습니다.");
  if (actualRollupOptions.platform !== "browser") fail("configResolved Rolldown platform이 browser가 아닙니다.");
  if (stablePathJson(config.build.rolldownOptions ?? {}) !== stablePathJson(actualRollupOptions)) fail("configResolved rollupOptions와 rolldownOptions가 다릅니다.");
  if (stablePathJson(actualRollupOptions.input) !== stablePathJson(expectedRollupOptions.input)) fail("configResolved entry input이 계획 설정과 다릅니다.");
  if (stablePathJson(actualRollupOptions.external ?? null) !== stablePathJson(expectedRollupOptions.external ?? null)) fail("configResolved external 목록이 계획 설정과 다릅니다.");
  const actualOutputs = Array.isArray(actualRollupOptions.output) ? actualRollupOptions.output : [actualRollupOptions.output];
  if (actualOutputs.length !== 1) fail(`output profile은 output 하나를 요구하지만 configResolved에서 ${actualOutputs.length}개를 확인했습니다.`);
  const expectedOutput = expectedRollupOptions.output;
  for (const output of actualOutputs) {
    for (const key of ["format", "entryFileNames", "chunkFileNames", "assetFileNames"]) {
      if (output?.[key] !== expectedOutput?.[key] || output?.[key] !== outputProfile[key]) {
        fail(`configResolved output.${key}가 고정 output profile과 다릅니다.`);
      }
    }
    const allowedOutputKeys = new Set(Object.keys(expectedOutput ?? {}));
    if (Object.keys(output ?? {}).some((key) => !allowedOutputKeys.has(key))) fail("configResolved output에 profile 밖 옵션이 있습니다.");
  }

  const actualCustomPlugins = config.plugins.filter((plugin) => !VITE_BUILTIN_PLUGIN_NAMES.has(plugin.name)).map(profilePluginDescriptor);
  if (actualCustomPlugins.some((plugin) => plugin.options === null)) fail("fixture/plugin 설정이 profile descriptor 없이 추가되어 capture할 수 없습니다.");
  if (stableJson(sortPluginDescriptors(actualCustomPlugins)) !== stableJson(sortPluginDescriptors(expected.plugins))) fail("configResolved fixture/plugin options가 계획 설정과 다릅니다.");
}

function normalizeAliases(aliases) {
  const values = Array.isArray(aliases) ? aliases : Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }));
  return values.map(({ find, replacement }) => ({
    find: typeof find === "string" ? find : find instanceof RegExp ? { regexp: find.source, flags: find.flags } : stableConfigValue(find),
    replacement: path.isAbsolute(String(replacement)) ? canonicalFilesystemPath(String(replacement)) : String(replacement),
  }));
}

function isViteBuiltinAlias(alias) {
  return alias.find?.regexp === "^\\/?@vite\\/env" || alias.find?.regexp === "^\\/?@vite\\/client";
}

function profilePluginDescriptor(plugin) {
  return {
    name: plugin.name ?? "anonymous",
    enforce: plugin.enforce ?? "normal",
    options: plugin.spinonC02ProfileOptions == null ? null : stableConfigValue(plugin.spinonC02ProfileOptions),
  };
}

function stableConfigValue(value, seen = new Set()) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "function") return { function: value.name || "anonymous" };
  if (value instanceof RegExp) return { regexp: value.source, flags: value.flags };
  if (Array.isArray(value)) return value.map((item) => stableConfigValue(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const result = {};
    for (const key of Object.keys(value).sort(compareCodepoint)) result[key] = stableConfigValue(value[key], seen);
    seen.delete(value);
    return result;
  }
  return String(value);
}

function stableJson(value) {
  return JSON.stringify(stableConfigValue(value));
}

function stablePathJson(value) {
  return JSON.stringify(normalizeAbsolutePaths(stableConfigValue(value)));
}

function normalizeAbsolutePaths(value) {
  if (typeof value === "string") return path.isAbsolute(value) ? canonicalFilesystemPath(value) : value;
  if (Array.isArray(value)) return value.map(normalizeAbsolutePaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeAbsolutePaths(child)]));
}

function sortPluginDescriptors(plugins) {
  return [...plugins].sort((left, right) => compareCodepoint(`${left.name}\0${stableJson(left)}`, `${right.name}\0${stableJson(right)}`));
}

function detectSourceTargetConflicts(occurrences, diagnostics) {
  const bySourceRequest = new Map();
  for (const occurrence of occurrences) {
    const key = JSON.stringify([occurrence.referrerModuleKey, occurrence.sourceSpecifier]);
    const target = occurrence.targetResourceKind
      ? `resource:${occurrence.resolvedModuleKey}`
      : occurrence.external ? "external" : `module:${occurrence.resolvedModuleKey}`;
    const targets = bySourceRequest.get(key) ?? new Set();
    targets.add(target);
    bySourceRequest.set(key, targets);
  }
  for (const [key, targets] of bySourceRequest) {
    if (targets.size <= 1) continue;
    const [referrerModuleKey, specifier] = JSON.parse(key);
    addDiagnostic(diagnostics, "C02_GRAPH_TARGET_CONFLICT", "source", "같은 referrer/source specifier의 static·dynamic edge가 다른 target으로 연결됐습니다.", {
      referrerModuleKey,
      specifier,
    });
  }
}

function detectOutputTargetConflicts(chunks, diagnostics) {
  for (const chunk of chunks) {
    const bySpecifier = new Map();
    for (const edge of chunk.dependencies) {
      const targets = bySpecifier.get(edge.specifier) ?? new Set();
      targets.add(edge.chunkId);
      bySpecifier.set(edge.specifier, targets);
    }
    for (const [specifier, targets] of bySpecifier) {
      if (targets.size <= 1) continue;
      addDiagnostic(diagnostics, "C02_GRAPH_TARGET_CONFLICT", "output", "같은 emitted referrer/specifier가 서로 다른 output chunk로 연결됐습니다.", {
        referrerModuleKey: chunk.id,
        specifier,
      });
    }
  }
}

function normalizeRolldownRegionComments(code, fixtureRoot) {
  const comments = [];
  try {
    parseJavaScript(code, { ecmaVersion: "latest", sourceType: "module", onComment: comments });
  } catch {
    return null;
  }
  const replacements = [];
  for (const comment of comments) {
    if (comment.type !== "Line" || !comment.value.startsWith("#region ")) continue;
    const rawPath = comment.value.slice("#region ".length).trim();
    const candidatePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
    const canonical = canonicalFilesystemPath(candidatePath);
    const relativeFixture = toPosix(path.relative(fixtureRoot, canonical));
    let label;
    if (relativeFixture && relativeFixture !== ".." && !relativeFixture.startsWith("../") && !path.posix.isAbsolute(relativeFixture)) {
      label = `fixture/${relativeFixture}`;
    } else if (path.isAbsolute(rawPath)) {
      label = `module/${sha256(canonical).slice(0, 20)}`;
    } else {
      continue;
    }
    replacements.push({ start: comment.start, end: comment.end, text: `//#region ${label}` });
  }
  if (replacements.length === 0) return null;
  let output = code;
  for (const item of replacements.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, item.start)}${item.text}${output.slice(item.end)}`;
  }
  return { code: output, map: null };
}

function resolveOutputAsset(outputs, referrerPath, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (specifier.includes("?") || specifier.includes("#")) return null;
  const resolved = resolveRelativeSpecifier(referrerPath, specifier);
  return outputs.some((item) => item.type === "asset" && item.fileName === resolved);
}

function resolveRelativeSpecifier(referrerPath, specifier) {
  if (specifier.includes("\\") || specifier.includes("\0")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(specifier);
  } catch {
    return null;
  }
  if (/%(?:2f|5c|00)/i.test(specifier)) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(referrerPath), decoded));
  if (resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) return null;
  return resolved;
}

export function isUncapturedJavaScriptOutputAsset(fileName) {
  if (typeof fileName !== "string") return false;
  const pathWithoutSuffix = toPosix(fileName).split(/[?#]/, 1)[0];
  return JAVASCRIPT_OUTPUT_ASSET_EXTENSIONS.has(path.posix.extname(pathWithoutSuffix).toLowerCase());
}

function addDiagnostic(target, code, stage, message, details = {}) {
  const item = {
    severity: "error",
    code,
    stage,
    message,
    source: details.source ?? null,
    referrerModuleKey: details.referrerModuleKey ?? null,
    specifier: details.specifier ?? null,
  };
  if (!target.some((entry) => JSON.stringify(entry) === JSON.stringify(item))) target.push(item);
}

function makeMinimalFailureSnapshot(source, error) {
  const diagnostics = [...(source.diagnostics ?? []), {
    severity: "error",
    code: "C02_GRAPH_CAPTURE_INCOMPLETE",
    stage: "snapshot",
    message: `실패 snapshot 검증도 거부했습니다: ${error.message}`,
    source: null,
    referrerModuleKey: null,
    specifier: null,
  }];
  const fixtureSha256 = source.build?.fixtureSha256 ?? "0".repeat(64);
  const profile = source.build?.profile ?? minimalProfile();
  const build = {
    tool: "vite",
    toolVersion: source.build?.toolVersion ?? "unknown",
    adapterVersion: VITE_MODULE_GRAPH_ADAPTER_VERSION,
    outputProfile: source.build?.outputProfile ?? "vite-esm",
    status: "failed",
    fixtureSha256,
    profile,
    buildProfileSha256: computeBuildProfileSha256(profile),
  };
  const sourceGraph = {
    scope: "javascript-module-dependencies",
    status: "incomplete",
    capture: "vite-moduleParsed-ModuleInfo-importedIds-and-writeBundle-bytes",
    moduleCount: 0,
    edgeCount: 0,
    excludedDependencyCount: 0,
    sha256: "0".repeat(64),
    modules: [],
    dependencies: [],
    excludedDependencies: [],
  };
  sourceGraph.sha256 = computeSourceGraphSha256(sourceGraph);
  try {
    return createModuleGraphSnapshot({
      contract: VITE_MODULE_GRAPH_CONTRACT,
      build,
      sourceGraph,
      features: [],
      outputGraph: emptyOutputGraph(),
      diagnostics,
    });
  } catch {
    throw new Error(`실패 snapshot 최소 스키마 생성에 실패했습니다: ${error.message}`);
  }
}

function minimalProfile() {
  return { configSources: [{ path: "spikes/css-bundler/vite-module-graph-adapter.mjs", sha256: "0".repeat(64) }], effectiveOptions: { profile: "unknown" } };
}

function emptyOutputGraph() {
  return { status: "incomplete", moduleFormat: "unknown", resources: [], chunks: [] };
}

function stringLiteralValue(node) {
  if (!node) return null;
  if ((node.type === "Literal" || node.type === "StringLiteral") && typeof node.value === "string") return node.value;
  return null;
}

function walkAst(value, visit) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) walkAst(child, visit);
    return;
  }
  if (typeof value.type === "string") visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (["loc", "range", "start", "end", "parent", "comments", "leadingComments", "trailingComments"].includes(key)) continue;
    walkAst(child, visit);
  }
}

export function classifyViteResource(id, info = {}, fixtureRoot) {
  const { pathname, queryKeys } = splitModuleId(id);
  const extension = path.extname(pathname).toLowerCase();
  const moduleType = info?.moduleType ?? null;
  const meta = info?.meta ?? {};
  const inlineText = queryKeys.has("inline") || queryKeys.has("raw");
  if (extension === ".wasm" || moduleType === "wasm") {
    return { status: "unsupported", message: "WASM module/resource는 C02.2 JavaScript graph 또는 0011 resource kind에 포함되지 않아 지원하지 않습니다." };
  }
  if (inlineText && (STYLE_EXTENSIONS.has(extension) || ASSET_EXTENSIONS.has(extension))
    && (!moduleType || JAVA_SCRIPT_MODULE_TYPES.has(moduleType))) {
    return { status: "none" };
  }
  if (STYLE_EXTENSIONS.has(extension)) {
    if (inlineText) return { status: "unsupported", message: `CSS inline/raw query와 Vite moduleType이 일치하지 않습니다: ${moduleType ?? "unknown"}` };
    if (queryKeys.size > 0 && [...queryKeys].some((key) => !["url", "import"].includes(key))) {
      return { status: "unsupported", message: `CSS query 조합을 0011 자원 key로 연결할 수 없습니다: ${[...queryKeys].join("&")}` };
    }
    if (moduleType && !STYLE_MODULE_TYPES.has(moduleType) && !JAVA_SCRIPT_MODULE_TYPES.has(moduleType) && moduleType !== "asset") {
      return { status: "unsupported", message: `지원하지 않는 CSS moduleType입니다: ${moduleType}` };
    }
    return makeResourceClassification("stylesheet", id, fixtureRoot);
  }

  if (ASSET_EXTENSIONS.has(extension) && queryKeys.size > 0) {
    if (queryKeys.size === 1 && queryKeys.has("component") && JAVA_SCRIPT_MODULE_TYPES.has(moduleType) && meta["vite:asset"] !== true) {
      return { status: "none" };
    }
    if (queryKeys.size === 1 && queryKeys.has("url") && (meta["vite:asset"] === true || moduleType === "asset")) {
      return makeResourceClassification("asset", id, fixtureRoot);
    }
    return { status: "unsupported", message: `asset query를 0011 canonical resource key에 연결할 수 없습니다: ${[...queryKeys].join("&")}` };
  }

  if (STYLE_MODULE_TYPES.has(moduleType)) return makeResourceClassification("stylesheet", id, fixtureRoot);
  if (meta["vite:asset"] === true || moduleType === "asset") return makeResourceClassification("asset", id, fixtureRoot);
  if (moduleType && JAVA_SCRIPT_MODULE_TYPES.has(moduleType)) return { status: "none" };
  if (moduleType && !JAVA_SCRIPT_MODULE_TYPES.has(moduleType)) {
    return { status: "unsupported", message: `지원하지 않는 Vite moduleType입니다: ${moduleType}` };
  }
  if (inlineText) return { status: "none" };
  if (ASSET_EXTENSIONS.has(extension)) {
    return makeResourceClassification("asset", id, fixtureRoot);
  }
  return { status: "none" };
}

function makeResourceClassification(kind, id, fixtureRoot) {
  const key = canonicalFixtureResourceKey(id, fixtureRoot);
  if (key === null) {
    return { status: "unsupported", message: "CSS/asset dependency의 canonical fixture resource key를 증명할 수 없습니다." };
  }
  return { status: "resource", kind, key };
}

function isKnownBundlerInjectedModule(id) {
  return KNOWN_INJECTED_IDS.has(String(id));
}

function generatedSpecifierForId(id) {
  const value = String(id);
  if (value === "\0vite/preload-helper.js") return "virtual:vite/preload-helper.js";
  if (value === "\0rolldown/runtime.js") return "virtual:rolldown/runtime.js";
  return `virtual:generated-${sha256(value).slice(0, 16)}`;
}

function languageForId(id) {
  const extension = path.extname(normalizeId(String(id)).split("?")[0]).toLowerCase();
  if (extension === ".jsx") return "jsx";
  if (extension === ".tsx") return "tsx";
  return "js";
}

async function readOutputBytesWithoutSymlinks(outputDirectory, outputPath) {
  if (!outputDirectory || typeof outputPath !== "string" || path.posix.isAbsolute(outputPath)
    || outputPath.includes("\\") || outputPath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("정규 output 상대 경로가 아닙니다.");
  }
  const rootStat = await lstat(outputDirectory);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("output root가 실제 디렉터리가 아닙니다.");
  const rootRealPath = await realpath(outputDirectory);
  let current = outputDirectory;
  const segments = outputPath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`output 경로에 symlink가 있습니다: ${segments.slice(0, index + 1).join("/")}`);
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error("output 경로 구성 요소가 디렉터리가 아닙니다.");
    if (index === segments.length - 1 && !stat.isFile()) throw new Error("output resource가 regular file이 아닙니다.");
    const canonicalPath = await realpath(current);
    const relative = path.relative(rootRealPath, canonicalPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("realpath가 output root 밖으로 벗어났습니다.");
    }
  }
  if (typeof constants.O_NOFOLLOW !== "number") throw new Error("현재 플랫폼에서 O_NOFOLLOW를 제공하지 않습니다.");
  const handle = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw new Error("열린 output resource가 regular file이 아닙니다.");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function canonicalModuleId(id) {
  const normalized = normalizeId(String(id));
  if (normalized.startsWith("\0") || !path.isAbsolute(normalized)) return normalized;
  const queryAt = normalized.search(/[?#]/);
  const pathname = queryAt === -1 ? normalized : normalized.slice(0, queryAt);
  const suffix = queryAt === -1 ? "" : normalized.slice(queryAt);
  return `${canonicalFilesystemPath(path.resolve(pathname))}${suffix}`;
}

function canonicalFilesystemPath(value) {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function normalizeId(value) {
  return String(value).replaceAll("\\", "/");
}

function toPosix(value) {
  return String(value).replaceAll("\\", "/");
}

function uniqueCodepointSorted(values) {
  return [...new Set(values)].sort(compareCodepoint);
}

function sortDiagnostics(values) {
  return [...values].sort((left, right) => compareCodepoint(JSON.stringify(left), JSON.stringify(right)));
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
