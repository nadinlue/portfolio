// Star delivery (A4): after a constellation's stars have gathered into one point, the collected star
// itself appears there — a soft flash, a pop with a little wobble, a gentle hover — and then flies in a
// curve down to its net, trailing sparkles. On arrival the net star pops in (netStars.landStar) with a
// warm note. Drawn as an overlay just in front of the camera, positioned in screen space, so the flight
// can cross from the far sky to the near poles without any perspective jumps.
// Timing and sizes in STAR_DELIVERY (config.js).
import * as THREE from 'three';
import { COLLECT, NETS, NET_STAR, STAR_DELIVERY, STAR_FAMILIES } from './config.js';
import { camera, renderer, scene, viewport } from './core.js';
import { aim, bakeAimOff, crane, skyZoom, view } from './rig.js';
import { familyTexture, landStar, netTarget } from './netStars.js';
import { chime } from './chime.js';
import { layers } from './layers.js';
import { eyepieceOn } from './vignette.js';
import { starRecords } from './starRecords.js';

const D = 2;               // overlay distance in front of the camera (world units, beyond the near plane)
const delivery = { state: 'idle', t: 0, record: null, fam: null, from: null, start: new THREE.Vector2(), pos: new THREE.Vector2(), side: 1 };   // start, pos (where it is now) = screen points (−1..1)
let group = null, star = null, halo = null;
const rings = [], sparkles = [];   // reveal FX (STAR_DELIVERY.revealFx)
const MAX_PARTICLES = 40;          // pool size for the reveal particles (their count is a slider)
const trail = [];          // { mesh, life, dir: Vector3 (from the camera: it stays where it was let go in the sky), size }
let trailClock = 0;
const tail = [];           // the soft glowing tail behind it as it flies to its net (COLLECT.tail, as on its way to the satchel)

function material(map, color, additive) {
  return new THREE.MeshBasicMaterial({ map, color, transparent: true, depthTest: false, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: 0 });
}

// Soft round glow without a flat disc: bright middle, long gentle falloff.
function glowTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.15)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

