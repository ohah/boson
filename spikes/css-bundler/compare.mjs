import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";
import { build } from "vite";
import rspackConfig from "./rspack.config.mjs";
import viteConfig from "./vite.config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixture");
const outputRoot = path.join(here, ".output");
const viteOutput = path.join(outputRoot, "vite");
const rspackOutput = path.join(outputRoot, "rspack");
const evidencePath = path.resolve(here, "../../spec/internal/evidence/css-c02-bundler-2026-10-01.json");

await rm(outputRoot, { recursive: true, force: true });
await build(structuredClone(viteConfig));
const rspackResult = await runRspack(structuredClone(rspackConfig));
if (rspackResult.errors.length > 0) {
  throw new Error(`Rspack 빌드 실패:\n${JSON.stringify(rspackResult.errors, null, 2)}`);
}

const viteManifest = JSON.parse(await readFile(path.join(viteOutput, ".vite", "manifest.json"), "utf8"));
const viteEntry = requireManifestEntry(viteManifest, (entry) => entry.isEntry);
const viteDynamic = requireManifestEntry(viteManifest, (entry) => entry.isDynamicEntry);
const viteEntryCss = viteEntry.css ?? [];
const viteDynamicCss = viteDynamic.css ?? [];

const rspackStats = rspackResult.stats;
const rspackChunks = rspackStats.chunks ?? [];
const rspackEntry = requireRspackChunk(rspackChunks, "main");
const rspackDynamic = requireRspackChunk(rspackChunks, "feature");
const rspackEntryCss = rspackEntry.files.filter((file) => file.endsWith(".css"));
const rspackDynamicCss = rspackDynamic.files.filter((file) => file.endsWith(".css"));

const viteEntryText = await readAssets(viteOutput, viteEntryCss);
const viteDynamicText = await readAssets(viteOutput, viteDynamicCss);
const rspackEntryText = await readAssets(rspackOutput, rspackEntryCss);
const rspackDynamicText = await readAssets(rspackOutput, rspackDynamicCss);
const viteMainJs = await readAssets(viteOutput, [viteEntry.file]);
const rspackMainJs = await readAssets(rspackOutput, rspackEntry.files.filter((file) => file.endsWith(".js")));

const viteModules = inspectCssModules(viteEntryText, viteMainJs);
const rspackModules = inspectCssModules(rspackEntryText, rspackMainJs);
const cssModuleDefaultImport = await compareCssModuleDefaultImport();
const viteLocalUrls = await inspectCssUrls(viteOutput, viteEntryCss.concat(viteDynamicCss));
const rspackLocalUrls = await inspectCssUrls(rspackOutput, rspackEntryCss.concat(rspackDynamicCss));
const viteSourceMaps = await inspectSourceMaps(viteOutput);
const rspackSourceMaps = await inspectSourceMaps(rspackOutput);
const viteCssMapReferences = await inspectCssMapReferences(viteOutput);
const rspackCssMapReferences = await inspectCssMapReferences(rspackOutput);
const viteDiagnostic = await captureViteDiagnostic();
const rspackDiagnostic = await captureRspackDiagnostic();

const inputFiles = await inventory(fixture);
const viteFiles = await inventory(viteOutput);
const rspackFiles = await inventory(rspackOutput);
const rspackSourceModules = (rspackStats.modules ?? [])
  .filter((module) => String(module.moduleType ?? "").startsWith("css/") || String(module.identifier ?? "").startsWith("external css-import"))
  .map((module) => ({ type: module.moduleType ?? "external", name: module.name, issuer: module.issuerName ?? null }));
