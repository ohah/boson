import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { release as osRelease, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRelativePath = 'tests/fixtures/css/c01/layout-units-flex-grid.html';
const fixturePath = join(repositoryRoot, fixtureRelativePath);
const inventoryRelativePath = 'tests/fixtures/css/c01/layout-inventory.v1.json';
const inventoryPath = join(repositoryRoot, inventoryRelativePath);
const captureRelativePath = 'tools/css-reference/capture-layout.mjs';
const expectedFixtureSha256 = '778a2065ac587621a978f367e67cf1372b517e4316a2942723c40d82b6352659';
const expectedInventorySha256 = 'ef6d0b87a506e5418d8db75c3f8faabf8626690b16e7504f54500ee59de6e1ff';
const chromiumPaths = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  : process.platform === 'linux'
    ? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
    : [];
const expectedCaseIds = [
  'relative-units',
  'percentage-content-box',
  'flex-fractional-growth',
  'flex-wrap-gap',
  'grid-fractional-tracks',
];
const expectedViewport = { width: 800, height: 600, deviceScaleFactor: 1 };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const eventListeners = new Map();
  let nextId = 1;

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Chromium DevTools 연결에 실패했습니다.')), { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timeout);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`DevTools ${request.method}: ${message.error.message}`));
      else request.resolve(message.result ?? {});
      return;
    }
    const listeners = eventListeners.get(message.method);
    if (!listeners) return;
    eventListeners.delete(message.method);
    for (const listener of listeners) listener(message.params ?? {});
  });

  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error('Chromium DevTools 연결이 닫혔습니다.'));
    }
    pending.clear();
  });

  return {
    opened,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Chromium DevTools 명령 시간이 초과됐습니다: ${method}`));
        }, 10_000);
        pending.set(id, { method, resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    waitForEvent(method) {
      return new Promise((resolve) => {
        const listeners = eventListeners.get(method) ?? [];
        listeners.push(resolve);
        eventListeners.set(method, listeners);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function waitForDevToolsPort(profilePath, child) {
  const activePortPath = join(profilePath, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Chromium이 조기에 종료됐습니다: ${child.exitCode}`);
    try {
      const [port, browserPath] = (await readFile(activePortPath, 'utf8')).trim().split('\n');
      if (port && browserPath) return { port, browserPath };
    } catch {
      // Chromium이 디버깅 포트를 열 때까지 기다립니다.
    }
    await sleep(100);
  }
  throw new Error('Chromium DevTools 포트를 열지 못했습니다.');
}

function killBrowserProcessGroup(child, signal) {
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
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(timeoutMs),
  ]);
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function validateInventory(inventory) {
  if (inventory?.schema !== 'spinon-css-layout-inventory/v1'
    || inventory.inventoryId !== inventory.fixtureId
    || inventory.fixtureId !== 'C01-layout-units-flex-grid-v1'
    || inventory.completeness !== 'partial') {
    throw new Error('C01 레이아웃 inventory schema·ID·부분 범위가 고정 기준과 다릅니다.');
  }
  if (!Array.isArray(inventory.contextFeatures) || inventory.contextFeatures.length === 0
    || !Array.isArray(inventory.cases) || inventory.cases.length !== expectedCaseIds.length) {
    throw new Error('C01 레이아웃 inventory의 문맥 feature 또는 case가 비어 있습니다.');
  }
  if (JSON.stringify(inventory.cases.map((testCase) => testCase.id)) !== JSON.stringify(expectedCaseIds)) {
    throw new Error('C01 레이아웃 inventory의 case 순서 또는 범위가 다릅니다.');
  }
  if (inventory.comparison?.computedValues !== '계산 CSSStyleDeclaration 값의 앞뒤 공백 제거 후 문자열 정확 일치'
    || inventory.comparison.nodeGeometry?.unit !== 'CSS px'
    || inventory.comparison.nodeGeometry?.perCoordinateMaximumAbsoluteError !== 0.5
    || inventory.comparison.nodeGeometry?.aggregateAveragesAllowed !== false) {
    throw new Error('C01 레이아웃 비교 기준이 고정 계약과 다릅니다.');
  }
  const nodeIds = new Set();
  const featureIds = new Set();
  for (const feature of inventory.contextFeatures ?? []) {
    if (!/^[a-z][a-z0-9.-]*$/.test(feature.id) || featureIds.has(feature.id)
      || typeof feature.selector !== 'string'
      || !/^(?:[a-z][a-z0-9-]*|--[a-z][a-z0-9-]*)$/.test(feature.property)) {
      throw new Error(`C01 문맥 feature가 비었거나 중복됐습니다: ${feature.id}`);
    }
    featureIds.add(feature.id);
  }
  for (const testCase of inventory.cases) {
    if (!Array.isArray(testCase.nodes) || testCase.nodes.length === 0) {
      throw new Error(`C01 레이아웃 case에 node가 없습니다: ${testCase.id}`);
    }
    for (const node of testCase.nodes) {
      if (!/^[a-z][a-z0-9-]*$/.test(node.id) || nodeIds.has(node.id)) {
        throw new Error(`C01 레이아웃 node ID가 비었거나 중복입니다: ${node.id}`);
      }
      nodeIds.add(node.id);
      if (!Array.isArray(node.features) || node.features.length === 0) {
        throw new Error(`C01 레이아웃 node에 computed feature가 없습니다: ${node.id}`);
      }
      for (const feature of node.features) {
        if (!/^[a-z][a-z0-9.-]*$/.test(feature.id) || featureIds.has(feature.id)
          || !/^(?:[a-z][a-z0-9-]*|--[a-z][a-z0-9-]*)$/.test(feature.property)) {
          throw new Error(`C01 레이아웃 feature가 비었거나 중복됐습니다: ${feature.id}`);
        }
        featureIds.add(feature.id);
      }
    }
  }
  if (!Array.isArray(inventory.uncovered) || inventory.uncovered.length === 0) {
    throw new Error('부분 inventory에서 미포함 범위를 설명해야 합니다.');
  }
  return inventory;
}

