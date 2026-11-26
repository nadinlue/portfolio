// Searching the sky through the telescope, between constellations (constellation.js → startSearch). Instead of
// one smooth glide the scope moves like a hand-guided telescope: it rises straight up out of the dip, pauses,
// sweeps on in one to three stretches with a look around after each (now and then first drifting the wrong way or
// up high), sweeps on a little past the spot, then corrects back onto it. No two searches go the same way.
// While searching the eyepiece closes in to a round lens and the view zooms in a touch (vignette.js, the rig's
// view zoom); the picture goes soft while the scope moves fast and sharp when it holds still; a slow, faint
// tremor rides on the aim. On arrival the lens opens again and the focus pulls in, with a soft lift of light and
// a quiet chime; with the star chart on, the eyepiece opens with the focus pull instead (not along the last
// correction) while the chart's lens zoom fits its circle to the constellation (zoomSec, starChart.js), the view
// blurring as it zooms. On that same curve, still soft, the camera closes in on the circle (rig.js closeUp,
// TELESCOPE.found), so the view only ever zooms in: the search's own zoom lets go as the close-up takes over. Sounds: faint friction of the mount while it turns, a soft tick when it stops to look.
// The eyepiece may already have closed in before (closeEyepiece: while the last star flew down to its net); then the
// search's own zoom comes in by itself and takes over from the little zoom that followed the star (rig.js flyZoom).
// Tuning: TELESCOPE.search (config.js); the swing's size and timing: CONSTELLATION_PLAY.search* (soundConfig.js).
import * as THREE from 'three';
import { CONSTELLATION_PLAY, TELESCOPE } from './config.js';
import { renderer, viewport } from './core.js';
import { aim, aimTo, closeUp, flyZoom, view } from './rig.js';
import { easeInOut, wrapPi } from './util.js';
import { lensZoomOf, setVignetteLens } from './vignette.js';
import { audio, chime, chimesMuted } from './chime.js';

const S = TELESCOPE.search, rad = THREE.MathUtils.degToRad;
const search = { active: false, segs: [], i: -1, pause: 0, zoomSec: 0, focusT: -1, lens: 0, zin: 0, fly: 0, closing: false, speed: 0, prev: null, fam: null, blur: 0, sound: null };
const clamp01 = t => Math.min(1, Math.max(0, t));
const ease = t => t * t * (3 - 2 * t);
const sineInOut = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
const canvas = renderer.domElement;

// Plan the search from where the scope points now (the dip over the nets) to `target` ({ pitch, yaw }, radians).
// fam = the next constellation's element (the found chime's voice); zoomSec = how long the star chart's lens zoom
// takes once found (0 = no chart: the eyepiece opens along the last correction). Returns how long it takes (seconds).
function startSearch(target, fam, zoomSec = 0) {
  const P = CONSTELLATION_PLAY, from = { pitch: aim.pitch, yaw: aim.yaw }, rnd = Math.random;
  const D = target.yaw - from.yaw, side = Math.sign(D) || 1, rise = rad(P.searchRise), over = rad(S.overshoot * (0.6 + 0.8 * rnd()));
  const far = Math.abs(D) / rad(42);                                      // 1 = the nearest circle; longer searches wander more
  const wander = (k = 1) => (rnd() - 0.5) * 2 * rad(S.wander) * k * Math.sqrt(far);
  const between = (a, b) => a + (b - a) * rnd();
  const up = { pitch: target.pitch + rise, yaw: from.yaw + D * 0.03 };
  const stops = [up];
  // now and then a detour first: a drift the wrong way, or up high
  if (rnd() < S.detour) stops.push(rnd() < 0.5
    ? { pitch: up.pitch + wander(0.5), yaw: from.yaw - side * rad(between(5, 11)) }
    : { pitch: up.pitch + rad(between(5, 9)), yaw: from.yaw + D * between(0.1, 0.25) });
  // one to three looks along the way (more on longer searches), wandering up and down
  const n = Math.max(1, Math.min(3, Math.round(far * 1.4 + between(-0.8, 0.8))));
  for (let k = 1; k <= n; k++) {
    const f = (k - 0.5 + between(-0.25, 0.25)) / n * 0.85;
    stops.push({ pitch: target.pitch + rise * 0.4 + wander(1.5), yaw: from.yaw + D * f + wander() });
  }
  stops.push({ pitch: target.pitch + over * 0.35, yaw: target.yaw + side * over });   // on, a little past it
  stops.push({ ...target });                                                           // back onto it
  // each stretch takes as long as its distance at the sweep speed; an arc over the longer ones
  const pause = (i, last) => i === 0 ? S.pauses.rise : last ? 0 : i === stops.length - 2 ? S.pauses.past : between(...S.pauses.look);
  search.segs = stops.map((to, i) => {
    const a = i ? stops[i - 1] : from, dist = Math.hypot(to.pitch - a.pitch, to.yaw - a.yaw), last = i === stops.length - 1;
    const dur = Math.min(S.segSec[1], Math.max(last ? S.segSec[0] * 1.6 : S.segSec[0], dist / rad(S.sweepSpeed)));
    const arc = i > 0 && !last && dist > rad(8) ? rad(P.searchArc) * between(0.3, 1) : 0;
    return { to, dur, pause: pause(i, last), last, via: arc ? { pitch: (a.pitch + to.pitch) / 2 + arc, yaw: (a.yaw + to.yaw) / 2 } : null };
  });
  const fly = flyZoom.drive ?? (flyZoom.target ? easeInOut(flyZoom.e) : 0);   // the little zoom on the last star, if still in
  Object.assign(search, { active: true, free: false, i: -1, pause: 0, zoomSec, focusT: -1, zin: 0, fly, cu: closeUpIn(), closing: false, fam, prev: { ...from }, speed: 0 });
  startMountSound();
  next();
  return search.segs.reduce((s, g) => s + g.dur + (g.pause ?? 0), 0) + Math.max(zoomSec, S.focusSec);
}

