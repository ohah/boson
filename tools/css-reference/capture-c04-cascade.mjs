import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { release as osRelease, tmpdir, version as osVersion } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRelativePath = 'tests/fixtures/css/c04/cascade-input.v1.json';
const captureRelativePath = 'tools/css-reference/capture-c04-cascade.mjs';
const fixturePath = join(repositoryRoot, fixtureRelativePath);
const capturePath = join(repositoryRoot, captureRelativePath);
const expectedProperties = ['display', 'color', 'font-size', 'font-weight', 'margin-top'];
const defaultChromiumPaths = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  : process.platform === 'linux'
    ? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
    : [];

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function renderNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('모든 tree 항목은 요소 객체여야 합니다.');
  }
  if (!/^[a-z][a-z0-9-]*$/i.test(node.tag)) {
    throw new Error(`허용되지 않는 HTML 요소 이름입니다: ${node.tag}`);
  }
  if (/^(base|embed|iframe|link|object|script|style)$/i.test(node.tag)) {
    throw new Error(`fixture tree에서 실행 코드나 외부 스타일 자원을 만들 수 없습니다: ${node.tag}`);
  }
  if (node.attributes !== undefined
    && (typeof node.attributes !== 'object' || node.attributes === null || Array.isArray(node.attributes))) {
    throw new Error(`요소 속성은 객체여야 합니다: ${node.fixtureId}`);
  }
  const attributes = { ...(node.attributes ?? {}), 'data-c04-fixture-id': node.fixtureId };
  const serializedAttributes = Object.entries(attributes)
    .map(([name, value]) => {
      if (!/^[a-z_:][a-z0-9_.:-]*$/i.test(name) || /^on/i.test(name)
        || name.toLowerCase() === 'srcdoc' || typeof value !== 'string') {
        throw new Error(`허용되지 않는 HTML 속성입니다: ${name}`);
      }
      return `${name}="${htmlEscape(value)}"`;
    })
    .join(' ');
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new Error(`요소 자식 목록은 배열이어야 합니다: ${node.fixtureId}`);
  }
  const children = (node.children ?? []).map(renderNode).join('');
  return `<${node.tag} ${serializedAttributes}>${children}</${node.tag}>`;
}

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 다음 표준 설치 경로를 확인합니다.
    }
  }
}

