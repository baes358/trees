function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIXEL = 1; // finer positioning grid — higher-resolution, cleaner dotted lines
const TAU = Math.PI * 2;

function tiltDirection(dx, dy, dz, bend, az) {
  let ux, uy, uz;
  if (Math.abs(dy) > 0.9) {
    ux = 1;
    uy = 0;
    uz = 0;
  } else {
    ux = 0;
    uy = -1;
    uz = 0;
  }
  const dot = ux * dx + uy * dy + uz * dz;
  ux -= dot * dx;
  uy -= dot * dy;
  uz -= dot * dz;
  const ulen = Math.hypot(ux, uy, uz);
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;

  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;

  const c = Math.cos(bend);
  const s = Math.sin(bend);
  const ca = Math.cos(az);
  const sa = Math.sin(az);

  return {
    x: dx * c + (ux * ca + vx * sa) * s,
    y: dy * c + (uy * ca + vy * sa) * s,
    z: dz * c + (uz * ca + vz * sa) * s,
  };
}

function tilt(dir, bend, az) {
  return tiltDirection(dir.x, dir.y, dir.z, bend, az);
}

// Pull a direction toward a target (gravity for droop, sky for upsweep).
function blendDir(dir, ty, t) {
  const x = dir.x * (1 - t);
  const y = dir.y * (1 - t) + ty * t;
  const z = dir.z * (1 - t);
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

const snap = (v) => Math.round(v / PIXEL) * PIXEL;

// ---------------------------------------------------------------------------
// Tree archetypes (numbered after the botanical plate they're modeled on).
//   fir/columnar/spruce — excurrent conifers: central leader + lateral whorls,
//     silhouette shaped by how lateral length tapers up the cone.
//   pine — excurrent but bare-trunked: branches only in the top crown, swept up.
//   broadleaf — decurrent: no leader, repeated spreading forks (rounded crown).
// ---------------------------------------------------------------------------
const FORMS = {
  fir: {
    growth: "excurrent",
    trunkLenFactor: 0.6,
    trunkWidthFactor: 0.012,
    crownStart: 0.05,
    whorls: 17,
    perWhorl: 6,
    lateralBase: 0.4,
    coneExp: 1.3,
    lateralBend: 1.5,
    gravity: 1,
    lateralDroop: 0.14,
    droopT: 0.18,
    jitter: 0.5,
    sprayDepth: 2,
  },
  columnar: {
    growth: "excurrent",
    trunkLenFactor: 0.67,
    trunkWidthFactor: 0.011,
    crownStart: 0.05,
    whorls: 23,
    perWhorl: 6,
    lateralBase: 0.22,
    coneExp: 0.7,
    lateralBend: 1.22,
    gravity: 1,
    lateralDroop: 0.05,
    droopT: 0.1,
    jitter: 0.35,
    sprayDepth: 2,
  },
  pine: {
    growth: "excurrent",
    trunkLenFactor: 0.66,
    trunkWidthFactor: 0.018,
    crownStart: 0.58,
    whorls: 7,
    perWhorl: 5,
    lateralBase: 0.55,
    coneExp: 0.4,
    lateralBend: 1.5,
    gravity: -0.4, // mild upsweep so the crown spreads into an umbrella, not a spire
    lateralDroop: 0.08,
    droopT: 0.12,
    jitter: 0.9,
    sprayDepth: 3,
  },
  spruce: {
    growth: "excurrent",
    trunkLenFactor: 0.56,
    trunkWidthFactor: 0.013,
    crownStart: 0.03,
    whorls: 18,
    perWhorl: 7,
    lateralBase: 0.5,
    coneExp: 1.5,
    lateralBend: 1.6,
    gravity: 1,
    lateralDroop: 0.24,
    droopT: 0.28,
    jitter: 0.5,
    sprayDepth: 2,
  },
  broadleaf: { growth: "decurrent" },
};

export const TREE_FORMS = Object.keys(FORMS);

export function randomTreeForm(rand = Math.random) {
  return TREE_FORMS[Math.floor(rand() * TREE_FORMS.length)];
}

export function generateSkeleton({ width, height, seed = 13, bendScale = 1.0, form = "broadleaf" }) {
  const params = FORMS[form] || FORMS.broadleaf;
  if (params.growth === "excurrent") {
    return generateExcurrent({ width, height, seed, bendScale, params });
  }
  return generateDecurrent({ width, height, seed, bendScale });
}

// --- Conifers: central trunk with lateral whorls --------------------------

function generateExcurrent({ width, height, seed, bendScale, params }) {
  const rng = mulberry32(seed);
  const branchPoints = [];
  const candidates = [];
  let maxOrd = 0;
  const track = (o) => {
    if (o > maxOrd) maxOrd = o;
  };

  const baseX = width / 2;
  const baseY = height * 0.92;
  const trunkLen = height * params.trunkLenFactor;
  const trunkWidth = Math.max(8, Math.round(height * params.trunkWidthFactor));

  // Walk the leader straight up, sampling it so whorls can attach along it.
  const segs = Math.max(30, Math.floor(trunkLen / 3.5));
  const samples = [];
  let x = baseX;
  let y = baseY;
  let z = 0;
  let dir = { x: 0, y: -1, z: 0 };
  for (let i = 1; i <= segs; i++) {
    dir = tilt(dir, 0.012 * (rng() - 0.5), rng() * TAU);
    const step = trunkLen / segs;
    x += dir.x * step;
    y += dir.y * step;
    z += dir.z * step;
    const hf = i / segs;
    const ord = hf * trunkLen;
    const taper = 1 - 0.82 * hf;
    const w = Math.max(PIXEL, Math.round((trunkWidth * taper) / PIXEL) * PIXEL);
    branchPoints.push({ x: snap(x), y: snap(y), z: snap(z), ord, depth: 8, w });
    track(ord);
    samples.push({ x, y, z, ord, hf });
  }
  candidates.push({ x: snap(x), y: snap(y), z: snap(z), ord: trunkLen, kind: "tip" });

  const ctx = { branchPoints, candidates, params, track, bendScale };
  const span = 0.97 - params.crownStart;
  for (let wI = 0; wI < params.whorls; wI++) {
    const u = params.whorls === 1 ? 0 : wI / (params.whorls - 1); // 0 bottom .. 1 top
    const hf = params.crownStart + u * span;
    const s = samples[Math.min(samples.length - 1, Math.floor(hf * samples.length))];
    // Cone profile: laterals longest at the bottom of the crown.
    const prof = Math.pow(1 - u, params.coneExp);
    const len = params.lateralBase * trunkLen * (0.25 + 0.75 * prof);
    const perWhorl = params.perWhorl + (rng() < 0.5 ? 1 : 0);
    const azOff = rng() * TAU;
    const branchW = Math.max(PIXEL, trunkWidth * 0.4 * prof + PIXEL);
    for (let b = 0; b < perWhorl; b++) {
      const az = azOff + (b / perWhorl) * TAU + (rng() - 0.5) * params.jitter;
      let d = tilt({ x: 0, y: -1, z: 0 }, params.lateralBend * (0.9 + rng() * 0.2), az);
      d = blendDir(d, params.gravity, params.lateralDroop);
      growSpray(rng, ctx, s.x, s.y, s.z, d, len * bendScale * 0.6 + len * 0.4, params.sprayDepth, s.ord, branchW);
    }
  }

  // Conifer silhouettes vary a lot in height and droop, so normalize each one
  // into a consistent on-screen frame instead of hand-tuning every preset.
  const framed = fitToFrame(branchPoints, candidates, width, height);

  branchPoints.sort((a, b) => a.ord - b.ord);
  shuffle(candidates, rng);
  return { branchPoints, candidates, baseX: framed.baseX, baseY: framed.baseY, maxOrd };
}

// Scale + translate every point so the tree's bounding box fits a target frame,
// keeping the trunk base centered at the bottom as the rotation pivot.
function fitToFrame(branchPoints, candidates, width, height) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of branchPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const targetTop = height * 0.12;
  const targetBottom = height * 0.95;
  const scale = Math.min(1.6, (targetBottom - targetTop) / (maxY - minY || 1));
  const cx = (minX + maxX) / 2;
  const tx = width / 2;

  const apply = (p) => {
    p.x = snap(tx + (p.x - cx) * scale);
    p.y = snap(targetTop + (p.y - minY) * scale);
    p.z = snap((p.z || 0) * scale);
    if (p.w) p.w = Math.max(PIXEL, Math.round((p.w * scale) / PIXEL) * PIXEL);
  };
  for (const p of branchPoints) apply(p);
  for (const c of candidates) apply(c);

  return { baseX: tx, baseY: targetBottom };
}

