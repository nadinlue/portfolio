// Greenhouse (start of B1): tap detection + hover highlight, and the enter / leave sequences:
// walk to the door → step in and fade out → camera zooms towards the door → interior picture fades in.
import * as THREE from 'three';
import { ART_H, ART_W, FIRST_TIME, GREENHOUSE, PLANTS, ROOM_H, ROOM_W, settings } from './config.js';
import { $, easeInOut, sleep } from './util.js';
import { camera } from './core.js';
import { layers } from './layers.js';
import { glowGroups } from './effects.js';
import { view } from './rig.js';
import { tilt } from './tilt.js';
import { walker, walkDirect, walkTo } from './walk.js';

// plantReady: planting.js (a recipe is in the jars). calling / trapped: firstTime.js (the first plant should grow:
// the greenhouse breathes stronger / the way out stays closed until it has grown).
const house = { hover: false, flash: 0, mask: null, beckon: 0, beckonTarget: 0, plantReady: false, calling: false, trapped: false };
const MASK_SCALE = 4;
const interior = $('interior'), btnLeave = $('btnLeaveGreenhouse');
interior.style.transitionDuration = `${GREENHOUSE.fadeSec}s`;

// The pictures' painted frame covers the stage like `cover` would; their bleed reaches past it on every side.
// A layer's box is the whole picture (a background is only painted inside its box, so a stage-sized box would
// cut the bleed off and the parallax would uncover its edges).
const [BX, BY] = GREENHOUSE.bleed, FW = (ROOM_W + 2 * BX) / ROOM_W, FH = (ROOM_H + 2 * BY) / ROOM_H;
const bleedW = `max(${100 * FW}cqw, ${100 * FW * ROOM_W / ROOM_H}cqh)`, bleedH = `max(${100 * FH * ROOM_H / ROOM_W}cqw, ${100 * FH}cqh)`;
const bleedBox = { inset: 'auto', width: bleedW, height: bleedH, left: `calc(50% - ${bleedW} / 2)`, top: `calc(50% - ${bleedH} / 2)`,
  backgroundSize: '100% 100%' };
const topFade = `linear-gradient(transparent, #000 ${GREENHOUSE.topFade / (ROOM_H + 2 * BY) * 100}%)`;

// Interior layers, stacked back to front, with a gentle parallax: they shift by depth with the pointer and
// a slow sway, and settle from slightly zoomed-in when you enter.
const skyGlowLayers = new Set(['greenhouse_sky', 'greenhouse_sky_moon']);   // brightened by the plant reveal's swell
const roomLayers = GREENHOUSE.interior.map(({ image, depth, pan = 1, topFade: fade = true }, i) => {
  const el = document.createElement('div'), url = `${GREENHOUSE.interiorDir}${image}.webp`;
  el.className = 'interior-layer';
  el.style.backgroundImage = `url("${url}")`;
  Object.assign(el.style, bleedBox);
  if (i > 0 && fade) {   // the top edge fades out within the bleed: no hard cut when the camera pans up past it (the sky has the sky gradient)
    el.style.maskImage = topFade; el.style.maskSize = '100% 100%'; el.style.maskRepeat = 'no-repeat';
  }
  new Image().src = url;   // preload, so the fade-in never waits for the download
  interior.appendChild(el);
  return { el, depth, pan, sheets: [], skyGlow: skyGlowLayers.has(image) };
});
// The hush's dark edges: over the painted layers, under the plant (its sheets go on top)
const hushVignette = document.createElement('div');
hushVignette.className = 'interior-layer';
Object.assign(hushVignette.style, { pointerEvents: 'none', opacity: 0, willChange: 'opacity' });
interior.appendChild(hushVignette);
const look = { x: 0, y: 0, tx: 0, ty: 0, enterT0: -1 };
// Camera pan up (planting.js, while a tall plant grows): art px; each layer moves down by y × its `pan`
// (sky slowest, the table and pot fully), as in the Plant Lab.
const roomPan = { y: 0 };
// The plant reveal's camera and room (planting.js sets these each frame, already eased; tuning: PLANTS.camera):
// push = dolly in towards the focus (0 … 1; each layer zooms by its depth, the pot's layer by `push`), arc = the small
// orbit round the pot (−1 … 1; layers in front of the pot slide one way, those behind it the other), hush = the room
// holding its breath (lamp down, no sway, dark edges), swell = the light answering the bloom (lamp, moon and stars),
// gust = the foreground leaves' one breath (share of the view width).
const reveal = { push: 0, arc: 0, hush: 0, swell: 0, gust: 0 };
const CAM = PLANTS.camera, POT_DEPTH = GREENHOUSE.interior.find(l => l.image === 'greenhouse_plantpot').depth;

