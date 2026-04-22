const TRAIL_LIFETIME_MS = 150;
const TRAIL_FADE_MS = 90;
const BULLET_HOLE_LIFETIME_MS = 4500;
const BULLET_HOLE_FADE_MS = 900;

export function serializeVector3(vector) {
  if (!vector) return null;
  return {
    x: finiteNumber(vector.x),
    y: finiteNumber(vector.y),
    z: finiteNumber(vector.z)
  };
}

export function deserializeVector3(THREE, value, fallback = null) {
  if (!value || typeof value !== 'object') return fallback;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return fallback;
  return new THREE.Vector3(x, y, z);
}

export function worldNormalFromHit(hit) {
  if (!hit || !hit.face || !hit.object) return null;
  return hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
}

export function createShotEffects({ THREE, scene, origin, end, impactPoint = null, impactNormal = null, color = '#fff0ad' }) {
  if (!THREE || !scene || !origin || !end) return;

  createShotTrail({ THREE, scene, origin, end, color });

  if (impactPoint && impactNormal) {
    createBulletHole({ THREE, scene, position: impactPoint, normal: impactNormal });
  }
}

function createShotTrail({ THREE, scene, origin, end, color }) {
  const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const material = new THREE.LineBasicMaterial({
    color: colorValue(THREE, color, '#fff0ad'),
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  const trail = new THREE.Line(geometry, material);
  trail.renderOrder = 20;
  scene.add(trail);
  fadeAndDispose(scene, trail, TRAIL_LIFETIME_MS, TRAIL_FADE_MS);
}

function createBulletHole({ THREE, scene, position, normal }) {
  const safeNormal = normal.clone().normalize();
  if (safeNormal.lengthSq() <= 0.000001) return;

  const group = new THREE.Group();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), safeNormal);
  group.position.copy(position).add(safeNormal.multiplyScalar(0.018));
  group.quaternion.copy(quaternion);
  group.renderOrder = 18;

  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0x2d241d,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0x070604,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const outer = new THREE.Mesh(new THREE.CircleGeometry(0.14, 18), outerMaterial);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), innerMaterial);
  inner.position.z = 0.001;
  group.add(outer, inner);

  scene.add(group);
  fadeAndDispose(scene, group, BULLET_HOLE_LIFETIME_MS, BULLET_HOLE_FADE_MS);
}

function fadeAndDispose(scene, object, lifetimeMs, fadeMs) {
  const startedAt = nowMs();
  const fadeStart = startedAt + Math.max(0, lifetimeMs - fadeMs);
  const materialOpacities = new Map();

  object.traverse(child => {
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => {
      if (material && typeof material.opacity === 'number') {
        materialOpacities.set(material, material.opacity);
      }
    });
  });

  function tick() {
    const current = nowMs();
    if (current >= startedAt + lifetimeMs) {
      disposeObject(scene, object);
      return;
    }

    if (current >= fadeStart && fadeMs > 0) {
      const alpha = Math.max(0, 1 - (current - fadeStart) / fadeMs);
      materialOpacities.forEach((baseOpacity, material) => {
        material.opacity = baseOpacity * alpha;
      });
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function disposeObject(scene, object) {
  if (object.parent) {
    object.parent.remove(object);
  } else if (scene) {
    scene.remove(object);
  }

  const disposedMaterials = new Set();
  object.traverse(child => {
    if (child.geometry && typeof child.geometry.dispose === 'function') {
      child.geometry.dispose();
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(material => {
      if (!material || disposedMaterials.has(material)) return;
      disposedMaterials.add(material);
      if (typeof material.dispose === 'function') {
        material.dispose();
      }
    });
  });
}

function colorValue(THREE, value, fallback) {
  try {
    return new THREE.Color(value || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}
