// Sky look ("Concept" art direction): sky gradient + tints, and a Milky Way band with
// star dust through the constellation field (always visible). Values in SKY_LOOK (config.js).
import * as THREE from 'three';
import { DEPTH, SKY_DOME, SKY_LOOK } from './config.js';
import { layerAttach, layers, softDot } from './layers.js';
import { bts } from './bts.js';
import { fxMats, scaledPointMats } from './effects.js';
import { skyFieldPoint } from './anchors.js';

const sky = { nebula: null, dust: null, patch: null };

// The Milky Way, its dust and the nebula cloud hang in this group: the rig turns it as a whole for the sky parallax
// (SKY_PARALLAX.milkyWay), apart from the constellations and chart beside it in the same attach group.
function farGroup() {
  const item = layers.sky;
  if (!item.far) { item.far = new THREE.Group(); layerAttach(item).add(item.far); }
  return item.far;
}

const NOISE_GLSL = `float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.07; a *= 0.5; } return v; }
      uniform float uTime, uDrift, uBreathe, uBreatheAmt;
      // Slow gas flow: a drifting warp field the cloud noise is sampled through (no boil, minutes per cycle).
      vec2 flowWarp(vec2 p, float seed){ vec2 f = vec2(1.0, 0.6) * uTime * uDrift;
        return vec2(fbm(p * 1.5 + f + seed), fbm(p * 1.5 - f + seed + 5.2)) - 0.5; }
      // Bright wisps breathe in and out, each patch of sky at its own phase.
      float breathe(vec2 p){ return 1.0 + uBreatheAmt * sin(uTime * 6.2832 / uBreathe + fbm(p * 1.2 + 11.0) * 12.0); }`;
// Motion uniforms shared by both nebulas (values from SKY_LOOK.nebula.motion).
function motionUniforms() {
  const m = SKY_LOOK.nebula.motion;
  return { uTime: { value: 0 }, uDrift: { value: m.drift }, uBreathe: { value: m.breathe }, uBreatheAmt: { value: m.breatheAmt } };
}

// Milky Way: soft violet-blue noise glow along a diagonal through the constellation field.
function buildNebula() {
  const item = layers.sky, d = DEPTH.sky, n = SKY_LOOK.nebula;
  // Centred on the constellation field (23° up), reaching down to the skyline.
  const mid = skyFieldPoint(0, 23, d), lo = skyFieldPoint(0, 8, d), w = item.w * 1.3, h = 2 * (mid.y - lo.y);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: new THREE.Color(n.a) }, uB: { value: new THREE.Color(n.b) }, uGlow: { value: new THREE.Color(n.glow) },
      uStrength: { value: n.strength }, uAspect: { value: w / h }, ...motionUniforms() },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uA, uB, uGlow; uniform float uStrength, uAspect; varying vec2 vUv;
      ${NOISE_GLSL}
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        vec2 dir = normalize(vec2(1.0, 0.45));                  // band rises from lower left to upper right
        float across = dot(p, vec2(-dir.y, dir.x)) + 0.06 * sin(p.x * 2.3);
        float band = exp(-across * across / 0.045);
        vec2 w = flowWarp(p, 0.0), f = vec2(1.0, 0.6) * uTime * uDrift;
        float n = fbm(p * 3.0 + 7.0 + w * 0.5 + f * 0.5), n2 = fbm(p * 7.0 - 3.0 + w * 0.8 - f);
        vec3 col = mix(uB, uA, n);
        col = mix(col, uGlow, clamp(smoothstep(0.55, 0.85, n2) * band * breathe(p), 0.0, 1.0));  // brighter wisps along the core
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
        float a = band * (0.35 + 0.65 * n) * edge * uStrength;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  fxMats.push(mat);
  sky.nebula = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  sky.nebula.position.set(0, mid.y, 0.45);
  sky.nebula.renderOrder = 2.05;
  farGroup().add(sky.nebula);

  // Star dust, concentrated in the band.
  const N = n.dustCount, pos = new Float32Array(N * 3), dir = new THREE.Vector2(1, 0.45).normalize();
  for (let i = 0; i < N; i++) {
    const along = (Math.random() - 0.5) * w, across = (Math.random() + Math.random() + Math.random() - 1.5) * h * 0.18;
    pos.set([dir.x * along - dir.y * across, mid.y + dir.y * along + dir.x * across, 0.46], i * 3);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sky.dust = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, map: softDot(), color: n.dust,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
  sky.dust.renderOrder = 2.06;
  scaledPointMats.push({ mat: sky.dust.material, size: 2.2 });   // sized with the game view (effects.js)
  farGroup().add(sky.dust);
}

