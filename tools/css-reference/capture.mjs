import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRelativePath = 'tests/fixtures/css/c01/supported-html-ua.html';
const fixturePath = join(repositoryRoot, fixtureRelativePath);
const uaCssRelativePath = 'crates/spinon-style/resources/ua/supported-elements-v0.css';
const uaCssPath = join(repositoryRoot, uaCssRelativePath);
const captureScriptRelativePath = 'tools/css-reference/capture.mjs';
const comparisonBaselineCss = `
* {
  display: table;
  list-style-type: none;
  margin-block-start: 0px;
  margin-block-end: 0px;
  margin-inline-start: 1px;
  margin-inline-end: 1px;
  padding-inline-start: 0px;
}`;
const expectedSelectorIds = {
  div: ['ua-div'],
  span: ['ua-span'],
  a: ['ua-anchor'],
  img: ['ua-image'],
  button: ['ua-button'],
  input: ['ua-input'],
  p: ['ua-paragraph'],
  ul: ['ua-list'],
  li: ['ua-list-item'],
};
const expectedComputedFeatureIds = [
  'ua.display.div.v0',
  'ua.display.span.v0',
  'ua.display.a.v0',
  'ua.display.img.v0',
  'ua.display.button.v0',
  'ua.display.input.v0',
  'ua.display.p.v0',
  'ua.margin-block-start.p.v0',
  'ua.margin-block-end.p.v0',
  'ua.margin-inline-start.p.v0',
  'ua.margin-inline-end.p.v0',
  'ua.display.ul.v0',
  'ua.list-style-type.ul.v0',
  'ua.margin-block-start.ul.v0',
  'ua.margin-block-end.ul.v0',
  'ua.margin-inline-start.ul.v0',
  'ua.margin-inline-end.ul.v0',
  'ua.padding-inline-start.ul.v0',
  'ua.display.li.v0',
];
const expectedProfileCssSha256 = 'bd15dd612a21cc8cb48e25eb38b86803868667df75cd56f111d7c476ddba3ebd';
const defaultChromiumPaths = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  : process.platform === 'linux'
    ? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
    : [];

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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
      // Chromium이 디버깅 포트를 열 때까지 짧게 기다립니다.
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

const chromiumPath = process.env.SPINON_CHROMIUM_BIN
  ?? await firstExistingPath(defaultChromiumPaths);
if (!chromiumPath) {
  throw new Error('Chromium 실행 파일을 찾지 못했습니다. SPINON_CHROMIUM_BIN으로 지정하세요.');
}

const versionResult = spawnSync(chromiumPath, ['--version'], { encoding: 'utf8' });
if (versionResult.error || versionResult.status !== 0) {
  throw new Error(`Chromium 버전을 읽지 못했습니다: ${versionResult.error?.message ?? versionResult.stderr}`);
}
const version = versionResult.stdout.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
if (!version) throw new Error(`Chromium 버전 형식을 확인할 수 없습니다: ${versionResult.stdout.trim()}`);

