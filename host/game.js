import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { applyMapMovement, calculateLookRotation, sanitizePlayerInput } from '../shared/movement.mjs';
import { buildMapScene, disposeMapScene, getArenaConfig } from '../shared/map-renderer.mjs';

// ============================================
// GAME CONFIGURATION
// ============================================
const CONFIG = {
  PLAYER_MAX_HEALTH: 100,
  PLAYER_MAX_AMMO: 30,
  PLAYER_START_AMMO: 15,
  WEAPON_DAMAGE: 25,
  RESPAWN_TIME: 3,
  SPAWN_PROTECTION_TIME: 2,
  MOVE_SPEED: 8,
  LOOK_SENSITIVITY: 0.003,
  INPUT_RATE: 30,
  MATCH_DURATION: 300,
  STREAK_THRESHOLD: 3,
  QUIZ_REWARDS: { 0: 0, 1: 3, 2: 5, 3: 7 },
  DEFAULT_MAP_ID: 'classic',
  MAPS: [],
  MAP: null,
  ARENA: { WIDTH: 50, DEPTH: 50, WALL_HEIGHT: 10 },
  MAX_PLAYERS: 24,
  SPAWN_POINTS: [
    // Corners
    { x: -20, z: -20 }, { x: 20, z: -20 },
    { x: -20, z: 20 }, { x: 20, z: 20 },
    // Edges
    { x: 0, z: -22 }, { x: 0, z: 22 },
    { x: -22, z: 0 }, { x: 22, z: 0 },
    // Mid positions
    { x: -15, z: -10 }, { x: 15, z: -10 },
    { x: -15, z: 10 }, { x: 15, z: 10 },
    { x: -10, z: -15 }, { x: 10, z: -15 },
    { x: -10, z: 15 }, { x: 10, z: 15 },
    // Inner ring
    { x: -8, z: -8 }, { x: 8, z: -8 },
    { x: -8, z: 8 }, { x: 8, z: 8 },
    // Additional positions
    { x: -18, z: -10 }, { x: 18, z: -10 },
    { x: -18, z: 10 }, { x: 18, z: 10 }
  ]
};

// ============================================
// GLOBAL VARIABLES
// ============================================
let scene, camera, renderer, labelRenderer;
let socket;
let players = {};
let lastInputLogAt = 0;
let streakLeader = null;
let matchTimer = CONFIG.MATCH_DURATION;
let matchActive = false;
let roomCode = '';
let serverIP = '';
let serverPort = '';
let joinUrl = '';
let lobbyState = null;
let lobbySettings = {
  maxPlayers: CONFIG.MAX_PLAYERS,
  minPlayers: 2,
  matchDuration: CONFIG.MATCH_DURATION,
  mapId: CONFIG.DEFAULT_MAP_ID
};
let mapLibrary = [];
let activeMap = null;
let mapRuntime = null;

// Camera state
const CameraState = { OVERVIEW: 'overview', FOLLOWING: 'following' };
let currentCameraState = CameraState.OVERVIEW;
const overviewPosition = new THREE.Vector3(0, 35, 35);
const overviewTarget = new THREE.Vector3(0, 0, 0);

// Audio
let audioContext;
let sounds = {};

let simulationRunning = false;
let lastSimulationAt = 0;
const MAX_SIMULATION_DELTA = 0.05;

// Raycaster for hit detection
const raycaster = new THREE.Raycaster();

// ============================================
// INITIALIZATION
// ============================================
async function init() {
  // Load config from server
  try {
    const response = await fetch('/api/config');
    const serverConfig = await response.json();
    Object.assign(CONFIG, serverConfig);
    initializeMaps(serverConfig);
  } catch (e) {
    console.log('Using default config');
    initializeMaps(CONFIG);
  }
  
  initThreeJS();
  initAudio();
  initLobbyControls();
  initSocket();
  createArena();
  console.log('Game initialized');
  
  // Start render loop
  animate();
  startSimulationLoop();
}

function initializeMaps(serverConfig = {}) {
  mapLibrary = Array.isArray(serverConfig.MAPS) ? serverConfig.MAPS : [];
  activeMap = serverConfig.MAP || getMapById(serverConfig.DEFAULT_MAP_ID) || getFallbackMap();
  CONFIG.DEFAULT_MAP_ID = serverConfig.DEFAULT_MAP_ID || activeMap.id;
  applyActiveMap(activeMap, { rebuild: false });
}

function getMapById(mapId) {
  return mapLibrary.find(map => map.id === mapId) || null;
}

function getMapFromPayload(data = {}) {
  return data.map || getMapById(data.settings && data.settings.mapId) || getMapById(data.mapId);
}

function applyActiveMap(map, { rebuild = true, repositionPlayers = false } = {}) {
  activeMap = map || activeMap || getFallbackMap();
  const arena = getArenaConfig(activeMap);
  CONFIG.ARENA = arena;
  CONFIG.SPAWN_POINTS = Array.isArray(activeMap.spawns) ? activeMap.spawns : [{ x: 0, z: 0, yaw: 0 }];
  lobbySettings.mapId = activeMap.id || CONFIG.DEFAULT_MAP_ID;
  updateOverviewCameraDefaults();

  if (scene && rebuild) {
    createArena();
  }

  if (repositionPlayers) {
    repositionPlayersOnCurrentMap();
  }
}

