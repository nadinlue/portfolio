// Planting (B1): three stars from the jars become a plant in the greenhouse pot. The recipes in PLANTS.recipes can
// grow: any three of the four first stars (one of each element), each a different species from the Plant Lab.
// How the player learns it: as soon as there are stars in the jars, three empty white circles float above
// the pot under "Drag stars into the circles". The greenhouse breathes on the roof while a whole recipe waits
// in the jars.
// Choosing: drag a star out of a jar and let go near a circle → it snaps into the middle and the circle fades
// out. Drag it out again (anywhere but another circle) → it flies back to its jar and the circle fades in.
// A star the recipe can't use (or has enough of) floats back to its jar. All circles full → "Grow ✦".
// A tap on a jar (no drag) still makes its stars swirl and sing (jars.js).
// Growing (as in the Plant Lab): the stars drop into the soil one by one with their notes, the soil glows,
// the plant grows out of the earth (drawn a little lower, the pot drawn again over its foot, a soft contact
// shadow), a hold. (With PLANTS.camFollow the camera follows the growing tip up when the plant is taller than the
// view, layers panning at their own speed, greenhouse.js, and eases back after the hold.) The growth itself is the Lab's organic one
// (PLANTS.organic, plantModel.js): searching stem tips, ripening buds that pop open, leaves popping out of the soil,
// each piece settling on its own spring; no bursts, soil glow or motes while it grows unless PLANTS.organic.fx. The three star records are consumed
// once and one plant record is created.
// Taking it out: once grown, the plant breathes a little brighter, soft particles spiral out around it, its name shows under
// it with "✦ Carry it outside ✦" below (no hover needed); a tap on the plant or the leave button carries it along too. A tap lifts it out of the pot in a shimmer, then modes.js leaves the greenhouse
// and the plant waits on the roof to be planted (roofGarden.js). Until then it stays in the pot, also when you leave.
// Drawn in the greenhouse interior (greenhouse.js): the plant and its light on sheets that move with the pot,
// above the lamp; slots, flying stars and the pot's tap area on top.
import { ROOM_H, ROOM_W, GREENHOUSE, PLANTS, STAR_FAMILIES } from './config.js';
import { $ } from './util.js';
import { house, interior, reveal, roomLayer, roomPan, roomSheet } from './greenhouse.js';
import { jarBusy, jarCount, jarPoint, onJarDown, onJarTap, returnToJar, starUrl, takeFromJar } from './jars.js';
import { noteOf, satchelCount } from './collect.js';
import { chime, thud } from './chime.js';
import { game } from './modes.js';
import { PlantView, countsOf, loadPlantArt, mixKey, plantTuning as T, recipeOf } from './plantModel.js';
import { whimsyCaption } from './whimsyCaption.js';
import { collectStar } from './starRecords.js';
import { landStar } from './netStars.js';

const R = PLANTS.reveal, M = PLANTS.soilMask, FX = PLANTS.growFx, [SOIL_X, SOIL_Y] = PLANTS.soil;
const btnLeave = $('btnLeaveGreenhouse');
const growFx = () => !PLANTS.organic.on || PLANTS.organic.fx;   // bursts, soil glow and motes while it grows (the organic growth has none)
const JAR_STAR = 150;      // a star's size where it leaves / enters a jar, 4K px
const px = (v, of) => `${(v / of * 100).toFixed(3)}%`;
const ease = t => t * t * (3 - 2 * t);
const plantRecords = [];   // { id, stars: [starId ×3], counts, recipe, variant, spot: null (waits in the pot), createdAt }
let nextPlant = 1;

// The pot: idle (choosing) → stars → soil → grow → bloom → hold → back (camera down) → grown → carry (lifted out) → idle
const pot = { phase: 'idle', t: 0, grow: 0, view: null, order: [], drops: [], burst: [], motes: [], moteT: 0, dirty: true, ready: false, artReady: false, camY: 0, idle: 0 };
// The recipes that can grow (star counts per element); every one takes three stars, so three circles
const RECIPES = PLANTS.recipes.map(key => countsOf(recipeOf(key))), SLOTS = 3;
const fits = (c, R) => Object.keys(c).every(k => c[k] <= R[k]);   // counts c are (part of) recipe R

// ---------------------------------------------------------------- sheets
// Plant + its light: moving with the pot, but drawn above the lamp and below the jars' flying stars.
const firstTop = interior.querySelector('.interior-top');
const plantArt = roomSheet('greenhouse_plantpot', { top: true });
const lightArt = roomSheet('greenhouse_plantpot', { top: true, className: 'interior-lights' });
for (const art of [plantArt, lightArt]) interior.insertBefore(art.parentElement, firstTop);
// Things standing in front of the pot (GREENHOUSE.interior `front: true`: the star book, the shovel) stay in front of the
// plant and the pot drawn again over its foot. (Their own sheets, made later with roomSheet, follow their layer.)
for (const l of GREENHOUSE.interior.filter(l => l.front)) interior.insertBefore(roomLayer(l.image), firstTop);
const plantCv = document.createElement('canvas'), lightCv = document.createElement('canvas');
for (const [art, cv] of [[plantArt, plantCv], [lightArt, lightCv]]) { cv.className = 'plant-canvas'; art.appendChild(cv); }
const ui = roomSheet('greenhouse_plantpot', { top: true, className: 'interior-top' });

