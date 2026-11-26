// Roof garden (B1): a plant carried out of the greenhouse waits on the roof, not yet planted, then the character plants it.
// Waiting: the plant stands on a spot in a planter (the planter's earth over its foot, not yet sunk in), a touch brighter and breathing, with a soft pool
// of its light on the soil, a white-ish overlay breathing on it and a hint under it. The withered plant of that spot gives way (fades out) while it is there and comes back when it leaves.
// Moving: hold the plant (or press and move) to pick it up. It glides after the pointer but only along the planters'
// soil lines (ROOF_GARDEN.beds), never into the air; let go and it snaps to the nearest free spot.
// Planting: once it rests on a spot a dashed ring breathes on the soil under it. Tap the plant or the ring → the
// character turns to it where it stands (modes.js) and the plant takes root in one slow breath (RG.root): the roof and the
// music hush, its glow and shine gather and intensify while its flowers close, then its light draws down the plant while it
// settles into the earth (drawn a little lower, the planter's soil over its foot, a contact shadow); the earth answers with a
// swelling pool of its light, its stars' notes one by one and soft lights rising; its flowers pop open again, flowers, stems
// and leaves bouncing as after the growth; the plant breathes in and its sway begins. The record
// gets its spot; the withered plant there is gone for good.
// Look: the Plant Lab's roof plant (PlantView 'roof', Lab Tuning + Shapes) lit by the Lab spot's light, drawn on planes
// that are children of the bed's plane (layers.js cropChild), so they move and row-scroll exactly with it.
import * as THREE from 'three';
import { ART_H, ART_W, MIDGROUND_PROPS, PLANTS, ROOF_GARDEN as RG, STAR_FAMILIES } from './config.js';
import { loadImage, makeTexture, stage, camera } from './core.js';
import { cropChild, layers, setCropRect } from './layers.js';
import { A } from './scene.js';
import { PlantView, backOut, countsOf, labSpots, loadPlantArt, plantTuning as T, recipeOf } from './plantModel.js';
import { starRecords } from './starRecords.js';
import { noteOf } from './collect.js';
import { chime } from './chime.js';
import { setMusicDuck } from './music.js';
import { whimsyCaption } from './whimsyCaption.js';

const plants = [];   // { record, view, spot, x, y, lift, planted (0..1), bed, meshes, … }
let waiting = null;  // the plant that isn't planted yet (one at a time)
let press = null, drag = null, dragEndedAt = -1;
const smooth = v => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
const ramp = (t, [a, b]) => smooth((t - a) / (b - a));                                  // eases 0 → 1 from a to b
const swell = (t, [a, b, c]) => smooth((t - a) / (b - a)) * (1 - smooth((t - b) / (c - b)));   // eases 0 → 1 → 0, peak at b
const spotLight = sp => ({ ...RG.light, ...labSpots[sp.lab] });
const spotScale = sp => labSpots[sp.lab]?.scale || 1;
const taken = i => plants.some(p => p !== waiting && !p.preview && p.spot === i);
for (const s of RG.spots) s.base = { x: s.x, y: s.y };   // config positions; Settings → Plant spots shifts from these

// ---------------------------------------------------------------- pieces
// Soft round pool of light (white; tinted by the material) and the dashed ring, drawn once.
function canvasOf(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
const poolCanvas = canvasOf(256, 256, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.4)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});
const ringCanvas = canvasOf(512, 160, (g, w, h) => {
  g.strokeStyle = '#fff'; g.lineWidth = 7; g.setLineDash([22, 16]); g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 14;
  g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 20, h / 2 - 20, 0, 0, Math.PI * 2); g.stroke();
});
// the plant's silhouette in white (tinted by the material): the waiting plant's highlight
function paintSilhouette(g, src) {
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, src.width, src.height);
  g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, src.width, src.height);
}
const silhouette = src => canvasOf(src.width, src.height, g => paintSilhouette(g, src));
// the same, fading out upwards from its foot (row footY): the light drawing down into the soil
function paintLowerPart(g, src, footY) {
  paintSilhouette(g, src); g.globalCompositeOperation = 'destination-in';
  const gr = g.createLinearGradient(0, footY * 0.35, 0, footY);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = gr; g.fillRect(0, 0, src.width, src.height);
}
const lowerPart = (src, footY) => canvasOf(src.width, src.height, g => paintLowerPart(g, src, footY));
const additive = mesh => { mesh.material.blending = THREE.AdditiveBlending; return mesh; };
const blank = () => makeTexture(canvasOf(1, 1, () => {}));   // the row-scroll shader needs a map from the start
function setMap(mesh, cv) { mesh.material.map?.dispose(); mesh.material.map = makeTexture(cv); mesh.material.needsUpdate = true; }