// Supernova ripple for the classic reveal: a crisp, bright leading edge with a soft trail of light fading
// in behind it towards the centre. The light shifts in hue along the trail: lighter and warmer (+uHue) at
// the edge, cooler (-uHue) deeper in. uTrail = trail length (fraction of the radius), uOpacity per frame.
// uSoft = 1: the earlier soft ring instead (a thin, even band in the element's color, no trail or hue shift).
// uRim = brightness of the edge alone (the trail keeps its own), uRimSoft = edge softness (1 = as designed).
function novaMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uTrail: { value: 0.35 }, uHue: { value: 0.08 }, uSoft: { value: 0 },
      uRim: { value: 1 }, uRimSoft: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uTrail, uHue, uSoft, uRim, uRimSoft; varying vec2 vUv;
      vec3 hue(vec3 c, float turns){   // rotate the hue (around the grey axis)
        const vec3 k = vec3(0.57735);
        float a = turns * 6.2832, ca = cos(a);
        return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
      }
      void main(){
        float r = length(vUv - 0.5) * 2.0, edge = 0.94;
        float rim = exp(-pow((r - edge) / (0.012 * uRimSoft), 2.0)) * uRim;      // the crisp leading edge
        float bloom = exp(-pow((r - edge) / (0.045 * uRimSoft), 2.0)) * 0.35 * uRim;   // a soft glow around it
        float d = clamp((edge - r) / max(uTrail, 0.01), 0.0, 1.0);               // 0 at the edge -> 1 deep inside
        float trail = (r < edge ? pow(1.0 - d, 1.8) : 0.0) * 0.8;                // fading in behind it
        vec3 rimCol = mix(hue(uColor, uHue), vec3(1.0), 0.25);
        vec3 trailCol = hue(uColor, -uHue * (0.5 + d));
        vec3 col = rimCol * (rim + bloom) + trailCol * trail;
        float a = (rim + bloom + trail) * (1.0 - smoothstep(0.97, 1.0, r));
        if (uSoft > 0.5) {   // the earlier soft ring: a thin band rising from 0.84 to its peak at 0.92, out to 1
          float w = 0.08 * uRimSoft;
          a = clamp(min((r - (0.92 - w)) / w, (1.0 - r) / 0.08), 0.0, 1.0) * 0.67 * uRim;   // 0.67: as bright as it was
          col = uColor * a;
        }
        gl_FragColor = vec4(col / max(a, 1e-3), a * uOpacity);
      }`,
  });
}

// A nova ring's look for this frame, from STAR_DELIVERY.revealFx (the Dev sky ripple settings): k = how far
// it has spread (0..1, the trail stretches out as it goes), opacity = its brightness now. Shared with the
// constellation's in-rhythm burst ring, so both always look alike.
function novaLook(mat, k, opacity) {
  const F = STAR_DELIVERY.revealFx, u = mat.uniforms;
  u.uOpacity.value = opacity;
  u.uTrail.value = F.ringTrail * (0.4 + 0.6 * k); u.uHue.value = F.ringHue;
  u.uSoft.value = F.ringStyle === 'soft' ? 1 : 0;
  u.uRim.value = F.ringEdge; u.uRimSoft.value = F.ringEdgeSoft;
}

// Glowing particle for the reveal swirl: a small bright core in a soft round glow.
function particleTexture() {
  const S = 64, m = S / 2, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), grad = g.createRadialGradient(m, m, 0, m, m, m);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.3)'); grad.addColorStop(0.6, 'rgba(255,255,255,0.08)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}
function build() {
  group = new THREE.Group();
  scene.add(group);
  const glow = glowTexture();
  halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material(glow, 0xffffff, true));
  star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material(null, 0xffffff, false));
  halo.renderOrder = 30; star.renderOrder = 31;
  group.add(halo, star);
  const F = STAR_DELIVERY.revealFx, particle = particleTexture();
  for (let i = 0; i < F.rings; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), novaMaterial());
    m.renderOrder = 29.4; group.add(m); rings.push(m);
  }
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material(particle, 0xffffff, true));
    m.renderOrder = 31.5; group.add(m);
    sparkles.push({ mesh: m, angle: 0, dist: 0, delay: 0, size: 0, spin: 0, phase: 0 });
  }
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material(glow, 0xffffff, true));
    m.renderOrder = 29; m.visible = false;
    group.add(m);
    trail.push({ mesh: m, life: 0, dir: new THREE.Vector3(), size: 0 });
  }
  for (let i = 0; i < COLLECT.tail.dots; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material(glow, 0xffffff, true));
    m.renderOrder = 29.2; m.visible = false;
    group.add(m); tail.push(m);
  }
}

// Put an overlay plane at screen point `ndc` (−1..1), `h` = its height as a fraction of the screen height.
const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _fwd = new THREE.Vector3();
function placeAt(mesh, ndc, h, rot = 0) {
  _v.set(ndc.x, ndc.y, 0.5).unproject(camera);
  _dir.copy(_v).sub(camera.position).normalize();
  camera.getWorldDirection(_fwd);
  const depth = D * _dir.dot(_fwd);
  mesh.position.copy(camera.position).addScaledVector(_dir, D);
  mesh.quaternion.copy(camera.quaternion);
  mesh.rotateZ(rot);
  mesh.scale.setScalar(Math.max(1e-4, 2 * h * depth / camera.projectionMatrix.elements[5]));
}

const toScreen = (world, out = new THREE.Vector2()) => { _v.copy(world).project(camera); return out.set(_v.x, _v.y); };
const _to = new THREE.Vector3(), _fd = new THREE.Vector3(), _qi = new THREE.Quaternion();
// The fall's progress (0 … 1) over its time share `lin`: it lets go softly, drops faster, and settles in at the end.
// Shared with the scope following it down (constellation.js followStar), so the two move as one.
function fallProgress(lin) {
  const g = Math.pow(lin, STAR_DELIVERY.fallPow);
  return 1 - (1 - g) * (1 - g);
}
const ease = t => t * t * (3 - 2 * t);
// The turn's progress (0 … 1): the sideways part of the way (from the star's spot round to the roof) is done in the
// first turnShare of the fall, high in the sky, so the roof comes into view already facing the scope.
const turnProgress = lin => ease(Math.min(1, lin / STAR_DELIVERY.turnShare));
// A direction from the camera as angles about the vertical (yaw, as the scope turns) and up from level (el), and back.
const anglesOf = v => [Math.atan2(-v.x, -v.z), Math.asin(THREE.MathUtils.clamp(v.y, -1, 1))];
const dirOf = (yaw, el, out) => out.set(-Math.sin(yaw) * Math.cos(el), Math.sin(el), -Math.cos(yaw) * Math.cos(el));
const wrap = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// Begin: the star appears where the constellation gathered (`worldPos`, a point on the sky layer).
function startDelivery(record, worldPos, screen = null, preview = false) {
  if (!group) build();
  const fam = STAR_FAMILIES[record.type];
  // anchor: the star's spot in the sky (world), so it stays in its ring however the view moves while it shows itself
  // nod: past the first stars of the game the scope only nods and the star drops off the screen (STAR_DELIVERY.nod)
  // straight: a straight flight with the scope following (STAR_DELIVERY.straight), for every star
  const N = STAR_DELIVERY.nod, straight = STAR_DELIVERY.straight.on, nod = !preview && !straight && N.on && starRecords.length > N.fullStars;
  Object.assign(delivery, { state: 'reveal', t: 0, record, fam, side: Math.random() < 0.5 ? -1 : 1, preview, nod, straight, arc: null,
    anchor: worldPos ? worldPos.clone() : null });
  if (screen) delivery.start.copy(screen); else toScreen(worldPos, delivery.start);
  star.material.map = familyTexture(record.type); star.material.needsUpdate = true;
  halo.material.color.set(fam.star);
  for (const p of trail) p.mesh.material.color.set(fam.star);
  for (const m of tail) { m.material.color.set(fam.star); m.visible = false; }
  delivery.tailT = -1;
  // Reveal FX: rings in the element's color, particles paler (white with a tint).
  const F = STAR_DELIVERY.revealFx, pale = new THREE.Color(fam.star).lerp(new THREE.Color(0xffffff), 0.55);
  for (const r of rings) r.material.uniforms.uColor.value.set(fam.star);
  const nSpark = Math.min(MAX_PARTICLES, Math.round(F.sparkles));
  sparkles.forEach((s, i) => {
    s.active = i < nSpark; s.mesh.visible = false;
    Object.assign(s, { angle: (i / nSpark) * Math.PI * 2 + Math.random() * 0.5, dist: F.sparkleDist * (0.55 + Math.random() * 0.6),
      delay: 0.05 + Math.random() * 0.3, size: F.sparkleSize * (0.6 + Math.random() * 0.8), spin: (Math.random() < 0.5 ? -1 : 1) * F.swirl,
      phase: Math.random() * Math.PI * 2 });
    s.mesh.material.color.copy(pale);
  });
  delivery.fxT = 0;
  for (const m of [...rings, ...sparkles.map(s => s.mesh)]) m.visible = false;
  // The reveal chord: the star's own little arpeggio in its element's voice.
  for (const [i, step] of [[0, 2], [1, 4], [2, 6]]) chime(step, 0.55, 0.12 + i * 0.11, 1.4, fam);
  group.visible = true;
}

// Cut short (the player left the sky): land the star right away.
function finishDelivery() {
  stopStreak();
  if (centre.on) stopCentre();
  if (delivery.state === 'idle') return;
  if (!delivery.preview) landStar(delivery.record);
  delivery.state = 'idle'; delivery.tailT = -1;
  if (group) group.visible = false;
}

// A sparkle let go at screen point `pos`: it stays at that spot in the sky (as a direction from the camera), so it
// hangs back along the star's way like its tail while the scope follows, instead of riding along on the screen.
function spawnTrail(pos, size) {
  const p = trail.find(q => q.life <= 0);
  if (!p) return;
  p.life = 1;
  p.dir.set(pos.x + (Math.random() - 0.5) * 0.02, pos.y + (Math.random() - 0.5) * 0.02, 0.5).unproject(camera).sub(camera.position).normalize();
  p.size = size * (0.6 + Math.random() * 0.6);
  p.mesh.visible = true;
}

// Reveal FX, on a clock of their own from the moment the star appears (they finish while it flies off).
// `at` = the star's screen point.
function updateRevealFx(dt, at) {
  const F = STAR_DELIVERY.revealFx, R = STAR_DELIVERY.revealSize, t = (delivery.fxT += dt);
  rings.forEach((r, i) => {
    const k = (t - i * F.ringGap) / F.ringSec, on = i < F.rings && k > 0 && k < 1;   // F.rings: how many of the pool
    r.visible = on;
    if (!on) return;
    placeAt(r, at, R * (0.8 + (F.ringSize - 0.8) * (1 - Math.pow(1 - k, 3))));   // fast out, slowing down
    novaLook(r.material, k, Math.sin(Math.PI * Math.min(1, k * 1.6)) ** 0.7 * (1 - k) * F.ringBright);
  });
  for (const s of sparkles) {
    if (!s.active) continue;
    const k = (t - s.delay) / F.sparkleSec, on = k > 0 && k < 1;
    s.mesh.visible = on;
    if (!on) continue;
    const e = 1 - Math.pow(1 - k, 2.2), a = s.angle + s.spin * e;   // drift out on a gentle spiral, from the star's edge
    const r = R * 0.45 + s.dist * e;
    const p = new THREE.Vector2(at.x + Math.cos(a) * r / (camera.aspect || 1), at.y + Math.sin(a) * r);
    const twinkle = 0.75 + 0.25 * Math.sin(t * 5 + s.phase);   // a soft shimmer
    placeAt(s.mesh, p, s.size * (0.5 + 0.7 * Math.sin(Math.PI * Math.min(1, k * 1.3))));
    s.mesh.material.opacity = Math.min(1, k * 6) * (1 - k) * twinkle;
  }
}

// Motion blur while the scope follows a straight flight (STAR_DELIVERY.straight): a streak along the way the view moves
// (SVG filter on the canvas, as modes.js does on the way back to the roof) plus an even softness at the fastest. The
// screen motion comes from how fast the scope turns (its aim angles; zooms don't streak). It runs until the scope has
// come to rest, then hands the canvas filter back (the search sets its own).
const canvas = renderer.domElement;
const streak = { on: false, prev: null, sx: 0, sy: 0 };
const streakBlur = (() => {
  document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute"><filter id="flyMotion" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="0 0" edgeMode="duplicate"/></filter></svg>');
  return document.querySelector('#flyMotion feGaussianBlur');
})();
function stopStreak() {
  if (!streak.on) return;
  streak.on = false; canvas.style.filter = '';
}
function updateStreak(dt, k) {   // k = the flight's progress (0 … 1), for the softness
  const B = STAR_DELIVERY.straight, h = viewport.h / 1000;
  if (streak.prev && dt > 0) {
    // radians per second → screen heights per second (sideways scaled by how high the view looks: yaw is about the up axis)
    const perRad = view.zoom / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * crane.value / dt;
    const el = anglesOf(camera.getWorldDirection(_fwd))[1];
    const vx = Math.abs(wrap(aim.yaw - streak.prev.yaw)) * Math.cos(el) * perRad, vy = Math.abs(aim.pitch - streak.prev.pitch) * perRad;
    const s = Math.min(1, dt * 12);
    streak.sx += (vx - streak.sx) * s; streak.sy += (vy - streak.sy) * s;
  }
  streak.prev = { pitch: aim.pitch, yaw: aim.yaw };
  const sx = B.motionBlur * streak.sx * h, sy = B.motionBlur * streak.sy * h;
  const px = B.softBlur * Math.sin(Math.PI * Math.min(1, k)) * h;
  streakBlur.setAttribute('stdDeviation', `${sx.toFixed(2)} ${sy.toFixed(2)}`);
  canvas.style.filter = [sx > 0.1 || sy > 0.1 ? 'url(#flyMotion)' : '', px > 0.05 ? `blur(${px.toFixed(2)}px)` : ''].join(' ').trim();
}

// A direction between unit vectors a and b along the great circle (a straight line in the sky), k = 0 … 1.
function slerpDir(a, b, k, out) {
  const w = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  if (w < 1e-4) return out.copy(b);
  const s = Math.sin(w);
  return out.copy(a).multiplyScalar(Math.sin((1 - k) * w) / s).addScaledVector(b, Math.sin(k * w) / s).normalize();
}
const _live = new THREE.Vector3();

// Keeps the flying star in the middle of the view (STAR_DELIVERY.straight.centre): each frame the scope's live
// correction (rig.js aim.off) turns it onto the star (world direction `dir` from the camera), as angles from the middle
// of the view as it shows now, and the camera turns along at once, so the star is drawn where the view is this very
// frame (no lag); it comes in over the first `easeIn` s of the flight (tau > 0: trailing by tau s). After the landing
// it stays on the net until the scope's swing has settled, then the correction is folded into the aim.
// With the eyepiece look off it only follows the star up and down: turning sideways onto an outer net would run the
// view past the side buildings' artwork, which only the round lens hides (the whole view shows every net anyway).
const centre = { on: false, t: 0 };
const _cd = new THREE.Vector3(), _cdir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function centreView(dir, dt) {
  const C = STAR_DELIVERY.straight.centre, c = Math.max(0.3, crane.value);
  centre.on = true; centre.t += dt;
  camera.updateMatrixWorld();
  _cd.set(0, 0, 0.5).unproject(camera).sub(camera.position).normalize();   // the middle of the view as it shows
  const [y0, e0] = anglesOf(_cd), [y1, e1] = anglesOf(dir);
  const k = ease(Math.min(1, centre.t / C.easeIn)) * (C.tau > 0 ? 1 - Math.exp(-dt / C.tau) : 1);
  const dy = eyepieceOn() ? wrap(y1 - y0) * k : 0, dp = (e1 - e0) * k;
  aim.off.yaw += dy / c; aim.off.pitch += dp / c;
  camera.rotateOnWorldAxis(_up, dy); camera.rotateX(dp);
  camera.updateMatrixWorld();
}
function stopCentre() { centre.on = false; centre.t = 0; bakeAimOff(); }

function updateDelivery(dt) {
  const S = STAR_DELIVERY;
  // the view turns onto the star first, so everything below is drawn where the view is this frame; after the landing
  // it stays on the net until the scope has come to rest
  const B = S.straight;
  if (delivery.state === 'fly' && delivery.straight && B.centre.on && !delivery.preview && (delivery.arc || !B.arc.on)) {
    aimAtNet();
    centreView(flightAt(delivery.t + dt, _cdir) && _cdir, dt);
  } else if (centre.on && delivery.state === 'idle') {
    if (aim.active && delivery.record) centreView(_v.copy(netTarget(delivery.record).pos).sub(camera.position).normalize(), dt);
    else stopCentre();
  }
  // the streak lasts until the scope has come to rest (camLag after the landing)
  if (streak.on) {
    if (delivery.state === 'idle' && !aim.active) stopStreak();
    else updateStreak(dt, delivery.state === 'fly' ? delivery.t / ((delivery.arc?.sec ?? S.straight.flySec) + S.straight.camLag) : 1);
  }
  // Trail sparkles fade and shrink on their own, also after the landing.
  for (const p of trail) {
    if (p.life <= 0) continue;
    p.life -= dt / S.trailLife;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.dir.y -= dt * 0.011; p.dir.normalize();                   // drift down a touch, like falling glitter
    placeAt(p.mesh, toScreen(_v.copy(p.dir).multiplyScalar(D).add(camera.position), _sp), p.size * (0.4 + 0.6 * p.life));
    p.mesh.material.opacity = Math.pow(p.life, 1.5) * 0.9;
  }
  updateTail(dt);
  if (delivery.state === 'idle') {
    if (group && !trail.some(p => p.life > 0) && delivery.tailT < 0) group.visible = false;
    return;
  }
  delivery.t += dt;
  const t = delivery.t;
  if (delivery.state === 'reveal') {
    // Flash of light, then the star pops out (overshoot + damped wobble) and hovers, breathing softly.
    const k = Math.min(1, t / 0.55), back = 2.2;
    const pop = k <= 0 ? 0 : 1 + (back + 1) * Math.pow(k - 1, 3) + back * Math.pow(k - 1, 2);
    const wobble = Math.sin(t * 11) * Math.exp(-t * 3.2) * 0.35;
    if (delivery.anchor) toScreen(delivery.anchor, delivery.start);   // in its ring, wherever the view is
    const hover = new THREE.Vector2(delivery.start.x, delivery.start.y + 0.012 * Math.sin(t * 2.6) * ease(Math.min(1, t / 0.6)));
    const breathe = 1 + 0.04 * Math.sin(t * 3.1) * ease(Math.min(1, t / 0.6));
    placeAt(star, hover, S.revealSize * pop * breathe, wobble);
    delivery.pos.copy(hover);
    star.material.opacity = Math.min(1, t / 0.12);
    const flash = Math.exp(-t * 4) * 1.6;                        // the bright moment it appears
    placeAt(halo, hover, S.revealSize * (2.2 + flash));
    halo.material.opacity = Math.min(1, t / 0.1) * (0.7 + 0.3 * flash);
    updateRevealFx(dt, hover);
    if (t >= S.revealSec) {
      delivery.state = 'fly'; delivery.t = 0;
      delivery.from = hover.clone();
      // It sets off from its spot in the sky (as angles from the camera), so the fall reads in the scene while the scope follows it.
      if (delivery.anchor) _fd.copy(delivery.anchor).sub(camera.position).normalize();
      else _fd.set(hover.x, hover.y, 0.5).unproject(camera).sub(camera.position).normalize();
      delivery.fromDir = _fd.clone();
      delivery.fromAng = anglesOf(_fd);
      delivery.dropFrom = hover.clone();
      chime(5, 0.35, 0, 0.8, STAR_FAMILIES.air);                   // a light "whee" as it sets off
      chime(3, 0.3, 0.09, 0.8, STAR_FAMILIES.air);
    }
    return;
  }
  if (delivery.state === 'fly' && delivery.straight) {
    // Straight flight: along the great circle from its spot to its net, eased in and out (the scope follows on the same
    // curve: constellation.js followStar). The net as it will be seen once the scope faces the roof (its turn undone,
    // as below); over the last part it homes in on where the net really shows, should the roof still be settling.
    // With B.arc: one throw instead, up over an arch and down into the net (arcPath); the scope follows it (followStar
    // sets the flight's length with planArc; it hovers until then).
    const B = S.straight;
    if (!streak.on && B.motionBlur + B.softBlur > 0) { streak.on = true; streak.prev = null; streak.sx = streak.sy = 0; }
    if (delivery.anchor) toScreen(delivery.anchor, delivery.from);
    const arc = B.arc.on && !delivery.preview;
    if (arc && !delivery.arc) delivery.t = 0;
    const T = flightSec(), lin = Math.min(1, delivery.t / T);
    aimAtNet();
    const { k, size } = flightAt(delivery.t, _fd);
    const pos = toScreen(_v.copy(_fd).multiplyScalar(D).add(camera.position), new THREE.Vector2());
    delivery.tailT = delivery.t;
    placeAt(star, pos, size, -delivery.side * S.tumble * Math.PI * 2 * k);
    delivery.pos.copy(pos);
    placeAt(halo, pos, size * 2.2);
    halo.material.opacity = 0.7;
    updateRevealFx(dt, delivery.from);
    trailClock -= dt;
    while (trailClock <= 0) { spawnTrail(pos, S.trailSize); trailClock += S.trailEvery; }
    if (arc && !delivery.arc) return;
    if (lin >= 1) {
      star.material.opacity = halo.material.opacity = 0;
      for (const m of [...rings, ...sparkles.map(s => s.mesh)]) m.visible = false;
      if (!delivery.preview) landStar(delivery.record, 0.7);
      chime(0, 0.7, 0, 1.3, delivery.fam);
      chime(2, 0.4, 0.08, 1.3, delivery.fam);
      delivery.state = 'idle';
    }
    return;
  }
  if (delivery.state === 'fly' && delivery.nod) {
    // The nod (STAR_DELIVERY.nod): straight down off the bottom of the screen, drifting a little sideways towards its
    // net (on screen, from where it set off: the scope only dips a little), and it lands there unseen.
    const N = S.nod, lin = Math.min(1, t / N.flySec), fall = fallProgress(lin), from = delivery.dropFrom;
    const pos = new THREE.Vector2(from.x + (N.spread[delivery.record.netIndex] ?? 0) * ease(lin), from.y + (-1.3 - from.y) * fall);
    const size = S.revealSize * (1 - 0.35 * fall) * (1 + S.approach * Math.sin(Math.PI * fall));
    placeAt(star, pos, size, -delivery.side * S.tumble * Math.PI * 2 * ease(lin));
    delivery.pos.copy(pos);
    placeAt(halo, pos, size * 2.2);
    halo.material.opacity = 0.7;
    if (delivery.anchor) toScreen(delivery.anchor, delivery.from);
    updateRevealFx(dt, delivery.from);
    trailClock -= dt;
    while (trailClock <= 0) { spawnTrail(pos, S.trailSize); trailClock += S.trailEvery; }
    if (t >= N.flySec) {
      star.material.opacity = halo.material.opacity = 0;
      for (const m of [...rings, ...sparkles.map(s => s.mesh)]) m.visible = false;
      landStar(delivery.record, 0.7);
      chime(0, 0.35, 0, 1.3, delivery.fam);   // a softer "plink", down below out of sight
      delivery.state = 'idle';
    }
    return;
  }
  if (delivery.state === 'fly') {
    // A fall from the sky: from the middle of its ring straight towards its net, with a soft bow to one side. It lets go
    // softly, drops faster as it comes and settles into the net (fallProgress); the sideways part of the way, round to
    // the roof, is done high up (turnProgress). Worked out as angles seen from the camera (yaw round, elevation up), on
    // the same curves the scope follows it with (constellation.js followStar), so star and scope move as one.
    // It swells a touch on the way, as if coming towards you, then shrinks into its net size.
    const target = netTarget(delivery.record);
    const endSize = target.size / Math.max(1e-4, camera.position.distanceTo(target.pos)) * camera.projectionMatrix.elements[5] / 2;
    const lin = Math.min(1, t / S.flySec), fall = fallProgress(lin), turn = turnProgress(lin);
    if (delivery.anchor) toScreen(delivery.anchor, delivery.from);   // where it set off (the reveal FX finish there)
    else toScreen(_v.copy(delivery.fromDir).multiplyScalar(D).add(camera.position), delivery.from);
    // The net as it will be seen once the scope faces the roof: the roof turns a little along with the scope (rig.js
    // turnLayers), so its turn is undone here, else the star would chase a net still swinging into place.
    _to.copy(target.pos).sub(camera.position).applyQuaternion(_qi.copy(layers.poles.turn.quaternion).invert()).normalize();
    const [y0, e0] = delivery.fromAng, [y1, e1] = anglesOf(_to);
    const el = e0 + (e1 - e0) * fall;
    const bow = delivery.side * THREE.MathUtils.degToRad(S.bowDeg) * Math.sin(Math.PI * fall) / Math.max(0.3, Math.cos(el));
    dirOf(y0 + wrap(y1 - y0) * turn + bow, el, _fd);
    const pos = toScreen(_v.copy(_fd).multiplyScalar(D).add(camera.position), new THREE.Vector2());
    const size = THREE.MathUtils.lerp(S.revealSize, endSize, fall) * (1 + S.approach * Math.sin(Math.PI * fall));
    placeAt(star, pos, size, -delivery.side * S.tumble * Math.PI * 2 * ease(lin));
    delivery.pos.copy(pos);
    placeAt(halo, pos, size * 2.2);
    halo.material.opacity = 0.7;
    updateRevealFx(dt, delivery.from);   // the FX stay where it appeared and finish there
    trailClock -= dt;
    while (trailClock <= 0) { spawnTrail(pos, S.trailSize); trailClock += S.trailEvery; }
    if (t >= S.flySec) {
      star.material.opacity = halo.material.opacity = 0;
      for (const m of [...rings, ...sparkles.map(s => s.mesh)]) m.visible = false;
      if (!delivery.preview) landStar(delivery.record, 0.7);   // a preview only flies there
      chime(0, 0.7, 0, 1.3, delivery.fam);                         // a warm "plink" as it settles in the net
      chime(2, 0.4, 0.08, 1.3, delivery.fam);
      delivery.state = 'idle';
    }
  }
}

// The arc flight (STAR_DELIVERY.straight.arc), one motion like a throw: sideways at an even pace (after a short launch),
// up and down on a parabola through its top, archDeg above the higher of its spot and the view's middle (midEl). So it
// slows towards the top and falls faster and faster into the net. As angles from the camera (yaw round, elevation up),
// to the net as it will be seen facing the roof; too little sideways way and it swings out to one side (A.side degrees).
// The arc's progress (0 … 1) over the flight's time share: a launch (speeding up over A.launch of it), then even.
function launch(lin) {
  const a = STAR_DELIVERY.straight.arc.launch;
  return (lin < a ? lin * lin / (2 * a) : lin - a / 2) / (1 - a / 2);
}
// Where the arc tops out (its progress, 0 … 1), and the direction at progress k.
function arcShape() {
  const A = STAR_DELIVERY.straight.arc, [, e0] = delivery.fromAng, [, e1] = anglesOf(_to);
  const top = Math.max(e0, delivery.arc.midEl) + THREE.MathUtils.degToRad(A.archDeg);
  const r = Math.sqrt(Math.max(0, top - e0) / Math.max(1e-6, top - e1)), peak = r / (1 + r);
  return { top, peak, bend: (top - e1) / ((1 - peak) * (1 - peak)) };
}
function arcPath(k, out) {
  const A = STAR_DELIVERY.straight.arc, [y0] = delivery.fromAng, [y1] = anglesOf(_to), { top, peak, bend } = arcShape();
  // the swing (towards its net's side) is widest late in the fall (sin(π k³)), so it is still drifting sideways over the
  // top of the arc and never comes to a stop there
  const el = top - bend * (k - peak) * (k - peak), dy = wrap(y1 - y0), side = THREE.MathUtils.degToRad(A.side);
  const dir = Math.abs(dy) > side / 12 ? Math.sign(dy) : delivery.side;
  const swing = dir * side * Math.max(0, 1 - Math.abs(dy) / side) * Math.sin(Math.PI * k * k * k) / Math.max(0.3, Math.cos(el));
  return dirOf(y0 + dy * k + swing, el, out);
}
// Set by followStar as the star sets off: the flight's length, and the view's middle (elevation) as it looks now.
// Returns the scope's two easing curves over its move (sec + camLag), [turn, dip]: the star's own progress (round: its
// sideways way; down: its drop from the top of the arc, as a share), trailed by a soft lag (critically damped, camTau
// seconds), so the scope never runs ahead of the star, and settling once it has landed.
function planArc(sec, midEl) {
  delivery.arc = { sec, midEl };
  delivery.t = 0;
  _to.copy(netTarget(delivery.record).pos).sub(camera.position).applyQuaternion(_qi.copy(layers.poles.turn.quaternion).invert()).normalize();
  const A = STAR_DELIVERY.straight.arc, { peak } = arcShape(), dur = sec + A.camLag, N = 300, dt = dur / N, w = 1 / A.camTau;
  const tabs = [new Float32Array(N + 1), new Float32Array(N + 1)], p = [0, 0], v = [0, 0];
  for (let i = 0; i <= N; i++) {
    const k = launch(Math.min(1, i * dt / sec)), aim = [k, k > peak ? ((k - peak) / (1 - peak)) ** 2 : 0];
    for (let c = 0; c < 2; c++) {
      tabs[c][i] = p[c];
      v[c] += ((aim[c] - p[c]) * w * w - 2 * w * v[c]) * dt;
      p[c] += v[c] * dt;
    }
  }
  return tabs.map(tab => {
    const rest = 1 - tab[N];   // what the lag hasn't caught up by the end, eased in over the move
    return x => {
      const f = THREE.MathUtils.clamp(x, 0, 1) * N, i = Math.min(N - 1, Math.floor(f));
      return tab[i] + (tab[i + 1] - tab[i]) * (f - i) + rest * ease(Math.min(1, x));
    };
  });
}

// The straight / arc flight `time` s in: its direction from the camera (into `out`), progress k and size. aimAtNet first.
const flightSec = () => (STAR_DELIVERY.straight.arc.on && !delivery.preview ? delivery.arc?.sec ?? 1 : STAR_DELIVERY.straight.flySec);
let endSize = 0;
function aimAtNet() {
  const target = netTarget(delivery.record);
  endSize = target.size / Math.max(1e-4, camera.position.distanceTo(target.pos)) * camera.projectionMatrix.elements[5] / 2;
  _to.copy(target.pos).sub(camera.position).applyQuaternion(_qi.copy(layers.poles.turn.quaternion).invert()).normalize();
  _live.copy(target.pos).sub(camera.position).normalize();
}
function flightAt(time, out) {
  const S = STAR_DELIVERY, lin = THREE.MathUtils.clamp(time / flightSec(), 0, 1);
  let k;
  if (S.straight.arc.on && !delivery.preview) {
    k = delivery.arc ? launch(lin) : 0;
    arcPath(k, out);
    slerpDir(out, _live, ease(THREE.MathUtils.clamp((k - 0.85) / 0.15, 0, 1)), out);   // homes in on the net as it shows
  } else {
    k = ease(lin);
    slerpDir(delivery.fromDir, _to, k, out);
    slerpDir(out, _live, ease(THREE.MathUtils.clamp((lin - 0.7) / 0.3, 0, 1)), out);
  }
  return { k, size: THREE.MathUtils.lerp(S.revealSize, endSize, k) * (1 + S.approach * Math.sin(Math.PI * k)) };
}

// The tail (COLLECT.tail, the same as a star's on its way to the satchel): glow dots where the star was a moment ago
// on its way, fading and thinning towards the end; after the landing it runs on into the net and fades there.
const _td = new THREE.Vector3(), _tp = new THREE.Vector2(), _sp = new THREE.Vector2();
function updateTail(dt) {
  if (!(delivery.tailT >= 0)) return;
  const C = COLLECT.tail, T = flightSec(), L = C.length * T, n = tail.length;
  if (delivery.state !== 'fly') delivery.tailT += dt;
  const t = delivery.tailT, settle = t > T ? 1 - (t - T) / L : 1, fadeIn = Math.min(1, t / 0.12);
  if (settle <= 0) { delivery.tailT = -1; for (const m of tail) m.visible = false; return; }
  aimAtNet();
  tail.forEach((m, j) => {
    const lag = (j + 1) / n, tt = Math.min(T, t - lag * L);
    if (tt <= 0) { m.visible = false; return; }
    const { size } = flightAt(tt, _td);
    placeAt(m, toScreen(_v.copy(_td).multiplyScalar(D).add(camera.position), _tp), size * C.size * (0.45 + 0.55 * (1 - lag)));
    m.material.opacity = C.bright * Math.pow(1 - lag, 1.6) * fadeIn * settle;
    m.visible = true;
  });
}

// Dev sky -> Star reveal -> Show reveal: play the reveal on demand, in the upper middle of
// the screen, with the next element each time. It flies to the nets in turn but never lands a real star.
const PREVIEW_TYPES = ['fire', 'water', 'earth', 'air'];
let previewIndex = 0;
function previewReveal() {
  if (delivery.state !== 'idle' && !delivery.preview) return;   // a real star is on its way: leave it alone
  const type = PREVIEW_TYPES[previewIndex++ % PREVIEW_TYPES.length];
  const net = previewIndex % NETS.length;   // the nets in turn
  const record = { type, netIndex: net, slot: { x: NETS[net].x, y: NETS[net].y, n: 0, size: NET_STAR.size } };
  startDelivery(record, null, new THREE.Vector2(0, 0.3), true);
}

export { delivery, planArc, startDelivery, finishDelivery, updateDelivery, previewReveal, novaMaterial, novaLook, fallProgress, turnProgress, anglesOf };