// Searching by hand (dragSearch.js): the eyepiece closes in and the view goes soft as the scope moves, as above,
// but the player steers (aim set directly) until settleSearch takes over.
function startFreeSearch() {
  const fly = flyZoom.drive ?? (flyZoom.target ? easeInOut(flyZoom.e) : 0);
  // zin: the search's zoom is already in as far as the eyepiece has closed when it closed on the way up (lensZoomNow);
  // closed while the last star flew down, it isn't (the star's little zoom is in instead): it comes in as that lets go
  const zin = search.closing && !fly ? search.lens : 0;
  Object.assign(search, { active: true, free: true, segs: [], i: -1, pause: 0, zoomSec: 0, focusT: -1, zin, fly, cu: closeUpIn(), closing: false, fam: null,
    prev: { pitch: aim.pitch, yaw: aim.yaw }, speed: 0 });
  startMountSound();
}
// The player has steered close to a spot: the scope settles onto it (`target`, radians), then the focus pull and the
// star chart's lens zoom (zoomSec) as at the end of an automatic search. Returns how long it takes (seconds).
function settleSearch(target, fam, zoomSec = 0) {
  search.free = false; search.fam = fam; search.zoomSec = zoomSec;
  search.segs = [{ to: { ...target }, dur: TELESCOPE.drag.settleSec, pause: 0, last: true }]; search.i = -1;
  next();
  return TELESCOPE.drag.settleSec + Math.max(zoomSec, S.focusSec);
}

// Before the search: the eyepiece closes in to its round lens (while the last star flies down, or as the camera pans
// up for a search: modes.js lookUp) and stays so.
function closeEyepiece() { search.closing = true; }
// The close-up on the last constellation, if still in as a search starts (STAR_DELIVERY.nod.lensOnRise: kept while its
// star flew down): the search eases it out on its own zoom's curve as the lens closes (handOver), one steady zoom out.
const closeUpIn = () => (closeUp.target && closeUp.drive === null ? easeInOut(closeUp.e) : 0);
// Back on the roof: the round lens opens again (over `sec`, else lensSec).
function openEyepiece(sec = S.lensSec) { search.closing = false; search.openSec = sec; }
// How far the search's zoom is in while the eyepiece closes before the search (0 … 1, as apply's `zoom`).
const lensZoomNow = () => (search.closing && !search.active ? ease(search.lens) : 0);

function next() {
  const g = search.segs[++search.i];
  if (g) aimTo(g.to.pitch, g.to.yaw, g.dur, g.via ?? null, sineInOut);
}