function updateOverviewCameraDefaults() {
  const longestSide = Math.max(CONFIG.ARENA.WIDTH || 50, CONFIG.ARENA.DEPTH || 50);
  overviewPosition.set(0, Math.max(35, longestSide * 0.72), Math.max(35, longestSide * 0.72));
  overviewTarget.set(0, 0, 0);
}

function repositionPlayersOnCurrentMap() {
  Object.values(players).forEach((player, index) => {
    const spawnPoint = getSpawnPoint(index);
    player.group.position.set(spawnPoint.x, 0, spawnPoint.z);
    player.rotation.set(0, spawnPoint.yaw || Math.random() * Math.PI * 2, 0);
    player.group.rotation.y = player.rotation.y;
  });
}

function getFallbackMap() {
  return {
    id: 'classic',
    name: 'Classic Arena',
    arena: { width: 50, depth: 50, wallHeight: 10 },
    lighting: { timeOfDay: 'midday' },
    spawns: CONFIG.SPAWN_POINTS || [{ x: 0, z: 0, yaw: 0 }],
    obstacles: []
  };
}

function initThreeJS() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070807);
  scene.fog = new THREE.Fog(0x070807, 34, 92);
  
  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.copy(overviewPosition);
  camera.lookAt(overviewTarget);
  camera.rotation.order = 'YXZ';
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  document.getElementById('game-container').appendChild(renderer.domElement);
  
  // CSS2D Renderer for labels
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  document.getElementById('game-container').appendChild(labelRenderer.domElement);
  
  // Handle resize
  window.addEventListener('resize', onWindowResize);
}

function initAudio() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // Create sound effects using oscillators
  sounds.shoot = createShootSound();
  sounds.hit = createHitSound();
  sounds.kill = createKillSound();
  sounds.death = createDeathSound();
  sounds.spawn = createSpawnSound();
}

function createShootSound() {
  return () => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.1);
  };
}

function createHitSound() {
  return () => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, audioContext.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.15);
  };
}

function createKillSound() {
  return () => {
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc1.type = 'square';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(400, audioContext.currentTime);
    osc2.frequency.setValueAtTime(600, audioContext.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.2);
    osc2.frequency.exponentialRampToValueAtTime(1200, audioContext.currentTime + 0.2);
    gain.gain.setValueAtTime(0.25, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioContext.destination);
    osc1.start();
    osc2.start();
    osc1.stop(audioContext.currentTime + 0.3);
    osc2.stop(audioContext.currentTime + 0.3);
  };
}

function createDeathSound() {
  return () => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.5);
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.5);
  };
}

function createSpawnSound() {
  return () => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.2);
    gain.gain.setValueAtTime(0.2, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.3);
  };
}

function playSound(soundName) {
  if (sounds[soundName] && audioContext.state === 'running') {
    sounds[soundName]();
  }
}

// ============================================
// SOCKET INITIALIZATION
// ============================================
function initLobbyControls() {
  const startButton = document.getElementById('start-game-btn');
  const settingInputs = [
    document.getElementById('setting-max-players'),
    document.getElementById('setting-min-players'),
    document.getElementById('setting-match-minutes'),
    document.getElementById('setting-map')
  ];

  populateMapSelect();

  startButton.addEventListener('click', () => {
    if (!socket || !roomCode) return;
    startButton.disabled = true;
    document.getElementById('start-game-message').textContent = 'Starting match...';
    socket.emit('start-game');
  });

  settingInputs.forEach(input => {
    input.addEventListener('change', sendLobbySettings);
  });
}

function initSocket() {
  socket = io({
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000
  });
  
  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('create-room', { deviceType: 'host' });
  });
  
  socket.on('room-created', (data) => {
    roomCode = data.roomCode;
    serverIP = data.hostIP;
    serverPort = data.port;
    joinUrl = data.joinUrl || `${window.location.origin}/controller`;
    lobbySettings = data.settings || lobbySettings;
    
    document.getElementById('waiting-message').style.display = 'none';
    document.getElementById('ip-display').style.display = 'block';
    document.getElementById('room-display').style.display = 'block';
    document.getElementById('ip-address').textContent = serverIP;
    document.getElementById('room-code').textContent = roomCode;
    
    console.log(`Room created: ${roomCode} at ${serverIP}:${data.port}`);

    updateLobbyFromRoomCreated(data);
  });

  socket.on('lobby-state', (data) => {
    handleLobbyState(data);
  });

  socket.on('game-started', (data) => {
    handleGameStarted(data);
  });

  socket.on('start-error', (data) => {
    document.getElementById('start-game-message').textContent = data.message || 'Unable to start match';
    updateLobbyStartState();
  });
  
  socket.on('player-connected', (data) => {
    console.log(`Player connected: ${data.playerId} (${data.colorName})`);
    createPlayer(data.playerId, data.color, data.colorName);
    updatePlayerCount();
    playSound('spawn');
  });
  
  socket.on('player-disconnected', (data) => {
    console.log(`Player disconnected: ${data.playerId}`);
    removePlayer(data.playerId);
    updatePlayerCount();
  });
  
  socket.on('player-input', (data) => {
    applyPlayerInput(data);
  });
  
  socket.on('quiz-completed', (data) => {
    handleQuizCompleted(data);
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
  
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
  });
}

