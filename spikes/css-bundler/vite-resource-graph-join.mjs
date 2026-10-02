import { createHash, randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { cp, lstat, mkdtemp, open, readFile, realpath, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { assertAdapterSnapshot } from "./adapter-contract.mjs";
import { createC02ResourceGraphJoin, assertC02ResourceGraphJoin } from "./resource-graph-join.mjs";
import { computeBuildProfileSha256 } from "./module-graph-contract.mjs";
import {
  createViteModuleGraphAdapter,
  VITE_MODULE_GRAPH_ADAPTER_VERSION,
} from "./vite-module-graph-adapter.mjs";
import {
  createViteGraphBuildConfig,
  createViteGraphFixturePlugin,
  VITE_GRAPH_FEATURES,
  VITE_GRAPH_OUTPUT_PROFILE,
} from "./vite-graph.config.mjs";
import { createViteResourceAdapter } from "./vite-resource-adapter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_NAME = "fixture-resource-join";
const PINNED_VITE_VERSION = "8.3.1";
const PINNED_ROLLDOWN_VERSION = "1.2.12";
const PROFILE_CONFIG_SOURCES = [
  ["spikes/css-bundler/vite-resource-graph-join.mjs", "vite-resource-graph-join.mjs"],
  ["spikes/css-bundler/vite-graph.config.mjs", "vite-graph.config.mjs"],
  ["spikes/css-bundler/vite-module-graph-adapter.mjs", "vite-module-graph-adapter.mjs"],
  ["spikes/css-bundler/vite-resource-adapter.mjs", "vite-resource-adapter.mjs"],
  ["spikes/css-bundler/adapter-contract.mjs", "adapter-contract.mjs"],
  ["spikes/css-bundler/adapter-support.mjs", "adapter-support.mjs"],
  ["spikes/css-bundler/css-source.mjs", "css-source.mjs"],
  ["spikes/css-bundler/module-graph-contract.mjs", "module-graph-contract.mjs"],
  ["spikes/css-bundler/resource-graph-join.mjs", "resource-graph-join.mjs"],
  ["spikes/css-bundler/package.json", "package.json"],
  ["spikes/css-bundler/bun.lock", "bun.lock"],
];

export const VITE_RESOURCE_GRAPH_JOIN_PROFILE = Object.freeze({
  ...VITE_GRAPH_OUTPUT_PROFILE,
  name: "vite-c02-resource-graph-join-css-split-manifest-v1",
  manifest: true,
  preserveEntrySignatures: "strict",
});

/** 두 Vite adapter를 같은 production build에 꽂아 build-local graph를 결합한다. */
export async function captureViteResourceGraphJoin({
  fixtureRoot = path.join(here, FIXTURE_NAME),
} = {}) {
  const [viteVersion, rolldownVersion] = await Promise.all([
    packageVersion("vite"),
    packageVersion("rolldown"),
  ]);
  assertPinnedToolchainVersions(viteVersion, rolldownVersion);

  const canonicalFixtureRoot = await realpath(fixtureRoot);
  const fixtureBefore = await captureFixtureSnapshot(canonicalFixtureRoot);
  const containerPath = await mkdtemp(path.join(os.tmpdir(), "spinon-vite-c02-join-"));
  const copiedFixtureRoot = path.join(containerPath, "fixture");
  const outputDir = path.join(containerPath, "output");

  try {
    await cp(canonicalFixtureRoot, copiedFixtureRoot, { recursive: true, errorOnExist: true, force: false });
    const copiedFixtureBefore = await captureFixtureSnapshot(copiedFixtureRoot);
    if (copiedFixtureBefore.sha256 !== fixtureBefore.sha256) {
      throw new Error("임시 fixture copy의 bytes가 공유 fixture와 다릅니다.");
    }

    const captureId = randomUUID();
    const resourceAdapter = createViteResourceAdapter({ fixtureRoot: copiedFixtureRoot });
    const resourcePlugins = profileResourcePlugins(resourceAdapter.plugins);
    const graphAdapter = createViteModuleGraphAdapter({
      fixtureRoot: copiedFixtureRoot,
      features: VITE_GRAPH_FEATURES,
      outputProfile: VITE_RESOURCE_GRAPH_JOIN_PROFILE,
    });
    const config = createViteGraphBuildConfig({
      fixtureRoot: copiedFixtureRoot,
      outputDir,
      outputProfile: VITE_RESOURCE_GRAPH_JOIN_PROFILE,
      plugins: [createViteGraphFixturePlugin(), ...resourcePlugins, graphAdapter.plugin],
    });
    graphAdapter.setExpectedConfig(config);

    const buildObservation = { viteBuildCalls: 0 };
    let buildFailure = null;
    try {
      await runViteBuildOnce(config, buildObservation);
    } catch (error) {
      buildFailure = error;
      graphAdapter.recordBuildFailure(error);
    }
    if (buildFailure) throw new Error(`Vite joined production build가 실패했습니다: ${buildFailure.message}`);

    const manifestPath = path.join(outputDir, ".vite", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const fixtureAfter = await captureFixtureSnapshot(canonicalFixtureRoot);
    const copiedFixtureAfter = await captureFixtureSnapshot(copiedFixtureRoot);
    if (fixtureAfter.sha256 !== fixtureBefore.sha256 || copiedFixtureAfter.sha256 !== copiedFixtureBefore.sha256) {
      throw new Error("Vite capture 도중 source fixture가 변경되어 build provenance를 확정할 수 없습니다.");
    }

    const profile = await createViteBuildProfile({
      fixtureSha256: fixtureBefore.sha256,
      fixtureRoot: copiedFixtureRoot,
      outputDir,
      graphAdapter,
      viteBuildCalls: buildObservation.viteBuildCalls,
      viteVersion,
      rolldownVersion,
    });
    const buildProfileSha256 = computeBuildProfileSha256(profile);
    const moduleGraphSnapshot = graphAdapter.snapshot({
      fixtureSha256: fixtureBefore.sha256,
      profile,
      viteVersion,
      captureId,
    });
    const resourceSnapshot = await resourceAdapter.snapshot({
      manifest,
      outputDir,
      fixtureSha256: fixtureBefore.sha256,
      toolVersion: viteVersion,
      captureMetadata: { captureId, profile, buildProfileSha256 },
    });
    assertAdapterSnapshot(resourceSnapshot);

    const joinedSnapshot = createC02ResourceGraphJoin({ resourceSnapshot, moduleGraphSnapshot });
    assertC02ResourceGraphJoin(joinedSnapshot);
    return {
      captureId,
      resourceSnapshot,
      moduleGraphSnapshot,
      joinedSnapshot,
      temporaryBuild: {
        containerPath,
        fixturePath: copiedFixtureRoot,
        outputPath: outputDir,
        fixtureIsolatedFromSource: copiedFixtureRoot !== canonicalFixtureRoot,
        outputIsSiblingOfFixture: path.dirname(copiedFixtureRoot) === path.dirname(outputDir),
      },
    };
  } finally {
    await rm(containerPath, { recursive: true, force: true });
  }
}

function profileResourcePlugins(plugins) {
  return plugins.map((plugin) => ({
    ...plugin,
    spinonC02ProfileOptions: {
      role: "resource-adapter",
      capture: "same-production-build",
      responsibility: plugin.name.slice(plugin.name.lastIndexOf(":") + 1),
    },
  }));
}

async function createViteBuildProfile({
  fixtureSha256,
  fixtureRoot,
  outputDir,
  graphAdapter,
  viteBuildCalls,
  viteVersion,
  rolldownVersion,
}) {
  if (viteBuildCalls !== 1) throw new Error(`Vite joined capture는 build() 한 번을 요구합니다. 관찰 횟수=${viteBuildCalls}`);
  const configSources = await Promise.all(PROFILE_CONFIG_SOURCES.map(async ([relativePath, localPath]) => ({
    path: relativePath,
    sha256: sha256(await readFile(path.join(here, localPath))),
  })));
  const observations = graphAdapter.profileObservations();
  return {
    configSources,
    effectiveOptions: {
      mode: "production",
      fixtureSha256,
      fixtureRoot: "$FIXTURE_ROOT",
      outputDir: "$OUTPUT_DIR",
      entry: { main: "index.js" },
      features: VITE_GRAPH_FEATURES,
      outputProfile: VITE_RESOURCE_GRAPH_JOIN_PROFILE,
      graphAdapterVersion: VITE_MODULE_GRAPH_ADAPTER_VERSION,
      resolvedViteConfig: normalizeTemporaryPaths(observations.resolvedViteConfig, fixtureRoot, outputDir),
      capture: {
        viteBuildCalls,
        writeBundleCallCount: observations.writeBundleCallCount,
        manifestPath: ".vite/manifest.json",
        sameBuildAdapters: ["vite-resource-adapter", "vite-module-graph-adapter"],
      },
      runtimeVersions: {
        node: process.version,
        vite: viteVersion,
        rolldown: rolldownVersion,
        platform: process.platform,
        arch: process.arch,
      },
    },
  };
}

async function runViteBuildOnce(config, observation) {
  if (observation.viteBuildCalls !== 0) {
    throw new Error("Vite joined capture가 두 번째 build() 호출을 시도했습니다.");
  }
  observation.viteBuildCalls += 1;
  return build(config);
}

function assertPinnedToolchainVersions(viteVersion, rolldownVersion) {
  if (viteVersion !== PINNED_VITE_VERSION || rolldownVersion !== PINNED_ROLLDOWN_VERSION) {
    throw new Error(`Vite joined capture는 Vite ${PINNED_VITE_VERSION}/Rolldown ${PINNED_ROLLDOWN_VERSION}만 검증합니다. 현재=${viteVersion}/${rolldownVersion}`);
  }
}

function normalizeTemporaryPaths(value, fixtureRoot, outputDir) {
  const roots = [
    ...pathAliases(fixtureRoot).map((root) => ({ root, marker: "$FIXTURE_ROOT" })),
    ...pathAliases(outputDir).map((root) => ({ root, marker: "$OUTPUT_DIR" })),
  ];
  return mapJsonStrings(value, (item) => {
    if (!path.isAbsolute(item)) return item;
    const candidates = [path.resolve(item)];
    try {
      candidates.push(realpathSync(item));
    } catch {
      // 아직 만들어지지 않은 output은 입력한 경로 표기를 사용해 정규화합니다.
    }
    for (const { root, marker } of roots) {
      for (const candidate of candidates) {
        const relative = path.relative(root, candidate);
        if (relative === "") return marker;
        if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
          return `${marker}/${relative.split(path.sep).join("/")}`;
        }
      }
    }
    return item;
  });
}

function pathAliases(value) {
  const candidates = new Set([path.resolve(value)]);
  try {
    candidates.add(realpathSync(value));
  } catch {
    // 대상이 아직 없어도 입력한 경로 표기로 정규화할 수 있습니다.
  }
  return [...candidates];
}

function mapJsonStrings(value, transform) {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map((item) => mapJsonStrings(item, transform));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapJsonStrings(item, transform)]));
  }
  return value;
}

