const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { io: createClient } = require('socket.io-client');
const questions = require('../shared/questions');

const rootDir = path.resolve(__dirname, '..');

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
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
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
      const response = await request('/api/config', port);
      if (response.statusCode === 200) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw lastError || new Error('Server did not become ready');
}

function waitForEvent(socket, eventName, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off(eventName, onEvent);
      socket.off('connect_error', onError);
    }

    function onEvent(payload) {
      cleanup();
      resolve(payload);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.once(eventName, onEvent);
    socket.once('connect_error', onError);
  });
}

function waitForEventWhere(socket, eventName, predicate, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for matching ${eventName}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off(eventName, onEvent);
      socket.off('connect_error', onError);
    }

    function onEvent(payload) {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.on(eventName, onEvent);
    socket.once('connect_error', onError);
  });
}

async function expectNoEvent(socket, eventName, action, timeoutMs = 250) {
  let received = false;
  const handler = () => {
    received = true;
  };

  socket.once(eventName, handler);
  action();
  await new Promise(resolve => setTimeout(resolve, timeoutMs));
  socket.off(eventName, handler);
  assert.equal(received, false, `unexpected ${eventName} event`);
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

function connectSocket(port) {
  return createClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
    forceNew: true
  });
}

test('server room flow sanitizes input, validates quiz answers, and forwards host events', async t => {
  const server = await startServer(t);
  const host = connectSocket(server.port);
  const controller = connectSocket(server.port);

  t.after(() => {
    host.close();
    controller.close();
  });

  await Promise.all([
    waitForEvent(host, 'connect'),
    waitForEvent(controller, 'connect')
  ]);

  const roomCreatedPromise = waitForEvent(host, 'room-created');
  host.emit('create-room', { deviceType: 'host' });
  const roomCreated = await roomCreatedPromise;
  assert.equal(roomCreated.port, server.port);
  assert.match(roomCreated.roomCode, /^\d{4}$/);

  const joinedPromise = waitForEvent(controller, 'room-joined');
  const playerConnectedPromise = waitForEvent(host, 'player-connected');
  controller.emit('join-room', { roomCode: roomCreated.roomCode });
  const [joined, playerConnected] = await Promise.all([joinedPromise, playerConnectedPromise]);
  assert.equal(joined.playerId, controller.id);
  assert.equal(playerConnected.playerId, controller.id);

  const settingsPromise = waitForEventWhere(host, 'lobby-state', state =>
    state.settings &&
    state.settings.maxPlayers === 1 &&
    state.settings.minPlayers === 1 &&
    state.settings.matchDuration === 60 &&
    state.settings.mapId === 'depot'
  );
  host.emit('update-room-settings', {
    settings: { maxPlayers: 1, minPlayers: 1, matchDuration: 60, mapId: 'depot' }
  });
  const lobbyState = await settingsPromise;
  assert.equal(lobbyState.settings.maxPlayers, 1);
  assert.equal(lobbyState.settings.minPlayers, 1);
  assert.equal(lobbyState.settings.matchDuration, 60);
  assert.equal(lobbyState.settings.mapId, 'depot');
  assert.equal(lobbyState.map.id, 'depot');

  const hostStartedPromise = waitForEvent(host, 'game-started');
  const controllerStartedPromise = waitForEvent(controller, 'game-started');
  host.emit('start-game');
  const [hostStarted, controllerStarted] = await Promise.all([hostStartedPromise, controllerStartedPromise]);
  assert.equal(hostStarted.matchDuration, 60);
  assert.equal(controllerStarted.matchDuration, 60);
  assert.equal(hostStarted.settings.mapId, 'depot');
  assert.equal(controllerStarted.map.id, 'depot');

  await expectNoEvent(host, 'match-timer', () => {
    controller.emit('match-timer', { timeRemaining: 1 });
  });

  const inputPromise = waitForEvent(host, 'player-input');
  controller.emit('player-input', {
    moveX: 9,
    moveY: '-9',
    lookDeltaX: 'bad',
    lookDeltaY: 0.5,
    shoot: true,
    jump: 1,
    timestamp: '4321'
  });
  const input = await inputPromise;
  assert.deepEqual(input, {
    playerId: controller.id,
    moveX: 1,
    moveY: -1,
    lookDeltaX: 0,
    lookDeltaY: 0.5,
    shoot: true,
    jump: true,
    timestamp: 4321
  });

  const quizPromise = waitForEvent(controller, 'quiz-questions');
  controller.emit('request-quiz');
  const quiz = await quizPromise;
  assert.equal(quiz.questions.length, 3);
  assert.equal(Object.hasOwn(quiz.questions[0], 'correct'), false);

  const answers = quiz.questions.map(question => {
    const source = questions.find(candidate =>
      candidate.question === question.question &&
      JSON.stringify(candidate.options) === JSON.stringify(question.options)
    );

    assert.ok(source, `could not find source question for ${question.question}`);
    return {
      questionId: question.id,
      selectedOption: source.correct
    };
  });

  const quizCompletedPromise = waitForEvent(host, 'quiz-completed');
  controller.emit('submit-quiz', { answers: [answers[0], ...answers], correctCount: 0 });
  const quizCompleted = await quizCompletedPromise;
  assert.equal(quizCompleted.playerId, controller.id);
  assert.equal(quizCompleted.correctCount, 3);

  const deathPromise = waitForEvent(controller, 'player-died');
  host.emit('player-death', {
    victimId: controller.id,
    killerId: 'host-player',
    killerName: 'Host',
    respawnTime: 3
  });
  assert.deepEqual(await deathPromise, {
    playerId: controller.id,
    killerId: 'host-player',
    killerName: 'Host',
    respawnTime: 3
  });

  const respawnPromise = waitForEvent(controller, 'player-respawned');
  host.emit('player-respawn', {
    playerId: controller.id,
    health: 100,
    ammo: 15
  });
  assert.deepEqual(await respawnPromise, {
    playerId: controller.id,
    health: 100,
    ammo: 15
  });

  const ammoPromise = waitForEvent(controller, 'ammo-updated');
  host.emit('ammo-update', {
    playerId: controller.id,
    ammo: 22,
    ammoGained: 7
  });
  assert.deepEqual(await ammoPromise, {
    ammo: 22,
    ammoGained: 7
  });

  const restartHostPromise = waitForEvent(host, 'game-started');
  const restartControllerPromise = waitForEvent(controller, 'game-started');
  host.emit('restart-game');
  const [, restartController] = await Promise.all([restartHostPromise, restartControllerPromise]);
  assert.equal(restartController.matchDuration, 60);

  const logs = server.logs();
  assert.match(logs.stdout, /MULTIPLAYER FPS SERVER STARTED/);
  assert.equal(logs.stderr.trim(), '');
});