// ============================================
// ARENA CREATION
// ============================================
function createArena() {
  disposeMapScene(mapRuntime);
  mapRuntime = buildMapScene({
    THREE,
    scene,
    renderer,
    map: activeMap,
    shadows: true,
    lightIntensity: 0.55
  });
  Object.assign(CONFIG.ARENA, mapRuntime.arena);
}

// ============================================
// PLAYER MANAGEMENT
// ============================================
function createPlayer(playerId, color, colorName) {
  const spawnPoint = getRandomSpawnPoint();
  
  // Create player group
  const playerGroup = new THREE.Group();
  playerGroup.position.set(spawnPoint.x, 0, spawnPoint.z);
  
  // Body (capsule-like using cylinder + spheres)
  const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.4, 1.2, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({ 
    color: color,
    roughness: 0.4,
    metalness: 0.6
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 1.0;
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.playerId = playerId;
  playerGroup.add(body);
  
  // Head
  const headGeometry = new THREE.SphereGeometry(0.35, 8, 8);
  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.position.y = 1.9;
  head.castShadow = true;
  head.userData.playerId = playerId;
  playerGroup.add(head);
  
  // Gun (simple box)
  const gunGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.5);
  const gunMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const gun = new THREE.Mesh(gunGeometry, gunMaterial);
  gun.position.set(0.5, 1.3, -0.4);
  playerGroup.add(gun);
  
  // Name label
  const labelDiv = document.createElement('div');
  labelDiv.className = 'player-label';
  labelDiv.textContent = colorName;
  labelDiv.style.color = color;
  const label = new CSS2DObject(labelDiv);
  label.position.set(0, 2.5, 0);
  playerGroup.add(label);
  
  // Streak leader tag (hidden initially)
  const crownDiv = document.createElement('div');
  crownDiv.className = 'crown-label';
  crownDiv.textContent = 'LEAD';
  crownDiv.style.display = 'none';
  const crownLabel = new CSS2DObject(crownDiv);
  crownLabel.position.set(0, 2.8, 0);
  playerGroup.add(crownLabel);
  
  scene.add(playerGroup);
  
  // Store player data - NOTE: we use group.position directly for all position access
  players[playerId] = {
    id: playerId,
    colorName: colorName,
    color: color,
    rotation: new THREE.Euler(0, spawnPoint.yaw || 0, 0, 'YXZ'),
    velocity: new THREE.Vector3(),
    health: CONFIG.PLAYER_MAX_HEALTH,
    maxHealth: CONFIG.PLAYER_MAX_HEALTH,
    ammo: CONFIG.PLAYER_START_AMMO,
    maxAmmo: CONFIG.PLAYER_MAX_AMMO,
    kills: 0,
    deaths: 0,
    streak: 0,
    alive: true,
    respawnTimer: 0,
    spawnProtection: CONFIG.SPAWN_PROTECTION_TIME,
    group: playerGroup,
    body: body,
    head: head,
    gun: gun,
    label: label,
    crownLabel: crownLabel,
    lastInput: {
      moveX: 0,
      moveY: 0,
      lookDeltaX: 0,
      lookDeltaY: 0,
      shoot: false,
      lastShootTime: 0
    }
  };
  playerGroup.rotation.y = players[playerId].rotation.y;
  
  updateLeaderboard();
  updateLobbyStartState();
}

function removePlayer(playerId) {
  const player = players[playerId];
  if (player) {
    scene.remove(player.group);
    delete players[playerId];
    updateLeaderboard();
    updateStreakLeader();
    updateLobbyStartState();
  }
}

function getSpawnPoint(index = Math.floor(Math.random() * CONFIG.SPAWN_POINTS.length)) {
  const spawnPoints = CONFIG.SPAWN_POINTS;
  const point = spawnPoints[index % spawnPoints.length] || { x: 0, z: 0, yaw: 0 };
  return { x: point.x, z: point.z, yaw: point.yaw || 0 };
}

function getRandomSpawnPoint() {
  return getSpawnPoint();
}

function respawnPlayer(player) {
  const spawnPoint = getRandomSpawnPoint();
  // Directly set position on the group
  player.group.position.set(spawnPoint.x, 0, spawnPoint.z);
  player.rotation.set(0, spawnPoint.yaw || Math.random() * Math.PI * 2, 0);
  player.group.rotation.y = player.rotation.y;
  player.health = CONFIG.PLAYER_MAX_HEALTH;
  player.ammo = CONFIG.PLAYER_START_AMMO;
  player.alive = true;
  player.spawnProtection = CONFIG.SPAWN_PROTECTION_TIME;
  player.group.visible = true;
  
  socket.emit('player-respawn', {
    playerId: player.id,
    health: player.health,
    ammo: player.ammo
  });
  
  playSound('spawn');
}

// ============================================
// INPUT HANDLING
// ============================================
function applyPlayerInput(data = {}) {
  if (!data.playerId) return;
  const player = players[data.playerId];
  if (!player || !player.alive) return;
  const input = sanitizePlayerInput(data);

  if (!matchActive && lobbyState && lobbyState.state === 'playing') {
    handleGameStarted({
      settings: lobbyState.settings,
      matchDuration: lobbyState.settings && lobbyState.settings.matchDuration,
      startedAt: lobbyState.startedAt
    });
  }

  const now = Date.now();
  if (now - lastInputLogAt > 1000) {
    lastInputLogAt = now;
    console.log('[host] input', {
      playerId: data.playerId,
      moveX: Number(input.moveX.toFixed(2)),
      moveY: Number(input.moveY.toFixed(2)),
      lookDeltaX: Number(input.lookDeltaX.toFixed(3)),
      lookDeltaY: Number(input.lookDeltaY.toFixed(3)),
      shoot: input.shoot
    });
  }
  
  player.lastInput.moveX = input.moveX;
  player.lastInput.moveY = input.moveY;
  player.lastInput.lookDeltaX = input.lookDeltaX;
  player.lastInput.lookDeltaY = input.lookDeltaY;
  player.lastInput.shoot = input.shoot;
}

// ============================================
// GAME UPDATE
// ============================================
function updateGame(deltaTime, elapsedTime = deltaTime) {
  if (!matchActive) return;
  
  // Update match timer
  matchTimer -= elapsedTime;
  updateTimerDisplay();
  
  if (matchTimer <= 0) {
    endMatch();
    return;
  }
  
  // Update each player
  Object.values(players).forEach(player => {
    if (player.alive) {
      updateAlivePlayer(player, deltaTime, elapsedTime);
    } else {
      updateDeadPlayer(player, elapsedTime);
    }
  });
  
  // Update camera
  updateCamera(deltaTime);
  
  // Broadcast game state periodically
  broadcastGameState();
}

function updateAlivePlayer(player, deltaTime, elapsedTime = deltaTime) {
  // Update spawn protection
  if (player.spawnProtection > 0) {
    player.spawnProtection -= elapsedTime;
    // Visual indicator - pulsing
    const pulse = Math.sin(Date.now() * 0.01) * 0.5 + 0.5;
    player.body.material.emissive.setHex(0x00ff00);
    player.body.material.emissiveIntensity = pulse * 0.5;
  } else {
    player.body.material.emissive.setHex(0x000000);
    player.body.material.emissiveIntensity = 0;
  }
  
  // Apply rotation from input first so movement and shooting use the same facing for this tick.
  const nextRotation = calculateLookRotation({
    rotationX: player.rotation.x,
    rotationY: player.rotation.y,
    lookDeltaX: player.lastInput.lookDeltaX,
    lookDeltaY: player.lastInput.lookDeltaY,
    sensitivity: CONFIG.LOOK_SENSITIVITY,
    turnRate: CONFIG.INPUT_RATE,
    deltaTime
  });
  player.rotation.x = nextRotation.x;
  player.rotation.y = nextRotation.y;
  
  // Apply rotation to group
  player.group.rotation.y = player.rotation.y;
  
  // Calculate movement using UPDATED rotation
  if (Math.abs(player.lastInput.moveX) > 0.001 || Math.abs(player.lastInput.moveY) > 0.001) {
    const nextPosition = applyMapMovement({
      x: player.group.position.x,
      z: player.group.position.z,
      rotationY: player.rotation.y,
      moveX: player.lastInput.moveX,
      moveY: player.lastInput.moveY,
      speed: CONFIG.MOVE_SPEED,
      deltaTime,
      map: activeMap,
      arena: CONFIG.ARENA
    });

    player.group.position.x = nextPosition.x;
    player.group.position.z = nextPosition.z;
  }
  
  // Handle shooting
  if (player.lastInput.shoot && player.ammo > 0) {
    const now = Date.now();
    if (now - player.lastInput.lastShootTime > 200) { // Fire rate limit
      processShot(player.id);
      player.lastInput.lastShootTime = now;
    }
  }
  
  // Look input is a held stick value, like movement. It is cleared by the next zero input packet.
}

function updateDeadPlayer(player, deltaTime) {
  player.respawnTimer -= deltaTime;
  
  if (player.respawnTimer <= 0) {
    respawnPlayer(player);
  }
}

// ============================================
// WEAPON SYSTEM
// ============================================
function processShot(playerId) {
  const player = players[playerId];
  if (!player || !player.alive || player.ammo <= 0) return;
  
  player.ammo--;
  playSound('shoot');
  
  // Create muzzle flash
  createMuzzleFlash(player);
  
  // Calculate aim direction
  const aimDirection = new THREE.Vector3(0, 0, -1);
  aimDirection.applyEuler(player.rotation);
  aimDirection.normalize();
  
  // Ray origin at gun position - use group.position
  const rayOrigin = player.group.position.clone();
  rayOrigin.y += 1.3; // Gun height
  
  raycaster.set(rayOrigin, aimDirection);
  
  // Check hits on other players
  const otherPlayerMeshes = [];
  Object.values(players).forEach(p => {
    if (p.id !== playerId && p.alive) {
      otherPlayerMeshes.push(p.body);
      otherPlayerMeshes.push(p.head);
    }
  });
  
  const playerIntersects = raycaster.intersectObjects(otherPlayerMeshes);
  const blockerIntersects = mapRuntime && mapRuntime.shotBlockers
    ? raycaster.intersectObjects(mapRuntime.shotBlockers)
    : [];
  const nearestPlayerHit = playerIntersects[0];
  const nearestBlockerHit = blockerIntersects[0];

  if (nearestBlockerHit && (!nearestPlayerHit || nearestBlockerHit.distance < nearestPlayerHit.distance)) {
    return;
  }
  
  if (nearestPlayerHit) {
    const hitMesh = nearestPlayerHit.object;
    const hitPlayerId = hitMesh.userData.playerId;
    const hitPlayer = players[hitPlayerId];
    
    if (hitPlayer && hitPlayer.spawnProtection <= 0) {
      // Apply damage
      const isHeadshot = hitMesh === hitPlayer.head;
      const damage = isHeadshot ? CONFIG.WEAPON_DAMAGE * 2 : CONFIG.WEAPON_DAMAGE;
      
      hitPlayer.health -= damage;
      playSound('hit');
      
      // Create hit effect
      createHitEffect(nearestPlayerHit.point);
      
      if (hitPlayer.health <= 0) {
        // Kill confirmed
        handleKill(player, hitPlayer);
      }
    }
  }
}

function createMuzzleFlash(player) {
  const flash = new THREE.PointLight(0xffaa00, 2, 5);
  const flashPos = player.gun.getWorldPosition(new THREE.Vector3());
  flash.position.copy(flashPos);
  scene.add(flash);
  
  setTimeout(() => {
    scene.remove(flash);
  }, 50);
}

function createHitEffect(position) {
  const particleCount = 8;
  const particles = new THREE.Group();
  
  for (let i = 0; i < particleCount; i++) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.05),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    particle.position.copy(position);
    particle.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      Math.random() * 2,
      (Math.random() - 0.5) * 2
    );
    particles.add(particle);
  }
  
  scene.add(particles);
  
  // Animate particles
  let frame = 0;
  const animateParticles = () => {
    if (frame > 30) {
      scene.remove(particles);
      return;
    }
    particles.children.forEach(p => {
      p.position.add(p.velocity.clone().multiplyScalar(0.1));
      p.velocity.y -= 0.1;
    });
    frame++;
    requestAnimationFrame(animateParticles);
  };
  animateParticles();
}

