// Collecting (A4): stars go from the nets into the character's star satchel; the jars in the greenhouse
// store them (jars.js). Also everything that quietly shows the way, without text:
//   • full nets breathe (netStars.js), hum a bit of their constellation's melody now and then, and
//     sparkles rise from them;
//   • after the camera pans down by itself the character looks up at the nets, with a little star popping up above its head;
//   • while the satchel holds stars, the greenhouse breathes softly brighter (greenhouse.js, house.beckon);
//   • if nothing happens for a while, a soft ring appears around what to tap next (a net, then the greenhouse door);
//   • once every star is stored, the telescope glints now and then: time to look up again;
//   • the satchel holds COLLECT.satchelMax stars, glowing brighter with each; full, a ring ripples around it, and a
//     tap on a net then makes the net flash (stronger with every further try) instead of walking there;
//   • after a sky trip (constellation.js, SKY_TRIP_TIERS) the telescope waits until the nets are emptied (gatherFirst).
// Values in COLLECT (config.js). modes.js does the walking; this module does the rest.
import * as THREE from 'three';
import { ART_W, COLLECT, CONSTELLATIONS, GREENHOUSE, NETS, STAR_FAMILIES } from './config.js';
import { scene } from './core.js';
import { layerAttach, layerPoint, layers } from './layers.js';
import { starsInNet } from './starRecords.js';
import { familyTexture, flashNet, onNet, haloTexture, netViews, pulseNet, takeStar } from './netStars.js';
import { walker } from './walk.js';
import { rise } from './rig.js';
import { swingCharms } from './netCharms.js';
import { chime, thud } from './chime.js';
import { flashTelescope, scope } from './telescope.js';
import { house } from './greenhouse.js';

const col = { character: null, satchel: [], busy: false, idle: 0, humT: 9, sparkT: 0, invite: false, inviteT: 0,
  notice: -1, ring: null, ringOn: 0, ringTarget: null, satchelGlow: null, satchelPulse: 0, headStar: null,
  gather: false, fullRing: null, fullT: 0, fullPulse: 0, previewT: 0, refuse: { net: -1, k: 0, t: 0 } };
const floats = [];         // stars on their way: { mesh, tail, from, to(), arc, sizeA, sizeB, t, sec, spin, done }
const sparkles = [];       // rising from full nets: { mesh, life, vy }

const sleep = s => new Promise(r => setTimeout(r, s * 1000));
let _halo = null;
const halo = () => (_halo ??= haloTexture());
// A plain soft round glow (no disc edge), for the tails of flying stars.
let _dot = null;
function dotTexture() {
  if (_dot) return _dot;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return (_dot = new THREE.CanvasTexture(c));
}
const ease = t => t * t * (3 - 2 * t);
const additive = (map, color) => new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false,
  depthTest: false, blending: THREE.AdditiveBlending, opacity: 0 });

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
// The hint ring (COLLECT.hintRing, tuned in Settings → Hint ring): a faint moonlit inside, then one brushstroke
// around it, tapering at both ends, its hue drifting along it, over a blurred copy of itself as its glow. Two
// styles: 'bristles' = soft separate bristles that each wander a little; 'ink' = the star chart's brush (ragged
// edges, bristle streaks, paint running dry towards the end). Smooth (fine steps, soft edges), so it reads as paint
// without any boil. Redrawn into the same canvas when the look changes (redrawHintRing); jars.js shows it too.
const ring = { canvas: null, stroke: null, tex: null, v: 0 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixN = (a, b, t) => a + (b - a) * t;
const h1 = x => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };
const n1 = x => { const i = Math.floor(x); return mixN(h1(i), h1(i + 1), ease(x - i)); };
const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const n2 = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = ease(x - i), v = ease(y - j);
  return mixN(mixN(h2(i, j), h2(i + 1, j), u), mixN(h2(i, j + 1), h2(i + 1, j + 1), u), v); };
