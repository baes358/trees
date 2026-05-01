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

const PIXEL = 2;

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

export function generateSkeleton({ width, height, seed = 13, bendScale = 1.0 }) {
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
      const px = Math.round(x / PIXEL) * PIXEL;
      const py = Math.round(y / PIXEL) * PIXEL;
      const pz = Math.round(z / PIXEL) * PIXEL;
      candidates.push({ x: px, y: py, z: pz, ord: cumLen, kind: "tip" });
      if (cumLen > maxOrd) maxOrd = cumLen;
      return;
    }

    const segs = Math.max(3, Math.floor(len / 4));
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

      const px = Math.round(cx / PIXEL) * PIXEL;
      const py = Math.round(cy / PIXEL) * PIXEL;
      const pz = Math.round(cz / PIXEL) * PIXEL;
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
      recurse(
        cx,
        cy,
        cz,
        childDir.x,
        childDir.y,
        childDir.z,
        childLen,
        depth - 1,
        cumLen + len,
        childWidth
      );
    }

    if (depth >= 4 && rng() < 0.18) {
      const az = rng() * Math.PI * 2;
      const childDir = tiltDirection(cdx, cdy, cdz, (0.4 + rng() * 0.2) * bendScale, az);
      const childLen = len * 0.55;
      recurse(
        cx,
        cy,
        cz,
        childDir.x,
        childDir.y,
        childDir.z,
        childLen,
        depth - 2,
        cumLen + len * 0.5,
        branchWidth * 0.5
      );
    }
  }

  recurse(baseX, baseY, 0, 0, -1, 0, trunkLen, 8, 0, trunkWidth);

  branchPoints.sort((a, b) => a.ord - b.ord);

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  return { branchPoints, candidates, baseX, baseY, maxOrd };
}

export { PIXEL };