// Live values of the dome's Milky Way: its colors follow the sky scheme (pickSkyColor); the rest from SKY_LOOK.nebula.band.
const milky = {
  uDeep: { value: new THREE.Color() }, uRibbon: { value: new THREE.Color() }, uRibbonHi: { value: new THREE.Color() }, uWarm: { value: new THREE.Color() },
  uStrength: { value: SKY_LOOK.nebula.band.strength }, uWidth: { value: SKY_LOOK.nebula.band.width }, uDeepAmt: { value: SKY_LOOK.nebula.band.deepAmt },
  uRibbonAmt: { value: SKY_LOOK.nebula.band.ribbonAmt }, uWarmAmt: { value: SKY_LOOK.nebula.band.warmAmt },
  uElFade: { value: new THREE.Vector2(...SKY_LOOK.nebula.fade.map(THREE.MathUtils.degToRad)) },
  uEdgeGrain: { value: SKY_LOOK.nebula.edges.grain }, uEdgeHard: { value: new THREE.Vector4(...SKY_LOOK.nebula.edges.hard) },
  uP: { value: new THREE.Vector3() }, uT: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() }, scheme: null, s: 1, addStars: null,
};
function showMilkyColors(name) {
  const c = SKY_LOOK.nebula.schemes[name];
  milky.scheme = name;
  if (!c) return;
  milky.uDeep.value.setStyle(c.deep, THREE.LinearSRGBColorSpace);   // (the colors go on screen as listed)
  milky.uRibbon.value.setStyle(c.ribbon, THREE.LinearSRGBColorSpace);
  milky.uRibbonHi.value.setStyle(c.ribbonHi, THREE.LinearSRGBColorSpace);
  milky.uWarm.value.setStyle(c.warm, THREE.LinearSRGBColorSpace);
}
function setMilkyColor(scheme, key, hex) {
  SKY_LOOK.nebula.schemes[scheme][key] = hex;
  if (milky.scheme === scheme) showMilkyColors(scheme);
}
function setMilkyFade(from, full) {
  SKY_LOOK.nebula.fade = [from, full];
  milky.uElFade.value.set(THREE.MathUtils.degToRad(from), THREE.MathUtils.degToRad(full));
}
// The band's stars' own look on top of the shared one (stars.js addStars look; the tint hues are the band's strand and
// cloud colors, so they follow the scheme too).
const milkyStarLook = (() => {
  const S = SKY_LOOK.nebula.stars;
  return { uFDotSize: { value: S.dotSize }, uFDotBright: { value: S.dotBright }, uFTwShare: { value: S.twAmount }, uFTwSize: { value: S.twSize }, uFTwCross: { value: S.twCross },
    uFTwBright: { value: S.twBright }, uFTint: { value: S.tint }, uFTintA: { value: milky.uRibbonHi.value }, uFTintB: { value: milky.uWarm.value } };
})();
// The band's course: P = its highest point (peak degrees up, towards az), N = square to its circle, T = along it.
function milkyArc(peak, az) {
  SKY_LOOK.nebula.arc.peak = peak; SKY_LOOK.nebula.arc.az = az;
  const p = THREE.MathUtils.degToRad(peak), a = THREE.MathUtils.degToRad(az);
  milky.uP.value.set(Math.cos(p) * Math.sin(a), Math.sin(p), -Math.cos(p) * Math.cos(a));
  milky.uN.value.set(-Math.sin(p) * Math.sin(a), Math.cos(p), Math.sin(p) * Math.cos(a));
  milky.uT.value.crossVectors(milky.uN.value, milky.uP.value);
}
// Edge looks of the four layers (Dev sky → Milky Way edges): i = 0 body, 1 glow, 2 clumps, 3 clouds.
function setMilkyEdge(key, v, i) {
  const E = SKY_LOOK.nebula.edges;
  if (key === 'grain') { E.grain = milky.uEdgeGrain.value = v; return; }
  E.hard[i] = v; milky.uEdgeHard.value.setComponent(i, v);
}
function setMilkyOn(on) {
  SKY_LOOK.nebula.on = on;
  if (layers.sky?.far) layers.sky.far.visible = on;
}
// How far the band's centre line wanders off the great circle at x (flat-sky units along it); shader and stars share it.
const milkyMeander = x => 0.1 * Math.sin(x * 1.1 + 1) + 0.05 * Math.sin(x * 2.7);