function validateObservation(observation, inventory) {
  if (observation?.fixtureId !== inventory.fixtureId || observation.inventoryId !== inventory.inventoryId) {
    throw new Error('Chromium fixture 결과의 ID가 inventory와 다릅니다.');
  }
  if (JSON.stringify(observation.viewport) !== JSON.stringify(expectedViewport)) {
    throw new Error(`CSS viewport·배율이 고정값과 다릅니다: ${JSON.stringify(observation.viewport)}`);
  }
  if (observation.environment?.locale !== 'en-US' || observation.environment?.intlLocale !== 'en-US'
    || observation.environment?.timeZone !== 'UTC' || observation.environment?.dark !== false
    || observation.environment?.reducedMotion !== false || observation.environment?.forcedColors !== false) {
    throw new Error(`Chromium locale·time zone·미디어 상태가 다릅니다: ${JSON.stringify(observation.environment)}`);
  }
  if (!Array.isArray(observation.contextFeatures) || !Array.isArray(observation.cases)) {
    throw new Error('Chromium fixture가 문맥 feature 또는 case 결과를 반환하지 않았습니다.');
  }
  const expectedContext = inventory.contextFeatures.map(({ id, selector, property }) => ({ id, selector, property }));
  const observedContext = observation.contextFeatures.map(({ id, selector, property }) => ({ id, selector, property }));
  if (JSON.stringify(observedContext) !== JSON.stringify(expectedContext)) {
    throw new Error('Chromium fixture의 문맥 feature가 inventory와 다릅니다.');
  }
  if (observation.contextFeatures.some((feature) => typeof feature.value !== 'string' || feature.value === '')
    || observation.contextFeatures.find((feature) => feature.id === 'units.root.font-size.v1')?.value !== '20px') {
    throw new Error('루트 font-size 기준값을 수집하지 못했습니다.');
  }
  if (JSON.stringify(observation.cases.map((testCase) => testCase.id)) !== JSON.stringify(expectedCaseIds)) {
    throw new Error('Chromium fixture가 inventory의 case를 그대로 관찰하지 않았습니다.');
  }
  for (const [caseIndex, testCase] of inventory.cases.entries()) {
    const measuredCase = observation.cases[caseIndex];
    if (JSON.stringify(measuredCase.nodes.map((node) => node.id))
      !== JSON.stringify(testCase.nodes.map((node) => node.id))) {
      throw new Error(`Chromium fixture node ID가 inventory와 다릅니다: ${testCase.id}`);
    }
    for (const [nodeIndex, expectedNode] of testCase.nodes.entries()) {
      const measuredNode = measuredCase.nodes[nodeIndex];
      if (JSON.stringify(measuredNode.features.map(({ id, property }) => ({ id, property })))
        !== JSON.stringify(expectedNode.features)) {
        throw new Error(`Chromium fixture feature가 inventory와 다릅니다: ${expectedNode.id}`);
      }
      if (measuredNode.features.some((feature) => typeof feature.value !== 'string' || feature.value === '')) {
        throw new Error(`계산값이 비어 있습니다: ${expectedNode.id}`);
      }
      if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(measuredNode.rect?.[key]))) {
        throw new Error(`CSS px 좌표를 읽지 못했습니다: ${expectedNode.id}`);
      }
    }
  }
}

