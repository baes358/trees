import p5 from "p5";
import { fetchTrees, randomOffset } from "./data.js";
import { generateSkeleton, PIXEL } from "./skeleton.js";
import { orbPalette, BRANCH_COLOR, BRANCH_HALO } from "./palette.js";

const statusEl = document.getElementById("status");
const reseedBtn = document.getElementById("reseed");
const newShapeBtn = document.getElementById("new-shape");
const resetViewBtn = document.getElementById("reset-view");
const boroughEl = document.getElementById("borough");
const tooltipEl = document.getElementById("tooltip");

const TREE_COUNT = 500;
const GROWTH_DURATION_MS = 6500;
const FRONT_WINDOW = 60;
const HOVER_RADIUS = 180;
const HOVER_PUSH = 5;
const SWAY_AMP = 1.2;

const BEND_MIN = 0.25;
const BEND_MAX = 1.7;
const BEND_EASE = 0.12;
const REGEN_THRESHOLD = 0.004;

const state = {
  trees: [],
  orbs: [],
  skeleton: null,
  skeletonSeed: 13,
  loading: false,
  borough: "",
  hover: null,
  startTime: 0,
  cursorX: -1e6,
  cursorY: -1e6,
  cursorActive: false,
  camera: { rotX: 0, rotY: 0, zoom: 1, panX: 0, panY: 0 },
  bendScale: 1.0,
  bendRegen: 1.0,
  keys: { left: false, right: false },
  drag: { active: false, moved: false, lastX: 0, lastY: 0 },
};

const FOCAL = 1100;
const ROT_PER_PIXEL = 0.005;
const TILT_LIMIT = Math.PI / 3;

function frameTrig(cam) {
  return {
    cosY: Math.cos(cam.rotY),
    sinY: Math.sin(cam.rotY),
    cosX: Math.cos(cam.rotX),
    sinX: Math.sin(cam.rotX),
  };
}

function project(x, y, z, trig, baseX, baseY, cam) {
  const dx = x - baseX;
  const dy = y - baseY;
  const x1 = dx * trig.cosY - z * trig.sinY;
  const z1 = dx * trig.sinY + z * trig.cosY;
  const y2 = dy * trig.cosX - z1 * trig.sinX;
  const z2 = dy * trig.sinX + z1 * trig.cosX;
  const persp = FOCAL / (FOCAL - z2);
  const s = persp * cam.zoom;
  return {
    sx: baseX + x1 * s + cam.panX,
    sy: baseY + y2 * s + cam.panY,
    z: z2,
    scale: s,
  };
}