// The Milky Way on the sky dome (SKY_DOME.on): a great circle all the way around, arching up to its highest point
// (SKY_LOOK.nebula.arc, milkyArc). Soft shapes only (as in NightSky/references/milkyway/390e2bfa…): a dark body that covers the sky a little,
// a narrower mottled band of light with small bright clumps and dark dust, and soft warm clouds, in the colors of the trip's sky scheme. Laid over the sky (no added light),
// so dark colors can darken it. Opposite its highest point (below the horizon) the two ends of the noise meet: they blend over the last 0.6 rad.
// It fades in above the high wisps (SKY_LOOK.nebula.fade). Its stars are real background stars (addStars), just more of them.
function buildNebulaDome(addStars) {
  const item = layers.sky, d = DEPTH.sky, n = SKY_LOOK.nebula, R = SKY_DOME.radius;
  const mid = skyFieldPoint(0, 23, d), lo = skyFieldPoint(0, 8, d), w = item.w * 1.3, h = 2 * (mid.y - lo.y);
  const dirOf = (x, y) => new THREE.Vector3(x, y, -d).normalize();   // a point on the flat sky, seen from the dome's centre
  milkyArc(n.arc.peak, n.arc.az);
  const s = mid.clone().setZ(-d).length() / h;   // p units per radian (the old flat band's height straight ahead)
  milky.s = s;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, blending: THREE.NormalBlending, premultipliedAlpha: true,
    uniforms: { ...Object.fromEntries(Object.entries(milky).filter(([k]) => k[0] === 'u')), uS: { value: s }, ...motionUniforms() },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uDeep, uRibbon, uRibbonHi, uWarm, uP, uT, uN;
      uniform float uStrength, uWidth, uDeepAmt, uRibbonAmt, uWarmAmt, uS; uniform vec2 uElFade; varying vec3 vDir;
      uniform float uEdgeGrain; uniform vec4 uEdgeHard;   // edges: grain; hardness per layer (body, glow, clumps, clouds)
      ${NOISE_GLSL}
      float soft(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.07 + vec2(3.1, 1.7); a *= 0.5; } return v / 0.875; }
      // A layer's edge from soft (h 0: as it is) to a crisp cut at 0.4 (h 1); g = grain, ragging the cut like a dry brush.
      float harden(float v, float h, float g){
        if (h <= 0.0) return v;
        float w = 0.4 * (1.0 - h) + 0.008;
        return mix(v, smoothstep(0.4 - w, 0.4 + w, v + g * h), h);
      }
      vec4 over(vec4 under, vec3 col, float a){ return vec4(under.rgb * (1.0 - a) + col * a, under.a + a - under.a * a); }
      vec4 band(float al, float ac){
        float x = al * uS, y = ac * uS + 0.1 * sin(x * 1.1 + 1.0) + 0.05 * sin(x * 2.7), W = uWidth;   // (milkyMeander)
        vec2 p = vec2(x, y), f = vec2(1.0, 0.6) * uTime * uDrift;
        vec2 q = p + 0.3 * W * (vec2(soft(p * 2.4 + f + 2.0), soft(p * 2.4 - f + 7.2)) - 0.5) * 4.0;   // slow gas flow
        float glow = 1.0 + uBreatheAmt * sin(uTime * 6.2832 / uBreathe + soft(p * 0.9 + 11.0) * 12.0);
        vec2 m = q / W;                                                // shapes sized by the band's width, a little longer along it
        float g = uEdgeGrain > 0.0 ? (noise(q / W * vec2(5.0, 11.0) + 71.0) - 0.5) * uEdgeGrain * 0.6 : 0.0;   // brush grain on hard edges
        float yy = y / (W * (0.8 + 0.4 * soft(vec2(x * 1.2 + 5.0, 1.3))));   // the band's edge swelling and narrowing along it
        float body = harden(exp(-yy * yy / 2.25) * (0.6 + 0.4 * soft(m * vec2(0.6, 0.9) + 4.0)), uEdgeHard.x, g);   // the dark body
        float core = exp(-yy * yy * 1.4);                              // the band of light, narrower
        float dust = smoothstep(0.5, 0.85, soft(m * vec2(1.1, 1.7) + 31.0)) * core;                 // dark dust patches in it
        float light = harden(core * (0.45 + 0.55 * smoothstep(0.2, 0.85, soft(m * vec2(0.9, 1.4) + 3.0))), uEdgeHard.y, g) * (1.0 - 0.6 * dust);   // mottled glow
        float hi = harden(core * smoothstep(0.45, 0.9, soft(m * vec2(1.8, 2.6) + 9.0)), uEdgeHard.z, g) * (1.0 - dust);   // small brighter clumps
        float yw = y - 0.2 * W;
        float warm = harden(smoothstep(0.5, 0.88, soft(m * vec2(1.5, 2.2) + 13.0 + f * 0.5)) * exp(-yw * yw / (W * W * 0.5))
          * smoothstep(0.2, 0.9, soft(m * 3.0 + 21.0)), uEdgeHard.w, g) * (1.0 - 0.5 * dust);   // small soft clouds
        vec4 c = vec4(uDeep, 1.0) * uDeepAmt * body;
        c = over(c, uRibbon, uRibbonAmt * light);
        c = over(c, uRibbonHi, clamp(uRibbonAmt * 0.8 * hi * glow, 0.0, 1.0));
        return over(c, uWarm, clamp(uWarmAmt * warm * glow, 0.0, 1.0));
      }
      void main(){
        vec3 v = normalize(vDir);
        float ac = asin(clamp(dot(v, uN), -1.0, 1.0)), al = atan(dot(v, uT), dot(v, uP));
        if (abs(ac) * uS > uWidth * 4.0 + 0.2) discard;           // far off the band: nothing to draw
        if (asin(clamp(v.y, -1.0, 1.0)) < uElFade.x) discard;      // below where it starts
        vec4 c = band(al, ac);
        float k = 0.5 * smoothstep(3.1416 - 0.6, 3.1416, abs(al));
        if (k > 0.0) c = mix(c, band(al - sign(al) * 6.2832, ac), k);
        c = min(c * smoothstep(uElFade.x, uElFade.y, asin(clamp(v.y, -1.0, 1.0))) * uStrength, 1.0);
        float dither = (hash(gl_FragCoord.xy) - 0.5) / 128.0 * step(0.002, c.a);   // against banding in the dark blues
        gl_FragColor = vec4(c.rgb + dither * c.a, c.a);
      }`,
  });
  fxMats.push(mat);
  sky.nebula = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 48), mat);
  sky.nebula.position.set(0, 0, d);   // the dome's centre: where the camera rests (the attach group lies on the sky plane)
  sky.nebula.renderOrder = 2.05;
  sky.nebula.frustumCulled = false;
  farGroup().add(sky.nebula);

  milky.addStars = addStars;
  placeMilkyStars();
}

// Its stars: the background stars' own dots and twinkles, bunched around the centre line, unevenly along it. They turn
// with the band (rigid), so they stay on it. Placed anew when its course, width or start height changes (Dev sky).
function placeMilkyStars() {
  const n = SKY_LOOK.nebula, R = SKY_DOME.radius, d = DEPTH.sky, s = milky.s, P = milky.uP.value, T = milky.uT.value, N = milky.uN.value;
  const [from, full] = n.fade.map(THREE.MathUtils.degToRad);
  const old = sky.dust;
  if (old) {
    old.removeFromParent(); old.geometry.dispose(); old.material.dispose();
    fxMats.splice(fxMats.indexOf(old.material), 1);
  }
  sky.dust = milky.addStars({
    count: n.stars.count, order: 2.06, parent: farGroup(), rigid: true, amount: n.stars.amount, look: milkyStarLook,
    place: (v) => {
      for (let tries = 0; tries < 30; tries++) {
        const al = (Math.random() - 0.5) * 2 * Math.PI, x = al * s;
        const c = n.stars.clump, bunch = 0.5 + 0.5 * Math.sin(x * 1.3 + 2) * Math.sin(x * 3.1 + 1) + 0.25 * Math.sin(x * 7.7);
        if (Math.random() > 1 - c + c * bunch) continue;
        const reach = Math.random() < n.stars.edgeShare ? n.stars.edgeSpread : n.stars.spread;   // the sparse outer stars or the dense middle
        const y = (Math.random() + Math.random() + Math.random() - 1.5) * 1.4 * n.band.width * reach, ac = (y - milkyMeander(x)) / s;
        v.copy(P).multiplyScalar(Math.cos(al)).addScaledVector(T, Math.sin(al)).multiplyScalar(Math.cos(ac)).addScaledVector(N, Math.sin(ac));
        if (Math.random() > THREE.MathUtils.smoothstep(Math.asin(v.y), from, full)) continue;   // thinning in like the band
        v.set(v.x * R, v.y * R, d + v.z * R);
        return true;
      }
      return false;
    },
  });
  fxMats.push(sky.dust.material);
  return old;   // (the caller drops it from stars.js starFields)
}

// A faint, separate nebula cloud elsewhere in the sky, so the view reads as a wider piece of night sky.
function buildPatch() {
  const item = layers.sky, n = SKY_LOOK.nebula, c = n.patch;
  const at = skyFieldPoint(c.az, c.el, DEPTH.sky), w = item.w * c.size, h = w * c.aspect;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: new THREE.Color(n.a) }, uB: { value: new THREE.Color(n.b) }, uGlow: { value: new THREE.Color(c.glow) },
      uStrength: { value: c.strength }, uAspect: { value: 1 / c.aspect }, uSeed: { value: c.seed }, ...motionUniforms() },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uA, uB, uGlow; uniform float uStrength, uAspect, uSeed; varying vec2 vUv;
      ${NOISE_GLSL}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        vec2 w = flowWarp(p, uSeed);
        vec2 q = p + 0.35 * vec2(fbm(p * 1.6 + uSeed), fbm(p * 1.6 - uSeed)) - 0.17 + w * 0.15;   // warp the outline into a cloud
        float blob = exp(-dot(q, q) * 1.7);
        vec2 s = p * vec2(uAspect, 1.0);
        float n = fbm(s * 2.2 + uSeed + w * 0.6), n2 = fbm(s * 5.0 - uSeed + w * 0.9);
        vec3 col = mix(uB, uA, n);
        col = mix(col, uGlow, clamp(smoothstep(0.55, 0.85, n2) * blob * breathe(p + uSeed), 0.0, 1.0));
        float a = blob * smoothstep(0.2, 0.8, n) * (1.0 - smoothstep(0.6, 1.0, length(p))) * uStrength;
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  fxMats.push(mat);
  sky.patch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  sky.patch.position.set(at.x, at.y, 0.44);
  sky.patch.rotation.z = THREE.MathUtils.degToRad(c.tilt);
  sky.patch.renderOrder = 2.04;
  sky.patch.visible = c.on !== false;
  farGroup().add(sky.patch);
}

// Color in the high sky (SKY_LOOK.color): big soft flowing shapes laid over the blue, behind the stars and the painted
// sky, one scheme per trip to the sky (pickSkyColor, while on the roof, where none of it shows). No noise: warped sines,
// so large smooth forms and no cloud detail. Below `from` degrees of elevation the sky is exactly as painted.
const skyColor = {
  uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uSeed: { value: new THREE.Vector3() },
  uHueA: { value: new THREE.Color() }, uHueB: { value: new THREE.Color() },   // this trip's two star hues (stars.js)
  uStrength: { value: SKY_LOOK.color.strength }, uFrom: { value: 0 }, uFull: { value: 0 }, uAmount: { value: new THREE.Vector2(...SKY_LOOK.color.amount) },
  scheme: 'auto',
};
const setSkyColorFade = (from, full) => {
  SKY_LOOK.color.from = from; SKY_LOOK.color.full = full;
  skyColor.uFrom.value = THREE.MathUtils.degToRad(from); skyColor.uFull.value = THREE.MathUtils.degToRad(full);
};
// The shapes in a direction v on the dome: color and how far it covers the blue.
const SKY_SHAPES_GLSL = `uniform vec3 uA, uB, uSeed; uniform float uStrength, uFrom, uFull; uniform vec2 uAmount;
      vec4 skyShapes(vec3 v){
        float high = smoothstep(uFrom, uFull, asin(clamp(v.y, -1.0, 1.0)));
        if (high <= 0.0) return vec4(0.0);
        vec3 w = v + 0.4 * vec3(sin(v.y * 2.3 + v.z * 1.7 + uSeed.x), sin(v.z * 2.1 + v.x * 1.9 + uSeed.y), sin(v.x * 2.5 + v.y * 1.3 + uSeed.z));
        float wash = 0.5 + 0.5 * sin(dot(w, vec3(0.8, 0.5, -0.6)) * 2.4 + uSeed.y);                                // the big gradient
        float flow = 0.5 + 0.5 * sin(dot(w, vec3(-0.5, 0.7, 0.7)) * 2.2 + uSeed.z + 1.6 * sin(dot(w, vec3(0.7, -0.3, 0.8)) * 1.6 + uSeed.x));   // a flowing shape in it
        float a = 0.3 + 0.7 * smoothstep(0.2, 0.9, wash), b = smoothstep(0.25, 0.95, flow) * smoothstep(0.1, 0.7, wash);   // (a faint wash everywhere up here, so every view has some)
        return vec4(mix(uA, uB, b / max(0.001, b + a * (1.0 - b))), (a * uAmount.x + b * uAmount.y * (1.0 - a * uAmount.x)) * high * uStrength);
      }`;
// A new scheme and a new layout of its shapes. `skyColor.scheme` 'auto' = either scheme by chance; else that one.
function pickSkyColor() {
  const names = Object.keys(SKY_LOOK.color.schemes);
  const name = skyColor.scheme in SKY_LOOK.color.schemes ? skyColor.scheme : names[Math.floor(Math.random() * names.length)];
  const s = SKY_LOOK.color.schemes[name];
  skyColor.uA.value.setStyle(s.a, THREE.LinearSRGBColorSpace);   // (the colors go on screen as listed)
  skyColor.uB.value.setStyle(s.b, THREE.LinearSRGBColorSpace);
  skyColor.uHueA.value.setStyle(s.stars[0], THREE.LinearSRGBColorSpace);
  skyColor.uHueB.value.setStyle(s.stars[1], THREE.LinearSRGBColorSpace);
  showMilkyColors(name);
  skyColor.uSeed.value.set(Math.random(), Math.random(), Math.random()).multiplyScalar(6.2832);
  return name;
}
function buildSkyColor() {
  const { uA, uB, uSeed, uStrength, uFrom, uFull, uAmount } = skyColor, C = SKY_LOOK.color;
  setSkyColorFade(C.from, C.full);
  pickSkyColor();
  const uShow = { value: 1 };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false,   // lays its hue over the sky, adds no light
    uniforms: { uA, uB, uSeed, uStrength, uFrom, uFull, uAmount, uShow },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uShow; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      ${SKY_SHAPES_GLSL}
      void main(){
        vec4 s = skyShapes(normalize(vDir));
        if (s.a <= 0.0) discard;
        float alpha = s.a * uShow;
        gl_FragColor = vec4(s.rgb, alpha + (hash(gl_FragCoord.xy) - 0.5) / 128.0 * step(0.002, alpha));            // dither against banding
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_DOME.radius, 48, 24), mat);
  mesh.position.set(0, 0, DEPTH.sky);   // on the same dome as the background stars
  mesh.renderOrder = 0.5;               // straight on the sky gradient: stars and the painted sky go over it
  mesh.frustumCulled = false;
  mesh.onBeforeRender = () => { uShow.value = 1 - bts.e; };   // not in Behind the Scenes
  layerAttach(layers.sky).add(mesh);    // (the attach group lies on the sky plane, so the dome's centre is where the camera rests)
}

// Called by the scene build, after the sky dome and the sky / city layers exist. addStars from stars.js (which imports
// this module, so it is handed in).
function applySkyLook(addStars) {
  const L = SKY_LOOK, d = bts.dome.uniforms;
  d.uZenith.value.set(L.zenith);
  d.uHorizon.value.multiply(new THREE.Color(L.skyTint));
  layers.sky.obj.material.color.set(L.skyTint);
  for (const n of ['city', 'cityFar']) layers[n].obj.material.color.set(L.cityTint);
  if (SKY_DOME.on) buildNebulaDome(addStars); else buildNebula();
  buildPatch();
  farGroup().visible = L.nebula.on;
  buildSkyColor();
}

export { sky, applySkyLook, skyColor, pickSkyColor, setSkyColorFade, milky, milkyArc, milkyStarLook, placeMilkyStars, setMilkyColor, setMilkyEdge, setMilkyFade, setMilkyOn };
