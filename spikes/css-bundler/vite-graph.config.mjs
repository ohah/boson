import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORKTREE_ROOT = path.resolve(PACKAGE_ROOT, "../..");

export const VITE_GRAPH_OUTPUT_PROFILE = Object.freeze({
  name: "vite-esm-deterministic-names-no-minify-v1",
  format: "es",
  target: "esnext",
  minify: false,
  cssCodeSplit: true,
  modulePreloadPolyfill: false,
  entryFileNames: "assets/[name].js",
  chunkFileNames: "assets/[name].js",
  assetFileNames: "assets/[name][extname]",
});

export const VITE_GRAPH_FEATURES = Object.freeze([
  { id: "main", entrySourceKey: "index.js" },
  { id: "lazy-feature", entrySourceKey: "features/lazy.js" },
]);

export function createViteGraphBuildConfig({ fixtureRoot, outputDir, plugins = [], write = true }) {
  const root = path.resolve(fixtureRoot);
  if (write && !outputDir) throw new Error("Vite graph fixture build에는 임시 outputDir가 필요합니다.");
  if (write && outputDir) assertDisjointBuildPaths(root, path.resolve(outputDir));
  return {
    root,
    mode: "production",
    configFile: false,
    logLevel: "silent",
    clearScreen: false,
    base: "./",
    resolve: {
      conditions: ["module", "browser", "development|production"],
      alias: [{ find: "@graph/alias.js", replacement: path.join(root, "alias.js") }],
    },
    plugins,
    build: {
      write,
      outDir: outputDir ? path.resolve(outputDir) : undefined,
      emptyOutDir: true,
      minify: VITE_GRAPH_OUTPUT_PROFILE.minify,
      target: VITE_GRAPH_OUTPUT_PROFILE.target,
      cssCodeSplit: VITE_GRAPH_OUTPUT_PROFILE.cssCodeSplit,
      modulePreload: { polyfill: VITE_GRAPH_OUTPUT_PROFILE.modulePreloadPolyfill },
      assetsInlineLimit: 0,
      sourcemap: false,
      rollupOptions: {
        input: { main: path.join(root, "index.js") },
        output: {
          format: VITE_GRAPH_OUTPUT_PROFILE.format,
          entryFileNames: VITE_GRAPH_OUTPUT_PROFILE.entryFileNames,
          chunkFileNames: VITE_GRAPH_OUTPUT_PROFILE.chunkFileNames,
          assetFileNames: VITE_GRAPH_OUTPUT_PROFILE.assetFileNames,
        },
      },
    },
  };
}

export function assertDisjointBuildPaths(fixtureRoot, outputDir) {
  const sourcePath = canonicalizeExistingAncestor(fixtureRoot);
  const outputPath = canonicalizeExistingAncestor(outputDir);
  const protectedRoots = [
    ["fixture/source root", sourcePath],
    ["Vite package root", canonicalizeExistingAncestor(PACKAGE_ROOT)],
    ["worktree root", canonicalizeExistingAncestor(WORKTREE_ROOT)],
  ];
  for (const [label, protectedPath] of protectedRoots) {
    if (pathsOverlap(protectedPath, outputPath)) {
      throw new Error(`emptyOutDir output path가 ${label}와 겹칩니다: ${outputPath}`);
    }
  }
  const tempRoot = canonicalizeExistingAncestor(os.tmpdir());
  if (!isPathInside(tempRoot, outputPath) || tempRoot === outputPath) {
    throw new Error(`이 Vite fixture profile은 OS 임시 디렉터리 안의 전용 outputDir만 허용합니다: ${outputPath}`);
  }
  assertPrivateMkdtempContainer(fixtureRoot, outputDir, tempRoot);
  try {
    if (lstatSync(outputDir).isSymbolicLink()) throw new Error(`emptyOutDir output root는 symlink일 수 없습니다: ${outputDir}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function assertPrivateMkdtempContainer(fixtureRoot, outputDir, tempRoot) {
  const fixtureParent = path.dirname(path.resolve(fixtureRoot));
  const outputParent = path.dirname(path.resolve(outputDir));
  let canonicalContainer;
  try {
    canonicalContainer = realpathSync(fixtureParent);
  } catch (error) {
    throw new Error(`fixture/output parent가 실제 mkdtemp 디렉터리가 아닙니다: ${error.message}`);
  }
  if (lstatSync(fixtureParent).isSymbolicLink() || canonicalContainer !== realpathSync(outputParent)) {
    throw new Error("fixture와 output은 같은 실제 mkdtemp 컨테이너의 직접 자식이어야 합니다.");
  }
  if (path.dirname(canonicalContainer) !== tempRoot) {
    throw new Error("fixture/output 컨테이너는 OS 임시 디렉터리의 직접 자식이어야 합니다.");
  }
  const containerStat = lstatSync(canonicalContainer);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!containerStat.isDirectory() || currentUid === null || containerStat.uid !== currentUid || (containerStat.mode & 0o077) !== 0) {
    throw new Error("mkdtemp 컨테이너는 현재 사용자 소유의 mode 0700 디렉터리여야 합니다.");
  }
  if (path.resolve(fixtureRoot) === path.resolve(outputDir)
    || path.dirname(path.resolve(fixtureRoot)) !== path.dirname(path.resolve(outputDir))) {
    throw new Error("fixture와 output은 mkdtemp 컨테이너의 서로 다른 직접 자식이어야 합니다.");
  }
}

function canonicalizeExistingAncestor(value) {
  let current = path.resolve(value);
  const suffix = [];
  while (true) {
    try {
      const canonical = realpathSync(current);
      return path.resolve(canonical, ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function pathsOverlap(left, right) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  return relative === "" || reverse === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")
    || (!reverse.startsWith(`..${path.sep}`) && reverse !== "..");
}

function isPathInside(root, value) {
  const relative = path.relative(root, value);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function createViteGraphFixturePlugin({ conflict = false } = {}) {
  return {
    name: "spinon-c02-vite-module-graph-fixture",
    enforce: "pre",
    spinonC02ProfileOptions: { role: "fixture-resolver", conflict },
    resolveId(source, importer, options = {}) {
      if (source === "virtual:graph-value") return "\0spinon-c02:virtual-value";
      if (conflict && source === "virtual:conflicting-target") {
        const kind = options.kind ?? "unknown";
        return kind === "dynamic-import" ? "\0spinon-c02:conflict-dynamic" : "\0spinon-c02:conflict-static";
      }
      return null;
    },
    load(id) {
      if (id === "\0spinon-c02:virtual-value") return 'export const virtualValue = "virtual";';
      if (id === "\0spinon-c02:conflict-static") return 'export const conflictValue = "static";';
      if (id === "\0spinon-c02:conflict-dynamic") return 'export const conflictValue = "dynamic";';
      return null;
    },
  };
}
