import p5 from "p5";
import { fetchTrees, randomStartId } from "./data.js";
import { generateSkeleton, randomTreeForm, PIXEL } from "./skeleton.js";
import { orbPalette, boroughColor, BRANCH_COLOR, BRANCH_HALO } from "./palette.js";
import { createBackground } from "./background.js";
import { startSeedLoader } from "./loader.js";

const statusEl = document.getElementById("status");
const reseedBtn = document.getElementById("reseed");
const newShapeBtn = document.getElementById("new-shape");
const resetViewBtn = document.getElementById("reset-view");
const boroughEl = document.getElementById("borough");
const tooltipEl = document.getElementById("tooltip");
const loadingEl = document.getElementById("loading");
const bendEl = document.getElementById("bend");
const treeCountEl = document.getElementById("tree-count");

const TREE_COUNT = 500;
const TREE_COUNT_MIN = 250;
const TREE_COUNT_MAX = 999;
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
  skeletonForm: randomTreeForm(),
  loading: false,
  borough: "",
  hover: null,
  treeCount: TREE_COUNT,
  startTime: 0,
  cursorX: -1e6,
  cursorY: -1e6,
  cursorActive: false,
  front: 0,
  camera: { rotX: 0, rotY: 0, zoom: 1, panX: 0, panY: 0 },
  bendScale: 1.0,
  bendRegen: 1.0,
  bendManualTarget: 1.0,
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
      limit: state.treeCount,
      startId: randomStartId(),
      borough: state.borough,
    });
    if (trees.length < 50) {
      trees = await fetchTrees({ limit: state.treeCount, startId: 0, borough: state.borough });
    }
    state.trees = trees;
    const location = state.borough ? state.borough.toUpperCase() : "NEW YORK CITY";
    // Tint the location to match the borough's tree-particle color. Values come
    // from a fixed select list + generated date, so innerHTML is safe here.
    statusEl.innerHTML =
      `TREES IN <span style="color:${boroughColor(state.borough)}">${location}</span>, ${formatToday()}`;
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

function formatToday() {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

// High-DPI rendering keeps the fine dots crisp, but it quadruples fragment work.
// Above this many trees, fall back to 1× so a dense forest stays smooth.
const HIDPI_TREE_LIMIT = 650;
function densityForCount(count) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return count > HIDPI_TREE_LIMIT ? 1 : dpr;
}