const sourceLocation = {
  viteCssMaps: viteSourceMaps.filter((map) => map.kind === "css"),
  rspackCssMaps: rspackSourceMaps.filter((map) => map.kind === "css"),
  viteCssMapReferences,
  rspackCssMapReferences,
  viteMissingAssetDiagnostic: viteDiagnostic,
  rspackMissingAssetDiagnostic: rspackDiagnostic,
};
const checks = [
  check("M1", "두 production 빌드가 동일 입력 fixture에서 산출물을 만든다", viteFiles.length > 0 && rspackFiles.length > 0, {
    inputFileCount: inputFiles.length,
    viteOutputCount: viteFiles.length,
    rspackOutputCount: rspackFiles.length,
  }),
  check("M2", "CSS Module의 card·featured named export가 CSS와 JS 산출물에 연결된다", moduleCheck(viteModules) && moduleCheck(rspackModules), {
    vite: viteModules,
    rspack: rspackModules,
  }),
  check("M2a", "CSS Module default import 기본값과 Rspack 호환 설정 차이를 기록한다", cssModuleDefaultImport.vite.buildRejected === false && cssModuleDefaultImport.rspackDefault.buildRejected === true && cssModuleDefaultImport.rspackCompatible.buildRejected === false, cssModuleDefaultImport),
  check("M3", "로컬 @import 내용은 포함되고 외부 @import는 외부 참조로 남는다", importedTokenCheck(viteEntryText) && importedTokenCheck(rspackEntryText) && externalImportCheck(viteEntryText) && externalImportCheck(rspackEntryText), {
    vite: { localImportApplied: importedTokenCheck(viteEntryText), externalImport: externalImportCheck(viteEntryText) },
    rspack: { localImportApplied: importedTokenCheck(rspackEntryText), externalImport: externalImportCheck(rspackEntryText) },
  }),
  check("M4", "CSS의 로컬 SVG·WOFF2 URL이 별도 산출 자원을 가리킨다", localAssetCheck(viteLocalUrls) && localAssetCheck(rspackLocalUrls), {
    vite: viteLocalUrls,
    rspack: rspackLocalUrls,
  }),
  check("M5", "entry와 동적 기능 CSS가 구분된 출력 청크에 연결된다", viteEntryCss.length > 0 && viteDynamicCss.length > 0 && rspackEntryCss.length > 0 && rspackDynamicCss.length > 0 && featureStyleCheck(viteEntryText, viteDynamicText) && featureStyleCheck(rspackEntryText, rspackDynamicText), {
    vite: {
      entryCss: viteEntryCss,
      dynamicCss: viteDynamicCss,
      sharedStyleOccurrences: { entry: countOccurrences(viteEntryText, '--shared-marker:"shared"'), dynamic: countOccurrences(viteDynamicText, '--shared-marker:"shared"') },
    },
    rspack: {
      entryCss: rspackEntryCss,
      dynamicCss: rspackDynamicCss,
      sharedStyleOccurrences: { entry: countOccurrences(rspackEntryText, '--shared-marker:"shared"'), dynamic: countOccurrences(rspackDynamicText, '--shared-marker:"shared"') },
    },
  }),
  check("M6", "source map 또는 빌드 진단이 CSS 원본 위치를 가리킨다", sourceLocationCheck(viteSourceMaps, rspackSourceMaps, viteDiagnostic, rspackDiagnostic), sourceLocation),
  check("M7", "외부 URL은 별도 번들 자원으로 내보내지 않고 CSS 참조로 보존한다", externalReferenceCheck(viteEntryText, viteFiles) && externalReferenceCheck(rspackEntryText, rspackFiles), {
    vite: externalReferenceSummary(viteEntryText),
    rspack: externalReferenceSummary(rspackEntryText),
  }),
];