// A lateral branch and its drooping (or upswept) sub-sprays of foliage.
function growSpray(rng, ctx, x, y, z, dir, len, depth, attachOrd, width) {
  const { branchPoints, candidates, params, track } = ctx;
  const segs = Math.max(3, Math.floor(len / 3));
  let cx = x;
  let cy = y;
  let cz = z;
  let cd = dir;
  const step = len / segs;
  for (let i = 1; i <= segs; i++) {
    cd = blendDir(cd, params.gravity, 0.03 * params.droopT * 4);
    cd = tilt(cd, 0.05 * (rng() - 0.5), rng() * TAU);
    cx += cd.x * step;
    cy += cd.y * step;
    cz += cd.z * step;
    const ord = attachOrd + (i / segs) * len;
    branchPoints.push({ x: snap(cx), y: snap(cy), z: snap(cz), ord, depth, w: Math.max(PIXEL, width) });
    track(ord);
    if (rng() < 0.6) {
      candidates.push({ x: snap(cx), y: snap(cy), z: snap(cz), ord, kind: "branch" });
    }
  }

  if (depth > 0 && len > 10) {
    const n = 2 + (rng() < 0.5 ? 1 : 0);
    const azBase = rng() * TAU;
    for (let s = 0; s < n; s++) {
      const az = azBase + (s / n) * TAU + (rng() - 0.5) * 0.8;
      let childDir = tilt(cd, 0.5 + rng() * 0.4, az);
      childDir = blendDir(childDir, params.gravity, params.droopT);
      growSpray(rng, ctx, cx, cy, cz, childDir, len * (0.6 + rng() * 0.12), depth - 1, attachOrd + len, width * 0.62);
    }
  } else {
    candidates.push({ x: snap(cx), y: snap(cy), z: snap(cz), ord: attachOrd + len, kind: "tip" });
  }
}

