const BOROUGH_TINT = {
  Manhattan: { h: 188 },
  Brooklyn: { h: 32 },
  Queens: { h: 138 },
  Bronx: { h: 96 },
  "Staten Island": { h: 62 },
};

const HEALTH_VIGOR = {
  good: 1.0,
  fair: 0.65,
  poor: 0.35,
};

export function orbPalette(tree) {
  const tint = BOROUGH_TINT[tree.borough] || { h: 160 };
  const dead = tree.status !== "Alive";
  const vigor = dead ? 0.05 : HEALTH_VIGOR[tree.health] ?? 0.7;

  const speciesShift = (hashSpecies(tree.species) - 0.5) * 28;
  const hue = (tint.h + speciesShift + 360) % 360;

  return {
    core: { h: hue, s: 25 + 50 * vigor, b: 95 + 5 * vigor },
    halo: { h: hue, s: 70, b: 100 },
    vigor,
    dead,
  };
}

export const BRANCH_COLOR = { h: 168, s: 14, b: 56 };
export const BRANCH_HALO = { h: 178, s: 50, b: 92 };

const SPECIES_HASH = new Map();
export function hashSpecies(name) {
  if (SPECIES_HASH.has(name)) return SPECIES_HASH.get(name);
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const v = (h % 1000) / 1000;
  SPECIES_HASH.set(name, v);
  return v;
}
