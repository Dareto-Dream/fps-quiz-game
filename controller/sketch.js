import * as THREE from 'three';
import { applyMapMovement, calculateLookRotation, normalizeAngleRadians } from '../shared/movement.mjs';
import { buildMapScene, disposeMapScene, getArenaConfig } from '../shared/map-renderer.mjs';
import { createShotEffects, deserializeVector3 } from '../shared/shot-visuals.mjs';

// ============================================
// GAME STATE
// ============================================
let socket;
let connected = false;
let playerId = '';
let playerName = '';
let playerToken = '';
let playerColor = '#ffffff';
let roomCode = '';
let lobbyState = null;
let inputInterval = null;
let lobbyCountdownInterval = null;
let animationStarted = false;
let matchStarted = false;
let publicServerUrl = window.location.origin;

// Player stats
let myHealth = 100;
let myAmmo = 15;
let myKills = 0;
let myDeaths = 0;
let myStreak = 0;
let isAlive = true;
let respawnTimer = 0;
let matchTime = 300;
let matchTimeBase = 300;
let matchSyncAt = 0;
let matchTimerActive = false;
let lastTimerWholeSeconds = null;
let moveSpeed = 8;
let lookSensitivity = 0.003;
let inputRate = 30;
const CAMERA_EYE_HEIGHT = 1.7;
const MAX_FRAME_DELTA = 0.05;
const SERVER_POSITION_SNAP_DISTANCE = 3;
const SERVER_POSITION_MOVING_DEADZONE = 0.85;
const SERVER_POSITION_IDLE_DEADZONE = 0.35;
const SERVER_POSITION_RECONCILE_RATE_MOVING = 0.8;
const SERVER_POSITION_RECONCILE_RATE_IDLE = 5;
const OTHER_PLAYER_INTERPOLATION_RATE = 14;
const LOOK_STICK_YAW_SCALE = 0.28;
const LOOK_STICK_PITCH_SCALE = 0.16;
const KEYBOARD_LOOK_YAW = 0.24;
const KEYBOARD_LOOK_PITCH = 0.14;

// Player position/rotation (synced from host)
let myPosition = new THREE.Vector3(0, 0, 0);
let myRotationY = 0; // Horizontal rotation
let myRotationX = 0; // Vertical rotation (pitch)
let hasSyncedCameraPosition = false;
let hasSyncedCameraRotation = false;
let serverCameraTarget = null;
let serverCameraSnapPending = false;

// Other players
let otherPlayers = {};

// Input state
let moveX = 0;
let moveY = 0;
let lookDeltaX = 0;
let lookDeltaY = 0;
let shooting = false;

// Joystick state
let leftJoystick = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, touchId: null };
let rightJoystick = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, touchId: null };
let joystickMaxDistance = { left: 40, right: 40 };
let lastInputLogAt = 0;

// Quiz state
let quizActive = false;
let quizPendingResults = false;
let quizReviewActive = false;
let quizQuestions = [];
let quizAnswers = [];
let deferredAmmoNotice = null;

// Three.js
let scene, camera, renderer;
let clock = new THREE.Clock();

// Shooting visual effects
let lastLocalShootTime = 0;
let muzzleFlash = null;
let gunMesh = null;

// Arena config
const ARENA = { WIDTH: 50, DEPTH: 50, WALL_HEIGHT: 10 };
let mapLibrary = [];
let activeMap = null;
let mapRuntime = null;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
  syncViewportHeight();
  loadClientConfig();

  document.getElementById('server-url').value = publicServerUrl;
  document.getElementById('player-name-input').value = getSavedPlayerName();
  
  // Event listeners
  document.getElementById('connect-btn').addEventListener('click', connectToServer);
  document.getElementById('submit-quiz-btn').addEventListener('click', submitQuiz);
  document.getElementById('fire-btn').addEventListener('touchstart', (e) => { e.preventDefault(); startFiring(); });
  document.getElementById('fire-btn').addEventListener('touchend', (e) => { e.preventDefault(); stopFiring(); });
  document.getElementById('fire-btn').addEventListener('mousedown', startFiring);
  document.getElementById('fire-btn').addEventListener('mouseup', stopFiring);
  document.getElementById('reload-btn').addEventListener('click', requestQuiz);
  
  // Enter key on inputs
  document.querySelectorAll('#connection-screen input').forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') connectToServer();
    });
  });
  
  // Joystick touch events
  setupJoysticks();
  window.addEventListener('resize', syncViewportHeight);
  window.addEventListener('orientationchange', syncViewportHeight);
});

function syncViewportHeight() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}

async function loadClientConfig() {
  try {
    const response = await fetch('/api/config');
    const serverConfig = await response.json();
    publicServerUrl = serverConfig.PUBLIC_BASE_URL || publicServerUrl;
    document.getElementById('server-url').value = publicServerUrl;
    moveSpeed = Number(serverConfig.MOVE_SPEED) || moveSpeed;
    lookSensitivity = Number(serverConfig.LOOK_SENSITIVITY) || lookSensitivity;
    inputRate = Number(serverConfig.INPUT_RATE) || inputRate;
    initializeMaps(serverConfig);
  } catch (error) {
    console.log('Using default controller config');
    initializeMaps({});
  }
}

function initializeMaps(serverConfig = {}) {
  mapLibrary = Array.isArray(serverConfig.MAPS) ? serverConfig.MAPS : [];
  activeMap = serverConfig.MAP || getMapById(serverConfig.DEFAULT_MAP_ID) || getFallbackMap();
  applyActiveMap(activeMap, { rebuild: false });
}

function getMapById(mapId) {
  return mapLibrary.find(map => map.id === mapId) || null;
}

function getMapFromPayload(data = {}) {
  return data.map || getMapById(data.settings && data.settings.mapId) || getMapById(data.mapId);
}

function applyActiveMap(map, { rebuild = true } = {}) {
  activeMap = map || activeMap || getFallbackMap();
  Object.assign(ARENA, getArenaConfig(activeMap));

  if (scene && rebuild) {
    createArena();
  }
}

