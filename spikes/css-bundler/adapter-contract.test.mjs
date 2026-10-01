import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertAdapterSnapshot, createAdapterSnapshot } from "./adapter-contract.mjs";
import { inspectCssSource, sourceLocationAt } from "./css-source.mjs";
import { resourceKindFromOutput, sourcePathFromId } from "./adapter-support.mjs";
import { createViteSnapshot } from "./vite-resource-adapter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixture");

test("CSS @import·url()·미해결 진단이 원본 위치를 보존한다", async () => {
  const sourcePath = "src/styles/base.css";
  const code = await readFile(path.join(fixtureRoot, sourcePath), "utf8");
  const result = inspectCssSource({ code, sourcePath, rootDir: fixtureRoot });

  assert.deepEqual(result.imports[0], {
    specifier: "./tokens.css",
    classification: "local",
    targetSourcePath: "src/styles/tokens.css",
    conditions: null,
    source: { file: sourcePath, line: 1, column: 9 },
  });
  assert.ok(result.references.every((reference) => reference.source.file === sourcePath && reference.source.line > 0 && reference.source.column > 0));

  const missingPath = "src/diagnostics/broken.css";
  const missingCode = await readFile(path.join(fixtureRoot, missingPath), "utf8");
  const missing = inspectCssSource({ code: missingCode, sourcePath: missingPath, rootDir: fixtureRoot });
  assert.deepEqual(missing.diagnostics[0], {
    severity: "error",
    code: "CSS_RESOURCE_NOT_FOUND",
    message: "CSS 로컬 자원을 찾을 수 없습니다: ./missing.svg",
    source: { file: missingPath, line: 2, column: 25 },
  });
});

test("@import url()의 닫는 괄호를 조건 문자열에 포함하지 않는다", () => {
  const code = [
    '@import url("./tokens.css");',
    '@import url("./tokens.css") layer(theme) supports(display: grid) screen and (min-width: 1px);',
  ].join("\n");
  const result = inspectCssSource({ code, sourcePath: "src/styles/base.css", rootDir: fixtureRoot });

  assert.deepEqual(result.imports.map((edge) => edge.conditions), [
    null,
    "layer(theme) supports(display: grid) screen and (min-width: 1px)",
  ]);
});

test("선언 값이 속성명과 겹쳐도 url() 위치를 원본 기준으로 계산한다", () => {
  const code = '.x { --background: --background url("./missing.svg"); }';
  const result = inspectCssSource({ code, sourcePath: "src/styles/base.css", rootDir: fixtureRoot });
  const expected = sourceLocationAt(code, code.indexOf('"./missing.svg"'));

  assert.deepEqual(result.references[0].source, { file: "src/styles/base.css", ...expected });
});

test("CRLF·CR·form-feed 줄바꿈에서도 CSS 원본 위치를 보존한다", () => {
  for (const lineBreak of ["\r\n", "\r", "\f"]) {
    const code = `.first {}${lineBreak}.second { background: url("./missing.svg"); }`;
    const result = inspectCssSource({ code, sourcePath: "src/styles/base.css", rootDir: fixtureRoot });
    const expected = sourceLocationAt(code, code.indexOf('"./missing.svg"'));

    assert.deepEqual(result.references[0].source, { file: "src/styles/base.css", ...expected });
    assert.equal(result.references[0].source.line, 2);
  }
});

test("외부·data·fragment·동적 URL을 누락 파일과 구분한다", () => {
  const sourcePath = "src/features/feature.css";
  const code = [
    ".sample {",
    '  background: url("https://assets.example.invalid/a.svg");',
    "  mask-image: url(data:image/svg+xml,%3Csvg%3E);",
    "  clip-path: url(#clip);",
    "  list-style-image: url(var(--dynamic-image));",
    "}",
  ].join("\n");
  const result = inspectCssSource({ code, sourcePath, rootDir: fixtureRoot });

  assert.deepEqual(result.references.map((item) => item.classification), ["external", "data", "fragment", "dynamic"]);
  assert.equal(result.diagnostics.length, 0);
});

test("없는 자원을 가리키는 chunk snapshot을 거부한다", () => {
  const snapshot = {
    build: {
      tool: "vite",
      toolVersion: "8.3.1",
      adapterVersion: "0.1.0-spike",
      mode: "production",
      status: "success",
      fixtureSha256: "0".repeat(64),
    },
    resources: [],
    chunks: [{ id: "chunk:entry", kind: "entry", javascriptResourceIds: ["resource:missing.js"], stylesheetResourceIds: [], assetResourceIds: [] }],
    stylesheets: [],
    cssModules: [],
    diagnostics: [],
  };

  assert.throws(() => createAdapterSnapshot(snapshot), /존재하지 않는 resource id/);
});

