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

async function assertControllerQuizFitsViewport(page) {
  const questions = [
    '1. What is the highest-grossing film of all time as of recent records, with enough extra wording to stress a narrow phone screen?',
    '2. Which very long technology phrase should wrap cleanly instead of cutting off inside the controller reload quiz modal?',
    '3. What planet is known as the Red Planet when this question is intentionally padded to test mobile wrapping behavior?'
  ];
  const options = [
    'A very long answer option that should wrap across multiple lines without clipping',
    'Short answer',
    'Another long answer choice with punctuation, spaces, and enough words to stress the button layout',
    'Final answer'
  ];

  await page.evaluate(({ questions, options }) => {
    const container = document.getElementById('quiz-questions');
    container.replaceChildren();

    questions.forEach((text, qIndex) => {
      const question = document.createElement('div');
      question.className = 'quiz-question';

      const questionText = document.createElement('div');
      questionText.className = 'question-text';
      questionText.textContent = text;
      question.appendChild(questionText);

      options.forEach((optionText, optIndex) => {
        const button = document.createElement('button');
        button.className = 'quiz-option';
        button.id = `quiz-opt-${qIndex}-${optIndex}`;
        button.textContent = `${String.fromCharCode(65 + optIndex)}. ${optionText}`;
        question.appendChild(button);
      });

      container.appendChild(question);
    });

    document.getElementById('submit-quiz-btn').disabled = true;
    document.getElementById('quiz-modal').style.display = 'flex';
  }, { questions, options });

  const layout = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const panel = document.querySelector('.quiz-container').getBoundingClientRect();
    const submit = document.getElementById('submit-quiz-btn').getBoundingClientRect();
    const scroller = document.getElementById('quiz-questions');
    const textOverflowsPanel = Array.from(document.querySelectorAll('.question-text, .quiz-option')).some(el => {
      const rect = el.getBoundingClientRect();
      return rect.left < panel.left - 0.5 || rect.right > panel.right + 0.5;
    });

    return {
      panelInsideViewport:
        panel.top >= -0.5 &&
        panel.left >= -0.5 &&
        panel.right <= viewport.width + 0.5 &&
        panel.bottom <= viewport.height + 0.5,
      submitInsideViewport:
        submit.top >= -0.5 &&
        submit.left >= -0.5 &&
        submit.right <= viewport.width + 0.5 &&
        submit.bottom <= viewport.height + 0.5,
      scrollerCanContainOverflow: scroller.scrollHeight > scroller.clientHeight,
      textOverflowsPanel
    };
  });

  assert.equal(layout.panelInsideViewport, true);
  assert.equal(layout.submitInsideViewport, true);
  assert.equal(layout.scrollerCanContainOverflow, true);
  assert.equal(layout.textOverflowsPanel, false);
}

test('host and controller pages load, connect, and start a match without browser errors', { timeout: 70000 }, async t => {
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
  await controllerPage.fill('#player-name-input', 'Smoke Test');
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
  await assertControllerQuizFitsViewport(controllerPage);

  await hostPage.screenshot();
  await controllerPage.screenshot();
  await new Promise(resolve => setTimeout(resolve, 500));

  const logs = server.logs();
  assert.match(logs.stdout, /MULTIPLAYER FPS SERVER STARTED/);
  assert.equal(logs.stderr.trim(), '');
  assert.deepEqual(errors, []);
});