function getFallbackMap() {
  return {
    id: 'classic',
    name: 'Classic Arena',
    arena: { width: 50, depth: 50, wallHeight: 10 },
    lighting: { timeOfDay: 'midday' },
    spawns: [{ x: 0, z: 0, yaw: 0 }],
    obstacles: []
  };
}

function startFiring() {
  shooting = true;
  document.getElementById('fire-btn').classList.add('active');
  sendInput();
}

function stopFiring() {
  shooting = false;
  document.getElementById('fire-btn').classList.remove('active');
  sendInput();
}

// ============================================
// JOYSTICK SETUP
// ============================================
function setupJoysticks() {
  const leftArea = document.getElementById('left-joystick-area');
  const rightArea = document.getElementById('right-joystick-area');
  
  // Touch events for left joystick (movement)
  leftArea.addEventListener('touchstart', (e) => handleJoystickStart(e, leftJoystick, 'left'), { passive: false });
  leftArea.addEventListener('touchmove', (e) => handleJoystickMove(e, leftJoystick, 'left'), { passive: false });
  leftArea.addEventListener('touchend', (e) => handleJoystickEnd(e, leftJoystick, 'left'), { passive: false });
  leftArea.addEventListener('touchcancel', (e) => handleJoystickEnd(e, leftJoystick, 'left'), { passive: false });
  
  // Touch events for right joystick (look)
  rightArea.addEventListener('touchstart', (e) => handleJoystickStart(e, rightJoystick, 'right'), { passive: false });
  rightArea.addEventListener('touchmove', (e) => handleJoystickMove(e, rightJoystick, 'right'), { passive: false });
  rightArea.addEventListener('touchend', (e) => handleJoystickEnd(e, rightJoystick, 'right'), { passive: false });
  rightArea.addEventListener('touchcancel', (e) => handleJoystickEnd(e, rightJoystick, 'right'), { passive: false });
  
  // Mouse events for desktop testing
  leftArea.addEventListener('mousedown', (e) => handleMouseJoystickStart(e, leftJoystick, 'left'));
  rightArea.addEventListener('mousedown', (e) => handleMouseJoystickStart(e, rightJoystick, 'right'));
  document.addEventListener('mousemove', handleMouseJoystickMove);
  document.addEventListener('mouseup', handleMouseJoystickEnd);
  
  // Keyboard for desktop
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);

  updateJoystickMetrics();
  window.addEventListener('orientationchange', updateJoystickMetrics);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      requestAnimationFrame(updateJoystickMetrics);
    }
  });
}

function handleJoystickStart(e, joystick, side) {
  e.preventDefault();
  updateJoystickMetrics(side);
  const touch = e.changedTouches[0];
  const rect = e.target.closest('.joystick-area').getBoundingClientRect();
  
  joystick.active = true;
  joystick.touchId = touch.identifier;
  joystick.startX = rect.left + rect.width / 2;
  joystick.startY = rect.top + rect.height / 2;
  joystick.currentX = touch.clientX;
  joystick.currentY = touch.clientY;
  
  updateJoystickVisual(joystick, side);
  sendInput();
}

function handleJoystickMove(e, joystick, side) {
  e.preventDefault();
  if (!joystick.active) return;
  
  for (let touch of e.changedTouches) {
    if (touch.identifier === joystick.touchId) {
      joystick.currentX = touch.clientX;
      joystick.currentY = touch.clientY;
      updateJoystickVisual(joystick, side);
      sendInput();
      break;
    }
  }
}

function handleJoystickEnd(e, joystick, side) {
  e.preventDefault();
  for (let touch of e.changedTouches) {
    if (touch.identifier === joystick.touchId) {
      joystick.active = false;
      joystick.touchId = null;
      resetJoystickVisual(side);
      
      if (side === 'left') {
        moveX = 0;
        moveY = 0;
      }
      sendInput();
      break;
    }
  }
}

// Mouse support for desktop
let activeMouseJoystick = null;
let activeMouseSide = null;

function handleMouseJoystickStart(e, joystick, side) {
  updateJoystickMetrics(side);
  const rect = e.target.closest('.joystick-area').getBoundingClientRect();
  
  joystick.active = true;
  joystick.startX = rect.left + rect.width / 2;
  joystick.startY = rect.top + rect.height / 2;
  joystick.currentX = e.clientX;
  joystick.currentY = e.clientY;
  
  activeMouseJoystick = joystick;
  activeMouseSide = side;
  
  updateJoystickVisual(joystick, side);
  sendInput();
}

function handleMouseJoystickMove(e) {
  if (!activeMouseJoystick) return;
  
  activeMouseJoystick.currentX = e.clientX;
  activeMouseJoystick.currentY = e.clientY;
  updateJoystickVisual(activeMouseJoystick, activeMouseSide);
  sendInput();
}

function handleMouseJoystickEnd(e) {
  if (activeMouseJoystick) {
    activeMouseJoystick.active = false;
    resetJoystickVisual(activeMouseSide);
    
    if (activeMouseSide === 'left') {
      moveX = 0;
      moveY = 0;
    }
    sendInput();
    
    activeMouseJoystick = null;
    activeMouseSide = null;
  }
}

function updateJoystickVisual(joystick, side) {
  const handle = document.getElementById(side === 'left' ? 'left-handle' : 'right-handle');
  const maxDist = joystickMaxDistance[side] || 40;
  
  const dx = joystick.currentX - joystick.startX;
  const dy = joystick.currentY - joystick.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  let clampedX = dx;
  let clampedY = dy;
  
  if (dist > maxDist) {
    clampedX = (dx / dist) * maxDist;
    clampedY = (dy / dist) * maxDist;
  }
  
  handle.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
  
  // Update input values
  const normalizedX = maxDist ? clampedX / maxDist : 0;
  const normalizedY = maxDist ? clampedY / maxDist : 0;
  const safeX = Number.isFinite(normalizedX) ? normalizedX : 0;
  const safeY = Number.isFinite(normalizedY) ? normalizedY : 0;

  if (side === 'left') {
    moveX = safeX;
    moveY = safeY;
  } else {
    // Right joystick controls look - accumulate rotation
    lookDeltaX = safeX * LOOK_STICK_YAW_SCALE;
    lookDeltaY = safeY * LOOK_STICK_PITCH_SCALE;
  }
}