// A full-size sheet that moves with one of the layers, right in front of it (or right behind it), for
// things drawn on that layer: lights, the stars in the jars (jars.js).
// `top` puts it above every layer instead. Returns a box inside it with the art's size and position.
// `pan` gives the sheet its own share of the camera pan (default: its layer's).
function roomSheet(name, { behind = false, top = false, className = '', pan = null } = {}) {
  const layer = roomLayers[GREENHOUSE.interior.findIndex(l => l.image === name)];
  const sheet = document.createElement('div'), art = document.createElement('div');
  sheet.className = `interior-layer ${className}`;
  art.className = 'interior-art';
  sheet.appendChild(art);
  if (top) interior.appendChild(sheet); else if (behind) layer.el.before(sheet); else layer.el.after(sheet);
  layer.sheets.push({ el: sheet, pan: pan ?? layer.pan });
  return art;
}

// A painted layer's own element (its transform is the parallax: change opacity / translate only).
const roomLayer = name => roomLayers[GREENHOUSE.interior.findIndex(l => l.image === name)].el;

// Lamp light: a glow over the lamp layer and a light pool over the table layer, each on its own sheet,
// blended additively with what's behind.
const LL = GREENHOUSE.lampLight;
const lightSheet = name => roomSheet(name, { className: 'interior-lights' });
function lightSpot([x, y], [w, h], parent) {
  const el = document.createElement('div');
  el.className = 'interior-light';
  Object.assign(el.style, { left: `${x / ROOM_W * 100}%`, top: `${y / ROOM_H * 100}%`, width: `${w / ROOM_W * 100}%`, height: `${h / ROOM_H * 100}%` });
  parent.appendChild(el);
  return el;
}
// The lamp's cord, up into the roof, behind the lamp (its cap covers the cord's end).
{
  const C = GREENHOUSE.lampCord, el = document.createElement('div');
  Object.assign(el.style, { position: 'absolute', left: `${(C.x - C.width / 2) / ROOM_W * 100}%`, top: `${C.to / ROOM_H * 100}%`,
    width: `${C.width / ROOM_W * 100}%`, height: `${(C.from - C.to) / ROOM_H * 100}%`, background: C.color });
  roomSheet('greenhouse_lamp', { behind: true }).appendChild(el);
}
const lampGlow = lightSpot(LL.bulb, [LL.glowSize, LL.glowSize], lightSheet('greenhouse_lamp'));
const tablePool = lightSpot(LL.pool, LL.poolSize, lightSheet('greenhouse_table'));

// Same color, intensity, size and flicker as the rooftop lanterns (glowGroups.midground).
function updateLampLight(now) {
  const u = glowGroups.midground.uniforms, c = u.uColor.value;
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const f = u.uFlickerSpeed.value * 0.8;
  const wave = 0.6 * Math.sin(now * f * 3.1) + 0.3 * Math.sin(now * f * 7.3 + 1.7) + 0.1 * Math.sin(now * f * 17 + 0.4);
  const bright = Math.max(0, 1 + 0.3 * u.uFlicker.value * wave) * u.uGain.value;
  const lit = (1 - reveal.hush * CAM.hush.lamp) * (1 + reveal.swell * CAM.swell.lamp);   // the plant reveal dims it, then the bloom swells it
  const grow = u.uSizeMul.value / 0.8 * (1 + u.uPulse.value * wave) * (1 + 0.15 * reveal.swell * CAM.swell.lamp);
  const gs = LL.glowStrength * lit, ps = LL.poolStrength * lit;
  lampGlow.style.background = `radial-gradient(circle closest-side, rgba(${rgb},${0.75 * gs}) 0%, rgba(${rgb},${0.3 * gs}) 30%, rgba(${rgb},0) 100%)`;
  lampGlow.style.opacity = Math.min(1, bright);
  lampGlow.style.transform = `translate(-50%, -50%) scale(${grow.toFixed(3)})`;
  tablePool.style.background = `radial-gradient(ellipse closest-side, rgba(${rgb},${ps}) 0%, rgba(${rgb},${0.4 * ps}) 50%, rgba(${rgb},0) 100%)`;
  tablePool.style.opacity = Math.min(1, bright);
}
interior.addEventListener('pointermove', e => {
  const r = interior.getBoundingClientRect();
  look.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
  look.ty = ((e.clientY - r.top) / r.height) * 2 - 1;
});
interior.addEventListener('pointerleave', () => { look.tx = look.ty = 0; });