// The planter art under each bed's plants (for the soil patch over a planted foot): its stacked images without the withered.
const bedArt = {};
async function loadBedArt() {
  for (const p of MIDGROUND_PROPS) if (RG.beds[p.name] && !bedArt[p.name]) {
    const names = [p.image].flat().filter(n => !(p.apart || []).includes(n));
    const imgs = await Promise.all(names.map(n => loadImage(A[n])));
    bedArt[p.name] = canvasOf(imgs[0].width, imgs[0].height, g => imgs.forEach(im => g.drawImage(im, 0, 0)));
  }
}
// The planter's earth again over the plant's foot: a patch fading in from fadeUp above the soil point, soft sides,
// plus the contact shadow. Returns the canvas and its rect.
function soilPatch(bed, x, y, sc) {
  const M = RG.soil, hw = M.halfW * sc, top = y - M.fadeUp * sc, bot = y + (M.sink + M.fadeDown + 6) * sc;
  const w = Math.ceil(hw * 2), h = Math.ceil(bot - top);
  const c = canvasOf(w, h, p => {
    p.drawImage(bedArt[bed], x - hw, top, w, h, 0, 0, w, h);
    p.globalCompositeOperation = 'destination-in';
    const gv = p.createLinearGradient(0, 0, 0, (M.fadeUp + M.fadeDown) * sc);
    gv.addColorStop(0, 'rgba(0,0,0,0)'); gv.addColorStop(1, 'rgba(0,0,0,1)'); p.fillStyle = gv; p.fillRect(0, 0, w, h);
    const gh = p.createLinearGradient(0, 0, w, 0), e = (1 - M.edge) / 2;
    gh.addColorStop(0, 'rgba(0,0,0,0)'); gh.addColorStop(e, 'rgba(0,0,0,1)'); gh.addColorStop(1 - e, 'rgba(0,0,0,1)'); gh.addColorStop(1, 'rgba(0,0,0,0)');
    p.fillStyle = gh; p.fillRect(0, 0, w, h);
    p.globalCompositeOperation = 'source-over';
    if (M.shadow > 0) {
      p.save(); p.translate(hw, (y - top) + 1.5 * sc); p.scale(1, M.shadowH / M.shadowW);
      const r = M.shadowW * sc, gr = p.createRadialGradient(0, 0, 0, 0, 0, r);
      gr.addColorStop(0, `rgba(15,8,5,${M.shadow})`); gr.addColorStop(0.5, `rgba(15,8,5,${M.shadow * 0.45})`); gr.addColorStop(1, 'rgba(15,8,5,0)');
      p.fillStyle = gr; p.fillRect(-r, -r, r * 2, r * 2); p.restore();
    }
  });
  return { c, rect: [x - hw, top, x - hw + w, top + h] };
}