function resetJoystickVisual(side) {
  const handle = document.getElementById(side === 'left' ? 'left-handle' : 'right-handle');
  handle.style.transform = 'translate(-50%, -50%)';
  
  if (side === 'right') {
    lookDeltaX = 0;
    lookDeltaY = 0;
    sendInput();
  }
}

function updateJoystickMetrics(side) {
  const leftBase = document.querySelector('#left-joystick-area .joystick-base');
  const rightBase = document.querySelector('#right-joystick-area .joystick-base');
  const leftHandle = document.getElementById('left-handle');
  const rightHandle = document.getElementById('right-handle');

  if ((!side || side === 'left') && leftBase && leftHandle) {
    const baseSize = leftBase.getBoundingClientRect().width;
    const handleSize = leftHandle.getBoundingClientRect().width;
    const maxDistance = Math.max(10, (baseSize - handleSize) / 2);
    joystickMaxDistance.left = Number.isFinite(maxDistance) ? maxDistance : 40;
  }

  if ((!side || side === 'right') && rightBase && rightHandle) {
    const baseSize = rightBase.getBoundingClientRect().width;
    const handleSize = rightHandle.getBoundingClientRect().width;
    const maxDistance = Math.max(10, (baseSize - handleSize) / 2);
    joystickMaxDistance.right = Number.isFinite(maxDistance) ? maxDistance : 40;
  }
}

// Keyboard support
const keysPressed = {};

function handleKeyDown(e) {
  keysPressed[e.key.toLowerCase()] = true;
  
  if (e.key === ' ' || e.key === 'f') {
    startFiring();
  }
  if (e.key === 'r') {
    requestQuiz();
  }
  
  updateKeyboardInput();
  sendInput();
}

function handleKeyUp(e) {
  keysPressed[e.key.toLowerCase()] = false;
  
  if (e.key === ' ' || e.key === 'f') {
    stopFiring();
  }
  
  updateKeyboardInput();
  sendInput();
}

function updateKeyboardInput() {
  moveX = 0;
  moveY = 0;
  
  if (keysPressed['w']) moveY = -1;
  if (keysPressed['s']) moveY = 1;
  if (keysPressed['a']) moveX = -1;
  if (keysPressed['d']) moveX = 1;
  
  // Arrow keys for look
  if (keysPressed['arrowleft']) lookDeltaX = -KEYBOARD_LOOK_YAW;
  else if (keysPressed['arrowright']) lookDeltaX = KEYBOARD_LOOK_YAW;
  else if (!rightJoystick.active) lookDeltaX = 0;
  
  if (keysPressed['arrowup']) lookDeltaY = -KEYBOARD_LOOK_PITCH;
  else if (keysPressed['arrowdown']) lookDeltaY = KEYBOARD_LOOK_PITCH;
  else if (!rightJoystick.active) lookDeltaY = 0;
}

// ============================================
// CONNECTION
// ============================================
function connectToServer() {
  let serverUrl = document.getElementById('server-url').value.trim();
  const requestedPlayerName = sanitizeLocalPlayerName(document.getElementById('player-name-input').value);
  const code = document.getElementById('room-code').value.trim();
  
  if (!serverUrl || !requestedPlayerName || !code) {
    showConnectionError('Please fill in all fields');
    return;
  }
  
  if (code.length !== 4) {
    showConnectionError('Room code must be 4 digits');
    return;
  }
  
  // Ensure URL has protocol
  if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
    serverUrl = 'http://' + serverUrl;
  }
  
  // Remove trailing slash if present
  serverUrl = serverUrl.replace(/\/$/, '');
  
  document.getElementById('connect-btn').disabled = true;
  document.getElementById('connect-btn').textContent = 'CONNECTING...';
  showConnectionError('');
  
  if (socket) socket.disconnect();
  
  socket = io(serverUrl, {
    transports: ['polling', 'websocket'],
    reconnection: false,
    timeout: 15000,
    forceNew: true
  });
  
  const connectionTimeout = setTimeout(() => {
    if (!connected) {
      showConnectionError('Connection timed out.');
      document.getElementById('connect-btn').disabled = false;
      document.getElementById('connect-btn').textContent = 'CONNECT';
      socket.disconnect();
    }
  }, 15000);
  
  socket.on('connect', () => {
    socket.emit('join-room', {
      roomCode: code,
      playerName: requestedPlayerName,
      playerToken: getSavedPlayerToken(code)
    });
  });
  
  socket.on('room-joined', (data) => {
    clearTimeout(connectionTimeout);
    connected = true;
    playerId = data.playerId;
    playerToken = data.playerToken || playerToken;
    playerName = data.playerName || requestedPlayerName;
    playerColor = data.color;
    roomCode = data.roomCode;
    savePlayerName(playerName);
    savePlayerToken(roomCode, playerToken);
    const roomMap = getMapFromPayload(data);
    if (roomMap) {
      applyActiveMap(roomMap, { rebuild: Boolean(scene) });
    }
    
    socket.io.opts.reconnection = true;
    
    document.getElementById('connection-screen').style.display = 'none';
    document.getElementById('lobby-wait-screen').style.display = 'flex';
    document.getElementById('game-screen').style.display = 'none';

    // Update player indicator
    document.getElementById('player-name').textContent = playerName;
    document.getElementById('player-color').style.backgroundColor = playerColor;
    document.getElementById('wait-player-name').textContent = playerName;
    document.getElementById('wait-player-color').style.backgroundColor = playerColor;
    document.getElementById('wait-room-code').textContent = roomCode;
    updateLobbyWait({
      roomCode,
      playerCount: 1,
      settings: data.settings || { maxPlayers: 0, matchDuration: matchTime }
    });
  });
  
  socket.on('join-error', (data) => {
    clearTimeout(connectionTimeout);
    showConnectionError(data.message);
    document.getElementById('connect-btn').disabled = false;
    document.getElementById('connect-btn').textContent = 'CONNECT';
    socket.disconnect();
  });
  
  socket.on('connect_error', (error) => {
    clearTimeout(connectionTimeout);
    showConnectionError(`Connection failed: ${error.message || 'Cannot reach server'}`);
    document.getElementById('connect-btn').disabled = false;
    document.getElementById('connect-btn').textContent = 'CONNECT';
  });

  socket.on('disconnect', () => {
    connected = false;
  });
  
  // Game events
  socket.on('lobby-state', handleLobbyState);
  socket.on('game-started', handleGameStarted);
  socket.on('game-state', handleGameState);
  socket.on('full-state', handleFullState);
  socket.on('shot-visual', handleShotVisual);
  socket.on('kill-event', handleKillEvent);
  socket.on('player-died', handlePlayerDied);
  socket.on('player-respawned', handlePlayerRespawned);
  socket.on('quiz-questions', handleQuizQuestions);
  socket.on('quiz-results', handleQuizResults);
  socket.on('ammo-updated', handleAmmoUpdated);
  socket.on('match-timer', handleMatchTimer);
  socket.on('match-end', handleMatchEnd);
  socket.on('host-disconnected', handleHostDisconnected);
}