const profilePath = await mkdtemp(join(tmpdir(), 'spinon-css-c01-'));
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
  browserProcess.once('error', (error) => {
    console.error('Chromium 프로세스를 실행하지 못했습니다:', error.message);
  });

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
  await pageDevTools.send('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 800,
    screenHeight: 600,
  });
  await pageDevTools.send('Emulation.setLocaleOverride', { locale: 'en-US' });
  await pageDevTools.send('Emulation.setUserAgentOverride', {
    userAgent: browserVersion.userAgent,
    acceptLanguage: 'en-US',
    platform: 'MacIntel',
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
    throw new Error('Chromium fixture 결과를 읽지 못했습니다.');
  }
  const observation = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  if (observation.fixtureId !== 'C01-UAv0-supported-html-elements') {
    throw new Error(`예상하지 않은 fixture 결과: ${observation.fixtureId}`);
  }
  if (observation.viewport.width !== 800 || observation.viewport.height !== 600) {
    throw new Error(`CSS viewport가 고정값과 다릅니다: ${JSON.stringify(observation.viewport)}`);
  }
  if (observation.viewport.deviceScaleFactor !== 1) {
    throw new Error(`deviceScaleFactor가 1이 아닙니다: ${observation.viewport.deviceScaleFactor}`);
  }
  if (observation.locale !== 'en-US' || observation.intlLocale !== 'en-US'
    || observation.documentLanguage !== 'en' || observation.timeZone !== 'UTC') {
    throw new Error(`locale/time zone이 고정값과 다릅니다: ${JSON.stringify({
      locale: observation.locale,
      intlLocale: observation.intlLocale,
      documentLanguage: observation.documentLanguage,
      timeZone: observation.timeZone,
    })}`);
  }
  if (observation.media.prefersColorSchemeDark !== false
    || observation.media.prefersReducedMotion !== false
    || observation.media.forcedColors !== false) {
    throw new Error(`미디어 상태가 고정값과 다릅니다: ${JSON.stringify(observation.media)}`);
  }
  if (observation.authorStyleSheetCount !== 0) {
    throw new Error(`fixture에 author stylesheet가 있습니다: ${observation.authorStyleSheetCount}`);
  }
  const observedSelectors = observation.elements.map((element) => element.selector);
  const expectedSelectors = Object.keys(expectedSelectorIds);
  if (JSON.stringify(observedSelectors) !== JSON.stringify(expectedSelectors)) {
    throw new Error(`fixture 선택자 목록이 고정 입력과 다릅니다: ${JSON.stringify(observedSelectors)}`);
  }
  const observedFeatureIds = observation.elements.flatMap((element) => element.features.map((feature) => feature.id));
  if (JSON.stringify(observedFeatureIds) !== JSON.stringify(expectedComputedFeatureIds)) {
    throw new Error(`fixture CSS feature inventory가 고정 입력과 다릅니다: ${JSON.stringify(observedFeatureIds)}`);
  }
  const fontEvaluation = await pageDevTools.send('Runtime.evaluate', {
    expression: `({
      root: getComputedStyle(document.documentElement).fontSize,
      body: getComputedStyle(document.body).fontSize,
    })`,
    returnByValue: true,
  });
  const defaultFontSizes = fontEvaluation.result?.value;
  if (fontEvaluation.exceptionDetails || defaultFontSizes?.root !== '16px' || defaultFontSizes?.body !== '16px') {
    throw new Error(`기본 글꼴 크기가 고정값과 다릅니다: ${JSON.stringify(defaultFontSizes)}`);
  }

  const profileCss = await readFile(uaCssPath, 'utf8');
  const profileCssSha256 = createHash('sha256').update(profileCss).digest('hex');
  if (profileCssSha256 !== expectedProfileCssSha256) {
    throw new Error(`고정된 CSS 프로필이 바뀌었습니다. 새 프로필·feature inventory·reference-id를 정하세요: ${profileCssSha256}`);
  }
  const baselineCssSha256 = createHash('sha256').update(comparisonBaselineCss).digest('hex');
  const profileEvaluation = await pageDevTools.send('Runtime.evaluate', {
    expression: `(() => {
      const baseline = document.createElement('style');
      baseline.id = 'spinon-c01-baseline-under-test';
      baseline.textContent = ${JSON.stringify(comparisonBaselineCss)};
      document.head.appendChild(baseline);
      const baselineAuthorStyleSheetCount = document.styleSheets.length;
      const baselineElements = window.__SPINON_C01_OBSERVE__();
      const style = document.createElement('style');
      style.id = 'spinon-ua-profile-under-test';
      style.textContent = ${JSON.stringify(profileCss)};
      document.head.appendChild(style);
      return {
        baselineAuthorStyleSheetCount,
        authorStyleSheetCount: document.styleSheets.length,
        baselineElements,
        elements: window.__SPINON_C01_OBSERVE__(),
      };
    })()`,
    returnByValue: true,
  });
  const profileObservation = profileEvaluation.result?.value;
  if (profileEvaluation.exceptionDetails || !profileObservation) {
    throw new Error('내장 UA stylesheet 프로필의 관찰값을 읽지 못했습니다.');
  }
  if (profileObservation.baselineAuthorStyleSheetCount !== 1 || profileObservation.authorStyleSheetCount !== 2) {
    throw new Error(`비교 stylesheet 수가 예상과 다릅니다: ${JSON.stringify({
      baseline: profileObservation.baselineAuthorStyleSheetCount,
      profile: profileObservation.authorStyleSheetCount,
    })}`);
  }

  const comparedFeatures = [];
  const selectorCoverage = [];
  for (const referenceElement of observation.elements) {
    const baselineElement = profileObservation.baselineElements.find((item) => item.selector === referenceElement.selector);
    const profileElement = profileObservation.elements.find((item) => item.selector === referenceElement.selector);
    const expectedIds = expectedSelectorIds[referenceElement.selector];
    const referenceIds = referenceElement.matches.map((item) => item.id);
    const baselineIds = baselineElement?.matches.map((item) => item.id) ?? [];
    const profileIds = profileElement?.matches.map((item) => item.id) ?? [];
    const exactFixtureNodes = Boolean(expectedIds)
      && JSON.stringify(referenceIds) === JSON.stringify(expectedIds)
      && JSON.stringify(baselineIds) === JSON.stringify(expectedIds)
      && JSON.stringify(profileIds) === JSON.stringify(expectedIds);
    selectorCoverage.push({
      selector: referenceElement.selector,
      expectedNodeIds: expectedIds ?? [],
      chromiumNodeIds: referenceIds,
      profileNodeIds: profileIds,
      exactFixtureNodes,
    });
    if (!exactFixtureNodes) {
      throw new Error(`fixture 선택자 범위가 예상과 다릅니다: ${JSON.stringify(selectorCoverage.at(-1))}`);
    }
    for (const referenceNode of referenceElement.matches) {
      const baselineNode = baselineElement?.matches.find((item) => item.id === referenceNode.id);
      const profileNode = profileElement?.matches.find((item) => item.id === referenceNode.id);
      for (const feature of referenceElement.features) {
        const expected = referenceNode.computed[feature.property];
        const baseline = baselineNode?.computed[feature.property] ?? null;
        const actual = profileNode?.computed[feature.property] ?? null;
        const baselineDiffers = baseline !== expected;
        comparedFeatures.push({
          id: feature.id,
          selector: referenceElement.selector,
          nodeId: referenceNode.id,
          property: feature.property,
          reference: expected,
          baseline,
          baselineDiffers,
          profile: actual,
          equal: actual === expected,
        });
      }
    }
  }
  const failedFeatures = comparedFeatures.filter((feature) => !feature.equal || !feature.baselineDiffers);
  if (failedFeatures.length > 0) {
    throw new Error(`Chromium과 UA 프로필이 다릅니다: ${JSON.stringify(failedFeatures)}`);
  }

  const fixtureBytes = await readFile(fixturePath);
  const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
  const platformId = process.platform === 'darwin' ? 'macos' : process.platform;
  const referenceId = `chromium-${platformId}-${process.arch}-${version}-ua-profile-override-v1`;
  const outputDirectory = join(repositoryRoot, 'tests/fixtures/css/references', referenceId);
  const outputPath = join(outputDirectory, 'ua-supported-elements.json');
  try {
    await access(outputPath);
    throw new Error(`기준 스냅샷은 덮어쓰지 않습니다: ${outputPath}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let hostVersion = `${process.platform} ${process.version}`;
  let hostBuild = null;
  if (process.platform === 'darwin') {
    const productVersion = spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' });
    const buildVersion = spawnSync('/usr/bin/sw_vers', ['-buildVersion'], { encoding: 'utf8' });
    if (productVersion.status === 0 && buildVersion.status === 0) {
      hostVersion = `macOS ${productVersion.stdout.trim()}`;
      hostBuild = buildVersion.stdout.trim();
    }
  }

  const snapshot = {
    schema: 'spinon-css-reference/v1',
    referenceId,
    captureTool: {
      path: captureScriptRelativePath,
      sha256: await sha256File(fileURLToPath(import.meta.url)),
    },
    oracle: {
      name: 'Chromium',
      product: versionResult.stdout.trim(),
      version,
      revision: browserVersion.revision,
      executable: chromiumPath,
      executableSha256: await sha256File(chromiumPath),
    },
    environment: {
      os: hostVersion,
      osBuild: hostBuild,
      architecture: process.arch,
      nodeVersion: process.version,
      flags,
      defaultFontSize: defaultFontSizes,
      emulation: {
        cssViewportPx: { width: 800, height: 600 },
        deviceScaleFactor: 1,
        locale: 'en-US',
        timeZone: 'UTC',
        media: {
          prefersColorScheme: 'light',
          prefersReducedMotion: 'no-preference',
          forcedColors: 'none',
        },
      },
      userAgent: observation.userAgent,
    },
    fixture: {
      id: observation.fixtureId,
      path: fixtureRelativePath,
      sha256: fixtureSha256,
      authorStyleSheetCount: observation.authorStyleSheetCount,
      cssProfile: 'spinon-html-ua/0.1.0-draft',
      profileCssPath: uaCssRelativePath,
      profileCssSha256,
      comparisonBaseline: {
        authorStyleSheetCount: profileObservation.baselineAuthorStyleSheetCount,
        cssSha256: baselineCssSha256,
      },
      profileAuthorStyleSheetCount: profileObservation.authorStyleSheetCount,
    },
    observations: {
      chromiumDefault: observation.elements,
      selectorCoverage,
      comparisonBaseline: profileObservation.baselineElements,
      embeddedProfileAsAuthorRule: profileObservation.elements,
      comparison: {
        method: '고정된 author baseline을 덮는 프로필의 computed CSS 값 정확 비교',
        passed: comparedFeatures.length,
        failed: failedFeatures.length,
        features: comparedFeatures,
      },
    },
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
  console.log(`Chromium ${version} (${browserVersion.revision}) 기준 저장: ${outputPath}`);
  console.log(`바이너리 SHA-256: ${snapshot.oracle.executableSha256}`);
  console.log(`비교: 내장 프로필 computed CSS ${comparedFeatures.length}개 값 일치; fixture selector ${selectorCoverage.length}개 확인`);
  console.log('실행 조건: macOS, arm64, 800×600 CSS px, scale=1, en-US, UTC, light/no-preference');
} finally {
  pageDevTools?.close();
  if (browserDevTools) {
    await Promise.race([browserDevTools.send('Browser.close').catch(() => {}), sleep(500)]);
    browserDevTools.close();
  }
  killBrowserProcessGroup(browserProcess, 'SIGTERM');
  await waitForExit(browserProcess, 1_500);
  killBrowserProcessGroup(browserProcess, 'SIGKILL');
  await rm(profilePath, { recursive: true, force: true });
}
