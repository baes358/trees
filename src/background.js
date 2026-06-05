// Animated GLSL gradient background. Rendered into a WEBGL p5.Graphics layer
// each frame and blitted onto the main 2D canvas, so the tree rendering stays
// pure 2D. Falls back to a CPU-drawn gradient if the shader can't compile.

// Pass-through vertex shader. Maps the unit-quad p5 emits for rect() straight
// to clip space so the fragment shader runs across the whole viewport; all the
// actual shaping happens from gl_FragCoord in the fragment stage.
const BG_VERT = `
precision highp float;
attribute vec3 aPosition;
void main() {
  vec4 pos = vec4(aPosition, 1.0);
  pos.xy = pos.xy * 2.0 - 1.0;
  gl_Position = pos;
}
`;

const BG_FRAG = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// value noise for slow organic drift
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy; // y = 0 at bottom (ground)

  // Cool night palette: near-black sky up top, faint teal toward the horizon
  // where the tree base sits, so the trees and orbs stay legible.
  vec3 sky     = vec3(0.030, 0.041, 0.068);
  vec3 mid     = vec3(0.040, 0.058, 0.074);
  vec3 horizon = vec3(0.034, 0.072, 0.062);
  vec3 ground  = vec3(0.018, 0.033, 0.026);

  float y = uv.y;
  vec3 col = mix(ground, horizon, smoothstep(0.0, 0.20, y));
  col = mix(col, mid, smoothstep(0.14, 0.62, y));
  col = mix(col, sky, smoothstep(0.5, 1.0, y));

  // Slow flowing modulation so the gradient breathes instead of sitting still.
  float t = u_time * 0.045;
  float flow = noise(vec2(uv.x * 2.2 + t, uv.y * 2.0 - t * 0.5));
  float flow2 = noise(vec2(uv.x * 4.5 - t * 0.7, uv.y * 3.4 + t));
  vec3 tint = vec3(0.0, 0.055, 0.05);
  col += tint * ((flow * 0.6 + flow2 * 0.4) - 0.4) * smoothstep(0.0, 0.75, y);

  // Soft glow rising from the bottom-center, where the trunk anchors.
  vec2 gp = vec2(uv.x - 0.5, uv.y - 0.12);
  float glow = exp(-dot(gp, gp) * 6.5);
  col += vec3(0.035, 0.085, 0.075) * glow * (0.65 + 0.35 * sin(u_time * 0.25));

  // Gentle vignette to settle the edges.
  float vig = smoothstep(1.25, 0.35, length(uv - 0.5));
  col *= 0.86 + 0.14 * vig;

  // Ordered-ish dither to kill 8-bit banding on the smooth gradient.
  col += (hash(gl_FragCoord.xy + u_time) - 0.5) / 255.0;

  gl_FragColor = vec4(col, 1.0);
}
`;

function makeCpuBackground(p) {
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

// Returns a background controller with a render(p, timeMs) method. Internally
// prefers the GLSL shader; on any compile/runtime failure it transparently
// drops to the CPU gradient for the rest of the session.
// The gradient is smooth and drifts slowly, so it costs nothing visually to
// render it at half resolution (a quarter of the fragments) and to refresh the
// shader only a few times a second, blitting the cached layer in between. This
// turns a full-res per-frame full-screen shader — the single heaviest GPU cost
// — into a cheap stretched blit on most frames.
const BG_SCALE = 0.5;
const BG_REFRESH_MS = 1000 / 24;

export function createBackground(p) {
  let layer = null;
  let shader = null;
  let cpu = null;
  let lastRender = -1e9;

  const lw = Math.max(1, Math.round(p.width * BG_SCALE));
  const lh = Math.max(1, Math.round(p.height * BG_SCALE));

  try {
    layer = p.createGraphics(lw, lh, p.WEBGL);
    // The layer is already downscaled; don't let it re-expand on hi-DPI.
    layer.pixelDensity(1);
    shader = layer.createShader(BG_VERT, BG_FRAG);
  } catch (err) {
    console.warn("background shader unavailable, using CPU gradient", err);
    layer = null;
    shader = null;
    cpu = makeCpuBackground(p);
  }

  return {
    render(pp, timeMs) {
      if (layer && shader) {
        try {
          // Re-run the shader only every BG_REFRESH_MS; otherwise reuse the
          // layer's last frame. The blit below still happens every frame.
          if (timeMs - lastRender >= BG_REFRESH_MS) {
            layer.shader(shader);
            shader.setUniform("u_resolution", [layer.width, layer.height]);
            shader.setUniform("u_time", timeMs * 0.001);
            layer.noStroke();
            layer.rect(0, 0, layer.width, layer.height);
            lastRender = timeMs;
          }
          pp.image(layer, 0, 0, pp.width, pp.height);
          return;
        } catch (err) {
          console.warn("background shader render failed, falling back", err);
          layer = null;
          shader = null;
          cpu = makeCpuBackground(pp);
        }
      }
      if (cpu) pp.image(cpu, 0, 0, pp.width, pp.height);
    },
  };
}
