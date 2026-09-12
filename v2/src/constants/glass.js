/** Defaults from AGENT-BRIEF §14 — tune one knob at a time. */
export const GLASS_RUBY = {
  color: 0xf7ecee,
  roughness: 0.035,
  metalness: 0,
  transmission: 1,
  opacity: 1,
  ior: 1.52,
  thickness: 0.014,
  attenuationColor: 0x6e0212,
  attenuationDistance: 0.11,
  dispersion: 0.22,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  iridescence: 0.1,
  iridescenceIOR: 1.33,
  specularIntensity: 1,
  envMapIntensity: 1
};

export const WATER = {
  color: 0xffffff,
  roughness: 0.02,
  metalness: 0,
  transmission: 1,
  opacity: 1,
  ior: 1.333,
  thickness: 0.006,
  attenuationColor: 0xffffff,
  attenuationDistance: 1.0,
  dispersion: 0.08
};

export const STEM_GLASS = {
  ...GLASS_RUBY,
  color: 0xeef5ee,
  roughness: 0.08,
  ior: 1.5,
  thickness: 0.02,
  attenuationColor: 0x10240c,
  attenuationDistance: 0.2,
  dispersion: 0.08,
  iridescence: 0.04
};
