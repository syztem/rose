import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

function srgb(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

/** Shared leaflet geo for multi-blade fronds. */
function makeLeafletGeo() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.035, 0.08, 0.0, 0.22);
  shape.quadraticCurveTo(-0.035, 0.08, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.004,
    bevelEnabled: false,
    steps: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -0.002);
  return geo;
}

/** Shared primary frond blade geo. */
function makeFrondBladeGeo() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.05, 0.18, 0.0, 0.48);
  shape.quadraticCurveTo(-0.05, 0.18, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.006,
    bevelEnabled: false,
    steps: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -0.003);
  return geo;
}

function resolveHdrUrl() {
  // Page-relative so GitHub project pages (/user/repo/) resolve correctly.
  // Vite/public serve also maps /hdr/* if mirrored; we keep public/hdr for static Pages.
  return new URL('public/hdr/env.hdr', document.baseURI || window.location.href).href;
}


/** F12: cheap looping caustic cookie (canvas) — wet-floor money shot, no PT. */
function makeCausticTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  // Soft elongated caustic cells (deterministic)
  for (let pass = 0; pass < 3; pass++) {
    const n = 14 + pass * 8;
    for (let i = 0; i < n; i++) {
      const u = ((Math.sin(i * 12.9898 + pass * 3.1) * 43758.5453) % 1 + 1) % 1;
      const v = ((Math.sin(i * 78.233 + pass * 5.7) * 23421.631) % 1 + 1) % 1;
      const x = u * size;
      const y = v * size;
      const r = size * (0.035 + ((i + pass) % 5) * 0.012);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.4);
      const a0 = 0.5 - pass * 0.12;
      g.addColorStop(0, `rgba(230,255,236,${a0})`);
      g.addColorStop(0.4, `rgba(170,230,200,${a0 * 0.45})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        r * (1.35 + (i % 3) * 0.25),
        r * (0.45 + (i % 2) * 0.2),
        i * 0.9 + pass,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  // Bright wavy ridges (classic caustic network)
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 10; k++) {
    ctx.beginPath();
    const y0 = ((k + 0.5) / 10) * size;
    for (let x = 0; x <= size; x += 2) {
      const y =
        y0 +
        Math.sin(x * 0.09 + k * 1.3) * (size * 0.06) +
        Math.sin(x * 0.035 + k * 2.1) * (size * 0.09);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(200,255,220,${0.1 + (k % 3) * 0.035})`;
    ctx.lineWidth = 1.5 + (k % 2);
    ctx.stroke();
  }
  // Cross-axis ridges for network feel
  for (let k = 0; k < 8; k++) {
    ctx.beginPath();
    const x0 = ((k + 0.3) / 8) * size;
    for (let y = 0; y <= size; y += 2) {
      const x =
        x0 +
        Math.sin(y * 0.08 + k * 1.1) * (size * 0.05) +
        Math.cos(y * 0.04 + k) * (size * 0.07);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(180,245,210,${0.08 + (k % 2) * 0.03})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Mid-poly near-field forest (F11 densification).
 * Shared geos/mats, non-transmissive foliage; ground + fog + HDR path retained.
 */
export class ForestScene {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Forest';
    this._assets = [];
    this.ferns = [];
  }

  async loadEnvironment(scene) {
    let envMap = null;
    try {
      const loader = new HDRLoader();
      const url = resolveHdrUrl();
      envMap = await loader.loadAsync(url);
      envMap.mapping = THREE.EquirectangularReflectionMapping;
      envMap.colorSpace = THREE.LinearSRGBColorSpace;
      scene.environment = envMap;
      scene.environmentIntensity = 0.85;
      scene.background = envMap;
      if ('backgroundBlurriness' in scene) scene.backgroundBlurriness = 0.12;
      if ('backgroundIntensity' in scene) scene.backgroundIntensity = 0.55;
      this._assets.push(envMap);
    } catch (err) {
      console.warn('[ForestScene] HDR load failed, solid fallback', err);
      scene.background = srgb(0x8a9a8e);
      scene.environment = null;
    }

    scene.fog = new THREE.FogExp2(0x8a9a8e, 0.045);
    return envMap;
  }

  build() {
    // --- ground ---
    const groundGeo = new THREE.PlaneGeometry(14, 14, 64, 64);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const h =
        Math.sin(x * 1.3) * Math.cos(y * 1.1) * 0.04 +
        Math.sin(x * 4.1 + y * 2.3) * 0.012;
      pos.setZ(i, h);
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({
      color: srgb(0x1a2218),
      roughness: 0.62,
      metalness: 0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'Ground';
    this.group.add(ground);
    this.ground = ground;
    this._assets.push(groundGeo, groundMat);

    // --- F12: wet floor contact + cheap caustic plane under rose (0,0) ---
    // Soft wet disc (darker / smoother contact under rose footprint)
    const wetDiscGeo = new THREE.CircleGeometry(0.48, 32);
    const wetDiscMat = new THREE.MeshStandardMaterial({
      color: srgb(0x0c120e),
      roughness: 0.32,
      metalness: 0.04,
      transparent: true,
      opacity: 0.58,
      depthWrite: false
    });
    const wetDisc = new THREE.Mesh(wetDiscGeo, wetDiscMat);
    wetDisc.rotation.x = -Math.PI / 2;
    wetDisc.position.set(0, 0.017, 0);
    wetDisc.receiveShadow = true;
    wetDisc.name = 'WetFloorDisc';
    this.group.add(wetDisc);
    this._assets.push(wetDiscGeo, wetDiscMat);

    // Canvas caustic cookie → additive decal (no PT / no SS caustics)
    const causticTex = makeCausticTexture(128);
    causticTex.repeat.set(2.4, 2.4);
    this._causticTex = causticTex;
    this._assets.push(causticTex);

    const causticGeo = new THREE.PlaneGeometry(1.05, 1.05);
    const causticMat = new THREE.MeshBasicMaterial({
      map: causticTex,
      color: 0xb8f0d0,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const causticPlane = new THREE.Mesh(causticGeo, causticMat);
    causticPlane.rotation.x = -Math.PI / 2;
    causticPlane.position.set(0, 0.021, 0);
    causticPlane.renderOrder = 2;
    causticPlane.name = 'CausticFloor';
    // keep out of shadow maps
    causticPlane.castShadow = false;
    causticPlane.receiveShadow = false;
    this.group.add(causticPlane);
    this._causticMat = causticMat;
    this._assets.push(causticGeo, causticMat);


    // deterministic PRNG (stable layout)
    const rng = (seed) => {
      let s = seed | 0;
      return () => {
        s = (s * 1664525 + 1013904223) | 0;
        return (s >>> 0) / 4294967296;
      };
    };

    // --- bark color variation (shared mats) ---
    const barkMats = [
      new THREE.MeshStandardMaterial({ color: srgb(0x2a221c), roughness: 0.92, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: srgb(0x342820), roughness: 0.9, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: srgb(0x1f1914), roughness: 0.94, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: srgb(0x3a3026), roughness: 0.88, metalness: 0 })
    ];
    this._assets.push(...barkMats);

    // --- shared canopy geos: low-poly icosa + disc under-tier ---
    const canopyLeafGeo = new THREE.IcosahedronGeometry(0.55, 0);
    {
      const p = canopyLeafGeo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 0.42);
      canopyLeafGeo.computeVertexNormals();
    }
    const canopyDiscGeo = new THREE.CylinderGeometry(0.72, 0.85, 0.12, 7);
    this._assets.push(canopyLeafGeo, canopyDiscGeo);

    const canopyMats = [
      new THREE.MeshStandardMaterial({ color: srgb(0x1a3a22), roughness: 0.78, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: srgb(0x244a2c), roughness: 0.75, metalness: 0 }),
      new THREE.MeshStandardMaterial({ color: srgb(0x152e1a), roughness: 0.82, metalness: 0 })
    ];
    this._assets.push(...canopyMats);

    // --- trees: stacked taper + lean, optional secondary stem, 2-tier canopy ---
    const treeCount = 12;
    for (let i = 0; i < treeCount; i++) {
      const rnd = rng(1000 + i * 17);
      const h = 2.15 + (i % 4) * 0.38 + rnd() * 0.2;
      const rBot = 0.09 + (i % 3) * 0.022;
      const rTop = 0.035 + (i % 2) * 0.012;
      const bark = barkMats[i % barkMats.length];
      const canopyMat = canopyMats[i % canopyMats.length];
      const canopyMat2 = canopyMats[(i + 1) % canopyMats.length];

      const tree = new THREE.Group();
      const ang = (i / treeCount) * Math.PI * 2 + 0.3;
      const rad = 2.4 + (i % 5) * 0.35;
      tree.position.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad - 0.6);

      const segs = 4 + (i % 2);
      let y = 0;
      let xOff = 0;
      let zOff = 0;
      const leanX = (rnd() * 2 - 1) * 0.04;
      const leanZ = (rnd() * 2 - 1) * 0.035;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs;
        const t1 = (s + 1) / segs;
        const hSeg = h / segs;
        const rr0 = THREE.MathUtils.lerp(rBot, rTop, t0);
        const rr1 = THREE.MathUtils.lerp(rBot, rTop, t1);
        const geo = new THREE.CylinderGeometry(rr1, rr0, hSeg, 8, 1);
        const mesh = new THREE.Mesh(geo, bark);
        mesh.position.set(xOff, y + hSeg * 0.5, zOff);
        mesh.rotation.z = leanX * 0.35;
        mesh.rotation.x = -leanZ * 0.35;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        tree.add(mesh);
        this._assets.push(geo);
        y += hSeg;
        xOff += leanX * hSeg;
        zOff += leanZ * hSeg;
      }

      // secondary thin stem on every 3rd tree (cluster feel)
      if (i % 3 === 0) {
        const h2 = h * (0.55 + rnd() * 0.2);
        const geo2 = new THREE.CylinderGeometry(rTop * 0.7, rBot * 0.55, h2, 6, 1);
        const m2 = new THREE.Mesh(geo2, barkMats[(i + 2) % barkMats.length]);
        m2.position.set(0.12 + rnd() * 0.06, h2 * 0.5, -0.08);
        m2.rotation.z = 0.12;
        m2.castShadow = true;
        m2.receiveShadow = true;
        tree.add(m2);
        this._assets.push(geo2);
      }

      // 2-tier canopy: lower disc + upper icosa leaf cluster (shared geos)
      const canopyY = y + 0.05;
      const disc = new THREE.Mesh(canopyDiscGeo, canopyMat);
      disc.position.set(xOff * 0.85, canopyY - 0.15, zOff * 0.85);
      disc.scale.setScalar(0.85 + (i % 3) * 0.12);
      disc.castShadow = true;
      disc.receiveShadow = true;
      tree.add(disc);

      const leafCount = 3 + (i % 3);
      for (let L = 0; L < leafCount; L++) {
        const leaf = new THREE.Mesh(canopyLeafGeo, L % 2 === 0 ? canopyMat : canopyMat2);
        const la = (L / leafCount) * Math.PI * 2 + i * 0.4;
        const lr = 0.15 + (L % 2) * 0.12;
        leaf.position.set(
          xOff * 0.9 + Math.cos(la) * lr,
          canopyY + 0.12 + (L % 3) * 0.08,
          zOff * 0.9 + Math.sin(la) * lr
        );
        leaf.scale.setScalar(0.55 + rnd() * 0.35);
        leaf.rotation.set(rnd() * 0.4 - 0.2, la, rnd() * 0.3 - 0.15);
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        tree.add(leaf);
      }

      this.group.add(tree);
    }

    // --- ferns: multi-blade fronds (primary + paired leaflets, shared geos) ---
    const leafletGeo = makeLeafletGeo();
    const frondBladeGeo = makeFrondBladeGeo();
    const fernMats = [
      new THREE.MeshStandardMaterial({
        color: srgb(0x1c3a22),
        roughness: 0.55,
        metalness: 0,
        side: THREE.DoubleSide
      }),
      new THREE.MeshStandardMaterial({
        color: srgb(0x24502c),
        roughness: 0.58,
        metalness: 0,
        side: THREE.DoubleSide
      }),
      new THREE.MeshStandardMaterial({
        color: srgb(0x16301c),
        roughness: 0.62,
        metalness: 0,
        side: THREE.DoubleSide
      })
    ];
    this._assets.push(leafletGeo, frondBladeGeo, ...fernMats);

    for (let i = 0; i < 36; i++) {
      const g = new THREE.Group();
      const ang = (i * 2.399) % (Math.PI * 2);
      const rad = 0.55 + ((i * 0.17) % 1.1);
      g.position.set(Math.cos(ang) * rad, 0.02, Math.sin(ang) * rad - 0.15);
      const fernMat = fernMats[i % fernMats.length];
      const fronds = 5 + (i % 4);

      for (let b = 0; b < fronds; b++) {
        const frond = new THREE.Group();
        frond.rotation.y = (b / fronds) * Math.PI * 2 + i * 0.2;
        frond.rotation.x = -0.4 - (i % 5) * 0.04;
        frond.rotation.z = ((b % 3) - 1) * 0.12;
        frond.scale.setScalar(0.7 + (i % 4) * 0.11);

        const main = new THREE.Mesh(frondBladeGeo, fernMat);
        main.castShadow = true;
        main.receiveShadow = true;
        frond.add(main);

        const pairs = 3 + (b % 2);
        for (let p = 0; p < pairs; p++) {
          const t = 0.12 + p * 0.1;
          for (const side of [-1, 1]) {
            const lf = new THREE.Mesh(leafletGeo, fernMat);
            lf.position.set(side * 0.03 * (1 - p * 0.12), 0.01, t);
            lf.rotation.y = side * (0.55 + p * 0.08);
            lf.rotation.x = -0.25;
            lf.scale.setScalar(0.55 + p * 0.08);
            // limit shadow casters on dense leaflets
            lf.castShadow = p === 0;
            lf.receiveShadow = true;
            frond.add(lf);
          }
        }

        g.add(frond);
      }
      this.group.add(g);
      this.ferns.push(g);
    }

    // --- understory: moss clumps + rock scatter (shared geos/mats) ---
    const mossMat = new THREE.MeshStandardMaterial({
      color: srgb(0x243f28),
      roughness: 0.85,
      metalness: 0
    });
    const mossMat2 = new THREE.MeshStandardMaterial({
      color: srgb(0x1e3622),
      roughness: 0.88,
      metalness: 0
    });
    const rockMat = new THREE.MeshStandardMaterial({
      color: srgb(0x4a4a46),
      roughness: 0.92,
      metalness: 0.05
    });
    const rockMat2 = new THREE.MeshStandardMaterial({
      color: srgb(0x3a3c38),
      roughness: 0.95,
      metalness: 0.02
    });
    this._assets.push(mossMat, mossMat2, rockMat, rockMat2);

    const mossGeoA = new THREE.SphereGeometry(0.09, 8, 6);
    const mossGeoB = new THREE.SphereGeometry(0.07, 7, 5);
    const rockGeoA = new THREE.DodecahedronGeometry(0.08, 0);
    const rockGeoB = new THREE.IcosahedronGeometry(0.06, 0);
    for (const g of [mossGeoA, mossGeoB]) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 0.4);
      g.computeVertexNormals();
    }
    this._assets.push(mossGeoA, mossGeoB, rockGeoA, rockGeoB);

    // Instanced moss (2 geos x mats pooled into 2 draw calls)
    const mossDummy = new THREE.Object3D();
    const mossCountA = 10;
    const mossCountB = 8;
    const mossInstA = new THREE.InstancedMesh(mossGeoA, mossMat, mossCountA);
    const mossInstB = new THREE.InstancedMesh(mossGeoB, mossMat2, mossCountB);
    mossInstA.castShadow = true;
    mossInstA.receiveShadow = true;
    mossInstB.castShadow = true;
    mossInstB.receiveShadow = true;
    for (let i = 0; i < mossCountA; i++) {
      const ang = (i / mossCountA) * Math.PI * 2 + 0.15;
      const rad = 0.4 + (i % 7) * 0.18 + (i % 3) * 0.05;
      mossDummy.position.set(Math.cos(ang) * rad, 0.02, Math.sin(ang) * rad - 0.05);
      mossDummy.scale.set(1.2 + (i % 4) * 0.25, 1, 1.0 + (i % 3) * 0.2);
      mossDummy.rotation.set(0, i * 0.7, 0);
      mossDummy.updateMatrix();
      mossInstA.setMatrixAt(i, mossDummy.matrix);
    }
    for (let i = 0; i < mossCountB; i++) {
      const ang = (i / mossCountB) * Math.PI * 2 + 1.1;
      const rad = 0.55 + (i % 5) * 0.2;
      mossDummy.position.set(Math.cos(ang) * rad * 0.95, 0.018, Math.sin(ang) * rad - 0.08);
      mossDummy.scale.set(1.1 + (i % 3) * 0.2, 1, 1.15 + (i % 2) * 0.15);
      mossDummy.rotation.set(0, i * 1.1, 0);
      mossDummy.updateMatrix();
      mossInstB.setMatrixAt(i, mossDummy.matrix);
    }
    mossInstA.instanceMatrix.needsUpdate = true;
    mossInstB.instanceMatrix.needsUpdate = true;
    this.group.add(mossInstA, mossInstB);

    // Instanced rocks (2 draw calls)
    const rockDummy = new THREE.Object3D();
    const rockCountA = 8;
    const rockCountB = 6;
    const rockInstA = new THREE.InstancedMesh(rockGeoA, rockMat, rockCountA);
    const rockInstB = new THREE.InstancedMesh(rockGeoB, rockMat2, rockCountB);
    rockInstA.castShadow = true;
    rockInstA.receiveShadow = true;
    rockInstB.castShadow = true;
    rockInstB.receiveShadow = true;
    for (let i = 0; i < rockCountA; i++) {
      const ang = (i * 1.7) % (Math.PI * 2);
      const rad = 0.65 + (i % 5) * 0.28;
      rockDummy.position.set(
        Math.cos(ang) * rad + ((i % 4) - 1.5) * 0.05,
        0.025 + (i % 3) * 0.01,
        Math.sin(ang) * rad - 0.1
      );
      rockDummy.scale.set(
        0.9 + (i % 4) * 0.2,
        0.55 + (i % 3) * 0.15,
        0.85 + (i % 5) * 0.12
      );
      rockDummy.rotation.set((i % 5) * 0.2, i * 0.9, (i % 3) * 0.15);
      rockDummy.updateMatrix();
      rockInstA.setMatrixAt(i, rockDummy.matrix);
    }
    for (let i = 0; i < rockCountB; i++) {
      const ang = (i * 2.3 + 0.8) % (Math.PI * 2);
      const rad = 0.8 + (i % 4) * 0.22;
      rockDummy.position.set(Math.cos(ang) * rad, 0.02, Math.sin(ang) * rad + 0.05);
      rockDummy.scale.set(0.8 + (i % 3) * 0.15, 0.5 + (i % 2) * 0.12, 0.75 + (i % 3) * 0.1);
      rockDummy.rotation.set(0.1 * i, i * 1.3, 0.05 * i);
      rockDummy.updateMatrix();
      rockInstB.setMatrixAt(i, rockDummy.matrix);
    }
    rockInstA.instanceMatrix.needsUpdate = true;
    rockInstB.instanceMatrix.needsUpdate = true;
    this.group.add(rockInstA, rockInstB);

    return this.group;
  }

  addPuddles(waterMat) {
    const geo = new THREE.CircleGeometry(1, 24);
    this._assets.push(geo);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geo, waterMat);
      const ang = (i / 7) * Math.PI * 2 + 0.4;
      const rad = 0.7 + (i % 3) * 0.25;
      m.rotation.x = -Math.PI / 2;
      m.position.set(Math.cos(ang) * rad, 0.015, Math.sin(ang) * rad + 0.2);
      m.scale.setScalar(0.12 + (i % 3) * 0.04);
      m.receiveShadow = true;
      // F10: puddles after ground, before rose glass (petals 10+); caustic is 2
      m.renderOrder = 1 + (i % 3); // 1..3
      m.name = `Puddle_${i}`;
      this.group.add(m);
    }
  }

  addLights(scene) {
    const hemi = new THREE.HemisphereLight(0xc9d6cf, 0x1a2418, 0.35);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xe8efe4, 1.6);
    sun.position.set(4.2, 7.5, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 24;
    sun.shadow.camera.left = -4;
    sun.shadow.camera.right = 4;
    sun.shadow.camera.bottom = -4;
    sun.shadow.camera.top = 4;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    this.sun = sun;
    this.hemi = hemi;

    const fill = new THREE.DirectionalLight(0xb7c4cc, 0.25);
    fill.position.set(-3, 4, -2);
    scene.add(fill);
    this.fill = fill;
  }

  update(t) {
    for (let i = 0; i < this.ferns.length; i++) {
      this.ferns[i].rotation.z = Math.sin(t * 1.2 + i) * 0.012;
    }
    // F12: slow caustic crawl under rose
    if (this._causticTex) {
      this._causticTex.offset.x = t * 0.028;
      this._causticTex.offset.y = t * 0.018 + Math.sin(t * 0.45) * 0.04;
    }
    if (this._causticMat) {
      this._causticMat.opacity = 0.17 + Math.sin(t * 0.65) * 0.045;
    }
  }

  dispose() {
    for (const a of this._assets) {
      if (a && a.dispose) a.dispose();
    }
    this._assets.length = 0;
  }
}
