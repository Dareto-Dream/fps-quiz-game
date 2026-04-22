function colorValue(THREE, value, fallback) {
  const target = value || fallback;
  try {
    return target && target.isColor ? target : new THREE.Color(target);
  } catch {
    try {
      return fallback && fallback.isColor ? fallback : new THREE.Color(fallback);
    } catch {
      return fallback;
    }
  }
}

const TIME_OF_DAY_PRESETS = {
  morning: {
    skyColor: '#b9dfff',
    fogColor: '#cfe7f2',
    fogNear: 58,
    fogFar: 150,
    toneMappingExposure: 1.22,
    ambientColor: '#fff2dd',
    ambientIntensity: 0.95,
    hemisphereSkyColor: '#d8ecff',
    hemisphereGroundColor: '#6d6652',
    hemisphereIntensity: 0.62,
    sunColor: '#ffe0a3',
    sunIntensity: 1.75,
    sunPosition: { x: -32, y: 28, z: -18 },
    fillColor: '#b9dcff',
    fillIntensity: 0.28,
    fillPosition: { x: 30, y: 22, z: 24 },
    arenaLightIntensity: 0.28,
    arenaLightDistance: 24
  },
  midday: {
    skyColor: '#8fcfff',
    fogColor: '#c8e7f8',
    fogNear: 72,
    fogFar: 190,
    toneMappingExposure: 1.35,
    ambientColor: '#f1f8ff',
    ambientIntensity: 1.08,
    hemisphereSkyColor: '#d8f3ff',
    hemisphereGroundColor: '#756b5c',
    hemisphereIntensity: 0.78,
    sunColor: '#fff4d2',
    sunIntensity: 2.35,
    sunPosition: { x: 12, y: 64, z: 10 },
    fillColor: '#c8e5ff',
    fillIntensity: 0.38,
    fillPosition: { x: -30, y: 24, z: -22 },
    arenaLightIntensity: 0.22,
    arenaLightDistance: 24
  },
  evening: {
    skyColor: '#6e8fb5',
    fogColor: '#9b8b79',
    fogNear: 50,
    fogFar: 130,
    toneMappingExposure: 1.18,
    ambientColor: '#d7c1a4',
    ambientIntensity: 0.78,
    hemisphereSkyColor: '#a9c1de',
    hemisphereGroundColor: '#5c4c3d',
    hemisphereIntensity: 0.52,
    sunColor: '#ffb36e',
    sunIntensity: 1.55,
    sunPosition: { x: 38, y: 20, z: 10 },
    fillColor: '#8db9ff',
    fillIntensity: 0.24,
    fillPosition: { x: -24, y: 18, z: -26 },
    arenaLightIntensity: 0.45,
    arenaLightDistance: 24
  },
  night: {
    skyColor: '#101827',
    fogColor: '#111723',
    fogNear: 34,
    fogFar: 95,
    toneMappingExposure: 1.1,
    ambientColor: '#6f86aa',
    ambientIntensity: 0.42,
    hemisphereSkyColor: '#7894c7',
    hemisphereGroundColor: '#1b1f20',
    hemisphereIntensity: 0.38,
    sunColor: '#b9ccff',
    sunIntensity: 0.38,
    sunPosition: { x: -18, y: 40, z: 18 },
    fillColor: '#26d8d8',
    fillIntensity: 0.22,
    fillPosition: { x: 24, y: 24, z: -18 },
    arenaLightIntensity: 0.88,
    arenaLightDistance: 26
  }
};

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

export function buildMapScene({ THREE, scene, renderer, map, shadows = false, lightIntensity = 0.55 } = {}) {
  if (!THREE || !scene) {
    throw new Error('buildMapScene requires THREE and scene');
  }

  const activeMap = map || createFallbackMap();
  const { WIDTH, DEPTH, WALL_HEIGHT } = getArenaConfig(activeMap);
  const style = activeMap.style || {};
  const lighting = resolveLightingConfig(activeMap.lighting, lightIntensity);
  const group = new THREE.Group();
  group.name = `map-${activeMap.id || 'arena'}`;
  const obstacleMeshes = [];
  const shotBlockers = [];

  configureSceneLighting({ THREE, scene, renderer, group, lighting, shadows, width: WIDTH, depth: DEPTH });

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: colorValue(THREE, style.floorColor, 0x111312),
    roughness: 0.74,
    metalness: 0.18
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, DEPTH), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = shadows;
  group.add(floor);
  shotBlockers.push(floor);

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
  shotBlockers.push(northWall, southWall, eastWall, westWall);

  addArenaAccentLights({ THREE, group, lighting, width: WIDTH, depth: DEPTH });

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

