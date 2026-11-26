// Ambient FX: subtle, soft atmosphere. Sky: star glints, a moon halo, high wisps, stardust shed by shooting
// stars. City: chimney steam. Rooftop: fireflies. Soft round falloffs, smooth slow motion.
// Tuning in AMBIENT (config.js); strengths in Settings → Ambient FX, fireflies in Settings → Fireflies.
import * as THREE from 'three';
import { AMBIENT, ART_H, ART_W, DEPTH, PAN_WEIGHT } from './config.js';
import { frameAt, renderer } from './core.js';
import { animated } from './effects.js';
import { flyLight, layerAttach, layerBackdrop, layers, registerParallax } from './layers.js';
import { meteorLayer, meteors } from './stars.js';

const A = AMBIENT;
const rnd = (a, b) => a + Math.random() * (b - a);
const rndOf = ([a, b]) => rnd(a, b);

// Shared by every ambient material: viewport height (for point sizes).
const shared = { uViewportH: { value: 1 } };
// Strength of each effect (Settings sliders, 0 = off): multiplies its opacity.
const EFFECTS = ['glints', 'moonHalo', 'wisps', 'stardust', 'steam', 'fireflies'];
const amount = Object.fromEntries(EFFECTS.map(k => [k, { value: 1 }]));
const objects = Object.fromEntries(EFFECTS.map(k => [k, []]));
// Look of the sky effects (Dev sky panel, setSkyFxLook); starts from AMBIENT.
const tintU = c => ({ value: new THREE.Color().setStyle(c, THREE.LinearSRGBColorSpace) });
const look = {
  glints: { uTint: tintU(A.glints.tint), uTintAmt: { value: A.glints.tintAmt }, uSize: { value: A.glints.sizeMul },
    uGlow: { value: A.glints.glow }, uEvery: { value: A.glints.every } },
  moonHalo: { uGlowAmt: { value: A.moonHalo.glowAmt }, uGlowSize: { value: A.moonHalo.glowSize }, uRingAmt: { value: A.moonHalo.ringAmt } },
  stardust: { uTint: tintU(A.stardust.tint), uTintAmt: { value: A.stardust.tintAmt }, uSize: { value: A.stardust.sizeMul },
    uGlow: { value: A.stardust.glow } },
  wisps: { uColor2: { value: new THREE.Color(A.wisps.color2) }, uOpacity: { value: A.wisps.opacity }, uPremul: { value: 0 } },
};
let enabled = true;

// Four-point glint with slightly uneven, gently curved rays. Red = the hard glint, green = its soft
// halo (same encoding as the star textures in stars.js).
// Shape: AMBIENT.glints.width (side rays vs. top/bottom) and .thickness, live in the Dev sky panel (redrawGlint).
let _glint = null, _glintRnd = null;
function glintTexture() {
  if (!_glint) { _glint = new THREE.CanvasTexture(document.createElement('canvas')); redrawGlint(); }
  return _glint;
}
function redrawGlint() {
  if (!_glint) return;   // not built yet: it reads the shape when it is
  const S = 128, m = S / 2, c = _glint.image; c.width = c.height = S;
  const g = c.getContext('2d'), G = A.glints;
  _glintRnd ||= Array.from({ length: 16 }, () => Math.random());   // the same little bends on every redraw
  let r = 0;
  const rnd = (a, b) => a + _glintRnd[r++ % 16] * (b - a);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const halo = g.createRadialGradient(m, m, 0, m, m, m);
  halo.addColorStop(0, 'rgb(0,255,0)'); halo.addColorStop(0.22, 'rgb(0,80,0)'); halo.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = halo; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgb(255,0,0)';
  // Tapered ray whose sides bow evenly on both sides (G.bend > 0 = fuller, < 0 = pinched), so it never tilts.
  const ray = (a, len, w) => {
    const ca = Math.cos(a), sa = Math.sin(a), side = Math.max(0, w * 0.5 + G.bend * len);
    const mx = m + ca * len * 0.5, my = m + sa * len * 0.5;
    g.beginPath();
    g.moveTo(m - sa * w, m + ca * w);
    g.quadraticCurveTo(mx - sa * side, my + ca * side, m + ca * len, m + sa * len);
    g.quadraticCurveTo(mx + sa * side, my - ca * side, m + sa * w, m - ca * w);
    g.closePath(); g.fill();
  };
  // i odd = up / down rays (the long ones), i even = side rays (× width).
  for (let i = 0; i < 4; i++) ray(i * Math.PI / 2, S * rnd(0.43, 0.48) * (i % 2 ? 1 : G.width), S * 0.03 * G.thickness);
  for (let i = 0; i < 4; i++) ray(Math.PI / 4 + i * Math.PI / 2, S * rnd(0.1, 0.14), S * 0.016 * G.thickness);
  g.beginPath(); g.arc(m, m, S * 0.045 * Math.sqrt(G.thickness), 0, Math.PI * 2); g.fill();
  _glint.needsUpdate = true;
}