function showConnectionError(message) {
  document.getElementById('connection-error').textContent = message;
}

function sanitizeLocalPlayerName(value) {
  return window.ArenaPlayerUtils.sanitizePlayerName(value);
}

function getSavedPlayerName() {
  try {
    return sanitizeLocalPlayerName(localStorage.getItem('arena-fps-player-name') || '');
  } catch (error) {
    return '';
  }
}

function savePlayerName(name) {
  try {
    localStorage.setItem('arena-fps-player-name', sanitizeLocalPlayerName(name));
  } catch (error) {
    // Storage can be blocked in private browsing contexts.
  }
}

function getSavedPlayerToken(code) {
  try {
    return localStorage.getItem(`arena-fps-player-token-${code}`) || '';
  } catch (error) {
    return '';
  }
}

function savePlayerToken(code, token) {
  if (!code || !token) return;
  try {
    localStorage.setItem(`arena-fps-player-token-${code}`, token);
  } catch (error) {
    // Storage can be blocked in private browsing contexts.
  }
}

function handleLobbyState(data) {
  lobbyState = data;
  const roomMap = getMapFromPayload(data);
  if (roomMap && (!activeMap || roomMap.id !== activeMap.id)) {
    applyActiveMap(roomMap, { rebuild: Boolean(scene) });
  }
  updateLobbyWait(data);

  if (data.state === 'playing' && !matchStarted) {
    handleGameStarted({
      settings: data.settings,
      map: data.map,
      matchDuration: data.settings && data.settings.matchDuration,
      startedAt: data.startedAt
    });
  }
}

function updateLobbyWait(data) {
  const settings = data.settings || {};
  const maxPlayers = settings.maxPlayers || 0;
  const minPlayers = settings.minPlayers || 1;
  const playerCount = data.playerCount || 0;
  const matchDuration = settings.matchDuration || matchTime;
  const matchMinutes = Math.max(1, Math.round(matchDuration / 60));

  document.getElementById('wait-room-code').textContent = data.roomCode || roomCode || '----';
  document.getElementById('wait-player-count').textContent = `${playerCount}/${maxPlayers}`;
  document.getElementById('wait-match-length').textContent = `${matchMinutes} min`;

  if (data.state === 'countdown') {
    const seconds = getLobbyCountdownSeconds(data);
    document.getElementById('wait-status').textContent = `Dropping in ${seconds}...`;
    startLobbyCountdownTicker();
  } else if (playerCount < minPlayers) {
    stopLobbyCountdownTicker();
    const needed = minPlayers - playerCount;
    document.getElementById('wait-status').textContent =
      `Waiting for ${needed} more player${needed === 1 ? '' : 's'}...`;
  } else {
    stopLobbyCountdownTicker();
    document.getElementById('wait-status').textContent = 'Waiting for host...';
  }
}

function getLobbyCountdownSeconds(data) {
  const endsAt = Number(data && data.countdownEndsAt);
  if (!Number.isFinite(endsAt)) return 5;
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

function startLobbyCountdownTicker() {
  if (lobbyCountdownInterval) return;
  lobbyCountdownInterval = setInterval(() => {
    if (!lobbyState || lobbyState.state !== 'countdown') {
      stopLobbyCountdownTicker();
      return;
    }
    document.getElementById('wait-status').textContent =
      `Dropping in ${getLobbyCountdownSeconds(lobbyState)}...`;
  }, 200);
}

function stopLobbyCountdownTicker() {
  if (!lobbyCountdownInterval) return;
  clearInterval(lobbyCountdownInterval);
  lobbyCountdownInterval = null;
}

function handleGameStarted(data) {
  stopLobbyCountdownTicker();
  const duration = data.matchDuration || (data.settings && data.settings.matchDuration) || matchTime;
  const elapsedSinceStart = data.startedAt ? Math.max(0, (Date.now() - data.startedAt) / 1000) : 0;
  const nextMap = getMapFromPayload(data);
  if (nextMap) {
    applyActiveMap(nextMap, { rebuild: Boolean(scene) });
  }

  matchStarted = true;
  hasSyncedCameraPosition = false;
  hasSyncedCameraRotation = false;
  serverCameraTarget = null;
  serverCameraSnapPending = false;

  document.getElementById('lobby-wait-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'block';
  document.getElementById('match-end').style.display = 'none';

  if (!renderer) {
    initThreeJS();
  }

  clock = new THREE.Clock();
  syncMatchTimer(Math.max(0, duration - elapsedSinceStart));
  requestAnimationFrame(updateJoystickMetrics);

  if (!animationStarted) {
    animationStarted = true;
    animate();
  }

  if (!inputInterval) {
    inputInterval = setInterval(sendInput, 33);
  }
}

// ============================================
// THREE.JS INITIALIZATION
// ============================================
function initThreeJS() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070807);
  scene.fog = new THREE.Fog(0x070807, 22, 66);
  
  // Camera (first person)
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, CAMERA_EYE_HEIGHT, 0); // Eye height
  camera.rotation.order = 'YXZ';
  
  // Create first-person gun mesh (attached to camera)
  const gunGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.4);
  const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
  gunMesh = new THREE.Mesh(gunGeometry, gunMaterial);
  gunMesh.position.set(0.25, -0.15, -0.5); // Offset to bottom-right of view
  camera.add(gunMesh);
  
  // Create muzzle flash light (hidden by default)
  muzzleFlash = new THREE.PointLight(0xffaa00, 0, 3);
  muzzleFlash.position.set(0.25, -0.15, -0.7);
  camera.add(muzzleFlash);
  
  // Renderer
  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  
  // Add camera to scene (so gun renders)
  scene.add(camera);
  
  // Create arena
  createArena();
  
  // Handle resize
  window.addEventListener('resize', onWindowResize);
}