function handleKill(killer, victim) {
  killer.kills++;
  killer.streak++;
  victim.deaths++;
  victim.streak = 0;
  victim.alive = false;
  victim.respawnTimer = CONFIG.RESPAWN_TIME;
  victim.group.visible = false;
  
  playSound('kill');
  
  // Add kill to feed
  addKillFeed(killer.colorName, victim.colorName, killer.color, victim.color);
  
  socket.emit('kill-event', {
    killerId: killer.id,
    victimId: victim.id,
    killerStreak: killer.streak,
    timestamp: Date.now()
  });
  
  socket.emit('player-death', {
    victimId: victim.id,
    killerId: killer.id,
    killerName: killer.colorName,
    respawnTime: CONFIG.RESPAWN_TIME
  });
  
  updateStreakLeader();
  updateLeaderboard();
}

// ============================================
// QUIZ SYSTEM
// ============================================
function handleQuizCompleted(data) {
  const player = players[data.playerId];
  if (!player) return;
  
  const reward = CONFIG.QUIZ_REWARDS[data.correctCount] || 0;
  player.ammo = Math.min(player.ammo + reward, CONFIG.PLAYER_MAX_AMMO);
  
  socket.emit('ammo-update', {
    playerId: data.playerId,
    ammo: player.ammo,
    ammoGained: reward
  });
}

