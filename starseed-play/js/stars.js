// Twinkling star fields and shooting stars.
import * as THREE from 'three';
import { randomOf } from './util.js';
import { CONSTELLATION_STYLE, DEPTH, SKY_LOOK, settings } from './config.js';
import { camera, pointScale, renderer, scene } from './core.js';
import { layers, skyParallax } from './layers.js';
import { crane } from './rig.js';
import { bts } from './bts.js';
import { chime, shimmer } from './chime.js';
import { skyColor } from './skyLook.js';



// Opaque texture: red = the hard star, green = its soft halo: a four-pointed star with softly curved concave sides and a fuller body, slightly
// taller than wide, no cross-rays. `shape` = { curve, width, tipFade } (SKY_LOOK.stars.shape, CONSTELLATION_STYLE.shape).
// tipFade: adds a soft ray along each point; higher = its light fades out more slowly towards the tip (0 = no rays).
function drawCurvedStar(tex, shape, S) {
  const c = tex.image; c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  const halo = g.createRadialGradient(m, m, 0, m, m, m);
  halo.addColorStop(0, 'rgb(0,255,0)'); halo.addColorStop(0.3, 'rgb(0,80,0)'); halo.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = halo; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgb(255,0,0)';
  const fade = shape.tipFade ?? 0;
  const H = S * (fade ? 0.49 : 0.46), W = H * shape.width, k = shape.curve;   // (fading: the points reach a little further into the sprite)
  const tips = [[0, -H], [W, 0], [0, H], [-W, 0]];
  g.save(); g.translate(m, m); g.beginPath(); g.moveTo(...tips[0]);
  for (let i = 0; i < 4; i++) {   // each side: tip to tip, the handles pulled in along both axes → a concave arc
    const [ax, ay] = tips[i], [bx, by] = tips[(i + 1) % 4];
    g.bezierCurveTo(ax * k, ay * k, bx * k, by * k, bx, by);
  }
  g.closePath(); g.fill(); g.restore();
  if (fade) {   // soft rays along the points: wide enough to survive at small sizes, tapering and fading smoothly to the tip
    const img = g.getImageData(0, 0, S, S), d = img.data, power = 3 - 1.8 * fade;   // more fade = keeps its light further out
    const ray = (along, across, len) => {
      const a = Math.min(1, Math.abs(along) / len), w = (0.09 - 0.05 * a) * H;
      return Math.pow(1 - a, power) * Math.exp(-across * across / (w * w));
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = x + 0.5 - m, py = y + 0.5 - m, i = (y * S + x) * 4;
      d[i] = Math.max(d[i], 255 * Math.min(1, ray(py, px, H) + ray(px, py, W)));
    }
    g.putImageData(img, 0, 0);
  }
  tex.needsUpdate = true;
}
const curvedStarTexture = (shape, S) => { const t = new THREE.CanvasTexture(document.createElement('canvas')); drawCurvedStar(t, shape, S); return t; };

// The playable constellation stars' texture (bigger on screen, so drawn larger).
let _nodeStarTex = null;
const nodeStarTexture = () => _nodeStarTex || (_nodeStarTex = curvedStarTexture(CONSTELLATION_STYLE.shape, 256));

// Background stars (SKY_LOOK.stars), two kinds. Dots: small soft points in the sky's own muted hues, breathing and
// twinkling. Twinkles: rarer small crosses with a glow in the middle; now and then one lights up and the fade of its
// rays reaches further out. Both drawn in the shader, with soft falloffs only.
const lerp = ([a, b]) => a + Math.random() * (b - a);
const rawColor = c => new THREE.Color().setStyle(c, THREE.LinearSRGBColorSpace);   // raw hex, like the glow pickers
function pickStar() {
  const S = SKY_LOOK.stars, D = S.dots, T = S.twinkles;
  if (Math.random() < T.maxShare) {
    const t = Math.random();
    return { kind: 'twinkle', size: T.size[0] + t * (T.size[1] - T.size[0]), bright: lerp(T.bright), color: rawColor(randomOf(T.colors)), near: 0.6 + 0.4 * t };
  }
  const t = Math.pow(Math.random(), D.sizePow);   // mostly small ones
  return { kind: 'dot', size: D.size[0] + t * (D.size[1] - D.size[0]), bright: lerp(D.bright), color: rawColor(randomOf(D.colors)), near: 0.55 * t };
}

