# Content Standards

This project has two author-edited content surfaces:

- quiz questions in `shared/questions.js`
- map definitions in `shared/maps/*.json`

Keep content small, explicit, and compatible with the current server and renderer. If the schema changes, update this document in the same change.

## Quiz Questions

Questions are exported from `shared/questions.js` as a CommonJS array:

```js
module.exports = [
  {
    question: "El chico alt?",
    options: ["alta", "alto", "altos", "altas"],
    correct: 1
  }
];
```

Each question object must have:

- `question`: a non-empty string shown on the controller.
- `options`: exactly four answer strings.
- `correct`: the zero-based index of the correct option, from `0` to `3`.

Question authoring rules:

- Keep prompts short enough for a phone screen. A single sentence or phrase is preferred.
- There must be exactly one correct answer.
- Do not duplicate answer options within one question.
- Make wrong options plausible, but clearly wrong for the intended skill.
- Keep `correct` aligned with the options after every reorder.
- Save the file as UTF-8. Spanish accents and other language-specific characters are allowed when needed.
- Maintain at least three valid questions because every reload quiz requests three questions.
- Prefer adding enough variety that repeated reloads do not immediately show the same set.
- Current question content is Spanish adjective agreement. If the quiz topic changes, update this standard and any visible copy that assumes grammar questions.

Runtime expectations:

- The server randomly chooses three questions for a reload quiz.
- The server stores `correct` internally, but only sends `id`, `question`, and `options` to controllers.
- Submitted answers are accepted only when `selectedOption` is an integer from `0` to `3`.

## Maps

Maps are JSON files in `shared/maps/`. Every `*.json` file in that directory is loaded at server startup and validated by `shared/map-service.js`.

Use this shape:

```json
{
  "id": "classic",
  "name": "Classic Arena",
  "description": "Short lobby description.",
  "arena": {
    "width": 50,
    "depth": 50,
    "wallHeight": 10
  },
  "style": {
    "floorColor": "#38443d",
    "wallColor": "#5e665d",
    "obstacleColor": "#796a4f",
    "accentColor": "#26d8d8",
    "gridColor": "#ffd166",
    "gridSecondaryColor": "#607069"
  },
  "lighting": {
    "timeOfDay": "midday"
  },
  "spawns": [
    { "x": -20, "z": -20, "yaw": 0.75 }
  ],
  "obstacles": [
    {
      "id": "center-pillar",
      "type": "box",
      "x": 0,
      "z": 0,
      "width": 4,
      "depth": 4,
      "height": 6,
      "collides": true,
      "blocksShots": true
    }
  ]
}
```

### Map Identity

- `id` is required and must use lowercase letters, numbers, and hyphens only: `^[a-z0-9-]+$`.
- Every map `id` must be unique.
- The filename should match the id, for example `depot.json` for `"id": "depot"`.
- `name` is the host lobby display name. If omitted or blank, the id is used.
- `description` is optional, but should be one concise sentence for the lobby manifest.

### Arena

`arena` is required:

- `width`: positive number for the x-axis size.
- `depth`: positive number for the z-axis size.
- `wallHeight`: positive number for generated wall height.

Coordinate conventions:

- The arena origin is the center of the floor at `{ "x": 0, "z": 0 }`.
- Valid play space is inside `-width / 2 < x < width / 2` and `-depth / 2 < z < depth / 2`.
- `x` moves across arena width. `z` moves across arena depth.
- `yaw` values are radians. A yaw of `0` faces toward negative `z`.

### Style

`style` is optional. The renderer currently reads:

- `floorColor`
- `wallColor`
- `obstacleColor`
- `accentColor`
- `gridColor`
- `gridSecondaryColor`

Use CSS-style hex colors such as `#26d8d8`. Invalid or missing colors fall back to renderer defaults.

### Lighting

`lighting` is optional. It controls scene atmosphere and map-owned lights for both host and controller views.

- `timeOfDay`: optional preset name. Supported presets are `morning`, `midday`, `evening`, and `night`. If omitted or unknown, the renderer uses `midday`.
- `skyColor`, `fogColor`, `ambientColor`, `hemisphereSkyColor`, `hemisphereGroundColor`, `sunColor`, `fillColor`: optional CSS-style hex colors.
- `fog`: optional boolean. Set to `false` to disable fog for the map.
- `fogNear`, `fogFar`, `toneMappingExposure`: optional positive numbers.
- `ambientIntensity`, `hemisphereIntensity`, `sunIntensity`, `fillIntensity`, `arenaLightIntensity`, `arenaLightDistance`: optional non-negative numbers.
- `sunPosition` and `fillPosition`: optional objects with finite `x`, `y`, and `z` numbers.
- `arenaLightColors`: optional array of CSS-style hex colors used by generated corner accent lights.

Prefer setting `timeOfDay` first and only overriding individual values when a map needs a distinct mood or readability adjustment.

### Spawns

`spawns` is required and must contain at least one spawn:

- `x`: finite number inside the arena.
- `z`: finite number inside the arena.
- `yaw`: finite number in radians. If omitted, it defaults to `0`.

Spawn authoring rules:

- Provide at least as many spawn points as the lobby player cap. The current cap is eight players because there are eight configured player colors.
- Place spawns away from walls and collidable obstacles. Use at least the player radius margin, currently about `0.45` units, plus extra breathing room.
- Do not place spawns inside boxes. The loader checks arena bounds, but it does not reject spawns that overlap obstacles.
- Prefer varied spawn directions so players enter the match facing useful sightlines instead of walls.

### Obstacles

`obstacles` is optional and defaults to an empty array. The current renderer and movement system only support box obstacles:

- `id`: optional non-empty string. If omitted, the loader assigns `obstacle-{index}`.
- `type`: required, must be `"box"`.
- `x`: finite number for the obstacle center.
- `z`: finite number for the obstacle center.
- `width`: positive number along the obstacle local x-axis.
- `depth`: positive number along the obstacle local z-axis.
- `height`: positive number on the vertical y-axis.
- `yaw`: optional finite number in radians. If omitted, it defaults to `0`.
- `collides`: optional boolean. Defaults to `true`; set to `false` for decorative pass-through geometry.
- `blocksShots`: optional boolean. Defaults to `true`; set to `false` when bullets should pass through.
- `color`: optional per-obstacle color accepted by Three.js, preferably a hex color.

Obstacle authoring rules:

- Keep obstacles inside the arena unless intentionally creating edge cover. The loader validates dimensions, but it does not reject boxes that extend beyond walls.
- Leave navigable lanes wide enough for players. Player collision uses a radius of about `0.45` units.
- Avoid tiny gaps that look passable but are blocked by player radius.
- Remember that `collides` and `blocksShots` are independent. A wall can block movement without blocking shots, and a visual object can be non-colliding.
- Use `yaw` for rotated boxes instead of approximating diagonals with many small boxes.

## Validation

Run these checks after changing questions or maps:

```bash
npm test
```

For a quick content load check without running the full suite:

```bash
node -e "require('./shared/questions'); require('./shared/map-service'); console.log('content ok')"
```

When adding a new map, also start the server and open the host view to inspect sightlines, collisions, spawn placement, and shot blockers in-game.