function paintHintRing() {
  const H = COLLECT.hintRing, S = 512, R = S * 0.36, mid = S / 2;
  if (!ring.canvas) for (const k of ['canvas', 'stroke']) { ring[k] = document.createElement('canvas'); ring[k].width = ring[k].height = S; }
  const raw = h => new THREE.Color().setStyle(h, THREE.LinearSRGBColorSpace);   // raw, for the canvas
  const cols = [H.color, H.color2, H.color3, H.color].map(raw);
  const hue = t => {   // the stroke's color at t (0..1 along it): the base color, drifting through color 2 and 3 by hueShift
    const f = t * 3, i = Math.min(2, Math.floor(f));
    return cols[0].clone().lerp(cols[i].clone().lerp(cols[i + 1], f - i), H.hueShift);
  };
  const css = (k, a) => `rgba(${k.r * 255 | 0},${k.g * 255 | 0},${k.b * 255 | 0},${a})`;
  const start = -Math.PI * 0.62, len = Math.PI * 2 * H.sweep, w = R * H.width;
  const taper = t => ease(Math.min(1, t / 0.14)) * (1 - ease(Math.max(0, (t - 0.72) / 0.28)) * 0.92);   // pressed in, lifted off
  const sg = ring.stroke.getContext('2d');
  sg.clearRect(0, 0, S, S);
  if (H.style === 'ink') {
    // Per pixel, like the star chart's brush shader (starChart.js brush()): where along the stroke (t, and a = arc
    // length in stroke widths) and across it (side, -1 … 1).
    const img = sg.createImageData(S, S), d = img.data;
    const wob = t => 0.6 * Math.sin(t * 6.28 * 1.7 + 1) + 0.4 * Math.sin(t * 6.28 * 3.9 + 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - mid, dy = y + 0.5 - mid, r = Math.hypot(dx, dy);
      if (Math.abs(r - R) > w * 1.2) continue;
      let ang = Math.atan2(dy, dx) - start; ang -= Math.floor(ang / (Math.PI * 2)) * Math.PI * 2;
      const t = ang / len;
      if (t > 1) continue;
      const a = t * len * R / w, side = (r - R - wob(t) * w * 0.12) / (w / 2), sk = side >= 0 ? 1 : 0;
      const edgeN = n1(a * 0.6 + sk * 37) * 0.5 + n1(a * 3 + sk * 19) * 0.5;
      const e = (1 - H.rag * 0.6 * edgeN) * mixN(0.45, 1, smooth(0, 0.1, t)) * mixN(1, 0.6, smooth(0.6, 1, t));   // ragged; pointed start, thinner as it runs dry
      let cover = 1 - smooth(e * 0.8, e, Math.abs(side));
      if (cover <= 0) continue;
      const bristle = n2(side * 4 + 40, a * 0.05), fine = n2(side * 9 + 7, a * 0.9), fleck = n2(side * 6 + 3, a * 2.2);
      const streak = mixN(1, 0.15 + 1.1 * bristle, H.grain) * mixN(1, 0.45 + 0.8 * fine, H.grain);
      const dry = H.dry * 0.7 * (0.3 + 0.7 * smooth(0.3, 1, t));   // paint runs out along the stroke
      cover *= smooth(dry - 0.08, dry + 0.08, fleck * 0.45 + fine * 0.4 + bristle * 0.15) * taper(t) ** 0.5;
      const k = hue(t), lum = 0.85 + 0.4 * bristle, o = (y * S + x) * 4;
      d[o] = Math.min(255, k.r * lum * 255); d[o + 1] = Math.min(255, k.g * lum * 255); d[o + 2] = Math.min(255, k.b * lum * 255);
      d[o + 3] = Math.min(255, cover * streak * 255);
    }
    sg.putImageData(img, 0, 0);
  } else {
    // A seeded random, so the stroke is the same every time.
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const wave = () => { const a = rnd() * 6.28, b = rnd() * 6.28, f = 1 + rnd() * 2;
      return t => 0.6 * Math.sin(t * 6.28 * f + a) + 0.4 * Math.sin(t * 6.28 * (f * 2.3) + b); };
    const steps = 360, n = Math.max(1, Math.round(H.bristles));
    sg.lineCap = 'round';
    for (let b = 0; b < n; b++) {
      const off = n > 1 ? (b / (n - 1) - 0.5) * w : 0, rw = wave(), aw = wave(), lw = w / n * (1.2 + rnd());
      const t0 = rnd() * 0.06, t1 = 1 - rnd() * 0.08;   // bristles start and lift a little apart
      for (let i = 0; i < steps; i++) {
        const ta = i / steps, tb = (i + 1) / steps;
        if (ta < t0 || tb > t1) continue;
        const tp = taper(ta), r = R + off * (0.55 + 0.45 * tp) + rw(ta) * w * 0.18;
        sg.strokeStyle = css(hue(ta), tp * (0.55 + 0.45 * (0.5 + 0.5 * aw(ta))));
        sg.lineWidth = lw * (0.4 + 0.6 * tp);
        sg.beginPath(); sg.arc(mid, mid, r, start + ta * len, start + tb * len + 0.004); sg.stroke();
      }
    }
  }
  // Together: the moonlit inside (color 3), the glow (the stroke blurred), the stroke.
  const g = ring.canvas.getContext('2d'), ic = raw(H.color3);
  g.clearRect(0, 0, S, S);
  const inner = g.createRadialGradient(mid, mid, 0, mid, mid, R);
  inner.addColorStop(0, css(ic, H.inner)); inner.addColorStop(0.75, css(ic, H.inner * 0.45)); inner.addColorStop(1, css(ic, 0));
  g.fillStyle = inner; g.fillRect(0, 0, S, S);
  g.filter = `blur(${(w * H.glowSize).toFixed(1)}px)`;
  for (let left = H.glow; left > 0.001; left -= 1) { g.globalAlpha = Math.min(1, left); g.drawImage(ring.stroke, 0, 0); }
  g.filter = 'none'; g.globalAlpha = 1;
  g.drawImage(ring.stroke, 0, 0);
  ring.v++;
  if (ring.tex) ring.tex.needsUpdate = true;
}
// The ring's canvas and its version (jars.js redraws its copy when the version changes).
export function brushRingCanvas() {
  if (!ring.canvas) paintHintRing();
  return ring.canvas;
}
export const hintRingVersion = () => ring.v;
// Settings → Hint ring: repaint after a look change (once per frame at most while a slider is dragged).
let _repaint = 0;
export function redrawHintRing() {
  if (!_repaint) _repaint = requestAnimationFrame(() => { _repaint = 0; paintHintRing(); });
}
const ringTexture = () => (ring.tex ??= Object.assign(new THREE.CanvasTexture(brushRingCanvas()), { colorSpace: THREE.SRGBColorSpace }));
// Settings → Hint ring → Show: the ring circles the next thing to tap (or the left net) for a few seconds.
export function previewHintRing() { col.previewT = 6; }

