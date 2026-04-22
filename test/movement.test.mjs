import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyArenaMovement,
  calculateMovementDelta,
  clampArenaPosition,
  sanitizePlayerInput
} from '../shared/movement.mjs';

test('sanitizePlayerInput clamps invalid and out-of-range values', () => {
  const input = sanitizePlayerInput({
    moveX: 5,
    moveY: '-2',
    lookDeltaX: 'not-a-number',
    lookDeltaY: 0.25,
    shoot: 1,
    jump: '',
    timestamp: '1234'
  });

  assert.equal(input.moveX, 1);
  assert.equal(input.moveY, -1);
  assert.equal(input.lookDeltaX, 0);
  assert.equal(input.lookDeltaY, 0.25);
  assert.equal(input.shoot, true);
  assert.equal(input.jump, false);
  assert.equal(input.timestamp, 1234);
});

test('forward movement faces negative z at zero rotation', () => {
  const delta = calculateMovementDelta({
    rotationY: 0,
    moveX: 0,
    moveY: -1,
    speed: 8,
    deltaTime: 0.5
  });

  assert.equal(delta.x, 0);
  assert.equal(delta.z, -4);
});

test('diagonal movement is normalized to configured speed', () => {
  const delta = calculateMovementDelta({
    rotationY: 0,
    moveX: 1,
    moveY: -1,
    speed: 8,
    deltaTime: 1
  });

  assert.ok(Math.abs(Math.hypot(delta.x, delta.z) - 8) < 0.000001);
});

test('arena clamp respects width and depth independently', () => {
  const position = clampArenaPosition(99, -99, { WIDTH: 50, DEPTH: 30 }, 1);

  assert.deepEqual(position, { x: 24, z: -14 });
});

test('applyArenaMovement keeps movement inside arena bounds', () => {
  const position = applyArenaMovement({
    x: 23.5,
    z: 0,
    rotationY: 0,
    moveX: 1,
    moveY: 0,
    speed: 8,
    deltaTime: 1,
    arena: { WIDTH: 50, DEPTH: 50 }
  });

  assert.deepEqual(position, { x: 24, z: 0 });
});
