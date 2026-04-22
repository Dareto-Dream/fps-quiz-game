import * as THREE from 'three';
import { applyMapMovement } from '../shared/movement.mjs';
import { buildMapScene, disposeMapScene, getArenaConfig } from '../shared/map-renderer.mjs';

// ============================================
// GAME STATE
// ============================================
let socket;
let connected = false;
let playerId = '';
let playerColor = '#ffffff';
let playerColorName = '';
let roomCode = '';
let lobbyState = null;
let inputInterval = null;
let animationStarted = false;
let matchStarted = false;

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

// Player position/rotation (synced from host)
let myPosition = new THREE.Vector3(0, 0, 0);
let myRotationY = 0; // Horizontal rotation
let myRotationX = 0; // Vertical rotation (pitch)

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
let quizQuestions = [];
let quizAnswers = [];

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
  loadClientConfig();

  // Auto-fill server URL from current page URL (works for hosted servers)
  const currentUrl = window.location.origin;
  if (currentUrl) {
    document.getElementById('server-url').value = currentUrl;
  }
  
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
});

async function loadClientConfig() {
  try {
    const response = await fetch('/api/config');
    const serverConfig = await response.json();
    moveSpeed = Number(serverConfig.MOVE_SPEED) || moveSpeed;
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
    spawns: [{ x: 0, z: 0, yaw: 0 }],
    obstacles: []
  };
}

function startFiring() {
  shooting = true;
  document.getElementById('fire-btn').classList.add('active');
}

function stopFiring() {
  shooting = false;
  document.getElementById('fire-btn').classList.remove('active');
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
}