const chromiumPath = process.env.SPINON_CHROMIUM_BIN ?? await firstExistingPath(chromiumPaths);
if (!chromiumPath) throw new Error('Chromium 실행 파일을 찾지 못했습니다. SPINON_CHROMIUM_BIN으로 지정하세요.');

const inventoryBytes = await readFile(inventoryPath);
const inventory = validateInventory(JSON.parse(inventoryBytes.toString('utf8')));
const inventorySha256 = createHash('sha256').update(inventoryBytes).digest('hex');
if (inventorySha256 !== expectedInventorySha256) {
  throw new Error(`C01 layout inventory가 고정 입력과 다릅니다. 새 버전과 기준 ID를 정하세요: ${inventorySha256}`);
}
const fixtureBytes = await readFile(fixturePath);
const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
if (fixtureSha256 !== expectedFixtureSha256) {
  throw new Error(`C01 layout fixture가 고정 입력과 다릅니다. 새 기준 ID를 정하세요: ${fixtureSha256}`);
}
const versionResult = spawnSync(chromiumPath, ['--version'], { encoding: 'utf8' });
if (versionResult.error || versionResult.status !== 0) {
  throw new Error(`Chromium 버전을 읽지 못했습니다: ${versionResult.error?.message ?? versionResult.stderr}`);
}
const version = versionResult.stdout.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
if (!version) throw new Error(`Chromium 버전 형식을 확인할 수 없습니다: ${versionResult.stdout.trim()}`);

const profilePath = await mkdtemp(join(tmpdir(), 'spinon-css-c01-layout-'));
const flags = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--lang=en-US',
  '--remote-debugging-port=0',
  '--user-data-dir=<temporary-profile>',
];
let browserProcess;
let browserDevTools;
let pageDevTools;