async function loadForest() {
  if (state.loading) return;
  state.loading = true;
  setStatus("fetching trees…");
  try {
    let trees = await fetchTrees({
      limit: TREE_COUNT,
      offset: randomOffset(),
      borough: state.borough,
    });
    if (trees.length < 50) {
      trees = await fetchTrees({ limit: TREE_COUNT, offset: 0, borough: state.borough });
    }
    state.trees = trees;
    setStatus(`${trees.length} TREES · ${state.borough || "ALL BOROUGHS"}`);
  } catch (err) {
    console.error(err);
    setStatus(`error: ${err.message}`);
  } finally {
    state.loading = false;
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function placeOrbs() {
  const sk = state.skeleton;
  if (!sk || !state.trees.length) {
    state.orbs = [];
    return;
  }
  const orbs = [];
  for (let i = 0; i < state.trees.length; i++) {
    const tree = state.trees[i];
    const dbh = Math.max(1, tree.dbh || 4);
    const sizeT = Math.min(1, Math.log10(dbh + 1) / 1.6);
    orbs.push({
      tree,
      x: 0,
      y: 0,
      z: 0,
      ord: 0,
      sizeT,
      palette: orbPalette(tree),
    });
  }
  state.orbs = orbs;
  syncOrbsToCandidates();
  state.startTime = performance.now();
}

function syncOrbsToCandidates() {
  const sk = state.skeleton;
  if (!sk || !state.orbs.length) return;
  const candidates = sk.candidates;
  for (let i = 0; i < state.orbs.length; i++) {
    const orb = state.orbs[i];
    const cand = candidates[i % candidates.length];
    const id = Number(orb.tree.id) || i;
    const jx = (pseudoRand(id * 1.7) - 0.5) * 8;
    const jy = (pseudoRand(id * 2.3 + 1) - 0.5) * 8;
    const jz = (pseudoRand(id * 4.1 + 2) - 0.5) * 8;
    orb.x = Math.round((cand.x + jx) / PIXEL) * PIXEL;
    orb.y = Math.round((cand.y + jy) / PIXEL) * PIXEL;
    orb.z = Math.round(((cand.z || 0) + jz) / PIXEL) * PIXEL;
    orb.ord = cand.ord;
  }
}

function pseudoRand(seed) {
  const n = Number(seed) || 1;
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const sketch = (p) => {
  let bgLayer;
  let lastWidth = 0;

  p.setup = () => {
    const host = document.getElementById("canvas-host");
    const c = p.createCanvas(window.innerWidth, window.innerHeight);
    c.parent(host);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.pixelDensity(1);
    p.frameRate(45);
    lastWidth = p.width;
    rebuildLayers(p);
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    if (Math.abs(p.width - lastWidth) > 4) {
      rebuildLayers(p);
      placeOrbs();
      lastWidth = p.width;
    }
  };

  p.draw = () => {
    if (bgLayer) p.image(bgLayer, 0, 0);

    if (!state.skeleton || !state.orbs.length) {
      drawIdleHint(p);
      return;
    }

    let bendTarget = state.bendScale;
    if (state.keys.left && !state.keys.right) bendTarget = BEND_MIN;
    else if (state.keys.right && !state.keys.left) bendTarget = BEND_MAX;
    state.bendScale += (bendTarget - state.bendScale) * BEND_EASE;
    if (Math.abs(state.bendScale - state.bendRegen) > REGEN_THRESHOLD) {
      state.skeleton = generateSkeleton({
        width: p.width,
        height: p.height,
        seed: state.skeletonSeed,
        bendScale: state.bendScale,
      });
      syncOrbsToCandidates();
      state.bendRegen = state.bendScale;
    }

    const now = performance.now();
    const elapsed = now - state.startTime;
    const progress = p.constrain(elapsed / GROWTH_DURATION_MS, 0, 1);
    const front = progress * state.skeleton.maxOrd;
    const trig = frameTrig(state.camera);
    const sk = state.skeleton;

    drawBranchFront(p, sk.branchPoints, front, sk.maxOrd, now, trig, sk);
    drawOrbsFront(p, state.orbs, front, sk.maxOrd, now, trig, sk);
  };

  p.mouseMoved = () => {
    state.cursorX = p.mouseX;
    state.cursorY = p.mouseY;
    state.cursorActive = true;
    const hit = pickOrb(p.mouseX, p.mouseY);
    if (hit !== state.hover) {
      state.hover = hit;
      updateTooltip(hit, p.mouseX, p.mouseY);
    } else if (hit) {
      moveTooltip(p.mouseX, p.mouseY);
    }
  };

  p.mousePressed = () => {
    if (p.mouseX < 0 || p.mouseY < 0 || p.mouseX > p.width || p.mouseY > p.height) return;
    state.drag.active = true;
    state.drag.moved = false;
    state.drag.lastX = p.mouseX;
    state.drag.lastY = p.mouseY;
    state.hover = null;
    tooltipEl.hidden = true;
  };

  p.mouseDragged = () => {
    if (state.drag.active) {
      const dx = p.mouseX - state.drag.lastX;
      const dy = p.mouseY - state.drag.lastY;
      state.drag.lastX = p.mouseX;
      state.drag.lastY = p.mouseY;
      if (dx || dy) {
        state.camera.panX += dx;
        state.camera.panY += dy;
        state.drag.moved = true;
      }
      state.cursorActive = false;
      return;
    }
    state.cursorX = p.mouseX;
    state.cursorY = p.mouseY;
    state.cursorActive = true;
  };

  p.mouseReleased = () => {
    state.drag.active = false;
  };

  p.refresh = () => {
    placeOrbs();
  };

  function rebuildLayers(p) {
    bgLayer = makeBackground(p);
    state.skeleton = generateSkeleton({
      width: p.width,
      height: p.height,
      seed: state.skeletonSeed,
      bendScale: state.bendScale,
    });
    state.bendRegen = state.bendScale;
  }

  p.regenerateShape = () => {
    state.skeletonSeed = Math.floor(Math.random() * 100000);
    state.skeleton = generateSkeleton({
      width: p.width,
      height: p.height,
      seed: state.skeletonSeed,
      bendScale: state.bendScale,
    });
    state.bendRegen = state.bendScale;
    placeOrbs();
  };
};

function worldSway(x, y, ord, maxOrd, time) {
  const swayScale = ord / maxOrd;
  const seed = ((x | 0) * 73856093) ^ ((y | 0) * 19349663);
  const phase = ((seed >>> 0) % 1000) / 1000 * Math.PI * 2;
  const dx = Math.sin(time * 0.0011 + phase) * SWAY_AMP * swayScale;
  const dy = Math.cos(time * 0.0009 + phase * 1.3) * SWAY_AMP * 0.7 * swayScale;
  return { dx, dy };
}

function cursorPushScreen(sx, sy, swayScale) {
  if (!state.cursorActive) return { dx: 0, dy: 0 };
  const mdx = sx - state.cursorX;
  const mdy = sy - state.cursorY;
  const md2 = mdx * mdx + mdy * mdy;
  if (md2 >= HOVER_RADIUS * HOVER_RADIUS || md2 <= 0.5) return { dx: 0, dy: 0 };
  const md = Math.sqrt(md2);
  const force = (1 - md / HOVER_RADIUS) * HOVER_PUSH * (0.35 + 0.65 * swayScale);
  return { dx: (mdx / md) * force, dy: (mdy / md) * force };
}

function drawBranchFront(p, points, front, maxOrd, time, trig, sk) {
  p.noStroke();
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt.ord > front) break;
    const distFromFront = front - pt.ord;
    const isFront = distFromFront < FRONT_WINDOW;

    const sway = worldSway(pt.x, pt.y, pt.ord, maxOrd, time);
    const pr = project(pt.x + sway.dx, pt.y + sway.dy, pt.z || 0, trig, sk.baseX, sk.baseY, state.camera);
    const w = Math.max(1, (pt.w || PIXEL) * pr.scale);

    if (isFront) {
      p.fill(BRANCH_HALO.h, BRANCH_HALO.s, BRANCH_HALO.b, 14);
      p.rect(pr.sx - w, pr.sy - w, w * 3, w * 3);
    }
    p.fill(BRANCH_COLOR.h, BRANCH_COLOR.s, BRANCH_COLOR.b, isFront ? 96 : 72);
    p.rect(pr.sx, pr.sy, w, w);
  }
}

function drawOrbsFront(p, orbs, front, maxOrd, time, trig, sk) {
  p.noStroke();
  for (const orb of orbs) {
    if (orb.ord > front) continue;
    const distFromFront = front - orb.ord;
    const isFront = distFromFront < FRONT_WINDOW;
    const { core, halo } = orb.palette;

    const sway = worldSway(orb.x, orb.y, orb.ord, maxOrd, time);
    const pr = project(orb.x + sway.dx, orb.y + sway.dy, orb.z || 0, trig, sk.baseX, sk.baseY, state.camera);
    const push = cursorPushScreen(pr.sx, pr.sy, orb.ord / maxOrd);
    const x = pr.sx + push.dx;
    const y = pr.sy + push.dy;

    const pulse = 0.92 + 0.08 * Math.sin(time * 0.0016 + orb.x * 0.013);
    const baseAlpha = isFront ? 100 : 90;
    const px = Math.max(1, PIXEL * pr.scale);

    p.fill(halo.h, halo.s, halo.b, isFront ? 22 : 12);
    p.rect(x - px * 2, y - px * 2, px * 5, px * 5);
    p.fill(halo.h, halo.s, halo.b, isFront ? 40 : 22);
    p.rect(x - px, y - px, px * 3, px * 3);

    const coreSize = Math.max(1, (PIXEL + Math.round(orb.sizeT * 2)) * pr.scale);
    p.fill(core.h, core.s, core.b, baseAlpha * pulse);
    p.rect(x, y, coreSize, coreSize);
  }
}

function makeBackground(p) {
  const g = p.createGraphics(p.width, p.height);
  g.colorMode(p.HSB, 360, 100, 100, 100);
  g.noStroke();

  const top = g.color(220, 30, 6);
  const mid = g.color(200, 22, 10);
  const horizon = g.color(160, 18, 8);
  const ground = g.color(140, 14, 4);
  const horizonY = p.height * 0.88;

  for (let y = 0; y < horizonY; y++) {
    const t = y / horizonY;
    const c = g.lerpColor(top, mid, Math.pow(t, 0.7));
    const c2 = t > 0.7 ? g.lerpColor(c, horizon, (t - 0.7) / 0.3) : c;
    g.stroke(c2);
    g.line(0, y, p.width, y);
  }
  for (let y = horizonY; y < p.height; y++) {
    const t = (y - horizonY) / (p.height - horizonY);
    const c = g.lerpColor(horizon, ground, Math.pow(t, 0.6));
    g.stroke(c);
    g.line(0, y, p.width, y);
  }

  g.noStroke();
  for (let i = 0; i < 220; i++) {
    const y = horizonY + Math.random() * (p.height - horizonY);
    const x = Math.random() * p.width;
    g.fill(150, 12, 12, 28);
    g.rect(x, y, 2, 1);
  }

  return g;
}

function pickOrb(mx, my) {
  if (!state.skeleton) return null;
  const trig = frameTrig(state.camera);
  const sk = state.skeleton;
  let best = null;
  let bestDist = 18;
  for (const orb of state.orbs) {
    const pr = project(orb.x, orb.y, orb.z || 0, trig, sk.baseX, sk.baseY, state.camera);
    const dx = mx - pr.sx;
    const dy = my - pr.sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) {
      bestDist = d;
      best = orb;
    }
  }
  return best;
}

