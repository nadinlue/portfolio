// Star storage (A4): the four jars on the greenhouse table, one per element, left to right Water (blue),
// Air (yellow), Fire (red), Earth (green), the same order as the nets. Tap a jar while the satchel holds stars: they rise from the
// bottom of the view one after another, jar by jar from left to right, and drop into their jars with a
// note each. While the satchel holds stars the jars shimmer faintly; they glow brighter as they fill.
// Hover brightens a jar a little (like the telescope) and shows its count; tapping a jar again makes its
// stars swirl and sing.
// Drawn in the DOM interior (greenhouse.js): the stored stars on a sheet just behind the glasses layer
// (seen through the glass), the glows on a sheet in front of it, flying stars and tap areas on top.
// Values in GREENHOUSE (config.js).
// Planting (planting.js) takes stars out of the jars and puts them back (takeFromJar, returnToJar), starts
// drags from a press on a jar (onJarDown) and swallows the click that ends a drag (onJarTap).
import { ROOM_H, ROOM_W, GREENHOUSE, STAR_FAMILIES } from './config.js';
import { interior, roomSheet } from './greenhouse.js';
import { familyTexture } from './netStars.js';
import { starRecords } from './starRecords.js';
import { allStored, brushRingCanvas, hintRingVersion, noteOf, satchelCount, takeSatchel } from './collect.js';
import { COLLECT } from './config.js';
import { chime } from './chime.js';
import { game } from './modes.js';

const G = GREENHOUSE, ORDER = Object.keys(G.jars);   // left to right
const px = (v, of) => `${(v / of * 100).toFixed(3)}%`;
const ease = t => t * t * (3 - 2 * t);
const store = { busy: false, hover: null, labelT: 0, idle: 0, ring: 0, ringV: -1 };   // idle: s without a tap while the satchel holds stars
const flyers = [];         // { el, from, ctrl, to, jar, record, t, delay, done }
let jarTapHook = null;     // planting.js: claims a tap on a jar (returns true) before it swirls
let jarDownHook = null;    // planting.js: a press on a jar (may become a drag)

// Sheets: stars behind the glass, glows over it, flyers + tap areas + label above everything.
const back = roomSheet('greenhouse_glasses', { behind: true });
const glowArt = roomSheet('greenhouse_glasses', { className: 'interior-lights' });
const top = roomSheet('greenhouse_glasses', { top: true, className: 'interior-top' });
// Hover highlight: the glasses art again, clipped to one jar and added on top of it (brightens that jar only).
const shine = roomSheet('greenhouse_glasses', { className: 'interior-lights' });
const glassesUrl = `url("${G.interiorDir}greenhouse_glasses.webp")`;
const label = document.createElement('div');
label.className = 'jar-label';
top.appendChild(label);
// Hint ring on the left jar (as on the roof, collect.js): after a while without a tap while the satchel holds stars.
const ring = document.createElement('div');
ring.className = 'jar-ring';
top.appendChild(ring);
interior.addEventListener('pointerdown', () => { store.idle = 0; });

function place(el, x, y, w, h = w) {
  Object.assign(el.style, { left: px(x, ROOM_W), top: px(y, ROOM_H), width: px(w, ROOM_W), height: px(h, ROOM_H) });
}