try {
  browserProcess = spawn(
    chromiumPath,
    [
      ...flags.filter((flag) => !flag.startsWith('--user-data-dir=')),
      `--user-data-dir=${profilePath}`,
      'about:blank',
    ],
    { detached: true, env: { ...process.env, TZ: 'UTC' }, stdio: 'ignore' },
  );
  browserProcess.once('error', (error) => console.error('Chromium 실행 오류:', error.message));

  const { port } = await waitForDevToolsPort(profilePath, browserProcess);
  const browserInformation = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
  browserDevTools = connectDevTools(browserInformation.webSocketDebuggerUrl);
  await browserDevTools.opened;
  const browserVersion = await browserDevTools.send('Browser.getVersion');
  const browserVersionNumber = browserVersion.product.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
  if (browserVersionNumber !== version) {
    throw new Error(`Chromium CLI/CDP 버전이 다릅니다: ${version}/${browserVersion.product}`);
  }

  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((candidate) => candidate.type === 'page');
  if (!target) throw new Error('Chromium 페이지 target을 찾지 못했습니다.');
  pageDevTools = connectDevTools(target.webSocketDebuggerUrl);
  await pageDevTools.opened;
  await pageDevTools.send('Page.enable');
  await pageDevTools.send('Runtime.enable');
  await pageDevTools.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const deepFreeze = (value) => {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
          Object.freeze(value);
          for (const child of Object.values(value)) deepFreeze(child);
        }
        return value;
      };
      Object.defineProperty(globalThis, '__SPINON_C01_LAYOUT_INVENTORY__', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: deepFreeze(${JSON.stringify(inventory)}),
      });
      addEventListener('error', (event) => {
        globalThis.__SPINON_C01_LAYOUT_ERROR__ = event.message;
      });
    })();`,
  });
  await pageDevTools.send('Emulation.setDeviceMetricsOverride', {
    width: expectedViewport.width,
    height: expectedViewport.height,
    deviceScaleFactor: expectedViewport.deviceScaleFactor,
    mobile: false,
    screenWidth: expectedViewport.width,
    screenHeight: expectedViewport.height,
  });
  await pageDevTools.send('Emulation.setLocaleOverride', { locale: 'en-US' });
  await pageDevTools.send('Emulation.setUserAgentOverride', {
    userAgent: browserVersion.userAgent,
    acceptLanguage: 'en-US',
  });
  await pageDevTools.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  await pageDevTools.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
      { name: 'forced-colors', value: 'none' },
    ],
  });

  const pageLoaded = pageDevTools.waitForEvent('Page.loadEventFired');
  await pageDevTools.send('Page.navigate', { url: pathToFileURL(fixturePath).href });
  await pageLoaded;
  const evaluation = await pageDevTools.send('Runtime.evaluate', {
    expression: 'document.querySelector("#reference-result")?.textContent ?? ""',
    returnByValue: true,
  });
  const encoded = evaluation.result?.value;
  if (evaluation.exceptionDetails || typeof encoded !== 'string' || !encoded) {
    const pageState = await pageDevTools.send('Runtime.evaluate', {
      expression: `({ url: location.href, title: document.title, readyState: document.readyState,
        scriptCount: document.scripts.length, injectedInventory: window.__SPINON_C01_LAYOUT_INVENTORY__?.inventoryId ?? null,
        resultLength: document.querySelector("#reference-result")?.textContent.length ?? null,
        pageError: window.__SPINON_C01_LAYOUT_ERROR__ ?? null })`,
      returnByValue: true,
    });
    throw new Error(`Chromium fixture 결과를 읽지 못했습니다: ${JSON.stringify({
      exception: evaluation.exceptionDetails?.text ?? null,
      state: pageState.result?.value ?? null,
    })}`);
  }
  const observation = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  validateObservation(observation, inventory);

  const platformId = process.platform === 'darwin' ? 'macos' : process.platform;
  let hostVersion = `${process.platform} ${osRelease()}`;
  let hostBuild = null;
  if (process.platform === 'darwin') {
    const productVersion = spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' });
    const buildVersion = spawnSync('/usr/bin/sw_vers', ['-buildVersion'], { encoding: 'utf8' });
    if (productVersion.status === 0 && buildVersion.status === 0) {
      hostVersion = `macOS ${productVersion.stdout.trim()}`;
      hostBuild = buildVersion.stdout.trim();
    }
  }
  const osIdentity = [hostVersion, hostBuild].filter(Boolean).join('-').replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
  const captureSha256 = await sha256File(fileURLToPath(import.meta.url));
  const executableSha256 = await sha256File(chromiumPath);
  const referenceId = `chromium-${platformId}-${process.arch}-${osIdentity}-${version}-layout-v1-${fixtureSha256.slice(0, 12)}-inventory-${inventorySha256.slice(0, 12)}-capture-${captureSha256.slice(0, 12)}-bin-${executableSha256.slice(0, 12)}`;
  const outputDirectory = join(repositoryRoot, 'tests/fixtures/css/references', referenceId);
  const outputPath = join(outputDirectory, 'core-layout.json');
  try {
    await access(outputPath);
    throw new Error(`기준 스냅샷은 덮어쓰지 않습니다: ${outputPath}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const snapshot = {
    schema: 'spinon-css-reference/v1',
    referenceId,
    captureTool: {
      path: captureRelativePath,
      sha256: captureSha256,
      inventorySha256,
    },
    oracle: {
      name: 'Chromium',
      product: versionResult.stdout.trim(),
      version,
      revision: browserVersion.revision,
      executable: chromiumPath,
      executableSha256,
    },
    environment: {
      os: hostVersion,
      osBuild: hostBuild,
      architecture: process.arch,
      nodeVersion: process.version,
      flags,
      emulation: {
        cssViewportPx: { width: expectedViewport.width, height: expectedViewport.height },
        deviceScaleFactor: expectedViewport.deviceScaleFactor,
        locale: 'en-US',
        timeZone: 'UTC',
        media: {
          prefersColorScheme: 'light',
          prefersReducedMotion: 'no-preference',
          forcedColors: 'none',
        },
      },
    },
    fixture: {
      id: inventory.fixtureId,
      path: fixtureRelativePath,
      sha256: fixtureSha256,
      inventoryPath: inventoryRelativePath,
      inventoryId: inventory.inventoryId,
      inventorySha256,
      completeness: inventory.completeness,
      comparison: inventory.comparison,
      uncovered: inventory.uncovered,
    },
    observations: observation,
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
  const nodeCount = observation.cases.reduce((count, item) => count + item.nodes.length, 0);
  const featureCount = observation.contextFeatures.length
    + observation.cases.reduce((count, item) => count + item.nodes.reduce((nodeCount, node) => nodeCount + node.features.length, 0), 0);
  console.log(`저장: ${outputPath}`);
  console.log(`Chromium: ${version} ${browserVersion.revision}`);
  console.log(`case ${observation.cases.length}개, node ${nodeCount}개, computed 값 ${featureCount}개 관찰`);
} finally {
  pageDevTools?.close();
  browserDevTools?.close();
  if (browserProcess) {
    killBrowserProcessGroup(browserProcess, 'SIGTERM');
    await waitForExit(browserProcess, 2_000);
    killBrowserProcessGroup(browserProcess, 'SIGKILL');
  }
  await rm(profilePath, { recursive: true, force: true });
}
