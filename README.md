# Arena FPS - Browser-Based 3D Multiplayer FPS

A LAN party game where one desktop/laptop displays all players as a spectator view, and mobile phones act as individual controllers.

## Features

- **Host Display**: 3D arena rendered with Three.js showing all connected players
- **Mobile Controllers**: Touch-based controls with virtual joystick and fire button
- **Quiz-for-Ammo**: Run out of ammo? Answer trivia questions to reload!
- **Kill Streaks**: Get 3+ kills without dying to become the streak leader
- **Dynamic Camera**: Camera automatically follows the streak leader
- **5-Minute Matches**: Time-limited rounds with winner announcement

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Server

```bash
npm start
```

The server will display:
- Local URL: `http://localhost:3000`
- Network URL: `http://[YOUR_IP]:3000`

### 3. Open Host Display

On your desktop/laptop browser, go to:
```
http://localhost:3000/host
```

You'll see the IP address and Room Code displayed on screen.

### 4. Connect Controllers (Mobile Phones)

On each mobile phone browser, go to:
```
http://[HOST_IP]:3000/controller
```

Enter:
- **Server IP**: The IP address shown on the host screen
- **Port**: 3000
- **Room Code**: The 4-digit code shown on the host screen

## Controls (Mobile)

| Control | Action |
|---------|--------|
| Left side touch & drag | Move (floating joystick) |
| Right side touch & drag | Look around |
| FIRE button | Shoot |
| RELOAD button | Open quiz to get ammo |

## Game Rules

- **Health**: 100 HP - Each hit does 25 damage (50 for headshots)
- **Starting Ammo**: 15 rounds
- **Ammo Reload**: Answer a 3-question quiz
  - 1/3 correct = 3 rounds
  - 2/3 correct = 5 rounds
  - 3/3 correct = 7 rounds
- **Respawn**: 3 seconds after death
- **Spawn Protection**: 2 seconds of invincibility after spawning
- **Match Duration**: 5 minutes
- **Streak Leader**: 3+ kills without dying - camera follows you!

## Architecture

```
Host (Desktop)                    Server                    Controller (Mobile)
    |                               |                              |
    |----create-room--------------->|                              |
    |<---room-created---------------|                              |
    |                               |<-------join-room-------------|
    |<---player-connected-----------|-------room-joined----------->|
    |                               |                              |
    |<---player-input---------------|<------player-input-----------|
    |    (process game logic)       |    (forward)                 |
    |----game-state---------------->|-------game-state------------>|
    |----kill-event---------------->|-------kill-event------------>|
```

## File Structure

```
fps-game/
├── server.js              # Node.js + Socket.IO server
├── package.json           # Dependencies
├── host/
│   ├── index.html         # Host page with UI overlays
│   ├── game.js            # Three.js game (ES modules)
│   └── styles.css         # Host styling
├── controller/
│   ├── index.html         # Controller page
│   └── sketch.js          # p5.js touch controls
└── shared/
    ├── config.js          # Game configuration
    └── questions.js       # Quiz questions
```

## Browser Support

- **Host**: Chrome, Firefox, Safari, Edge (modern versions)
- **Controller**: iOS Safari, Chrome for Android

## Network Requirements

- All devices must be on the same local network (WiFi)
- Port 3000 must be accessible
- If firewall issues occur, allow Node.js through your firewall

## Troubleshooting

**Can't connect from mobile:**
- Ensure mobile device is on same WiFi network
- Check that the IP address is correct
- Try disabling firewall temporarily

**Lag or stuttering:**
- Reduce number of players
- Close other browser tabs
- Ensure good WiFi signal

**Quiz not appearing:**
- Tap the RELOAD button when you have less than 30 ammo

## License

MIT