function updateTooltip(hit, mx, my) {
  if (!hit) {
    tooltipEl.hidden = true;
    return;
  }
  const t = hit.tree;
  tooltipEl.hidden = false;
  tooltipEl.innerHTML = `
    <strong>${t.species}</strong><br/>
    <span style="font-style:italic;color:var(--muted)">${t.latin || ""}</span>
    <div class="row">dbh <span>${t.dbh}″</span></div>
    <div class="row">health <span>${t.health || "—"}</span></div>
    <div class="row">status <span>${t.status}</span></div>
    <div class="row">borough <span>${t.borough}</span></div>
  `;
  moveTooltip(mx, my);
}

function moveTooltip(mx, my) {
  tooltipEl.style.left = `${mx}px`;
  tooltipEl.style.top = `${my}px`;
}

function drawIdleHint(p) {
  p.fill(40, 6, 60, 60);
  p.noStroke();
  p.textSize(13);
  p.textAlign(p.CENTER, p.CENTER);
  p.text("the forest is empty — try reseed", p.width / 2, p.height / 2);
}

const instance = new p5(sketch);

reseedBtn.addEventListener("click", async () => {
  await loadForest();
  instance.refresh();
});

newShapeBtn.addEventListener("click", () => {
  instance.regenerateShape();
});