// Above the painted greenhouse (placeholders, as in the Lab): a night sky that ends in the sky picture's top
// colour, stars that pan a little faster, and a glass roof behind the frame. Only seen while the camera is up.
const A = PLANTS.above, SVG = 'http://www.w3.org/2000/svg';
const skyArt = roomSheet('greenhouse_sky', { behind: true });
const skyFade = document.createElement('div');
skyFade.className = 'plant-above';
place(skyFade, 0, -A.skyHeight, ROOM_W, A.skyHeight + 4); skyFade.style.width = '100%';
skyArt.appendChild(skyFade);
const starsArt = roomSheet('greenhouse_sky', { behind: true, pan: A.starsPan });
function svgBox(parent, [x0, y0, w, h]) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`); svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('plant-above');
  Object.assign(svg.style, { left: px(x0, ROOM_W), top: px(y0, ROOM_H), width: px(w, ROOM_W), height: px(h, ROOM_H) });
  parent.appendChild(svg);
  return svg;
}
{
  let seed = 7;   // the Lab's star field (rng(7))
  const rs = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const svg = svgBox(starsArt, [0, -3900, ROOM_W, 4200]);
  svg.innerHTML = Array.from({ length: A.stars }, () => {
    const x = rs() * ROOM_W, y = -rs() * 4200 + 300, r = 1 + rs() * 2.5, a = 0.3 + rs() * 0.7, tw = 0.5 + rs() * 2;
    return `<circle class="plant-sky-star" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(r * 2).toFixed(1)}" fill="#dfe6ff"
      style="--a:${a.toFixed(2)};animation-duration:${(6.28 / tw).toFixed(2)}s;animation-delay:-${(x % 7).toFixed(1)}s"/>`;
  }).join('');
  if (PLANTS.camFollow) {   // reaches into the painted view: its pane's lower edge and the posts' ends show in the sky at rest
    const roof = svgBox(roomSheet('greenhouse_frame', { behind: true }), [-200, -900, 4240, 1100]);
    const path = 'M-200 150 L1920 -850 L4040 150';
    roof.innerHTML = `<path d="${path} Z" fill="rgba(120,150,255,0.07)"/>
      <g stroke="#1c130e" stroke-linecap="round" fill="none"><path d="${path}" stroke-width="46"/>
      ${[0.33, 0.66].map(f => `<path d="M${-200 + 2120 * f} ${150 - 1000 * f} L${4040 - 2120 * f} ${150 - 1000 * f}" stroke-width="26"/>`).join('')}
      ${[700, 1300, 2540, 3140].map(x => `<path d="M${x} 100 L${x} ${150 - 1000 * (1 - Math.abs(x - 1920) / 2120)}" stroke-width="22"/>`).join('')}</g>`;
  }
}
// the sky gradient ends in the colour at the top of the sky picture, so there is no seam
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
loadImg(`${GREENHOUSE.interiorDir}greenhouse_sky.webp`).then(im => {
  const c = document.createElement('canvas'); c.width = 16; c.height = 4;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0, im.width, im.height * 40 / ROOM_H, 0, 0, 16, 4);
  const d = g.getImageData(0, 0, 16, 1).data; let r = 0, gr = 0, b = 0;
  for (let i = 0; i < 16; i++) { r += d[i * 4]; gr += d[i * 4 + 1]; b += d[i * 4 + 2]; }
  skyFade.style.background = `linear-gradient(${A.skyDark}, rgb(${r / 16 | 0}, ${gr / 16 | 0}, ${b / 16 | 0}))`;
}).catch(() => { skyFade.style.background = `linear-gradient(${A.skyDark}, #1b2c6e)`; });
// The pot art, drawn again over the plant's foot (only below the soil point, with a soft edge)
let potImg = null, soilFront = null;
loadImg(`${GREENHOUSE.interiorDir}greenhouse_plantpot.webp`).then(im => { potImg = im; soilFront = null; pot.dirty = true; });

function place(el, x, y, w, h = w) {
  Object.assign(el.style, { left: px(x, ROOM_W), top: px(y, ROOM_H), width: px(w, ROOM_W), height: px(h, ROOM_H) });
}

// Circles: one per star of the recipe, in a soft arc above the pot. Each holds one star or nothing.
const slots = Array.from({ length: SLOTS }, (_, i) => {
  const el = document.createElement('div'), star = document.createElement('div');
  el.className = 'plant-slot'; star.className = 'plant-slot-star';
  el.appendChild(star); ui.appendChild(el);
  const off = i - (SLOTS - 1) / 2, x = SOIL_X + off * PLANTS.slotGap, y = PLANTS.slotY + Math.abs(off) * 40;
  place(el, x, y, PLANTS.slotSize * 1.8);
  const slot = { el, star, x, y, record: null, incoming: false, show: 0, ring: 1, hot: 0, pulse: 0, ph: i * 1.3 };
  star.addEventListener('pointerdown', e => { if (slot.record && !slot.incoming && choosing()) startPress(e, slot.record.type, slot); });
  return slot;
});
// The pot's area (its name on hover once grown), and the caption over the circles.
const potHit = document.createElement('div');
potHit.className = 'plant-pot-hit';
const POT_HIT = [1740, 1500, 420, 420];   // x, y, w, h (art px); grows over the whole plant once it has grown
place(potHit, ...POT_HIT);
potHit.addEventListener('pointerenter', () => { pot.hover = true; });
potHit.addEventListener('pointerleave', () => { pot.hover = false; });
potHit.addEventListener('click', () => { if (pot.phase === 'grown' && game.mode === 'greenhouse') carryOut(); });
window.addEventListener('carryplant', carryOut);   // "Carry it outside" / Esc (modes.js)
// The pot leaves with the plant (carry); entering again, a new empty pot stands on the table (greenhouse.js event)
const potLayer = roomLayer('greenhouse_plantpot');
window.addEventListener('greenhouseenter', () => { if (pot.gone) { pot.gone = false; potLayer.style.translate = ''; potLayer.style.opacity = ''; } });
ui.appendChild(potHit);
const { el: caption, set: setCaption } = whimsyCaption(ui, 'plant-caption breathe');
// Grow ✦ appears above the filled circles, where the caption was (it moves with the pot's sheet)
const btnGrow = $('btnGrow');
btnGrow.addEventListener('click', grow);
ui.appendChild(btnGrow);
btnGrow.style.left = px(SOIL_X, ROOM_W);
btnGrow.style.top = px(PLANTS.slotY - PLANTS.slotSize * 1.3, ROOM_H);
// ✦ Carry it outside ✦ under the grown plant's name
const btnCarry = $('btnCarry');
btnCarry.addEventListener('click', carryOut);
ui.appendChild(btnCarry);
btnCarry.style.left = px(SOIL_X, ROOM_W);
btnCarry.style.top = px(PLANTS.ready.buttonY, ROOM_H);

// ---------------------------------------------------------------- choosing
const choosing = () => game.mode === 'greenhouse' && pot.phase === 'idle' && pot.artReady && !jarBusy() && !satchelCount();
const allFilled = () => slots.every(s => s.record && !s.incoming);
// can a star of this element join the circles? (with the stars already in them it is still part of some recipe)
const wanted = type => RECIPES.some(R => fits(countsOf([...slots.filter(s => s.record).map(s => s.record.type), type]), R));

// A flying star (back to a jar, snapping into a circle, into the soil), drawn as a DOM sprite on top.
const flyers = [];
function fly(type, from, to, { sec = 0.75, delay = 0, size0 = PLANTS.slotSize, size1 = PLANTS.slotSize, lift = 380, spin = 160, glow = null } = {}) {
  return new Promise(done => {
    const el = document.createElement('div');
    el.className = 'jar-fly';
    if (glow) el.style.filter = `drop-shadow(0 0 0.6vmin ${glow}) drop-shadow(0 0 1.4vmin ${glow})`;   // the Lab's glow behind a falling star
    el.style.backgroundImage = starUrl(type);
    el.style.opacity = delay > 0 ? 0 : 1;
    ui.appendChild(el);
    const ctrl = [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - lift];
    flyers.push({ el, from, ctrl, to, sec, delay, size0, size1, t: 0, spin: (Math.random() < 0.5 ? -1 : 1) * spin, done });
  });
}

// Dragging: a press on a jar (with stars) or on a filled circle becomes a drag once the pointer moves a little;
// a shorter press stays a tap (jars: swirl and sing).
const DRAG_START = 8;     // screen px the pointer moves before a press becomes a drag
const SNAP = 1.3;         // a star let go within this × slotSize of an empty circle snaps into it
let press = null, drag = null, dragEndedAt = -1;
const artPoint = e => { const r = ui.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * ROOM_W, (e.clientY - r.top) / r.height * ROOM_H]; };
function startPress(e, type, slot = null) {
  press = { type, slot, x: e.clientX, y: e.clientY, id: e.pointerId };
  e.preventDefault();
}
onJarDown((fam, e) => { if (choosing() && jarCount(fam)) startPress(e, fam); });
onJarTap(() => performance.now() - dragEndedAt < 250);   // a drag let go over a jar is not a tap
window.addEventListener('pointermove', e => {
  if (press && !drag && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_START) startDrag(e);
  if (drag && e.pointerId === drag.id) drag.at = artPoint(e);
});
const endPress = e => {
  if (drag && e.pointerId === drag.id) drop();
  if (press && e.pointerId === press.id) press = null;
};
window.addEventListener('pointerup', endPress);
window.addEventListener('pointercancel', endPress);