test("잘못된 계약 버전을 기본 버전으로 덮지 않는다", () => {
  assert.throws(() => createAdapterSnapshot({
    contract: { name: "spinon.css-resource-adapter", version: "9.9.9" },
    build: { tool: "vite", toolVersion: "8.3.1", adapterVersion: "0.1.0-spike", mode: "production", status: "success", fixtureSha256: "0".repeat(64) },
    resources: [], chunks: [], stylesheets: [], cssModules: [], diagnostics: [],
  }), /contract.version/);
});

test("snapshot에 필요한 빈 배열을 생략하지 못하게 한다", () => {
  const { diagnostics, ...snapshot } = {
    build: { tool: "vite", toolVersion: "8.3.1", adapterVersion: "0.1.0-spike", mode: "production", status: "success", fixtureSha256: "0".repeat(64) },
    resources: [], chunks: [], stylesheets: [], cssModules: [], diagnostics: [],
  };

  assert.throws(() => createAdapterSnapshot(snapshot), /diagnostics 배열이 필요합니다/);
});

test("성공 snapshot의 로컬 URL은 실제 출력 resource와 원본 파일이 일치해야 한다", () => {
  const snapshot = createAdapterSnapshot({
    build: { tool: "vite", toolVersion: "8.3.1", adapterVersion: "0.1.0-spike", mode: "production", status: "success", fixtureSha256: "0".repeat(64) },
    resources: [
      { id: "resource:assets/app.css", kind: "stylesheet", outputPath: "assets/app.css", mediaType: "text/css", bytes: 1, sha256: "1".repeat(64), sourcePath: null },
      { id: "resource:assets/icon.svg", kind: "image", outputPath: "assets/icon.svg", mediaType: "image/svg+xml", bytes: 1, sha256: "2".repeat(64), sourcePath: "assets/icon.svg" },
    ],
    chunks: [{ id: "chunk:app", kind: "entry", javascriptResourceIds: [], stylesheetResourceIds: ["resource:assets/app.css"], assetResourceIds: ["resource:assets/icon.svg"] }],
    stylesheets: [{
      id: "stylesheet:src/app.css",
      sourcePath: "src/app.css",
      sourceSha256: "3".repeat(64),
      outputResourceIds: ["resource:assets/app.css"],
      imports: [],
      references: [{
        property: "background-image",
        specifier: "../assets/icon.svg",
        classification: "local",
        resourceKind: "image",
        targetSourcePath: "assets/icon.svg",
        targetResourceId: "resource:assets/icon.svg",
        source: { file: "src/app.css", line: 1, column: 1 },
      }],
    }],
    cssModules: [],
    diagnostics: [],
  });

  assert.doesNotThrow(() => assertAdapterSnapshot(snapshot));
  snapshot.stylesheets[0].references[0].targetResourceId = null;
  assert.throws(() => assertAdapterSnapshot(snapshot), /로컬 자원의 출력 ID가 없습니다/);
});

test("번들 출력 종류와 경계 경로를 정확히 판별한다", () => {
  assert.equal(resourceKindFromOutput("assets/runtime.MJS"), "javascript");
  assert.equal(resourceKindFromOutput("assets/app.CSS"), "stylesheet");
  assert.equal(sourcePathFromId("..cache/generated.css", fixtureRoot), "..cache/generated.css");
  assert.equal(sourcePathFromId("../outside.css", fixtureRoot), null);
});

test("Vite의 정적 공유 chunk도 snapshot에 포함한다", async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "spinon-vite-snapshot-"));
  try {
    await writeFile(path.join(outputDir, "entry.js"), "export {};\n");
    await writeFile(path.join(outputDir, "shared.js"), "export const shared = true;\n");
    const snapshot = await createViteSnapshot({
      adapter: {
        outputChunks: [
          { fileName: "entry.js", modulePaths: [] },
          { fileName: "shared.js", modulePaths: [] },
        ],
        sources: new Map(),
        cssModules: new Map(),
      },
      manifest: {
        "index.html": { file: "entry.js", isEntry: true },
        "src/shared.js": { file: "shared.js", isEntry: false, isDynamicEntry: false },
      },
      outputDir,
      fixtureSha256: "0".repeat(64),
      toolVersion: "8.3.1",
      status: "success",
    });

    assert.deepEqual(snapshot.chunks.map((chunk) => chunk.kind), ["entry", "shared"]);
    assert.ok(snapshot.chunks[1].javascriptResourceIds.includes("resource:shared.js"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
