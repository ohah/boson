import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRelativePath = 'tests/fixtures/css/s04/flex-paint.v1.json';
const stylesheetRelativePath = 'tests/fixtures/css/s04/flex-paint.v1.css';
const fixturePath = join(repositoryRoot, fixtureRelativePath);
const stylesheetPath = join(repositoryRoot, stylesheetRelativePath);
const referenceDirectory = join(repositoryRoot, 'tests/fixtures/css/references');
const outputDirectory = process.env.SPINON_REFERENCE_OUTPUT_DIR
  ? resolve(process.env.SPINON_REFERENCE_OUTPUT_DIR)
  : referenceDirectory;
const supportedComputedProperties = new Set([
  'display', 'box-sizing', 'flex-direction', 'flex-grow',
  'flex-shrink', 'flex-basis', 'direction', 'row-gap', 'column-gap', 'background-color',
]);
const defaultChromiumPaths = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  : process.platform === 'linux'
    ? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
    : [];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function firstExistingPath(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // 다음 표준 설치 경로를 확인합니다.
    }
  }
}

async function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForPort(profilePath, child) {
  const portPath = join(profilePath, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Chromium이 조기 종료됐습니다: ${child.exitCode}`);
    try {
      const [port] = (await readFile(portPath, 'utf8')).trim().split('\n');
      if (port) return port;
    } catch {
      // Chromium이 디버깅 포트를 열 때까지 기다립니다.
    }
    await wait(100);
  }
  throw new Error('Chromium DevTools 포트를 열지 못했습니다.');
}

function stopBrowser(child, signal) {
  if (child?.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    wait(timeoutMs),
  ]);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Chromium DevTools 요청 실패: ${response.status}`);
  return response.json();
}

