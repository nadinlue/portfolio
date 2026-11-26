// Searching by hand (TELESCOPE.drag; from the sky search sketch, sketches/sky-search.html). Between constellations
// the player drags the sky through the closed eyepiece to one of the constellations still waiting in this tier,
// each at its own spot (constellation.js marks them: faint stars and / or a glimmer). A flick glides on a little.
// Close enough to a spot and constellation.js lets the scope settle onto it (scopeSearch.js settleSearch).
// Rim hints: a spot out of view shows as a soft glow on the eyepiece's edge, pointing the way. Hidden at first, it
// fades in as the scope nears the spot (from hintRange degrees), stronger the closer; after hintAfter seconds of
// searching every hint fades in anyway, so nobody stays lost.
// Grab hint: until the player has dragged the sky once, a hand pulling the sky in the middle of the eyepiece says so
// (D.grab); after that it comes back whenever the view has stood still for a while.
import * as THREE from 'three';
import { TELESCOPE, settings } from './config.js';
import { camera, renderer, stage, viewport } from './core.js';
import { aim, view } from './rig.js';
import { lensRim } from './vignette.js';
import { wrapPi } from './util.js';

const D = TELESCOPE.drag, rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const round = () => D.maxYaw >= 180;   // steering all the way round (the sky dome)
const canvas = renderer.domElement, vignetteEl = document.getElementById('vignette');
const clamp01 = t => Math.min(1, Math.max(0, t)), ease = t => t * t * (3 - 2 * t);
// on: searching; spots: [{ pitch, yaw (radians), color, d (degrees away), close (0 … 1), hint (element) }];
// held: the pointer while dragging; vel: the glide after letting go (radians / s); allowed: can the player act now;
// pick(spot): a rim hint was tapped (constellation.js chooses that spot).
// onGrab: called once as the player starts steering (constellation.js dragStep: cancels the return to the last constellation).
const drag = { on: false, t: 0, spots: [], held: null, vel: { yaw: 0, pitch: 0 }, allowed: () => false, pick: null, onGrab: null };