function updateRoom(dt, now) {
  if (!interior.classList.contains('show') && getComputedStyle(interior).opacity === '0') return;
  updateLampLight(now);
  const P = GREENHOUSE.parallax, k = 1 - Math.exp(-dt / P.smooth);
  look.x += (Math.max(-1, Math.min(1, look.tx + tilt.x)) - look.x) * k;
  look.y += (Math.max(-1, Math.min(1, look.ty - tilt.y)) - look.y) * k;
  const sway = P.sway * settings.shake * (1 - reveal.hush), w = interior.clientWidth, h = interior.clientHeight;
  const sx = Math.sin(now * 0.29) * 0.6 + Math.sin(now * 0.83 + 1.3) * 0.4, sy = Math.sin(now * 0.23 + 2.1) * 0.6 + Math.sin(now * 0.71) * 0.4;
  const enter = look.enterT0 < 0 ? 1 : easeInOut(Math.min(1, (now - look.enterT0) / P.enterSec));
  // The bleed absorbs the largest possible shift; only if it falls short are the layers scaled up, so moving
  // never shows an edge (at rest the painted frame is shown exactly).
  const cover = Math.max(w / ROOM_W, h / ROOM_H);   // css px per art px (the layers are `cover`)
  const orbit = Math.abs(reveal.arc) * CAM.arc * (1 - POT_DEPTH) + Math.abs(reveal.gust);   // the reveal's sideways moves
  const need = Math.max(P.pointer + sway + orbit - BX * cover / w, P.pointer * 0.6 + sway - BY * cover / w);   // shift past the bleed, x or y
  const overscan = Math.max(1, 1 + 2 * need + 0.004);
  // the reveal's push-in: towards the focus (css px from the middle), each layer zooming by its depth
  const fx = (CAM.focus[0] - ROOM_W / 2) * cover, fy = (CAM.focus[1] - ROOM_H / 2) * cover;
  const shift = (x, y, s, pan, z) => `translate3d(${(x + (1 - z) * fx).toFixed(1)}px, ${(y + (1 - z) * fy + roomPan.y * pan * cover * s).toFixed(1)}px, 0) scale(${(s * z).toFixed(4)})`;
  for (const { el, depth, pan, sheets, skyGlow } of roomLayers) {
    // Looking right moves the near layers left (they pass in front), far layers barely move.
    // (the reveal's orbit: the pot stays, the layers in front of it slide one way and those behind it the other; the
    // gust only stirs the nearest leaves)
    const x = ((-look.x * P.pointer + sx * sway) * depth + reveal.arc * CAM.arc * (depth - POT_DEPTH) + reveal.gust * depth ** 4) * w;
    const y = (-look.y * P.pointer * 0.6 + sy * sway) * depth * w;
    const s = overscan * (1 + P.enterZoom * depth * (1 - enter)), z = 1 + reveal.push * CAM.push * depth / POT_DEPTH;
    el.style.transform = shift(x, y, s, pan, z);
    for (const sh of sheets) sh.el.style.transform = shift(x, y, s, sh.pan, z);
    if (skyGlow) el.style.filter = reveal.swell > 0.002 ? `brightness(${(1 + reveal.swell * CAM.swell.sky).toFixed(3)})` : '';
  }
  // the hush's dark edges, round the focus
  hushVignette.style.opacity = (reveal.hush * CAM.hush.vignette).toFixed(3);
  if (reveal.hush > 0.002) {
    const at = `${(50 + fx / w * 100).toFixed(1)}% ${(50 + fy / h * 100).toFixed(1)}%`;
    hushVignette.style.background = `radial-gradient(ellipse ${CAM.hush.size[0]}% ${CAM.hush.size[1]}% at ${at}, rgba(3,5,16,0) 30%, rgba(3,5,16,0.9) 100%)`;
  }
}

// Alpha mask of the greenhouse art for tap hit tests (called by the scene build).
function buildGreenhouse(img) {
  const W = Math.ceil(img.width / MASK_SCALE), H = Math.ceil(img.height / MASK_SCALE);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  house.mask = { W, H, a: g.getImageData(0, 0, W, H).data };
}