// ---------- Shared shader code ----------

// Vertex: world-size → pixel-size helper.
const VERT = `
  uniform float uTime, uViewportH;
  float pxSize(float size, vec4 mv){
    return size * length(modelViewMatrix[0].xyz) * projectionMatrix[1][1] * uViewportH * 0.5 / -mv.z;
  }`;
// Fragment: soft round falloff of a point sprite, rotation.
const FRAG = `
  uniform float uAmount, uFade;
  float soft(vec2 pc){ float d = length(pc - 0.5) * 2.0; return exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d)); }
  vec2 rot2(vec2 p, float r){ float c = cos(r), s = sin(r); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }`;
const NOISE = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }`;

// additive: true = added light, false = laid over, 'glow' = premultiplied (the fragment outputs
// color * alpha): covers the background by alpha and adds the color, so a hue stays true and still glows.
function material(key, { uniforms = {}, vertexShader, fragmentShader, additive = true }) {
  const glow = additive === 'glow';
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    blending: glow ? THREE.CustomBlending : additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    ...(glow && { blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor }),
    uniforms: { ...shared, uTime: { value: 0 }, uFade: { value: 1 }, uAmount: amount[key], ...uniforms },
    vertexShader, fragmentShader,
  });
  animated.push(mat);   // time from the render loop; fades out in Behind the Scenes
  return mat;
}
function points(key, attrs, mat, order) {
  const geo = new THREE.BufferGeometry();
  for (const [name, [arr, size]] of Object.entries(attrs)) geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = order; pts.frustumCulled = false;
  objects[key].push(pts);
  return pts;
}
const color = c => new THREE.Color(c);

// Composition pixel → local position on a plane of size w x h centred on the frame.
const local = (w, h, px, py) => [(px / ART_W - 0.5) * w, (0.5 - py / ART_H) * h];
// Pan Orbit weight of a free-floating plane, interpolated in 1/depth between the known layers.
const WEIGHTS = [[DEPTH.foreground, PAN_WEIGHT.foreground], [9.5, PAN_WEIGHT.motesNear], [DEPTH.midground, PAN_WEIGHT.midground],
  [DEPTH.fog, PAN_WEIGHT.fog], [DEPTH.city, PAN_WEIGHT.city], [DEPTH.cityFar, PAN_WEIGHT.cityFar], [DEPTH.sky, PAN_WEIGHT.sky]];
function weightAt(d) {
  for (let i = 1; i < WEIGHTS.length; i++) {
    const [d0, w0] = WEIGHTS[i - 1], [d1, w1] = WEIGHTS[i];
    if (d <= d1) return w0 + (w1 - w0) * THREE.MathUtils.clamp((1 / d0 - 1 / d) / (1 / d0 - 1 / d1), 0, 1);
  }
  return 1;
}
// A free-floating effect plane at `depth` that parallaxes like the layers around it. Kept in `floaters` so Behind
// the Scenes can lay each on the card nearest its depth.
const floaters = [];
function floating(obj, depth) {
  obj.position.z = -depth;
  const item = registerParallax(obj, depth, weightAt(depth));
  floaters.push(item);
  return item;
}

// ---------- Sky ----------

// Star glints: now and then a background star catches the eye with a brief four-point flash.
function buildGlints() {
  const sky = layers.sky, G = A.glints, attach = layerBackdrop(sky).attach;
  const [mx, my] = local(sky.w, sky.h, ...A.moon);
  const pos = [], seed = [], size = [], period = [], col = [];
  const add = (x, y, z) => {
    const c = color(G.colors[Math.floor(Math.random() * G.colors.length)]);
    pos.push(x, y, z); seed.push(Math.random()); size.push(rndOf(G.size) / ART_W * sky.w);
    period.push(rndOf(G.period)); col.push(c.r, c.g, c.b);
  };
  for (let n = 0; n < G.count;) {   // over the painted sky, keeping the moon clear
    const fx = rnd(-0.55, 0.55), fy = 0.5 - Math.random() * 0.6, x = fx * sky.w, y = fy * sky.h;
    if (Math.hypot(x - mx, y - my) < sky.w * 0.06) continue;
    if (!sky.clearOfCity(fx, fy)) continue;   // a gap above the roofs
    add(x, y, 0.52); n++;
  }
  for (let n = 0; n < G.upperCount; n++) {   // above it, seen after the pan up (like the upper star field)
    const el = THREE.MathUtils.degToRad(rnd(14, 60));
    add(rnd(-0.6, 0.6) * sky.w / Math.cos(el), sky.depth * Math.tan(el), -0.25);
  }
  const mat = material('glints', {
    uniforms: { uMap: { value: glintTexture() }, uFlash: { value: G.flash }, ...look.glints },
    vertexShader: `${VERT}
      attribute float aSeed, aSize, aPeriod; attribute vec3 aColor; uniform float uFlash, uSize, uEvery;
      varying vec3 vColor; varying float vE;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float period = aPeriod * uEvery;
        float ph = fract(uTime / period + aSeed), f = uFlash / period;
        float e = ph < f ? sin(3.14159 * ph / f) : 0.0;
        vE = e * e; vColor = aColor;
        gl_PointSize = e > 0.0 ? pxSize(aSize, mv) * uSize * (0.45 + 0.55 * e) : 0.0;
      }`,
    fragmentShader: `${FRAG}
      uniform sampler2D uMap; uniform vec3 uTint; uniform float uTintAmt, uGlow; varying vec3 vColor; varying float vE;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);   // upright, no spin or tilt
        float a = max(t.r, t.g * uGlow) * vE * uAmount * uFade;
        gl_FragColor = vec4(mix(mix(vColor, uTint, uTintAmt), vec3(1.0), t.r * 0.6), a);
      }`,
  });
  attach.add(points('glints', { position: [pos, 3], aSeed: [seed, 1], aSize: [size, 1], aPeriod: [period, 1], aColor: [col, 3] }, mat, 2.12));
}

// Moon halo: a soft breathing glow and a faint, broken ring around the moon.
function buildMoonHalo() {
  const sky = layers.sky, M = A.moonHalo, [x, y] = local(sky.w, sky.h, ...A.moon), size = 2 * M.radius / ART_W * sky.w;
  const mat = material('moonHalo', {
    uniforms: { uColor: { value: color(M.color) }, uRingColor: { value: color(M.ringColor) }, uRing: { value: M.ring },
      uBreathe: { value: M.breathe }, ...look.moonHalo },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${FRAG}${NOISE}
      uniform float uTime, uRing, uBreathe, uGlowAmt, uGlowSize, uRingAmt; uniform vec3 uColor, uRingColor; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p), ang = atan(p.y, p.x);
        float breathe = 0.82 + 0.18 * sin(uTime * 6.2832 / uBreathe);
        float glow = exp(-r * r * 7.0 / (uGlowSize * uGlowSize)) * uGlowAmt;
        float wob = 0.012 * sin(ang * 5.0 + uTime * 0.05) + 0.006 * sin(ang * 13.0 - uTime * 0.04);
        float ring = exp(-pow((r - uRing - wob) / 0.075, 2.0));
        // Gaps in the ring, slowly rotating. Sampled on a circle so the noise wraps seamlessly (a plain
        // noise(ang) jumps where atan flips from +pi to -pi and cut the ring with a hard line left of the moon).
        float ga = ang + uTime * 0.0136;
        ring *= smoothstep(0.35, 0.65, noise(vec2(cos(ga), sin(ga)) * 2.2 + 3.0));
        float a = (glow + ring * uRingAmt) * breathe * (1.0 - smoothstep(0.9, 1.0, r)) * uAmount * uFade;
        gl_FragColor = vec4(mix(uColor, uRingColor, ring), a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.position.set(x, y, 0.48); mesh.renderOrder = 2.07;
  objects.moonHalo.push(mesh);
  layerBackdrop(sky).attach.add(mesh);
}

// High wisps: faint cirrus streaks drifting slowly across the upper sky (and over the moon). The plane reaches W.above
// sky heights over the painted sky (seen from the telescope), so they thin out softly up there instead of ending at
// its top edge; the zone fades their light, not their shape (thresholding a faded shape cut them along a line).
function buildWisps() {
  const sky = layers.sky, W = A.wisps, K = 1.3, U = W.above;
  const mat = material('wisps', {
    additive: false,
    uniforms: { uColor: { value: color(W.color) }, uTop: { value: W.top }, uTopFade: { value: W.topFade }, uBottom: { value: W.bottom }, uAbove: { value: U },
      uSpeed: { value: W.speed }, uStretch: { value: W.stretch }, uMorph: { value: W.morph }, uK: { value: K }, ...look.wisps },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${FRAG}${NOISE}
      uniform float uTime, uTop, uTopFade, uBottom, uAbove, uSpeed, uStretch, uMorph, uK, uOpacity, uPremul; uniform vec3 uColor, uColor2; varying vec2 vUv;
      void main(){
        vec2 f = vec2((vUv.x - 0.5) * uK + 0.5, vUv.y);
        float row = (1.0 - f.y) * (1.0 + uAbove) - uAbove;   // frame rows of the painted sky (< 0 above it)
        float zone = smoothstep(uTop, uTop + uTopFade, row) * (1.0 - smoothstep(uBottom - 0.15, uBottom, row));
        float t = uTime * uSpeed;
        vec2 p = vec2(f.x * 1.4 - t, row * uStretch);
        p.y += 0.9 * fbm(vec2(f.x * 3.0 - t * 1.6, row * 4.0 + t * 0.7));   // warp: long, slightly bent streaks
        // Like the mist: a second layer drifting the other way, so the streaks slowly reshape as they pass.
        float d = mix(fbm(p), fbm(p * 1.7 + vec2(t * 2.5, -t * 0.6)), uMorph);
        float n = smoothstep(0.38, 0.6, d);
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        float a = n * zone * uOpacity * edge * uAmount * uFade;
        vec3 col = mix(uColor, uColor2, n);                   // thin edges in Color, dense cores in Core color
        gl_FragColor = vec4(uPremul > 0.5 ? col * a : col, a);   // premultiplied for the Screen / Glow blends
      }`,
  });
  setWispBlend(mat, W.blend);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sky.w * K, sky.h * (1 + U)), mat);
  mesh.position.set(0, sky.h * U / 2, 0.53); mesh.renderOrder = 2.15;
  objects.wisps.push(mesh);
  layerBackdrop(sky).attach.add(mesh);
}