// ---------------------------------------------------------------- one plant on the roof
function makePlant(record, spot) {
  const sp = RG.spots[spot], types = Object.entries(record.counts).flatMap(([k, n]) => Array(n).fill(k));
  const view = new PlantView(types, record.variant, 'roof');
  const p = { record, view, spot, x: sp.x, y: sp.y, lift: 0, planted: 0, appear: 0, bed: null, meshes: null, lit: -1, scale: 0,
    color: PLANTS.species[view.model.species]?.show || '#ffffff', ph: Math.random() * 6.28 };
  attach(p, sp.bed);
  relight(p);
  return p;
}
// (re)draw the plant for a spot's light and scale
function relight(p) {
  const sp = RG.spots[p.spot], sc = spotScale(sp), [u, H] = p.view.size();
  if (p.lit === p.spot && p.scale === sc) return;
  p.lit = p.spot; p.scale = sc;
  p.view.layout(u * sc, H * sc);
  p.view.render(1, spotLight(sp), null);
  sortBeds();   // its height may have changed its place among its bed's plants
  for (const [m, cv] of [[p.meshes.plant, p.view.cv.lit], [p.meshes.shine, silhouette(p.view.cv.lit)], [p.meshes.glow, p.view.cv.glow], [p.meshes.front, frontOf(p, sc)]]) setMap(m, cv);   // a new texture: the canvas may have resized
}
// its ground leaves, drawn again over the planter's rim
function frontOf(p, sc) {
  const M = RG.soil;
  return p.view.frontCut({ hw: M.halfW * 0.6 * sc, edge: 0.6, top: (M.sink + M.fadeUp) * sc, bottom: 3 * sc, fade: 4 * sc });
}
// Taking root, t s after the tap (RG.root.flowers): how open a flower is, closing softly, then popping open as in the growth.
function flowerOpen(t) {
  const F = RG.root.flowers;
  if (t < F.close[1]) return 1 - ramp(t, F.close);
  const v = (t - F.open[0]) / (F.open[1] - F.open[0]);
  return v > 0 ? backOut(v, PLANTS.organic.headPop) : 0;
}
// While its flowers move the plant is drawn anew each frame, into the same canvases (the planes keep their size).
function updateFlowers(p, rt) {
  const F = RG.root.flowers, m = p.view.model;
  if (!m.headOpen) return;
  const done = rt >= F.bounceAt + F.sec;
  m.bounceT = done ? null : rt - F.bounceAt;
  if (done) { m.headOpen = null; m.growSec = null; }
  p.view.render(1, spotLight(RG.spots[p.spot]), null);
  frontOf(p, p.scale);
  const { plant, glow, front, shine, drain } = p.meshes;
  if (shine.visible) paintSilhouette(shine.material.map.image.getContext('2d'), p.view.cv.lit);
  if (drain.visible) paintLowerPart(drain.material.map.image.getContext('2d'), p.view.cv.lit, p.view.oy);
  for (const mesh of [plant, glow, front, shine, drain]) if (mesh.visible || mesh !== shine && mesh !== drain) mesh.material.map.needsUpdate = true;
}
// planes on the bed's plane: pool + ring under the plant, the plant, its glow, the soil patch over its foot
// (their draw order: sortBeds)
function attach(p, bed) {
  if (p.bed === bed) return;
  const item = layers[bed], o = item.order + BED_PLANTS;
  if (!p.meshes) {
    p.meshes = {
      pool: additive(cropChild(item, makeTexture(poolCanvas), o, [0, 0, 1, 1])),
      ring: additive(cropChild(item, makeTexture(ringCanvas), o + 0.0001, [0, 0, 1, 1])),
      plant: cropChild(item, blank(), o + 0.0002, [0, 0, 1, 1]),
      shine: cropChild(item, blank(), o + 0.0003, [0, 0, 1, 1]),
      drain: additive(cropChild(item, blank(), o + 0.0003, [0, 0, 1, 1])),   // its light drawing down while it takes root
      glow: additive(cropChild(item, blank(), o + 0.0004, [0, 0, 1, 1])),
      soil: cropChild(item, blank(), o + 0.0005, [0, 0, 1, 1]),
      front: cropChild(item, blank(), o + 0.0006, [0, 0, 1, 1]),   // the ground leaves over the planter's rim
    };
    p.meshes.soil.visible = p.meshes.drain.visible = false;
    p.meshes.shine.material.color.set(RG.wait.shineColor);
  } else for (const m of Object.values(p.meshes)) item.obj.add(m);
  p.bed = bed;
  sortBeds();
}
// Within a bed, taller plants stand behind shorter ones (the climber behind the flowers): each plant's planes draw from
// the bed's order + BED_PLANTS (in front of its withered plants, at most + 0.004, scene.js), BED_STEP apart, tallest
// first; a plant's own planes 0.0001 apart (pool, ring, plant, shine, drain, glow, soil, front), its rising lights just after.
const BED_PLANTS = 0.0042, BED_STEP = 0.0008;
function sortBeds() {
  const height = p => -(p.view.g?.bounds.y0 ?? 0);   // px above its foot, as laid out for its spot
  for (const bed of new Set(plants.map(p => p.bed))) {
    const list = plants.filter(p => p.bed === bed && p.meshes).sort((a, b) => height(b) - height(a) || a.spot - b.spot);
    list.forEach((p, i) => Object.values(p.meshes).forEach((m, j) => { m.renderOrder = layers[bed].order + BED_PLANTS + BED_STEP * i + 0.0001 * j; }));
  }
}

