// ============================================
// GAME STATE
// ============================================
let socket;
let connected = false;
let playerId = '';
let playerColor = '#ffffff';
let playerColorName = '';
let roomCode = '';

// Player stats
let myHealth = 100;
let myAmmo = 15;
let myKills = 0;
let myDeaths = 0;
let myStreak = 0;
let isAlive = true;
let respawnTimer = 0;
let matchTime = 300;

// Input state
let moveX = 0;
let moveY = 0;
let lookDeltaX = 0;
let lookDeltaY = 0;
let shooting = false;

// Joystick state
let joystickActive = false;
let joystickStartX = 0;
let joystickStartY = 0;
let joystickX = 0;
let joystickY = 0;
let joystickTouchId = null;

// Look state
let lookActive = false;
let lookStartX = 0;
let lookStartY = 0;
let lookTouchId = null;

// Shoot button state
let shootActive = false;
let shootTouchId = null;

// UI dimensions
let shootButtonX, shootButtonY, shootButtonRadius;
let reloadButtonX, reloadButtonY, reloadButtonW, reloadButtonH;

// Quiz state
let quizActive = false;
let quizQuestions = [];
let quizAnswers = [];

// Kill notification
let killNotification = '';
let killNotificationTimer = 0;

// Ammo notification
let ammoNotification = '';
let ammoNotificationTimer = 0;

// p5 instance (created after connection)
let p5Instance = null;

// ============================================
// WAIT FOR DOM TO LOAD
// ============================================
document.addEventListener('DOMContentLoaded', function() {
  // Auto-fill server IP from current page hostname
  const currentHost = window.location.hostname;
  if (currentHost && currentHost !== 'localhost' && currentHost !== '127.0.0.1') {
    document.getElementById('server-ip').value = currentHost;
  }
  
  // Auto-fill port from current page port
  const currentPort = window.location.port;
  if (currentPort) {
    document.getElementById('server-port').value = currentPort;
  }
  
  // Connection button
  document.getElementById('connect-btn').addEventListener('click', connectToServer);
  
  // Quiz submit button
  document.getElementById('submit-quiz-btn').addEventListener('click', submitQuiz);
  
  // Enter key on inputs
  document.querySelectorAll('#connection-screen input').forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') connectToServer();
    });
  });
});

// ============================================
// CONNECTION
// ============================================
function connectToServer() {
  const serverIP = document.getElementById('server-ip').value.trim();
  const serverPort = document.getElementById('server-port').value.trim();
  const code = document.getElementById('room-code').value.trim();
  
  if (!serverIP || !serverPort || !code) {
    showConnectionError('Please fill in all fields');
    return;
  }
  
  if (code.length !== 4) {
    showConnectionError('Room code must be 4 digits');
    return;
  }
  
  document.getElementById('connect-btn').disabled = true;
  document.getElementById('connect-btn').textContent = 'CONNECTING...';
  
  const serverUrl = `http://${serverIP}:${serverPort}`;
  
  socket = io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    timeout: 10000
  });
  
  socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('join-room', { roomCode: code });
  });
  
  socket.on('room-joined', (data) => {
    connected = true;
    playerId = data.playerId;
    playerColor = data.color;
    playerColorName = data.colorName;
    roomCode = data.roomCode;
    
    document.getElementById('connection-screen').style.display = 'none';
    document.getElementById('game-screen').style.display = 'block';
    
    // NOW initialize p5.js
    initP5();
    
    // Start sending input
    setInterval(sendInput, 33); // 30Hz
  });
  
  socket.on('join-error', (data) => {
    showConnectionError(data.message);
    document.getElementById('connect-btn').disabled = false;
    document.getElementById('connect-btn').textContent = 'CONNECT';
  });
  
  socket.on('connect_error', (error) => {
    showConnectionError('Connection failed. Check IP and port.');
    document.getElementById('connect-btn').disabled = false;
    document.getElementById('connect-btn').textContent = 'CONNECT';
  });
  
  socket.on('game-state', handleGameState);
  socket.on('kill-event', handleKillEvent);
  socket.on('player-died', handlePlayerDied);
  socket.on('player-respawned', handlePlayerRespawned);
  socket.on('quiz-questions', handleQuizQuestions);
  socket.on('ammo-updated', handleAmmoUpdated);
  socket.on('match-timer', handleMatchTimer);
  socket.on('match-end', handleMatchEnd);
  socket.on('host-disconnected', handleHostDisconnected);
  
  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });
}

function showConnectionError(message) {
  document.getElementById('connection-error').textContent = message;
}

