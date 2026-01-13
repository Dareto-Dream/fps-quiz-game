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

// ============================================
// P5.JS SETUP
// ============================================
function setup() {
  // Create canvas in game-screen
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('game-canvas');
  
  // Calculate UI positions
  calculateUIPositions();
  
  // Prevent default touch behaviors
  document.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  
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
}

function calculateUIPositions() {
  // Shoot button - right side, lower area
  shootButtonRadius = min(width, height) * 0.12;
  shootButtonX = width * 0.8;
  shootButtonY = height * 0.7;
  
  // Reload button - above shoot button
  reloadButtonW = shootButtonRadius * 1.5;
  reloadButtonH = shootButtonRadius * 0.6;
  reloadButtonX = shootButtonX - reloadButtonW / 2;
  reloadButtonY = shootButtonY - shootButtonRadius - reloadButtonH - 20;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  calculateUIPositions();
}

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
function touchStarted() {
  for (let t of touches) {
    handleTouchStart(t);
  }
  return false;
}

function touchMoved() {
  for (let t of touches) {
    handleTouchMove(t);
  }
  return false;
}

function touchEnded() {
  // Check which touches ended
  const activeTouchIds = touches.map(t => t.id);
  
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
}

function handleTouchStart(t) {
  const x = t.x;
  const y = t.y;
  
  // Check shoot button
  const shootDist = dist(x, y, shootButtonX, shootButtonY);
  if (shootDist < shootButtonRadius && !shootTouchId) {
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
  if (x < width * 0.5 && !joystickTouchId) {
    joystickActive = true;
    joystickTouchId = t.id;
    joystickStartX = x;
    joystickStartY = y;
    joystickX = x;
    joystickY = y;
    return;
  }
  
  // Right side for look
  if (x >= width * 0.5 && !lookTouchId && shootDist >= shootButtonRadius) {
    lookActive = true;
    lookTouchId = t.id;
    lookStartX = x;
    lookStartY = y;
    return;
  }
}

function handleTouchMove(t) {
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
// DRAW
// ============================================
function draw() {
  if (!connected) {
    // Not connected - canvas not visible
    return;
  }
  
  background(20, 20, 35);
  
  // Draw HUD
  drawHealthBar();
  drawAmmoCounter();
  drawStats();
  drawMatchTimer();
  drawJoystick();
  drawShootButton();
  drawReloadButton();
  drawNotifications();
  drawPlayerInfo();
}

function drawHealthBar() {
  // Health bar background
  fill(60, 60, 80);
  noStroke();
  rect(15, 15, 200, 25, 5);
  
  // Health bar fill
  const healthPercent = myHealth / 100;
  const healthColor = lerpColor(color(255, 50, 50), color(50, 255, 50), healthPercent);
  fill(healthColor);
  rect(15, 15, 200 * healthPercent, 25, 5);
  
  // Health text
  fill(255);
  textSize(16);
  textAlign(LEFT, CENTER);
  text(`HP: ${Math.ceil(myHealth)}`, 25, 27);
}

function drawAmmoCounter() {
  fill(255);
  textSize(24);
  textAlign(LEFT, TOP);
  text(`⚡ ${myAmmo}`, 15, 50);
  
  // Low ammo warning
  if (myAmmo <= 5 && myAmmo > 0) {
    fill(255, 200, 0);
    textSize(14);
    text('LOW AMMO', 15, 80);
  } else if (myAmmo === 0) {
    fill(255, 50, 50);
    textSize(14);
    text('NO AMMO - TAP RELOAD', 15, 80);
  }
}

function drawStats() {
  fill(255);
  textSize(20);
  textAlign(RIGHT, BOTTOM);
  text(`K/D: ${myKills}/${myDeaths}`, width - 15, height - 50);
  
  if (myStreak >= 3) {
    fill(255, 150, 0);
    text(`🔥 STREAK: ${myStreak}`, width - 15, height - 20);
  } else {
    fill(150);
    text(`Streak: ${myStreak}`, width - 15, height - 20);
  }
}

function drawMatchTimer() {
  const minutes = Math.floor(matchTime / 60);
  const seconds = Math.floor(matchTime % 60);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
  fill(matchTime <= 30 ? color(255, 50, 50) : color(255, 150, 0));
  textSize(28);
  textAlign(CENTER, TOP);
  text(timeStr, width / 2, 15);
}

function drawJoystick() {
  if (joystickActive) {
    // Joystick base
    fill(255, 255, 255, 30);
    stroke(255, 255, 255, 100);
    strokeWeight(2);
    ellipse(joystickStartX, joystickStartY, 120, 120);
    
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
    
    fill(255, 255, 255, 150);
    noStroke();
    ellipse(handleX, handleY, 50, 50);
  } else {
    // Hint text
    fill(100);
    textSize(14);
    textAlign(CENTER, CENTER);
    text('TOUCH TO MOVE', width * 0.25, height * 0.7);
  }
}

function drawShootButton() {
  // Shoot button
  if (shootActive) {
    fill(255, 80, 80);
  } else if (myAmmo > 0) {
    fill(200, 50, 50);
  } else {
    fill(80, 80, 80);
  }
  
  stroke(255, 100, 100);
  strokeWeight(3);
  ellipse(shootButtonX, shootButtonY, shootButtonRadius * 2);
  
  // Shoot text
  fill(255);
  noStroke();
  textSize(22);
  textAlign(CENTER, CENTER);
  text('FIRE', shootButtonX, shootButtonY);
}

function drawReloadButton() {
  // Reload button
  if (myAmmo < 30) {
    fill(50, 150, 50);
  } else {
    fill(50, 80, 50);
  }
  
  stroke(100, 200, 100);
  strokeWeight(2);
  rect(reloadButtonX, reloadButtonY, reloadButtonW, reloadButtonH, 8);
  
  // Reload text
  fill(255);
  noStroke();
  textSize(16);
  textAlign(CENTER, CENTER);
  text('RELOAD', reloadButtonX + reloadButtonW / 2, reloadButtonY + reloadButtonH / 2);
}

function drawNotifications() {
  // Kill notification
  if (killNotificationTimer > 0) {
    const alpha = killNotificationTimer * 255;
    fill(255, 255, 0, alpha);
    textSize(48);
    textAlign(CENTER, CENTER);
    text(killNotification, width / 2, height / 3);
    killNotificationTimer -= deltaTime / 1000;
  }
  
  // Ammo notification
  if (ammoNotificationTimer > 0) {
    const alpha = ammoNotificationTimer * 255;
    fill(0, 255, 100, alpha);
    textSize(32);
    textAlign(CENTER, CENTER);
    text(ammoNotification, width / 2, height / 2);
    ammoNotificationTimer -= deltaTime / 1000;
  }
}

function drawPlayerInfo() {
  // Player color indicator
  fill(playerColor);
  noStroke();
  ellipse(width - 30, 30, 30, 30);
  
  fill(255);
  textSize(14);
  textAlign(RIGHT, CENTER);
  text(playerColorName, width - 50, 30);
}