// Live look of the background stars (Dev sky panel): control id → [SKY_LOOK.stars part, key, uniform].
const SKY_STAR_CONTROLS = {
  skyDotColorAmt: ['dots', 'colorAmt', 'uDotColorAmt'], skyDotBright: ['dots', 'brightMul', 'uDotBright'], skyDotSize: ['dots', 'sizeMul', 'uDotSize'],
  skyDotGlow: ['dots', 'glow', 'uDotGlow'], skyDotBreathe: ['dots', 'breathe', 'uDotBreathe'], skyDotBreatheSec: ['dots', 'breatheSec', 'uDotBreatheSec'],
  skyDotTwinkle: ['dots', 'twinkle', 'uDotTwinkle'],
  skyDotBodyWhite: ['dots', 'bodyWhite', 'uDotBodyWhite'], skyDotGlowColor: ['dots', 'glowColor', 'uDotGlowColor'], skyDotSkyHue: ['dots', 'skyHue', 'uDotSkyHue'], skyDotHueShare: ['dots', 'hueShare', 'uDotHueShare'],
  skyTwBodyWhite: ['twinkles', 'bodyWhite', 'uTwBodyWhite'], skyTwGlowColor: ['twinkles', 'glowColor', 'uTwGlowColor'], skyTwSkyHue: ['twinkles', 'skyHue', 'uTwSkyHue'], skyTwHueShare: ['twinkles', 'hueShare', 'uTwHueShare'],
  skyTwShare: ['twinkles', 'share', 'uTwShare'], skyTwBright: ['twinkles', 'brightMul', 'uTwBright'], skyTwSize: ['twinkles', 'sizeMul', 'uTwSize'],
  skyTwDot: ['twinkles', 'dot', 'uTwDot'], skyTwFlare: ['twinkles', 'flare', 'uTwFlare'], skyTwThin: ['twinkles', 'thickness', 'uTwThin'],
  skyTwGlow: ['twinkles', 'glow', 'uTwGlow'], skyTwEvery: ['twinkles', 'every', 'uTwEvery'], skyTwSec: ['twinkles', 'sec', 'uTwSec'],
};
const skyStarStyle = Object.fromEntries(Object.values(SKY_STAR_CONTROLS).map(([part, key, u]) => [u, { value: SKY_LOOK.stars[part][key] }]));
skyStarStyle.uTwMaxShare = { value: SKY_LOOK.stars.twinkles.maxShare };
function setSkyStarLook(id, v) {
  const [part, key, u] = SKY_STAR_CONTROLS[id];
  SKY_LOOK.stars[part][key] = skyStarStyle[u].value = v;
}

// A star field's own look on top of the shared one (addStars look): size / brightness of dots and twinkles, the twinkles'
// share (× their Amount), how far a twinkle's cross reaches past its dot, and a lean (tint 0 … 1) to two hues of its own. PLAIN_LOOK = as the shared look.
const fieldLook = (tintA = new THREE.Color(), tintB = new THREE.Color()) => ({ uFDotSize: { value: 1 }, uFDotBright: { value: 1 },
  uFTwShare: { value: 1 }, uFTwSize: { value: 1 }, uFTwCross: { value: 1 }, uFTwBright: { value: 1 }, uFTint: { value: 0 }, uFTintA: { value: tintA }, uFTintB: { value: tintB } });
const PLAIN_LOOK = fieldLook();
const starFields = [];   // every twinkling star field, for the Stars switch
const setStarsVisible = on => { settings.stars = on; for (const f of starFields) f.visible = on; };
// Amount of star dots (Dev sky panel): the dots lie in random order behind the twinkle stars, so drawing fewer thins them out evenly.
function drawDots(f) {
  const D = SKY_LOOK.stars.dots, n = f.geometry.attributes.position.count, tw = f.userData.twinkles;
  f.geometry.setDrawRange(0, tw + Math.round((n - tw) * Math.min(1, D.amount * f.userData.amount / D.maxAmount)));
}
function setSkyDotAmount(v) { SKY_LOOK.stars.dots.amount = v; starFields.forEach(drawDots); }
// A field's own Amount on top of the shared one (the Milky Way's stars).
function setStarFieldAmount(f, v) { if (f) { f.userData.amount = v; drawDots(f); } }
// Glow blend (Dev sky panel): 'additive' brightens the sky towards white, 'normal' (Tint) lays the star color over it.
const skyStarBlending = () => (SKY_LOOK.stars.blend === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending);
function setSkyStarBlend(mode) {
  SKY_LOOK.stars.blend = mode;
  for (const f of starFields) { f.material.blending = skyStarBlending(); f.material.needsUpdate = true; }
}