// ============================================
// INITIALIZE P5.JS (after connection)
// ============================================
function initP5() {
  p5Instance = new p5(function(p) {
    
    p.setup = function() {
      const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
      canvas.parent('game-canvas');
      calculateUIPositions(p);
    };
    
    p.windowResized = function() {
      p.resizeCanvas(p.windowWidth, p.windowHeight);
      calculateUIPositions(p);
    };
    
    p.draw = function() {
      if (!connected) return;
      
      p.background(20, 20, 35);
      
      // Draw HUD
      drawHealthBar(p);
      drawAmmoCounter(p);
      drawStats(p);
      drawMatchTimer(p);
      drawJoystick(p);
      drawShootButton(p);
      drawReloadButton(p);
      drawNotifications(p);
      drawPlayerInfo(p);
    };
    
    p.touchStarted = function(event) {
      // Only handle touches on the canvas
      if (event.target.tagName === 'CANVAS') {
        for (let t of p.touches) {
          handleTouchStart(t, p);
        }
        return false;
      }
      return true;
    };
    
    p.touchMoved = function(event) {
      if (event.target.tagName === 'CANVAS') {
        for (let t of p.touches) {
          handleTouchMove(t, p);
        }
        return false;
      }
      return true;
    };
    
    p.touchEnded = function(event) {
      // Check which touches ended
      const activeTouchIds = p.touches.map(t => t.id);
      
      if (joystickTouchId !== null && !activeTouchIds.includes(joystickTouchId)) {
        joystickActive = false;
        joystickTouchId = null;
        moveX = 0;
        moveY = 0;
      }
      
      if (lookTouchId !== null && !activeTouchIds.includes(lookTouchId)) {
        lookActive = false;
        lookTouchId = null;
      }
      
      if (shootTouchId !== null && !activeTouchIds.includes(shootTouchId)) {
        shootActive = false;
        shootTouchId = null;
        shooting = false;
      }
      
      return false;
    };
    
  }, 'game-canvas');
}

function calculateUIPositions(p) {
  // Shoot button - right side, lower area
  shootButtonRadius = Math.min(p.width, p.height) * 0.12;
  shootButtonX = p.width * 0.8;
  shootButtonY = p.height * 0.7;
  
  // Reload button - above shoot button
  reloadButtonW = shootButtonRadius * 1.5;
  reloadButtonH = shootButtonRadius * 0.6;
  reloadButtonX = shootButtonX - reloadButtonW / 2;
  reloadButtonY = shootButtonY - shootButtonRadius - reloadButtonH - 20;
}

// ============================================
// SOCKET HANDLERS
// ============================================
function handleGameState(data) {
  if (data.players && data.players[playerId]) {
    const myData = data.players[playerId];
    myHealth = myData.health;
    myAmmo = myData.ammo;
    myKills = myData.kills;
    myDeaths = myData.deaths;
    myStreak = myData.streak;
    isAlive = myData.alive;
  }
  if (data.matchTime !== undefined) {
    matchTime = data.matchTime;
  }
}

function handleKillEvent(data) {
  if (data.killerId === playerId) {
    // I got a kill!
    killNotification = 'KILL!';
    killNotificationTimer = 2;
    
    // Vibrate if supported
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  }
}

function handlePlayerDied(data) {
  if (data.playerId === playerId) {
    isAlive = false;
    respawnTimer = data.respawnTime;
    
    // Show death screen
    document.getElementById('killer-name').textContent = data.killerId.substring(0, 8);
    document.getElementById('death-screen').style.display = 'flex';
    
    // Countdown
    const countdown = setInterval(() => {
      respawnTimer--;
      document.getElementById('respawn-countdown').textContent = Math.max(0, Math.ceil(respawnTimer));
      if (respawnTimer <= 0) {
        clearInterval(countdown);
      }
    }, 1000);
    
    // Vibrate
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 200]);
    }
  }
}

function handlePlayerRespawned(data) {
  if (data.playerId === playerId) {
    isAlive = true;
    myHealth = data.health;
    myAmmo = data.ammo;
    document.getElementById('death-screen').style.display = 'none';
  }
}

function handleQuizQuestions(data) {
  quizQuestions = data.questions;
  quizAnswers = new Array(quizQuestions.length).fill(-1);
  quizActive = true;
  renderQuiz();
  document.getElementById('quiz-modal').style.display = 'block';
}

function handleAmmoUpdated(data) {
  myAmmo = data.ammo;
  ammoNotification = `+${data.ammoGained} AMMO`;
  ammoNotificationTimer = 2;
}

function handleMatchTimer(data) {
  matchTime = data.timeRemaining;
}

function handleMatchEnd(data) {
  document.getElementById('match-end').style.display = 'flex';
  
  if (data.winner) {
    document.getElementById('winner-info').innerHTML = 
      `🏆 Winner: <strong style="color: ${data.winner.id === playerId ? playerColor : 'white'}">${data.winner.colorName}</strong> with ${data.winner.kills} kills`;
  } else {
    document.getElementById('winner-info').textContent = 'No winner';
  }
  
  document.getElementById('your-final-stats').textContent = 
    `Your Stats: ${myKills} kills, ${myDeaths} deaths`;
}