const jars = {};           // family → { body, box, stars: [el], glow, hit, count, pulse, swirl }
for (const fam of ORDER) {
  const [cx, cy, w, h] = G.jars[fam], color = STAR_FAMILIES[fam].star;
  // Stored stars: a box over the inside of the glass; star positions inside it in % of the box.
  const box = document.createElement('div');
  box.className = 'jar-stars';
  place(box, cx - w / 2, cy - h / 2, w, h);
  back.appendChild(box);
  const S = G.jarStarSize, stars = Array.from({ length: G.jarStars }, (_, i) => {
    const el = document.createElement('div');
    el.className = 'jar-star';
    el.dataset.phase = Math.random() * 6.28; el.dataset.rot = -12 + (Math.random() - 0.5) * 24;
    Object.assign(el.style, { width: px(S, w), height: px(S, h), display: 'none', zIndex: G.jarStars - i });
    box.appendChild(el);
    return { el, x: 0, y: 0, s: 1, set: false };
  });
  const glow = document.createElement('div');
  glow.className = 'jar-glow';
  place(glow, cx, cy, w * 2.2, w * 2.2);
  glow.style.background = `radial-gradient(circle closest-side, ${color}ee 0%, ${color}66 35%, ${color}00 100%)`;
  glow.style.opacity = 0;
  glowArt.appendChild(glow);
  // Tap area: the glass and its cork.
  const hit = document.createElement('div');
  hit.className = 'jar-hit';
  place(hit, cx - w / 2 - 20, cy - h / 2 - h * 0.55, w + 40, h * 1.55 + 30);
  hit.title = STAR_FAMILIES[fam].name;
  hit.addEventListener('click', () => { if (jarTapHook?.(fam)) return; jars[fam].flash = 1; tapJar(fam); });
  hit.addEventListener('pointerdown', e => jarDownHook?.(fam, e));
  hit.addEventListener('pointerenter', () => { store.hover = fam; });
  hit.addEventListener('pointerleave', () => { if (store.hover === fam) store.hover = null; });
  top.appendChild(hit);
  const lit = document.createElement('div');
  lit.className = 'jar-shine';
  lit.style.backgroundImage = glassesUrl;
  lit.style.backgroundSize = `${(ROOM_W + 2 * G.bleed[0]) / ROOM_W * 100}% ${(ROOM_H + 2 * G.bleed[1]) / ROOM_H * 100}%`;   // the bleed lies outside the art box
  const [l, t, r, b] = [cx - w / 2 - 20, cy - h / 2 - h * 0.55, cx + w / 2 + 20, cy + h / 2 + 30];
  lit.style.clipPath = `inset(${px(t, ROOM_H)} ${px(ROOM_W - r, ROOM_W)} ${px(ROOM_H - b, ROOM_H)} ${px(l, ROOM_W)})`;
  lit.style.opacity = 0;
  shine.appendChild(lit);
  jars[fam] = { body: [cx, cy, w, h], box, stars, glow, hit, lit, count: 0, pulse: 0, swirl: 0, hov: 0, flash: 0 };
}

// Where star i of n floats in a jar (as in the concept, Greenhouse_mockup): one star alone fills the
// middle of the glass; more stars share it as a small cluster around the middle, each a bit smaller.
// Returns x, y from the glass centre (4K px) and a scale of jarStarSize.
function slot(i, n, w) {
  if (n <= 1) return { x: 0, y: 0, s: 1 };
  const s = n === 2 ? 0.78 : n === 3 ? 0.68 : 0.58;
  const r = w * (n === 2 ? 0.15 : n === 3 ? 0.17 : 0.2);
  const ring = n <= 3 ? n : n - 1;                        // from 4 on: one in the middle, the rest around it
  if (n > 3 && i === 0) return { x: 0, y: 0, s: s * 1.1 };
  const k = n > 3 ? i - 1 : i, a = -Math.PI / 2 + (k / ring) * Math.PI * 2 + (n === 2 ? Math.PI / 2 : 0);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.85, s };
}

// The star art as image URLs (from the same textures as the nets), once they're loaded. Cropped to the
// star itself (the four images have different empty margins), so every element looks the same size.
const urls = {};
function starUrl(fam) {
  if (urls[fam]) return urls[fam];
  const img = familyTexture(fam)?.image;
  if (!img) return null;
  const probe = document.createElement('canvas'), P = 128; probe.width = probe.height = P;
  const pg = probe.getContext('2d'); pg.drawImage(img, 0, 0, P, P);
  const a = pg.getImageData(0, 0, P, P).data;
  let x0 = P, y0 = P, x1 = 0, y1 = 0;
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    if (a[(y * P + x) * 4 + 3] > 60) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  const k = img.width / P, side = Math.max(x1 - x0, y1 - y0) + 1, cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const c = document.createElement('canvas'); c.width = c.height = 160;
  c.getContext('2d').drawImage(img, (cx - side / 2) * k, (cy - side / 2) * k, side * k, side * k, 0, 0, 160, 160);
  urls[fam] = `url("${c.toDataURL()}")`;
  for (const { el } of jars[fam].stars) el.style.backgroundImage = urls[fam];
  return urls[fam];
}

// ---------------------------------------------------------------------------
// Tapping a jar
// ---------------------------------------------------------------------------
function tapJar(fam) {
  if (game.mode !== 'greenhouse' || store.busy) return;
  if (satchelCount()) { emptySatchel(); return; }
  admire(fam);
}

