const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const rootDir = path.resolve(__dirname, '..');
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

function getBrowserPath() {
  return browserCandidates.find(candidate => fs.existsSync(candidate));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function request(pathname, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, timeout: 1000 }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('timeout', () => {
      req.destroy(new Error('HTTP request timed out'));
    });
    req.on('error', reject);
  });
}

async function waitForHttp(port, child) {
  const deadline = Date.now() + 5000;
  let lastError;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }

    try {
      if (await request('/api/config', port) === 200) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw lastError || new Error('Server did not become ready');
}

async function startServer(t) {
  const port = await getFreePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
  });

  await waitForHttp(port, child);
  return {
    port,
    logs: () => ({ stdout, stderr })
  };
}

test('host and controller pages load, connect, and start a match without browser errors', { timeout: 20000 }, async t => {
  const executablePath = getBrowserPath();
  if (!executablePath) {
    t.skip('No local Chromium/Edge executable found for browser smoke test');
    return;
  }

  const server = await startServer(t);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-gl=swiftshader']
  });
  const errors = [];

  t.after(async () => {
    await browser.close();
  });

  const hostPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const controllerPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const page of [hostPage, controllerPage]) {
    page.on('console', message => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', error => {
      errors.push(error.message);
    });
  }

  await hostPage.goto(`http://127.0.0.1:${server.port}/host`, { waitUntil: 'domcontentloaded' });
  await hostPage.waitForFunction(() => {
    const code = document.getElementById('lobby-room-code');
    return code && /^\d{4}$/.test(code.textContent.trim());
  }, null, { timeout: 10000 });

  const roomCode = await hostPage.locator('#lobby-room-code').textContent();
  await controllerPage.goto(`http://127.0.0.1:${server.port}/controller`, { waitUntil: 'domcontentloaded' });
  await controllerPage.fill('#server-url', `http://127.0.0.1:${server.port}`);
  await controllerPage.fill('#room-code', roomCode.trim());
  await controllerPage.click('#connect-btn');
  await controllerPage.waitForFunction(() => getComputedStyle(document.getElementById('lobby-wait-screen')).display !== 'none');
  await hostPage.waitForFunction(() => document.getElementById('lobby-player-count').textContent.trim() === '1/8');

  await hostPage.fill('#setting-min-players', '1');
  await hostPage.dispatchEvent('#setting-min-players', 'change');
  await hostPage.waitForFunction(() => !document.getElementById('start-game-btn').disabled);
  await hostPage.click('#start-game-btn');

  await controllerPage.waitForFunction(() => getComputedStyle(document.getElementById('game-screen')).display !== 'none');
  await hostPage.waitForFunction(() => !document.body.classList.contains('lobby-active'));

  const hostCanvas = await hostPage.locator('#game-container canvas').boundingBox();
  const controllerCanvas = await controllerPage.locator('#game-canvas').boundingBox();
  assert.ok(hostCanvas && hostCanvas.width > 0 && hostCanvas.height > 0);
  assert.ok(controllerCanvas && controllerCanvas.width > 0 && controllerCanvas.height > 0);

  await hostPage.screenshot();
  await controllerPage.screenshot();
  await new Promise(resolve => setTimeout(resolve, 500));

  const logs = server.logs();
  assert.match(logs.stdout, /MULTIPLAYER FPS SERVER STARTED/);
  assert.equal(logs.stderr.trim(), '');
  assert.deepEqual(errors, []);
});
