import { hashSpecies, paletteFor } from "./palette.js";

const PIXEL = 2;

export function buildTreeForm(tree) {
  const speciesSeed = hashSpecies(tree.species);
  const dbh = Math.max(1, tree.dbh || 4);

  const sizeT = Math.min(1, Math.log10(dbh + 1) / 1.6);
  const baseLength = 60 + sizeT * 160;
  const depth = Math.min(6, 3 + Math.floor(sizeT * 3));

  const angle = 12 + speciesSeed * 26;
  const lengthDecay = 0.62 + speciesSeed * 0.14;
  const wobble = 0.18 + speciesSeed * 0.22;
  const branchSplit = 2;

  const palette = paletteFor(tree);
  const tipDensity = palette.dead ? 0 : 0.3 + 0.5 * palette.vigor;
  const tipReach = 2 + sizeT * 3 + speciesSeed * 2;

  return {
    speciesSeed,
    baseLength,
    depth,
    angle,
    lengthDecay,
    wobble,
    branchSplit,
    tipDensity,
    tipReach,
    palette,
    sizeT,
  };
}

export function generateTreePoints(tree, form) {
  const rng = mulberry32((Number(tree.id) || 1) + Math.floor(form.speciesSeed * 1e6));
  const points = [];

  function recurse(x, y, angle, len, depth, cumLen) {
    if (depth <= 0 || len < 2) {
      addTipCluster(points, x, y, form, cumLen, rng);
      return;
    }

    const segs = Math.max(3, Math.floor(len / 4));
    let cx = x;
    let cy = y;
    let ca = angle;
    const sway = form.wobble * (1 - depth / form.depth);

    for (let i = 1; i <= segs; i++) {
      ca += (rng() - 0.5) * sway * 2 / segs;
      cx += Math.sin(ca) * (len / segs);
      cy -= Math.cos(ca) * (len / segs);
      const px = Math.round(cx / PIXEL) * PIXEL;
      const py = Math.round(cy / PIXEL) * PIXEL;
      points.push({
        x: px,
        y: py,
        ord: cumLen + (i / segs) * len,
        kind: "branch",
        depth,
      });
    }

    const splits = form.branchSplit;
    for (let s = 0; s < splits; s++) {
      const t = splits === 1 ? 0 : s / (splits - 1);
      const baseDir = (t - 0.5) * 2;
      const angleVar = form.angle * (0.7 + rng() * 0.5);
      const childAngle = ca + radians(baseDir * angleVar);
      const childLen = len * form.lengthDecay * (0.9 + rng() * 0.2);
      recurse(cx, cy, childAngle, childLen, depth - 1, cumLen + len);
    }

    if (depth > form.depth - 2 && rng() < 0.4) {
      const childAngle = ca + radians((rng() - 0.5) * form.angle * 0.6);
      recurse(cx, cy, childAngle, len * form.lengthDecay * 0.85, depth - 1, cumLen + len);
    }
  }

  recurse(0, 0, 0, form.baseLength, form.depth, 0);
  points.sort((a, b) => a.ord - b.ord);
  return points;
}

function addTipCluster(points, x, y, form, cumLen, rng) {
  if (form.tipDensity <= 0) {
    const px = Math.round(x / PIXEL) * PIXEL;
    const py = Math.round(y / PIXEL) * PIXEL;
    points.push({ x: px, y: py, ord: cumLen, kind: "tip", depth: 0 });
    return;
  }
  const count = Math.max(1, Math.floor(form.tipDensity * (1 + form.sizeT * 2)));
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const r = rng() * form.tipReach;
    const tx = x + Math.cos(angle) * r;
    const ty = y + Math.sin(angle) * r * 0.7;
    const px = Math.round(tx / PIXEL) * PIXEL;
    const py = Math.round(ty / PIXEL) * PIXEL;
    points.push({
      x: px,
      y: py,
      ord: cumLen + r,
      kind: "tip",
      depth: 0,
    });
  }
}

export function drawTreePoints(p, points, form, growth, scale) {
  const reveal = Math.floor(growth * points.length);
  if (reveal <= 0) return;

  const { branch, halo, tip, tipHalo } = form.palette;
  const frontier = Math.max(0, reveal - 6);
  const px = Math.max(1, PIXEL * scale);

  p.noStroke();

  for (let i = 0; i < reveal; i++) {
    const pt = points[i];
    const isFront = i >= frontier;
    const x = pt.x * scale;
    const y = pt.y * scale;

    if (pt.kind === "branch") {
      if (isFront) {
        p.fill(halo.h, halo.s, halo.b, 14);
        p.rect(x - px * 1.5, y - px * 1.5, px * 4, px * 4);
      }
      p.fill(branch.h, branch.s, branch.b, isFront ? 96 : 70);
      p.rect(x, y, px, px);
    } else {
      p.fill(tipHalo.h, tipHalo.s, tipHalo.b, isFront ? 22 : 10);
      p.rect(x - px * 1.5, y - px * 1.5, px * 4, px * 4);
      p.fill(tip.h, tip.s, tip.b, isFront ? 100 : 86);
      p.rect(x, y, px, px);
    }
  }
}

function radians(deg) {
  return (deg * Math.PI) / 180;
}

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