// Every star in the satchel flies to its jar: blue ones first, then yellow, green, red.
async function emptySatchel() {
  store.busy = true;
  const records = takeSatchel().filter(r => jars[r.type])
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const flights = records.map((record, i) => new Promise(done => {
    const jar = jars[record.type], [cx, cy, w, h] = jar.body;
    const n = Math.min(jar.count + flyers.filter(f => f.jar === jar).length, jar.stars.length - 1);
    const end = slot(n, n + 1, w), to = [cx + end.x, cy + end.y];
    const from = [G.flyFrom[0] + (Math.random() - 0.5) * 400, G.flyFrom[1]];
    // Up and over the rim, then down into the glass.
    const ctrl = [cx + (from[0] - cx) * 0.25, cy - h / 2 - h * 1.6];
    const el = document.createElement('div');
    el.className = 'jar-fly';
    el.style.backgroundImage = starUrl(record.type);
    el.style.opacity = 0;
    top.appendChild(el);
    flyers.push({ el, from, ctrl, to, endSize: G.jarStarSize * end.s, jar, record, t: 0, delay: i * G.flyGap, spin: (Math.random() < 0.5 ? -1 : 1) * 200, done });
  }));
  await Promise.all(flights);
  store.busy = false;
  allStored();
}

function land(f) {
  const { jar, record } = f, fam = STAR_FAMILIES[record.type];
  record.location = 'storage';
  jar.count++; jar.pulse = 1;
  chime(Math.min(9, 1 + jar.count), 0.55, 0, 1.1, fam);
  showLabel(record.type, 1.6);
}

// A jar without new stars: its stars swirl and sing. Sound only once there are stars inside.
function admire(fam) {
  const jar = jars[fam];
  if (!jar.count) { jar.pulse = 0.4; return; }        // an empty jar stays silent: it only lights up a little
  if (jar.swirl > 0) return;
  jar.swirl = 1; jar.pulse = 1;
  starRecords.filter(r => r.location === 'storage' && r.type === fam).slice(-8)
    .forEach((r, i) => chime(noteOf(r), 0.4, i * 0.22, 1.2, STAR_FAMILIES[fam]));
  showLabel(fam, 2.8);
}

// ---------------------------------------------------------------------------
// For planting (planting.js)
// ---------------------------------------------------------------------------
const onJarTap = fn => { jarTapHook = fn; };
const onJarDown = fn => { jarDownHook = fn; };
const jarCount = fam => jars[fam]?.count ?? 0;
const jarBusy = () => store.busy;
// The newest stored star of an element leaves its jar (null if empty); its record is now `location`.
function takeFromJar(fam, location) {
  const record = starRecords.filter(r => r.location === 'storage' && r.type === fam).pop();
  if (!record) return null;
  record.location = location;
  jars[fam].count--; jars[fam].pulse = 0.6;
  return record;
}
function returnToJar(record) {
  const jar = jars[record.type];
  record.location = 'storage';
  jar.count++; jar.pulse = 1;
  chime(Math.min(9, 1 + jar.count), 0.45, 0, 1, STAR_FAMILIES[record.type]);
}
// Where a star sits in its jar (4K px), for flights in and out.
const jarPoint = fam => jars[fam].body.slice(0, 2);