function createArena() {
  disposeMapScene(mapRuntime);
  mapRuntime = buildMapScene({
    THREE,
    scene,
    renderer,
    map: activeMap,
    shadows: false,
    lightIntensity: 0.5
  });
  Object.assign(ARENA, mapRuntime.arena);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  updateJoystickMetrics();
}

// ============================================
// GAME STATE HANDLERS
// ============================================
function handleGameState(data) {
  if (data.players && data.players[playerId]) {
    const myData = data.players[playerId];
    myHealth = myData.health;
    myAmmo = myData.ammo;
    myKills = myData.kills;
    myDeaths = myData.deaths;
    myStreak = myData.streak;
    
    // Check if we just died (were alive, now dead)
    const wasDead = !isAlive;
    isAlive = myData.alive;
    
    // If we're dead and death screen isn't showing, show it
    if (!isAlive && !wasDead) {
      document.getElementById('death-screen').style.display = 'flex';
    }
    
    // If we're alive and death screen is showing, hide it
    if (isAlive && document.getElementById('death-screen').style.display !== 'none') {
      document.getElementById('death-screen').style.display = 'none';
    }
    
    updateHUD();
  }
  if (data.matchTime !== undefined) {
    syncMatchTimer(data.matchTime);
  }
}

function handleFullState(data) {
  // Update my position/rotation from host
  if (data.players && data.players[playerId]) {
    const myData = data.players[playerId];
    myPosition.set(Number(myData.x) || 0, Number(myData.y) || 0, Number(myData.z) || 0);

    const serverPos = getCameraPositionFromPlayerData(myData);
    if (serverCameraTarget) {
      serverCameraTarget.copy(serverPos);
    } else {
      serverCameraTarget = serverPos.clone();
    }

    const positionError = camera ? getHorizontalDistance(camera.position, serverCameraTarget) : 0;
    const snappedPosition =
      !camera || !hasSyncedCameraPosition || positionError > SERVER_POSITION_SNAP_DISTANCE || !isAlive;
    serverCameraSnapPending = serverCameraSnapPending || snappedPosition;
    syncCameraRotationFromServer(myData, { force: snappedPosition });
  }
  
  // Update other players
  if (data.players) {
    for (const [id, playerData] of Object.entries(data.players)) {
      if (id !== playerId) {
        updateOtherPlayer(id, playerData);
      }
    }
    
    // Remove disconnected players
    for (const id of Object.keys(otherPlayers)) {
      if (!data.players[id]) {
        scene.remove(otherPlayers[id].mesh);
        delete otherPlayers[id];
      }
    }
  }
}

function syncCameraRotationFromServer(data, { force = false } = {}) {
  if (!camera) return;

  const serverRotationX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, Number(data.rotX) || 0));
  const serverRotationY = normalizeAngleRadians(data.rotY);
  const yawError = Math.abs(normalizeAngleRadians(serverRotationY - camera.rotation.y));
  const pitchError = Math.abs(serverRotationX - camera.rotation.x);
  const shouldSnap = force || !hasSyncedCameraRotation || yawError > Math.PI / 3 || pitchError > Math.PI / 6;

  if (shouldSnap) {
    camera.rotation.set(serverRotationX, serverRotationY, 0, 'YXZ');
  }

  myRotationY = serverRotationY;
  myRotationX = serverRotationX;
  hasSyncedCameraRotation = true;
}

function getCameraPositionFromPlayerData(data) {
  const x = Number(data.x);
  const y = Number(data.y);
  const z = Number(data.z);
  return new THREE.Vector3(
    Number.isFinite(x) ? x : 0,
    (Number.isFinite(y) ? y : 0) + CAMERA_EYE_HEIGHT,
    Number.isFinite(z) ? z : 0
  );
}

function getHorizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function reconcileCameraPosition(deltaTime) {
  if (!camera || !serverCameraTarget) return;

  const horizontalDistance = getHorizontalDistance(camera.position, serverCameraTarget);
  if (serverCameraSnapPending || horizontalDistance > SERVER_POSITION_SNAP_DISTANCE) {
    camera.position.copy(serverCameraTarget);
    serverCameraSnapPending = false;
    hasSyncedCameraPosition = true;
    return;
  }

  const isMoving = Math.abs(moveX) > 0.001 || Math.abs(moveY) > 0.001;
  const deadzone = isMoving
    ? SERVER_POSITION_MOVING_DEADZONE
    : SERVER_POSITION_IDLE_DEADZONE;

  if (horizontalDistance > deadzone) {
    const rate = isMoving
      ? SERVER_POSITION_RECONCILE_RATE_MOVING
      : SERVER_POSITION_RECONCILE_RATE_IDLE;
    const alpha = 1 - Math.exp(-rate * Math.max(0, deltaTime));
    camera.position.lerp(serverCameraTarget, alpha);
  }

  camera.position.y = serverCameraTarget.y;
  hasSyncedCameraPosition = true;
}

