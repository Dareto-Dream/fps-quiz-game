// Game configuration - Server-side only
module.exports = {
  SERVER_PORT: 3000,
  MAX_PLAYERS: 8,
  MIN_PLAYERS: 2,
  PLAYER_MAX_HEALTH: 100,
  PLAYER_MAX_AMMO: 30,
  PLAYER_START_AMMO: 15,
  WEAPON_DAMAGE: 25,
  RESPAWN_TIME: 3,
  SPAWN_PROTECTION_TIME: 2, // seconds of invincibility after spawn
  MOVE_SPEED: 8,
  LOOK_SENSITIVITY: 0.003,
  INPUT_RATE: 30,               // Hz (controller → server)
  STATE_BROADCAST_RATE: 10,     // Hz (host → server → controllers)
  MATCH_DURATION: 300,          // 5 minutes in seconds
  STREAK_THRESHOLD: 3,          // kills needed to become streak leader
  
  // Quiz ammo rewards
  QUIZ_REWARDS: {
    0: 0,   // 0/3 correct = 0 ammo
    1: 3,   // 1/3 correct = 3 ammo
    2: 5,   // 2/3 correct = 5 ammo
    3: 7    // 3/3 correct = 7 ammo
  },
  
  PLAYER_COLORS: [
    '#FF4444', // Red
    '#44FF44', // Green
    '#4444FF', // Blue
    '#FFFF44', // Yellow
    '#FF44FF', // Magenta
    '#44FFFF', // Cyan
    '#FFA500', // Orange
    '#9400D3'  // Purple
  ],
  
  COLOR_NAMES: [
    'Red', 'Green', 'Blue', 'Yellow',
    'Magenta', 'Cyan', 'Orange', 'Purple'
  ],
  
  // Arena dimensions
  ARENA: {
    WIDTH: 50,
    DEPTH: 50,
    WALL_HEIGHT: 10
  },
  
  // Spawn points around the arena
  SPAWN_POINTS: [
    { x: -20, z: -20 },
    { x: 20, z: -20 },
    { x: -20, z: 20 },
    { x: 20, z: 20 },
    { x: 0, z: -22 },
    { x: 0, z: 22 },
    { x: -22, z: 0 },
    { x: 22, z: 0 }
  ]
};