const sketch = (p) => {
  let bg = null;
  let lastWidth = 0;
  let currentDensity = 0;

  p.setup = () => {
    const host = document.getElementById("canvas-host");
    const c = p.createCanvas(window.innerWidth, window.innerHeight);
    c.parent(host);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    currentDensity = densityForCount(state.treeCount);
    p.pixelDensity(currentDensity);
    p.frameRate(45);
    lastWidth = p.width;
    rebuildLayers(p);
  };

  // Re-apply the resolution tier when the tree count changes. Resizing the
  // canvas to its current size forces p5 to rebuild the buffer at the new density.
  p.refreshDensity = () => {
    const d = densityForCount(state.treeCount);
    if (d === currentDensity) return;
    currentDensity = d;
    p.pixelDensity(d);
    p.resizeCanvas(p.width, p.height);
    rebuildLayers(p);
    placeOrbs();
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
    if (bg) bg.render(p, performance.now());

    if (!state.skeleton || !state.orbs.length) {
      drawIdleHint(p);
      return;
    }

    let bendTarget = state.bendManualTarget;
    if (state.keys.left && !state.keys.right) bendTarget = BEND_MIN;
    else if (state.keys.right && !state.keys.left) bendTarget = BEND_MAX;
    state.bendScale += (bendTarget - state.bendScale) * BEND_EASE;
    if (Math.abs(state.bendScale - state.bendRegen) > REGEN_THRESHOLD) {
      state.skeleton = generateSkeleton({
        width: p.width,
        height: p.height,
        seed: state.skeletonSeed,
        bendScale: state.bendScale,
        form: state.skeletonForm,
      });
      syncOrbsToCandidates();
      state.bendRegen = state.bendScale;
    }

    const now = performance.now();
    const elapsed = now - state.startTime;
    const progress = p.constrain(elapsed / GROWTH_DURATION_MS, 0, 1);
    const front = progress * state.skeleton.maxOrd;
    state.front = front;
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

  p.mousePressed = (event) => {
    if (event && event.target && event.target.tagName !== "CANVAS") return;
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

  // Block default browser touch behavior only on the canvas;
  // returning false everywhere swallows synthetic clicks on HUD buttons/slider.
  const isCanvasTouch = (event) =>
    event && event.target && event.target.tagName === "CANVAS";
  p.touchStarted = (event) => (isCanvasTouch(event) ? false : undefined);
  p.touchMoved = (event) => (isCanvasTouch(event) ? false : undefined);
  p.touchEnded = (event) => (isCanvasTouch(event) ? false : undefined);

  p.refresh = () => {
    placeOrbs();
  };

  function rebuildLayers(p) {
    bg = createBackground(p);
    state.skeleton = generateSkeleton({
      width: p.width,
      height: p.height,
      seed: state.skeletonSeed,
      bendScale: state.bendScale,
      form: state.skeletonForm,
    });
    state.bendRegen = state.bendScale;
  }

  p.regenerateShape = (form) => {
    state.skeletonSeed = Math.floor(Math.random() * 100000);
    state.skeletonForm = form || randomTreeForm();
    state.skeleton = generateSkeleton({
      width: p.width,
      height: p.height,
      seed: state.skeletonSeed,
      bendScale: state.bendScale,
      form: state.skeletonForm,
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
    // Thin, clamped dots: even the trunk reads as a fine dotted line.
    const w = Math.max(0.7, Math.min(2.4, (pt.w || PIXEL) * pr.scale * 0.5));

    if (isFront) {
      p.fill(BRANCH_HALO.h, BRANCH_HALO.s, BRANCH_HALO.b, 10);
      p.circle(pr.sx, pr.sy, w * 3);
    }
    p.fill(BRANCH_COLOR.h, BRANCH_COLOR.s, BRANCH_COLOR.b, isFront ? 94 : 66);
    p.circle(pr.sx, pr.sy, w);
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
    const baseAlpha = isFront ? 100 : 88;
    const coreSize = Math.max(1.1, (1.4 + orb.sizeT * 1.8) * pr.scale);

    // One soft halo + a crisp small core — clean point of light, not a blob.
    p.fill(halo.h, halo.s, halo.b, isFront ? 18 : 9);
    p.circle(x, y, coreSize * 3.2);
    p.fill(core.h, core.s, core.b, baseAlpha * pulse);
    p.circle(x, y, coreSize);
  }
}

function pickOrb(mx, my) {
  if (!state.skeleton) return null;
  const trig = frameTrig(state.camera);
  const sk = state.skeleton;
  let best = null;
  let bestDist = 18;
  for (const orb of state.orbs) {
    // Only orbs the growth front has already revealed are pickable, so the
    // tooltip never appears for an orb that isn't drawn yet.
    if (orb.ord > state.front) continue;
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
  p.text("watering...", p.width / 2, p.height / 2);
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

const touchState = {
  mode: null, // 'one' | 'gesture' | null
  pointers: new Map(),
  lastDist: 0,
  lastCx: 0,
  lastCy: 0,
  tapStart: 0,
  tapX: 0,
  tapY: 0,
  tapMoved: false,
};

function localTouchPoint(touch) {
  const rect = canvasHost.getBoundingClientRect();
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

function recomputeGesture() {
  const pts = [...touchState.pointers.values()];
  if (pts.length < 2) return;
  const dx = pts[0].x - pts[1].x;
  const dy = pts[0].y - pts[1].y;
  touchState.lastDist = Math.hypot(dx, dy);
  touchState.lastCx = (pts[0].x + pts[1].x) / 2;
  touchState.lastCy = (pts[0].y + pts[1].y) / 2;
}

canvasHost.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      touchState.pointers.set(t.identifier, localTouchPoint(t));
    }
    const n = touchState.pointers.size;
    if (n === 1) {
      const [p] = touchState.pointers.values();
      touchState.mode = "one";
      touchState.tapStart = performance.now();
      touchState.tapX = p.x;
      touchState.tapY = p.y;
      touchState.tapMoved = false;
      state.hover = null;
      tooltipEl.hidden = true;
    } else if (n >= 2) {
      touchState.mode = "gesture";
      recomputeGesture();
      touchState.tapMoved = true;
    }
  },
  { passive: false }
);

canvasHost.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (!touchState.pointers.has(t.identifier)) continue;
      const prev = touchState.pointers.get(t.identifier);
      const cur = localTouchPoint(t);
      if (touchState.mode === "one") {
        state.camera.panX += cur.x - prev.x;
        state.camera.panY += cur.y - prev.y;
        if (Math.hypot(cur.x - touchState.tapX, cur.y - touchState.tapY) > 10) {
          touchState.tapMoved = true;
        }
      }
      touchState.pointers.set(t.identifier, cur);
    }
    if (touchState.mode === "gesture") {
      const pts = [...touchState.pointers.values()];
      if (pts.length >= 2) {
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy);
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        if (touchState.lastDist > 0) {
          const factor = dist / touchState.lastDist;
          state.camera.zoom = Math.max(0.25, Math.min(8, state.camera.zoom * factor));
        }
        const ddx = cx - touchState.lastCx;
        const ddy = cy - touchState.lastCy;
        state.camera.rotY += ddx * ROT_PER_PIXEL * 0.6;
        state.camera.rotX = Math.max(
          -TILT_LIMIT,
          Math.min(TILT_LIMIT, state.camera.rotX + ddy * ROT_PER_PIXEL * 0.6)
        );
        touchState.lastDist = dist;
        touchState.lastCx = cx;
        touchState.lastCy = cy;
      }
    }
  },
  { passive: false }
);