function handleHostDisconnected() {
  alert('Host disconnected. The game has ended.');
  location.reload();
}

// ============================================
// QUIZ SYSTEM
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
  
  // Update UI
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`quiz-opt-${questionIndex}-${i}`);
    if (btn) {
      btn.classList.toggle('selected', i === optionIndex);
    }
  }
  
  // Enable submit if all answered
  const allAnswered = quizAnswers.every(a => a !== -1);
  document.getElementById('submit-quiz-btn').disabled = !allAnswered;
}

function submitQuiz() {
  if (!quizActive) return;
  
  // Calculate correct answers
  let correctCount = 0;
  quizQuestions.forEach((q, i) => {
    if (quizAnswers[i] === q.correct) {
      correctCount++;
    }
  });
  
  // Send to server
  socket.emit('submit-quiz', {
    answers: quizAnswers,
    correctCount: correctCount
  });
  
  // Close quiz
  quizActive = false;
  document.getElementById('quiz-modal').style.display = 'none';
}

function requestQuiz() {
  if (socket && connected && !quizActive) {
    socket.emit('request-quiz');
  }
}

// ============================================
// INPUT HANDLING
// ============================================
function handleTouchStart(t, p) {
  const x = t.x;
  const y = t.y;
  
  // Check shoot button
  const shootDist = p.dist(x, y, shootButtonX, shootButtonY);
  if (shootDist < shootButtonRadius && shootTouchId === null) {
    shootActive = true;
    shootTouchId = t.id;
    shooting = true;
    return;
  }
  
  // Check reload button
  if (x > reloadButtonX && x < reloadButtonX + reloadButtonW &&
      y > reloadButtonY && y < reloadButtonY + reloadButtonH) {
    requestQuiz();
    return;
  }
  
  // Check left side for joystick (floating)
  if (x < p.width * 0.5 && joystickTouchId === null) {
    joystickActive = true;
    joystickTouchId = t.id;
    joystickStartX = x;
    joystickStartY = y;
    joystickX = x;
    joystickY = y;
    return;
  }
  
  // Right side for look
  if (x >= p.width * 0.5 && lookTouchId === null && shootDist >= shootButtonRadius) {
    lookActive = true;
    lookTouchId = t.id;
    lookStartX = x;
    lookStartY = y;
    return;
  }
}

function handleTouchMove(t, p) {
  // Joystick movement
  if (t.id === joystickTouchId && joystickActive) {
    joystickX = t.x;
    joystickY = t.y;
    
    // Calculate normalized direction
    const maxDist = 60;
    const dx = joystickX - joystickStartX;
    const dy = joystickY - joystickStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > 0) {
      const clampedDist = Math.min(dist, maxDist);
      moveX = (dx / dist) * (clampedDist / maxDist);
      moveY = (dy / dist) * (clampedDist / maxDist);
    }
  }
  
  // Look movement
  if (t.id === lookTouchId && lookActive) {
    const dx = t.x - lookStartX;
    const dy = t.y - lookStartY;
    
    lookDeltaX = dx * 0.01;
    lookDeltaY = dy * 0.01;
    
    // Reset start position for continuous rotation
    lookStartX = t.x;
    lookStartY = t.y;
  }
}

// ============================================
// SEND INPUT TO SERVER
// ============================================
function sendInput() {
  if (!socket || !connected) return;
  
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
  
  // Reset look deltas (they're deltas, not absolute)
  lookDeltaX = 0;
  lookDeltaY = 0;
}

// ============================================
// DRAW FUNCTIONS
// ============================================
function drawHealthBar(p) {
  // Health bar background
  p.fill(60, 60, 80);
  p.noStroke();
  p.rect(15, 15, 200, 25, 5);
  
  // Health bar fill
  const healthPercent = myHealth / 100;
  const healthColor = p.lerpColor(p.color(255, 50, 50), p.color(50, 255, 50), healthPercent);
  p.fill(healthColor);
  p.rect(15, 15, 200 * healthPercent, 25, 5);
  
  // Health text
  p.fill(255);
  p.textSize(16);
  p.textAlign(p.LEFT, p.CENTER);
  p.text(`HP: ${Math.ceil(myHealth)}`, 25, 27);
}

function drawAmmoCounter(p) {
  p.fill(255);
  p.textSize(24);
  p.textAlign(p.LEFT, p.TOP);
  p.text(`⚡ ${myAmmo}`, 15, 50);
  
  // Low ammo warning
  if (myAmmo <= 5 && myAmmo > 0) {
    p.fill(255, 200, 0);
    p.textSize(14);
    p.text('LOW AMMO', 15, 80);
  } else if (myAmmo === 0) {
    p.fill(255, 50, 50);
    p.textSize(14);
    p.text('NO AMMO - TAP RELOAD', 15, 80);
  }
}

