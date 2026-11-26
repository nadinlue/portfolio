// Lamp glows detected from the artwork, and the drifting fog.
import * as THREE from 'three';
import { ART_H, ART_W, CITY_GLOW, DEPTH, GLOW_FLOOR_Y, GLOW_SCAN_W, GLOW_SPREAD, PAN_WEIGHT } from './config.js';
import { frameAt, pointScale, renderer } from './core.js';
import { registerParallax } from './layers.js';

// Glow groups, each with its own look, set from its own Settings section at startup:
// `midground` = lamps on the roof, `background` = lit windows of the near and far city,
// `stars` = the light of the stars in the nets (each glow keeps its star's own color, tinted by the group color).
const glowUniforms = () => ({
  uColor: { value: new THREE.Color() },   // raw (additive) output color
  uGain: { value: 1 }, uSizeMul: { value: 1 }, uHardness: { value: 1 }, uBands: { value: 3 },
  uFlicker: { value: 1 }, uFlickerSpeed: { value: 1 }, uPulse: { value: 0.08 },
  uAlphaScale: { value: 1 },   // lower for Tint blending so the glow doesn't cover the lamp art
});
const glowGroups = {
  midground: { uniforms: glowUniforms(), blending: THREE.AdditiveBlending, mats: [] },
  background: { uniforms: glowUniforms(), blending: THREE.AdditiveBlending, mats: [] },
  stars: { uniforms: glowUniforms(), blending: THREE.AdditiveBlending, mats: [] },
};
const fogShared = {
  uColor: { value: new THREE.Color() }, uOpacity: { value: 0.7 }, uHardness: { value: 0.6 }, uSpeed: { value: 0.03 },
};

const fxMats = [];   // materials with a uTime uniform that stay visible in Behind the Scenes

// Find bright lamp-orange spots in a layer image. Runs at half resolution; fragments within a few
// pixels are merged into one light. Returns centers (u, v in 0..1) and radius r (fraction of width).
// minArea: smallest bright spot (pixels at scan size) that counts as a light.
function findGlows(img, minArea = 3) {
  const W = GLOW_SCAN_W, H = Math.round(img.height * W / img.width), N = W * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const hot = new Uint8Array(N), tmp = new Uint8Array(N), grown = new Uint8Array(N);
  const maxRow = H * GLOW_FLOOR_Y;
  for (let i = 0; i < N; i++) {
    const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3];
    hot[i] = a > 128 && r > 235 && gg > 150 && r - b > 70 && i / W < maxRow ? 1 : 0;
  }
  const R = 3;   // dilation radius (separable box)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let k = -R; k <= R && !v; k++) { const xx = x + k; if (xx >= 0 && xx < W && hot[y * W + xx]) v = 1; }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let k = -R; k <= R && !v; k++) { const yy = y + k; if (yy >= 0 && yy < H && tmp[yy * W + x]) v = 1; }
    grown[y * W + x] = v;
  }
  // Flood-fill the dilated mask, accumulating only the original hot pixels.
  const seen = new Uint8Array(N), stack = [], out = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (!grown[s0] || seen[s0]) continue;
    let area = 0, sx = 0, sy = 0;
    seen[s0] = 1; stack.push(s0);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      if (hot[i]) { area++; sx += x; sy += y; }
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of nb) if (n >= 0 && !seen[n] && grown[n]) { seen[n] = 1; stack.push(n); }
    }
    if (area >= minArea) out.push({ u: (sx / area + 0.5) / W, v: (sy / area + 0.5) / H,
      r: Math.min(40, Math.max(4, Math.sqrt(area) * 1.6)) / W });
  }
  return out;
}