// Twinkling star field. `place(v, star)` returns false to skip a spot (e.g. near the moon, or a twinkle star
// too close to the skyline); star.kind = 'dot' | 'twinkle'. onBackdrop: the parent already takes the backdrop's
// share of the sky parallax (SKY_PARALLAX), so the stars only add what's left of theirs. rigid: no parallax of their own,
// they just move with the parent (the Milky Way's stars). amount: this field's own Amount on top of the shared one.
// look: this field's own multipliers on top of the shared look (fieldLook(), e.g. skyLook.js milkyStarLook).
function addStars({ count, order, place, parent = scene, onBackdrop = false, rigid = false, amount = 1, look = PLAIN_LOOK }) {
  const S = SKY_LOOK.stars, v = new THREE.Vector3(), stars = [];
  // `count` = the stars at Amount 1. Dots are built up to dots.maxAmount; only those Amount asks for are drawn (setSkyDotAmount).
  const left = { twinkle: Math.round(count * S.twinkles.maxShare), dot: Math.round(count * (1 - S.twinkles.maxShare) * S.dots.maxAmount) };
  const total = left.twinkle + left.dot;
  for (let tries = 0; stars.length < total && tries < total * 6; tries++) {
    const st = pickStar();
    if (left[st.kind] <= 0 || place(v, st) === false) continue;
    left[st.kind]--;
    stars.push({ st, x: v.x, y: v.y, z: v.z });
  }
  stars.sort((a, b) => (a.st.kind === b.st.kind ? 0 : a.st.kind === 'twinkle' ? -1 : 1));   // twinkle stars first: Amount only cuts dots
  const pos = [], col = [], size = [], seed = [], bright = [], near = [], kind = [];
  for (const { st, x, y, z } of stars) {
    pos.push(x, y, z); col.push(st.color.r, st.color.g, st.color.b);
    size.push(st.size); seed.push(Math.random()); bright.push(st.bright);
    near.push(st.near);   // 0 = smallest dot (far) … 1 = biggest twinkle (close), for the sky parallax
    kind.push(st.kind === 'twinkle' ? 1 : 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geo.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1));
  geo.setAttribute('aNear', new THREE.Float32BufferAttribute(near, 1));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: skyStarBlending(),
    uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uPixelRatio: pointScale,   // scales with the game view
      ...skyStarStyle,
      uHueA: skyColor.uHueA, uHueB: skyColor.uHueB, uFrom: skyColor.uFrom, uFull: skyColor.uFull,
      uParW: skyParallax.uParW, uParFar: rigid ? { value: 0 } : skyParallax.uParFar, uParNear: rigid ? { value: 0 } : skyParallax.uParNear,
      uParBase: onBackdrop ? skyParallax.uParBackdrop : { value: 0 }, uDomeZ: { value: DEPTH.sky }, ...look },
    vertexShader: `attribute vec3 aColor; attribute float aSize, aSeed, aBright, aNear, aKind; uniform float uTime, uPixelRatio;
      uniform float uDotSize, uDotBright, uDotBreathe, uDotBreatheSec, uDotTwinkle, uDotColorAmt;
      uniform float uTwShare, uTwMaxShare, uTwSize, uTwBright, uTwEvery, uTwSec, uTwDot, uDotSkyHue, uTwSkyHue, uDotHueShare, uTwHueShare, uFrom, uFull;
      uniform float uFDotSize, uFDotBright, uFTwShare, uFTwSize, uFTwCross, uFTwBright, uFTint; uniform vec3 uFTintA, uFTintB;   // this field's own look
      uniform vec3 uParW, uHueA, uHueB; uniform float uParFar, uParNear, uParBase, uDomeZ;
      varying vec3 vColor; varying float vI, vKind, vE, vDot, vCross;
      // Most stars keep their own color. The share picked by the seed lean to one of this trip's two hues (SKY_LOOK.color),
      // each star to its own, high up only: the stars seen from the roof stay as they are.
      vec3 skyHue(vec3 color, float amount, float share){
        if (fract(aSeed * 13.73) >= share) return color;
        float high = smoothstep(uFrom, uFull, asin(clamp(normalize(position - vec3(0.0, 0.0, uDomeZ)).y, -1.0, 1.0)));
        return mix(color, fract(aSeed * 5.31) < 0.5 ? uHueA : uHueB, amount * high);
      }
      void main(){
        // Sky parallax: this star's share of the sky's turn, about the dome's centre (where the camera rests).
        vec3 w = uParW * (mix(uParFar, uParNear, aNear) - uParBase), q = position - vec3(0.0, 0.0, uDomeZ), p = position;
        float a = length(w);
        if (a > 1e-5) { vec3 n = w / a; p = q * cos(a) + cross(n, q) * sin(a) + n * dot(n, q) * (1.0 - cos(a)); p.z += uDomeZ; }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vKind = aKind; vE = 0.0; vDot = 0.0; vCross = 1.0;
        float worldScale = min(1.0, length(modelViewMatrix[0].xyz));   // shrinks with the card in Behind the Scenes
        if (aKind < 0.5) {
          // Dot: a slow breath (each at its own pace) with a soft, uneven twinkle on top.
          float b = 0.5 + 0.5 * sin(uTime * 6.2832 / uDotBreatheSec * (0.7 + 0.6 * aSeed) + aSeed * 40.0);
          float t = 0.5 + 0.5 * sin(uTime * (1.3 + aSeed * 2.2) + aSeed * 91.0) * sin(uTime * (0.7 + aSeed * 1.1) + aSeed * 17.0);
          vI = aBright * uDotBright * uFDotBright * (1.0 - uDotBreathe * (1.0 - b)) * (1.0 - uDotTwinkle * t);
          vColor = skyHue(mix(vec3(dot(aColor, vec3(0.3, 0.55, 0.15))), aColor, uDotColorAmt), uDotSkyHue, uDotHueShare);
          gl_PointSize = aSize * uDotSize * uFDotSize * uPixelRatio * (1.0 - 0.2 * uDotBreathe * (1.0 - b)) * worldScale;
        } else {
          // Twinkle: the seed's fraction decides who shows, so Amount can change live. Now and then it lights up (vE
          // 0 … 1, a smooth swell), each on its own timing; between times it's a plain dot, breathing faintly.
          float shown = step(fract(aSeed * 7.31) * uTwMaxShare, uTwShare * uFTwShare);
          float period = max(uTwEvery * (0.7 + 0.9 * fract(aSeed * 3.17)), uTwSec * 1.2);
          float x = fract(uTime / period + aSeed) * period / uTwSec;
          float s = x < 1.0 ? sin(3.14159 * x) : 0.0;
          vE = s * s;
          float rest = 0.9 + 0.1 * sin(uTime * (0.5 + aSeed * 0.6) + aSeed * 23.0);
          vI = shown * aBright * uTwBright * uFTwBright * mix(rest, 1.0, vE);
          vColor = skyHue(aColor, uTwSkyHue, uTwHueShare);
          // Cross: a bigger sprite for the rays, with the dot and the ray width kept at their own size inside it.
          vCross = max(uFTwCross, 0.1);
          vDot = 2.0 * uTwDot / (aSize * uTwSize * vCross);   // the dot's radius as a share of the sprite, the same on every star
          gl_PointSize = shown * aSize * uTwSize * uFTwSize * vCross * uPixelRatio * worldScale;
        }
        if (uFTint > 0.0) vColor = mix(vColor, fract(aSeed * 2.71) < 0.5 ? uFTintA : uFTintB, uFTint);   // leaning to the field's own two hues
      }`,
    fragmentShader: `uniform float uFade, uDotGlow, uTwFlare, uTwThin, uTwGlow, uDotBodyWhite, uDotGlowColor, uTwBodyWhite, uTwGlowColor; varying vec3 vColor; varying float vI, vKind, vE, vDot, vCross;
      // One ray of the cross, along the axis a: a thin soft line whose light dies away over the length len.
      float ray(float a, float b, float len){
        float t = abs(a);
        float w = uTwThin / vCross * (1.0 - 0.6 * smoothstep(0.0, 1.0, t));
        return exp(-t / len) * exp(-b * b / (w * w)) * (1.0 - smoothstep(0.7, 1.0, t));
      }
      void main(){
        vec2 c = (gl_PointCoord - 0.5) * 2.0;
        float d2 = dot(c, c), edge = 1.0 - smoothstep(0.64, 1.0, d2), core, light;
        if (vKind < 0.5) {
          core = exp(-d2 * 28.0);                                   // the dot
          light = core + uDotGlow * exp(-d2 * 6.0);                 // its slight glow
        } else {
          float len = uTwFlare * mix(0.35, 1.0, vE);                // twinkling: the fade of the rays gets longer
          float r = vDot * (1.0 + 0.6 * vE), g = mix(vDot * 2.2, 0.3 / vCross, vE);   // at rest a dot with a slight glow
          core = exp(-d2 / (r * r));
          light = core + vE * (ray(c.y, c.x, len) + ray(c.x, c.y, len * 0.85)) + mix(uDotGlow, uTwGlow, vE) * exp(-d2 / (g * g));   // the cross only while it twinkles
        }
        // The body and the light around it (glow, rays) have a color each, blending by how much of this spot is body.
        vec3 body = mix(vColor, vec3(1.0), vKind < 0.5 ? uDotBodyWhite : uTwBodyWhite);
        vec3 around = clamp(mix(vec3(dot(vColor, vec3(0.3, 0.55, 0.15))), vColor, vKind < 0.5 ? uDotGlowColor : uTwGlowColor), 0.0, 1.0);
        gl_FragColor = vec4(mix(around, body, clamp(core / max(light, 0.001), 0.0, 1.0)), min(light, 1.0) * edge * vI * uFade);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = order;
  pts.frustumCulled = false;
  pts.visible = settings.stars;
  pts.userData.twinkles = kind.reduce((n, k) => n + k, 0);
  pts.userData.amount = amount;
  parent.add(pts);
  starFields.push(pts);
  drawDots(pts);
  return pts;
}

// Shooting stars: a star head with a tapered, hard-edged trail, flying in the sky layer's plane.
const TRAIL_GEO = new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0);   // head at x = 0, tail towards -x
const HEAD_GEO = new THREE.PlaneGeometry(1, 1);
const meteors = [];
let meteorLayer = null;

function initMeteors() {
  meteorLayer = new THREE.Group();
  layers.sky.group.add(meteorLayer);
  layers.sky.followers.push(meteorLayer);   // slides with the sky in Pan Orbit / dolly
}

// Shooting star look: a round glowing head and a long, thin trail that fades into the sky (SKY_LOOK.meteors).
function meteorMats(color, S = SKY_LOOK.meteors, listed = color) {
  const base = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }` };
  // The trail: near white at the head, its color building up towards the tail, where the hue has drifted (tailSat, tailHue).
  const hsl = listed.getHSL({}), sat = hsl.s * (S.tailSat ?? 1);
  const mid = new THREE.Color().setHSL(hsl.h, sat, hsl.l);
  const tail = new THREE.Color().setHSL((hsl.h + S.tailHue + 1) % 1, sat, hsl.l);
  const trailMat = new THREE.ShaderMaterial({ ...base, blending: THREE.NormalBlending,   // (added light would turn warm colors pale on the blue sky)
    uniforms: { uMid: { value: mid }, uTail: { value: tail }, uAlpha: { value: 0 }, uGlow: { value: S.glow },
      uWhiteFrom: { value: S.whiteFrom ?? 0.5 }, uFade: { value: S.tailFade ?? 1.8 } },
    fragmentShader: `uniform vec3 uMid, uTail; uniform float uAlpha, uGlow, uWhiteFrom, uFade; varying vec2 vUv;
      void main(){
        float along = vUv.x, across = (vUv.y - 0.5) * 2.0 / mix(0.6, 1.0, along);   // a little thinner towards the tail
        float core = exp(-across * across * 45.0), glow = exp(-across * across * 6.0) * uGlow;
        float fade = pow(along, uFade);   // fades out smoothly towards the tail
        vec3 hue = mix(uTail, uMid, smoothstep(0.15, uWhiteFrom + 0.1, along));
        float white = smoothstep(uWhiteFrom, 1.0, along);                          // no color left at the head
        white = max(white, core * along * 0.35);
        gl_FragColor = vec4(mix(hue, vec3(1.0), white), min(1.0, core + glow) * fade * uAlpha);
      }`,
  });
  // A comet's body (S.star): a white-hot point with four long soft points, in a round colored glow.
  const headMat = new THREE.ShaderMaterial({ ...base,
    uniforms: { uColor: { value: color }, uAlpha: { value: 0 }, ...(S.star && { uRays: { value: S.star.rays }, uThin: { value: S.star.thin } }) },
    fragmentShader: S.star ? `uniform vec3 uColor; uniform float uAlpha, uRays, uThin; varying vec2 vUv;
      void main(){
        vec2 p = abs(vUv - 0.5) * 2.0;
        float d = length(p), edge = 1.0 - smoothstep(0.75, 1.0, d);
        float rays = (exp(-p.y * uThin - p.x * uRays) + exp(-p.x * uThin - p.y * uRays)) * edge;
        float core = exp(-d * d * 220.0), halo = exp(-d * d * 14.0) * 0.6 * edge;
        float white = clamp(core + rays * 0.9, 0.0, 1.0);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), white), clamp(core + rays + halo, 0.0, 1.0) * uAlpha);
      }` : `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float core = exp(-d * d * 90.0), halo = exp(-d * d * 9.0) * 0.75 * (1.0 - smoothstep(0.8, 1.0, d));
        gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.7), max(core, halo) * uAlpha);   // white-hot point in a colored glow
      }`,
  });
  return { trailMat, headMat };
}

