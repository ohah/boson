import path from "node:path";
import { statSync } from "node:fs";
import postcss from "postcss";
import valueParser from "postcss-value-parser";

export function inspectCssSource({ code, sourcePath, rootDir }) {
  const ast = postcss.parse(code, { from: sourcePath });
  const imports = [];
  const references = [];
  const diagnostics = [];
  const locationAtOffset = createLocationResolver(code);

  ast.walkAtRules("import", (rule) => {
    const paramsOffset = atRuleParamsOffset(rule);
    const parsed = firstSpecifier(valueParser(rule.params).nodes);
    const specifier = parsed?.value ?? null;
    const source = { file: sourcePath, ...locationAtOffset(paramsOffset + (parsed?.offset ?? 0)) };
    const resolved = classifySpecifier(specifier, sourcePath, rootDir, parsed?.type);
    imports.push({
      specifier,
      classification: resolved.classification,
      targetSourcePath: resolved.targetSourcePath,
      conditions: rule.params.slice(parsed?.consumedEnd ?? 0).trim() || null,
      source,
    });
    if (resolved.classification === "unresolved") {
      diagnostics.push(missingResourceDiagnostic(sourcePath, specifier, source));
    }
  });

  ast.walkDecls((declaration) => {
    const valueOffset = declarationValueOffset(declaration);
    valueParser(declaration.value).walk((node) => {
      if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
      const parsed = firstSpecifier(node.nodes ?? []);
      const specifier = parsed?.value ?? null;
      const source = { file: sourcePath, ...locationAtOffset(valueOffset + (parsed?.offset ?? node.sourceIndex)) };
      const resolved = classifySpecifier(specifier, sourcePath, rootDir, parsed?.type);
      references.push({
        property: declaration.prop,
        specifier,
        classification: resolved.classification,
        resourceKind: resourceKindFromPath(resolved.targetSourcePath ?? specifier),
        targetSourcePath: resolved.targetSourcePath,
        source,
      });
      if (resolved.classification === "unresolved") {
        diagnostics.push(missingResourceDiagnostic(sourcePath, specifier, source));
      }
      return false;
    });
  });

  return {
    sourcePath,
    imports,
    references,
    diagnostics,
  };
}

export function resolveLocalCssImport(importEdge) {
  if (importEdge.classification !== "local" || !importEdge.targetSourcePath) return null;
  if (path.posix.extname(importEdge.targetSourcePath).toLowerCase() !== ".css") return null;
  return importEdge.targetSourcePath;
}

export function sourceLocationAt(code, offset) {
  return createLocationResolver(code)(offset);
}

export function resourceKindFromPath(value) {
  const extension = path.posix.extname(String(value ?? "").split(/[?#]/, 1)[0]).toLowerCase();
  if (extension === ".css") return "stylesheet";
  if ([".woff", ".woff2", ".ttf", ".otf"].includes(extension)) return "font";
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico"].includes(extension)) return "image";
  return "other";
}

function firstSpecifier(nodes) {
  for (const node of nodes) {
    if (node.type === "space" || node.type === "comment") continue;
    if (node.type === "string" || node.type === "word") {
      return {
        value: node.value,
        type: node.type,
        offset: node.sourceIndex,
        consumedEnd: node.sourceEndIndex,
      };
    }
    if (node.type === "function" && node.value.toLowerCase() === "url") {
      const nested = firstSpecifier(node.nodes ?? []);
      return nested ? { ...nested, consumedEnd: node.sourceEndIndex } : null;
    }
    return null;
  }
  return null;
}

function atRuleParamsOffset(rule) {
  const start = Number.isInteger(rule.source?.start?.offset) ? rule.source.start.offset : 0;
  const afterName = rule.raws.afterName ?? "";
  return start + 1 + rule.name.length + afterName.length;
}

function declarationValueOffset(declaration) {
  const start = Number.isInteger(declaration.source?.start?.offset) ? declaration.source.start.offset : 0;
  const rawProperty = typeof declaration.raws.prop === "string"
    ? declaration.raws.prop
    : declaration.raws.prop?.raw ?? declaration.prop;
  return start + rawProperty.length + (declaration.raws.between ?? ":").length;
}

function createLocationResolver(code) {
  const lineStarts = [0];
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === "\r") {
      if (code[index + 1] === "\n") index += 1;
      lineStarts.push(index + 1);
    } else if (code[index] === "\n" || code[index] === "\f") {
      lineStarts.push(index + 1);
    }
  }

  return (offset) => {
    const boundedOffset = Math.max(0, Math.min(offset, code.length));
    let lower = 0;
    let upper = lineStarts.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (lineStarts[middle] <= boundedOffset) lower = middle + 1;
      else upper = middle;
    }
    const lineIndex = lower - 1;
    return { line: lineIndex + 1, column: boundedOffset - lineStarts[lineIndex] + 1 };
  };
}

function classifySpecifier(specifier, sourcePath, rootDir, tokenType) {
  if (specifier === null) return { classification: "dynamic", targetSourcePath: null };
  const trimmed = specifier.trim();
  if (trimmed.includes("\\") || (tokenType === "word" && /^[a-z_-][\w-]*\(/i.test(trimmed))) {
    return { classification: "dynamic", targetSourcePath: null };
  }
  if (trimmed.startsWith("#")) return { classification: "fragment", targetSourcePath: null };
  if (/^data:/i.test(trimmed)) return { classification: "data", targetSourcePath: null };
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(trimmed)) {
    return { classification: "external", targetSourcePath: null };
  }

  const rawPath = trimmed.split(/[?#]/, 1)[0];
  if (!rawPath) return { classification: "dynamic", targetSourcePath: null };
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return { classification: "unresolved", targetSourcePath: null };
  }

  const relativePath = decodedPath.startsWith("/")
    ? decodedPath.slice(1)
    : path.posix.join(path.posix.dirname(sourcePath), decodedPath);
  const normalized = path.posix.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return { classification: "unresolved", targetSourcePath: null };
  }

  const absolutePath = path.resolve(rootDir, ...normalized.split("/"));
  const relativeToRoot = path.relative(rootDir, absolutePath);
  let isFile = false;
  try {
    isFile = statSync(absolutePath).isFile();
  } catch {
    isFile = false;
  }
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot) || !isFile) {
    return { classification: "unresolved", targetSourcePath: null };
  }
  return {
    classification: "local",
    targetSourcePath: relativeToRoot.split(path.sep).join("/"),
  };
}

function missingResourceDiagnostic(sourcePath, specifier, source) {
  return {
    severity: "error",
    code: "CSS_RESOURCE_NOT_FOUND",
    message: `CSS 로컬 자원을 찾을 수 없습니다: ${specifier ?? "(해석 불가)"}`,
    source: { file: sourcePath, ...source },
  };
}
