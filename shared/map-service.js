const fs = require('fs');
const path = require('path');

const MAPS_DIR = path.join(__dirname, 'maps');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readMaps() {
  const files = fs
    .readdirSync(MAPS_DIR)
    .filter(file => file.toLowerCase().endsWith('.json'))
    .sort();

  const maps = files.map(file => {
    const fullPath = path.join(MAPS_DIR, file);
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return validateMap(parsed, file);
  });

  if (maps.length === 0) {
    throw new Error(`No maps found in ${MAPS_DIR}`);
  }

  const ids = new Set();
  maps.forEach(map => {
    if (ids.has(map.id)) {
      throw new Error(`Duplicate map id: ${map.id}`);
    }
    ids.add(map.id);
  });

  return maps;
}

function validateMap(map, sourceName) {
  if (!map || typeof map !== 'object') {
    throw new Error(`${sourceName} must contain a map object`);
  }

  const id = validateId(map.id, sourceName);
  const name = typeof map.name === 'string' && map.name.trim() ? map.name.trim() : id;
  const arena = validateArena(map.arena, sourceName);
  const lighting = validateLighting(map.lighting, sourceName);
  const spawns = validateSpawns(map.spawns, arena, sourceName);
  const obstacles = validateObstacles(map.obstacles || [], sourceName);

  return {
    ...map,
    id,
    name,
    arena,
    lighting,
    spawns,
    obstacles
  };
}

function validateId(id, sourceName) {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`${sourceName} has invalid map id`);
  }
  return id;
}

function validateArena(arena, sourceName) {
  if (!arena || typeof arena !== 'object') {
    throw new Error(`${sourceName} is missing arena`);
  }

  const width = positiveNumber(arena.width, `${sourceName} arena.width`);
  const depth = positiveNumber(arena.depth, `${sourceName} arena.depth`);
  const wallHeight = positiveNumber(arena.wallHeight, `${sourceName} arena.wallHeight`);

  return { width, depth, wallHeight };
}

function validateLighting(lighting, sourceName) {
  if (lighting === undefined) return {};
  if (!lighting || typeof lighting !== 'object' || Array.isArray(lighting)) {
    throw new Error(`${sourceName} lighting must be an object`);
  }

  const next = { ...lighting };
  if (next.timeOfDay !== undefined) {
    if (typeof next.timeOfDay !== 'string' || !next.timeOfDay.trim()) {
      throw new Error(`${sourceName} lighting.timeOfDay must be a non-empty string`);
    }
    next.timeOfDay = next.timeOfDay.trim().toLowerCase();
  }

  return next;
}

function validateSpawns(spawns, arena, sourceName) {
  if (!Array.isArray(spawns) || spawns.length === 0) {
    throw new Error(`${sourceName} needs at least one spawn`);
  }

  const halfWidth = arena.width / 2;
  const halfDepth = arena.depth / 2;

  return spawns.map((spawn, index) => {
    const x = finiteNumber(spawn && spawn.x, `${sourceName} spawn ${index}.x`);
    const z = finiteNumber(spawn && spawn.z, `${sourceName} spawn ${index}.z`);
    if (Math.abs(x) >= halfWidth || Math.abs(z) >= halfDepth) {
      throw new Error(`${sourceName} spawn ${index} is outside the arena`);
    }

    return {
      x,
      z,
      yaw: finiteNumber(spawn.yaw || 0, `${sourceName} spawn ${index}.yaw`)
    };
  });
}

function validateObstacles(obstacles, sourceName) {
  if (!Array.isArray(obstacles)) {
    throw new Error(`${sourceName} obstacles must be an array`);
  }

  return obstacles.map((obstacle, index) => {
    if (!obstacle || obstacle.type !== 'box') {
      throw new Error(`${sourceName} obstacle ${index} must be a box`);
    }

    return {
      ...obstacle,
      id: typeof obstacle.id === 'string' && obstacle.id.trim() ? obstacle.id.trim() : `obstacle-${index}`,
      type: 'box',
      x: finiteNumber(obstacle.x, `${sourceName} obstacle ${index}.x`),
      z: finiteNumber(obstacle.z, `${sourceName} obstacle ${index}.z`),
      width: positiveNumber(obstacle.width, `${sourceName} obstacle ${index}.width`),
      depth: positiveNumber(obstacle.depth, `${sourceName} obstacle ${index}.depth`),
      height: positiveNumber(obstacle.height, `${sourceName} obstacle ${index}.height`),
      yaw: finiteNumber(obstacle.yaw || 0, `${sourceName} obstacle ${index}.yaw`),
      collides: obstacle.collides !== false,
      blocksShots: obstacle.blocksShots !== false
    };
  });
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number`);
  }
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) {
    throw new Error(`${label} must be greater than 0`);
  }
  return number;
}

function toLegacyArena(arena) {
  return {
    WIDTH: arena.width,
    DEPTH: arena.depth,
    WALL_HEIGHT: arena.wallHeight
  };
}

const maps = readMaps();
const DEFAULT_MAP_ID = maps.some(map => map.id === 'classic') ? 'classic' : maps[0].id;

function getMaps() {
  return clone(maps);
}

function getMapManifest() {
  return maps.map(map => ({
    id: map.id,
    name: map.name,
    description: map.description || ''
  }));
}

function getMapById(mapId) {
  const map = maps.find(candidate => candidate.id === mapId);
  return clone(map || maps.find(candidate => candidate.id === DEFAULT_MAP_ID) || maps[0]);
}

function getDefaultMap() {
  return getMapById(DEFAULT_MAP_ID);
}

function sanitizeMapId(mapId, fallback = DEFAULT_MAP_ID) {
  const requested = typeof mapId === 'string' ? mapId : '';
  if (maps.some(map => map.id === requested)) return requested;
  if (maps.some(map => map.id === fallback)) return fallback;
  return DEFAULT_MAP_ID;
}

module.exports = {
  DEFAULT_MAP_ID,
  getDefaultMap,
  getMapById,
  getMapManifest,
  getMaps,
  sanitizeMapId,
  toLegacyArena
};