function updateOtherPlayer(id, data) {
  const targetPosition = new THREE.Vector3(
    Number(data.x) || 0,
    (Number(data.y) || 0) + 0.8,
    Number(data.z) || 0
  );
  const targetRotationY = normalizeAngleRadians(data.rotY);

  if (!otherPlayers[id]) {
    // Create new player mesh
    const geometry = new THREE.CylinderGeometry(0.4, 0.4, 1.6, 8);
    const material = new THREE.MeshStandardMaterial({ color: data.color || 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(targetPosition);
    mesh.rotation.y = targetRotationY;
    
    // Add head
    const headGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const head = new THREE.Mesh(headGeometry, material);
    head.position.y = 1.1;
    mesh.add(head);
    
    scene.add(mesh);
    otherPlayers[id] = {
      mesh: mesh,
      color: data.color,
      targetPosition: targetPosition.clone(),
      targetRotationY
    };
  }
  
  const player = otherPlayers[id];
  player.targetPosition.copy(targetPosition);
  player.targetRotationY = targetRotationY;
  player.mesh.visible = data.alive;
}

function updateOtherPlayers(deltaTime) {
  const alpha = 1 - Math.exp(-OTHER_PLAYER_INTERPOLATION_RATE * Math.max(0, deltaTime));

  Object.values(otherPlayers).forEach(player => {
    if (!player.targetPosition) return;

    player.mesh.position.lerp(player.targetPosition, alpha);
    const rotationDelta = normalizeAngleRadians(player.targetRotationY - player.mesh.rotation.y);
    player.mesh.rotation.y = normalizeAngleRadians(player.mesh.rotation.y + rotationDelta * alpha);
  });
}

function handleShotVisual(data = {}) {
  if (!scene) return;

  createShotEffects({
    THREE,
    scene,
    origin: deserializeVector3(THREE, data.origin),
    end: deserializeVector3(THREE, data.end),
    impactPoint: deserializeVector3(THREE, data.impactPoint),
    impactNormal: deserializeVector3(THREE, data.impactNormal),
    color: data.color || '#fff0ad'
  });
}

function handleKillEvent(data) {
  if (data.killerId === playerId) {
    // Show kill notification with streak info
    let killText = 'KILL';
    if (data.killerStreak >= 3) {
      killText = `KILL - ${data.killerStreak} STREAK`;
    }
    showNotification('kill-notification', killText, 2000);
    
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  }
}

function handlePlayerDied(data) {
  if (data.playerId === playerId) {
    isAlive = false;
    respawnTimer = data.respawnTime || 3;
    
    document.getElementById('killer-name').textContent = data.killerName || 'Enemy';
    document.getElementById('death-screen').style.display = 'flex';
    document.getElementById('respawn-countdown').textContent = Math.ceil(respawnTimer);
    
    // Clear any existing countdown
    if (window.respawnInterval) {
      clearInterval(window.respawnInterval);
    }
    
    window.respawnInterval = setInterval(() => {
      respawnTimer--;
      document.getElementById('respawn-countdown').textContent = Math.max(0, Math.ceil(respawnTimer));
      if (respawnTimer <= 0) {
        clearInterval(window.respawnInterval);
        window.respawnInterval = null;
      }
    }, 1000);
    
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
  }
}

function handlePlayerRespawned(data) {
  if (data.playerId === playerId) {
    isAlive = true;
    myHealth = data.health;
    myAmmo = data.ammo;
    hasSyncedCameraPosition = false;
    hasSyncedCameraRotation = false;
    
    // Clear respawn countdown
    if (window.respawnInterval) {
      clearInterval(window.respawnInterval);
      window.respawnInterval = null;
    }
    
    document.getElementById('death-screen').style.display = 'none';
    updateHUD();
    
    if (navigator.vibrate) navigator.vibrate(100);
  }
}

function handleQuizQuestions(data) {
  quizQuestions = Array.isArray(data.questions) ? data.questions : [];
  quizAnswers = new Array(quizQuestions.length).fill(-1);
  quizActive = true;
  quizPendingResults = false;
  quizReviewActive = false;
  setQuizTitle('RELOAD QUIZ');
  renderQuiz();
  setQuizSubmitState({ text: 'SUBMIT', disabled: true });
  document.getElementById('quiz-modal').style.display = 'flex';
  requestAnimationFrame(resetQuizScroll);
}

function handleQuizResults(data = {}) {
  quizActive = false;
  quizPendingResults = false;
  quizReviewActive = true;
  renderQuizResults(data);
  document.getElementById('quiz-modal').style.display = 'flex';
  requestAnimationFrame(resetQuizScroll);
}

function handleAmmoUpdated(data) {
  myAmmo = data.ammo;
  updateHUD();

  if (quizPendingResults || quizReviewActive) {
    deferredAmmoNotice = data;
    return;
  }

  showAmmoNotification(data);
}

function handleMatchTimer(data) {
  syncMatchTimer(data.timeRemaining);
}

function handleMatchEnd(data) {
  matchTimerActive = false;
  document.getElementById('match-end').style.display = 'flex';
  
  if (data.winner) {
    renderWinnerInfo(data.winner);
  }
  
  document.getElementById('your-final-stats').textContent = 
    `Your Stats: ${myKills} kills, ${myDeaths} deaths`;
}

function handleHostDisconnected() {
  alert('Host disconnected. The game has ended.');
  location.reload();
}

// ============================================
// UI UPDATES
// ============================================
function updateHUD() {
  // Health bar with color based on health level
  const healthPercent = Math.max(0, myHealth) / 100;
  const healthBar = document.getElementById('health-bar');
  healthBar.style.width = `${healthPercent * 100}%`;
  
  // Change health bar color based on health
  if (myHealth > 60) {
    healthBar.style.background = 'linear-gradient(90deg, #44ff44, #66ff66)';
  } else if (myHealth > 30) {
    healthBar.style.background = 'linear-gradient(90deg, #ffaa00, #ffcc44)';
  } else {
    healthBar.style.background = 'linear-gradient(90deg, #ff4444, #ff6666)';
  }
  
  document.getElementById('health-text').textContent = `HP: ${Math.ceil(myHealth)}`;
  
  // Ammo with low ammo warning
  const ammoDisplay = document.getElementById('ammo-display');
  ammoDisplay.textContent = `AMMO ${myAmmo}`;
  if (myAmmo <= 3) {
    ammoDisplay.style.color = '#ff4444';
  } else if (myAmmo <= 5) {
    ammoDisplay.style.color = '#ffaa00';
  } else {
    ammoDisplay.style.color = '#ffffff';
  }
  
  // Stats with streak indicator
  const statsDisplay = document.getElementById('stats-display');
  statsDisplay.replaceChildren(
    document.createTextNode(`K/D ${myKills}/${myDeaths}`),
    document.createElement('br'),
    document.createTextNode(`Streak ${myStreak}${myStreak >= 3 ? ' HOT' : ''}`)
  );
}

function updateTimer() {
  const minutes = Math.floor(matchTime / 60);
  const seconds = Math.floor(matchTime % 60);
  document.getElementById('timer-display').textContent = 
    `${minutes}:${seconds.toString().padStart(2, '0')}`;
  document.getElementById('timer-display').style.color = matchTime <= 30 ? '#ff4444' : '#ff6600';
}

function syncMatchTimer(timeRemaining) {
  matchTimeBase = Math.max(0, timeRemaining);
  matchSyncAt = performance.now();
  matchTimerActive = true;
  matchTime = matchTimeBase;
  lastTimerWholeSeconds = Math.floor(matchTime);
  updateTimer();
}

function tickMatchTimer() {
  if (!matchTimerActive || matchSyncAt === 0) return;

  const elapsedSeconds = (performance.now() - matchSyncAt) / 1000;
  const nextTime = Math.max(0, matchTimeBase - elapsedSeconds);
  const nextWholeSeconds = Math.floor(nextTime);

  matchTime = nextTime;
  if (nextWholeSeconds !== lastTimerWholeSeconds) {
    lastTimerWholeSeconds = nextWholeSeconds;
    updateTimer();
  }

  if (nextTime <= 0) {
    matchTimerActive = false;
  }
}

function showNotification(elementId, text, duration) {
  const el = document.getElementById(elementId);
  el.textContent = text;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, duration);
}

function showAmmoNotification(data = {}) {
  const ammoGained = Number(data.ammoGained) || 0;
  showNotification('ammo-notification', `+${ammoGained} AMMO`, 2000);
}

// ============================================
// QUIZ
// ============================================
function renderQuiz() {
  const container = document.getElementById('quiz-questions');
  container.replaceChildren();
  
  quizQuestions.forEach((q, qIndex) => {
    const questionDiv = document.createElement('div');
    questionDiv.className = 'quiz-question';
    
    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = `${qIndex + 1}. ${q.question}`;
    questionDiv.appendChild(questionText);
    
    q.options.forEach((opt, optIndex) => {
      const optButton = document.createElement('button');
      optButton.className = 'quiz-option';
      optButton.textContent = opt;
      optButton.onclick = () => selectQuizOption(qIndex, optIndex);
      optButton.id = `quiz-opt-${qIndex}-${optIndex}`;
      questionDiv.appendChild(optButton);
    });
    
    container.appendChild(questionDiv);
  });
}

function renderQuizResults(data = {}) {
  const container = document.getElementById('quiz-questions');
  const results = Array.isArray(data.results) ? data.results : [];
  const correctCount = Number.isFinite(Number(data.correctCount))
    ? Number(data.correctCount)
    : results.filter(result => result && result.isCorrect).length;
  const totalQuestions = Number.isFinite(Number(data.totalQuestions))
    ? Number(data.totalQuestions)
    : results.length;

  setQuizTitle('RELOAD RESULTS');
  container.replaceChildren();

  const summary = document.createElement('div');
  summary.className = 'quiz-result-summary';
  summary.textContent = `${correctCount}/${totalQuestions} RIGHT`;
  container.appendChild(summary);

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'quiz-result-empty';
    empty.textContent = 'No reload answers were checked.';
    container.appendChild(empty);
    setQuizSubmitState({ text: 'CONTINUE', disabled: false });
    return;
  }

  results.forEach((result, index) => {
    const isCorrect = Boolean(result && result.isCorrect);
    const selectedText = result && result.selectedOptionText ? result.selectedOptionText : 'No answer';
    const correctText = result && result.correctOptionText ? result.correctOptionText : 'Unknown';

    const questionDiv = document.createElement('div');
    questionDiv.className = `quiz-question quiz-review ${isCorrect ? 'correct' : 'wrong'}`;

    const header = document.createElement('div');
    header.className = 'quiz-result-header';

    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = `${index + 1}. ${(result && result.question) || 'Question'}`;

    const badge = document.createElement('div');
    badge.className = `quiz-result-badge ${isCorrect ? 'right' : 'wrong'}`;
    badge.textContent = isCorrect ? 'RIGHT' : 'WRONG';

    header.append(questionText, badge);

    const selectedLine = document.createElement('div');
    selectedLine.className = `quiz-answer-line ${isCorrect ? 'right' : 'wrong'}`;
    selectedLine.textContent = `You: ${selectedText}`;

    const correctLine = document.createElement('div');
    correctLine.className = 'quiz-answer-line right';
    correctLine.textContent = `Correct: ${correctText}`;

    questionDiv.append(header, selectedLine, correctLine);
    container.appendChild(questionDiv);
  });

  setQuizSubmitState({ text: 'CONTINUE', disabled: false });
}