// ---------------------------------------------------------------- the soil lines
// Soil y at x on a bed: through its spots (straight between them, flat beyond).
function soilY(bed, x) {
  const pts = RG.spots.filter(s => s.bed === bed).sort((a, b) => a.x - b.x);
  if (x <= pts[0].x) return pts[0].y;
  for (let i = 1; i < pts.length; i++) if (x <= pts[i].x) return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x);
  return pts[pts.length - 1].y;
}
// The point on the planters' soil nearest to an art point.
function onSoil(x, y) {
  let best = null, bd = Infinity;
  for (const [bed, { soil: [x0, x1] }] of Object.entries(RG.beds)) {
    const sx = Math.max(x0, Math.min(x1, x)), sy = soilY(bed, sx), d = Math.hypot(sx - x, (sy - y) * 1.5);
    if (d < bd) { bd = d; best = { bed, x: sx, y: sy }; }
  }
  return best;
}
function nearestFreeSpot(x, y) {
  let best = -1, bd = Infinity;
  RG.spots.forEach((s, i) => { const d = Math.hypot(s.x - x, (s.y - y) * 1.5); if (!taken(i) && d < bd) { bd = d; best = i; } });
  return best;
}

// ---------------------------------------------------------------- bringing a plant out
// A plant record from the greenhouse appears in the first free spot from ROOF_GARDEN.firstSpot on, waiting.
async function bringOutPlant(record) {
  await Promise.all([loadPlantArt(), loadBedArt()]);
  const n = RG.spots.length;
  let spot = -1;
  for (let k = 0; k < n && spot < 0; k++) { const i = (RG.firstSpot + k) % n; if (!taken(i)) spot = i; }
  if (spot < 0) return;   // every spot holds a plant
  const p = makePlant(record, spot);
  p.lift = RG.wait.lift;
  plants.push(p); sortBeds();
  waiting = p;
}

// ---------------------------------------------------------------- lining up the spots (Settings → Plant spots)
// Shift a spot from its config position (art px); plants resting on it move along.
function setSpotOffset(i, dx, dy) {
  const s = RG.spots[i];
  s.x = s.base.x + dx; s.y = s.base.y + dy;
  for (const p of plants) {
    if (p.spot !== i || (p === waiting && (drag || p.snapFrom))) continue;
    p.x = s.x; p.y = s.y; p.soilSpot = null;
    if (p !== waiting || p.settling) soilOver(p);   // the waiting plant redraws it once it rests
  }
}
// A planted-looking plant (the first recipe) on every free spot, to line them up with the planters; off removes them.
async function previewSpots(on) {
  for (const p of plants.filter(q => q.preview)) Object.values(p.meshes).forEach(m => { m.parent?.remove(m); m.material.map?.dispose(); });
  plants.splice(0, plants.length, ...plants.filter(q => !q.preview));
  if (!on) return;
  await Promise.all([loadPlantArt(), loadBedArt()]);
  const counts = countsOf(recipeOf(PLANTS.recipes[0]));
  RG.spots.forEach((s, i) => {
    if (plants.some(p => p.spot === i)) return;
    const p = makePlant({ counts, variant: i, stars: [], preview: true }, i);
    Object.assign(p, { preview: true, planted: 1, appear: 1 });
    soilOver(p);
    plants.push(p); sortBeds();
  });
}