// ============================================
// CAMERA SYSTEM
// ============================================
function updateCamera(deltaTime) {
  if (streakLeader && players[streakLeader] && players[streakLeader].streak >= CONFIG.STREAK_THRESHOLD) {
    currentCameraState = CameraState.FOLLOWING;
    
    const player = players[streakLeader];
    
    // Position camera behind and above streak leader - use group.position
    const offset = new THREE.Vector3(0, 8, 12);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y);
    const targetPos = player.group.position.clone().add(offset);
    
    // Smooth camera transition
    camera.position.lerp(targetPos, 0.05);
    
    // Look at player - use group.position
    const lookTarget = player.group.position.clone();
    lookTarget.y += 1.5;
    camera.lookAt(lookTarget);
    
    // Update camera mode display
    document.getElementById('camera-mode').classList.add('following');
    document.getElementById('camera-mode-text').textContent = `FOLLOWING: ${player.colorName}`;
    
  } else {
    currentCameraState = CameraState.OVERVIEW;
    
    // Return to overview position
    camera.position.lerp(overviewPosition, 0.02);
    camera.lookAt(overviewTarget);
    
    document.getElementById('camera-mode').classList.remove('following');
    document.getElementById('camera-mode-text').textContent = 'OVERVIEW';
  }
}

function updateStreakLeader() {
  let maxStreak = CONFIG.STREAK_THRESHOLD - 1;
  let newLeader = null;
  
  Object.values(players).forEach(player => {
    if (player.alive && player.streak > maxStreak) {
      maxStreak = player.streak;
      newLeader = player.id;
    }
  });
  
  // Update crown visibility
  Object.values(players).forEach(player => {
    const crownDiv = player.crownLabel.element;
    if (player.id === newLeader) {
      crownDiv.style.display = 'block';
    } else {
      crownDiv.style.display = 'none';
    }
  });
  
  streakLeader = newLeader;
}