function endTouch(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    touchState.pointers.delete(t.identifier);
  }
  const remaining = touchState.pointers.size;
  if (remaining === 0) {
    if (touchState.mode === "one" && !touchState.tapMoved) {
      const dt = performance.now() - touchState.tapStart;
      if (dt < 300) {
        const hit = pickOrb(touchState.tapX, touchState.tapY);
        state.hover = hit;
        if (hit) {
          updateTooltip(hit, touchState.tapX, touchState.tapY);
          const tappedHit = hit;
          setTimeout(() => {
            if (state.hover === tappedHit) {
              state.hover = null;
              tooltipEl.hidden = true;
            }
          }, 4000);
        } else {
          tooltipEl.hidden = true;
        }
      }
    }
    touchState.mode = null;
  } else if (remaining === 1) {
    touchState.mode = "one";
    touchState.tapMoved = true;
  } else {
    recomputeGesture();
  }
}

canvasHost.addEventListener("touchend", endTouch, { passive: false });
canvasHost.addEventListener("touchcancel", endTouch, { passive: false });

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
  if (!state.keys.left && !state.keys.right) {
    state.bendManualTarget = state.bendScale;
    if (bendEl) bendEl.value = String(state.bendScale);
  }
});

if (bendEl) {
  bendEl.addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    state.bendManualTarget = v;
  });
}

if (treeCountEl) {
  treeCountEl.min = String(TREE_COUNT_MIN);
  treeCountEl.max = String(TREE_COUNT_MAX);
  treeCountEl.value = String(state.treeCount);

  // Commit on change/blur (not every keystroke) so a refetch only fires once
  // the user has settled on a value. Clamp to the allowed range first.
  const commitCount = async () => {
    const raw = parseInt(treeCountEl.value, 10);
    const clamped = Number.isFinite(raw)
      ? Math.max(TREE_COUNT_MIN, Math.min(TREE_COUNT_MAX, raw))
      : state.treeCount;
    treeCountEl.value = String(clamped);
    if (clamped === state.treeCount) return;
    state.treeCount = clamped;
    instance.refreshDensity(); // step resolution up/down for the new load
    await loadForest();
    instance.refresh();
  };

  treeCountEl.addEventListener("change", commitCount);
  treeCountEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") treeCountEl.blur();
  });
}

const stopSeedLoader = startSeedLoader(document.querySelector(".seed-canvas"));

function hideLoading() {
  if (!loadingEl || loadingEl.classList.contains("hidden")) return;
  loadingEl.classList.add("hidden");
  setTimeout(() => {
    stopSeedLoader();
    loadingEl.remove();
  }, 800);
}

const loadingFallback = setTimeout(hideLoading, 15000);

(async () => {
  try {
    await loadForest();
    instance.refresh();
  } catch (err) {
    console.error("initial load failed", err);
  } finally {
    clearTimeout(loadingFallback);
    hideLoading();
  }
})();