// ---------------------------------------------------------------- input (modes.js routes the roof's pointer here)
// art point → is it on the waiting plant (or the ring under it)?
function hitWaiting(pt) {
  const p = waiting;
  if (!p || p.appear < 0.6 || p.settling) return false;
  const b = p.view.g?.bounds, pad = RG.hitPad;
  if (!b) return false;
  const top = p.y - p.lift + b.y0 - pad, inPlant = pt.x > p.x + b.x0 - pad && pt.x < p.x + b.x1 + pad && pt.y > top && pt.y < p.y - p.lift + pad;
  const inRing = Math.hypot(pt.x - p.x, (pt.y - p.y) * 3) < RG.wait.pool * 1.1;
  return inPlant || inRing;
}
// A press on the waiting plant may become a drag (hold or move); returns true if it was on the plant.
function pressRoof(e, pt) {
  if (!hitWaiting(pt)) return false;
  press = { id: e.pointerId, sx: e.clientX, sy: e.clientY, t: performance.now(), off: [waiting.x - pt.x, waiting.y - pt.y], at: pt };
  return true;
}
// modes.js: pointer moves (art point or null) while pressing / dragging
function moveRoof(e, pt) {
  if (press && e.pointerId === press.id && !drag && Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > RG.drag.startPx) startDrag();
  if (press && pt) press.at = pt;
}
function startDrag() {
  if (!waiting || drag) return;
  drag = { id: press.id };
  document.body.classList.add('plant-dragging');
  waiting.snapFrom = null;
  chime(3, 0.2, 0, 0.8, STAR_FAMILIES.earth);
}
// pointer up: a drag ends (snap to the nearest free spot); returns true if it was a drag
function releaseRoof(e) {
  if (!press || e.pointerId !== press.id) return false;
  press = null;
  if (!drag) return false;
  drag = null; dragEndedAt = performance.now();
  document.body.classList.remove('plant-dragging');
  const p = waiting, i = nearestFreeSpot(p.x, p.y);
  if (i >= 0) {
    const sp = RG.spots[i];
    p.snapFrom = { x: p.x, y: p.y, t: 0, bed: p.bed }; p.spot = i; attach(p, sp.bed);
    chime(5, 0.3, 0.05, 1, STAR_FAMILIES.earth);
  }
  return true;
}
const justDragged = () => performance.now() - dragEndedAt < 250;
const roofBusy = () => !!(press || drag);
// The spot the waiting plant rests on (for modes.js to walk there), or null while it moves.
const waitingSpot = () => waiting && !drag && !waiting.snapFrom && waiting.appear >= 1 && !waiting.settling ? RG.spots[waiting.spot] : null;

// The planter's earth over the plant's foot on its spot (waiting on it, or planted), drawn once per spot.
function soilOver(p) {
  if (p.soilSpot === p.spot) return;
  const sp = RG.spots[p.spot], patch = soilPatch(sp.bed, sp.x, sp.y, spotScale(sp)), m = p.meshes.soil;
  setMap(m, patch.c);
  setCropRect(m, layers[sp.bed], patch.rect);
  m.visible = true;
  p.soilSpot = p.spot;
}

// Tapped: the plant takes root (RG.root), with its stars' notes rising one by one out of a low one from the earth (the
// character turns to it, modes.js). Resolves at doneSec; the afterglow plays on from there (p.root).
function settlePlant() {
  const p = waiting;
  if (!p) return Promise.resolve();
  const R = RG.root;
  p.settling = {};
  p.root = { t: 0, motes: [], spawned: 0 };
  soilOver(p);
  setMap(p.meshes.drain, lowerPart(p.view.cv.lit, p.view.oy));
  p.meshes.drain.material.color.set(RG.wait.shineColor);
  // its flowers close and open again, then it settles on the growth's springs (all at once: growSec 0, each by its own lag)
  const m = p.view.model;
  m.growSec = 0; m.bounceT = -R.flowers.bounceAt;
  m.headOpen = st => flowerOpen(p.root.t - st.stagger * R.flowers.stagger);
  chime(0, R.chordSoft * 0.7, R.chordAt, R.chordLen, STAR_FAMILIES.earth);
  const stars = p.record.stars.map(id => starRecords.find(r => r.id === id)).filter(Boolean).sort((a, b) => noteOf(a) - noteOf(b));
  stars.forEach((r, i) => chime(noteOf(r), R.chordSoft, R.chordAt + (i + 1) * R.chordStep, R.chordLen, STAR_FAMILIES[r.type]));
  setHush(p);
  setMusicDuck(true);
  return new Promise(done => { p.settling.done = done; });
}