// Wisps blend (Dev sky → High wisps): Normal lays them over the sky, Additive adds light, Screen lightens
// softly without blowing out, Glow keeps their hue and still glows (premultiplied).
function setWispBlend(mat, mode) {
  const custom = mode === 'screen' || mode === 'glow';
  mat.blending = custom ? THREE.CustomBlending : mode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
  if (custom) {
    mat.blendSrc = THREE.OneFactor; mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.blendDst = mode === 'screen' ? THREE.OneMinusSrcColorFactor : THREE.OneMinusSrcAlphaFactor;
  }
  look.wisps.uPremul.value = custom ? 1 : 0;
  mat.needsUpdate = true;
}

// Stardust: shooting stars shed small soft particles that curl away and fade.
const dust = { pts: null, carry: new Map(), v: null, axes: null, age: null, life: null, spin: null, next: 0 };
const _dustP = new THREE.Vector3(), _dustX = new THREE.Vector3(), _dustY = new THREE.Vector3();
function buildStardust() {
  const S = A.stardust, N = S.max;
  dust.v = new Float32Array(N * 2);
  dust.axes = new Float32Array(N * 6);   // each spark drifts in the plane of the frame its star flew in (its x and y axes)
  dust.age = new Float32Array(N); dust.life = new Float32Array(N); dust.spin = new Float32Array(N);
  const mat = material('stardust', {
    uniforms: { ...look.stardust },
    vertexShader: `${VERT}
      attribute float aT, aSize, aSeed; attribute vec3 aColor; uniform float uSize; varying vec3 vColor; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float flick = 0.8 + 0.2 * sin(uTime * (5.0 + aSeed * 4.0) + aSeed * 40.0);   // gentle shimmer
        vA = smoothstep(0.0, 0.08, aT) * (1.0 - aT) * flick;
        vColor = aColor;
        gl_PointSize = pxSize(aSize, mv) * uSize * (1.0 - 0.5 * aT);
      }`,
    // A soft round particle: a small bright core in a round glow (no star shape).
    fragmentShader: `${FRAG}
      uniform vec3 uTint; uniform float uTintAmt, uGlow; varying vec3 vColor; varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = exp(-d * d * 30.0), halo = soft(gl_PointCoord) * uGlow;
        gl_FragColor = vec4(mix(mix(vColor, uTint, uTintAmt), vec3(1.0), core * 0.15), max(core, halo) * vA * uAmount * uFade);
      }`,
  });
  const z = n => new Array(N * n).fill(0);
  dust.pts = points('stardust', { position: [z(3), 3], aT: [z(1).fill(1), 1], aSize: [z(1), 1], aSeed: [z(1), 1], aColor: [z(3), 3] }, mat, 2.18);
  meteorLayer.add(dust.pts);
}
function updateStardust(dt) {
  if (!dust.pts) return;
  const S = A.stardust, N = S.max, g = dust.pts.geometry, w = layers.sky.w;
  const pos = g.attributes.position.array, t = g.attributes.aT.array, size = g.attributes.aSize.array,
    seed = g.attributes.aSeed.array, col = g.attributes.aColor.array;
  // Emit along the front of every streak, in proportion to how bright it is. A spark stays almost where
  // it was shed and only drifts slowly sideways, so the sparks left behind the moving head form a trail
  // that widens towards its end.
  if (enabled && amount.stardust.value > 0) for (const m of meteors) {
    if (!m.obj.visible) continue;
    const env = m.headMat.uniforms.uAlpha.value;
    let c = (dust.carry.get(m) || 0) + S.rate * env * dt;
    while (c >= 1) {
      c--;
      let i = -1;   // next free spark, searching on from the last one (the pool is large)
      for (let n = 0; n < N; n++) { const k = (dust.next + n) % N; if (dust.age[k] >= dust.life[k]) { i = k; break; } }
      if (i < 0) break;
      dust.next = (i + 1) % N;
      const back = rnd(0.05, 0.5) * m.trail.scale.x, side = rnd(-1, 1) * m.width * 1.5;   // along the front half of the streak, on the line
      // (the star's position is in its frame, which faces the camera wherever it looked; the sparks hang in the frame's parent)
      m.frame.updateMatrix();
      _dustP.set(m.obj.position.x - m.vx * back - m.vy * side, m.obj.position.y - m.vy * back + m.vx * side, 0.9).applyMatrix4(m.frame.matrix);
      pos.set([_dustP.x, _dustP.y, _dustP.z], i * 3);
      _dustX.set(1, 0, 0).applyQuaternion(m.frame.quaternion); _dustY.set(0, 1, 0).applyQuaternion(m.frame.quaternion);
      dust.axes.set([_dustX.x, _dustX.y, _dustX.z, _dustY.x, _dustY.y, _dustY.z], i * 6);
      const out = rnd(-1, 1) * S.spread * w, along = m.speed * rnd(0, 0.06);           // slow sideways drift, a touch of follow-through
      dust.v[i * 2] = -m.vy * out + m.vx * along; dust.v[i * 2 + 1] = m.vx * out + m.vy * along;
      dust.age[i] = 0; dust.life[i] = rndOf(S.life) * S.lifeMul; dust.spin[i] = rnd(-1, 1) * S.curl;
      size[i] = rndOf(S.size) / ART_W * w; seed[i] = Math.random();
      const mc = m.trailMat.uniforms.uMid.value;   // the star's own color, as its trail shows it (its head is nearly white)
      col.set([mc.r, mc.g, mc.b], i * 3);
    }
    dust.carry.set(m, c);
  }
  for (const m of dust.carry.keys()) if (!meteors.includes(m)) dust.carry.delete(m);
  // Drift: each spark slows down; with Curl > 0 its path also bends.
  const damp = Math.exp(-0.8 * dt);
  for (let i = 0; i < N; i++) {
    if (dust.age[i] >= dust.life[i]) { t[i] = 1; continue; }
    dust.age[i] += dt;
    const r = dust.spin[i] * dt, c = Math.cos(r), s = Math.sin(r), vx = dust.v[i * 2], vy = dust.v[i * 2 + 1];
    dust.v[i * 2] = (c * vx - s * vy) * damp; dust.v[i * 2 + 1] = (s * vx + c * vy) * damp;
    const dx = dust.v[i * 2] * dt, dy = dust.v[i * 2 + 1] * dt, ax = dust.axes, j = i * 6;
    pos[i * 3] += ax[j] * dx + ax[j + 3] * dy; pos[i * 3 + 1] += ax[j + 1] * dx + ax[j + 4] * dy; pos[i * 3 + 2] += ax[j + 2] * dx + ax[j + 5] * dy;
    t[i] = Math.min(1, dust.age[i] / dust.life[i]);
  }
  for (const a of ['position', 'aT', 'aSize', 'aSeed', 'aColor']) g.attributes[a].needsUpdate = true;
}