// ============================================
// UI UPDATES
// ============================================
function clampNumber(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  const target = Number.isFinite(parsed) ? parsed : min;
  return Math.max(min, Math.min(max, target));
}

function updateLobbyFromRoomCreated(data) {
  document.body.classList.add('lobby-active');
  document.getElementById('lobby-room-code').textContent = data.roomCode || '----';
  document.getElementById('lobby-server-ip').textContent = `${data.hostIP}:${data.port}`;
  document.getElementById('lobby-join-url').textContent = joinUrl;
  applyMapFromRoomData(data, { repositionPlayers: true });
  applyLobbySettings(data.settings || lobbySettings, data.maxAllowedPlayers);
  updateLobbyStartState();
}

function handleLobbyState(data) {
  lobbyState = data;
  lobbySettings = data.settings || lobbySettings;
  applyMapFromRoomData(data, { repositionPlayers: !matchActive });

  if (data.state === 'playing' && !matchActive) {
    handleGameStarted({
      settings: data.settings,
      map: data.map,
      matchDuration: data.settings && data.settings.matchDuration,
      startedAt: data.startedAt
    });
  }

  if (data.roomCode) {
    document.getElementById('lobby-room-code').textContent = data.roomCode;
  }

  applyLobbySettings(lobbySettings, data.maxAllowedPlayers);
  renderLobbyPlayers(data.players || []);
  updatePlayerCount();
  updateLobbyStartState();
}

function handleGameStarted(data) {
  lobbySettings = data.settings || lobbySettings;
  applyMapFromRoomData(data, { repositionPlayers: false });
  const matchDuration = data.matchDuration || lobbySettings.matchDuration || CONFIG.MATCH_DURATION;
  const elapsedSinceStart = data.startedAt ? Math.max(0, (Date.now() - data.startedAt) / 1000) : 0;
  CONFIG.MATCH_DURATION = matchDuration;
  matchTimer = Math.max(0, matchDuration - elapsedSinceStart);
  matchActive = true;

  document.body.classList.remove('lobby-active');
  document.getElementById('match-end-screen').style.display = 'none';
  document.getElementById('start-game-message').textContent = 'Match running';

  updateTimerDisplay();
  updatePlayerCount();
}

function applyMapFromRoomData(data = {}, options = {}) {
  const requestedMap = getMapFromPayload(data);
  const requestedMapId = requestedMap
    ? requestedMap.id
    : data.settings && data.settings.mapId;
  if (!requestedMapId) return;

  const nextMap = requestedMap || getMapById(requestedMapId);
  if (!nextMap) return;

  const changed = !activeMap || activeMap.id !== nextMap.id;
  if (changed) {
    applyActiveMap(nextMap, {
      rebuild: Boolean(scene),
      repositionPlayers: Boolean(options.repositionPlayers)
    });
  }
  lobbySettings.mapId = nextMap.id;
}

function populateMapSelect() {
  const mapSelect = document.getElementById('setting-map');
  if (!mapSelect) return;

  mapSelect.replaceChildren();
  mapLibrary.forEach(map => {
    const option = document.createElement('option');
    option.value = map.id;
    option.textContent = map.name || map.id;
    mapSelect.appendChild(option);
  });

  mapSelect.value = activeMap ? activeMap.id : CONFIG.DEFAULT_MAP_ID;
}

function applyLobbySettings(settings, maxAllowedPlayers) {
  const maxPlayersInput = document.getElementById('setting-max-players');
  const minPlayersInput = document.getElementById('setting-min-players');
  const matchMinutesInput = document.getElementById('setting-match-minutes');
  const mapSelect = document.getElementById('setting-map');
  const maxAllowed = maxAllowedPlayers || CONFIG.MAX_PLAYERS;
  const playerCount = lobbyState ? lobbyState.playerCount : 0;

  maxPlayersInput.max = maxAllowed;
  maxPlayersInput.min = Math.max(1, playerCount);
  maxPlayersInput.value = settings.maxPlayers;

  minPlayersInput.max = settings.maxPlayers;
  minPlayersInput.value = settings.minPlayers;

  matchMinutesInput.value = Math.round(settings.matchDuration / 60);
  if (mapSelect) {
    mapSelect.value = settings.mapId || (activeMap && activeMap.id) || CONFIG.DEFAULT_MAP_ID;
  }

  if (!matchActive) {
    matchTimer = settings.matchDuration;
    updateTimerDisplay();
  }
}