function renderWinnerInfo(winner) {
  const winnerInfo = document.getElementById('winner-info');
  winnerInfo.replaceChildren();
  winnerInfo.append('Winner: ');

  const name = document.createElement('strong');
  name.textContent = winner.playerName || winner.colorName || 'Player';
  winnerInfo.append(name, ` with ${winner.kills} kills`);
}

function setQuizTitle(text) {
  const title = document.querySelector('.quiz-container h2');
  if (title) {
    title.textContent = text;
  }
}

function setQuizSubmitState({ text, disabled }) {
  const button = document.getElementById('submit-quiz-btn');
  if (text) {
    button.textContent = text;
  }
  button.disabled = Boolean(disabled);
}

function setQuizOptionsDisabled(disabled) {
  document.querySelectorAll('.quiz-option').forEach(button => {
    button.disabled = Boolean(disabled);
  });
}

function closeQuizReview() {
  quizReviewActive = false;
  quizPendingResults = false;
  quizQuestions = [];
  quizAnswers = [];
  document.getElementById('quiz-modal').style.display = 'none';
  setQuizTitle('RELOAD QUIZ');
  setQuizSubmitState({ text: 'SUBMIT', disabled: true });

  if (deferredAmmoNotice) {
    showAmmoNotification(deferredAmmoNotice);
    deferredAmmoNotice = null;
  }
}

