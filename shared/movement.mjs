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
  const width = Number(arena && arena.WIDTH) || 0;
  const depth = Number(arena && arena.DEPTH) || width;
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