// --- Broadleaf: spreading decurrent crown ---------------------------------

function generateDecurrent({ width, height, seed, bendScale }) {
  const branchPoints = [];
  const candidates = [];
  const rng = mulberry32(seed);

  const baseX = width / 2;
  const baseY = height * 0.92;
  const trunkLen = height * 0.22;
  const trunkWidth = Math.max(8, Math.round(height * 0.014));

  let maxOrd = 0;

  function recurse(x, y, z, dx, dy, dz, len, depth, cumLen, branchWidth) {
    if (depth <= 0 || len < 3) {
      const px = snap(x);
      const py = snap(y);
      const pz = snap(z);
      candidates.push({ x: px, y: py, z: pz, ord: cumLen, kind: "tip" });
      if (cumLen > maxOrd) maxOrd = cumLen;
      return;
    }

    const segs = Math.max(4, Math.floor(len / 2.6));
    let cx = x;
    let cy = y;
    let cz = z;
    let cdx = dx;
    let cdy = dy;
    let cdz = dz;
    const sway = 0.04 + (1 - depth / 8) * 0.16;

    for (let i = 1; i <= segs; i++) {
      const wob = sway * (rng() - 0.5);
      const az = rng() * Math.PI * 2;
      const tilted = tiltDirection(cdx, cdy, cdz, wob, az);
      cdx = tilted.x;
      cdy = tilted.y;
      cdz = tilted.z;
      const step = len / segs;
      cx += cdx * step;
      cy += cdy * step;
      cz += cdz * step;

      const px = snap(cx);
      const py = snap(cy);
      const pz = snap(cz);
      const ord = cumLen + (i / segs) * len;
      const taper = 1 - 0.18 * (i / segs);
      const w = Math.max(PIXEL, Math.round((branchWidth * taper) / PIXEL) * PIXEL);
      branchPoints.push({ x: px, y: py, z: pz, ord, depth, w });
      if (ord > maxOrd) maxOrd = ord;

      if (depth <= 4 && rng() < 0.32) {
        candidates.push({ x: px, y: py, z: pz, ord, kind: "branch" });
      }
    }

    let splits;
    let bend;
    let lengthBase;
    let randomizeAz;
    if (depth === 8) {
      splits = 5;
      bend = 0.62;
      lengthBase = 0.78;
      randomizeAz = 0.18;
    } else if (depth === 7) {
      splits = 3;
      bend = 0.55;
      lengthBase = 0.7;
      randomizeAz = 0.4;
    } else if (depth >= 5) {
      splits = 2 + (rng() < 0.4 ? 1 : 0);
      bend = 0.45 + rng() * 0.18;
      lengthBase = 0.62;
      randomizeAz = 0.6;
    } else {
      splits = 2;
      bend = 0.32 + rng() * 0.28;
      lengthBase = 0.6;
      randomizeAz = 0.8;
    }

    const azBase = rng() * Math.PI * 2;
    for (let s = 0; s < splits; s++) {
      const evenAz = (s / splits) * Math.PI * 2;
      const childAz = azBase + evenAz + (rng() - 0.5) * randomizeAz * Math.PI;
      const childBend = bend * bendScale * (0.85 + rng() * 0.3);
      const childDir = tiltDirection(cdx, cdy, cdz, childBend, childAz);
      const childLen = len * (lengthBase + rng() * 0.14);
      const childWidth = branchWidth * (0.62 + rng() * 0.1);
      recurse(cx, cy, cz, childDir.x, childDir.y, childDir.z, childLen, depth - 1, cumLen + len, childWidth);
    }

    if (depth >= 4 && rng() < 0.18) {
      const az = rng() * Math.PI * 2;
      const childDir = tiltDirection(cdx, cdy, cdz, (0.4 + rng() * 0.2) * bendScale, az);
      const childLen = len * 0.55;
      recurse(cx, cy, cz, childDir.x, childDir.y, childDir.z, childLen, depth - 2, cumLen + len * 0.5, branchWidth * 0.5);
    }
  }

  recurse(baseX, baseY, 0, 0, -1, 0, trunkLen, 8, 0, trunkWidth);

  branchPoints.sort((a, b) => a.ord - b.ord);
  shuffle(candidates, rng);

  return { branchPoints, candidates, baseX, baseY, maxOrd };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

export { PIXEL };