const _pathP = new THREE.Vector3();
function spawnMeteor(S = SKY_LOOK.meteors) {
  const { w, h } = layers.sky;
  const listed = new THREE.Color().setStyle(randomOf(S.colors), THREE.LinearSRGBColorSpace), hsl = listed.getHSL({});   // shown as listed, not darkened
  const color = new THREE.Color().setHSL(hsl.h, hsl.s * S.soften, hsl.l);   // the head's glow, its sparks and dust: pale
  const { trailMat, headMat } = meteorMats(color, S, listed);
  const obj = new THREE.Group(), trail = new THREE.Mesh(TRAIL_GEO, trailMat), head = new THREE.Mesh(HEAD_GEO, headMat);
  trail.renderOrder = 2.2; head.renderOrder = 2.25;
  obj.add(trail, head);
  // It crosses a frame facing the camera, the sky's depth ahead of it, wherever the scope points (the sky dome goes
  // all the way round); its own position below is in that frame.
  const frame = new THREE.Group();
  camera.updateMatrixWorld(); meteorLayer.updateMatrixWorld();
  frame.position.copy(camera.getWorldPosition(new THREE.Vector3()).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(DEPTH.sky)));
  meteorLayer.worldToLocal(frame.position);
  frame.quaternion.copy(meteorLayer.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(camera.quaternion));
  frame.add(obj);
  // how many screen heights one unit in the frame spans now (the view's zooms included), so the speed is on screen
  meteorLayer.add(frame); frame.updateMatrixWorld(true);
  const p0 = frame.localToWorld(new THREE.Vector3()).project(camera), p1 = frame.localToWorld(new THREE.Vector3(0, 1, 0)).project(camera);
  const perUnit = Math.max(1e-4, Math.abs(p1.y - p0.y) / 2);

  const slow = Math.random() < S.slow.share ? S.slow.speed : 1;
  const speed = lerp(S.speed) * slow / perUnit;
  const life = lerp(S.life) / slow;
  // On the rooftop in the lower sky, a quarter of the screen above its middle; after Pan Up around the middle.
  const yCenter = THREE.MathUtils.lerp(0.25, 0, crane.value) * h;
  const travel = speed * life * 0.5;
  let vx, vy;
  const pickPath = () => {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const angle = THREE.MathUtils.degToRad(lerp(S.angle ?? [15, 50]));   // heading downwards
    vx = dir * Math.cos(angle); vy = -Math.sin(angle);
    obj.position.set((Math.random() - 0.5) * w * 0.9 - vx * travel, yCenter + (Math.random() - 0.5) * 0.5 * h - vy * travel, 1);
  };
  pickPath();
  if (S.pathTries) {   // rare, so not to be wasted: of a few paths, take the one longest in the open sky on screen
    const seenOn = () => {
      let n = 0;
      for (let k = 0.1; k < 1; k += 0.1) {
        _pathP.set(obj.position.x + vx * speed * life * k, obj.position.y + vy * speed * life * k, 1);
        frame.localToWorld(_pathP);
        const above = layers.sky.aboveRoofs ? layers.sky.aboveRoofs(_pathP) : 1;
        _pathP.project(camera);
        if (above > SKY_LOOK.meteors.fadeGap + SKY_LOOK.meteors.fadeBand && Math.abs(_pathP.x) < 0.95 && Math.abs(_pathP.y) < 0.95) n++;
      }
      return n;
    };
    let best = { n: seenOn(), vx, vy, pos: obj.position.clone() };
    for (let i = 1; i < S.pathTries; i++) {
      pickPath();
      const n = seenOn();
      if (n > best.n) best = { n, vx, vy, pos: obj.position.clone() };
    }
    ({ vx, vy } = best); obj.position.copy(best.pos);
  }
  obj.rotation.z = Math.atan2(vy, vx);
  head.rotation.z = -obj.rotation.z;   // a comet's star stands upright whatever its heading
  meteors.push({ look: S, obj, frame, trail, head, trailMat, headMat, vx, vy, speed, life, age: 0, popT: -1, len: w * lerp(S.len),
    width: w * S.width, trailW: w * S.width * 9, headSize: w * S.headSize, sparkSize: w * (S.sparkSize ?? S.headSize) });   // trailW: room for the glow around the thin core
}