// The soft lights rising from the soil while it takes root: each its own little plane on the bed, gone again after it.
function updateMotes(p, sc) {
  const M = RG.root.motes, r = p.root, b = p.view.g?.bounds, rnd = ([a, z]) => a + (z - a) * Math.random();
  const half = b ? (b.x1 - b.x0) / 2 * M.spread : 60, tint = new THREE.Color(p.color).lerp(new THREE.Color(RG.wait.shineColor), 0.45);
  while (r.spawned < M.n && r.t >= M.from + r.spawned * M.every) {
    r.spawned++;
    const mesh = additive(cropChild(layers[p.bed], p.meshes.pool.material.map, p.meshes.front.renderOrder + 0.00005, [0, 0, 1, 1]));
    r.motes.push({ mesh, born: r.t, life: rnd(M.life), x: p.x + (Math.random() * 2 - 1) * half, y: p.y - Math.random() * 14 * sc,
      rise: rnd(M.rise) * sc, size: rnd(M.size) * sc, ph: Math.random() * 6.28 });
  }
  r.motes = r.motes.filter(m => {
    const u = (r.t - m.born) / m.life;
    if (u >= 1) { m.mesh.parent?.remove(m.mesh); m.mesh.material.dispose(); m.mesh.geometry.dispose(); return false; }
    const x = m.x + Math.sin(m.ph + (r.t - m.born) * 0.7) * M.drift * sc, y = m.y - m.rise * (1 - (1 - u) * (1 - u));
    setCropRect(m.mesh, layers[p.bed], [x - m.size, y - m.size, x + m.size, y + m.size]);
    m.mesh.material.color.copy(tint).multiplyScalar(M.strength * Math.sin(Math.PI * u) ** 1.5);
    return true;
  });
}

// ---------------------------------------------------------------- per frame
// Screen position of an art point on a bed's plane (for the caption)
const _v = new THREE.Vector3();
function screenAt(bed, x, y) {
  const item = layers[bed];
  _v.set((x / ART_W - 0.5) * item.w, (0.5 - y / ART_H) * item.h, 0);
  item.obj.localToWorld(_v).project(camera);
  return [(_v.x + 1) / 2 * 100, (1 - _v.y) / 2 * 100];
}
const { el: caption, set: setCaption } = whimsyCaption(stage, 'roof-caption soft-out');
setCaption('Tap to plant', 'hold to move it to another spot');
// While a plant takes root the roof around it dims a little (under the UI, over the game), softly open around the plant.
const hush = document.createElement('div');
hush.className = 'plant-hush';
stage.prepend(hush);
function setHush(p) {
  const [x, y] = screenAt(p.bed, p.x, p.y - (p.view.g ? -p.view.g.bounds.y0 / 2 : 150));
  hush.style.setProperty('--x', `${x}%`); hush.style.setProperty('--y', `${y}%`);
}
const hover = { on: false };
const hoverRoof = pt => { hover.on = !!pt && hitWaiting(pt); return hover.on; };

// Sway as in the Lab's roof view (T.sway, a slow lean per spot), and a plane leaning by it around a pivot row (art px):
// the plane's corners shift sideways, more the further they are from the pivot, so the soil line stays put.
const swayAt = (now, i) => Math.sin(now * 0.8 + i * 1.7) * T.sway;
function shear(mesh, skew, pivotY) {
  const [x0, y0, x1, y1] = mesh.userData.rect, w = x1 - x0, pos = mesh.geometry.attributes.position;
  const top = skew * (pivotY - y0) / w, bot = -skew * (y1 - pivotY) / w;
  pos.setX(0, -0.5 + top); pos.setX(1, 0.5 + top); pos.setX(2, -0.5 + bot); pos.setX(3, 0.5 + bot); pos.needsUpdate = true;
}

// Taking root, t s after the tap: the plant's one breath in and out, [width, height] scale (around its foot).
function breathScale(t) {
  const R = RG.root, [a, b, c] = R.breath;
  return [1 + R.breathWide * swell(t - R.breathLag, [a, b, c]), 1 + R.breathUp * swell(t, [a, b, c])];
}