function resolveLightingConfig(lighting = {}, fallbackLightIntensity = 0.55) {
  const timeOfDay = typeof lighting.timeOfDay === 'string'
    ? lighting.timeOfDay.toLowerCase()
    : 'midday';
  const preset = TIME_OF_DAY_PRESETS[timeOfDay] || TIME_OF_DAY_PRESETS.midday;
  return {
    ...preset,
    ...lighting,
    timeOfDay,
    ambientIntensity: numberValue(lighting.ambientIntensity, preset.ambientIntensity, 0),
    hemisphereIntensity: numberValue(lighting.hemisphereIntensity, preset.hemisphereIntensity, 0),
    sunIntensity: numberValue(lighting.sunIntensity, preset.sunIntensity, 0),
    fillIntensity: numberValue(lighting.fillIntensity, preset.fillIntensity, 0),
    arenaLightIntensity: numberValue(lighting.arenaLightIntensity, preset.arenaLightIntensity ?? fallbackLightIntensity, 0),
    arenaLightDistance: numberValue(lighting.arenaLightDistance, preset.arenaLightDistance, 0),
    fogNear: numberValue(lighting.fogNear, preset.fogNear, 0),
    fogFar: numberValue(lighting.fogFar, preset.fogFar, 1),
    toneMappingExposure: numberValue(lighting.toneMappingExposure, preset.toneMappingExposure, 0.1),
    sunPosition: vectorValue(lighting.sunPosition, preset.sunPosition),
    fillPosition: vectorValue(lighting.fillPosition, preset.fillPosition)
  };
}

function numberValue(value, fallback, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  const target = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(min, Math.min(max, target));
}

function vectorValue(value, fallback) {
  const source = value && typeof value === 'object' ? value : fallback;
  return {
    x: numberValue(source && source.x, fallback.x),
    y: numberValue(source && source.y, fallback.y),
    z: numberValue(source && source.z, fallback.z)
  };
}

function configureSceneLighting({ THREE, scene, renderer, group, lighting, shadows, width, depth }) {
  scene.background = colorValue(THREE, lighting.skyColor, 0x8fcfff);

  if (lighting.fog === false) {
    scene.fog = null;
  } else {
    const fogNear = Math.min(lighting.fogNear, lighting.fogFar - 1);
    scene.fog = new THREE.Fog(
      colorValue(THREE, lighting.fogColor, lighting.skyColor || 0xc8e7f8),
      fogNear,
      lighting.fogFar
    );
  }

  if (renderer && Number.isFinite(lighting.toneMappingExposure)) {
    renderer.toneMappingExposure = lighting.toneMappingExposure;
  }

  if (lighting.ambientIntensity > 0) {
    group.add(new THREE.AmbientLight(
      colorValue(THREE, lighting.ambientColor, 0xf1f8ff),
      lighting.ambientIntensity
    ));
  }

  if (lighting.hemisphereIntensity > 0) {
    group.add(new THREE.HemisphereLight(
      colorValue(THREE, lighting.hemisphereSkyColor, lighting.skyColor || 0xd8f3ff),
      colorValue(THREE, lighting.hemisphereGroundColor, 0x756b5c),
      lighting.hemisphereIntensity
    ));
  }

  if (lighting.sunIntensity > 0) {
    const sun = new THREE.DirectionalLight(
      colorValue(THREE, lighting.sunColor, 0xfff4d2),
      lighting.sunIntensity
    );
    sun.position.set(lighting.sunPosition.x, lighting.sunPosition.y, lighting.sunPosition.z);
    sun.target.position.set(0, 0, 0);
    configureDirectionalShadow(sun, shadows, Math.max(width, depth));
    group.add(sun);
    group.add(sun.target);
  }

  if (lighting.fillIntensity > 0) {
    const fill = new THREE.DirectionalLight(
      colorValue(THREE, lighting.fillColor, 0xc8e5ff),
      lighting.fillIntensity
    );
    fill.position.set(lighting.fillPosition.x, lighting.fillPosition.y, lighting.fillPosition.z);
    group.add(fill);
  }
}

function configureDirectionalShadow(light, enabled, mapSize) {
  light.castShadow = enabled;
  if (!enabled) return;

  const shadowExtent = Math.max(30, mapSize * 0.72);
  light.shadow.mapSize.width = 2048;
  light.shadow.mapSize.height = 2048;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 160;
  light.shadow.camera.left = -shadowExtent;
  light.shadow.camera.right = shadowExtent;
  light.shadow.camera.top = shadowExtent;
  light.shadow.camera.bottom = -shadowExtent;
}

function addArenaAccentLights({ THREE, group, lighting, width, depth }) {
  if (lighting.arenaLightIntensity <= 0 || lighting.arenaLightDistance <= 0) return;

  const colors = Array.isArray(lighting.arenaLightColors) && lighting.arenaLightColors.length > 0
    ? lighting.arenaLightColors
    : ['#ffb23f', '#26d8d8'];
  [
    [-width / 2 + 4, 3.25, -depth / 2 + 4],
    [width / 2 - 4, 3.25, -depth / 2 + 4],
    [-width / 2 + 4, 3.25, depth / 2 - 4],
    [width / 2 - 4, 3.25, depth / 2 - 4]
  ].forEach(([x, y, z], index) => {
    const light = new THREE.PointLight(
      colorValue(THREE, colors[index % colors.length], 0xffffff),
      lighting.arenaLightIntensity,
      lighting.arenaLightDistance,
      1.5
    );
    light.position.set(x, y, z);
    group.add(light);
  });
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
    lighting: { timeOfDay: 'midday' },
    spawns: [{ x: 0, z: 0, yaw: 0 }],
    obstacles: []
  };
}
