const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const config = require('./shared/config');
const questions = require('./shared/questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

const MAX_ROOM_PLAYERS = Math.min(config.MAX_PLAYERS, config.PLAYER_COLORS.length);
const MIN_MATCH_DURATION = 60;
const MAX_MATCH_DURATION = 900;

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Serve static files
app.use('/host', express.static(path.join(__dirname, 'host')));
app.use('/controller', express.static(path.join(__dirname, 'controller')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// Routes
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Multiplayer FPS</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Sans:wght@500;700&family=JetBrains+Mono:wght@700;800&display=swap');
          * { box-sizing: border-box; }
          body {
            min-height: 100vh;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #f4efe2;
            background:
              linear-gradient(116deg, rgba(5, 6, 7, 0.99), rgba(9, 12, 12, 0.96) 58%, rgba(28, 18, 9, 0.9)),
              repeating-linear-gradient(135deg, rgba(255, 178, 63, 0.07) 0 1px, transparent 1px 17px);
            font-family: 'IBM Plex Sans', Verdana, sans-serif;
          }
          main {
            width: min(520px, calc(100% - 36px));
            padding: 32px;
            border: 1px solid rgba(235, 230, 214, 0.17);
            border-radius: 8px;
            background: linear-gradient(180deg, rgba(255,255,255,0.06), transparent 42%), rgba(12, 14, 15, 0.9);
            box-shadow: 0 24px 70px rgba(0, 0, 0, 0.48);
          }
          h1 {
            margin: 0 0 24px;
            font-family: 'Bebas Neue', Impact, sans-serif;
            font-size: 5.6rem;
            font-weight: 400;
            line-height: 0.9;
          }
          nav {
            display: grid;
            gap: 12px;
          }
          a {
            min-height: 58px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 18px;
            border: 1px solid rgba(255, 178, 63, 0.46);
            border-radius: 6px;
            color: #f4efe2;
            background: rgba(255,255,255,0.055);
            font: 800 0.9rem 'JetBrains Mono', 'Courier New', monospace;
            letter-spacing: 0.08em;
            text-decoration: none;
          }
          a::after { content: '>'; color: #ffb23f; font-size: 1.5rem; }
          a:hover { border-color: #26d8d8; background: rgba(38, 216, 216, 0.1); }
        </style>
      </head>
      <body>
        <main>
          <h1>Arena FPS</h1>
          <nav>
            <a href="/host">HOST DISPLAY</a>
            <a href="/controller">MOBILE CONTROLLER</a>
          </nav>
        </main>
      </body>
    </html>
  `);
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'host', 'index.html'));
});

app.get('/controller', (req, res) => {
  res.sendFile(path.join(__dirname, 'controller', 'index.html'));
});

// API endpoint to get config for clients
app.get('/api/config', (req, res) => {
  res.json({
    MAX_PLAYERS: MAX_ROOM_PLAYERS,
    MIN_PLAYERS: config.MIN_PLAYERS,
    PLAYER_MAX_HEALTH: config.PLAYER_MAX_HEALTH,
    PLAYER_MAX_AMMO: config.PLAYER_MAX_AMMO,
    PLAYER_START_AMMO: config.PLAYER_START_AMMO,
    WEAPON_DAMAGE: config.WEAPON_DAMAGE,
    RESPAWN_TIME: config.RESPAWN_TIME,
    SPAWN_PROTECTION_TIME: config.SPAWN_PROTECTION_TIME,
    MOVE_SPEED: config.MOVE_SPEED,
    LOOK_SENSITIVITY: config.LOOK_SENSITIVITY,
    MATCH_DURATION: config.MATCH_DURATION,
    STREAK_THRESHOLD: config.STREAK_THRESHOLD,
    QUIZ_REWARDS: config.QUIZ_REWARDS,
    ARENA: config.ARENA,
    SPAWN_POINTS: config.SPAWN_POINTS
  });
});

// Room management
const rooms = {};
// Track used colors per room
const roomColors = {};

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  const target = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, target));
}

function createDefaultRoomSettings() {
  const maxPlayers = MAX_ROOM_PLAYERS;
  return {
    maxPlayers,
    minPlayers: Math.min(Math.max(config.MIN_PLAYERS || 1, 1), maxPlayers),
    matchDuration: config.MATCH_DURATION
  };
}

function sanitizeRoomSettings(settings, room) {
  const current = room.settings || createDefaultRoomSettings();
  const playerCount = room.playerIds.length;
  const maxPlayers = clampInt(
    settings && settings.maxPlayers,
    Math.max(1, playerCount),
    MAX_ROOM_PLAYERS,
    current.maxPlayers
  );
  const minPlayers = clampInt(
    settings && settings.minPlayers,
    1,
    maxPlayers,
    Math.min(current.minPlayers, maxPlayers)
  );
  const matchDuration = clampInt(
    settings && settings.matchDuration,
    MIN_MATCH_DURATION,
    MAX_MATCH_DURATION,
    current.matchDuration
  );

  return { maxPlayers, minPlayers, matchDuration };
}

function getLobbyState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return null;

  return {
    roomCode,
    state: room.state,
    createdAt: room.createdAt,
    startedAt: room.startedAt || null,
    playerCount: room.playerIds.length,
    maxAllowedPlayers: MAX_ROOM_PLAYERS,
    settings: room.settings,
    players: room.playerIds.map((playerId, index) => ({
      playerId,
      slot: index + 1,
      color: room.players[playerId].color,
      colorName: room.players[playerId].colorName,
      joinedAt: room.players[playerId].joinedAt
    }))
  };
}

function emitLobbyState(roomCode) {
  const state = getLobbyState(roomCode);
  if (state) {
    io.to(roomCode).emit('lobby-state', state);
  }
}

// Get local IP address
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Get all local IP addresses (for debugging)
function getAllLocalIPs() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name: name, address: iface.address });
      }
    }
  }
  return ips;
}

// Generate random 4-digit room code
function generateRoomCode() {
  let code;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms[code]); // Ensure unique
  return code;
}

// Get random quiz questions
function getRandomQuestions(count = 3) {
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((q, idx) => ({
    id: idx,
    question: q.question,
    options: q.options,
    correct: q.correct
  }));
}

// Assign color to player
function assignPlayerColor(roomCode) {
  if (!roomColors[roomCode]) {
    roomColors[roomCode] = [];
  }
  
  for (let i = 0; i < config.PLAYER_COLORS.length; i++) {
    if (!roomColors[roomCode].includes(i)) {
      roomColors[roomCode].push(i);
      return {
        color: config.PLAYER_COLORS[i],
        colorName: config.COLOR_NAMES[i],
        colorIndex: i
      };
    }
  }
  return null;
}

// Release color when player leaves
function releasePlayerColor(roomCode, colorIndex) {
  if (roomColors[roomCode]) {
    const idx = roomColors[roomCode].indexOf(colorIndex);
    if (idx > -1) {
      roomColors[roomCode].splice(idx, 1);
    }
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id} from ${socket.handshake.address}`);
  
  // Host creates room
  socket.on('create-room', (data) => {
    const roomCode = generateRoomCode();
    const hostIP = getLocalIPAddress();
    
    rooms[roomCode] = {
      hostId: socket.id,
      playerIds: [],
      players: {},
      state: 'lobby',
      settings: createDefaultRoomSettings(),
      hostIP: hostIP,
      createdAt: Date.now()
    };
    roomColors[roomCode] = [];
    
    socket.roomCode = roomCode;
    socket.deviceType = 'host';
    socket.join(roomCode);
    
    console.log(`Room ${roomCode} created by host ${socket.id}`);
    
    socket.emit('room-created', {
      roomCode: roomCode,
      hostIP: hostIP,
      port: config.SERVER_PORT,
      joinUrl: `http://${hostIP}:${config.SERVER_PORT}/controller`,
      settings: rooms[roomCode].settings,
      maxAllowedPlayers: MAX_ROOM_PLAYERS
    });
    emitLobbyState(roomCode);
  });
  
  // Controller joins room
  socket.on('join-room', (data) => {
    const { roomCode } = data;
    
    const room = rooms[roomCode];
    
    if (!room) {
      socket.emit('join-error', { message: 'Room not found' });
      return;
    }
    
    if (room.state !== 'lobby') {
      socket.emit('join-error', { message: 'Game already started' });
      return;
    }
    
    if (room.playerIds.length >= room.settings.maxPlayers) {
      socket.emit('join-error', { message: 'Room is full' });
      return;
    }
    
    const colorInfo = assignPlayerColor(roomCode);
    if (!colorInfo) {
      socket.emit('join-error', { message: 'No colors available' });
      return;
    }
    
    socket.roomCode = roomCode;
    socket.deviceType = 'controller';
    socket.colorIndex = colorInfo.colorIndex;
    socket.join(roomCode);
    
    room.playerIds.push(socket.id);
    room.players[socket.id] = {
      color: colorInfo.color,
      colorName: colorInfo.colorName,
      colorIndex: colorInfo.colorIndex,
      joinedAt: Date.now()
    };
    
    console.log(`Player ${socket.id} (${colorInfo.colorName}) joined room ${roomCode}`);
    
    // Notify controller
    socket.emit('room-joined', {
      playerId: socket.id,
      color: colorInfo.color,
      colorName: colorInfo.colorName,
      roomCode: roomCode,
      state: room.state,
      settings: room.settings
    });
    
    // Notify host
    const hostSocket = io.sockets.sockets.get(room.hostId);
    if (hostSocket) {
      hostSocket.emit('player-connected', {
        playerId: socket.id,
        color: colorInfo.color,
        colorName: colorInfo.colorName,
        timestamp: Date.now()
      });
    }
    
    emitLobbyState(roomCode);
  });

  // Host updates lobby settings
  socket.on('update-room-settings', (data) => {
    if (!socket.roomCode || !rooms[socket.roomCode]) return;
    
    const room = rooms[socket.roomCode];
    if (room.hostId !== socket.id || room.state !== 'lobby') return;
    
    room.settings = sanitizeRoomSettings((data && data.settings) || data || {}, room);
    emitLobbyState(socket.roomCode);
  });

  // Host starts the match
  socket.on('start-game', () => {
    if (!socket.roomCode || !rooms[socket.roomCode]) return;
    
    const room = rooms[socket.roomCode];
    if (room.hostId !== socket.id) return;
    
    if (room.state !== 'lobby') {
      socket.emit('start-error', { message: 'Game already started' });
      return;
    }
    
    if (room.playerIds.length < room.settings.minPlayers) {
      socket.emit('start-error', {
        message: `Need ${room.settings.minPlayers} player${room.settings.minPlayers === 1 ? '' : 's'} to start`
      });
      return;
    }
    
    room.state = 'playing';
    room.startedAt = Date.now();
    
    io.to(socket.roomCode).emit('game-started', {
      roomCode: socket.roomCode,
      settings: room.settings,
      matchDuration: room.settings.matchDuration,
      startedAt: room.startedAt
    });
    emitLobbyState(socket.roomCode);
  });
  
  // Controller sends input
  socket.on('player-input', (data) => {
    if (!socket.roomCode || !rooms[socket.roomCode]) return;
    
    const room = rooms[socket.roomCode];
    const hostSocket = io.sockets.sockets.get(room.hostId);
    
    if (hostSocket) {
      hostSocket.emit('player-input', {
        playerId: socket.id,
        moveX: data.moveX,
        moveY: data.moveY,
        lookDeltaX: data.lookDeltaX,
        lookDeltaY: data.lookDeltaY,
        shoot: data.shoot,
        jump: data.jump,
        timestamp: data.timestamp
      });
    }
  });
  
  // Controller requests quiz (for ammo)
  socket.on('request-quiz', () => {
    const quizQuestions = getRandomQuestions(3);
    socket.emit('quiz-questions', {
      questions: quizQuestions,
      timestamp: Date.now()
    });
  });
  
  // Controller submits quiz answers
  socket.on('submit-quiz', (data) => {
    if (!socket.roomCode || !rooms[socket.roomCode]) return;
    
    const { answers } = data; // Array of { questionId, selectedOption }
    let correctCount = 0;
    
    // Note: In a real implementation, we'd validate against stored questions
    // For simplicity, the correct answers are included in the questions sent to client
    // This is handled client-side for this demo
    
    // Forward to host to process ammo reward
    const room = rooms[socket.roomCode];
    const hostSocket = io.sockets.sockets.get(room.hostId);
    
    if (hostSocket) {
      hostSocket.emit('quiz-completed', {
        playerId: socket.id,
        correctCount: data.correctCount,
        timestamp: Date.now()
      });
    }
  });
  
  // Host broadcasts game state
  socket.on('game-state', (data) => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('game-state', data);
  });
  
  // Host broadcasts full state with positions
  socket.on('full-state', (data) => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('full-state', data);
  });
  
  // Host broadcasts kill event
  socket.on('kill-event', (data) => {
    if (!socket.roomCode) return;
    io.to(socket.roomCode).emit('kill-event', data);
  });
  
  // Host sends death notification to specific player
  socket.on('player-death', (data) => {
    const victimSocket = io.sockets.sockets.get(data.victimId);
    if (victimSocket) {
      victimSocket.emit('player-died', {
        playerId: data.victimId,
        killerId: data.killerId,
        killerName: data.killerName,
        respawnTime: data.respawnTime
      });
    }
  });
  
  // Host sends respawn notification
  socket.on('player-respawn', (data) => {
    const playerSocket = io.sockets.sockets.get(data.playerId);
    if (playerSocket) {
      playerSocket.emit('player-respawned', data);
    }
  });
  
  // Host sends ammo update after quiz
  socket.on('ammo-update', (data) => {
    const playerSocket = io.sockets.sockets.get(data.playerId);
    if (playerSocket) {
      playerSocket.emit('ammo-updated', {
        ammo: data.ammo,
        ammoGained: data.ammoGained
      });
    }
  });
  
  // Host broadcasts match timer
  socket.on('match-timer', (data) => {
    if (!socket.roomCode) return;
    io.to(socket.roomCode).emit('match-timer', data);
  });
  
  // Host broadcasts match end
  socket.on('match-end', (data) => {
    if (!socket.roomCode) return;
    io.to(socket.roomCode).emit('match-end', data);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    if (socket.roomCode && rooms[socket.roomCode]) {
      const room = rooms[socket.roomCode];
      
      if (socket.deviceType === 'host') {
        // Host disconnected - notify all players and clean up room
        io.to(socket.roomCode).emit('host-disconnected');
        delete rooms[socket.roomCode];
        delete roomColors[socket.roomCode];
        console.log(`Room ${socket.roomCode} closed (host disconnected)`);
      } else if (socket.deviceType === 'controller') {
        // Player disconnected
        const idx = room.playerIds.indexOf(socket.id);
        if (idx > -1) {
          room.playerIds.splice(idx, 1);
        }
        
        // Release color
        if (socket.colorIndex !== undefined) {
          releasePlayerColor(socket.roomCode, socket.colorIndex);
        }
        
        delete room.players[socket.id];
        
        // Notify host
        const hostSocket = io.sockets.sockets.get(room.hostId);
        if (hostSocket) {
          hostSocket.emit('player-disconnected', {
            playerId: socket.id,
            timestamp: Date.now()
          });
        }
        
        console.log(`Player ${socket.id} left room ${socket.roomCode}`);
        emitLobbyState(socket.roomCode);
      }
    }
  });
});

// Start server
server.listen(config.SERVER_PORT, '0.0.0.0', () => {
  const ip = getLocalIPAddress();
  const allIPs = getAllLocalIPs();
  
  console.log('');
  console.log('='.repeat(50));
  console.log('MULTIPLAYER FPS SERVER STARTED');
  console.log('='.repeat(50));
  console.log(`Local:    http://localhost:${config.SERVER_PORT}`);
  console.log(`Network:  http://${ip}:${config.SERVER_PORT}`);
  console.log('');
  console.log(`Host:     http://${ip}:${config.SERVER_PORT}/host`);
  console.log(`Control:  http://${ip}:${config.SERVER_PORT}/controller`);
  console.log('');
  if (allIPs.length > 1) {
    console.log('All available network interfaces:');
    allIPs.forEach(({ name, address }) => {
      console.log(`  ${name}: ${address}`);
    });
  }
  console.log('='.repeat(50));
  console.log('');
});