// A comet: a rarer, slower, bigger shooting star with a star for a body (SKY_LOOK.comets). One at a time.
const spawnComet = () => spawnMeteor(SKY_LOOK.comets);
const cometFlying = () => meteors.some(m => m.look === SKY_LOOK.comets);

// Popping: tap a shooting star and it flashes and bursts into a few soft sparks that drift out and fade, with a
// quiet chime (SKY_LOOK.meteors.popR / sparks / sparkSec). Just for delight. Runs before the other taps on the
// canvas (capture) and marks the tap as used (preventDefault), so it doesn't also walk, drag or tap a star.
// meteorCalm.on (constellation.js, while a constellation shows): none set off, those in flight fade and can't be popped,
// so none crosses the constellation or takes a tap meant for its stars.
const meteorCalm = { on: false };
const sparks = [];
let poppedAt = -1;
const poppedRecently = () => performance.now() - poppedAt < 400;
const _p = new THREE.Vector3();
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || meteorCalm.on || !meteorLayer?.visible || !settings.shootingStars || !meteors.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  let best = null, bestD = Infinity;
  camera.updateMatrixWorld();
  for (const m of meteors) {
    if (m.popT >= 0 || m.headMat.uniforms.uAlpha.value < 0.15) continue;
    m.head.getWorldPosition(_p).project(camera);
    const d = Math.hypot((_p.x + 1) / 2 * rect.width - (e.clientX - rect.left), (1 - _p.y) / 2 * rect.height - (e.clientY - rect.top));
    if (d < m.look.popR * rect.height && d < bestD) { bestD = d; best = m; }
  }
  if (!best) return;
  e.preventDefault();
  poppedAt = performance.now();
  popMeteor(best);
}, { capture: true });