boroughEl.addEventListener("change", async (e) => {
  state.borough = e.target.value;
  await loadForest();
  instance.refresh();
});

const canvasHost = document.getElementById("canvas-host");
canvasHost.addEventListener("mouseleave", () => {
  state.cursorActive = false;
  state.hover = null;
  tooltipEl.hidden = true;
});

canvasHost.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.012);
      state.camera.zoom = Math.max(0.25, Math.min(8, state.camera.zoom * factor));
    } else {
      state.camera.rotY += e.deltaX * ROT_PER_PIXEL;
      state.camera.rotX = Math.max(
        -TILT_LIMIT,
        Math.min(TILT_LIMIT, state.camera.rotX + e.deltaY * ROT_PER_PIXEL)
      );
    }
  },
  { passive: false }
);

resetViewBtn.addEventListener("click", () => {
  state.camera.rotX = 0;
  state.camera.rotY = 0;
  state.camera.zoom = 1;
  state.camera.panX = 0;
  state.camera.panY = 0;
});

function isFormFocused() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA";
}

window.addEventListener("keydown", (e) => {
  if (isFormFocused()) return;
  if (e.key === "ArrowLeft") {
    state.keys.left = true;
    e.preventDefault();
  } else if (e.key === "ArrowRight") {
    state.keys.right = true;
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft") state.keys.left = false;
  else if (e.key === "ArrowRight") state.keys.right = false;
});

(async () => {
  await loadForest();
  instance.refresh();
})();
