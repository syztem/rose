import * as THREE from 'three/webgpu';
import { GLASS_RUBY, WATER, STEM_GLASS } from '../constants/glass.js';

function srgb(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

/**
 * Built-in physical transmission + volume attenuation (r186 path).
 * Prefer MeshPhysicalMaterial — official WebGPU transmission examples use it;
 * NodeMaterial is available but not required for the optical contract.
 */
export function createRubyGlass(overrides = {}) {
  const p = { ...GLASS_RUBY, ...overrides };
  const mat = new THREE.MeshPhysicalMaterial({
    color: srgb(p.color),
    metalness: p.metalness,
    roughness: p.roughness,
    transmission: p.transmission,
    opacity: p.opacity,
    transparent: true,
    ior: p.ior,
    thickness: p.thickness,
    attenuationColor: srgb(p.attenuationColor),
    attenuationDistance: p.attenuationDistance,
    dispersion: p.dispersion,
    specularIntensity: p.specularIntensity,
    specularColor: srgb(0xffffff),
    clearcoat: p.clearcoat,
    clearcoatRoughness: p.clearcoatRoughness,
    iridescence: p.iridescence,
    iridescenceIOR: p.iridescenceIOR,
    iridescenceThicknessRange: [180, 380],
    envMapIntensity: p.envMapIntensity,
    side: THREE.FrontSide
  });
  return mat;
}

export function createStemGlass(overrides = {}) {
  return createRubyGlass({ ...STEM_GLASS, ...overrides });
}

export function createWaterMaterial(overrides = {}) {
  const p = { ...WATER, ...overrides };
  return new THREE.MeshPhysicalMaterial({
    color: srgb(p.color),
    metalness: p.metalness,
    roughness: p.roughness,
    transmission: p.transmission,
    opacity: p.opacity,
    transparent: true,
    ior: p.ior,
    thickness: p.thickness,
    attenuationColor: srgb(p.attenuationColor),
    attenuationDistance: p.attenuationDistance,
    dispersion: p.dispersion,
    specularIntensity: 1,
    clearcoat: 0,
    side: THREE.FrontSide
  });
}