function hitGreenhouse(p) {
  if (!house.mask) return false;
  const { W, H, a } = house.mask, r = Math.ceil(GREENHOUSE.hitPad / MASK_SCALE);
  const cx = Math.round(p.x / MASK_SCALE), cy = Math.round(p.y / MASK_SCALE);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (x >= 0 && y >= 0 && x < W && y < H && a[(y * W + x) * 4 + 3] > 100) return true;
  }
  return false;
}

function updateGreenhouse(dt) {
  const item = layers[GREENHOUSE.layer];
  if (!item) return;
  const now = performance.now() / 1000, B = GREENHOUSE.beckon;
  house.flash = Math.max(0, house.flash - dt * 2.5);
  house.beckon += Math.sign(house.beckonTarget - house.beckon) * Math.min(Math.abs(house.beckonTarget - house.beckon), dt / B.fade);
  const wave = 0.5 - 0.5 * Math.cos(now * B.speed), F = FIRST_TIME;
  const breath = house.beckon * (house.calling ? F.highlight * (1 - F.highlightBreath + F.highlightBreath * wave) : B.strength * wave);
  updateRoom(dt, now);
  item.obj.material.color.setScalar(1 + (house.hover ? GREENHOUSE.hover : 0) + house.flash * GREENHOUSE.flash + breath);
}

// Screen position (0..1) of a composition point on the greenhouse plane, at the current camera.
function screenOf([x, y]) {
  const item = layers[GREENHOUSE.layer];
  item.obj.updateMatrixWorld(); camera.updateMatrixWorld();
  const p = new THREE.Vector3((x / ART_W - 0.5) * item.w, (0.5 - y / ART_H) * item.h, 0);
  item.obj.localToWorld(p).project(camera);
  return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
}

// Ease the flat view zoom from its current state to (zoom, cx, cy) over `sec`.
function zoomView(zoom, cx, cy, sec) {
  const from = { z: view.zoom, cx: view.cx, cy: view.cy }, t0 = performance.now();
  return new Promise(resolve => {
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (sec * 1000)), e = easeInOut(t);
      view.zoom = view.targetZoom = from.z + (zoom - from.z) * e;
      view.cx = view.targetCx = from.cx + (cx - from.cx) * e;
      view.cy = view.targetCy = from.cy + (cy - from.cy) * e;
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    step();
  });
}

// Fade the character over `sec` while it walks (stepping through the door).
function fadeWalker(to, sec) {
  const from = walker.opacity, t0 = performance.now();
  return new Promise(resolve => {
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (sec * 1000));
      walker.opacity = from + (to - from) * t;
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    step();
  });
}

// Walk to the door. Resolves false if the player walked elsewhere on the way.
async function approachGreenhouse() {
  house.flash = 1;
  const [sx, sy] = GREENHOUSE.stand;
  return walkTo(sx, sy);
}

async function enterGreenhouse() {
  const [dx, dy] = GREENHOUSE.door, target = screenOf(GREENHOUSE.zoomTo);
  // All at once: step in and fade out, zoom towards the door, cross-fade into the interior.
  look.enterT0 = performance.now() / 1000;
  window.dispatchEvent(new Event('greenhouseenter'));   // planting.js: a new empty pot if the last one went out
  interior.classList.add('show');
  await Promise.all([walkDirect(dx, dy), fadeWalker(0, GREENHOUSE.stepSec),
    zoomView(GREENHOUSE.zoom, target.x, target.y, GREENHOUSE.zoomSec), sleep(GREENHOUSE.fadeSec * 1000)]);
  btnLeave.classList.add('show'); btnLeave.tabIndex = 0;
}

async function leaveGreenhouse() {
  btnLeave.classList.remove('show'); btnLeave.tabIndex = -1;
  // All at once: interior fades out, camera zooms out, the character steps out of the door and fades in.
  interior.classList.remove('show');
  const [sx, sy] = GREENHOUSE.stand;
  await Promise.all([walkDirect(sx, sy), fadeWalker(1, GREENHOUSE.stepSec),
    zoomView(1, 0.5, 0.5, GREENHOUSE.zoomSec), sleep(GREENHOUSE.fadeSec * 1000)]);
}

export { house, interior, screenOf, roomSheet, roomLayer, roomPan, reveal, buildGreenhouse, hitGreenhouse, updateGreenhouse, approachGreenhouse, enterGreenhouse, leaveGreenhouse };