function startDrag(e) {
  const { type, slot } = press;
  let record;
  if (slot) { if (!choosing() || slot.record?.type !== type || slot.incoming) return; record = slot.record; slot.record = null; }
  else if (!choosing() || !(record = takeFromJar(type, 'pot'))) return;
  const el = document.createElement('div');
  el.className = 'jar-fly plant-drag';
  el.style.backgroundImage = starUrl(type);
  ui.appendChild(el);
  drag = { record, el, id: press.id, at: artPoint(e), size: slot ? PLANTS.slotSize : JAR_STAR };
  document.body.classList.add('plant-dragging');
  chime(noteOf(record), 0.25, 0, 0.7, STAR_FAMILIES[type]);
}
// the empty circle a star would snap into from here, or null
function nearestFree([x, y]) {
  let best = null, bd = PLANTS.slotSize * SNAP;
  for (const s of slots) { const d = Math.hypot(s.x - x, s.y - y); if (!s.record && d < bd) { bd = d; best = s; } }
  return best;
}
async function drop() {
  const { record, el, at, size } = drag, type = record.type, slot = nearestFree(at);
  drag = null; dragEndedAt = performance.now();
  document.body.classList.remove('plant-dragging');
  el.remove();
  if (slot && wanted(type) && pot.phase === 'idle') {   // snap into the middle of the circle
    slot.record = record; slot.incoming = true; pot.idle = 0;   // the hint goes and waits again
    await fly(type, at, [slot.x, slot.y], { sec: 0.22, lift: 0, spin: 0, size0: size, size1: PLANTS.slotSize });
    slot.incoming = false; slot.pulse = 1;
    chime(noteOf(record), 0.5, 0, 1.1, STAR_FAMILIES[type]);
    if (allFilled()) chord(slots.map(s => s.record), 0.25, 0.3);
    return;
  }
  if (slot) thud();   // this plant doesn't take that star (yet): it floats home
  await fly(type, at, jarPoint(type), { sec: 0.6, lift: 160, size0: size, size1: JAR_STAR });
  returnToJar(record);
}

const chord = (records, soft = 0.4, when = 0) => records.forEach((r, i) => chime(noteOf(r), soft, when + i * 0.09, 2.2, STAR_FAMILIES[r.type]));