// The scope was taken away (back to the roof): drop everything at once, but the eyepiece, which stays closed while
// the camera pans down and opens again softly once it's back on the roof (openEyepiece; updateSearch).
function cancelSearch() {
  if (!search.active && !search.lens && !search.blur && !search.closing) return;
  search.active = false; search.blur = 0; search.closing = search.lens > 0;
  aim.tremor = 0;
  for (const L of [closeUp, flyZoom]) if (L.drive !== null) { L.e = L.drive; L.drive = null; }   // ease out from where they got to
  flyZoom.target = 0;
  setVignetteLens(ease(search.lens)); canvas.style.filter = '';   // (the view keeps its zoom: the pan down takes it, modes.js homeLens)
  stopMountSound();
}

// Per frame (constellation.js).
function updateSearch(dt) {
  if (!search.active) {
    if (search.closing && search.lens < 1) { search.lens = Math.min(1, search.lens + dt / S.lensSec); setVignetteLens(ease(search.lens)); }
    else if (!search.closing && search.lens > 0) { search.lens = Math.max(0, search.lens - dt / (search.openSec ?? S.lensSec)); setVignetteLens(ease(search.lens)); }   // opening (openEyepiece)
    return;
  }
  const now = performance.now() / 1000;
  // how fast the scope turns, 0 … 1 (smoothed)
  const sp = dt > 0 ? Math.hypot(aim.pitch - search.prev.pitch, wrapPi(aim.yaw - search.prev.yaw)) / dt : 0;
  search.prev = { pitch: aim.pitch, yaw: aim.yaw };
  search.speed += (clamp01(sp / rad(S.blurSpeed)) - search.speed) * Math.min(1, dt * 6);

  // the path: segment → pause (a soft tick as it stops) → next segment; after the last one, the focus pull (and the
  // chart's lens zoom, at the same time)
  const g = search.segs[search.i];
  if (search.focusT >= 0) search.focusT += dt;
  else if (search.pause > 0) { search.pause -= dt; if (search.pause <= 0) next(); }
  else if (!search.free && !aim.active) {
    if (g.last) { search.focusT = 0; foundSound(); }
    else { tick(); search.pause = g.pause; if (search.pause <= 0) next(); }
  }

  // the lens: closes in at the start, opens again along the last correction (with the chart: with the focus pull,
  // while the chart zooms)
  const f = search.focusT >= 0 ? clamp01(search.focusT / S.focusSec) : 0, zooms = search.zoomSec > 0;
  const lastSeg = g?.last, k = lastSeg && search.focusT < 0 ? clamp01((now - aim.t0) / aim.dur) : search.focusT >= 0 ? 1 : 0;
  const lensTarget = !lastSeg ? 1 : zooms ? 1 - f : 1 - k;
  search.lens += Math.sign(lensTarget - search.lens) * Math.min(Math.abs(lensTarget - search.lens), lastSeg ? 1 : dt / S.lensSec);
  const lens = ease(search.lens);

  // focus: soft while it moves fast; out of focus a little as it settles, then the focus pulls in. While the chart's
  // lens zoom runs the view blurs with its speed, as a lens does while it zooms: most as it sets off.
  const hold = (lastSeg ? S.focusSoft * Math.min(1, k * 3) : 0) * (1 - ease(f));
  const q = zoomT();
  const zooming = zooms ? S.zoomBlur * clamp01(q / 0.12) * (1 - q) * (1 - q) : 0;   // ∝ the zoom's speed (lensEase), eased in
  search.blur = Math.max(search.speed * Math.max(lens, lastSeg ? 0.6 : 0) * (1 - f), hold, zooming);
  const glow = 1 + S.focusGlow * Math.sin(Math.PI * clamp01((f - 0.15) / 0.85));
  aim.tremor = rad(S.tremorDeg) * lens * (0.35 + 0.65 * search.speed);
  // With the chart, the view zoom lets go on the chart zoom's own curve: on separate curves the two pulled against
  // each other (the circle zoomed out, then in again).
  // the search's zoom comes in with the lens (or by itself, the lens already closed); the star's little zoom lets go
  search.zin = Math.min(1, search.zin + dt / S.lensSec);
  const zin = ease(search.zin);
  if (search.fly > 0) {
    flyZoom.drive = search.fly * (1 - zin);
    if (search.zin >= 1) { search.fly = 0; flyZoom.drive = null; flyZoom.e = flyZoom.target = 0; }
  }
  if (search.cu > 0) {   // handOver: the last close-up lets go the same way
    closeUp.drive = search.cu * (1 - zin);
    if (search.zin >= 1) { search.cu = 0; closeUp.drive = null; closeUp.e = closeUp.target = 0; }
  }
  apply(lens, search.blur, f > 0 ? glow : 1, zooms && search.focusT >= 0 ? 1 - lensEase(q) : Math.min(lens, zin));
  // the close-up on the found circle, on the chart zoom's curve (without the chart: with the focus pull)
  if (search.focusT >= 0) { closeUp.target = 1; closeUp.drive = zooms ? lensEase(q) : ease(f); }
  setMountSpeed(search.speed * (search.focusT >= 0 ? 0 : 1));

  if (f >= 1 && q >= 1) { search.active = false; aim.tremor = 0; apply(0, 0, 1); stopMountSound(); closeUp.e = 1; closeUp.drive = null; }
}
// How far the star chart's lens zoom is (0 … 1): it runs from the moment the scope has found the spot.
const zoomT = () => !search.active ? 1 : search.focusT < 0 ? 0 : search.zoomSec > 0 ? clamp01(search.focusT / search.zoomSec) : 1;