// ---------- City ----------

// Chimney steam: soft puffs rising from the chimney tops, growing, drifting with the wind and fading (looping in the shader).
function buildSteam() {
  const P = A.steam, item = layers.city, toW = px => px / ART_W * item.w;
  const pos = [], seed = [], life = [], phase = [], s0 = [], s1 = [];
  for (const [x, y] of P.chimneys) for (let k = 0; k < P.puffs; k++) {
    pos.push(...local(item.w, item.h, x, y), 0.02);
    seed.push(Math.random()); life.push(rndOf(P.life)); phase.push(k / P.puffs + rnd(0, 0.5 / P.puffs));
    s0.push(toW(P.size[0]) * rnd(0.8, 1.2)); s1.push(toW(P.size[1]) * rnd(0.8, 1.2));
  }
  const mat = material('steam', {
    additive: false,
    uniforms: { uColor: { value: color(P.color) }, uRise: { value: toW(P.rise) }, uDrift: { value: toW(P.drift) },
      uAlpha: { value: P.opacity } },
    vertexShader: `${VERT}
      attribute float aSeed, aLife, aPhase, aS0, aS1; uniform float uRise, uDrift; varying float vA;
      void main(){
        float t = fract(uTime / aLife + aPhase);
        vec3 p = position + vec3(uDrift * t * t + sin(t * 3.0 + aSeed * 6.0) * uRise * 0.08, uRise * t, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.45, 1.0, t));
        gl_PointSize = pxSize(mix(aS0, aS1, sqrt(t)), mv);
      }`,
    fragmentShader: `${FRAG}
      uniform vec3 uColor; uniform float uAlpha; varying float vA;
      void main(){ gl_FragColor = vec4(uColor, soft(gl_PointCoord) * vA * uAlpha * uAmount * uFade); }`,
  });
  layerAttach(item).add(points('steam', { position: [pos, 3], aSeed: [seed, 1], aLife: [life, 1], aPhase: [phase, 1],
    aS0: [s0, 1], aS1: [s1, 1] }, mat, 3.15));
}