// ---------------------------------------------------------------- growing
async function grow() {
  if (!choosing() || !allFilled() || !pot.artReady) return;
  const stars = slots.map(s => s.record);
  // Consume the three stars once and create the plant record, in the same step.
  const counts = countsOf(stars.map(r => r.type)), key = mixKey(counts);
  const variant = plantRecords.some(p => p.recipe === key) ? Math.floor(Math.random() * 99) + 1 : 0;   // the first of each mix as tuned in the Lab
  const plant = { id: `plant-${nextPlant++}`, stars: stars.map(r => r.id), counts, recipe: key, variant, spot: null, createdAt: Date.now() };
  for (const r of stars) { r.location = 'consumed'; r.plantId = plant.id; }
  plantRecords.push(plant);
  pot.plant = plant;
  for (const s of slots) s.record = null;
  pot.view = new PlantView(stars.map(r => r.type), variant);
  pot.order = stars; pot.grow = 0; pot.burst = []; pot.motes = []; pot.moteT = 0; pot.motesPuffed = false; pot.dirty = true; pot.camY = 0; pot.bounceT = null;
  pot.bloomT = null; pot.arcDir = Math.random() < 0.5 ? -1 : 1;   // the reveal's camera (updateRevealCamera)
  pot.phase = 'stars'; pot.t = 0;
  // the stars drop from their slots into the soil, one after another
  pot.drops = stars.map(r => ({ type: r.type, record: r, landed: false }));
  pot.drops.forEach((d, i) => fly(d.type, [slots[i].x, slots[i].y], [SOIL_X, SOIL_Y - 20], { sec: R.starFly, delay: i * R.starGap, size1: 70, lift: 160, glow: STAR_FAMILIES[d.type].star })
    .then(() => {
      d.landed = true;
      chime(noteOf(d.record), 0.55, 0, 1.4, STAR_FAMILIES[d.type]);
      if (growFx()) burst(SOIL_X, SOIL_Y - 10, 14, [STAR_FAMILIES[d.type].star, '#fff4c8'], 260, 0.8);
    }));
  window.dispatchEvent(new CustomEvent('plantcreated', { detail: plant }));
}

// ---------------------------------------------------------------- taking it outside
const CARRY_SEC = 0.9;
function carryOut() {
  if (pot.phase !== 'grown') return;
  pot.phase = 'carry'; pot.t = 0; pot.hover = false; house.plantInPot = false;
  const cols = [PLANTS.species[pot.view.model.species].show, ...pot.order.map(r => STAR_FAMILIES[r.type].star), '#ffffff'];
  burst(SOIL_X, SOIL_Y - 60, 18, cols, 300, 1.2);
  chord(pot.order, 0.4);
}
function carried() {
  const plant = pot.plant;
  pot.phase = 'idle'; pot.view = null; pot.plant = null; pot.glow = null; pot.dirty = true; pot.motes = [];
  place(potHit, ...POT_HIT);
  for (const art of [plantArt, lightArt]) { art.style.translate = ''; art.style.opacity = ''; }
  plantArt.style.filter = '';
  pot.gone = true;   // the pot went out with the plant; a new empty one waits on the next visit
  window.dispatchEvent(new CustomEvent('plantcarried', { detail: plant }));   // modes.js leaves with it
}

// Dev shortcut (Dev → First plant ✦): the first recipe's plant, made without stars, goes straight to the roof to be planted.
$('btnFirstPlant').addEventListener('click', () => {
  if (game.mode !== 'rooftop') return;
  const counts = RECIPES[0], plant = { id: `plant-${nextPlant++}`, stars: [], counts, recipe: mixKey(counts),
    variant: 0, spot: null, createdAt: Date.now(), dev: true };
  plantRecords.push(plant);
  window.dispatchEvent(new CustomEvent('plantcarried', { detail: plant }));
});

// Dev shortcut (Dev → Fill nets ✦): one star of each element appears in a net one after another (as at the start of
// the game), as if their constellations had been completed, to playtest collecting, choosing and growing.
$('btnFillNets').addEventListener('click', () => {
  ['fire', 'water', 'earth', 'air'].forEach((type, i) => setTimeout(() => landStar(collectStar(type, 'dev'), 0.7), i * 350));
});

function burst(x, y, n, colors, speed, life) {
  n = Math.round(n * FX.sparkle);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
    pot.burst.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life: life * (0.6 + Math.random() * 0.6), t: 0,
      color: colors[i % colors.length], size: 6 + Math.random() * 10 });
  }
}

// ---------------------------------------------------------------- drawing
let k = 0;   // canvas px per art px
function fitCanvases() {
  const w = plantArt.clientWidth, h = plantArt.clientHeight;
  if (!w || !h) return false;
  const dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.min(ROOM_W, Math.round(w * dpr)), ch = Math.round(cw * h / w);
  if (plantCv.width === cw && plantCv.height === ch) return true;
  for (const cv of [plantCv, lightCv]) { cv.width = cw; cv.height = ch; }
  k = cw / ROOM_W; pot.dirty = true; soilFront = null;
  return true;
}
const mixHex = (a, b, f = 0.5) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - f) + parseInt(b.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');
function glowDot(g, x, y, rad, col, str) {
  if (str <= 0.001 || rad <= 0.5) return;
  const [r, gr, b] = [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16)), s = Math.min(1, str), grd = g.createRadialGradient(x, y, 0, x, y, rad);
  grd.addColorStop(0, `rgba(${r},${gr},${b},${s})`); grd.addColorStop(0.35, `rgba(${r},${gr},${b},${s * 0.35})`); grd.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}