function popMeteor(m) {
  const S = m.look, color = m.headMat.uniforms.uColor.value;
  m.popT = 0;
  const f = m.frame.clone(false);   // the sparks drift in the shooting star's frame (which goes when it does)
  meteorLayer.add(f);
  for (let i = 0; i < S.sparks; i++) {
    const { headMat } = meteorMats(color.clone()), mesh = new THREE.Mesh(HEAD_GEO, headMat);
    mesh.renderOrder = 2.26;
    mesh.position.copy(m.obj.position);
    f.add(mesh);
    const a = (i + Math.random() * 0.6) / S.sparks * Math.PI * 2, sp = m.sparkSize * (4 + Math.random() * 4);
    sparks.push({ mesh, mat: headMat, vx: Math.cos(a) * sp + m.vx * m.speed * 0.08, vy: Math.sin(a) * sp + m.vy * m.speed * 0.08,
      age: 0, life: S.sparkSec * (0.7 + Math.random() * 0.6), size: m.sparkSize * (0.35 + Math.random() * 0.3) });
  }
  const note = 6 + Math.floor(Math.random() * 3);
  chime(note, 0.32, 0, 0.8); shimmer(note);
}

function updateSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.age += dt;
    const t = s.age / s.life;
    if (t >= 1) {
      const f = s.mesh.parent; f.remove(s.mesh); s.mat.dispose(); sparks.splice(i, 1);
      if (!f.children.length) meteorLayer.remove(f);
      continue;
    }
    const slow = Math.exp(-s.age * 2.5);   // drift out, slowing softly
    s.mesh.position.x += s.vx * slow * dt;
    s.mesh.position.y += s.vy * slow * dt;
    s.mesh.scale.setScalar(s.size * (1 - 0.5 * t));
    s.mat.uniforms.uAlpha.value = Math.min(1, s.age / 0.08) * Math.pow(1 - t, 1.5);
  }
}

