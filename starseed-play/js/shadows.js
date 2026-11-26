// Stylized prop shadows on the floor (see SHADOWS in config), two kinds:
//  - contact: a short, soft, dark pool hugging each prop where it touches the floor;
//  - cast:    the longer shadow: the silhouette laid flat on the floor, fading with height, blurred and
//             stepped into bands.
// The props and the telescope each get their own contact + cast layer, so they're tuned separately
// (layers 'contact' / 'cast' and 'scopeContact' / 'scopeCast').
// Both run along the floor tiles: away from the tiles' vanishing point (SHADOWS.vanish), so props on the
// left throw their shadows down-left, props on the right down-right, props in the middle towards the camera.
// Built on the CPU at 1/4 resolution. For each caster column, the lowest opaque pixel is where it stands.
import * as THREE from 'three';
import { ART_H, ART_W, SHADOWS } from './config.js';
import { makeTexture } from './core.js';
import { enableRowScroll, layerAttach, layers, stackImages } from './layers.js';

const S = 4;                            // shadow map = artwork / 4
const W = ART_W / S, H = ART_H / S;
// name: SHADOWS key (its settings), kind: contact or cast, set: which casters, order: render order.
const LAYERS = [
  { name: 'cast', kind: 'cast', set: 'props', order: 5.01 },
  { name: 'contact', kind: 'contact', set: 'props', order: 5.012 },
  { name: 'scopeCast', kind: 'cast', set: 'scope', order: 5.014 },
  { name: 'scopeContact', kind: 'contact', set: 'scope', order: 5.016 },
];
// sets: { casters: alpha maps, bases: lowest opaque row per column } per caster set; plus one entry per layer.
const shadow = { sets: {}, floor: null };

function alphaOf(img) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, a = new Float32Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  return a;
}

// Separable box blur, applied twice (close to a soft Gaussian).
function blur(src, r) {
  if (r < 1) return src;
  let a = src, b = new Float32Array(a.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[y * W + x] = s / (2 * r + 1);
        s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)];
      }
    }
    [a, b] = [b, a];
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += a[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        b[y * W + x] = s / (2 * r + 1);
        s += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x];
      }
    }
    [a, b] = [b, a];
  }
  return a;
}

// Lowest opaque row per column of each caster (-1 = empty column).
function findBases(casters) {
  return casters.map(a => {
    const base = new Int32Array(W).fill(-1);
    for (let x = 0; x < W; x++) for (let y = H - 1; y >= 0; y--) if (a[y * W + x] > 0.5) { base[x] = y; break; }
    return base;
  });
}

// Unit direction along the floor tiles at a shadow-map point: away from the vanishing point.
function tileDir(x, y) {
  const dx = x - SHADOWS.vanish[0] / S, dy = Math.max(1, y - SHADOWS.vanish[1] / S), l = Math.hypot(dx, dy);
  return [dx / l, dy / l];
}

// Contact: from `inset` above the base (hidden behind the prop) to `size` in front of it along the tiles, fading out.
function contactMap(c, set) {
  const map = new Float32Array(W * H);
  const inset = Math.round(SHADOWS.inset / S), size = Math.max(1, c.size / S);
  set.casters.forEach((a, n) => {
    const base = set.bases[n];
    for (let x = 0; x < W; x++) {
      const b = base[x];
      if (b < 0) continue;
      const al = a[b * W + x], [ux, uy] = tileDir(x, b), slope = ux / uy;
      const wide = Math.ceil(Math.abs(slope)) + 1;   // splat width, so steep diagonals have no gaps
      for (let t = -inset; t < size; t++) {
        const y = b + t;
        if (y < 0 || y >= H) continue;
        const v = t <= 0 ? 1 : Math.pow(1 - t / size, 1.5);
        const cx = Math.round(x + Math.max(0, t) * slope);
        for (let o = 0; o < wide; o++) {
          const px = cx + (slope < 0 ? -o : o);
          if (px < 0 || px >= W) continue;
          const i = y * W + px;
          map[i] = Math.max(map[i], al * v);
        }
      }
    }
  });
  const soft = blur(map, Math.round(c.softness));
  // Thin feet (the telescope): the blur averages the pool with empty floor beside the foot, so it would never
  // get fully dark right under it. Rescale so its darkest point is full strength again.
  if (set.footLine) {
    let peak = 0;
    for (let i = 0; i < soft.length; i++) peak = Math.max(peak, soft[i]);
    if (peak > 0) for (let i = 0; i < soft.length; i++) soft[i] = Math.min(1, soft[i] / peak);
  }
  return soft;
}