// a mote: the star reveal's particle (delivery.js), a small bright white core in a soft round glow of its tint
function moteDot(g, x, y, rad, col, a) {
  if (a <= 0.001 || rad <= 0.5) return;
  const [r, gr, b] = [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16)), c = (f) => `rgba(${r},${gr},${b},${a * f})`;
  const grd = g.createRadialGradient(x, y, 0, x, y, rad);
  grd.addColorStop(0, `rgba(255,255,255,${a})`); grd.addColorStop(0.12, `rgba(255,255,255,${a * 0.9})`);
  grd.addColorStop(0.3, c(0.35)); grd.addColorStop(0.6, c(0.1)); grd.addColorStop(1, c(0));
  g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
}
function drawPlant() {
  const pv = pot.view, c = plantCv.getContext('2d');
  c.clearRect(0, 0, plantCv.width, plantCv.height);
  if (!pv || pot.phase === 'stars' || pot.phase === 'soil') { pot.glow = null; return; }
  const [u, H] = pv.size();
  pv.layout(u * k, H * k);
  const L = PLANTS.light, grad = [pv.oy + (L.warmUntil - SOIL_Y) * k, pv.oy + (L.coolFrom - SOIL_Y) * k];
  pv.render(pot.grow, L, grad);
  c.drawImage(pv.cv.lit, SOIL_X * k - pv.ox, (SOIL_Y + M.sink) * k - pv.oy);   // a little lower: the foot is in the earth
  pot.glow = pv.cv.glow;
  if (potImg && !soilFront) {   // the pot again, faded in from fadeUp above the soil point to fadeDown below it
    soilFront = document.createElement('canvas'); soilFront.width = plantCv.width; soilFront.height = plantCv.height;
    const x = soilFront.getContext('2d');
    const [bx, by] = GREENHOUSE.bleed, sc = potImg.width / (ROOM_W + 2 * bx);   // the frame only, without the bleed
    x.drawImage(potImg, bx * sc, by * sc, ROOM_W * sc, ROOM_H * sc, 0, 0, soilFront.width, soilFront.height);
    const gr = x.createLinearGradient(0, (SOIL_Y - M.fadeUp) * k, 0, (SOIL_Y + M.fadeDown) * k);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-in'; x.fillStyle = gr; x.fillRect(0, 0, soilFront.width, soilFront.height);
  }
  if (soilFront) c.drawImage(soilFront, 0, 0);
  if (M.shadow > 0) {   // soft contact shadow on the soil, over the plant's foot too
    const grown = pot.phase === 'grow' ? smooth(pot.grow * 4) : 1;
    c.save(); c.translate(SOIL_X * k, (SOIL_Y + 4) * k); c.scale(1, M.shadowH / M.shadowW);
    const r = M.shadowW * k, g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, `rgba(20,10,5,${M.shadow * grown})`); g.addColorStop(0.5, `rgba(20,10,5,${M.shadow * grown * 0.45})`); g.addColorStop(1, 'rgba(20,10,5,0)');
    c.fillStyle = g; c.fillRect(-r, -r, r * 2, r * 2); c.restore();
  }
  // the ground leaves again, over the pot's rim (not where their feet are buried)
  c.drawImage(pv.frontCut({ hw: M.frontHole * k, edge: M.frontEdge, top: (M.sink + M.fadeUp) * k, bottom: M.frontBelow * k, fade: M.frontFade * k }),
    SOIL_X * k - pv.ox, (SOIL_Y + M.sink) * k - pv.oy);
}
const smooth = v => { v = Math.max(0, Math.min(1, v)); return v * v * (3 - 2 * v); };
function drawLight(now) {
  const g = lightCv.getContext('2d');
  g.clearRect(0, 0, lightCv.width, lightCv.height);
  if (pot.glow) g.drawImage(pot.glow, SOIL_X * k - pot.view.ox, (SOIL_Y + M.sink) * k - pot.view.oy);
  // the soil glows (the first two stars' colours mixed) while they sink in and the plant starts
  const soilA = !growFx() ? 0 : pot.phase === 'soil' ? 0.5 + 0.4 * Math.sin(pot.t * 9) : pot.phase === 'grow' ? Math.max(0, 0.6 - pot.grow * 2) : 0;
  if (soilA > 0) glowDot(g, SOIL_X * k, (SOIL_Y - 10) * k, 260 * k, mixHex(...pot.order.slice(0, 2).map(r => STAR_FAMILIES[r.type].star)), soilA);
  for (const p of pot.burst) glowDot(g, p.x * k, p.y * k, p.size * k * 2.2, p.color, (1 - p.t / p.life) * Math.min(1, FX.sparkle * 2));
  // motes: a tinted round glow with a small white core
  for (const m of pot.motes) {
    const kk = m.t / m.life, a = Math.min(1, kk * 6) * (1 - kk) * (0.75 + 0.25 * Math.sin(now * 5 + m.phase)) * FX.motes.bright;
    const r = m.size * k * (0.5 + 0.7 * Math.sin(Math.PI * Math.min(1, kk * 1.3)));
    moteDot(g, m.x * k, m.y * k, r, m.color, a);
  }
}