const cssMapGap = sourceLocation.viteCssMaps.length === 0 || sourceLocation.rspackCssMaps.length === 0;
const locationCheckPassed = checks.find((item) => item.id === "M6")?.status === "통과";
const result = {
  model: "C02-M1..M7-v2",
  run: {
    status: checks.filter((item) => ["M1", "M2", "M2a", "M3", "M4", "M5", "M7"].includes(item.id)).every((item) => item.status === "통과") ? "실험 실행 완료" : "하드 조건 실패",
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    versions: {
      vite: await packageVersion("vite"),
      rspack: await packageVersion("@rspack/core"),
    },
    input: inputFiles,
  },
  outputs: {
    vite: {
      entry: { file: viteEntry.file, css: viteEntryCss, dynamicImports: viteEntry.dynamicImports ?? [] },
      dynamicEntry: { file: viteDynamic.file, css: viteDynamicCss, assets: viteDynamic.assets ?? [] },
      graphEvidence: {
        manifestKeys: Object.keys(viteManifest).sort(),
        cssSourceKeys: Object.keys(viteManifest).filter((key) => key.endsWith(".css")).sort(),
      },
      assets: viteFiles,
      cssModules: viteModules,
      defaultImportCompatibility: cssModuleDefaultImport,
      cssUrls: viteLocalUrls,
      sourceMaps: viteSourceMaps,
    },
    rspack: {
      entry: { name: rspackEntry.names, files: rspackEntry.files },
      dynamicEntry: { name: rspackDynamic.names, files: rspackDynamic.files },
      graphEvidence: { sourceModules: rspackSourceModules },
      assets: rspackFiles,
      cssModules: rspackModules,
      defaultImportCompatibility: cssModuleDefaultImport,
      cssUrls: rspackLocalUrls,
      sourceMaps: rspackSourceMaps,
    },
  },
  checks,
  sourceLocation: {
    ...sourceLocation,
    status: cssMapGap
      ? locationCheckPassed ? "CSS source map 유무 차이 · 두 도구 모두 누락 자원의 원본 진단 위치 제공" : "차이 확인 · 원본 위치 보강 필요"
      : "두 도구 모두 산출 CSS source map 존재 · 진단 위치 정밀도 별도 확인",
  },
  scope: {
    productApi: false,
    mobileCssRuntime: false,
    otaManifestIntegration: false,
    browserRendering: false,
    validFontDecode: false,
    externalNetworkFetch: false,
    c02Complete: false,
  },
};

await writeFile(path.join(outputRoot, "comparison.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  run: result.run,
  checks: result.checks.map(({ id, status, condition }) => ({ id, status, condition })),
  sourceLocation: result.sourceLocation,
  scope: result.scope,
}, null, 2));

if (result.run.status !== "실험 실행 완료") process.exitCode = 1;

async function runRspack(config) {
  return new Promise((resolve, reject) => {
    const compiler = rspack(config);
    compiler.run((error, stats) => {
      if (error) {
        compiler.close(() => reject(error));
        return;
      }
      if (!stats) {
        compiler.close(() => reject(new Error("Rspack이 통계를 반환하지 않았습니다.")));
        return;
      }
      const json = stats.toJson(config.stats);
      compiler.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve({ stats: json, errors: json.errors ?? [] });
      });
    });
  });
}

function requireManifestEntry(manifest, predicate) {
  const entry = Object.values(manifest).find(predicate);
  if (!entry) throw new Error("Vite manifest에 요구한 entry가 없습니다.");
  return entry;
}

function requireRspackChunk(chunks, name) {
  const chunk = chunks.find((item) => (item.names ?? []).includes(name));
  if (!chunk) throw new Error(`Rspack 출력에 ${name} chunk가 없습니다.`);
  return chunk;
}

async function readAssets(directory, names) {
  const parts = [];
  for (const name of names) parts.push(await readFile(path.join(directory, name), "utf8"));
  return parts.join("\n");
}

function inspectCssModules(css, js) {
  const cardRule = findCssRule(css, (body) => body.includes("border-color:var(--brand-color)") && body.includes("module"));
  const featuredRule = findCssRule(css, (body) => body.includes("color:var(--brand-color)") && !body.includes("border-color"));
  const card = cardRule ? extractClassName(cardRule.selector) : null;
  const featured = featuredRule ? extractClassName(featuredRule.selector) : null;
  return {
    localKeys: ["card", "featured"],
    classes: { card, featured },
    jsReferences: { card: card ? js.includes(card) : false, featured: featured ? js.includes(featured) : false },
  };
}