// Glow sprites that flicker independently, attached to a layer. `group`: a key of glowGroups.
// Each glow is { u, v, r } (fractions of the frame) and may carry its own `color` (default white).
function addGlows(item, glows, { order, intensity, speed, group }) {
  const grp = glowGroups[group];
  const n = glows.length;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n), amp = new Float32Array(n);
  const col = new Float32Array(n * 3).fill(1);
  glows.forEach((gl, i) => {
    pos.set([(gl.u - 0.5) * item.w, (0.5 - gl.v) * item.h, 0], i * 3);
    size[i] = gl.r * 2 * GLOW_SPREAD * item.w;
    seed[i] = Math.random();
    amp[i] = 0.7 + Math.random() * 0.3;
    if (gl.color) col.set([gl.color.r, gl.color.g, gl.color.b], i * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aAmp', new THREE.BufferAttribute(amp, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: grp.blending,
    uniforms: { ...grp.uniforms, uTime: { value: 0 }, uIntensity: { value: intensity },
      uSpeed: { value: speed }, uViewportH: { value: 1 } },
    vertexShader: `attribute float aSize, aSeed, aAmp; attribute vec3 aColor;
      uniform float uTime, uSpeed, uViewportH, uSizeMul, uFlicker, uFlickerSpeed, uPulse; varying float vI; varying vec3 vColor;
      void main(){
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float f = uSpeed * uFlickerSpeed * (0.6 + aSeed), ph = aSeed * 40.0;
        float wave = 0.6 * sin(uTime * f * 3.1 + ph) + 0.3 * sin(uTime * f * 7.3 + ph * 0.3)
                   + 0.1 * sin(uTime * f * 17.0 + ph * 0.7);   // -1..1
        vI = max(0.0, 1.0 + 0.3 * uFlicker * wave) * aAmp;
        float worldScale = length(modelViewMatrix[0].xyz);   // follows dolly and Behind the Scenes scaling
        gl_PointSize = aSize * uSizeMul * worldScale * projectionMatrix[1][1] * uViewportH * 0.5 / -mv.z
                     * max(0.0, 1.0 + uPulse * wave);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uIntensity, uGain, uHardness, uBands, uAlphaScale; varying float vI; varying vec3 vColor;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float soft = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
        // Stylized: quantize the falloff into flat bands with a hard outer edge.
        float stepped = soft > 0.05 ? ceil(soft * uBands) / uBands : 0.0;
        float a = mix(soft, stepped, uHardness);
        gl_FragColor = vec4(uColor * vColor, min(1.0, a * vI * uIntensity * uGain * uAlphaScale));
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = order;
  pts.frustumCulled = false;
  item.group.add(pts);
  item.followers.push(pts);
  fxMats.push(mat);
  glowMats.push(mat);
  grp.mats.push(mat);
  return pts;
}
const glowMats = [];

// Drifting mist sheet: an oversized plane with an animated noise band at rooftop/skyline level.
function addFog() {
  const depth = DEPTH.fog, { w, h } = frameAt(depth);
  const KX = 1.4, KY = 1.2;   // oversize so orbit/pan never reveal its edges
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...fogShared, uTime: { value: 0 }, uCrop: { value: 0 }, uK: { value: new THREE.Vector2(KX, KY) }, uShift: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime, uOpacity, uSpeed, uCrop, uHardness, uShift; uniform vec3 uColor; uniform vec2 uK; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec2 f = (vUv - 0.5) * uK + 0.5;   // 0..1 across the artwork frame, may exceed it at the margins
        float band = smoothstep(0.26, 0.37, f.y) * (1.0 - smoothstep(0.45, 0.64, f.y));
        vec2 p = vec2((f.x - uShift) * 3.5, f.y * 7.0);   // (uShift: it slides past as the scope turns, rig.js turnLayers)
        float t = uTime * uSpeed;
        float n = 0.6 * fbm(p + vec2(t * 3.5, 0.0)) + 0.4 * fbm(p * 1.9 + vec2(-t * 6.0, t * 1.5));
        // Threshold the density into two flat tones; hardness narrows the transition to a crisp edge.
        float density = band * n;
        float w = mix(0.15, 0.004, uHardness);
        float outer = smoothstep(0.42 - w, 0.42 + w, density);
        float core = smoothstep(0.52 - w, 0.52 + w, density);
        float a = (0.38 * outer + 0.3 * core) * uOpacity;
        float inside = step(abs(f.x - 0.5), 0.5) * step(abs(f.y - 0.5), 0.5);
        a *= mix(1.0, inside, uCrop);
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * KX, h * KY), mat);
  mesh.position.set(0, 0, -depth);
  mesh.renderOrder = 4;
  fxMats.push(mat);
  return registerParallax(mesh, depth, PAN_WEIGHT.fog);
}

// Warm city glow (CITY_GLOW): soft orange light under a wavy line, fading upwards from it, on its own sheet at
// `depth`. The line is sampled once (smooth curve through its points) into EDGE_N rows across the sheet. Colour and
// the two strengths are shared uniforms (Settings → City glow).
const EDGE_N = 96, EDGE_X0 = -0.25, EDGE_X1 = 1.25;   // samples across the oversized sheet, in frame widths
function edgeSamples(pts) {   // Catmull-Rom through the points (art px) → frame rows (0 top … 1 bottom); flat past the ends
  const P = pts.map(([x, y]) => [x / ART_W, y / ART_H]), out = new Float32Array(EDGE_N);
  for (let i = 0; i < EDGE_N; i++) {
    const x = EDGE_X0 + (EDGE_X1 - EDGE_X0) * i / (EDGE_N - 1);
    if (x <= P[0][0]) { out[i] = P[0][1]; continue; }
    if (x >= P[P.length - 1][0]) { out[i] = P[P.length - 1][1]; continue; }
    let k = 0; while (P[k + 1][0] < x) k++;
    const p0 = P[Math.max(0, k - 1)], p1 = P[k], p2 = P[k + 1], p3 = P[Math.min(P.length - 1, k + 2)];
    const t = (x - p1[0]) / (p2[0] - p1[0]), t2 = t * t, t3 = t2 * t;
    out[i] = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  }
  return out;
}
const cityGlowShared = { uColor: { value: new THREE.Color('#c8693c') } };
const cityGlowStrength = { far: { value: 0.13 }, near: { value: 0.25 } };
function addCityGlow(which) {
  const G = CITY_GLOW[which], { w, h } = frameAt(G.depth), KX = 1.4, KY = 1.3;   // oversize: pan / orbit never show an edge
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...cityGlowShared, uStrength: cityGlowStrength[which], uTime: { value: 0 }, uFade: { value: 1 },
      uK: { value: new THREE.Vector2(KX, KY) }, uEdge: { value: edgeSamples(G.edge) }, uDrift: { value: CITY_GLOW.drift },
      uUp: { value: G.fadeUp / ART_H }, uDown: { value: G.fadeDown / ART_H },
      uWave: { value: CITY_GLOW.wave / ART_H }, uWaveSpeed: { value: 2 * Math.PI / CITY_GLOW.waveSec }, uShift: { value: 0 }, uCrop: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `#define EDGE_N ${EDGE_N}
      uniform float uTime, uFade, uStrength, uDrift, uUp, uDown, uWave, uWaveSpeed, uShift, uCrop; uniform float uEdge[EDGE_N];
      uniform vec3 uColor; uniform vec2 uK; varying vec2 vUv;
      float hash(float p){ return fract(sin(p * 127.1) * 43758.5453); }
      float noise(float p){ float i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
      float edgeAt(float x){   // the line's frame row at frame x (linear between the samples)
        float s = clamp((x - ${EDGE_X0.toFixed(2)}) / ${(EDGE_X1 - EDGE_X0).toFixed(2)}, 0.0, 1.0) * float(EDGE_N - 1);
        int i = int(floor(s));
        return mix(uEdge[i], uEdge[min(i + 1, EDGE_N - 1)], s - float(i));   // (WebGL 2: uniform arrays index freely)
      }
      void main(){
        vec2 f = (vUv - 0.5) * uK + 0.5;   // 0..1 across the artwork frame (y up)
        f.x -= uShift;                     // sliding past as the scope turns (rig.js turnLayers)
        float down = 1.0 - f.y;            // frame row, 0 top … 1 bottom
        // the line, slowly swelling up and down in long waves travelling along it; outside the frame it follows the
        // city's mirrored copies
        float edge = edgeAt(1.0 - abs(mod(f.x, 2.0) - 1.0)) + uWave * (0.6 * sin(f.x * 9.0 - uTime * uWaveSpeed) + 0.4 * sin(f.x * 17.0 + uTime * uWaveSpeed * 0.7 + 1.3));
        float rise = smoothstep(edge - uUp, edge + uDown, down);   // full under the line, fading out upwards
        rise *= rise;                                              // a soft glow, not a band
        float n = 0.6 * noise(f.x * 2.2 + uTime * 0.01) + 0.4 * noise(f.x * 5.1 - uTime * 0.015 + 3.0);
        float a = rise * mix(1.0, 0.55 + 0.9 * n, uDrift) * uStrength * uFade;
        vec2 g = (vUv - 0.5) * uK + 0.5;   // Behind the Scenes: hide what lies outside the card
        a *= mix(1.0, step(abs(g.x - 0.5), 0.5) * step(abs(g.y - 0.5), 0.5), uCrop);
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * KX, h * KY), mat);
  mesh.position.set(0, 0, -G.depth);
  mesh.renderOrder = G.order;
  animated.push(mat);   // time from the render loop (shown on its Behind the Scenes card, cropped to it)
  return registerParallax(mesh, G.depth, G.weight);
}

const _buf = new THREE.Vector2();
// Point sprites scale with the game view (pointScale in core.js); PointsMaterials with a fixed `size` too.
const POINT_REF_H = 1080;
const scaledPointMats = [];               // PointsMaterials with a fixed `size`: { mat, size }
function updateGlowViewport() {
  renderer.getDrawingBufferSize(_buf);
  for (const m of glowMats) m.uniforms.uViewportH.value = _buf.y;
  pointScale.value = _buf.y / POINT_REF_H;
  for (const p of scaledPointMats) p.mat.size = p.size * pointScale.value;
}

// Materials with uTime and uFade: they get the time from the render loop, and fade out in Behind the Scenes unless
// they lie on a card (bts.js; userData.btsFade = true: fade out anyway, e.g. lying outside its card).
const animated = [];

// Tint (normal) or additive blending for one glow group; set from the Settings menu.
function setGlowBlending(group, additive) {
  const grp = glowGroups[group];
  grp.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  grp.uniforms.uAlphaScale.value = additive ? 1 : 0.55;
  for (const m of grp.mats) { m.blending = grp.blending; m.needsUpdate = true; }
}

export { cityGlowShared, cityGlowStrength, addCityGlow, scaledPointMats, glowGroups, fogShared, fxMats, findGlows, addGlows, glowMats, addFog, updateGlowViewport, animated, setGlowBlending };