// Motes from the soil spot (FX.motes): a puff swirling out around it, then a trail rising after the growing tip.
const rand = ([a, b]) => a + Math.random() * (b - a);
function addMote(puff) {
  const F = FX.motes, cols = pot.order.map(r => STAR_FAMILIES[r.type].star);
  const color = mixHex(cols[Math.floor(Math.random() * cols.length)], '#ffffff', F.pale);
  const angle = Math.random() * Math.PI * 2;
  pot.motes.push({ puff, color, angle, t: 0, x: SOIL_X, y: SOIL_Y, phase: Math.random() * 6.28, size: rand(F.size),
    life: rand(F.life) * (puff ? 0.85 : 1), reach: rand(F.reach), dist: F.puffDist * (0.55 + Math.random() * 0.6),
    side: (Math.random() * 2 - 1), spin: (Math.random() < 0.5 ? -1 : 1) * F.swirl });
}
// The grown plant's particles (PLANTS.ready.sparkles): as in the star reveal (delivery.js), each drifts out on a gentle
// spiral from the plant's edge. A mote that starts with t < 0 waits that long (it draws nothing until then).
function addSparkle(angle = Math.random() * Math.PI * 2, delay = 0) {
  const F = PLANTS.ready.sparkles, b = pot.view.g.bounds, cols = pot.order.map(r => STAR_FAMILIES[r.type].star);
  const top = SOIL_Y + M.sink + b.y0 / k, rx = (b.x1 - b.x0) / k / 2, ry = (SOIL_Y - top) / 2;
  pot.motes.push({ around: true, color: mixHex(cols[Math.floor(Math.random() * cols.length)], '#ffffff', F.pale), angle, t: -delay, x: SOIL_X, y: SOIL_Y,
    cx: SOIL_X + (b.x0 + b.x1) / k / 2, cy: top + ry, rx: rx * 0.45, ry: ry * 0.45, phase: Math.random() * 6.28, size: rand(F.size),
    life: F.sec, dist: rand(F.dist), spin: (Math.random() < 0.5 ? -1 : 1) * F.swirl });
}
function updateMotes(dt) {
  const F = FX.motes, growing = pot.phase === 'grow';
  if (growing && pot.grow > 0.02 && growFx()) {
    if (!pot.motesPuffed) { pot.motesPuffed = true; for (let i = 0; i < F.puff; i++) addMote(true); }
    for (pot.moteT += dt; pot.moteT > F.every; pot.moteT -= F.every) addMote(false);
  }
  if (pot.phase === 'grown') for (pot.moteT += dt; pot.moteT > PLANTS.ready.sparkles.every; pot.moteT -= PLANTS.ready.sparkles.every) addSparkle();   // ready to go out
  const tip = pot.view?.g && k ? SOIL_Y + M.sink + pot.view.g.bounds.y0 / k : SOIL_Y;
  for (const m of pot.motes) {
    m.t += dt;
    const kk = Math.min(1, m.t / m.life), e = 1 - Math.pow(1 - kk, 2.2), a = m.angle + m.spin * e;
    if (m.around) {
      m.x = m.cx + Math.cos(a) * (m.rx + m.dist * Math.max(0, e));
      m.y = m.cy + Math.sin(a) * (m.ry + m.dist * Math.max(0, e));
    } else if (m.puff) {   // drift out on a gentle spiral around the spot, flattened like the soil
      const r = 30 + m.dist * e;
      m.x = SOIL_X + Math.cos(a) * r; m.y = SOIL_Y - 10 + Math.sin(a) * r * 0.45 - 40 * e;
    } else {        // rise after the tip, widening a little and swaying on the swirl
      const up = (SOIL_Y - tip) * m.reach * e;
      m.x = SOIL_X + m.side * F.spread * (0.4 + e) + Math.sin(a * 2) * F.spread * 0.35;
      m.y = SOIL_Y - 10 - up;
    }
  }
  pot.motes = pot.motes.filter(m => m.t < m.life);
}