function findCssRule(css, predicate) {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of css.matchAll(rulePattern)) {
    const selector = match[1].trim();
    const body = match[2].replace(/\s+/g, "");
    if (!selector.startsWith("@") && predicate(body)) return { selector, body };
  }
  return null;
}

function extractClassName(selector) {
  return selector.match(/\.([_A-Za-z][\w-]*)/)?.[1] ?? null;
}

function moduleCheck(modules) {
  return modules.localKeys.join(",") === "card,featured" && Boolean(modules.classes.card) && Boolean(modules.classes.featured) && modules.jsReferences.card && modules.jsReferences.featured;
}

function countOccurrences(value, token) {
  return value.split(token).length - 1;
}

function importedTokenCheck(css) {
  return css.includes("tokens-imported") && css.includes("brand-color");
}

function externalImportCheck(css) {
  return css.includes("https://styles.example.invalid/external.css");
}

async function inspectCssUrls(directory, cssFiles) {
  const outputFiles = new Set(await listFiles(directory));
  const urls = [];
  for (const cssFile of cssFiles) {
    const css = await readFile(path.join(directory, cssFile), "utf8");
    for (const match of css.matchAll(/@import\s*(?:url\(\s*)?["']([^"']+)["'](?:\s*\))?/g)) {
      const value = match[1].trim();
      urls.push({ css: cssFile, value, kind: /^(?:https?:|\/\/)/i.test(value) ? "external-css-import" : "local-css-import" });
    }
    const cssWithoutImports = css.replace(/@import[^;]*;/g, "");
    for (const match of cssWithoutImports.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const value = match[1].trim();
      if (/^(?:data:|https?:|\/\/)/i.test(value)) {
        urls.push({ css: cssFile, value, kind: "external" });
        continue;
      }
      const resolved = value.startsWith("/")
        ? path.posix.normalize(value.slice(1))
        : path.posix.normalize(path.posix.join(path.posix.dirname(cssFile), value.replace(/^\.\//, "")));
      const exists = outputFiles.has(resolved);
      const outputHash = exists ? sha256(await readFile(path.join(directory, resolved))) : null;
      const source = ["assets/feature.svg", "assets/fixture.woff2", "assets/module.svg", "assets/pattern.svg"]
        .find((candidate) => path.posix.basename(resolved).startsWith(`${path.posix.basename(candidate, path.posix.extname(candidate))}-`));
      const sourceHash = source ? sha256(await readFile(path.join(fixture, source))) : null;
      urls.push({ css: cssFile, value, file: resolved, source, exists, sha256: outputHash, matchesInput: Boolean(sourceHash && sourceHash === outputHash), kind: /\.woff2?$/i.test(resolved) ? "font" : "image" });
    }
  }
  return urls;
}

function localAssetCheck(urls) {
  const local = urls.filter((url) => url.kind === "font" || url.kind === "image");
  return local.length >= 4 && local.every((url) => url.exists && url.matchesInput) && local.some((url) => url.kind === "font") && local.filter((url) => url.kind === "image").length >= 3;
}

function featureStyleCheck(entryCss, dynamicCss) {
  return !entryCss.includes("lazy-feature") && dynamicCss.includes("lazy-feature") && /feature-[^"')]+\.svg/.test(dynamicCss);
}

function externalReferenceCheck(css, files) {
  const paths = files.map((item) => item.file);
  return css.includes("https://styles.example.invalid/external.css") && css.includes("https://assets.example.invalid/external.svg") && !paths.some((file) => /external\.(?:css|svg)$/i.test(file));
}

function externalReferenceSummary(css) {
  return {
    cssImportPreserved: css.includes("https://styles.example.invalid/external.css"),
    urlPreserved: css.includes("https://assets.example.invalid/external.svg"),
  };
}

async function inventory(directory) {
  const files = await listFiles(directory);
  const result = [];
  for (const file of files) {
    const bytes = await readFile(path.join(directory, file));
    result.push({ file, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return result;
}

async function listFiles(directory, prefix = "") {
  const items = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const item of items) {
    const relative = path.posix.join(prefix, item.name);
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await listFiles(absolute, relative));
    else files.push(relative);
  }
  return files.sort();
}

async function inspectSourceMaps(directory) {
  const maps = [];
  for (const file of await listFiles(directory)) {
    if (!file.endsWith(".map")) continue;
    const kind = file.endsWith(".css.map") ? "css" : file.endsWith(".js.map") ? "js" : "other";
    const parsed = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    maps.push({ file, kind, sources: (parsed.sources ?? []).map((source) => source.replaceAll(fixture, "<fixture>")) });
  }
  return maps;
}

async function inspectCssMapReferences(directory) {
  const references = [];
  for (const file of (await listFiles(directory)).filter((name) => name.endsWith(".css"))) {
    const css = await readFile(path.join(directory, file), "utf8");
    const reference = css.match(/sourceMappingURL=([^\s*]+)/)?.[1] ?? null;
    references.push({ file, sourceMappingUrl: reference });
  }
  return references;
}

async function captureViteDiagnostic() {
  const stderr = [];
  const config = {
    ...viteConfig,
    logLevel: "warn",
    build: {
      ...viteConfig.build,
      outDir: path.join(outputRoot, "vite-diagnostic"),
      manifest: false,
      rollupOptions: { input: path.join(fixture, "diagnostics.html") },
    },
  };
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = function (chunk, encoding, callback) {
    stderr.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  };
  try {
    await build(config);
    const cssFiles = (await listFiles(config.build.outDir)).filter((file) => file.endsWith(".css"));
    const outputCss = await readAssets(config.build.outDir, cssFiles);
    const warningText = stripAnsi(stderr.join("\n")).replaceAll(fixture, "<fixture>");
    const lineColumn = parseSourceLocation(warningText);
    return {
      buildRejected: false,
      reportsSource: warningText.includes("broken.css"),
      reportsMissingResource: warningText.includes("missing.svg"),
      keepsMissingReference: outputCss.includes("missing.svg"),
      line: lineColumn.line,
      column: lineColumn.column,
      warnings: warningText.split("\n").filter(Boolean).map((warning) => warning.slice(0, 1000)),
    };
  } catch (error) {
    const message = String(error.message ?? error).replaceAll(fixture, "<fixture>");
    const lineColumn = error.loc ?? parseSourceLocation(message);
    return {
      buildRejected: true,
      reportsSource: message.includes("broken.css"),
      reportsMissingResource: message.includes("missing.svg"),
      keepsMissingReference: false,
      line: lineColumn.line ?? null,
      column: lineColumn.column ?? null,
      warnings: stripAnsi(stderr.join("\n")).replaceAll(fixture, "<fixture>").split("\n").filter(Boolean).map((warning) => warning.slice(0, 1000)),
      excerpt: message.slice(0, 1200),
    };
  } finally {
    process.stderr.write = originalStderrWrite;
  }
}

async function captureRspackDiagnostic() {
  const config = {
    ...structuredClone(rspackConfig),
    entry: { diagnostic: "./src/diagnostics.js" },
    output: { ...rspackConfig.output, path: path.join(outputRoot, "rspack-diagnostic"), clean: true },
  };
  const { errors } = await runRspack(config);
  const first = errors[0];
  const message = String(first?.message ?? "").replaceAll(fixture, "<fixture>");
  const location = first?.loc ?? {};
  const sourceFile = String(first?.moduleName ?? "").replaceAll(fixture, "<fixture>");
  return {
    buildRejected: errors.length > 0,
    reportsSource: message.includes("broken.css") || sourceFile.includes("broken.css"),
    reportsMissingResource: message.includes("missing.svg"),
    sourceFile: sourceFile || null,
    line: location.start?.line ?? location.line ?? parseSourceLocation(message).line,
    column: location.start?.column ?? location.column ?? parseSourceLocation(message).column,
    excerpt: message.slice(0, 1200),
  };
}

async function compareCssModuleDefaultImport() {
  const viteConfigForDefault = {
    ...structuredClone(viteConfig),
    build: {
      ...structuredClone(viteConfig.build),
      outDir: path.join(outputRoot, "vite-css-module-default"),
      manifest: false,
      rollupOptions: { input: path.join(fixture, "module-default.html") },
    },
  };
  let viteBuildRejected = false;
  let viteError = null;
  try {
    await build(viteConfigForDefault);
  } catch (error) {
    viteBuildRejected = true;
    viteError = String(error.message ?? error).replaceAll(fixture, "<fixture>").slice(0, 1000);
  }

  const rspackBase = structuredClone(rspackConfig);
  const baseResult = await runRspack({
    ...rspackBase,
    entry: { moduleDefault: "./src/module-default.js" },
    output: { ...rspackBase.output, path: path.join(outputRoot, "rspack-css-module-default"), clean: true },
  });
  const rspackCompat = structuredClone(rspackConfig);
  const compatibleResult = await runRspack({
    ...rspackCompat,
    entry: { moduleDefault: "./src/module-default.js" },
    output: { ...rspackCompat.output, path: path.join(outputRoot, "rspack-css-module-default-compatible"), clean: true },
    module: {
      ...rspackCompat.module,
      parser: {
        ...rspackCompat.module.parser,
        "css/auto": { namedExports: false },
      },
    },
  });

  return {
    vite: { buildRejected: viteBuildRejected, error: viteError },
    rspackDefault: {
      buildRejected: baseResult.errors.length > 0,
      errors: baseResult.errors.map((error) => String(error.message ?? error).replaceAll(fixture, "<fixture>").slice(0, 1000)),
    },
    rspackCompatible: {
      buildRejected: compatibleResult.errors.length > 0,
      errors: compatibleResult.errors.map((error) => String(error.message ?? error).replaceAll(fixture, "<fixture>").slice(0, 1000)),
      parser: { "css/auto": { namedExports: false } },
    },
  };
}

function check(id, condition, passed, details) {
  return { id, condition, status: passed ? "통과" : id === "M6" ? "원본 위치 공백" : "관찰 차이", details };
}

function sourceLocationCheck(viteMaps, rspackMaps, viteDiagnostic, rspackDiagnostic) {
  const viteHasCssSource = viteMaps.some((map) => map.kind === "css" && map.sources.some((source) => source.includes("base.css")));
  const rspackHasCssSource = rspackMaps.some((map) => map.kind === "css" && map.sources.some((source) => source.includes("base.css")));
  const viteReportsMissing = viteDiagnostic.reportsSource && viteDiagnostic.reportsMissingResource && viteDiagnostic.line !== null;
  const rspackReportsMissing = rspackDiagnostic.reportsSource && rspackDiagnostic.reportsMissingResource && rspackDiagnostic.line !== null;
  return (viteHasCssSource || viteReportsMissing) && (rspackHasCssSource || rspackReportsMissing);
}

function parseSourceLocation(text) {
  const match = text.match(/\[(\d+):(\d+)\]/);
  if (!match) return { line: null, column: null };
  return { line: Number(match[1]), column: Number(match[2]) };
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

async function packageVersion(name) {
  const packageJsonPath = path.join(here, "node_modules", ...name.split("/"), "package.json");
  return JSON.parse(await readFile(packageJsonPath, "utf8")).version;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