function buildCollect(character) {
  col.character = character;
  const { width: w, height: h } = character.geometry.parameters;
  // Satchel glow: grows with every star inside it.
  col.satchelGlow = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.55, w * 0.55), additive(haloTexture(), '#ffeab0'));   // centred on the bag's star
  col.satchelGlow.position.set(COLLECT.satchel[0] * w, COLLECT.satchel[1] * h, 0.002);
  col.satchelGlow.renderOrder = 6.05;
  character.add(col.satchelGlow);
  // A little star popping up above the head when the character notices the nets.
  col.headStar = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.28, w * 0.28),
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
  col.headStar.position.set(0, h * 1.1, 0.002);
  col.headStar.renderOrder = 6.1;
  character.add(col.headStar);
  // Full satchel: a ring rippling out around it.
  col.fullRing = new THREE.Mesh(new THREE.PlaneGeometry(w * COLLECT.fullRing, w * COLLECT.fullRing), additive(ringTexture(), '#ffffff'));
  col.fullRing.position.copy(col.satchelGlow.position).setZ(0.003);
  col.fullRing.renderOrder = 6.06;
  character.add(col.fullRing);
  // Hint ring.
  col.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(ringTexture(), '#ffffff'));   // colors from the texture
  col.ring.renderOrder = 7.4;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
// Nets that hold at least one settled star.
function fullNets() {
  const s = new Set();
  for (const [record, v] of netViews()) if (v.landed) s.add(record.netIndex);
  return [...s];
}

function hitNet(p) {
  return fullNets().find(i => onNet(p, i)) ?? -1;
}

const satchelCount = () => col.satchel.length;
const satchelFull = () => col.satchel.length >= COLLECT.satchelMax;
// After a sky trip the nets must be emptied before the next look-up (skyrest from constellation.js).
window.addEventListener('skyrest', () => { col.gather = true; });
const gatherFirst = () => col.gather;
// Empty the satchel (the greenhouse jars take its stars), oldest first.
const takeSatchel = () => col.satchel.splice(0);
const satchelWorld = (out = new THREE.Vector3()) => col.satchelGlow.getWorldPosition(out);
const satchelSize = () => col.satchelGlow.geometry.parameters.width * 0.35 * Math.abs(col.character.scale.y);