function drawStats(p) {
  p.fill(255);
  p.textSize(20);
  p.textAlign(p.RIGHT, p.BOTTOM);
  p.text(`K/D: ${myKills}/${myDeaths}`, p.width - 15, p.height - 50);
  
  if (myStreak >= 3) {
    p.fill(255, 150, 0);
    p.text(`🔥 STREAK: ${myStreak}`, p.width - 15, p.height - 20);
  } else {
    p.fill(150);
    p.text(`Streak: ${myStreak}`, p.width - 15, p.height - 20);
  }
}

function drawMatchTimer(p) {
  const minutes = Math.floor(matchTime / 60);
  const seconds = Math.floor(matchTime % 60);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
  p.fill(matchTime <= 30 ? p.color(255, 50, 50) : p.color(255, 150, 0));
  p.textSize(28);
  p.textAlign(p.CENTER, p.TOP);
  p.text(timeStr, p.width / 2, 15);
}

function drawJoystick(p) {
  if (joystickActive) {
    // Joystick base
    p.fill(255, 255, 255, 30);
    p.stroke(255, 255, 255, 100);
    p.strokeWeight(2);
    p.ellipse(joystickStartX, joystickStartY, 120, 120);
    
    // Joystick handle
    const maxDist = 60;
    let handleX = joystickX;
    let handleY = joystickY;
    
    const dx = handleX - joystickStartX;
    const dy = handleY - joystickStartY;
    const d = Math.sqrt(dx * dx + dy * dy);
    
    if (d > maxDist) {
      handleX = joystickStartX + (dx / d) * maxDist;
      handleY = joystickStartY + (dy / d) * maxDist;
    }
    
    p.fill(255, 255, 255, 150);
    p.noStroke();
    p.ellipse(handleX, handleY, 50, 50);
  } else {
    // Hint text
    p.fill(100);
    p.textSize(14);
    p.textAlign(p.CENTER, p.CENTER);
    p.noStroke();
    p.text('TOUCH TO MOVE', p.width * 0.25, p.height * 0.7);
  }
}

function drawShootButton(p) {
  // Shoot button
  if (shootActive) {
    p.fill(255, 80, 80);
  } else if (myAmmo > 0) {
    p.fill(200, 50, 50);
  } else {
    p.fill(80, 80, 80);
  }
  
  p.stroke(255, 100, 100);
  p.strokeWeight(3);
  p.ellipse(shootButtonX, shootButtonY, shootButtonRadius * 2);
  
  // Shoot text
  p.fill(255);
  p.noStroke();
  p.textSize(22);
  p.textAlign(p.CENTER, p.CENTER);
  p.text('FIRE', shootButtonX, shootButtonY);
}

function drawReloadButton(p) {
  // Reload button
  if (myAmmo < 30) {
    p.fill(50, 150, 50);
  } else {
    p.fill(50, 80, 50);
  }
  
  p.stroke(100, 200, 100);
  p.strokeWeight(2);
  p.rect(reloadButtonX, reloadButtonY, reloadButtonW, reloadButtonH, 8);
  
  // Reload text
  p.fill(255);
  p.noStroke();
  p.textSize(16);
  p.textAlign(p.CENTER, p.CENTER);
  p.text('RELOAD', reloadButtonX + reloadButtonW / 2, reloadButtonY + reloadButtonH / 2);
}

function drawNotifications(p) {
  // Kill notification
  if (killNotificationTimer > 0) {
    const alpha = killNotificationTimer * 127;
    p.fill(255, 255, 0, alpha);
    p.textSize(48);
    p.textAlign(p.CENTER, p.CENTER);
    p.noStroke();
    p.text(killNotification, p.width / 2, p.height / 3);
    killNotificationTimer -= p.deltaTime / 1000;
  }
  
  // Ammo notification
  if (ammoNotificationTimer > 0) {
    const alpha = ammoNotificationTimer * 127;
    p.fill(0, 255, 100, alpha);
    p.textSize(32);
    p.textAlign(p.CENTER, p.CENTER);
    p.noStroke();
    p.text(ammoNotification, p.width / 2, p.height / 2);
    ammoNotificationTimer -= p.deltaTime / 1000;
  }
}

function drawPlayerInfo(p) {
  // Player color indicator
  p.fill(playerColor);
  p.noStroke();
  p.ellipse(p.width - 30, 30, 30, 30);
  
  p.fill(255);
  p.textSize(14);
  p.textAlign(p.RIGHT, p.CENTER);
  p.text(playerColorName, p.width - 50, 30);
}