// ---------------------------------------------------------------- per frame
function updatePlanting(dt, now) {
  // can a recipe grow? (all its stars in the jars or in the circles, the pot empty)
  const potFree = pot.phase === 'idle';
  const have = t => jarCount(t) + slots.filter(s => s.record?.type === t).length + (drag?.record.type === t ? 1 : 0);
  pot.ready = potFree && RECIPES.some(R => Object.keys(R).every(t => have(t) >= R[t]));
  house.plantReady = pot.ready && pot.artReady;
  // From Grow until the camera is back down, the reveal can't be interrupted: no "Leave greenhouse", no Esc (modes.js)
  house.growing = ['stars', 'soil', 'grow', 'bloom', 'hold', 'back'].includes(pot.phase);
  // (first time, house.trapped: also before it has grown; then the way out carries it)
  const held = house.growing || house.trapped && !['grown', 'carry'].includes(pot.phase);
  btnLeave.classList.toggle('held', held); btnLeave.tabIndex = held || !btnLeave.classList.contains('show') ? -1 : 0;
  // A grown plant waiting in the pot: the way out carries it along (modes.js asks with 'carryplant')
  house.plantInPot = pot.phase === 'grown';
  const carrying = house.plantInPot || pot.phase === 'carry', leaveTitle = carrying ? 'Carry the plant outside (Esc)' : 'Back to the rooftop (Esc)';
  if (btnLeave.title !== leaveTitle) { btnLeave.title = leaveTitle; btnLeave.ariaLabel = carrying ? 'Carry the plant outside' : 'Leave the greenhouse'; }
  const anyStar = Object.keys(STAR_FAMILIES).some(t => have(t) > 0);
  const showSlots = potFree && pot.artReady && anyStar;

  const canGrow = choosing() && allFilled() && showSlots && !drag;
  btnGrow.classList.toggle('show', canGrow); btnGrow.tabIndex = canGrow ? 0 : -1;
  const shown = interior.classList.contains('show');
  if (!shown && !flyers.length && pot.phase === 'idle') { pot.idle = 0; return; }

  // Circles: white rings while empty (brighter while a star is dragged near), gone once they hold a star
  const near = drag ? nearestFree(drag.at) : null;
  for (const s of slots) {
    const filled = s.record && !s.incoming, k2 = 1 - Math.exp(-dt * 6);
    s.show += ((showSlots ? 1 : 0) - s.show) * (1 - Math.exp(-dt * 3));
    s.ring += ((s.record ? 0 : 1) - s.ring) * k2;
    s.hot += ((s === near ? 1 : 0) - s.hot) * k2;
    s.pulse = Math.max(0, s.pulse - dt * 1.5);
    const breath = 0.5 + 0.5 * Math.sin(now * 1.1 + s.ph);
    s.el.style.opacity = s.show.toFixed(3);
    s.el.style.transform = `translate(-50%, ${(-50 + Math.sin(now * 0.9 + s.ph * 1.7) * 2.5).toFixed(2)}%)`;   // hovering gently
    s.star.style.pointerEvents = s.show > 0.5 && filled ? 'auto' : 'none';   // only the star itself is grabbed (the circles' glows overlap)
    s.el.style.setProperty('--ring', (s.ring * (0.55 + 0.2 * breath + 0.45 * s.hot)).toFixed(3));
    s.el.style.setProperty('--glow', (s.ring * (0.16 + 0.22 * breath + 0.5 * s.hot) + (filled ? 0.35 : 0) + 0.5 * s.pulse).toFixed(3));
    s.el.style.setProperty('--c', filled ? STAR_FAMILIES[s.record.type].star : '#ffffff');
    s.el.classList.toggle('filled', !!filled);
    if (filled) s.star.style.backgroundImage = starUrl(s.record.type) || '';
    const bob = filled ? Math.sin(now * 1.3 + s.ph) * 1.2 : 0;
    s.star.style.opacity = filled ? 1 : 0;
    s.star.style.transform = `translateY(${bob.toFixed(2)}%) rotate(${(Math.sin(now * 0.6 + s.ph) * 6).toFixed(1)}deg) scale(${(1 + 0.15 * s.pulse).toFixed(3)})`;
  }
  // The dragged star follows the pointer
  if (drag) {
    drag.size += (PLANTS.slotSize * 1.1 - drag.size) * (1 - Math.exp(-dt * 10));
    place(drag.el, drag.at[0], drag.at[1], drag.size);
    drag.el.style.transform = `translate(-50%, -50%) rotate(${(Math.sin(now * 2) * 5).toFixed(1)}deg)`;
  }
  // Caption over the middle circle once the player has done nothing for hintDelay seconds (gone again when a star
  // lands in a circle), and once it has grown the plant's name with ✦ Carry it outside ✦ under it (no hover needed)
  // (the name breathes in first, the button follows once its letters are in)
  const RD = PLANTS.ready, choosingNow = showSlots && !canGrow, offerName = pot.phase === 'grown' && pot.t >= RD.hintAfter;
  const offerCarry = offerName && pot.t >= RD.hintAfter + RD.buttonAfter;
  pot.idle = choosingNow ? (pot.idle || 0) + (drag ? 0 : dt) : 0;
  btnCarry.classList.toggle('show', offerCarry); btnCarry.tabIndex = offerCarry ? 0 : -1;
  const text = offerName ? [PLANTS.species[pot.view.model.species].title]
    : choosingNow && pot.idle >= PLANTS.hintDelay ? ['Drag the stars', 'into the circles above the pot'] : null;
  if (text) setCaption(...text);
  caption.classList.toggle('show', !!text);
  caption.style.left = px(SOIL_X, ROOM_W);
  const nameY = matchMedia('(pointer: coarse)').matches ? RD.captionYTouch : RD.captionY;
  caption.style.top = px(pot.phase === 'grown' ? nameY : PLANTS.slotY - PLANTS.slotSize * 1.3, ROOM_H);

  // Flying stars
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    f.t = Math.min(1, f.t + dt / f.sec);
    const e = ease(f.t), u = 1 - e;
    const x = u * u * f.from[0] + 2 * u * e * f.ctrl[0] + e * e * f.to[0], y = u * u * f.from[1] + 2 * u * e * f.ctrl[1] + e * e * f.to[1];
    place(f.el, x, y, f.size0 + (f.size1 - f.size0) * e);
    f.el.style.opacity = Math.min(1, f.t * 6);
    f.el.style.transform = `translate(-50%, -50%) rotate(${(f.spin * e).toFixed(1)}deg)`;
    if (f.t >= 1) { f.el.remove(); flyers.splice(i, 1); f.done(); }
  }

  // The reveal
  pot.t += dt;
  if (pot.phase === 'stars' && pot.drops.every(d => d.landed)) { pot.phase = 'soil'; pot.t = 0; chord(pot.order, 0.45); }
  else if (pot.phase === 'soil' && pot.t > R.soilSec) { pot.phase = 'grow'; pot.t = 0; }
  else if (pot.phase === 'grow') {
    const [u, H] = pot.view.size(), growDur = Math.max(T.revealSec, (H + u * 2) / T.growSpeed);   // at least revealSec, longer for tall plants
    pot.grow = Math.min(1, pot.grow + dt / growDur);
    pot.view.model.growSec = growDur;   // organic: every piece springs on its own once grown
    pot.dirty = true;
    if (pot.grow >= 1) {
      drawPlant(); pot.dirty = false;
      pot.phase = 'bloom'; pot.t = 0; pot.bounceT = 0;
      const cols = [PLANTS.species[pot.view.model.species].show, ...pot.order.map(r => STAR_FAMILIES[r.type].star), '#ffffff'];
      if (growFx()) for (const h of pot.view.g.heads) if (h.r) burst(SOIL_X + h.cx / k, SOIL_Y + M.sink + h.cy / k, 10, cols, 380, 1.4);
      const n = PLANTS.ready.sparkles.puff;
      for (let i = 0; i < n; i++) addSparkle((i / n) * Math.PI * 2 + Math.random() * 0.5, 0.05 + Math.random() * 0.3);
    }
  } else if (pot.phase === 'bloom' && pot.t > R.bloomSec) { pot.phase = 'hold'; pot.t = 0; }
  else if (pot.phase === 'hold' && pot.t > (PLANTS.camFollow ? T.hold : 0)) { pot.phase = 'back'; pot.t = 0; pot.camFrom = pot.camY; }   // the hold is at the top: none without the pan
  else if (pot.phase === 'back') {   // the camera eases back down
    const p = pot.camFrom > 0.5 ? Math.min(1, pot.t / T.returnSec) : 1;   // nothing to ease back from: straight on
    pot.camY = pot.camFrom * (1 - smooth(p));
    if (p >= 1) {
      pot.phase = 'grown'; pot.camY = 0; pot.t = 0;
      // the whole plant answers the tap, not only the pot
      const [hx, hy, hw, hh] = POT_HIT, b = pot.view.g.bounds;
      const x0 = Math.min(hx, SOIL_X + b.x0 / k), x1 = Math.max(hx + hw, SOIL_X + b.x1 / k), y0 = Math.min(hy, SOIL_Y + M.sink + b.y0 / k);
      place(potHit, x0, y0, x1 - x0, hy + hh - y0);
      window.dispatchEvent(new CustomEvent('plantgrown', { detail: pot.plant }));   // starBook.js: a new flower goes into the book first
    }
  } else if (pot.phase === 'grown') {   // ready to go out: breathing a little brighter, more under the pointer
    if (house.bookHold) pot.t = 0;   // (the star book is open for the new flower: its name and Carry it outside wait)
    const RD = PLANTS.ready, breath = 0.5 - 0.5 * Math.cos(pot.t * RD.speed);
    pot.shine = (pot.shine || 0) + ((pot.hover ? RD.hover : 0) - (pot.shine || 0)) * (1 - Math.exp(-dt * 8));
    plantArt.style.filter = `brightness(${(1 + RD.breath * breath * Math.min(1, pot.t / 2) + pot.shine).toFixed(3)})`;
    potHit.style.cursor = 'pointer';
  } else if (pot.phase === 'carry') {   // lifted off the table together with its pot, fading in a shimmer
    const e = smooth(pot.t / CARRY_SEC), lift = `0 ${(-0.06 * e * plantArt.clientHeight).toFixed(1)}px`;
    // CSS translate, not transform: that holds the art's centring and the layers' parallax
    for (const el of [plantArt, lightArt, potLayer]) { el.style.translate = lift; el.style.opacity = (1 - e).toFixed(3); }
    if (pot.t >= CARRY_SEC) carried();
  }
  if (pot.phase !== 'grown') potHit.style.cursor = '';
  if (PLANTS.camFollow && (pot.phase === 'grow' || pot.phase === 'bloom') && pot.view?.g && k) {   // follow the growing tip upwards
    const top = SOIL_Y + pot.view.g.bounds.y0 / k, target = Math.max(0, T.follow * ROOM_H - top);
    if (target > pot.camY) pot.camY += (target - pot.camY) * (1 - Math.exp(-dt * 4));
  }
  if (pot.bounceT != null && pot.view) {   // after growing, the leaves and flowers settle on their own springs (organic)
    pot.bounceT += dt; const done = pot.bounceT >= PLANTS.organic.flower.sec;
    pot.view.model.bounceT = done ? null : pot.bounceT;
    if (done) { pot.view.model.growSec = null; pot.bounceT = null; }
    pot.dirty = true;
  }
  roomPan.y = pot.camY;
  updateRevealCamera(dt);
  for (const p of pot.burst) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.vx *= 0.98; }
  pot.burst = pot.burst.filter(p => p.t < p.life);
  updateMotes(dt);

  if (!fitCanvases()) return;
  if (pot.dirty) { drawPlant(); pot.dirty = false; }
  drawLight(now);
}