function connectDevTools(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  let rejectOpened;
  const opened = new Promise((resolve, reject) => {
    rejectOpened = reject;
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Chromium DevTools 연결에 실패했습니다.')), { once: true });
  });
  const openTimeout = setTimeout(() => rejectOpened(new Error('Chromium DevTools 연결 시간이 초과됐습니다.')), 10_000);
  opened.then(() => clearTimeout(openTimeout), () => clearTimeout(openTimeout));
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      rejectPending('Chromium DevTools 응답이 올바른 JSON이 아닙니다.');
      return;
    }
    if (message.id === undefined) return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`DevTools ${request.method}: ${message.error.message}`));
    else request.resolve(message.result ?? {});
  });
  const rejectPending = (message) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(message));
    }
    pending.clear();
  };
  socket.addEventListener('close', () => rejectPending('Chromium DevTools 연결이 닫혔습니다.'));
  socket.addEventListener('error', () => rejectPending('Chromium DevTools 연결에 오류가 발생했습니다.'));
  return {
    opened,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
          reject(new Error(`DevTools 연결이 열려 있지 않습니다: ${method}`));
          return;
        }
        const id = nextId++;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools 명령 시간이 초과됐습니다: ${method}`));
        }, 10_000);
        pending.set(id, { method, resolve, reject, timeout });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error);
        }
      });
    },
    waitForEvent(method, timeoutMs = 15_000) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`DevTools 이벤트 시간이 초과됐습니다: ${method}`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timeout);
          socket.removeEventListener('message', listener);
          socket.removeEventListener('close', onClose);
          socket.removeEventListener('error', onError);
        };
        const listener = (event) => {
          let message;
          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (message.method !== method) return;
          cleanup();
          resolve(message.params ?? {});
        };
        const onClose = () => {
          cleanup();
          reject(new Error(`DevTools 이벤트를 기다리는 중 연결이 닫혔습니다: ${method}`));
        };
        const onError = () => {
          cleanup();
          reject(new Error(`DevTools 이벤트를 기다리는 중 연결 오류가 발생했습니다: ${method}`));
        };
        socket.addEventListener('message', listener);
        socket.addEventListener('close', onClose, { once: true });
        socket.addEventListener('error', onError, { once: true });
      });
    },
    close() {
      socket.close();
    },
  };
}

async function waitForDevToolsPort(profilePath, child, getLaunchError) {
  const activePortPath = join(profilePath, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const launchError = getLaunchError();
    if (launchError) throw new Error(`Chromium을 실행하지 못했습니다: ${launchError.message}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Chromium이 조기에 종료됐습니다: ${child.exitCode ?? child.signalCode}`);
    }
    try {
      const [port] = (await readFile(activePortPath, 'utf8')).trim().split('\n');
      if (port) return port;
    } catch {
      // Chromium이 디버깅 포트를 열 때까지 짧게 기다립니다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve();
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once('exit', onExit);
  });
}

async function fetchJson(url, description) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`${description} 요청이 실패했습니다: HTTP ${response.status}`);
  return response.json();
}

const chromiumPath = process.env.SPINON_CHROMIUM_BIN
  ? resolve(process.env.SPINON_CHROMIUM_BIN)
  : await firstExistingPath(defaultChromiumPaths);
if (!chromiumPath) {
  throw new Error('Chromium을 찾지 못했습니다. SPINON_CHROMIUM_BIN에 실행 파일 경로를 지정하세요.');
}

const fixtureBytes = await readFile(fixturePath);
const captureBytes = await readFile(capturePath);
let fixture;
try {
  fixture = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fixtureBytes));
} catch {
  throw new Error('C04 fixture는 올바른 UTF-8 JSON이어야 합니다.');
}
if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
  throw new Error('C04 fixture 최상위 값은 객체여야 합니다.');
}
if (fixture.schema !== 'spinon-css-c04-cascade-fixture/v1') {
  throw new Error(`지원하지 않는 C04 fixture schema입니다: ${fixture.schema}`);
}
if (typeof fixture.documentBaseUrl !== 'string' || !fixture.documentBaseUrl) {
  throw new Error('C04 fixture에 documentBaseUrl이 필요합니다.');
}
try {
  new URL(fixture.documentBaseUrl);
} catch {
  throw new Error('C04 documentBaseUrl은 절대 URL이어야 합니다.');
}
if (!fixture.viewport || typeof fixture.viewport !== 'object' || Array.isArray(fixture.viewport)) {
  throw new Error('C04 fixture viewport는 객체여야 합니다.');
}
if (JSON.stringify(fixture.properties) !== JSON.stringify(expectedProperties)) {
  throw new Error('C04 관찰 속성 목록이 capture 도구 계약과 다릅니다.');
}
if (!Number.isInteger(fixture.viewport.widthCssPx) || fixture.viewport.widthCssPx <= 0
  || !Number.isInteger(fixture.viewport.heightCssPx) || fixture.viewport.heightCssPx <= 0
  || !Number.isFinite(fixture.viewport.deviceScaleFactor) || fixture.viewport.deviceScaleFactor <= 0
  || fixture.viewport.mediaType !== 'screen'
  || fixture.viewport.colorScheme !== 'light'
  || typeof fixture.viewport.locale !== 'string' || !fixture.viewport.locale
  || typeof fixture.viewport.timeZone !== 'string' || !fixture.viewport.timeZone) {
  throw new Error('C04 viewport 환경 설정이 유효하지 않습니다.');
}
if (!Array.isArray(fixture.authorStylesheets) || fixture.authorStylesheets.length === 0
  || fixture.authorStylesheets.some((stylesheet) => !stylesheet || typeof stylesheet !== 'object'
    || Array.isArray(stylesheet))) {
  throw new Error('C04 fixture에 author stylesheet가 없습니다.');
}
if (!Array.isArray(fixture.observations)) {
  throw new Error('C04 fixture 관찰 ID 목록은 배열이어야 합니다.');
}
const treeFixtureIds = [];
function collectFixtureIds(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error('모든 tree 항목은 요소 객체여야 합니다.');
  }
  if (typeof node.fixtureId !== 'string' || !node.fixtureId.trim()) {
    throw new Error('모든 tree 요소에 비어 있지 않은 fixtureId가 필요합니다.');
  }
  treeFixtureIds.push(node.fixtureId);
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new Error(`요소 자식 목록은 배열이어야 합니다: ${node.fixtureId}`);
  }
  for (const child of node.children ?? []) collectFixtureIds(child);
}
collectFixtureIds(fixture.tree);
if (new Set(treeFixtureIds).size !== treeFixtureIds.length) {
  throw new Error('tree 안에 중복 fixtureId가 있습니다.');
}
if (JSON.stringify(treeFixtureIds) !== JSON.stringify(fixture.observations)) {
  throw new Error('관찰 ID 목록이 tree의 요소 전체·순서와 다릅니다.');
}
if (new Set(fixture.authorStylesheets.map((stylesheet) => stylesheet.id)).size
  !== fixture.authorStylesheets.length) {
  throw new Error('author stylesheet ID가 중복됩니다.');
}
const stylesheetInputs = await Promise.all(fixture.authorStylesheets.map(async (stylesheet) => {
  if (typeof stylesheet.id !== 'string' || !stylesheet.id.trim()
    || typeof stylesheet.source !== 'string' || !stylesheet.source
    || typeof stylesheet.baseUrl !== 'string' || !stylesheet.baseUrl) {
    throw new Error('author stylesheet에는 비어 있지 않은 ID, source, baseUrl이 필요합니다.');
  }
  const relativePath = `tests/fixtures/css/c04/${stylesheet.source}`;
  const fixtureDirectory = resolve(repositoryRoot, 'tests/fixtures/css/c04');
  const path = resolve(repositoryRoot, relativePath);
  if (!path.startsWith(`${fixtureDirectory}/`)) {
    throw new Error(`fixture CSS 경로가 허용 디렉터리 밖입니다: ${stylesheet.source}`);
  }
  const [actualPath, actualFixtureDirectory] = await Promise.all([
    realpath(path),
    realpath(fixtureDirectory),
  ]);
  if (!actualPath.startsWith(`${actualFixtureDirectory}/`)) {
    throw new Error(`fixture CSS 경로가 symlink를 통해 허용 디렉터리 밖으로 나갑니다: ${stylesheet.source}`);
  }
  const bytes = await readFile(actualPath);
  let css;
  try {
    css = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`fixture CSS가 올바른 UTF-8이 아닙니다: ${stylesheet.source}`);
  }
  try {
    new URL(stylesheet.baseUrl);
  } catch {
    throw new Error(`stylesheet baseUrl은 절대 URL이어야 합니다: ${stylesheet.id}`);
  }
  if (/<\/style/i.test(css)) throw new Error(`stylesheet에 닫는 style 태그가 있습니다: ${stylesheet.source}`);
  if (/@import\b/i.test(css)) throw new Error(`외부 loader가 없는 fixture에서 @import를 허용하지 않습니다: ${stylesheet.source}`);
  return { ...stylesheet, path: relativePath, bytes, css, sha256: hashBytes(bytes) };
}));

const fixtureSha256 = hashBytes(fixtureBytes);
const captureSha256 = hashBytes(captureBytes);
const operatingSystem = {
  platform: process.platform,
  architecture: process.arch,
  release: osRelease(),
  kernelVersion: osVersion(),
  productVersion: process.platform === 'darwin'
    ? execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()
    : null,
  buildVersion: process.platform === 'darwin'
    ? execFileSync('sw_vers', ['-buildVersion'], { encoding: 'utf8' }).trim()
    : null,
};
const operatingSystemIdentity = hashBytes(Buffer.from(JSON.stringify(operatingSystem)));
const browserVersion = execFileSync(chromiumPath, ['--version'], { encoding: 'utf8' }).trim();
const browserSha256 = await hashFile(chromiumPath);
const browserScript = `
(() => {
  const encodeBase64 = (value) => {
    const bytes = new TextEncoder().encode(String(value));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  try {
    const fixture = ${jsonForScript(fixture)};
    const elementByFixtureId = new Map(
      Array.from(document.querySelectorAll('[data-c04-fixture-id]'), (element) => [
        element.getAttribute('data-c04-fixture-id'),
        element,
      ]),
    );
    const observations = fixture.observations.map((fixtureId) => {
      const element = elementByFixtureId.get(fixtureId);
      if (!element) throw new Error('관찰 요소가 없습니다: ' + fixtureId);
      const computed = getComputedStyle(element);
      return {
        fixtureId,
        properties: Object.fromEntries(fixture.properties.map((property) => [property, computed.getPropertyValue(property)])),
      };
    });
    const result = {
      schema: 'spinon-css-c04-cascade-reference/v1',
      fixtureId: fixture.fixtureId,
      viewport: {
        widthCssPx: innerWidth,
        heightCssPx: innerHeight,
        deviceScaleFactor: devicePixelRatio,
        screenMedia: matchMedia('screen').matches,
        lightColorScheme: matchMedia('(prefers-color-scheme: light)').matches,
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      observations,
    };
    document.querySelector('#c04-result').textContent = encodeBase64(JSON.stringify(result));
  } catch (error) {
    document.querySelector('#c04-result').textContent = encodeBase64(error);
  }
})();
`;
const html = `<!doctype html>
<html lang="${htmlEscape(fixture.viewport.locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${fixture.viewport.widthCssPx}, initial-scale=1">
  ${stylesheetInputs.map((stylesheet) => `<style>${stylesheet.css}</style>`).join('\n  ')}
</head>
<body>${renderNode(fixture.tree)}<pre id="c04-result"></pre><script>${browserScript}</script></body>
</html>`;

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'spinon-c04-cascade-'));
const profilePath = join(temporaryDirectory, 'profile');
let browserProcess;
let browserLaunchError;
let pageDevTools;
let captured;
let browserInformation;
let browserVersionInfo;
try {
  await mkdir(profilePath);
  await writeFile(join(temporaryDirectory, 'fixture.html'), html);
  const flags = [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    `--lang=${fixture.viewport.locale}`,
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
  ];
  browserProcess = spawn(chromiumPath, [...flags, 'about:blank'], {
    detached: true,
    env: { ...process.env, TZ: 'UTC' },
    stdio: 'ignore',
  });
  browserProcess.once('error', (error) => { browserLaunchError = error; });

  const port = await waitForDevToolsPort(profilePath, browserProcess, () => browserLaunchError);
  browserInformation = await fetchJson(`http://127.0.0.1:${port}/json/version`, 'DevTools 버전');
  const browserDevTools = connectDevTools(browserInformation.webSocketDebuggerUrl);
  await browserDevTools.opened;
  browserVersionInfo = await browserDevTools.send('Browser.getVersion');
  browserDevTools.close();

  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, 'DevTools 대상 목록');
  const target = targets.find((candidate) => candidate.type === 'page');
  if (!target) throw new Error('Chromium page target을 찾지 못했습니다.');
  pageDevTools = connectDevTools(target.webSocketDebuggerUrl);
  await pageDevTools.opened;
  await pageDevTools.send('Page.enable');
  await pageDevTools.send('Network.enable');
  await pageDevTools.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await pageDevTools.send('Runtime.enable');
  await pageDevTools.send('Emulation.setDeviceMetricsOverride', {
    width: fixture.viewport.widthCssPx,
    height: fixture.viewport.heightCssPx,
    deviceScaleFactor: fixture.viewport.deviceScaleFactor,
    mobile: false,
    screenWidth: fixture.viewport.widthCssPx,
    screenHeight: fixture.viewport.heightCssPx,
  });
  await pageDevTools.send('Emulation.setLocaleOverride', { locale: fixture.viewport.locale });
  await pageDevTools.send('Emulation.setUserAgentOverride', {
    userAgent: browserVersionInfo.userAgent,
    acceptLanguage: fixture.viewport.locale,
  });
  await pageDevTools.send('Emulation.setTimezoneOverride', { timezoneId: fixture.viewport.timeZone });
  await pageDevTools.send('Emulation.setEmulatedMedia', {
    media: fixture.viewport.mediaType,
    features: [{ name: 'prefers-color-scheme', value: fixture.viewport.colorScheme }],
  });

  const pageLoaded = pageDevTools.waitForEvent('Page.loadEventFired');
  await pageDevTools.send('Page.navigate', {
    url: pathToFileURL(join(temporaryDirectory, 'fixture.html')).href,
  });
  await pageLoaded;
  const evaluation = await pageDevTools.send('Runtime.evaluate', {
    expression: 'document.querySelector("#c04-result")?.textContent ?? ""',
    returnByValue: true,
  });
  const encoded = evaluation.result?.value;
  if (evaluation.exceptionDetails || typeof encoded !== 'string' || !encoded) {
    throw new Error('Chromium fixture 결과를 읽지 못했습니다.');
  }
  try {
    captured = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error(`Chromium fixture 실행 오류: ${Buffer.from(encoded, 'base64').toString('utf8')}`);
  }
} finally {
  try {
    pageDevTools?.close();
  } finally {
    try {
      stopBrowser(browserProcess, 'SIGTERM');
      await waitForExit(browserProcess, 2_000);
      stopBrowser(browserProcess, 'SIGKILL');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

if (captured.schema !== 'spinon-css-c04-cascade-reference/v1' || captured.fixtureId !== fixture.fixtureId) {
  throw new Error(`Chromium reference schema/fixture ID가 다릅니다: ${JSON.stringify(captured)}`);
}
const viewportChecks = {
  widthCssPx: fixture.viewport.widthCssPx,
  heightCssPx: fixture.viewport.heightCssPx,
  deviceScaleFactor: fixture.viewport.deviceScaleFactor,
  screenMedia: fixture.viewport.mediaType === 'screen',
  lightColorScheme: fixture.viewport.colorScheme === 'light',
  locale: fixture.viewport.locale,
  timeZone: fixture.viewport.timeZone,
};
for (const [key, expected] of Object.entries(viewportChecks)) {
  if (captured.viewport[key] !== expected) {
    throw new Error(`Chromium 환경이 fixture와 다릅니다 (${key}: ${captured.viewport[key]}, 기대값: ${expected}).`);
  }
}
if (captured.observations.length !== fixture.observations.length) {
  throw new Error('Chromium 관찰 요소 수가 fixture와 다릅니다.');
}
for (const [index, observation] of captured.observations.entries()) {
  if (observation.fixtureId !== fixture.observations[index]) {
    throw new Error(`관찰 요소 순서가 다릅니다: ${observation.fixtureId}`);
  }
  const propertyNames = Object.keys(observation.properties);
  if (JSON.stringify(propertyNames) !== JSON.stringify(expectedProperties)) {
    throw new Error(`관찰 속성 목록이 다릅니다: ${observation.fixtureId}`);
  }
}

const versionNumber = browserVersionInfo.product.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
if (!versionNumber || !browserVersion.includes(versionNumber)) {
  throw new Error(`Chromium CLI/CDP 버전이 다릅니다: ${browserVersion}/${browserVersionInfo.product}`);
}
const stylesheetIdentity = hashBytes(Buffer.from(stylesheetInputs
  .map((stylesheet) => `${stylesheet.id}:${stylesheet.sha256}`)
  .join('\n')));
const operatingSystemLabel = `${process.platform}-${process.arch}-${osRelease()}${operatingSystem.productVersion ? `-macos-${operatingSystem.productVersion}` : ''}`;
const referenceId = `chromium-${operatingSystemLabel}-${versionNumber}-c04-cascade-v1-${fixtureSha256.slice(0, 12)}-${stylesheetIdentity.slice(0, 12)}-${captureSha256.slice(0, 12)}-${operatingSystemIdentity.slice(0, 12)}-${browserSha256.slice(0, 12)}`;
const referenceDirectory = join(repositoryRoot, 'tests/fixtures/css/references', referenceId);
const referencePath = join(referenceDirectory, 'computed-styles.json');
try {
  await access(referencePath);
  throw new Error(`기존 Chromium reference를 덮어쓰지 않습니다: ${referencePath}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(referenceDirectory, { recursive: false });
const output = {
  schema: 'spinon-css-c04-cascade-reference/v1',
  referenceId,
  fixture: {
    path: fixtureRelativePath,
    sha256: fixtureSha256,
    documentBaseUrl: fixture.documentBaseUrl,
  },
  stylesheets: stylesheetInputs.map(({ id, path, baseUrl, sha256 }) => ({ id, path, baseUrl, sha256 })),
  capture: {
    path: captureRelativePath,
    sha256: captureSha256,
    nodeVersion: process.version,
    operatingSystem,
    networkMode: 'offline',
    timeZone: fixture.viewport.timeZone,
  },
  browser: {
    path: chromiumPath,
    version: browserVersionInfo.product,
    revision: browserVersionInfo.revision,
    userAgent: browserVersionInfo.userAgent,
    javascriptVersion: browserVersionInfo.jsVersion,
    sha256: browserSha256,
  },
  viewport: captured.viewport,
  observations: captured.observations,
};
await writeFile(referencePath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
console.log(`Chromium reference 저장: ${referencePath}`);
console.log(`browser=${browserVersionInfo.product}`);
console.log(`fixture=${hashBytes(fixtureBytes)}`);
console.log(`stylesheets=${stylesheetInputs.length}`);
console.log(`observations=${captured.observations.length}`);
