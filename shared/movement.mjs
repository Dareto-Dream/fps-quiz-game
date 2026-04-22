export function clampFiniteNumber(value, min, max, fallback = 0) {
  const numeric = Number(value);
  const target = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(min, Math.min(max, target));
}

export function sanitizePlayerInput(input = {}) {
  return {
    moveX: clampFiniteNumber(input.moveX, -1, 1, 0),
    moveY: clampFiniteNumber(input.moveY, -1, 1, 0),
    lookDeltaX: clampFiniteNumber(input.lookDeltaX, -1, 1, 0),
    lookDeltaY: clampFiniteNumber(input.lookDeltaY, -1, 1, 0),
    shoot: Boolean(input.shoot),
    jump: Boolean(input.jump),
    timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : Date.now()
  };
}

export function normalizeAngleRadians(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.atan2(Math.sin(numeric), Math.cos(numeric));
}

export function calculateLookRotation({
  rotationX = 0,
  rotationY = 0,
  lookDeltaX = 0,
  lookDeltaY = 0,
  sensitivity = 0.003,
  turnRate = 30,
  deltaTime = 0,
  maxPitch = Math.PI / 3
}) {
  const safeSensitivity = Math.max(0, Number(sensitivity) || 0);
  const safeTurnRate = Math.max(0, Number(turnRate) || 0);
  const safeDeltaTime = Math.max(0, Number(deltaTime) || 0);
  const safeMaxPitch = Math.max(0, Number(maxPitch) || 0);
  const scale = safeSensitivity * safeTurnRate * 100 * safeDeltaTime;

  return {
    x: clampFiniteNumber(rotationX - clampFiniteNumber(lookDeltaY, -1, 1, 0) * scale, -safeMaxPitch, safeMaxPitch, 0),
    y: normalizeAngleRadians(rotationY - clampFiniteNumber(lookDeltaX, -1, 1, 0) * scale)
  };
}

export function calculateMovementDelta({ rotationY = 0, moveX = 0, moveY = 0, speed = 0, deltaTime = 0 }) {
  const safeMoveX = clampFiniteNumber(moveX, -1, 1, 0);
  const safeMoveY = clampFiniteNumber(moveY, -1, 1, 0);
  const safeSpeed = Math.max(0, Number(speed) || 0);
  const safeDeltaTime = Math.max(0, Number(deltaTime) || 0);

  if (Math.abs(safeMoveX) <= 0.001 && Math.abs(safeMoveY) <= 0.001) {
    return { x: 0, z: 0 };
  }

  const forwardX = Math.sin(rotationY);
  const forwardZ = Math.cos(rotationY);
  const rightX = Math.cos(rotationY);
  const rightZ = -Math.sin(rotationY);

  let deltaX = forwardX * safeMoveY + rightX * safeMoveX;
  let deltaZ = forwardZ * safeMoveY + rightZ * safeMoveX;
  const length = Math.hypot(deltaX, deltaZ);

  if (length > 0) {
    const distance = safeSpeed * safeDeltaTime;
    deltaX = (deltaX / length) * distance;
    deltaZ = (deltaZ / length) * distance;
  }

  return { x: deltaX, z: deltaZ };
}

export function clampArenaPosition(x, z, arena, playerRadius = 1) {
  const width = Number(arena && (arena.WIDTH ?? arena.width)) || 0;
  const depth = Number(arena && (arena.DEPTH ?? arena.depth)) || width;
  const halfWidth = Math.max(0, width / 2 - playerRadius);
  const halfDepth = Math.max(0, depth / 2 - playerRadius);

  return {
    x: clampFiniteNumber(x, -halfWidth, halfWidth, 0),
    z: clampFiniteNumber(z, -halfDepth, halfDepth, 0)
  };
}

export function applyArenaMovement({ x = 0, z = 0, rotationY = 0, moveX = 0, moveY = 0, speed = 0, deltaTime = 0, arena }) {
  const delta = calculateMovementDelta({ rotationY, moveX, moveY, speed, deltaTime });
  return clampArenaPosition(x + delta.x, z + delta.z, arena);
}