// ---------------------------------------------------------------- the reveal's camera (PLANTS.camera)
// Four beats, drawn by greenhouse.js from `reveal`. Lean in: from Grow the view pushes in towards the pot (the near
// layers zooming most). Hush: meanwhile the lamp dims, the room stops swaying and the edges darken, so the soil is
// the brightest thing. Bloom: while it grows the camera drifts in a slow small orbit round the pot; as the flowers
// open the light answers (the lamp swells, a glow spreads from the plant, the moon and stars brighten, one breath
// through the foreground leaves). Breathe out: from there everything eases back to rest as the name breathes in.
const CAM = PLANTS.camera;
const swellGlow = document.createElement('div');
swellGlow.className = 'interior-light';
lightArt.appendChild(swellGlow);
const springs = { push: { x: 0, v: 0 }, arc: { x: 0, v: 0 }, hush: { x: 0, v: 0 } };
// critically damped: eases out of rest and into the target without overshooting; there in about 2.5 × sec
function spring(s, target, sec, dt) {
  const w = 2 / Math.max(0.01, sec), x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const d = s.x - target, tmp = (s.v + w * d) * dt;
  s.v = (s.v - w * tmp) * e; s.x = target + (d + tmp) * e;
  return s.x;
}
function updateRevealCamera(dt) {
  const ph = pot.phase, S = CAM.swell, G = CAM.gust;
  // the flowers open (bloomAt of the growth): the light answers and the breathing out begins
  if (pot.bloomT == null && (ph === 'grow' ? pot.grow >= CAM.bloomAt : ['bloom', 'hold', 'back', 'grown'].includes(ph))) pot.bloomT = 0;
  else if (pot.bloomT != null) pot.bloomT += dt;
  const lean = CAM.on && ['stars', 'soil', 'grow'].includes(ph) && pot.bloomT == null;
  reveal.push = spring(springs.push, lean ? 1 : 0, lean ? CAM.pushSec : CAM.outSec, dt);
  reveal.arc = spring(springs.arc, lean && ph === 'grow' ? pot.arcDir : 0, lean ? CAM.arcSec : CAM.outSec, dt);
  reveal.hush = spring(springs.hush, lean ? 1 : 0, lean ? CAM.hush.sec : CAM.hush.outSec, dt);
  const t = CAM.on ? pot.bloomT : null;
  reveal.swell = t == null ? 0 : t < S.rise ? smooth(t / S.rise) : 1 - smooth((t - S.rise) / S.fall);
  reveal.gust = t == null ? 0 : G.amount * Math.sin(t * G.freq * Math.PI * 2) * Math.exp(-t * G.damp) * (1 - Math.exp(-t * 6));
  // the glow spreading from the plant
  swellGlow.style.opacity = (reveal.swell * S.glow).toFixed(3);
  if (reveal.swell > 0.002 && pot.view?.g && k) {
    const b = pot.view.g.bounds, cx = SOIL_X + (b.x0 + b.x1) / 2 / k, cy = SOIL_Y + M.sink + (b.y0 + b.y1) / 2 / k;
    const col = mixHex(PLANTS.species[pot.view.model.species].show, '#fff2d8', 0.5), [r, g, bl] = [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16));
    place(swellGlow, cx, cy, S.glowSize);
    swellGlow.style.background = `radial-gradient(circle closest-side, rgba(${r},${g},${bl},0.55), rgba(${r},${g},${bl},0.18) 45%, rgba(${r},${g},${bl},0))`;
    swellGlow.style.transform = `translate(-50%, -50%) scale(${(0.55 + 0.6 * smooth(t / (S.rise + S.fall))).toFixed(3)})`;
  }
}

loadPlantArt().then(() => { pot.artReady = true; }).catch(err => console.warn('Plant art not loaded: planting is off', err));

export { updatePlanting, plantRecords };