function handleJoystickMove(e, joystick, side) {
  e.preventDefault();
  if (!joystick.active) return;
  
  for (let touch of e.changedTouches) {
    if (touch.identifier === joystick.touchId) {
      joystick.currentX = touch.clientX;
      joystick.currentY = touch.clientY;
      updateJoystickVisual(joystick, side);
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
}

function handleMouseJoystickMove(e) {
  if (!activeMouseJoystick) return;
  
  activeMouseJoystick.currentX = e.clientX;
  activeMouseJoystick.currentY = e.clientY;
  updateJoystickVisual(activeMouseJoystick, activeMouseSide);
}

function handleMouseJoystickEnd(e) {
  if (activeMouseJoystick) {
    activeMouseJoystick.active = false;
    resetJoystickVisual(activeMouseSide);
    
    if (activeMouseSide === 'left') {
      moveX = 0;
      moveY = 0;
    }
    
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
    lookDeltaX = safeX * 0.05;
    lookDeltaY = safeY * 0.03;
  }
}

function resetJoystickVisual(side) {
  const handle = document.getElementById(side === 'left' ? 'left-handle' : 'right-handle');
  handle.style.transform = 'translate(-50%, -50%)';
  
  if (side === 'right') {
    lookDeltaX = 0;
    lookDeltaY = 0;
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
}

function handleKeyUp(e) {
  keysPressed[e.key.toLowerCase()] = false;
  
  if (e.key === ' ' || e.key === 'f') {
    stopFiring();
  }
  
  updateKeyboardInput();
}

function updateKeyboardInput() {
  moveX = 0;
  moveY = 0;
  
  if (keysPressed['w']) moveY = -1;
  if (keysPressed['s']) moveY = 1;
  if (keysPressed['a']) moveX = -1;
  if (keysPressed['d']) moveX = 1;
  
  // Arrow keys for look
  if (keysPressed['arrowleft']) lookDeltaX = -0.03;
  else if (keysPressed['arrowright']) lookDeltaX = 0.03;
  else if (!rightJoystick.active) lookDeltaX = 0;
  
  if (keysPressed['arrowup']) lookDeltaY = -0.02;
  else if (keysPressed['arrowdown']) lookDeltaY = 0.02;
  else if (!rightJoystick.active) lookDeltaY = 0;
}

// ============================================
// CONNECTION
// ============================================
function connectToServer() {
  let serverUrl = document.getElementById('server-url').value.trim();
  const code = document.getElementById('room-code').value.trim();
  
  if (!serverUrl || !code) {
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
    socket.emit('join-room', { roomCode: code });
  });
  
  socket.on('room-joined', (data) => {
    clearTimeout(connectionTimeout);
    connected = true;
    playerId = data.playerId;
    playerColor = data.color;
    playerColorName = data.colorName;
    roomCode = data.roomCode;
    const roomMap = getMapFromPayload(data);
    if (roomMap) {
      applyActiveMap(roomMap, { rebuild: Boolean(scene) });
    }
    
    socket.io.opts.reconnection = true;
    
    document.getElementById('connection-screen').style.display = 'none';
    document.getElementById('lobby-wait-screen').style.display = 'flex';
    document.getElementById('game-screen').style.display = 'none';

    // Update player indicator
    document.getElementById('player-name').textContent = playerColorName;
    document.getElementById('player-color').style.backgroundColor = playerColor;
    document.getElementById('wait-player-name').textContent = `${playerColorName} Player`;
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
  socket.on('kill-event', handleKillEvent);
  socket.on('player-died', handlePlayerDied);
  socket.on('player-respawned', handlePlayerRespawned);
  socket.on('quiz-questions', handleQuizQuestions);
  socket.on('ammo-updated', handleAmmoUpdated);
  socket.on('match-timer', handleMatchTimer);
  socket.on('match-end', handleMatchEnd);
  socket.on('host-disconnected', handleHostDisconnected);
}

function showConnectionError(message) {
  document.getElementById('connection-error').textContent = message;
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

  if (playerCount < minPlayers) {
    const needed = minPlayers - playerCount;
    document.getElementById('wait-status').textContent =
      `Waiting for ${needed} more player${needed === 1 ? '' : 's'}...`;
  } else {
    document.getElementById('wait-status').textContent = 'Waiting for host...';
  }
}

function handleGameStarted(data) {
  const duration = data.matchDuration || (data.settings && data.settings.matchDuration) || matchTime;
  const elapsedSinceStart = data.startedAt ? Math.max(0, (Date.now() - data.startedAt) / 1000) : 0;
  const nextMap = getMapFromPayload(data);
  if (nextMap) {
    applyActiveMap(nextMap, { rebuild: Boolean(scene) });
  }

  matchStarted = true;

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
  camera.position.set(0, 1.7, 0); // Eye height
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
  
  // Lighting
  const ambientLight = new THREE.AmbientLight(0x6b5a43, 0.52);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffead0, 1.04);
  directionalLight.position.set(18, 40, 22);
  scene.add(directionalLight);

  const rimLight = new THREE.DirectionalLight(0x26d8d8, 0.42);
  rimLight.position.set(-22, 22, -18);
  scene.add(rimLight);
  
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
    
    // Smoothly interpolate position to reduce snapping
    const serverPos = new THREE.Vector3(myData.x, myData.y, myData.z);
    const distance = camera.position.distanceTo(serverPos);
    
    // Only snap if we're WAY off (> 2 units), otherwise smoothly lerp
    if (distance > 2) {
      camera.position.set(myData.x, myData.y + 1.7, myData.z);
    } else {
      camera.position.lerp(serverPos.setY(myData.y + 1.7), 0.3);
    }
    
    // Store server rotation for reference but don't override local camera rotation
    // This prevents fighting between client and server
    myRotationY = myData.rotY;
    myRotationX = myData.rotX;
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

function updateOtherPlayer(id, data) {
  if (!otherPlayers[id]) {
    // Create new player mesh
    const geometry = new THREE.CylinderGeometry(0.4, 0.4, 1.6, 8);
    const material = new THREE.MeshStandardMaterial({ color: data.color || 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    
    // Add head
    const headGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const head = new THREE.Mesh(headGeometry, material);
    head.position.y = 1.1;
    mesh.add(head);
    
    scene.add(mesh);
    otherPlayers[id] = { mesh: mesh, color: data.color };
  }
  
  const player = otherPlayers[id];
  player.mesh.position.set(data.x, data.y + 0.8, data.z);
  player.mesh.rotation.y = data.rotY;
  player.mesh.visible = data.alive;
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
  quizQuestions = data.questions;
  quizAnswers = new Array(quizQuestions.length).fill(-1);
  quizActive = true;
  renderQuiz();
  document.getElementById('quiz-modal').style.display = 'flex';
}

function handleAmmoUpdated(data) {
  myAmmo = data.ammo;
  showNotification('ammo-notification', `+${data.ammoGained} AMMO`, 2000);
  updateHUD();
}

function handleMatchTimer(data) {
  syncMatchTimer(data.timeRemaining);
}

function handleMatchEnd(data) {
  matchTimerActive = false;
  document.getElementById('match-end').style.display = 'flex';
  
  if (data.winner) {
    document.getElementById('winner-info').innerHTML =
      `Winner: <strong>${data.winner.colorName}</strong> with ${data.winner.kills} kills`;
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
  document.getElementById('stats-display').innerHTML =
    `K/D ${myKills}/${myDeaths}<br>Streak ${myStreak}${myStreak >= 3 ? ' HOT' : ''}`;
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

// ============================================
// QUIZ
// ============================================
function renderQuiz() {
  const container = document.getElementById('quiz-questions');
  container.innerHTML = '';
  
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

function selectQuizOption(questionIndex, optionIndex) {
  quizAnswers[questionIndex] = optionIndex;
  
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`quiz-opt-${questionIndex}-${i}`);
    if (btn) btn.classList.toggle('selected', i === optionIndex);
  }
  
  const allAnswered = quizAnswers.every(a => a !== -1);
  document.getElementById('submit-quiz-btn').disabled = !allAnswered;
}

function submitQuiz() {
  if (!quizActive) return;
  
  const answers = quizQuestions.map((q, i) => ({
    questionId: q.id,
    selectedOption: quizAnswers[i]
  }));
  socket.emit('submit-quiz', { answers });
  
  quizActive = false;
  document.getElementById('quiz-modal').style.display = 'none';
}

function requestQuiz() {
  if (socket && connected && !quizActive) {
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

  const delta = clock.getDelta();
  const now = performance.now();
  
  tickMatchTimer();
  
  // Apply look rotation locally for responsive feel
  if (lookDeltaX !== 0 || lookDeltaY !== 0) {
    camera.rotation.y -= lookDeltaX;
    camera.rotation.x -= lookDeltaY;
    camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
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
  
  renderer.render(scene, camera);
}