// ---------- Rooftop ----------

// Fireflies (after Art/Ingame_Background/FX): a tiny white-hot body in a thin warm ember rim and a faint wide halo,
// darting about in quick little curves and loops on top of a slow drift, mostly lit with a faint flicker, spread
// through the depth. All motion is smooth (eased noise and sines): lively, never stepping.
// Live firefly look, shared by all groups (Settings → Fireflies). Blink and wander run on their own clocks,
// advanced in updateAmbient, so changing their speed never makes the fireflies jump.
const fly = {
  uColor: { value: new THREE.Color().setStyle(A.fireflies.color, THREE.LinearSRGBColorSpace) },   // raw hex, like the glow pickers
  uSizeMul: { value: 1 }, uCore: { value: A.fireflies.core }, uHalo: { value: 1 }, uRest: { value: 0.1 },
  uRim: { value: A.fireflies.rim }, uRimAmt: { value: 1 }, uRimSoft: { value: A.fireflies.rimSoft },
  uWanderMul: { value: 1 }, uBlinkT: { value: 0 }, uWanderT: { value: 0 }, uLightAmt: { value: A.fireflies.light.strength },
  blinkSpeed: 1, wanderSpeed: 1, density: 1, groups: [],   // groups: { pts, count }
};
// The fireflies' vertex shader (motion, glow cycle, colour); size = the point size expression.
const flyVert = size => `${VERT}
        attribute float aSeed, aSize, aPeriod; attribute vec2 aVary;
        uniform float uWander, uDart, uLoop, uDartRate, uFlicker, uWanderMul, uSizeMul, uRest, uBlinkT, uWanderT; uniform vec3 uColor;
        vec3 hueShift(vec3 c, float h){   // rotate the hue around the grey axis
          const vec3 k = vec3(0.57735); float a = h * 6.2832, ca = cos(a);
          return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
        }
        float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
        float n1(float x){ float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0; }   // smooth, -1..1
        varying vec3 vColor; varying float vI;
        void main(){
          float s = aSeed, T = uWanderT;
          // slow drift + darting (eased random headings, a few per second) + small quick loops
          vec2 drift = vec2(0.6 * sin(T * 0.23 * (0.7 + s) + s * 11.0) + 0.4 * sin(T * 0.61 + s * 5.0),
                            0.5 * sin(T * 0.19 + s * 7.0) + 0.3 * sin(T * 0.53 * (0.8 + s) + s * 3.0));
          float r = uDartRate * (0.75 + 0.5 * s);
          vec2 dart = vec2(n1(T * r + s * 37.0) + 0.5 * n1(T * r * 2.1 + s * 91.0), n1(T * r * 1.13 + s * 53.0) + 0.5 * n1(T * r * 1.9 + s * 17.0));
          float lr = 2.2 + 1.6 * s;
          vec2 loop = vec2(sin(T * lr + s * 20.0), cos(T * lr * 1.31 + s * 9.0));
          vec3 p = position + uWanderMul * vec3(uWander * drift + uDart * dart + uLoop * loop, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float ph = fract(uBlinkT / aPeriod + s);   // mostly lit, then a short dim rest now and then
          float on = 1.0 - smoothstep(0.72, 0.82, ph) * (1.0 - smoothstep(0.9, 1.0, ph));
          float flick = 1.0 - uFlicker * (0.5 + 0.5 * sin(T * (9.0 + 7.0 * s) + s * 40.0)) * (0.5 + 0.5 * sin(T * (5.3 + 3.0 * s)));
          vI = (uRest + (1.0 - uRest) * on) * flick; vColor = max(hueShift(uColor, aVary.x), 0.0) * aVary.y;
          gl_PointSize = POINT_SIZE;
        }`.replace('POINT_SIZE', size);

