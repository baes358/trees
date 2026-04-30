import p5 from "p5";
import { fetchTrees, randomOffset } from "./data.js";
import { buildTreeForm, drawTreePoints, generateTreePoints } from "./tree.js";

const statusEl = document.getElementById("status");
const reseedBtn = document.getElementById("reseed");
const boroughEl = document.getElementById("borough");
const tooltipEl = document.getElementById("tooltip");

const TREE_COUNT = 280;
const GROWTH_DURATION_MS = 5500;
const STAGGER_MS = 6000;

const state = {
  trees: [],
  placed: [],
  loading: false,
  borough: "",
  hover: null,
  startTime: 0,
};

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
    setStatus(`${trees.length} trees · ${state.borough || "all boroughs"}`);
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

function placeForest(p) {
  const w = p.width;
  const h = p.height;
  const horizon = h * 0.28;
  const groundDepth = h - horizon;

  state.placed = state.trees.map((tree, i) => {
    const form = buildTreeForm(tree);
    const points = generateTreePoints(tree, form);
    const r = pseudoRand((Number(tree.id) || i) * 3.71);
    const r2 = pseudoRand((Number(tree.id) || i) * 7.13 + 1);
    const depthT = r;
    const y = horizon + Math.pow(depthT, 1.5) * groundDepth;
    const x = r2 * w;
    const scale = 0.32 + 0.95 * Math.pow(depthT, 1.05);
    const startDelay = pseudoRand((Number(tree.id) || i) * 1.91 + 5) * STAGGER_MS;
    return { tree, form, points, x, y, scale, z: y, startDelay };
  });

  state.placed.sort((a, b) => a.z - b.z);
  state.startTime = performance.now();
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
    bgLayer = makeBackground(p);
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
    if (Math.abs(p.width - lastWidth) > 4) {
      bgLayer = makeBackground(p);
      placeForest(p);
      lastWidth = p.width;
    }
  };

  p.draw = () => {
    if (bgLayer) p.image(bgLayer, 0, 0);

    if (!state.placed.length) {
      drawIdleHint(p);
      return;
    }

    const now = performance.now();
    for (const item of state.placed) {
      const elapsed = now - state.startTime - item.startDelay;
      const growth = p.constrain(elapsed / GROWTH_DURATION_MS, 0, 1);
      if (growth <= 0) continue;
      p.push();
      p.translate(item.x, item.y);
      drawTreePoints(p, item.points, item.form, growth, item.scale);
      p.pop();
    }
  };

  p.mouseMoved = () => {
    const hit = pickTree(p.mouseX, p.mouseY);
    if (hit !== state.hover) {
      state.hover = hit;
      updateTooltip(hit, p.mouseX, p.mouseY);
    } else if (hit) {
      moveTooltip(p.mouseX, p.mouseY);
    }
  };

  p.refresh = () => {
    placeForest(p);
  };
};

function makeBackground(p) {
  const g = p.createGraphics(p.width, p.height);
  g.colorMode(p.HSB, 360, 100, 100, 100);
  g.noStroke();
  const top = g.color(220, 30, 6);
  const horizon = g.color(180, 28, 14);
  const ground = g.color(140, 18, 4);
  const horizonY = p.height * 0.28;

  for (let y = 0; y < horizonY; y++) {
    const t = y / horizonY;
    const c = g.lerpColor(top, horizon, Math.pow(t, 0.8));
    g.stroke(c);
    g.line(0, y, p.width, y);
  }
  for (let y = horizonY; y < p.height; y++) {
    const t = (y - horizonY) / (p.height - horizonY);
    const c = g.lerpColor(horizon, ground, Math.pow(t, 0.7));
    g.stroke(c);
    g.line(0, y, p.width, y);
  }

  g.noStroke();
  for (let i = 0; i < 240; i++) {
    const y = horizonY + Math.random() * (p.height - horizonY);
    const t = (y - horizonY) / (p.height - horizonY);
    const x = Math.random() * p.width;
    g.fill(150, 12, 8 + t * 10, 30);
    g.rect(x, y, 2, 2);
  }

  return g;
}

function pickTree(mx, my) {
  let best = null;
  let bestDist = 36;
  for (let i = state.placed.length - 1; i >= 0; i--) {
    const it = state.placed[i];
    const dx = mx - it.x;
    const dy = my - (it.y - it.form.baseLength * it.scale * 0.5);
    const d = Math.sqrt(dx * dx + dy * dy) / it.scale;
    if (d < bestDist) {
      bestDist = d;
      best = it;
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

boroughEl.addEventListener("change", async (e) => {
  state.borough = e.target.value;
  await loadForest();
  instance.refresh();
});

(async () => {
  await loadForest();
  instance.refresh();
})();
