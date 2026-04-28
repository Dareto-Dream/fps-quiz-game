const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const questions = require('../shared/questions');
const config = require('../shared/config');
const { getMaps } = require('../shared/map-service');
const { sanitizePlayerName } = require('../shared/player-utils');

const rootDir = path.resolve(__dirname, '..');
const mapsDir = path.join(rootDir, 'shared', 'maps');

test('quiz questions follow authoring standards', () => {
  assert.ok(Array.isArray(questions));
  assert.ok(questions.length >= 3);

  questions.forEach((question, index) => {
    assert.equal(typeof question.question, 'string', `question ${index} prompt type`);
    assert.notEqual(question.question.trim(), '', `question ${index} prompt`);
    assert.ok(Array.isArray(question.options), `question ${index} options`);
    assert.equal(question.options.length, 4, `question ${index} option count`);
    assert.equal(Number.isInteger(question.correct), true, `question ${index} correct index type`);
    assert.ok(question.correct >= 0 && question.correct <= 3, `question ${index} correct index range`);

    const trimmedOptions = question.options.map(option => {
      assert.equal(typeof option, 'string', `question ${index} option type`);
      assert.notEqual(option.trim(), '', `question ${index} option text`);
      return option.trim();
    });
    assert.equal(new Set(trimmedOptions).size, 4, `question ${index} duplicate options`);
  });
});

test('map files match ids and provide valid spawn coverage', () => {
  const maps = getMaps();
  const files = fs
    .readdirSync(mapsDir)
    .filter(file => file.toLowerCase().endsWith('.json'));
  const fileIds = new Set(files.map(file => path.basename(file, '.json')));

  maps.forEach(map => {
    assert.ok(fileIds.has(map.id), `missing ${map.id}.json`);
    assert.ok(map.spawns.length >= 8, `${map.id} needs at least eight spawn points`);
    assert.ok(map.arena.width > 0 && map.arena.depth > 0, `${map.id} arena dimensions`);

    const collidableBoxes = map.obstacles.filter(obstacle => obstacle.type === 'box' && obstacle.collides !== false);
    map.spawns.forEach((spawn, spawnIndex) => {
      for (const obstacle of collidableBoxes) {
        assert.equal(spawnOverlapsBox(spawn, obstacle), false, `${map.id} spawn ${spawnIndex} overlaps ${obstacle.id}`);
      }
    });
  });
});

test('shared player-name sanitizer is consistent and bounded', () => {
  assert.equal(sanitizePlayerName('  Ace <Pilot>\n'), 'Ace Pilot');
  assert.equal(sanitizePlayerName('', 'Player'), 'Player');
  assert.equal(Array.from(sanitizePlayerName('12345678901234567890')).length, 18);
});

test('player cap has enough colors for every allowed slot', () => {
  assert.equal(config.MAX_PLAYERS, 30);
  assert.equal(config.DEFAULT_MAX_PLAYERS, 24);
  assert.ok(config.PLAYER_COLORS.length >= config.MAX_PLAYERS);
  assert.ok(config.COLOR_NAMES.length >= config.MAX_PLAYERS);
});

function spawnOverlapsBox(spawn, obstacle, playerRadius = 0.45) {
  const local = worldToObstacleLocal(
    Number(spawn.x) - Number(obstacle.x),
    Number(spawn.z) - Number(obstacle.z),
    Number(obstacle.yaw) || 0
  );
  const halfWidth = Number(obstacle.width) / 2;
  const halfDepth = Number(obstacle.depth) / 2;
  return Math.abs(local.x) <= halfWidth + playerRadius && Math.abs(local.z) <= halfDepth + playerRadius;
}

function worldToObstacleLocal(x, z, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: x * cos + z * sin,
    z: -x * sin + z * cos
  };
}