// ---------------------------------------------------------------------------
// Floating stars
// ---------------------------------------------------------------------------
// A star floating along a curve; with `color`, a soft glowing tail follows it (COLLECT.tail): glow dots
// sitting where the star was a moment ago, fading and thinning towards the end. The tail settles into
// the target after the star has arrived.
function float(texture, from, to, { sizeA, sizeB, sec, arc, side = 0, rot = 0, color = null }) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  mesh.renderOrder = 7.5;
  scene.add(mesh);
  const tail = [];
  if (color) for (let i = 0; i < COLLECT.tail.dots; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(dotTexture(), color));
    m.renderOrder = 7.45; m.visible = false;
    scene.add(m); tail.push(m);
  }
  return new Promise(done => floats.push({ mesh, tail, from: from.clone(), to, arc, side, sizeA, sizeB, t: 0, sec,
    rot, spin: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6), done }));
}

const _ctrl = new THREE.Vector3();
function curveAt(f, to, t, out) {
  const k = ease(t), d = f.from.distanceTo(to), u = 1 - k;
  _ctrl.lerpVectors(f.from, to, 0.5);
  _ctrl.y += f.arc * d; _ctrl.x += f.side * d * 0.25;
  return out.set(
    u * u * f.from.x + 2 * u * k * _ctrl.x + k * k * to.x,
    u * u * f.from.y + 2 * u * k * _ctrl.y + k * k * to.y,
    u * u * f.from.z + 2 * u * k * _ctrl.z + k * k * to.z);
}

function updateFloats(dt) {
  const T = COLLECT.tail;
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    const lagEnd = f.tail.length ? T.length : 0;
    f.t = Math.min(1 + lagEnd, f.t + dt / f.sec);
    const to = f.to(), k = ease(Math.min(1, f.t));
    if (f.mesh) {
      curveAt(f, to, Math.min(1, f.t), f.mesh.position);
      f.mesh.scale.setScalar(THREE.MathUtils.lerp(f.sizeA, f.sizeB, k));
      f.mesh.rotation.z = f.rot + f.spin * k * Math.PI;
      if (f.t >= 1) {
        f.mesh.removeFromParent(); f.mesh.geometry.dispose(); f.mesh.material.dispose();
        f.mesh = null;
        f.done();
      }
    }
    // Tail: dot j sits where the star was (j+1)/n of the tail length ago; brightest just behind the star.
    const n = f.tail.length, fadeIn = Math.min(1, f.t / 0.12);
    const settle = f.t > 1 ? Math.max(0, 1 - (f.t - 1) / Math.max(0.01, lagEnd)) : 1;   // after arrival it sinks into the bag
    f.tail.forEach((m, j) => {
      const lag = (j + 1) / n, tt = f.t - lag * T.length;
      if (tt <= 0) { m.visible = false; return; }
      curveAt(f, to, Math.min(1, tt), m.position);
      const fall = Math.pow(1 - lag, 1.6);
      const size = THREE.MathUtils.lerp(f.sizeA, f.sizeB, ease(Math.min(1, tt)));
      m.scale.setScalar(size * T.size * (0.45 + 0.55 * (1 - lag)));
      m.material.opacity = T.bright * fall * fadeIn * settle;
      m.visible = true;
    });
    if (f.t >= 1 + lagEnd) {
      for (const m of f.tail) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
      floats.splice(i, 1);
    }
  }
}

// A star's note: its constellation's first melody note, otherwise a middle one.
function noteOf(record, i = 0) {
  const def = CONSTELLATIONS.find(c => c.id === record.source);
  if (!def) return 3 + i;
  const order = def.stars.map((s, k) => k).sort((a, b) => def.stars[b][1] - def.stars[a][1]);   // lowest star first
  const steps = def.melody ?? def.stars.map((s, k) => [k, 1]);
  return order.indexOf(steps[Math.min(i, steps.length - 1)][0]) + 1;
}

