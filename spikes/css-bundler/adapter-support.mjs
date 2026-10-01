import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { resourceKindFromPath } from "./css-source.mjs";

export async function outputResources(outputDir, sourceByOutputPath = new Map()) {
  const resources = [];
  for (const outputPath of await listFiles(outputDir)) {
    if (outputPath.startsWith(".vite/")) continue;
    const bytes = await readFile(path.join(outputDir, outputPath));
    const kind = resourceKindFromOutput(outputPath);
    resources.push({
      id: resourceId(outputPath),
      kind,
      outputPath,
      mediaType: mediaTypeForPath(outputPath),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      sourcePath: sourceByOutputPath.get(outputPath) ?? null,
    });
  }
  return resources.sort((left, right) => left.outputPath.localeCompare(right.outputPath));
}

export async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function resourceId(outputPath) {
  return `resource:${outputPath}`;
}

export function chunkId(name) {
  return `chunk:${name}`;
}

export function resourceKindFromOutput(outputPath) {
  if (/\.css$/i.test(outputPath)) return "stylesheet";
  if (/\.(?:js|mjs|cjs)$/i.test(outputPath)) return "javascript";
  if (outputPath.endsWith(".map")) return "source-map";
  if (/\.html?$/i.test(outputPath)) return "html";
  return resourceKindFromPath(outputPath);
}

export function mediaTypeForPath(outputPath) {
  const extension = path.posix.extname(outputPath).toLowerCase();
  const types = {
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
  };
  return types[extension] ?? "application/octet-stream";
}

export function sourcePathFromId(id, fixtureRoot) {
  const withoutQuery = id.split("?", 1)[0].replaceAll("\\", "/");
  const absolute = path.isAbsolute(withoutQuery) ? path.resolve(withoutQuery) : path.resolve(fixtureRoot, withoutQuery);
  const relative = path.relative(fixtureRoot, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

export function normalizeBundlerSourcePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