function sendLobbySettings() {
  if (!socket || !roomCode || matchActive) return;

  const maxPlayersInput = document.getElementById('setting-max-players');
  const minPlayersInput = document.getElementById('setting-min-players');
  const matchMinutesInput = document.getElementById('setting-match-minutes');
  const mapSelect = document.getElementById('setting-map');
  const maxAllowed = Number.parseInt(maxPlayersInput.max, 10) || CONFIG.MAX_PLAYERS;
  const currentPlayers = lobbyState ? lobbyState.playerCount : Object.keys(players).length;

  const maxPlayers = clampNumber(maxPlayersInput.value, Math.max(1, currentPlayers), maxAllowed);
  const minPlayers = clampNumber(minPlayersInput.value, 1, maxPlayers);
  const matchMinutes = clampNumber(matchMinutesInput.value, 1, 15);

  maxPlayersInput.value = maxPlayers;
  minPlayersInput.value = minPlayers;
  matchMinutesInput.value = matchMinutes;
  const mapId = mapSelect && mapSelect.value ? mapSelect.value : (activeMap && activeMap.id) || CONFIG.DEFAULT_MAP_ID;

  socket.emit('update-room-settings', {
    settings: {
      maxPlayers,
      minPlayers,
      matchDuration: matchMinutes * 60,
      mapId
    }
  });
}

function renderLobbyPlayers(queuedPlayers) {
  const list = document.getElementById('lobby-player-list');
  list.replaceChildren();

  if (!queuedPlayers.length) {
    const empty = document.createElement('div');
    empty.className = 'lobby-empty';
    empty.textContent = 'Waiting for players...';
    list.appendChild(empty);
    return;
  }

  queuedPlayers.forEach(player => {
    const entry = document.createElement('div');
    entry.className = 'lobby-player';

    const swatch = document.createElement('div');
    swatch.className = 'lobby-player-swatch';
    swatch.style.backgroundColor = player.color;

    const name = document.createElement('div');
    name.className = 'lobby-player-name';
    name.textContent = `${player.colorName} Player`;

    const slot = document.createElement('div');
    slot.className = 'lobby-player-slot';
    slot.textContent = `#${String(player.slot).padStart(2, '0')}`;

    entry.append(swatch, name, slot);
    list.appendChild(entry);
  });
}

function updateLobbyStartState() {
  const startButton = document.getElementById('start-game-btn');
  const message = document.getElementById('start-game-message');
  const status = document.getElementById('lobby-status');
  const playerCount = lobbyState ? lobbyState.playerCount : Object.keys(players).length;
  const minPlayers = lobbySettings.minPlayers || 1;
  const maxPlayers = lobbySettings.maxPlayers || CONFIG.MAX_PLAYERS;

  document.getElementById('lobby-player-count').textContent = `${playerCount}/${maxPlayers}`;

  if (!roomCode) {
    startButton.disabled = true;
    message.textContent = 'Waiting for room code...';
    status.textContent = 'Creating room...';
    return;
  }

  if (matchActive) {
    startButton.disabled = true;
    message.textContent = 'Match running';
    status.textContent = 'Match running';
    return;
  }

  status.textContent = `${playerCount}/${maxPlayers} queued`;

  if (playerCount < minPlayers) {
    const needed = minPlayers - playerCount;
    startButton.disabled = true;
    message.textContent = `Need ${needed} more player${needed === 1 ? '' : 's'} to start`;
    return;
  }

  startButton.disabled = false;
  message.textContent = `${playerCount}/${maxPlayers} players ready`;
}

function updateLeaderboard() {
  const sorted = Object.values(players).sort((a, b) => b.kills - a.kills);
  
  if (sorted.length === 0) {
    document.getElementById('leaderboard-content').innerHTML = 
      '<div class="no-players">Waiting for players...</div>';
    return;
  }
  
  const html = sorted.map((p, i) => `
    <div class="leaderboard-entry ${p.streak >= CONFIG.STREAK_THRESHOLD ? 'streak' : ''}">
      <span class="rank">${i + 1}.</span>
      <span class="player-name" style="color: ${p.color}">${p.colorName}</span>
      <span class="stats">${p.kills}-${p.deaths}</span>
      ${p.streak >= CONFIG.STREAK_THRESHOLD ? `<span class="streak-indicator">STK ${p.streak}</span>` : ''}
      ${p.id === streakLeader ? '<span class="crown">LEAD</span>' : ''}
    </div>
  `).join('');
  
  document.getElementById('leaderboard-content').innerHTML = html;
}

function updatePlayerCount() {
  document.getElementById('current-players').textContent = Object.keys(players).length;
  document.getElementById('max-players').textContent = lobbySettings.maxPlayers || CONFIG.MAX_PLAYERS;
}

function updateTimerDisplay() {
  const minutes = Math.floor(matchTimer / 60);
  const seconds = Math.floor(matchTimer % 60);
  const display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const timerEl = document.getElementById('timer-display');
  timerEl.textContent = display;
  
  if (matchTimer <= 30) {
    timerEl.classList.add('warning');
  } else {
    timerEl.classList.remove('warning');
  }
}

