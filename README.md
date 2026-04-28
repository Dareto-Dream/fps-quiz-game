# Arena FPS - Browser-Based Quiz Shooter

A LAN party game where one desktop or laptop runs the host display and phones join as mobile controllers. Players fight in a Three.js arena and answer quiz questions to earn reload ammo.

## Features

- Host display with 3D arena rendering, leaderboard, kill feed, lobby settings, and match results
- Mobile controller with movement/look touch zones, firing, reload quiz, HUD, and first-person arena view
- Quiz-for-ammo reload flow with per-question and per-player accuracy reporting
- Configurable lobby size, minimum players, match duration, and map
- Multiple validated JSON maps with shared host/controller rendering
- Short controller reconnect grace period so a phone refresh can reclaim its slot
- Local browser dependencies served from `node_modules` instead of external CDNs

## Quick Start

```bash
npm install
npm start
```

The server prints local and network URLs. Open the host display on the desktop:

```text
http://localhost:3000/host
```

Phones should open the controller URL shown by the host lobby QR/link, or:

```text
http://<HOST_IP>:3000/controller
```

## Configuration

Environment variables:

- `PORT`: server port. Defaults to `3000`.
- `PUBLIC_BASE_URL`: public origin used for generated controller links, for example `https://example.com`. If omitted, the server derives it from the incoming request.
- `ALLOWED_ORIGINS`: comma-separated list of allowed browser origins for HTTP/Socket.IO CORS. If omitted, all origins are accepted for easier LAN play.

Examples:

```bash
PORT=3001 npm start
PUBLIC_BASE_URL=https://game.example.com ALLOWED_ORIGINS=https://game.example.com npm start
```

PowerShell:

```powershell
$env:PORT = "3001"; npm start
```

## Controls

| Control | Action |
| --- | --- |
| Left touch zone | Move |
| Right touch zone | Look |
| FIRE | Shoot |
| RLD | Request reload quiz |

## Game Rules

- Health: 100 HP
- Damage: 25 per body hit, 50 per headshot
- Starting ammo: 15 rounds
- Reload quiz rewards: 1/3 = 3 rounds, 2/3 = 5 rounds, 3/3 = 7 rounds
- Respawn: 3 seconds after death
- Spawn protection: 2 seconds
- Default match duration: 5 minutes
- Streak leader: 3+ kills without dying

## Project Structure

```text
fps-quiz-game/
├── server.js                  # Express + Socket.IO server
├── package.json               # Scripts and dependencies
├── host/
│   ├── index.html             # Host display markup
│   ├── game.js                # Host game simulation and rendering
│   └── styles.css             # Host styling
├── controller/
│   ├── index.html             # Mobile controller markup
│   ├── sketch.js              # Controller input, HUD, and rendering
│   └── styles.css             # Controller styling
├── shared/
│   ├── config.js              # Server-side gameplay defaults
│   ├── questions.js           # Quiz content
│   ├── movement.mjs           # Shared movement/collision helpers
│   ├── map-service.js         # Map loading and validation
│   ├── map-renderer.mjs       # Shared map scene renderer
│   ├── player-utils.js        # Shared player-name sanitizer
│   ├── shot-visuals.mjs       # Shared projectile visual helpers
│   ├── maps/*.json            # Authored maps
│   └── audio/*.ogg            # Music/audio assets
├── strudel/*.strudel          # Source music patterns
├── test/*.js                  # Socket, browser, movement, and content tests
└── STANDARDS.md               # Authoring standards for maps and questions
```

## Tests

```bash
npm test
```

The test suite runs serially because it starts real local servers and a browser smoke test. Coverage includes:

- Socket room flow, quiz validation, and host event forwarding
- Movement and map collision helpers
- Browser smoke test for host/controller startup
- Question, map, and shared sanitizer content validation

## Content Editing

Quiz questions live in `shared/questions.js`. Maps live in `shared/maps/*.json`. Follow `STANDARDS.md` when editing either surface.

After content changes:

```bash
npm test
```

## Network Notes

- All devices must be able to reach the host server.
- On a LAN, use the network URL printed by the server.
- On a deployed host, set `PUBLIC_BASE_URL` so generated QR links point at the correct public origin.
- If CORS is locked down with `ALLOWED_ORIGINS`, include the exact origin users will open in the browser.