function showLabel(fam, sec) {
  const [cx, cy, , h] = jars[fam].body;
  label.textContent = `${STAR_FAMILIES[fam].name} · ${jars[fam].count}`;
  label.style.setProperty('--name-color', STAR_FAMILIES[fam].star);
  label.style.left = px(cx, ROOM_W);
  label.style.top = px(cy - h / 2 - h * 0.6, ROOM_H);
  store.labelT = Math.max(store.labelT, sec);
}

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------
function updateJars(dt, now) {
  if (!interior.classList.contains('show') && !flyers.length) return;
  const waiting = satchelCount() > 0 && !store.busy;

  // Flying stars.
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    f.t = Math.min(1, f.t + dt / G.flySec);
    const k = ease(f.t), u = 1 - k;
    const x = u * u * f.from[0] + 2 * u * k * f.ctrl[0] + k * k * f.to[0];
    const y = u * u * f.from[1] + 2 * u * k * f.ctrl[1] + k * k * f.to[1];
    const size = G.flySize + (f.endSize - G.flySize) * k;
    place(f.el, x, y, size);
    f.el.style.opacity = Math.min(1, f.t * 6);
    f.el.style.transform = `translate(-50%, -50%) rotate(${(f.spin * k).toFixed(1)}deg)`;
    if (f.t >= 1) {
      f.el.remove();
      flyers.splice(i, 1);
      land(f);
      f.done();
    }
  }

  // Jars: glow by fill (and a faint shimmer while the satchel holds stars), stars bob or swirl.
  for (const [fam, j] of Object.entries(jars)) {
    starUrl(fam);
    j.pulse = Math.max(0, j.pulse - dt * 1.5);
    j.swirl = Math.max(0, j.swirl - dt / 2.6);
    const fill = Math.min(1, j.count / G.jarFull), phase = ORDER.indexOf(fam) * 0.9;
    const wave = 0.5 + 0.5 * Math.sin(now * 2.2 - phase), shimmer = waiting ? 0.3 * wave : 0;
    j.call = (j.call || 0) + ((waiting ? 1 : 0) - (j.call || 0)) * (1 - Math.exp(-dt * 3));   // the glass lights up: tap me
    const glow = (j.count ? (0.45 + 0.55 * fill) * (0.9 + 0.1 * Math.sin(now * 1.7 + phase)) : 0) + shimmer + 0.6 * j.pulse;
    j.glow.style.opacity = Math.min(1, glow).toFixed(3);
    j.glow.style.transform = `translate(-50%, -50%) scale(${(1 + 0.2 * j.pulse).toFixed(3)})`;
    // Hover / tap highlight (eased in and out).
    j.hov += ((store.hover === fam ? 1 : 0) - j.hov) * (1 - Math.exp(-dt * 14));
    j.flash = Math.max(0, j.flash - dt * 2.5);
    const call = j.call * G.jarCall * (1 - G.jarCallBreath + G.jarCallBreath * wave);
    j.lit.style.opacity = Math.min(1, Math.max(call, j.hov * G.jarHover) + j.flash * G.jarFlash).toFixed(3);
    const [, , w, h] = j.body, sw = j.swirl > 0 ? ease(Math.min(1, j.swirl * 1.4)) : 0;
    const n = Math.min(j.count, j.stars.length), glide = 1 - Math.exp(-dt * 5);
    j.stars.forEach((st, i) => {
      const { el } = st;
      el.style.display = i < n ? '' : 'none';
      if (i >= n) { st.set = false; return; }
      // Ease towards its place in the cluster (the others make room when a new star arrives).
      const to = slot(i, n, w);
      if (!st.set) Object.assign(st, to, { set: true });
      else { st.x += (to.x - st.x) * glide; st.y += (to.y - st.y) * glide; st.s += (to.s - st.s) * glide; }
      const ph = +el.dataset.phase, a = now * 3 + ph, r = w * 0.22;
      // Floating: a slow bob and sway (or a swirl after a tap).
      const x = st.x * (1 - sw) + Math.cos(a) * r * sw + Math.sin(now * 0.9 + ph) * w * 0.012;
      const y = st.y * (1 - sw) + Math.sin(a) * r * 0.6 * sw + Math.sin(now * 1.3 + ph) * h * 0.025;
      el.style.left = px(x + w / 2, w); el.style.top = px(y + h / 2, h);
      const rot = +el.dataset.rot + Math.sin(now * 0.7 + ph) * 4 + sw * now * 120;
      el.style.transform = `translate(-50%, -50%) rotate(${rot.toFixed(1)}deg) scale(${st.s.toFixed(3)})`;
    });
  }

  // Hint ring on the left jar after COLLECT.hintAfter s without a tap.
  store.idle = waiting && game.mode === 'greenhouse' ? store.idle + dt : 0;
  store.ring += ((store.idle > COLLECT.hintAfter ? 1 : 0) - store.ring) * Math.min(1, dt * 2.5);
  if (store.ring > 0.01) {
    const [cx, cy] = jars[ORDER[0]].body, R = G.jarRing;
    place(ring, cx, cy + R.dy, R.size);
    if (store.ringV !== hintRingVersion()) {   // (a look change in Settings → Hint ring repaints it)
      ring.style.setProperty('--img', `url(${brushRingCanvas().toDataURL()})`);
      store.ringV = hintRingVersion();
    }
    ring.style.transform = `translate(-50%, -50%) scale(${(1 + 0.03 * Math.sin(now * 1.6)).toFixed(3)})`;
    ring.style.setProperty('--spin', `${(now * COLLECT.hintRing.spin % 360).toFixed(1)}deg`);   // the hue drifts slowly round
  }
  ring.style.opacity = (store.ring * COLLECT.hintRing.bright * (0.8 + 0.2 * Math.sin(now * 1.6))).toFixed(3);

  // Label: while hovering a jar with stars, and for a moment after a landing or a tap.
  store.labelT -= dt;
  if (store.hover && jars[store.hover].count) showLabel(store.hover, 0.2);
  label.classList.toggle('show', store.labelT > 0);
}

export { updateJars, starUrl, onJarTap, onJarDown, jarCount, jarBusy, takeFromJar, returnToJar, jarPoint };