function resetQuizScroll() {
  const container = document.getElementById('quiz-questions');
  const panel = document.querySelector('.quiz-container');
  if (container) container.scrollTop = 0;
  if (panel) panel.scrollTop = 0;
}

function selectQuizOption(questionIndex, optionIndex) {
  if (!quizActive || quizPendingResults) return;

  quizAnswers[questionIndex] = optionIndex;
  
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`quiz-opt-${questionIndex}-${i}`);
    if (btn) btn.classList.toggle('selected', i === optionIndex);
  }
  
  const allAnswered = quizAnswers.every(a => a !== -1);
  document.getElementById('submit-quiz-btn').disabled = !allAnswered;
}

function submitQuiz() {
  if (quizReviewActive) {
    closeQuizReview();
    return;
  }

  if (!quizActive || quizPendingResults) return;
  
  const answers = quizQuestions.map((q, i) => ({
    questionId: q.id,
    selectedOption: quizAnswers[i]
  }));

  quizPendingResults = true;
  quizActive = false;
  setQuizOptionsDisabled(true);
  setQuizSubmitState({ text: 'CHECKING...', disabled: true });
  socket.emit('submit-quiz', { answers });
}

function requestQuiz() {
  if (socket && connected && !quizActive && !quizPendingResults && !quizReviewActive) {
    socket.emit('request-quiz');
  }
}

// ============================================
// INPUT SENDING
// ============================================
function sendInput() {
  if (!socket || !connected || !isAlive) return;

  const now = performance.now();
  if (now - lastInputLogAt > 1000) {
    lastInputLogAt = now;
    console.log('[controller] input', {
      moveX: Number(moveX.toFixed(2)),
      moveY: Number(moveY.toFixed(2)),
      lookDeltaX: Number(lookDeltaX.toFixed(3)),
      lookDeltaY: Number(lookDeltaY.toFixed(3)),
      shooting
    });
  }
  
  socket.emit('player-input', {
    playerId: playerId,
    moveX: moveX,
    moveY: moveY,
    lookDeltaX: lookDeltaX,
    lookDeltaY: lookDeltaY,
    shoot: shooting,
    jump: false,
    timestamp: Date.now()
  });
}

// ============================================
// RENDER LOOP
// ============================================
function animate() {
  requestAnimationFrame(animate);
  
  if (!renderer || !scene || !camera) return;

  const delta = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
  const now = performance.now();
  
  tickMatchTimer();
  
  // Apply look rotation locally for responsive feel
  if (lookDeltaX !== 0 || lookDeltaY !== 0) {
    const nextRotation = calculateLookRotation({
      rotationX: camera.rotation.x,
      rotationY: camera.rotation.y,
      lookDeltaX,
      lookDeltaY,
      sensitivity: lookSensitivity,
      turnRate: inputRate,
      deltaTime: delta
    });
    camera.rotation.x = nextRotation.x;
    camera.rotation.y = nextRotation.y;
  }
  
  // Handle shooting visual effects
  if (shooting && isAlive && myAmmo > 0) {
    if (now - lastLocalShootTime > 200) { // Match server fire rate
      lastLocalShootTime = now;
      
      // Show muzzle flash
      if (muzzleFlash) {
        muzzleFlash.intensity = 3;
        setTimeout(() => {
          if (muzzleFlash) muzzleFlash.intensity = 0;
        }, 50);
      }
      
      // Gun recoil animation
      if (gunMesh) {
        gunMesh.position.z = -0.4; // Kick back
        gunMesh.rotation.x = -0.1; // Tilt up
      }
    }
  }
  
  // Reset gun position smoothly
  if (gunMesh) {
    gunMesh.position.z += (-0.5 - gunMesh.position.z) * 0.2;
    gunMesh.rotation.x += (0 - gunMesh.rotation.x) * 0.2;
  }
  
  // Client-side prediction: move camera based on input for responsive feel
  // Server position updates will be smoothly interpolated in handleFullState
  if (isAlive && (Math.abs(moveX) > 0.001 || Math.abs(moveY) > 0.001)) {
    const nextPosition = applyMapMovement({
      x: camera.position.x,
      z: camera.position.z,
      rotationY: camera.rotation.y,
      moveX,
      moveY,
      speed: moveSpeed,
      deltaTime: delta,
      map: activeMap,
      arena: ARENA
    });

    camera.position.x = nextPosition.x;
    camera.position.z = nextPosition.z;
  }

  reconcileCameraPosition(delta);
  updateOtherPlayers(delta);
  
  renderer.render(scene, camera);
}