// ---------------------------------------------------------------------------
// Net → satchel
// ---------------------------------------------------------------------------
async function pickFromNet(i) {
  col.busy = true;
  walker.facing = Math.sign(NETS[i].x - walker.x) || walker.facing;
  walker.reachTarget = 1;
  pulseNet(i);
  await sleep(COLLECT.reachSec);
  const records = starsInNet(i).slice(0, COLLECT.satchelMax - col.satchel.length);   // as many as the satchel still holds
  let last = Promise.resolve(), n = 0;
  for (const record of records) {
    const from = takeStar(record);
    if (!from) continue;
    swingCharms(i, n ? 0.6 : 1);                           // each star lifted out sets the charms dangling
    record.location = 'satchel';
    const fam = STAR_FAMILIES[record.type], step = Math.min(9, 2 + n++);
    last = float(from.texture, from.pos, () => satchelWorld(), {
      sizeA: from.size, sizeB: satchelSize(), sec: COLLECT.floatSec, arc: 0.05, side: (Math.random() - 0.5), rot: from.rot,
      color: fam.star,
    }).then(() => {
      col.satchel.push(record);
      col.satchelPulse = 1;
      walker.leafFlick = 0;                                // the hat's leaves sway as it drops in
      if (satchelFull()) { col.fullT = 0; col.fullPulse = 1; }   // that was the last one it holds: a ripple right away
      chime(step, 0.5, 0, 0.9, fam);                       // a plink for each star landing in the satchel
    });
    await sleep(COLLECT.floatGap);
  }
  await last;
  walker.reachTarget = 0;
  await sleep(0.25);
  col.busy = false; col.idle = 0;
}

// ---------------------------------------------------------------------------
// Showing the way
// ---------------------------------------------------------------------------
const noteInput = () => { col.idle = 0; };

// A tap on a net while the satchel is full: the net flashes, a little stronger with every try in a row; the bag's ring
// ripples brightly and a soft thud says "no room".
function refuseNet(i) {
  const C = COLLECT, r = col.refuse, now = performance.now() / 1000;
  r.k = r.net === i && now - r.t < C.refuseReset ? Math.min(C.refuseMax, r.k + C.refuseStep) : C.refuseFlash;
  r.net = i; r.t = now;
  flashNet(i, r.k); pulseNet(i);
  col.fullPulse = Math.min(1.6, 0.6 + 0.4 * r.k); col.fullT = 0;
  walker.facing = Math.sign(NETS[i].x - walker.x) || walker.facing;
  thud();
}

// A tap on the telescope while the nets still wait to be emptied: the character looks up at the nearest full one.
function noticeNets() {
  const nets = fullNets();
  if (!nets.length) return;
  const near = nets.reduce((a, b) => (Math.abs(NETS[b].x - walker.x) < Math.abs(NETS[a].x - walker.x) ? b : a));
  walker.facing = Math.sign(NETS[near].x - walker.x) || walker.facing;
  col.headStar.material.map = familyTexture(starsInNet(near)[0]?.type ?? 'air'); col.headStar.material.needsUpdate = true;
  col.notice = 0; flashNet(near); pulseNet(near);
  chime(4, 0.3, 0.2, 0.8, STAR_FAMILIES.air); chime(6, 0.25, 0.32, 0.8, STAR_FAMILIES.air);
}

// After the camera pans down by itself: the character looks up at the nets (no camera move).
function startLinger() {
  const nets = fullNets();
  if (nets.length) {
    const near = nets.reduce((a, b) => (Math.abs(NETS[b].x - walker.x) < Math.abs(NETS[a].x - walker.x) ? b : a));
    walker.facing = Math.sign(NETS[near].x - walker.x) || walker.facing;
    const rec = starsInNet(near)[0];
    col.headStar.material.map = familyTexture(rec?.type ?? 'air'); col.headStar.material.needsUpdate = true;
    col.notice = 0;
    chime(4, 0.3, 0.2, 0.8, STAR_FAMILIES.air); chime(6, 0.25, 0.32, 0.8, STAR_FAMILIES.air);   // a little "oh!"
  }
}