export function applyMapMovement({
  x = 0,
  z = 0,
  rotationY = 0,
  moveX = 0,
  moveY = 0,
  speed = 0,
  deltaTime = 0,
  map,
  arena,
  playerRadius = 0.45
}) {
  const activeArena = getMapArena(map) || arena;
  const delta = calculateMovementDelta({ rotationY, moveX, moveY, speed, deltaTime });
  const start = clampArenaPosition(x, z, activeArena, playerRadius);
  const afterX = resolveMapCollisions(
    clampArenaPosition(start.x + delta.x, start.z, activeArena, playerRadius),
    map,
    playerRadius
  );
  const afterZ = resolveMapCollisions(
    clampArenaPosition(afterX.x, afterX.z + delta.z, activeArena, playerRadius),
    map,
    playerRadius
  );
  return clampArenaPosition(afterZ.x, afterZ.z, activeArena, playerRadius);
}

export function resolveMapCollisions(position, map, playerRadius = 0.45, passes = 3) {
  const obstacles = Array.isArray(map && map.obstacles)
    ? map.obstacles.filter(obstacle => obstacle && obstacle.type === 'box' && obstacle.collides !== false)
    : [];

  let resolved = {
    x: clampFiniteNumber(position && position.x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0),
    z: clampFiniteNumber(position && position.z, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0)
  };

  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const obstacle of obstacles) {
      const next = resolveBoxCollision(resolved, obstacle, playerRadius);
      if (Math.abs(next.x - resolved.x) > 0.000001 || Math.abs(next.z - resolved.z) > 0.000001) {
        changed = true;
      }
      resolved = next;
    }
    if (!changed) break;
  }

  return resolved;
}

function getMapArena(map) {
  if (!map || !map.arena) return null;
  return map.arena;
}

function resolveBoxCollision(position, obstacle, playerRadius) {
  const halfWidth = Math.max(0, Number(obstacle.width) || 0) / 2;
  const halfDepth = Math.max(0, Number(obstacle.depth) || 0) / 2;
  if (halfWidth <= 0 || halfDepth <= 0) return position;

  const yaw = Number(obstacle.yaw) || 0;
  const centerX = Number(obstacle.x) || 0;
  const centerZ = Number(obstacle.z) || 0;
  const local = worldToObstacleLocal(position.x - centerX, position.z - centerZ, yaw);
  const closestX = clampFiniteNumber(local.x, -halfWidth, halfWidth, 0);
  const closestZ = clampFiniteNumber(local.z, -halfDepth, halfDepth, 0);
  const diffX = local.x - closestX;
  const diffZ = local.z - closestZ;
  const distanceSquared = diffX * diffX + diffZ * diffZ;
  const radius = Math.max(0, Number(playerRadius) || 0);

  if (distanceSquared >= radius * radius) {
    return position;
  }

  let nextLocalX = local.x;
  let nextLocalZ = local.z;

  if (distanceSquared <= 0.000001) {
    const overlapX = halfWidth + radius - Math.abs(local.x);
    const overlapZ = halfDepth + radius - Math.abs(local.z);

    if (overlapX < overlapZ) {
      const direction = local.x < 0 ? -1 : 1;
      nextLocalX = local.x + direction * overlapX;
    } else {
      const direction = local.z < 0 ? -1 : 1;
      nextLocalZ = local.z + direction * overlapZ;
    }
  } else {
    const distance = Math.sqrt(distanceSquared);
    const push = radius - distance;
    nextLocalX = local.x + (diffX / distance) * push;
    nextLocalZ = local.z + (diffZ / distance) * push;
  }

  const world = obstacleLocalToWorld(nextLocalX, nextLocalZ, yaw);
  return {
    x: centerX + world.x,
    z: centerZ + world.z
  };
}

function worldToObstacleLocal(x, z, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: x * cos + z * sin,
    z: -x * sin + z * cos
  };
}

function obstacleLocalToWorld(x, z, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: x * cos - z * sin,
    z: x * sin + z * cos
  };
}