// Cast: every pixel up to `height` above the base is laid flat on the floor, along the tiles. The result
// is merged into simple graphic clumps (blur + threshold) and fades with distance from where it starts.
function castMap(c, set) {
  const map = new Float32Array(W * H), dist = new Float32Array(W * H);
  // Sets clipped at their feet start right at the base: an inset start would be clipped away, leaving a gap.
  const maxH = c.height / S, inset = set.footLine ? 0 : Math.round(SHADOWS.inset / S);
  set.casters.forEach((a, n) => {
    const base = set.castBases[n];
    for (let x = 0; x < W; x++) {
      const b = base[x];
      if (b < 0) continue;
      const [ux, uy] = tileDir(x, b), dx = ux * c.length, dy = uy * c.length * c.squash;
      for (let y = b; y > b - maxH && y >= 0; y--) {
        const al = a[y * W + x];
        if (al < 0.05) continue;
        const h = b - y, fade = 1 - h / maxH;
        // splat 2x2 so the flattened shadow has no gaps
        const tx = Math.round(x + h * dx), ty = Math.round(b - inset + h * dy);
        for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
          const px = tx + ox, py = ty + oy;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const i = py * W + px;
          map[i] = Math.max(map[i], al);
          dist[i] = Math.max(dist[i], al * fade);   // 1 at the base, 0 at the far end
        }
      }
    }
  });
  // Clumps: blur the coverage strongly, then cut it into a flat shape at a threshold, so small details merge.
  const r = Math.round(c.clump);
  const cover = blur(map, r), near = blur(dist, r), shape = new Float32Array(W * H);
  for (let i = 0; i < shape.length; i++) {
    const v = cover[i];
    const inShape = r < 1 ? v : Math.min(1, Math.max(0, (v - 0.28) / 0.12));   // smooth step around 0.34
    // Distance fade across the merged shape: average "nearness" of what was splatted here.
    const n = v > 1e-4 ? Math.min(1, near[i] / v) : 0;
    shape[i] = inShape * Math.pow(n, c.falloff);
  }
  return blur(shape, Math.round(c.softness));
}

// Mask to the floor band, optionally step into bands, and paint into a layer's RGBA canvas.
function paint(layer, map, bands, hardness) {
  // The canvas is a white alpha mask; the layer's color comes from its material (live, see setShadowColor).
  const g = layer.canvas.getContext('2d'), img = g.createImageData(W, H), px = img.data;
  const top = SHADOWS.floorTop / S, bottom = SHADOWS.floorBottom / S, edge = 6;
  for (let y = 0; y < H; y++) {
    const band = Math.min(1, Math.max(0, (y - top) / edge), Math.max(0, (bottom - y) / edge));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = map[i] * shadow.floor[i] * band;
      if (hardness > 0) {
        const stepped = v > 0.04 ? Math.ceil(v * bands) / bands : 0;
        v += (stepped - v) * hardness;
      }
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255; px[i * 4 + 3] = Math.min(255, v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  if (layer.texture) layer.texture.needsUpdate = true;
}

// Sets with a foot line (the telescope): nothing above where its feet meet the floor, so the blur doesn't
// leave a haze in the air beside the thin legs. Fades in over a few rows just above the line.
function clipToFeet(map, set) {
  if (!set.footLine) return map;
  const lift = SHADOWS.scopeLift / S, fade = 2;
  for (let x = 0; x < W; x++) {
    const line = set.footLine[x];
    if (line < 0) continue;
    for (let y = 0; y < H; y++) {
      const k = (y - (line - lift)) / fade + 1;
      if (k >= 1) break;
      map[y * W + x] *= Math.max(0, k);
    }
  }
  return map;
}

// Redraw one layer (by name, e.g. 'contact' or 'scopeCast'), or all of them.
function renderShadows(which = 'all') {
  if (!shadow.floor) return;
  for (const { name, kind, set } of LAYERS) {
    if (which !== 'all' && which !== name) continue;
    const c = SHADOWS[name], s = shadow.sets[set];
    if (kind === 'contact') paint(shadow[name], clipToFeet(contactMap(c, s), s), 1, 0);
    else paint(shadow[name], clipToFeet(castMap(c, s), s), c.bands, c.hardness);
  }
}

function makeLayer(which, order) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  return { which, canvas, order, texture: null, mesh: null, multiply: { value: 0 } };
}

// Multiply blending: the shader outputs mix(white, color, alpha) and the GPU multiplies the floor by it,
// so shadows darken what's underneath and keep its hue. Normal blending lays the color over the floor.
function addMultiply(mat, uniform) {
  const rowScroll = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    rowScroll(shader, renderer);
    shader.uniforms.uMultiply = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uMultiply;`)
      // after the color-space conversion, so it multiplies like an image editor's Multiply layer
      .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
        if (uMultiply > 0.5) gl_FragColor = vec4(mix(vec3(1.0), gl_FragColor.rgb, gl_FragColor.a), 1.0);`);
  };
  mat.customProgramCacheKey = () => 'shadow-multiply';
}