// Their light on the roof (Settings → Fireflies → Light on surroundings): each firefly near the roof also draws a
// small warm pool of light into a half-size light map (object layer 1, renderFireflyLight, before the frame);
// the roof art adds it in proportion to its own colour (layers.js flyLight), so things near a firefly look lit.
const LIGHT_LAYER = 1;
let lightTarget = null;
function renderFireflyLight(renderer, scene, camera) {
  renderer.getDrawingBufferSize(_buf);
  const on = enabled && amount.fireflies.value > 0 && fly.uLightAmt.value > 0;
  flyLight.uFlyLightOn.value = on ? 1 : 0;
  if (!on) return;
  const w = Math.max(1, Math.round(_buf.x / 2)), h = Math.max(1, Math.round(_buf.y / 2));
  if (!lightTarget) lightTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
  if (lightTarget.width !== w || lightTarget.height !== h) lightTarget.setSize(w, h);
  flyLight.uFlyLight.value = lightTarget.texture;
  flyLight.uFlyLightRes.value.set(_buf.x, _buf.y);
  const mask = camera.layers.mask, clear = renderer.getClearColor(new THREE.Color()), clearA = renderer.getClearAlpha(), bg = scene.background;
  camera.layers.set(LIGHT_LAYER); scene.background = null;
  renderer.setRenderTarget(lightTarget); renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.setClearColor(clear, clearA);
  camera.layers.mask = mask; scene.background = bg;
}