// Lens (0 … 1): eyepiece and (unless given apart) zoom; blur (0 … 1 of S.blurPx); brightness for the focus pull.
function apply(lens, blur, bright, zoom = lens) {
  setVignetteLens(lens);
  view.zoom = view.targetZoom = TELESCOPE.zoom * Math.pow(1 + lensZoomOf(), zoom);   // even steps, like the chart zoom
  const px = blur * S.blurPx * viewport.h / 1000;
  canvas.style.filter = px > 0.05 || bright > 1.002 ? `blur(${px.toFixed(2)}px) brightness(${bright.toFixed(3)})` : '';
}

// ---------- sounds (quiet; follow the Chimes switch and volume) ----------
const soundOn = () => { const { ctx } = audio(); return ctx && !chimesMuted() && CONSTELLATION_PLAY.volume > 0; };
const level = () => CONSTELLATION_PLAY.volume * S.sound;

// Friction of the mount: soft filtered noise, louder and a little brighter the faster the scope turns.
function startMountSound() {
  stopMountSound();
  if (!soundOn()) return;
  const { ctx, master } = audio(), n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) { lp += 0.2 * ((Math.random() * 2 - 1) - lp); d[i] = lp; }   // brownish: no hiss
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; src.loop = true;
  bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 3;
  g.gain.value = 0;
  src.connect(bp); bp.connect(g); g.connect(master); src.start();
  search.sound = { src, bp, g };
}
function setMountSpeed(v) {
  const s = search.sound; if (!s) return;
  const t = audio().ctx.currentTime;
  s.g.gain.setTargetAtTime(level() * 0.5 * v * v, t, 0.08);
  s.bp.frequency.setTargetAtTime(260 + 260 * v, t, 0.1);
}
function stopMountSound() {
  const s = search.sound; if (!s) return;
  search.sound = null;
  const t = audio().ctx.currentTime;
  s.g.gain.setTargetAtTime(0, t, 0.06);
  s.src.stop(t + 0.4);
}
// The scope comes to rest for a look: a soft wooden tick.
function tick() {
  if (!soundOn()) return;
  const { ctx, master } = audio(), t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
  o.type = 'triangle'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.06);
  lp.type = 'lowpass'; lp.frequency.value = 1400;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level() * 0.35, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12);
}
// Found: two quiet high notes in the next constellation's voice as the focus pulls in.
function foundSound() {
  if (!soundOn()) return;
  chime(7, S.sound * 1.6, 0.12, 1.3, search.fam);
  chime(9, S.sound * 1.1, 0.3, 1.5, search.fam);
}

// The star chart's lens zoom over the hold (0 … 1 → 0 … 1): quick off the mark, settling softly.
const lensEase = q => 1 - Math.pow(1 - q, 3);

export { search, startSearch, startFreeSearch, settleSearch, closeEyepiece, openEyepiece, lensZoomNow, updateSearch, cancelSearch, lensEase, zoomT };