function addKillFeed(killerName, victimName, killerColor, victimColor) {
  const feed = document.getElementById('kill-feed');
  const entry = document.createElement('div');
  entry.className = 'kill-entry';
  entry.innerHTML = `
    <span class="killer" style="color: ${killerColor}">${killerName}</span>
    <span class="icon">ELIM</span>
    <span class="victim" style="color: ${victimColor}">${victimName}</span>
  `;
  feed.insertBefore(entry, feed.firstChild);
  
  // Remove after animation
  setTimeout(() => {
    if (entry.parentNode) {
      entry.remove();
    }
  }, 5000);
  
  // Limit feed size
  while (feed.children.length > 5) {
    feed.removeChild(feed.lastChild);
  }
}

// ============================================
// GAME STATE BROADCAST
// ============================================
let lastBroadcast = 0;
function broadcastGameState() {
  const now = Date.now();
  if (now - lastBroadcast < 33) return; // 30Hz for smoother updates
  lastBroadcast = now;
  
  const state = {
    players: {},
    streakLeader: streakLeader,
    matchTime: matchTimer,
    timestamp: now
  };
  
  Object.values(players).forEach(p => {
    state.players[p.id] = {
      health: p.health,
      ammo: p.ammo,
      kills: p.kills,
      deaths: p.deaths,
      streak: p.streak,
      alive: p.alive
    };
  });
  
  socket.emit('game-state', state);
  socket.emit('match-timer', { timeRemaining: matchTimer });
  
  // Full state with positions for controller 3D rendering - use group.position
  const fullState = {
    players: {},
    timestamp: now
  };
  
  Object.values(players).forEach(p => {
    fullState.players[p.id] = {
      x: p.group.position.x,
      y: p.group.position.y,
      z: p.group.position.z,
      rotY: p.rotation.y,
      rotX: p.rotation.x,
      color: p.color,
      colorName: p.colorName,
      alive: p.alive
    };
  });
  
  socket.emit('full-state', fullState);
}

// ============================================
// MATCH END
// ============================================
function endMatch() {
  matchActive = false;
  playSound('death');
  
  // Find winner
  const sorted = Object.values(players).sort((a, b) => b.kills - a.kills);
  const winner = sorted[0];
  
  // Show end screen
  const endScreen = document.getElementById('match-end-screen');
  endScreen.style.display = 'flex';
  
  if (winner) {
    document.getElementById('winner-display').innerHTML = `
      WINNER<br>
      <span class="winner-name" style="color: ${winner.color}">${winner.colorName}</span><br>
      ${winner.kills} Kills
    `;
  } else {
    document.getElementById('winner-display').innerHTML = 'No winner';
  }
  
  const scoresHtml = sorted.map((p, i) => `
    <div class="final-score-entry" style="color: ${p.color}">
      ${i + 1}. ${p.colorName}: ${p.kills} kills, ${p.deaths} deaths
    </div>
  `).join('');
  document.getElementById('final-scores').innerHTML = scoresHtml;
  
  // Broadcast match end
  socket.emit('match-end', {
    winner: winner ? { id: winner.id, colorName: winner.colorName, kills: winner.kills } : null,
    finalScores: sorted.map(p => ({
      id: p.id,
      colorName: p.colorName,
      kills: p.kills,
      deaths: p.deaths
    }))
  });
  
  // Restart button
  document.getElementById('restart-btn').onclick = restartMatch;
}

function restartMatch() {
  document.getElementById('match-end-screen').style.display = 'none';
  
  // Reset all players
  Object.values(players).forEach(player => {
    player.kills = 0;
    player.deaths = 0;
    player.streak = 0;
    player.health = CONFIG.PLAYER_MAX_HEALTH;
    player.ammo = CONFIG.PLAYER_START_AMMO;
    player.alive = true;
    player.group.visible = true;
    respawnPlayer(player);
  });
  
  // Reset match timer
  matchTimer = CONFIG.MATCH_DURATION;
  matchActive = true;
  streakLeader = null;
  socket.emit('restart-game', {
    settings: lobbySettings,
    matchDuration: CONFIG.MATCH_DURATION,
    startedAt: Date.now()
  });
  
  updateLeaderboard();
  updateStreakLeader();
}

// ============================================
// WINDOW RESIZE
// ============================================
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================
// ANIMATION LOOP
// ============================================
function startSimulationLoop() {
  if (simulationRunning) return;

  simulationRunning = true;
  lastSimulationAt = performance.now();
}

function animate() {
  requestAnimationFrame(animate);

  if (simulationRunning) {
    const now = performance.now();
    const elapsedTime = Math.max(0, (now - lastSimulationAt) / 1000);
    const deltaTime = Math.min(elapsedTime, MAX_SIMULATION_DELTA);
    lastSimulationAt = now;
    updateGame(deltaTime, elapsedTime);
  }
  
  // Resume audio context on first interaction
  if (audioContext.state === 'suspended') {
    document.addEventListener('click', () => audioContext.resume(), { once: true });
  }

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ============================================
// START
// ============================================
init();
