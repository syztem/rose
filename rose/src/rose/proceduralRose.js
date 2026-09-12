import * as THREE from 'three/webgpu';

const GOLDEN = 137.508 * (Math.PI / 180);

function makePetalGeometry() {
  // Plan-view petal outline, extruded for real thickness (volume glass needs it).
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.12, 0.05, 0.28, 0.22, 0.22, 0.48);
  shape.bezierCurveTo(0.18, 0.62, 0.08, 0.72, 0.0, 0.78);
  shape.bezierCurveTo(-0.08, 0.72, -0.18, 0.62, -0.22, 0.48);
  shape.bezierCurveTo(-0.28, 0.22, -0.12, 0.05, 0, 0);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.009,
    bevelEnabled: true,
    bevelThickness: 0.0025,
    bevelSize: 0.0035,
    bevelSegments: 3,
    curveSegments: 20
  });

  // Stand petal in Y-up, tip +Y
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -0.0055);

  // Cup bend + midrib/vein displacement
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = THREE.MathUtils.clamp(v.y / 0.8, 0, 1);
    const cup = t * t * 0.11;
    const mid = Math.exp(-Math.pow(v.x * 8, 2));
    v.z += cup - mid * 0.014 * Math.sin(t * Math.PI);
    v.z += 0.0045 * Math.sin(t * 14) * mid;
    // slight edge roll
    v.z += Math.abs(v.x) * t * 0.08;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  // shared across petals — one geometry, many transforms
  return geo;
}

/**
 * Phyllotaxis rose ~1 world unit tall.
 * userData: petalMeshes, sepalMeshes, stem, receptacle, bloomCenter, geometries
 */
export function buildProceduralRose() {
  const root = new THREE.Group();
  root.name = 'RoseRig';

  const geometries = [];
  const petalGeo = makePetalGeometry();
  geometries.push(petalGeo);

  const petals = new THREE.Group();
  petals.name = 'Petals';

  const count = 32;
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(petalGeo);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `Petal_${i}`;

    const t = i / (count - 1);
    const yaw = i * GOLDEN;
    const radius = 0.012 + 0.145 * Math.sqrt(t);
    const open = 1 / (1 + Math.exp(-(t - 0.32) * 9));
    const pitch = THREE.MathUtils.lerp(0.22, 1.18, open);
    const lift = 0.14 + t * 0.52 + (1 - open) * 0.1;

    mesh.position.set(Math.cos(yaw) * radius, lift, Math.sin(yaw) * radius);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = yaw;
    mesh.rotation.x = pitch;
    mesh.rotation.z = (t - 0.5) * 0.12;
    mesh.userData.baseRotZ = mesh.rotation.z;
    const s = THREE.MathUtils.lerp(0.48, 1.02, open);
    mesh.scale.setScalar(s * THREE.MathUtils.lerp(0.9, 1.15, Math.sin(t * Math.PI)));
    petals.add(mesh);
  }
  root.add(petals);

  const receptacleGeo = new THREE.SphereGeometry(0.055, 20, 14);
  geometries.push(receptacleGeo);
  const receptacle = new THREE.Mesh(receptacleGeo);
  receptacle.position.y = 0.2;
  receptacle.scale.set(1, 0.75, 1);
  receptacle.name = 'Receptacle';
  receptacle.castShadow = true;
  root.add(receptacle);

  const sepalGeo = makePetalGeometry();
  geometries.push(sepalGeo);
  const sepals = new THREE.Group();
  sepals.name = 'Sepals';
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(sepalGeo);
    const yaw = (i / 5) * Math.PI * 2;
    m.position.set(Math.cos(yaw) * 0.035, 0.15, Math.sin(yaw) * 0.035);
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw;
    m.rotation.x = 1.4;
    m.scale.set(0.35, 0.45, 0.35);
    m.castShadow = true;
    m.userData.baseRotZ = 0;
    sepals.add(m);
  }
  root.add(sepals);

  const stemPts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    stemPts.push(new THREE.Vector2(THREE.MathUtils.lerp(0.018, 0.01, t), t * 0.55));
  }
  const stemGeo = new THREE.LatheGeometry(stemPts, 16);
  geometries.push(stemGeo);
  const stem = new THREE.Mesh(stemGeo);
  stem.position.set(0.015, -0.4, 0);
  stem.rotation.z = 0.07;
  stem.name = 'Stem';
  stem.castShadow = true;
  stem.receiveShadow = true;
  root.add(stem);

  const thornGeo = new THREE.ConeGeometry(0.01, 0.035, 6);
  geometries.push(thornGeo);
  for (let i = 0; i < 5; i++) {
    const th = new THREE.Mesh(thornGeo);
    th.position.set(
      0.02 + Math.cos(i * 2.2) * 0.015,
      0.08 + i * 0.08,
      Math.sin(i * 2.2) * 0.012
    );
    th.rotation.z = Math.PI / 2 + (i % 2 ? 0.35 : -0.35);
    th.castShadow = true;
    stem.add(th);
  }

  root.userData.bloomCenter = new THREE.Vector3(0, 0.42, 0);
  root.userData.petalMeshes = petals.children.slice();
  root.userData.stem = stem;
  root.userData.sepalMeshes = sepals.children.slice();
  root.userData.receptacle = receptacle;
  root.userData.geometries = geometries;

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return root;
}
