import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, If, Loop, Break,
  cameraPosition, positionWorld, modelWorldMatrixInverse,
  normalize, length, abs, min, max,
  mix, clamp, exp, sin, cos, pow, dot, reflect,
  uniform
} from 'three/tsl';

/**
 * Crystallographic ruby bloom — analytic SDF petals, sphere-traced in TSL.
 * World-space rays; SDF evaluated in object space via modelWorldMatrixInverse.
 */
export function createRaymarchedBloom() {
  const group = new THREE.Group();
  group.name = 'RaymarchedBloom';

  const uAbsorb = uniform(new THREE.Vector3(1.8, 8.5, 7.2));
  const uTime = uniform(0);

  const geo = new THREE.BoxGeometry(1.5, 1.7, 1.5);
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const sdEllipsoid = Fn(([p, r]) => {
    const k0 = length(p.div(r));
    const k1 = length(p.div(r.mul(r)));
    return k0.mul(k0.sub(1.0)).div(max(k1, float(1e-4)));
  });

  const smin = Fn(([a, b, k]) => {
    const h = clamp(float(0.5).add(float(0.5).mul(b.sub(a)).div(k)), 0.0, 1.0);
    return mix(b, a, h).sub(k.mul(h).mul(float(1.0).sub(h)));
  });

  const rotY = Fn(([p, a]) => {
    const c = cos(a);
    const s = sin(a);
    return vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.z.mul(c).sub(p.x.mul(s)));
  });

  const rotX = Fn(([p, a]) => {
    const c = cos(a);
    const s = sin(a);
    return vec3(p.x, p.y.mul(c).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(c)));
  });

  const petalSDF = Fn(([p, open]) => {
    let q = rotX(p, open);
    const curl = q.y.mul(q.y).mul(0.65);
    q = vec3(q.x, q.y, q.z.add(curl));
    q = vec3(q.x.add(sin(q.y.mul(18.0)).mul(0.008)), q.y, q.z);
    return sdEllipsoid(q, vec3(0.2, 0.4, 0.038));
  });

  const bloomSDF = Fn(([p]) => {
    const breath = float(1.0).add(sin(uTime.mul(0.65)).mul(0.01));
    let q = p.div(breath);
    q = vec3(q.x, q.y.sub(0.02), q.z);

    let d = float(10.0);

    Loop(16, ({ i }) => {
      const fi = float(i);
      const yaw = fi.mul(2.399963);
      const tSpan = fi.div(15.0);
      const open = mix(float(0.28), float(1.35), tSpan);
      const radius = float(0.015).add(float(0.3).mul(pow(tSpan, float(0.58))));
      const lift = float(0.06).add(tSpan.mul(0.58));
      let local = q.sub(vec3(cos(yaw).mul(radius), lift, sin(yaw).mul(radius)));
      local = rotY(local, yaw.negate());
      d = smin(d, petalSDF(local, open), float(0.04));
    });

    const core = length(q.sub(vec3(0.0, 0.2, 0.0))).sub(0.065);
    d = smin(d, core, float(0.028));

    const sp = vec3(q.x.sub(0.012), q.y.add(0.2), q.z);
    const stem = length(vec2(sp.x, sp.z)).sub(0.016);
    const stemY = abs(sp.y.add(0.2)).sub(0.4);
    d = min(d, max(stem, stemY));

    return d;
  });

  const toLocal = Fn(([pWorld]) => {
    return modelWorldMatrixInverse.mul(vec4(pWorld, 1.0)).xyz;
  });

  const calcNormal = Fn(([pLocal]) => {
    const e = float(0.0012);
    return normalize(
      vec3(
        bloomSDF(pLocal.add(vec3(e, 0, 0))).sub(bloomSDF(pLocal.sub(vec3(e, 0, 0)))),
        bloomSDF(pLocal.add(vec3(0, e, 0))).sub(bloomSDF(pLocal.sub(vec3(0, e, 0)))),
        bloomSDF(pLocal.add(vec3(0, 0, e))).sub(bloomSDF(pLocal.sub(vec3(0, 0, e))))
      )
    );
  });

  mat.colorNode = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(positionWorld.sub(cameraPosition));

    const hit = float(0).toVar();
    const pHitW = vec3(0).toVar();
    const pHitL = vec3(0).toVar();
    const tTrav = float(0).toVar();
    const dens = float(0).toVar();

    Loop(96, () => {
      const pW = ro.add(rd.mul(tTrav));
      const pL = toLocal(pW);
      const d = bloomSDF(pL);
      If(d.lessThan(0.0012), () => {
        hit.assign(1);
        pHitW.assign(pW);
        pHitL.assign(pL);
        Break();
      });
      tTrav.addAssign(clamp(d, 0.0015, 0.08));
      dens.addAssign(float(0.02).div(float(1).add(d.mul(d).mul(50))));
      If(tTrav.greaterThan(6.0), () => {
        Break();
      });
    });

    const col = vec3(0).toVar();
    const alpha = float(0).toVar();

    If(hit.greaterThan(0.5), () => {
      const n = calcNormal(pHitL);
      const view = rd.negate();
      const ndv = clamp(dot(n, view), 0, 1);
      const fres = float(0.05).add(float(0.95).mul(pow(float(1).sub(ndv), 5)));

      const thick = float(0.06).add(float(0.28).mul(float(1).sub(ndv)));
      const beer = exp(uAbsorb.negate().mul(thick));

      const rdir = reflect(rd, n);
      const sky = mix(vec3(0.015, 0.02, 0.04), vec3(0.45, 0.52, 0.7), clamp(rdir.y.mul(0.55).add(0.45), 0, 1));
      const ruby = vec3(0.72, 0.03, 0.06).mul(beer);
      const face = ruby.mul(float(0.75).add(ndv.mul(0.5)));
      const rim = vec3(1.0, 0.55, 0.7).mul(pow(float(1).sub(ndv), 2.2)).mul(0.7);
      const irid = vec3(0.2, 0.05, 0.35).mul(pow(float(1).sub(ndv), 3.5)).mul(0.35);

      col.assign(mix(face.add(rim).add(irid), sky, fres.mul(0.85)));
      alpha.assign(mix(float(0.96), float(0.5), fres.mul(0.4)));
    }).Else(() => {
      col.assign(dens.mul(vec3(0.5, 0.05, 0.08)));
      alpha.assign(clamp(dens.mul(3.0), 0, 0.4));
    });

    return vec4(col, alpha);
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.position.y = 0.35;
  group.add(mesh);

  return {
    group,
    uniforms: { uAbsorb, uTime },
    update(t) {
      uTime.value = t;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    }
  };
}