const _headPos = new THREE.Vector3();
function updateMeteors(dt) {
  if (!meteorLayer) return;
  meteorLayer.visible = bts.e < 0.001;
  if (settings.shootingStars && !meteorCalm.on && Math.random() < settings.shootingRate / 60 * dt) spawnMeteor();
  if (settings.shootingStars && !meteorCalm.on && !cometFlying() && Math.random() < settings.cometRate / 60 * dt) spawnComet();
  updateSparks(dt);
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.age += dt;
    const t = m.age / m.life;
    if (m.popT >= 0) m.popT += dt;
    if (t >= 1 || m.popT > 0.35) {
      meteorLayer.remove(m.frame); m.trailMat.dispose(); m.headMat.dispose();
      meteors.splice(i, 1);
      continue;
    }
    m.obj.visible = settings.shootingStars;   // switched off: hide the ones in flight
    m.obj.position.x += m.vx * m.speed * dt;
    m.obj.position.y += m.vy * m.speed * dt;
    let env = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.3);
    if (layers.sky.aboveRoofs) {   // soft fade before the roofs as they show on screen (SKY_LOOK.meteors.fadeGap / fadeBand)
      const M = SKY_LOOK.meteors;
      const above = layers.sky.aboveRoofs(m.head.getWorldPosition(_headPos)) - M.fadeGap;
      const k = Math.min(1, Math.max(0, above / M.fadeBand));
      env *= k * k * (3 - 2 * k);
      if (above <= 0 && m.age > 0.1 && !m.look.pathTries) m.age = m.life;   // fully faded: done (it's past the line and won't come back; a comet's shallow path may pass behind a tower and come out again)
    }
    const pop = m.popT >= 0 ? m.popT / 0.35 : 0;   // popped: the head flashes up and the whole star fades out
    if (pop) env *= 1 - pop * pop;
    if (meteorCalm.on) m.hush = Math.min(1, (m.hush ?? 0) + dt / 0.4);   // once hushed it stays faded until it ends
    if (m.hush) env *= 1 - m.hush * m.hush;
    m.trail.scale.set(m.len * Math.min(1, t / 0.25) + 1e-3, m.trailW, 1);   // the trail grows out behind the head
    const breathe = 1 + (m.look.star?.breathe ?? 0) * Math.sin(m.age * 2.2);
    m.head.scale.setScalar(m.headSize * breathe * (1 + 1.6 * Math.sin(Math.PI * Math.min(1, pop * 1.4)) + 0.4 * pop));
    m.trailMat.uniforms.uAlpha.value = env;
    m.headMat.uniforms.uAlpha.value = env;
  }
}

export { poppedRecently, meteorCalm, SKY_STAR_CONTROLS, setSkyStarLook, setSkyDotAmount, setStarFieldAmount, setSkyStarBlend, nodeStarTexture, starFields, setStarsVisible, pickStar, addStars, TRAIL_GEO, HEAD_GEO, meteors, meteorLayer, initMeteors, spawnMeteor, spawnComet, updateMeteors };