function buildFireflies() {
  const F = A.fireflies;
  for (const grp of F.groups) {
    const { w, h } = frameAt(grp.depth), [x0, y0, x1, y1] = grp.rect, mul = grp.sizeMul || 1, art = v => v / ART_W * w;
    const pos = [], seed = [], size = [], period = [], vary = [];
    for (let i = 0; i < grp.count; i++) {
      pos.push(...local(w, h, rnd(x0, x1), rnd(y0, y1)), 0);
      seed.push(Math.random()); size.push(art(rndOf(F.size) * mul)); period.push(rndOf(F.blink));
      vary.push(rnd(-1, 1) * F.hueSpread, rnd(0.85, 1.1));   // per firefly: hue shift, brightness
    }
    const mat = material('fireflies', {
      additive: 'glow',   // keeps the picked color true over the blue night (plain added light turns it pale)
      uniforms: { uWander: { value: art(F.wander * mul) }, uDart: { value: art(F.dart * mul) }, uLoop: { value: art(F.loop * mul) },
        uDartRate: { value: F.dartRate }, uRim: fly.uRim, uRimAmt: fly.uRimAmt, uRimSoft: fly.uRimSoft, uFlicker: { value: F.flicker }, uSoft: { value: grp.soft || 0 },
        uColor: fly.uColor, uCore: fly.uCore, uSizeMul: fly.uSizeMul, uHalo: fly.uHalo, uRest: fly.uRest, uWanderMul: fly.uWanderMul,
        uBlinkT: fly.uBlinkT, uWanderT: fly.uWanderT },
      vertexShader: flyVert('pxSize(aSize, mv) * uSizeMul'),
      fragmentShader: `${FRAG}
        uniform float uSoft, uCore, uHalo, uRim, uRimAmt, uRimSoft; varying vec3 vColor; varying float vI;
        void main(){
          float d = length(gl_PointCoord - 0.5);                                  // 0 .. 0.5 at the sprite's edge
          float body = (1.0 - smoothstep(uCore * 0.45, uCore, d)) * (1.0 - uSoft);  // white-hot
          float rimR = uCore * mix(uRim, uRim * 3.0, uSoft);
          // warm ember glow around the body: uRimSoft 0 = a crisp disc edge … 1 = a long soft fade (exponent 4 → 1)
          float rim = exp(-pow(d / rimR, mix(4.0, 1.0, uRimSoft)) * 1.6) * mix(1.0, 0.45, uSoft) * uRimAmt;
          float halo = soft(gl_PointCoord) * 0.16 * uHalo;                       // faint, wide
          vec3 c = vec3(1.0, 0.97, 0.9) * body + vColor * (rim * 0.95 + halo) * (1.0 - body);
          float a = min(1.0, max(body, min(rim, 1.0) * 0.85 + halo)) * vI * uAmount * uFade;
          gl_FragColor = vec4(c * vI * uAmount * uFade, a);   // premultiplied
        }`,
    });
    const pts = points('fireflies', { position: [pos, 3], aSeed: [seed, 1], aSize: [size, 1], aPeriod: [period, 1], aVary: [vary, 2] },
      mat, grp.depth < DEPTH.midground - 1 ? 7.01 : grp.depth > DEPTH.midground + 1 ? 4.65 : 5.5);   // far ones behind the roof
    floating(pts, grp.depth);
    if (grp.depth < DEPTH.midground + 1) {   // the ones by the roof light it (far ones would light things in front of them)
      const lightMat = material('fireflies', {
        uniforms: { ...mat.uniforms, uLightSize: { value: art(F.light.radius * 2 * mul) }, uLightAmt: fly.uLightAmt },
        vertexShader: `uniform float uLightSize;
${flyVert('pxSize(uLightSize, mv)')}`,
        fragmentShader: `${FRAG}
          uniform float uLightAmt; varying vec3 vColor; varying float vI;
          void main(){
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float f = (1.0 / (1.0 + d * d * 30.0) - 0.032) / 0.968;   // like a point light: strong right by the firefly, fading fast, 0 at the edge
            f = max(f, 0.0);
            gl_FragColor = vec4(vColor * f * vI * uLightAmt * uAmount * uFade, 1.0);
          }`,
      });
      const light = new THREE.Points(pts.geometry, lightMat);
      light.layers.set(LIGHT_LAYER); light.frustumCulled = false;
      pts.add(light);
    }
    fly.groups.push({ pts, count: grp.count });
  }
  setFireflyLook('density', fly.density);
}