function connectDevTools(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  let closedError;
  const opened = new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', () => reject(new Error('Chromium DevTools 연결 실패')), { once: true });
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      closedError = new Error('Chromium DevTools 응답이 올바른 JSON이 아닙니다.');
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`DevTools ${request.method}: ${message.error.message}`));
    else request.resolve(message.result ?? {});
  });
  socket.addEventListener('close', () => {
    closedError = new Error('Chromium DevTools 연결이 닫혔습니다.');
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(closedError);
    }
    pending.clear();
  });
  return {
    opened,
    send(method, params = {}) {
      return new Promise((resolvePromise, reject) => {
        if (closedError || socket.readyState !== WebSocket.OPEN) {
          reject(closedError ?? new Error(`DevTools 연결이 열려 있지 않습니다: ${method}`));
          return;
        }
        const id = nextId++;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools 시간이 초과됐습니다: ${method}`));
        }, 10_000);
        pending.set(id, { method, resolve: resolvePromise, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    waitForEvent(method) {
      return new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          socket.removeEventListener('message', listener);
          reject(new Error(`DevTools 이벤트 시간이 초과됐습니다: ${method}`));
        }, 15_000);
        const listener = (event) => {
          let message;
          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (message.method !== method) return;
          clearTimeout(timeout);
          socket.removeEventListener('message', listener);
          resolvePromise(message.params ?? {});
        };
        socket.addEventListener('message', listener);
      });
    },
    close() {
      socket.close();
    },
  };
}

function buildHtml(fixture, stylesheet) {
  const ids = fixture.tree.preorder;
  if (!Array.isArray(ids) || ids.length !== 4 || ids[0] !== fixture.tree.root
    || new Set(ids).size !== ids.length || ids.some((id) => !/^[a-z][a-z0-9-]*$/.test(id))) {
    throw new Error('S04 fixture의 preorder ID가 올바르지 않습니다.');
  }
  const children = fixture.tree.children.map((id) => `<div id="${id}"></div>`).join('\n');
  const css = stylesheet.replaceAll('</style', '<\\/style');
  return `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><style>${css}</style></head>
<body><div id="${fixture.tree.root}">${children}</div></body></html>`;
}

function fixtureColorToComputed(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`불투명 #RRGGBB가 아닙니다: ${color}`);
  const values = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
  return `rgb(${values.join(', ')})`;
}

const fixtureBytes = await readFile(fixturePath);
const stylesheetBytes = await readFile(stylesheetPath);
const fixture = JSON.parse(fixtureBytes.toString('utf8'));
const stylesheet = stylesheetBytes.toString('utf8');
if (fixture.schema !== 'spinon-css-s04-flex-paint-fixture/v1'
  || fixture.fixtureId !== 'S04-flex-paint-v1'
  || fixture.viewport.widthCssPx !== 301 || fixture.viewport.heightCssPx !== 40
  || fixture.viewport.deviceScaleFactor !== 1) {
  throw new Error('S04 fixture의 schema, ID 또는 viewport가 고정 기준과 다릅니다.');
}
const computedProperties = fixture.comparison?.computedProperties;
if (!Array.isArray(computedProperties) || computedProperties.length === 0
  || new Set(computedProperties).size !== computedProperties.length
  || computedProperties.some((property) => !supportedComputedProperties.has(property))
  || !computedProperties.includes('background-color')) {
  throw new Error('S04 fixture의 Chromium computed property 목록이 올바르지 않습니다.');
}
if (JSON.stringify(fixture.tree.children) !== JSON.stringify(fixture.tree.preorder.slice(1))) {
  throw new Error('S04 fixture의 직속 자식 순서가 preorder와 다릅니다.');
}
if (JSON.stringify(fixture.sampleRows) !== JSON.stringify([0, 20, 39])
  || fixture.comparison.frameUnit !== 'CSS px'
  || fixture.comparison.perCoordinateMaximumAbsoluteError !== 0.5
  || fixture.comparison.aggregateAveragesAllowed !== false
  || fixture.comparison.readbackRgba8 !== '각 고정 sample에서 author #RRGGBB bytes와 alpha 255 정확 일치') {
  throw new Error('S04 fixture의 sample 또는 비교 계약이 고정 기준과 다릅니다.');
}
if (JSON.stringify(fixture.tree.preorder)
  !== JSON.stringify(Object.keys(fixture.authorBackgroundColors))) {
  throw new Error('S04 fixture의 색상 ID가 root-first preorder와 다릅니다.');
}
if (Object.values(fixture.authorBackgroundColors).some((color) => !/^#[0-9a-fA-F]{6}$/.test(color))) {
  throw new Error('S04 fixture의 author 색상은 불투명 #RRGGBB여야 합니다.');
}
const chromiumPath = process.env.SPINON_CHROMIUM_BIN ?? await firstExistingPath(defaultChromiumPaths);
if (!chromiumPath) throw new Error('Chromium 실행 파일이 없습니다. SPINON_CHROMIUM_BIN으로 지정하세요.');
const browserSha256 = await sha256File(chromiumPath);
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'spinon-s04-css-paint-'));
const profilePath = join(temporaryDirectory, 'profile');
let browserProcess;
let pageDevTools;
let browserVersionInfo;
let captured;
try {
  await mkdir(profilePath);
  await writeFile(join(temporaryDirectory, 'fixture.html'), buildHtml(fixture, stylesheet));
  browserProcess = spawn(chromiumPath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`, 'about:blank',
  ], { detached: true, env: { ...process.env, TZ: 'UTC' }, stdio: 'ignore' });
  const port = await waitForPort(profilePath, browserProcess);
  const browser = await fetchJson(`http://127.0.0.1:${port}/json/version`);
  const browserDevTools = connectDevTools(browser.webSocketDebuggerUrl);
  await browserDevTools.opened;
  browserVersionInfo = await browserDevTools.send('Browser.getVersion');
  browserDevTools.close();

  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find((item) => item.type === 'page');
  if (!target) throw new Error('Chromium page target을 찾지 못했습니다.');
  pageDevTools = connectDevTools(target.webSocketDebuggerUrl);
  await pageDevTools.opened;
  await pageDevTools.send('Page.enable');
  await pageDevTools.send('Runtime.enable');
  await pageDevTools.send('Network.enable');
  await pageDevTools.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  await pageDevTools.send('Emulation.setDeviceMetricsOverride', {
    width: fixture.viewport.widthCssPx,
    height: fixture.viewport.heightCssPx,
    deviceScaleFactor: fixture.viewport.deviceScaleFactor,
    mobile: false,
    screenWidth: fixture.viewport.widthCssPx,
    screenHeight: fixture.viewport.heightCssPx,
  });
  await pageDevTools.send('Emulation.setLocaleOverride', { locale: 'en-US' });
  await pageDevTools.send('Emulation.setUserAgentOverride', {
    userAgent: browserVersionInfo.userAgent,
    acceptLanguage: 'en-US',
  });
  await pageDevTools.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await pageDevTools.send('Emulation.setEmulatedMedia', {
    media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  const pageLoaded = pageDevTools.waitForEvent('Page.loadEventFired');
  await pageDevTools.send('Page.navigate', {
    url: pathToFileURL(join(temporaryDirectory, 'fixture.html')).href,
  });
  await pageLoaded;
  const expression = `(() => {
    const ids = ${JSON.stringify(fixture.tree.preorder)};
    const properties = ${JSON.stringify(computedProperties)};
    const root = document.getElementById(ids[0]);
    const origin = root.getBoundingClientRect();
    const observations = ids.map((fixtureId) => {
      const element = document.getElementById(fixtureId);
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        fixtureId,
        computedValues: Object.fromEntries(properties.map((property) => [property, computed.getPropertyValue(property)])),
        frameRelativeToRoot: {
          x: rect.x - origin.x, y: rect.y - origin.y,
          width: rect.width, height: rect.height,
        },
      };
    });
    return {
      viewport: { widthCssPx: innerWidth, heightCssPx: innerHeight, deviceScaleFactor: devicePixelRatio,
        screenMedia: matchMedia('screen').matches, lightColorScheme: matchMedia('(prefers-color-scheme: light)').matches,
        locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      observations,
    };
  })()`;
  const evaluation = await pageDevTools.send('Runtime.evaluate', { expression, returnByValue: true });
  if (evaluation.exceptionDetails || !evaluation.result?.value) {
    throw new Error(`S04 Chromium fixture 평가 실패: ${evaluation.exceptionDetails?.text ?? '결과 없음'}`);
  }
  captured = evaluation.result.value;
} finally {
  pageDevTools?.close();
  try {
    stopBrowser(browserProcess, 'SIGTERM');
    await waitForExit(browserProcess, 2_000);
    stopBrowser(browserProcess, 'SIGKILL');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const expectedViewport = {
  widthCssPx: 301, heightCssPx: 40, deviceScaleFactor: 1,
  screenMedia: true, lightColorScheme: true, locale: 'en-US', timeZone: 'UTC',
};
for (const [key, value] of Object.entries(expectedViewport)) {
  if (captured.viewport[key] !== value) throw new Error(`Chromium viewport 환경 불일치 ${key}: ${captured.viewport[key]}`);
}
if (captured.observations.length !== fixture.tree.preorder.length) {
  throw new Error('Chromium 관찰 node 수가 fixture와 다릅니다.');
}
for (const [index, observation] of captured.observations.entries()) {
  const fixtureId = fixture.tree.preorder[index];
  if (observation.fixtureId !== fixtureId) throw new Error(`관찰 순서가 다릅니다: ${observation.fixtureId}`);
  const expectedColor = fixtureColorToComputed(fixture.authorBackgroundColors[fixtureId]);
  if (observation.computedValues['background-color'] !== expectedColor) {
    throw new Error(`${fixtureId}.background-color: ${observation.computedValues['background-color']} != ${expectedColor}`);
  }
  if (!computedProperties.every((property) => typeof observation.computedValues[property] === 'string')) {
    throw new Error(`계산 속성이 빠졌습니다: ${fixtureId}`);
  }
  if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(observation.frameRelativeToRoot[key]))) {
    throw new Error(`geometry가 유한하지 않습니다: ${fixtureId}`);
  }
}

const version = browserVersionInfo.product.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
if (!version) throw new Error(`Chromium product version을 읽지 못했습니다: ${browserVersionInfo.product}`);
const fixtureSha256 = sha256(fixtureBytes);
const stylesheetSha256 = sha256(stylesheetBytes);
const referenceId = `s04-flex-paint-v1-chromium-${version}-${fixtureSha256.slice(0, 12)}-${stylesheetSha256.slice(0, 12)}-${browserSha256.slice(0, 12)}`;
const outputPath = join(outputDirectory, `${referenceId}.json`);
const output = {
  schema: 'spinon-css-s04-flex-paint-reference/v1',
  referenceId,
  fixture: { path: fixtureRelativePath, sha256: fixtureSha256, fixtureId: fixture.fixtureId },
  stylesheet: { path: stylesheetRelativePath, sha256: stylesheetSha256, id: fixture.stylesheet.id },
  capture: {
    path: 'tools/css-reference/capture-s04-flex-paint.mjs',
    nodeVersion: process.version,
    operatingSystem: { platform: process.platform, arch: process.arch, release: spawnSync('uname', ['-r'], { encoding: 'utf8' }).stdout.trim() },
    networkMode: 'offline', locale: 'en-US', timeZone: 'UTC', colorScheme: 'light',
  },
  browser: {
    path: chromiumPath, version: browserVersionInfo.product, revision: browserVersionInfo.revision,
    userAgent: browserVersionInfo.userAgent, javascriptVersion: browserVersionInfo.jsVersion,
    sha256: browserSha256,
  },
  viewport: captured.viewport,
  computedProperties,
  observations: captured.observations,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(`reference=${referenceId}`);
console.log(`path=${outputPath}`);
console.log(`fixture_sha256=${fixtureSha256}`);
console.log(`stylesheet_sha256=${stylesheetSha256}`);
console.log(`browser=${browserVersionInfo.product}`);
