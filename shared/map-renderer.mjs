function colorValue(THREE, value, fallback) {
  if (!value) return fallback;
  try {
    return new THREE.Color(value);
  } catch {
    return fallback;
  }
}

export function getArenaConfig(map) {
  const arena = (map && map.arena) || {};
  const width = Number(arena.width ?? arena.WIDTH) || 50;
  const depth = Number(arena.depth ?? arena.DEPTH) || width;
  const wallHeight = Number(arena.wallHeight ?? arena.WALL_HEIGHT) || 10;
  return {
    WIDTH: width,
    DEPTH: depth,
    WALL_HEIGHT: wallHeight
  };
}

export function buildMapScene({ THREE, scene, map, shadows = false, lightIntensity = 0.55 } = {}) {
  if (!THREE || !scene) {
    throw new Error('buildMapScene requires THREE and scene');
  }

  const activeMap = map || createFallbackMap();
  const { WIDTH, DEPTH, WALL_HEIGHT } = getArenaConfig(activeMap);
  const style = activeMap.style || {};
  const group = new THREE.Group();
  group.name = `map-${activeMap.id || 'arena'}`;

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: colorValue(THREE, style.floorColor, 0x111312),
    roughness: 0.74,
    metalness: 0.18
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, DEPTH), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = shadows;
  group.add(floor);

  const gridHelper = new THREE.GridHelper(
    Math.max(WIDTH, DEPTH),
    Math.max(10, Math.round(Math.max(WIDTH, DEPTH) / 2.5)),
    colorValue(THREE, style.gridColor, 0xffb23f),
    colorValue(THREE, style.gridSecondaryColor, 0x27302f)
  );
  gridHelper.position.y = 0.01;
  group.add(gridHelper);

  const accentMaterial = new THREE.MeshBasicMaterial({
    color: colorValue(THREE, style.accentColor, 0x26d8d8),
    transparent: true,
    opacity: 0.72
  });
  [
    { x: 0, z: -DEPTH / 2 + 2, w: Math.max(1, WIDTH - 7), d: 0.08 },
    { x: 0, z: DEPTH / 2 - 2, w: Math.max(1, WIDTH - 7), d: 0.08 },
    { x: -WIDTH / 2 + 2, z: 0, w: 0.08, d: Math.max(1, DEPTH - 7) },
    { x: WIDTH / 2 - 2, z: 0, w: 0.08, d: Math.max(1, DEPTH - 7) }
  ].forEach(strip => {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(strip.w, 0.035, strip.d), accentMaterial);
    marker.position.set(strip.x, 0.035, strip.z);
    group.add(marker);
  });

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: colorValue(THREE, style.wallColor, 0x202322),
    roughness: 0.58,
    metalness: 0.34
  });
  const wallThickness = 1;
  const northWall = new THREE.Mesh(
    new THREE.BoxGeometry(WIDTH + wallThickness * 2, WALL_HEIGHT, wallThickness),
    wallMaterial
  );
  northWall.position.set(0, WALL_HEIGHT / 2, -DEPTH / 2 - wallThickness / 2);
  configureShadow(northWall, shadows);
  group.add(northWall);

  const southWall = northWall.clone();
  southWall.position.z = DEPTH / 2 + wallThickness / 2;
  group.add(southWall);

  const eastWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, WALL_HEIGHT, DEPTH),
    wallMaterial
  );
  eastWall.position.set(WIDTH / 2 + wallThickness / 2, WALL_HEIGHT / 2, 0);
  configureShadow(eastWall, shadows);
  group.add(eastWall);

  const westWall = eastWall.clone();
  westWall.position.x = -WIDTH / 2 - wallThickness / 2;
  group.add(westWall);

  [
    [-WIDTH / 2 + 4, 3, -DEPTH / 2 + 4],
    [WIDTH / 2 - 4, 3, -DEPTH / 2 + 4],
    [-WIDTH / 2 + 4, 3, DEPTH / 2 - 4],
    [WIDTH / 2 - 4, 3, DEPTH / 2 - 4]
  ].forEach(([x, y, z], index) => {
    const light = new THREE.PointLight(index % 2 === 0 ? 0xffb23f : 0x26d8d8, lightIntensity, 18, 1.7);
    light.position.set(x, y, z);
    group.add(light);
  });

  const obstacleMeshes = [];
  const shotBlockers = [];
  const defaultObstacleMaterial = new THREE.MeshStandardMaterial({
    color: colorValue(THREE, style.obstacleColor, 0x3a3325),
    roughness: 0.5,
    metalness: 0.46,
    emissive: 0x1b1006,
    emissiveIntensity: 0.08
  });

  (activeMap.obstacles || []).forEach(obstacle => {
    if (!obstacle || obstacle.type !== 'box') return;

    const material = obstacle.color
      ? defaultObstacleMaterial.clone()
      : defaultObstacleMaterial;
    if (obstacle.color) {
      material.color = colorValue(THREE, obstacle.color, material.color);
    }

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Number(obstacle.width) || 1, Number(obstacle.height) || 1, Number(obstacle.depth) || 1),
      material
    );
    mesh.position.set(Number(obstacle.x) || 0, (Number(obstacle.height) || 1) / 2, Number(obstacle.z) || 0);
    mesh.rotation.y = Number(obstacle.yaw) || 0;
    mesh.userData.isObstacle = true;
    mesh.userData.mapObstacleId = obstacle.id;
    configureShadow(mesh, shadows);
    group.add(mesh);

    if (obstacle.collides !== false) obstacleMeshes.push(mesh);
    if (obstacle.blocksShots !== false) shotBlockers.push(mesh);
  });

  scene.add(group);

  return {
    group,
    obstacleMeshes,
    shotBlockers,
    arena: { WIDTH, DEPTH, WALL_HEIGHT }
  };
}

export function disposeMapScene(runtime) {
  if (!runtime || !runtime.group) return;

  if (runtime.group.parent) {
    runtime.group.parent.remove(runtime.group);
  }

  const disposedMaterials = new Set();
  runtime.group.traverse(object => {
    if (object.geometry && typeof object.geometry.dispose === 'function') {
      object.geometry.dispose();
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => {
      if (!material || disposedMaterials.has(material)) return;
      disposedMaterials.add(material);
      if (typeof material.dispose === 'function') {
        material.dispose();
      }
    });
  });
}

function configureShadow(mesh, enabled) {
  mesh.castShadow = enabled;
  mesh.receiveShadow = enabled;
}

function createFallbackMap() {
  return {
    id: 'fallback',
    name: 'Fallback Arena',
    arena: { width: 50, depth: 50, wallHeight: 10 },
    spawns: [{ x: 0, z: 0, yaw: 0 }],
    obstacles: []
  };
}