// The grab hint. The hand: an open one and a gripping one (Lucide's "hand" and "hand-grab", ISC) cross-fading in
// style.css as it sweeps. moved: how far the player has dragged so far (px); wait: how long the hint has been due (s).
const grabIcon = paths => `<svg viewBox="0 0 24 24">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
const grabHand = document.createElement('div');
grabHand.className = 'grab-hand';
stage.appendChild(grabHand);
grabHand.innerHTML = '<span class="grab-way">‹</span><div class="grab-icon">'
  + grabIcon(['M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2', 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2', 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
    'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'])
  + grabIcon(['M18 11.5V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1.4', 'M14 10V8a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2', 'M10 9.9V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v5',
    'M6 14a2 2 0 0 0-2-2a2 2 0 0 0-2 2', 'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 1 1 4 0'])
  + '</div><span class="grab-way">›</span>';
const grab = { moved: 0, wait: 0 };
const grabLearned = () => grab.moved > D.grab.learned * viewport.h;
function updateGrabHint(dt) {
  const still = drag.allowed() && !aim.active && !drag.held && !drag.vel.yaw && !drag.vel.pitch;
  grab.wait = still ? grab.wait + dt : 0;
  grabHand.classList.toggle('show', D.grab.on && grab.wait > (grabLearned() ? D.grab.idleAfter : D.grab.delay));
}

// The scope's pitch rides on the pan up's tilt (the Pan up slider + TELESCOPE.skyTiltDeg): pitchAt = the pitch
// (degrees) that looks `e` degrees above the horizon. The spots' pitch range [lo, hi] and the steering's.
const pitchAt = e => e - deg(settings.craneTilt) - TELESCOPE.skyTiltDeg;
const spotRange = () => D.spotElev.map(pitchAt);
const dragRange = () => D.dragElev.map(pitchAt);
// Distances on the sky: the scope turns sideways about the vertical, so up high a turn covers less sky (a yaw of 36°
// at 60° up is only 18° across the sky). elev = how far above the horizon a pitch looks (radians); skyAngle = the true
// angle between two aims ({ yaw, pitch }, radians); across = how much sky one radian of yaw covers there.
const elev = pitch => settings.craneTilt + rad(TELESCOPE.skyTiltDeg) + pitch;
const across = pitch => Math.max(0.25, Math.cos(elev(pitch)));
function skyAngle(a, b) {
  const ea = elev(a.pitch), eb = elev(b.pitch);
  const dot = Math.cos(ea) * Math.cos(eb) * Math.cos(a.yaw - b.yaw) + Math.sin(ea) * Math.sin(eb);
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

// Where the waiting constellations go: `n` spots (radians) across the sky within ±maxYaw and spotElev, apart from
// each other and from where the scope starts searching (`from`'s yaw, halfway up spotElev) in both directions, so
// they spread over the whole field and the player has to look for them (gaps as true distances on the sky). Gaps
// shrink until they fit. All the way round (round()): one spot per 360° / n slice, the slices starting half a slice
// from where the scope is, each spot jittered within its slice by ± spread (so 4 lie about 90° apart, 1 behind).
// clash(spot, degrees) = it would run into a circle already on the star chart: avoided until the gaps have halved.
function placeSpots(n, from, clash = () => false) {
  const [lo, hi] = spotRange(), start = { yaw: deg(from.yaw), pitch: (lo + hi) / 2 }, slice = 360 / n;
  const apart = (a, b) => deg(skyAngle({ yaw: rad(a.yaw), pitch: rad(a.pitch) }, { yaw: rad(b.yaw), pitch: rad(b.pitch) }));
  const yawOf = i => round() ? deg(wrapPi(rad(start.yaw + (i + 0.5 + (Math.random() * 2 - 1) * D.spread) * slice)))
    : (Math.random() * 2 - 1) * D.maxYaw;
  for (let gap = D.spotGap, startGap = D.startGap; ; gap *= 0.94, startGap *= 0.94) {
    for (let tries = 0; tries < 800; tries++) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const p = { yaw: yawOf(i), pitch: lo + (hi - lo) * Math.random() };
        if (apart(p, start) < startGap || out.some(o => apart(o, p) < gap) || (gap > D.spotGap / 2 && clash(p))) break;
        out.push(p);
      }
      if (out.length === n) return out.map(o => ({ yaw: rad(o.yaw), pitch: rad(o.pitch) }));
    }
  }
}

// Start searching for `spots` (the objects are kept and filled in: d, close, hint).
function beginDrag(spots) {
  endDrag();
  Object.assign(drag, { on: true, t: 0, spots, held: null, vel: { yaw: 0, pitch: 0 } });
  for (const s of spots) {
    // as in the sketch: a soft round glow in the element's color (a gaussian falloff) with a small white core (1/6 of
    // its radius), added onto the sky (mix-blend-mode in style.css)
    const n = parseInt(s.color.slice(1), 16), rgb = `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`;
    const falloff = (col, a, reach) => Array.from({ length: 11 }, (_, i) => {
      const t = i / 10;
      return `rgba(${col},${(a * Math.exp(-t * t * 5) * (1 - t)).toFixed(3)}) ${(t * reach).toFixed(1)}%`;
    }).join(', ');
    s.hint = document.createElement('div');
    s.hint.className = 'search-hint';
    s.hint.style.background = `radial-gradient(circle closest-side, ${falloff('255,255,255', 0.9, 100 / 6)}), `
      + `radial-gradient(circle closest-side, ${falloff(rgb, 1, 100)})`;
    s.hint.style.opacity = 0;
    s.hint.style.cursor = 'pointer';
    // a tap on a hint that shows chooses its spot (the scope travels there)
    s.hint.addEventListener('pointerdown', e => { if (e.button === 0 && s.vis > 0.3 && drag.allowed()) { e.preventDefault(); e.stopPropagation(); drag.pick?.(s); } });
    s.vis = 0; s.close = 0;
    vignetteEl.after(s.hint);   // over the eyepiece's dark rim, under the UI
  }
}
function endDrag() {
  for (const s of drag.spots) s.hint?.remove();
  drag.on = false; drag.held = null; drag.spots = []; drag.onGrab = null;
  grab.wait = 0; grabHand.classList.remove('show');
  canvas.style.cursor = '';
}

// Steering: the sky follows the pointer (drag it left, the scope turns right; sideways scaled by `across`, so the sky
// keeps up with the finger up high too), within ±maxYaw (a little past the furthest spots) and dragElev; all the way
// round, the yaw stays within -180° … 180° (the spots are kept on the near side of it: updateDrag).
// While the scope still rises by itself, the finger moves the whole rise along instead (its end kept within range), so
// a press mid-rise neither stops it dead nor jumps; the player steers on from where it arrives.
const degPerPx = () => camera.fov / (viewport.h * view.zoom);
function steer(dyaw, dpitch) {
  const m = rad(D.maxYaw + 6), [lo, hi] = dragRange().map(rad);
  if (aim.active) {
    if (!round()) dyaw = Math.min(m, Math.max(-m, aim.to.yaw + dyaw)) - aim.to.yaw;
    dpitch = Math.min(hi, Math.max(lo, aim.to.pitch + dpitch)) - aim.to.pitch;
    for (const p of [aim.from, aim.to, ...[aim.via ?? []].flat()]) { p.yaw += dyaw; p.pitch += dpitch; }
    return;
  }
  // outside the range (set there some other way), a drag never snaps it in: it only can't go further out
  aim.yaw = round() ? wrapPi(aim.yaw + dyaw) : Math.min(Math.max(m, aim.yaw), Math.max(Math.min(-m, aim.yaw), aim.yaw + dyaw));
  aim.pitch = Math.min(Math.max(hi, aim.pitch), Math.max(Math.min(lo, aim.pitch), aim.pitch + dpitch));
  aim.to = { pitch: aim.pitch, yaw: aim.yaw };
}
canvas.addEventListener('pointerdown', e => {
  if (!drag.on || e.button !== 0 || e.defaultPrevented || !drag.allowed()) return;
  drag.held = { x: e.clientX, y: e.clientY, t: performance.now() / 1000 };
  drag.vel = { yaw: 0, pitch: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  const h = drag.held;
  if (!h) return;
  const now = performance.now() / 1000, dt = Math.max(0.008, now - h.t), k = rad(degPerPx());
  if (drag.onGrab && (e.clientX !== h.x || e.clientY !== h.y)) { const f = drag.onGrab; drag.onGrab = null; f(); }
  const dyaw = (e.clientX - h.x) * k / across(aim.pitch), dpitch = (e.clientY - h.y) * k;
  steer(dyaw, dpitch);
  grab.moved += Math.hypot(e.clientX - h.x, e.clientY - h.y);
  const a = Math.min(1, dt * 12);   // the flick's speed, smoothed
  drag.vel = { yaw: drag.vel.yaw + (dyaw / dt - drag.vel.yaw) * a, pitch: drag.vel.pitch + (dpitch / dt - drag.vel.pitch) * a };
  drag.held = { x: e.clientX, y: e.clientY, t: now };
});
const letGo = () => {
  if (!drag.held) return;
  if (performance.now() / 1000 - drag.held.t > 0.08) drag.vel = { yaw: 0, pitch: 0 };   // held still before letting go: no glide
  drag.held = null;
};
canvas.addEventListener('pointerup', letGo);
canvas.addEventListener('pointercancel', letGo);

// Per frame while searching (constellation.js). Returns the spot close enough to settle onto, or -1.
function updateDrag(dt) {
  if (!drag.on) return -1;
  drag.t += dt;
  if (!drag.held && (drag.vel.yaw || drag.vel.pitch)) {   // a flick glides on, slowing softly
    const sp = Math.hypot(drag.vel.yaw * across(aim.pitch), drag.vel.pitch), cap = rad(D.driftMax);   // (speed on the sky)
    if (sp > cap) { drag.vel.yaw *= cap / sp; drag.vel.pitch *= cap / sp; }
    steer(drag.vel.yaw * dt, drag.vel.pitch * dt);
    const k = Math.exp(-dt / Math.max(0.01, D.drift));
    drag.vel.yaw *= k; drag.vel.pitch *= k;
    if (sp * k < rad(0.2)) drag.vel = { yaw: 0, pitch: 0 };
  }
  if (drag.allowed()) canvas.style.cursor = drag.held ? 'grabbing' : 'grab';
  let best = -1, bestD = Infinity;
  drag.spots.forEach((s, i) => {
    s.yaw = aim.yaw + wrapPi(s.yaw - aim.yaw);   // the short way round (settling and the rim hints use it)
    s.d = deg(skyAngle(s, aim));
    s.close = clamp01(1 - s.d / D.hintRange);
    if (s.d < bestD) { bestD = s.d; best = i; }
  });
  layoutHints(dt);
  updateGrabHint(dt);
  return bestD < D.captureDeg ? best : -1;
}

// The rim hints: each spot outside the clear view gets a glow just inside the eyepiece's edge, in its direction. They
// sit in the stage beside the vignette (fixed, but the stage's transform makes the stage their frame: its centre is the
// eyepiece's). Look as in the sketch: they pulse gently and grow from 0.55× as they strengthen.
function layoutHints(dt) {
  const rim = lensRim(0), lensDeg = rim.y / (viewport.h / (camera.fov / view.zoom));
  const help = ease(clamp01((drag.t - D.hintAfter) / Math.max(0.1, D.hintFade)));
  const cx = viewport.w / 2, cy = viewport.h / 2, size = D.hintSize * viewport.h, now = performance.now() / 1000;
  for (const s of drag.spots) {
    // direction on screen: a larger yaw lies to the left, a larger pitch higher up
    const dx = -(s.yaw - aim.yaw) * across(aim.pitch), dy = -(s.pitch - aim.pitch), len = Math.hypot(dx, dy) || 1;
    const near = ease(clamp01((D.hintRange - s.d) / Math.max(1, D.hintRange - lensDeg)));
    const outside = s.d > lensDeg * 0.9 ? 1 : 0;
    const target = Math.max(near, help) * outside;
    s.vis += Math.sign(target - s.vis) * Math.min(Math.abs(target - s.vis), dt / 0.4);
    const x = cx + dx / len * rim.x, y = cy + dy / len * rim.y, k = 0.55 + 0.45 * s.vis;
    s.hint.style.width = s.hint.style.height = `${size}px`;
    s.hint.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px) scale(${k.toFixed(3)})`;
    s.hint.style.opacity = (s.vis * (0.5 + 0.25 * Math.sin(now * 2 + s.yaw * 7))).toFixed(3);
    s.hint.style.pointerEvents = s.vis > 0.3 ? 'auto' : 'none';   // tappable once it shows
  }
}

export { drag, pitchAt, placeSpots, spotRange, dragRange, beginDrag, endDrag, updateDrag };
