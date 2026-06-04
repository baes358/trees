// Particle "planting the seeds" loader. Draws a miniature growing sprout as a
// cloud of fine dots — a seed falls, bursts into a soil puff, then a stem rises
// and branches into small colored orb-tips — echoing the tree's point-cloud look.

const CYCLE = 3600;
const TIP_HUES = [150, 95, 55, 285, 200]; // green, lime, gold, violet, teal — echo the orbs
const STEM = { h: 165, s: 12, l: 66 };
const SOIL = { h: 32, s: 45, l: 46 };
const SEED = { h: 45, s: 70, l: 58 };

const rand = (a = 1) => Math.random() * a;

function buildSprout() {
  const pts = [];
  const baseY = 0.9;
  const topY = 0.42;
  const cx = 0.5;

  // Central stem as a rising dotted trail.
  const stemN = 44;
  const curve = (rand() - 0.5) * 0.04;
  for (let i = 1; i <= stemN; i++) {
    const t = i / stemN;
    const y = baseY - (baseY - topY) * t;
    const x = cx + Math.sin(t * Math.PI) * curve;
    pts.push({ x, y, ord: t * 0.6, ...STEM, r: 1.5, tip: false, ph: rand(Math.PI * 2) });
  }

  // Branch sprays, each a short curved dotted arc ending in a colored orb.
  const branch = (side, startT, lift, reach) => {
    const sy = baseY - (baseY - topY) * startT;
    const n = 14;
    const hue = TIP_HUES[(rand() * TIP_HUES.length) | 0];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = cx + side * Math.sin(t * 1.5) * reach;
      const y = sy - Math.sin(t * 1.3) * lift;
      const isTip = i >= n - 2;
      pts.push({
        x,
        y,
        ord: startT * 0.6 + t * 0.34,
        h: isTip ? hue : STEM.h,
        s: isTip ? 62 : STEM.s,
        l: isTip ? 66 : STEM.l,
        r: isTip ? 2.3 : 1.4,
        tip: isTip,
        ph: rand(Math.PI * 2),
      });
    }
  };
  branch(-1, 0.58, 0.22, 0.17);
  branch(1, 0.66, 0.24, 0.19);
  branch(-1, 0.76, 0.17, 0.11);
  branch(1, 0.83, 0.15, 0.1);

  // A small crown of scattered orb-tips at the top.
  for (let i = 0; i < 9; i++) {
    const a = rand(Math.PI * 2);
    const rr = rand(0.075);
    pts.push({
      x: cx + Math.cos(a) * rr,
      y: topY + Math.sin(a) * rr * 0.8,
      ord: 0.9 + rand(0.1),
      h: TIP_HUES[(rand() * TIP_HUES.length) | 0],
      s: 64,
      l: 68,
      r: 2.2,
      tip: true,
      ph: rand(Math.PI * 2),
    });
  }

  // Soil dots that flick in when the seed lands.
  const soil = [];
  for (let i = 0; i < 22; i++) {
    const a = rand(Math.PI * 2);
    const sp = 0.06 + rand(0.16);
    soil.push({ vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp * 0.9 - 0.04, ...SOIL });
  }

  return { pts, soil, baseY, topY, cx };
}

export function startSeedLoader(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 0;
  let H = 0;
  let S = 0;
  let ox = 0;
  let oy = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width || 180;
    H = r.height || 180;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.min(W, H);
    ox = (W - S) / 2;
    oy = (H - S) / 2;
  }
  resize();
  window.addEventListener("resize", resize);

  const sprout = buildSprout();
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PX = (x) => ox + x * S;
  const PY = (y) => oy + y * S;

  function dot(x, y, radius, h, s, l, a) {
    ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function frame(now) {
    if (!running) return;
    const prog = reduce ? 0.85 : ((now % CYCLE) / CYCLE);
    ctx.clearRect(0, 0, W, H);

    const globalA = prog > 0.9 ? 1 - (prog - 0.9) / 0.1 : 1;
    const landT = 0.16;

    // Seed fall.
    if (prog < landT + 0.02) {
      const ft = Math.min(1, prog / landT);
      const y = -0.06 + (sprout.baseY + 0.06) * (ft * ft * (3 - 2 * ft));
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * Math.PI * 2;
        dot(PX(sprout.cx) + Math.cos(ang) * 2.2, PY(y) + Math.sin(ang) * 2.6, 2, SEED.h, SEED.s, SEED.l, globalA);
      }
    }

    // Soil burst.
    if (prog >= landT && prog < 0.34) {
      const tp = (prog - landT) / 0.18;
      const fade = 1 - tp;
      for (const s of sprout.soil) {
        const x = sprout.cx + s.vx * tp;
        const y = sprout.baseY + (s.vy * tp + 0.5 * 0.9 * tp * tp);
        dot(PX(x), PY(y), 1.4, s.h, s.s, s.l, fade * globalA);
      }
    }

    // Sprout growth — reveal dots as the front sweeps up.
    const front = Math.max(0, Math.min(1, (prog - 0.22) / 0.56));
    for (const p of sprout.pts) {
      const reveal = (front - p.ord) / 0.07;
      if (reveal <= 0) continue;
      const a = Math.min(1, reveal) * globalA;
      const sway = reduce ? 0 : Math.sin(now * 0.0014 + p.ph) * 1.1 * p.ord;
      const x = PX(p.x) + sway;
      const y = PY(p.y);
      if (p.tip) {
        const pulse = 0.85 + 0.15 * Math.sin(now * 0.004 + p.ph);
        dot(x, y, p.r * 2.6, p.h, p.s, p.l, 0.14 * a); // halo
        dot(x, y, p.r, p.h, p.s, Math.min(82, p.l + 8), a * pulse);
      } else {
        dot(x, y, p.r, p.h, p.s, p.l, a * 0.92);
      }
    }

    raf = requestAnimationFrame(frame);
  }

  let raf = requestAnimationFrame(frame);
  let running = true;

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