function setShadowBlend(which, mode) {
  SHADOWS[which].blend = mode;
  const layer = shadow[which];
  if (!layer?.mesh) return;
  const m = layer.mesh.material, multiply = mode === 'multiply';
  layer.multiply.value = multiply ? 1 : 0;
  m.blending = multiply ? THREE.CustomBlending : THREE.NormalBlending;
  m.blendSrc = THREE.ZeroFactor; m.blendDst = THREE.SrcColorFactor; m.blendEquation = THREE.AddEquation;
}

function setShadowColor(which, hex) {
  SHADOWS[which].color = hex;
  shadow[which]?.mesh?.material.color.set(hex);
}

// imgs: loaded artwork by name. All layers lie on the floor plane, above the floor and below the props.
function buildShadows(imgs) {
  for (const [set, names] of [['props', SHADOWS.casters], ['scope', SHADOWS.scopeCasters]]) {
    const casters = names.map(n => alphaOf(stackImages([n].flat().map(k => imgs[k]))));   // a list = one stacked caster
    const bases = findBases(casters);
    shadow.sets[set] = { casters, bases, castBases: bases };
  }
  // The telescope stands on thin legs with its tube overhanging: only columns near its lowest foot touch the
  // floor (contact). Every column casts from the row of its nearest foot (footLine), so the legs' and tube's
  // shadows start on the floor, and the shadow is clipped above that line (clipToFeet).
  const scope = shadow.sets.scope, feet = SHADOWS.scopeFeet / S;
  scope.bases = scope.bases.map(base => {
    const ground = Math.max(...base);
    return base.map(b => (b >= 0 && ground - b <= feet ? b : -1));
  });
  scope.footLine = new Int32Array(W).fill(-1);
  const footCols = [];
  scope.bases.forEach(base => base.forEach((b, x) => { if (b >= 0) footCols.push([x, b]); }));
  for (let x = 0; x < W && footCols.length; x++) {
    let best = footCols[0];
    for (const f of footCols) if (Math.abs(f[0] - x) < Math.abs(best[0] - x)) best = f;
    scope.footLine[x] = best[1];
  }
  scope.castBases = findBases(scope.casters).map(base => base.map((b, x) => (b < 0 ? -1 : scope.footLine[x])));
  shadow.floor = alphaOf(imgs.midground_floor);
  for (const { name, order } of LAYERS) shadow[name] = makeLayer(name, order);
  renderShadows();
  const item = layers.midground;
  for (const layer of LAYERS.map(l => shadow[l.name])) {
    layer.texture = makeTexture(layer.canvas);
    const cfg = SHADOWS[layer.which];
    const mat = new THREE.MeshBasicMaterial({ map: layer.texture, transparent: true, depthWrite: false,
      opacity: cfg.opacity, color: cfg.color });
    enableRowScroll(mat, false);   // the shadows stretch with the floor rows (and stay out of the firefly light)
    addMultiply(mat, layer.multiply);
    layer.mesh = new THREE.Mesh(new THREE.PlaneGeometry(item.w, item.h), mat);
    layer.mesh.position.z = 0.001;
    layer.mesh.renderOrder = layer.order;
    layerAttach(item).add(layer.mesh);
    setShadowBlend(layer.which, cfg.blend);
  }
}

// Strength of one layer, live.
function setShadowOpacity(which, v) {
  SHADOWS[which].opacity = v;
  const layer = shadow[which];
  if (layer?.mesh) layer.mesh.material.opacity = v;
}

export { shadow, buildShadows, renderShadows, setShadowOpacity, setShadowColor, setShadowBlend };