async function packageVersion(name) {
  const packageJsonUrl = new URL(`./node_modules/${name}/package.json`, import.meta.url);
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));
  return packageJson.version;
}

async function captureFixtureSnapshot(fixtureRoot) {
  const rootMetadata = await lstat(fixtureRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`fixture root는 일반 디렉터리여야 합니다: ${fixtureRoot}`);
  }
  const inventory = [];
  for (const relativePath of await listFixtureFiles(fixtureRoot)) {
    const absolutePath = path.join(fixtureRoot, ...relativePath.split("/"));
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`fixture 항목은 일반 파일이어야 합니다: ${relativePath}`);
    }
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      const openedMetadata = await handle.stat();
      if (!openedMetadata.isFile() || openedMetadata.dev !== metadata.dev || openedMetadata.ino !== metadata.ino) {
        throw new Error(`fixture 항목이 검증 후 바뀌었습니다: ${relativePath}`);
      }
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    inventory.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return { sha256: sha256(JSON.stringify(inventory)) };
}

async function listFixtureFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`fixture symlink은 지원하지 않습니다: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await listFixtureFiles(path.join(directory, entry.name), relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`fixture 항목은 일반 파일이나 디렉터리여야 합니다: ${relativePath}`);
  }
  return files.sort(compareStrings);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