// Settings → Fireflies. key: color (hex), size, core, halo, rim (size × body), rimAmt, rimSoft (0..1), rest, wander, light (look, light × AMBIENT.fireflies.light.strength), blinkSpeed, wanderSpeed (clocks), density (0..1 of each group).
function setFireflyLook(key, v) {
  const u = { size: fly.uSizeMul, core: fly.uCore, halo: fly.uHalo, rest: fly.uRest, wander: fly.uWanderMul,
    rim: fly.uRim, rimAmt: fly.uRimAmt, rimSoft: fly.uRimSoft }[key];
  if (key === 'light') { fly.uLightAmt.value = A.fireflies.light.strength * v; return; }
  if (u) u.value = v;
  else if (key === 'color') fly.uColor.value.setStyle(v, THREE.LinearSRGBColorSpace);
  else if (key === 'density') {
    fly.density = v;
    for (const g of fly.groups) g.pts.geometry.setDrawRange(0, Math.round(g.count * v));
  } else fly[key] = v;
}

// Dev sky panel: look of the glints, moon halo and stardust. effect = 'glints' | 'moonHalo' | 'stardust';
// key = an AMBIENT[effect] field (tint, tintAmt, sizeMul, glow, every, color, ringColor, ring, breathe, glowAmt,
// glowSize, ringAmt, rate, curl). Writes AMBIENT too, so the scene build starts from it.
const LOOK_UNIFORM = { color2: 'uColor2', opacity: 'uOpacity', tint: 'uTint', tintAmt: 'uTintAmt', sizeMul: 'uSize', glow: 'uGlow', every: 'uEvery',
  glowAmt: 'uGlowAmt', glowSize: 'uGlowSize', ringAmt: 'uRingAmt', color: 'uColor', ringColor: 'uRingColor', ring: 'uRing', breathe: 'uBreathe' };
function setSkyFxLook(effect, key, v) {
  A[effect][key] = v;
  if (effect === 'wisps' && key === 'blend') { for (const o of objects.wisps) setWispBlend(o.material, v); return; }
  if (effect === 'glints' && ['width', 'thickness', 'bend'].includes(key)) redrawGlint();
  const name = LOOK_UNIFORM[key];
  const targets = [look[effect][name], ...objects[effect].map(o => o.material.uniforms[name])].filter(Boolean);
  for (const u of new Set(targets)) {
    if (key === 'tint') u.value.setStyle(v, THREE.LinearSRGBColorSpace);   // like the other tints
    else if (u.value instanceof THREE.Color) u.value.set(v);                // like the build (color())
    else u.value = v;
  }
}

// ---------- Build, update, settings ----------

// Called by the scene build once every layer and the meteor layer exist.
function buildAmbient() {
  buildMoonHalo(); buildWisps(); buildGlints(); buildStardust();
  buildSteam();
  buildFireflies();
  for (const k of EFFECTS) setAmbientAmount(k, amount[k].value);
}

const _buf = new THREE.Vector2();
function updateAmbient(dt) {
  renderer.getDrawingBufferSize(_buf);
  shared.uViewportH.value = _buf.y;
  fly.uBlinkT.value += dt * fly.blinkSpeed;
  fly.uWanderT.value += dt * fly.wanderSpeed;
  updateStardust(dt);
}

function showEffect(k) { for (const o of objects[k]) o.visible = enabled && amount[k].value > 0; }
function setAmbientAmount(k, v) { amount[k].value = v; showEffect(k); }
function setAmbientOn(on) { enabled = on; EFFECTS.forEach(showEffect); }

export { floaters, EFFECTS as AMBIENT_EFFECTS, renderFireflyLight, buildAmbient, updateAmbient, setAmbientAmount, setAmbientOn, setFireflyLook, setSkyFxLook };
