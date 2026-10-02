import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureRspackResourceGraphJoin } from "./rspack-resource-graph-join.mjs";
import { captureViteResourceGraphJoin } from "./vite-resource-graph-join.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixture-resource-join");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "spinon-c02-resource-join-evidence-"));

try {
  const viteCapture = await captureViteResourceGraphJoin({ fixtureRoot });
  const rspackCapture = await captureRspackResourceGraphJoin({ fixtureRoot, temporaryRoot });
  process.stdout.write(`${JSON.stringify({
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    vite: summarizeCapture(viteCapture),
    rspack: summarizeCapture(rspackCapture),
  }, null, 2)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function summarizeCapture(capture) {
  const resourceGraph = withoutCaptureId(capture.resourceSnapshot);
  const moduleGraph = withoutCaptureId(capture.moduleGraphSnapshot);
  const joinedGraph = withoutCaptureId(capture.joinedSnapshot);
  joinedGraph.sourceDigests = {
    moduleGraphSha256: digestJson(moduleGraph),
    resourceGraphSha256: digestJson(resourceGraph),
  };
  return {
    captureId: capture.captureId,
    tool: capture.resourceSnapshot.build.tool,
    toolVersion: capture.resourceSnapshot.build.toolVersion,
    mode: capture.resourceSnapshot.build.mode,
    fixtureSha256: capture.resourceSnapshot.build.fixtureSha256,
    buildProfileSha256: capture.resourceSnapshot.build.buildProfileSha256,
    resourceGraphSha256: digestJson(resourceGraph),
    sourceGraphSha256: capture.moduleGraphSnapshot.sourceGraph.sha256,
    outputGraphSha256: digestJson(moduleGraph.outputGraph),
    moduleGraphSha256: digestJson(moduleGraph),
    joinedGraphSha256: digestJson(joinedGraph),
    features: capture.joinedSnapshot.features.map(({ id, entrySourceKey }) => ({ id, entrySourceKey })),
    chunkCount: capture.joinedSnapshot.chunks.length,
    resourceEdgeCount: capture.joinedSnapshot.resourceEdges.length,
    resources: capture.joinedSnapshot.resources
      .map(({ id, kind, outputPath, mediaType, bytes, sha256 }) => ({ id, kind, outputPath, mediaType, bytes, sha256 }))
      .sort((left, right) => compareStrings(left.outputPath, right.outputPath)),
  };
}

function withoutCaptureId(snapshot) {
  const copy = structuredClone(snapshot);
  delete copy.build.captureId;
  return copy;
}

function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(sortObjectKeys(value)), "utf8").digest("hex");
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareStrings).map((key) => [key, sortObjectKeys(value[key])]));
  }
  return value;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