function updateRoofGarden(dt, now) {
  const R = RG.root;
  // withered plants: hidden under a plant (planted, waiting or carried over them), back otherwise
  const under = new Set();
  for (const p of plants) {
    if (p !== waiting || !drag) { under.add(p.spot); continue; }
    const i = RG.spots.findIndex(s => Math.hypot(s.x - p.x, (s.y - p.y) * 1.5) < 110);
    if (i >= 0) under.add(i);
  }
  RG.spots.forEach((s, i) => {
    const m = s.withered && layers[s.bed]?.apart?.[s.withered];
    if (!m) return;
    const to = under.has(i) ? 0 : 1, o = m.material.opacity;
    m.material.opacity = to > o ? Math.min(to, o + dt / RG.witheredFade) : Math.max(to, o - dt / RG.witheredFade);
    m.visible = m.material.opacity > 0.001;
    if (m.visible) shear(m, swayAt(now, i) * RG.witheredSway, s.y);   // the withered plants sway like the flowers
  });

  for (const p of plants) {
    const W = RG.wait, wait = p === waiting;
    p.appear = Math.min(1, p.appear + dt / RG.appearSec);
    // where it is: following the pointer along the soil, snapping, or resting on its spot
    if (wait && press && !drag && performance.now() - press.t > RG.drag.holdSec * 1000) startDrag();
    if (wait && drag && press?.at) {
      const s = onSoil(press.at.x + press.off[0], press.at.y + press.off[1]), k = 1 - Math.exp(-dt * RG.drag.follow);
      attach(p, s.bed);
      p.x += (s.x - p.x) * k; p.y += (s.y - p.y) * k;
    } else if (p.snapFrom) {
      const f = p.snapFrom, sp = RG.spots[p.spot];
      f.t = Math.min(1, f.t + dt / RG.drag.snapSec);
      const e = smooth(f.t);
      p.x = f.x + (sp.x - f.x) * e; p.y = f.y + (sp.y - f.y) * e;
      if (f.t >= 1) p.snapFrom = null;
    }
    relight(p);
    // height: standing in the soil (lifted while carried), then sinking into the earth while it settles
    const sc = spotScale(RG.spots[p.spot]);
    let lift = wait ? W.lift + W.bob * Math.sin(now * 2 * Math.PI / W.bobSec + p.ph) + (drag ? RG.drag.lift : 0) : 0;
    const rt = p.root ? (p.root.t += dt) : -1;   // seconds since the tap, while it takes root
    if (p.root) p.planted = ramp(rt, R.sink);
    if (p.settling && rt >= R.doneSec) { const done = p.settling.done; p.settling = null; waiting = null; p.record.spot = p.spot; done(); }
    if (wait) lift *= 1 - p.planted;
    p.lift += (lift - p.lift) * (1 - Math.exp(-dt * 8));
    const sink = RG.soil.sink * sc * p.planted, v = p.view, cv = v.cv.lit, item = layers[p.bed];
    const foot = p.y - p.lift + sink, x0 = p.x - v.ox, y0 = foot - v.oy;
    // taking root (RG.root): scaled around its foot, height gy, width gx
    const [gx, gy] = p.root ? breathScale(rt) : [1, 1];
    const shown = [p.meshes.plant, p.meshes.shine, p.meshes.drain, p.meshes.glow, p.meshes.front];
    for (const m of shown) setCropRect(m, item, [p.x + (x0 - p.x) * gx, foot + (y0 - foot) * gy, p.x + (x0 + cv.width - p.x) * gx, foot + (y0 + cv.height - foot) * gy]);
    // sway (Lab T.sway) once planted: the top leans, the soil point stays
    const skew = swayAt(now, p.spot) * (p.root ? ramp(rt, R.sway) : p.planted);
    for (const m of shown) shear(m, skew, p.y - p.lift + sink);
    // waiting look: a white-ish overlay, breathing (stronger under the pointer); fades in when it appears, melts away as it takes root
    const breath = 0.5 - 0.5 * Math.cos(now * 1.8 + p.ph), waitA = !wait ? 0 : p.root ? 1 - ramp(rt, R.shineOut) : 1;
    // taking root: its glow and shine gathering first, then its light drawing down, its own glow swelling again with the breath
    const gather = p.root ? swell(rt, R.gather) : 0;
    p.meshes.shine.material.opacity = waitA * p.appear * (W.shine + W.shineBreath * breath + (hover.on || drag ? W.shineHover : 0)) + gather * R.gatherShine;
    p.meshes.shine.visible = p.meshes.shine.material.opacity > 0.001;
    p.meshes.plant.material.opacity = p.meshes.glow.material.opacity = p.appear;
    const drainA = p.root ? swell(rt, R.drain) * R.drainStrength : 0;
    p.meshes.drain.material.opacity = drainA;
    p.meshes.drain.visible = drainA > 0.001;
    p.meshes.glow.material.color.setScalar(1 + gather * R.gatherGlow + (p.root ? swell(rt, R.breath) * R.wake : 0));
    // the pool of light on the soil, and the ring once it rests on a spot
    // while it takes root, the pool swells slowly and wide, then fades out; the ring opens and fades
    const bloom = p.root ? swell(rt, R.bloom) : 0, opened = p.root ? ramp(rt, [0, R.bloom[2]]) : 0;
    const pool = p.meshes.pool, pr = W.pool * sc * (1 + R.bloomWide * opened);
    setCropRect(pool, item, [p.x - pr, p.y - pr * 0.35, p.x + pr, p.y + pr * 0.35]);
    const poolA = W.poolStrength * p.appear * (waitA * (0.75 + 0.25 * breath + (drag ? 0.3 : 0)) + bloom * R.bloomStrength);
    pool.material.color.set(p.color).multiplyScalar(poolA);
    pool.visible = poolA > 0.001;
    const ring = p.meshes.ring, rest = wait && !drag && !p.snapFrom && !p.settling ? 1 : 0;
    p.ringA = (p.ringA || 0) + (rest * p.appear - (p.ringA || 0)) * (1 - Math.exp(-dt * (p.root ? R.ringOut : 4)));
    const rr = W.pool * sc * 0.85 * (1 + (p.root ? R.ringWiden * ramp(rt, [0, 3]) : 0));
    setCropRect(ring, item, [p.x - rr, p.y - rr * 0.31, p.x + rr, p.y + rr * 0.31]);
    ring.material.color.setScalar(p.ringA * (0.35 + 0.3 * breath + (hover.on ? 0.35 : 0)));
    ring.visible = p.ringA > 0.01;
    // the planter's earth over its foot: while it rests on a spot (it stands in the soil), and once planted
    if (rest) soilOver(p);
    p.soilA = (p.soilA || 0) + (rest * p.appear - (p.soilA || 0)) * (1 - Math.exp(-dt * (rest ? 6 : 16)));
    p.meshes.soil.material.opacity = Math.max(p.planted, p.settling ? 1 : wait ? p.soilA : 0);
    p.meshes.front.material.opacity = p.meshes.soil.material.opacity * p.appear;   // only needed where the soil patch covers the plant
    p.meshes.front.visible = p.meshes.soil.visible && p.meshes.front.material.opacity > 0.001;
    if (p.root) {
      updateMotes(p, sc);
      updateFlowers(p, rt);
      if (rt >= R.sec && !p.view.model.headOpen && !p.root.motes.length && p.root.spawned >= R.motes.n) p.root = null;
    }
  }

  // while a plant takes root: the roof and the music hushed
  const rooting = plants.find(p => p.root), rt = rooting ? rooting.root.t : -1;
  const hushA = rooting ? swell(rt, R.hush) * R.hushStrength : 0;
  hush.style.opacity = hushA.toFixed(3);
  if (rooting && rt >= R.hush[2]) setMusicDuck(false);

  // the hint over the waiting plant while it rests on a spot: what you can do with it (brighter under the pointer)
  const show = waiting && !drag && !waiting.snapFrom && !waiting.settling && waiting.appear >= 1;
  if (show) {
    const top = waiting.y - waiting.lift + (waiting.view.g?.bounds.y0 ?? -300);
    const [sx, sy] = screenAt(waiting.bed, waiting.x, top - RG.captionY);
    caption.style.left = `${sx}%`; caption.style.top = `${sy}%`;
  }
  caption.classList.toggle('show', !!show);
  caption.classList.toggle('hover', !!show && hover.on);
}

export { plants as roofPlants, bringOutPlant, setSpotOffset, previewSpots, hitWaiting, hoverRoof, pressRoof, moveRoof, releaseRoof, justDragged, roofBusy, waitingSpot, settlePlant, updateRoofGarden };