// A tap on the telescope while the stars want to go to the greenhouse first: the character turns to it and the hint
// ring circles its door right away (instead of after COLLECT.hintAfter s).
function noticeGreenhouse() {
  walker.facing = Math.sign(GREENHOUSE.zoomTo[0] - walker.x) || walker.facing;
  col.idle = Math.max(col.idle, COLLECT.hintAfter + 0.01);
}
// After the first planting: the telescope waits `sec` before its first glint.
function inviteAfter(sec) { col.invite = true; col.inviteT = -sec; }

// Every star is stored (jars.js): the telescope starts glinting now and then.
function allStored() {
  if (!fullNets().length && !col.satchel.length) { col.invite = true; col.inviteT = COLLECT.inviteEvery - 1.5; }
}

function placeRing(target, now) {
  let item, x, y, size;
  if (target === 'greenhouse') { item = layers[GREENHOUSE.layer]; [x, y] = GREENHOUSE.zoomTo; size = COLLECT.netHitR * 1.6; }
  else { item = layers.poles; ({ x, y } = NETS[target]); size = NETS[target].ring ?? COLLECT.netHitR * 1.3; }
  const attach = layerAttach(item);
  if (col.ring.parent !== attach) attach.add(col.ring);
  col.ring.position.copy(layerPoint(item, x, y, 0.03));
  col.ring.scale.setScalar(size * item.w / ART_W * (1 + 0.03 * Math.sin(now * 1.6)));
  col.ring.rotation.z = -now * COLLECT.hintRing.spin * Math.PI / 180;   // the hue drifts slowly round
}

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------
function updateCollect(dt, now, mode) {
  if (!col.character) return;
  updateFloats(dt);
  const onRoof = mode === 'rooftop', nets = fullNets();

  // Satchel glow.
  col.satchelPulse = Math.max(0, col.satchelPulse - dt * 2);
  const sc = col.satchel.length;
  // (poseWalker resets the character's children's opacity every frame, so these are set after it.)
  const SG = COLLECT.satchelGlow, fill = Math.min(1, sc / COLLECT.satchelMax);
  col.satchelGlow.material.opacity = ((sc ? (SG.min + (SG.max - SG.min) * fill) * (0.85 + 0.15 * Math.sin(now * 2.2)) : 0)
    + 0.6 * col.satchelPulse) * walker.opacity;
  col.satchelGlow.scale.setScalar(1 + SG.grow * fill + 0.4 * col.satchelPulse);
  // Full: a ring ripples out around the bag every fullEvery s (brighter right after the last star or a refused net).
  const full = satchelFull();
  col.fullT += dt;
  if (full && col.fullT >= COLLECT.fullEvery) col.fullT = 0;
  const rip = Math.min(1, col.fullT / 1.3), ripOn = full && rip < 1;
  col.fullRing.visible = ripOn;
  if (ripOn) {
    col.fullRing.scale.setScalar(0.75 + 0.6 * ease(rip));
    col.fullRing.material.opacity = Math.sin(Math.PI * Math.min(1, rip * 1.15)) * (0.55 + 0.45 * col.fullPulse)
      * COLLECT.hintRing.bright * walker.opacity;
  }
  if (col.fullT > 1.3) col.fullPulse = 0;
  // The nets are emptied: the telescope is free again.
  if (col.gather && NETS.every((n, i) => !starsInNet(i).length)) col.gather = false;
  house.beckonTarget = (sc || house.plantReady || house.calling) && onRoof ? 1 : 0;   // the greenhouse breathes: bring the stars in / a plant can grow

  // Hint ring: what to tap next, after a while without progress.
  const target = col.busy || !onRoof ? null : nets.length && !full
    ? nets.reduce((a, b) => (Math.abs(NETS[b].x - walker.x) < Math.abs(NETS[a].x - walker.x) ? b : a))
    : sc || house.calling ? 'greenhouse' : null;   // (full satchel: to the jars first)   // (house.calling: first time, a plant should grow first)
  col.idle = target === null ? 0 : col.idle + dt;
  scope.idleOk = onRoof && !rise.active && !col.busy && !scope.locked && !walker.moving;   // (the telescope's idle highlight, telescope.js)
  col.previewT = Math.max(0, col.previewT - dt);
  const ringFor = col.previewT > 0 && onRoof ? target ?? 0 : target;   // (Settings → Hint ring → Show)
  const want = ringFor !== null && (col.idle > COLLECT.hintAfter || col.previewT > 0) ? 1 : 0;
  col.ringOn += (want - col.ringOn) * Math.min(1, dt * 2.5);
  if (want) { col.ringTarget = ringFor; }
  if (col.ringTarget !== null && col.ringOn > 0.01) {
    placeRing(col.ringTarget, now);
    col.ring.material.opacity = col.ringOn * COLLECT.hintRing.bright * (0.8 + 0.2 * Math.sin(now * 1.6));
    col.ring.visible = true;
  } else col.ring.visible = false;

  // Full nets hum a bit of their constellation's melody now and then.
  if (onRoof && nets.length && !col.busy) {
    col.humT -= dt;
    if (col.humT <= 0) {
      const i = nets[Math.floor(Math.random() * nets.length)], rec = starsInNet(i).at(-1);
      if (rec) for (let k = 0; k < 3; k++) chime(noteOf(rec, k), 0.28, k * 0.32, 1.1, STAR_FAMILIES[rec.type]);
      pulseNet(i);
      const [a, b] = COLLECT.humEvery;
      col.humT = a + Math.random() * (b - a);
    }
  }

  // Sparkles rising from full nets.
  col.sparkT -= dt;
  const shown = [...netViews()].filter(([, v]) => v.landed);
  if (shown.length && col.sparkT <= 0) {
    col.sparkT = COLLECT.sparkleEvery * (0.6 + Math.random() * 0.8);
    const [record, v] = shown[Math.floor(Math.random() * shown.length)];
    let s = sparkles.find(q => q.life <= 0);
    if (!s && sparkles.length < 30) {
      s = { mesh: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(halo(), '#ffffff')), life: 0, vy: 0 };
      s.mesh.renderOrder = 5.6;
      sparkles.push(s);
    }
    if (s) {
      const k = layers.poles.w / ART_W;
      layerAttach(layers.poles).add(s.mesh);
      s.mesh.position.copy(v.star.position).add(new THREE.Vector3((Math.random() - 0.5) * 50 * k, (Math.random() * 10) * k, 0.01));
      s.mesh.material.color.set(STAR_FAMILIES[record.type].star);
      s.mesh.scale.setScalar((10 + Math.random() * 10) * k);
      s.vy = (45 + Math.random() * 30) * k; s.life = 1;
    }
  }
  for (const s of sparkles) {
    if (s.life <= 0) { s.mesh.material.opacity = 0; continue; }
    s.life -= dt / 1.8;
    s.mesh.position.y += s.vy * dt;
    s.mesh.position.x += Math.sin(now * 2 + s.vy) * 0.002;
    s.mesh.material.opacity = Math.max(0, Math.sin(Math.PI * s.life)) * 0.9;
  }

  // The character noticing the nets.
  if (col.notice >= 0) {
    col.notice += dt;
    const t = col.notice, back = 2;
    const k = Math.min(1, t / 0.5), pop = 1 + (back + 1) * Math.pow(k - 1, 3) + back * Math.pow(k - 1, 2);
    col.headStar.scale.setScalar(Math.max(0.001, pop * (1 + 0.05 * Math.sin(t * 6))));
    col.headStar.material.opacity = Math.min(1, t / 0.15) * (t > 2.2 ? Math.max(0, 1 - (t - 2.2) / 0.5) : 1) * walker.opacity;
    col.headStar.position.y = col.character.geometry.parameters.height * (1.1 + 0.03 * Math.sin(t * 3));
    walker.reachTarget = t < 1.6 ? 0.5 : 0;                 // a little stretch: "oh, look!"
    if (t > 2.7) col.notice = -1;
  }
  col.headStar.visible = col.notice >= 0;

  // Everything stored: the telescope glints now and then, inviting the next look-up.
  if (mode === 'sky' || nets.length || sc) col.invite = false;
  if (col.invite && onRoof && !col.busy && !scope.locked) {   // (scope.locked: first time, not before the first plant)
    col.inviteT += dt;
    if (col.inviteT >= COLLECT.inviteEvery) { col.inviteT = 0; scope.glintT = 0; flashTelescope(); }
  }
}

export { buildCollect, updateCollect, hitNet, fullNets, noticeGreenhouse, inviteAfter, satchelFull, gatherFirst, refuseNet, noticeNets, satchelCount, takeSatchel, pickFromNet, allStored, noteOf,
  noteInput, startLinger };
