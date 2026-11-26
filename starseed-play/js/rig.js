// Camera rig: orbit, pan, zoom, dolly, Pan Up crane, From Below rise, shaky cam.
import * as THREE from 'three';
import { easeInOut, wrapPi } from './util.js';
import { CONSTELLATION_PLAY, SKY_PARALLAX, STAR_DELIVERY, TELESCOPE, ART_H, CHAR_FOOT_PAD, CHAR_RECT, CRANE_DURATION, CRANE_REF_TILT, CRANE_RISE, DEPTH, DOLLY_MAX, MAX_ZOOM, ORBIT_DAMP, PAN_WEIGHT, PAN_Y_RATIO, PIVOT_DIST, RISE_DURATION, RISE_FADE_HEIGHT, RISE_START, SHAKE_FREQ, SHAKE_PITCH, SHAKE_ROLL, SHAKE_SPEED, SHAKE_YAW, FOLLOW, ART_W, OVERSCAN, settings } from './config.js';
import { camera, frameAt, viewport } from './core.js';
import { layers, parallax, rowScroll, rowWeight, skyParallax } from './layers.js';
import { blendBtsCamera, bts, updateBts } from './bts.js';
import { tilt as phoneTilt, TILT } from './tilt.js';

const pivot = new THREE.Vector3(0, 0, -PIVOT_DIST);
const orbit = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0 };
const pan = { x: 0, y: 0, targetX: 0, targetY: 0 };   // normalized -1..1
const view = { zoom: 1, cx: 0.5, cy: 0.5, targetZoom: 1, targetCx: 0.5, targetCy: 0.5 };  // view center in 0..1
const dolly = { t: 0, target: 0 };                     // 0..1 of DOLLY_MAX
// Close-ups in the sky: flat zooms on top of the view's, each easing in and out (e = 0 … 1 over sec, eased in
// updateCamera; or drive = 0 … 1 when scopeSearch.js sets it instead). Each zooms in by `zoom` about the screen point
// `at` (NDC, as it shows before that zoom), which moves to `to` as it closes in (to = at: it stays put).
// closeUp: on a found constellation (TELESCOPE.found), its spot moving towards the middle, so its circle and stars
// are bigger to tap; the search drives it in while the view is still soft, with the eyepiece opening and the focus
// pulling in. flyZoom: a little zoom onto the star as it flies down to its net (STAR_DELIVERY.flyZoom), on the star;
// the next search lets it go as its own zoom takes over. Together (closeUp first) they map the screen:
// shown = k × p + (bx, by) in NDC (skyZoom).
const zoomLayer = () => ({ e: 0, target: 0, drive: null, zoom: 1, sec: 1, at: { x: 0, y: 0 }, to: { x: 0, y: 0 } });
const closeUp = zoomLayer(), flyZoom = zoomLayer(), skyZoom = { k: 1, bx: 0, by: 0 };
function setCloseUp(on) { closeUp.target = on ? 1 : 0; }
// on the star at screen point p (NDC, as it shows); called again as it moves
function setFlyZoom(on, p = null) { flyZoom.target = on ? 1 : 0; if (p) aimFlyZoom(p); }
function aimFlyZoom(p) { flyZoom.at.x = flyZoom.to.x = p.x; flyZoom.at.y = flyZoom.to.y = p.y; }
// Where the constellation's spot shows on screen now (NDC), and a point measured on screen back to how it shows
// without the close-ups: for placing and fitting things as if there were none.
const focusNdc = (out = new THREE.Vector2()) => out.set(skyZoom.bx, skyZoom.k * CONSTELLATION_PLAY.focusY + skyZoom.by);
const withoutCloseUp = v => { v.x = (v.x - skyZoom.bx) / skyZoom.k; v.y = (v.y - skyZoom.by) / skyZoom.k; return v; };

function dollyScale(depth) {
  const travel = dolly.t * DOLLY_MAX;
  const sTrue = depth / (depth - travel);
  const sRoof = DEPTH.midground / (DEPTH.midground - travel);
  return sRoof * Math.pow(sTrue / sRoof, settings.dollyDepth);
}
// Called when the crane target changes, so the UI can update its buttons.
const rigEvents = { onChange() {} };

const crane = { value: 0, from: 0, to: 0, t0: 0, active: false };
const rise = { value: 0, t0: 0, active: false };   // 1 = below the rooftop, 0 = normal view
// Telescope aim on top of the Pan Up (radians), scaled by the crane so it only applies in the sky.
// tremor = radians of a slow, faint wobble on top (a hand on the tube while searching; scopeSearch.js).
// hold = the part of the yaw the layers don't turn along with (turnLayers), so the roof itself slides: for following
// a star down to its net; eased with each swing (aimTo's `hold`, back to 0 on any swing that doesn't set it).
const aim = { pitch: 0, yaw: 0, from: { pitch: 0, yaw: 0 }, to: { pitch: 0, yaw: 0 }, via: null, t0: 0, dur: 1, active: false, tremor: 0,
  hold: 0, holdFrom: 0, holdTo: 0, off: { pitch: 0, yaw: 0 } };
// aim.off: a correction on top of the swing (radians), steered live to keep the flying star in the middle of the view
// (delivery.js centreView); the whole view turns with it as one picture (like hold). Folded into the aim by bakeAimOff,
// which every new swing does first, so nothing jumps.
const camBase = new THREE.Quaternion();   // the camera's turn before the aim (after lookAt), for aimView
const SKY_TILT = THREE.MathUtils.degToRad(TELESCOPE.skyTiltDeg);

function riseFromBelow() {
  rise.value = 1; rise.t0 = performance.now() / 1000; rise.active = true;
}


// Swing the telescope to an extra pitch / yaw (radians) over `dur` seconds, eased (easeInOut, or `ease`). With `via`
// ({ pitch, yaw }) the swing curves towards that point on its way (a quadratic curve: it bends towards via, never
// quite reaching it); with two ([a, b]) it's a cubic curve: it sets off towards a and arrives coming from b.
// easeYaw: the sideways turn on a curve of its own (else `ease`), e.g. done early in the swing (followStar).
function aimTo(pitch, yaw, dur, via = null, ease = easeInOut, hold = 0, easeYaw = null) {
  bakeAimOff();
  aim.from = { pitch: aim.pitch, yaw: aim.yaw }; aim.to = { pitch, yaw }; aim.via = via; aim.ease = ease; aim.easeYaw = easeYaw;
  aim.holdFrom = aim.hold; aim.holdTo = hold;
  aim.t0 = performance.now() / 1000; aim.dur = Math.max(0.01, dur); aim.active = true;
}

function bakeAimOff() {
  const { pitch, yaw } = aim.off;
  if (!pitch && !yaw) return;
  aim.pitch += pitch; aim.from.pitch += pitch; aim.to.pitch += pitch;
  aim.yaw += yaw; aim.from.yaw += yaw; aim.to.yaw += yaw;
  aim.hold += yaw; aim.holdFrom += yaw; aim.holdTo += yaw;
  aim.off.pitch = aim.off.yaw = 0;
}

// Run fn with the camera turned as it will be at telescope aim (pitch, yaw), then turn it back: for finding
// where the scope will point before it gets there (shaky cam left out).
function aimView(pitch, yaw, fn) {
  const q = camera.quaternion.clone();
  camera.quaternion.copy(camBase);
  turnScope((settings.craneTilt + SKY_TILT + pitch + aim.off.pitch) * crane.value, (yaw + aim.off.yaw) * crane.value);
  camera.updateMatrixWorld();
  try { return fn(); } finally { camera.quaternion.copy(q); camera.updateMatrixWorld(); }
}

// The scope's turn on top of the camera's base turn: sideways by `yaw` about the world's up axis (the height above
// the horizon stays), then up by `tilt` (radians).
function turnScope(tilt, yaw) {
  camera.rotateOnWorldAxis(THREE.Object3D.DEFAULT_UP, yaw);
  camera.rotateX(tilt);
}

function panTo(target) {
  crane.from = crane.value; crane.to = target;
  crane.t0 = performance.now() / 1000;
  crane.active = true;
  rigEvents.onChange();
}

// Camera follow offset (world units) and its target; neutral where the character starts.
const follow = { x: 0, y: 0, tx: 0, ty: 0 };
const FOLLOW_START = { x: CHAR_RECT.x + CHAR_RECT.w / 2, y: CHAR_RECT.y + CHAR_RECT.h * (1 - CHAR_FOOT_PAD) };
const tiltCam = { x: 0, y: 0 };   // tilting the phone (tilt.js): the same kind of truck, eased, on top of the follow

// Smooth wave in -1..1 from three sines (weights 0.55 / 0.3 / 0.15); `phase` decorrelates the axes.
function shakeWave(t, [f1, f2, f3], phase) {
  return 0.55 * Math.sin(t * f1 + phase) + 0.3 * Math.sin(t * f2 + phase * 1.7) + 0.15 * Math.sin(t * f3 + phase * 2.3);
}

function updateCamera(dt, now) {
  const k = 1 - Math.exp(-ORBIT_DAMP * dt);
  orbit.yaw += (orbit.targetYaw - orbit.yaw) * k;
  orbit.pitch += (orbit.targetPitch - orbit.pitch) * k;
  pan.x += (pan.targetX - pan.x) * k;
  pan.y += (pan.targetY - pan.y) * k;
  dolly.t += (dolly.target - dolly.t) * k;
  const panX = settings.panRange, panY = settings.panRange * PAN_Y_RATIO;
  // Row scrolling: extra slide for the bottom floor row (in texture widths), and the character
  // slides with the floor row under its feet.
  rowScroll.mix += ((rowScroll.enabled ? 1 : 0) - rowScroll.mix) * k;
  rowScroll.uniforms.uRowShift.value = rowScroll.mix * pan.x * panX * (settings.rowNearWeight - PAN_WEIGHT.midground);
  rowScroll.uniforms.uFloorTop.value = settings.rowFloorTop;
  // Vertical row scrolling: bottom row drop in frame heights. Driven by vertical Pan Orbit drags
  // (negative pan.y = camera moving up) and From Below; not by Pan Up, which is a turn (no parallax).
  rowScroll.mixY += ((rowScroll.enabledY ? 1 : 0) - rowScroll.mixY) * k;
  const dropY = rowScroll.mixY * settings.vRowStrength * (-pan.y - rise.value);   // below the roof: floor squashes
  rowScroll.uniforms.uRowShiftY.value = dropY;
  rowScroll.uniforms.uFloorTopY.value = settings.vRowFloorTop;
  if (layers.character) {
    // Floor row under the boots: follows the character while it walks (walk.js sets `foot`).
    const footRow = (layers.character.foot?.y ?? CHAR_RECT.y + CHAR_RECT.h * (1 - CHAR_FOOT_PAD)) / ART_H;
    layers.character.weight = THREE.MathUtils.lerp(PAN_WEIGHT.character, rowWeight(footRow), rowScroll.mix);
    layers.character.rowDropY = dropY * THREE.MathUtils.clamp((footRow - settings.vRowFloorTop) / (1 - settings.vRowFloorTop), 0, 1);
  }
  const ref = PAN_WEIGHT.midground;   // Parallax X / Y at 0: every layer slides like the rooftop
  for (const p of parallax) {
    // Dolly scales each layer about the camera axis, so its position scales too.
    const sc = dollyScale(p.depth);
    const wx = ref + settings.parallaxX * (p.weight * p.strength - ref);
    const wy = ref + settings.parallaxY * (p.weight * p.strength - ref);
    p.obj.scale.set(sc, sc, 1);
    p.obj.position.x = (p.base.x + pan.x * panX * p.w * wx) * sc;
    p.obj.position.y = (p.base.y + pan.y * panY * p.h * wy - (p.rowDropY || 0) * p.h) * sc;
    for (const f of p.followers) { f.position.copy(p.obj.position); f.scale.set(sc, sc, 1); }
  }
  updateBts(dt, now, k);
  if (underside) {
    underside.visible = undersideFade.visible = bts.e < 0.001;
    undersideFade.material.opacity = Math.min(1, rise.value * 3);   // fully soft-edged until the last stretch
  }
  if (rise.active) {
    const t = Math.min(1, (now - rise.t0) / RISE_DURATION);
    rise.value = 1 - easeInOut(t);
    if (t >= 1) rise.active = false;
  }

  if (crane.active) {
    const dur = CRANE_DURATION * Math.max(0.35, Math.abs(crane.to - crane.from));
    const t = Math.min(1, (now - crane.t0) / dur);
    crane.value = crane.from + (crane.to - crane.from) * easeInOut(t);
    if (t >= 1) crane.active = false;
  }

  if (aim.active) {
    const t = Math.min(1, (now - aim.t0) / aim.dur), e = (aim.ease ?? easeInOut)(t);
    const ey = aim.easeYaw ? aim.easeYaw(t) : e;
    const v = aim.via, u = 1 - e, curve = k => {
      const a = aim.from[k], c = aim.to[k];
      if (!v) return a + (c - a) * (k === 'yaw' ? ey : e);
      if (!Array.isArray(v)) return u * u * a + 2 * u * e * v[k] + e * e * c;
      return u * u * u * a + 3 * u * u * e * v[0][k] + 3 * u * e * e * v[1][k] + e * e * e * c;
    };
    aim.pitch = curve('pitch');
    aim.yaw = curve('yaw');
    // the hold changes in step with the turn itself (as far round as the yaw has come), so the view never turns
    // apart while the scope isn't turning
    const dy = aim.to.yaw - aim.from.yaw, hk = Math.abs(dy) > 1e-4 ? THREE.MathUtils.clamp((aim.yaw - aim.from.yaw) / dy, 0, 1) : e;
    aim.hold = aim.holdFrom + (aim.holdTo - aim.holdFrom) * hk;
    if (t >= 1) aim.active = false;
  }

  // Shaky cam sways on top of the orbit; it fades out in Behind the Scenes.
  const sk = settings.shake * (1 - bts.e), st = now * SHAKE_SPEED;
  const yaw = orbit.yaw + sk * SHAKE_YAW * shakeWave(st, SHAKE_FREQ.yaw, 0);
  const pitch = orbit.pitch + sk * SHAKE_PITCH * shakeWave(st, SHAKE_FREQ.pitch, 2.1);
  const cp = Math.cos(pitch);
  camera.position.set(
    pivot.x + PIVOT_DIST * Math.sin(yaw) * cp,
    pivot.y + PIVOT_DIST * Math.sin(pitch),
    pivot.z + PIVOT_DIST * Math.cos(yaw) * cp);
  // Crane lift for Pan Up, minus the From Below drop.
  const craneLift = CRANE_RISE * (settings.craneTilt / CRANE_REF_TILT) * crane.value;
  const lift = craneLift - riseDrop() * rise.value;
  camera.position.y += lift;
  // Follow the character: truck (move without turning) a little towards it, eased, so layers parallax.
  const foot = layers.character?.foot;
  if (foot) {
    const f = settings.follow * (1 - bts.e);
    // Never further sideways than the spare artwork the foreground has beyond the screen edge.
    const maxX = frameAt(DEPTH.foreground).w / OVERSCAN * (OVERSCAN - 1) / 2 * 0.9;
    follow.tx = THREE.MathUtils.clamp((foot.x - FOLLOW_START.x) / ART_W * FOLLOW.x * f, -maxX, maxX);
    follow.ty = -(foot.y - FOLLOW_START.y) / ART_H * FOLLOW.y * f;   // walking towards the front: camera lowers
  }
  const kf = 1 - Math.exp(-dt / FOLLOW.smooth);
  follow.x += (follow.tx - follow.x) * kf;
  follow.y += (follow.ty - follow.y) * kf;
  // Tilting the phone, on the roof only (the sky stays still for tapping stars): within what the foreground's spare
  // artwork still has beyond the follow, on the side it moves to, so no layer edge shows.
  const spare = frameAt(DEPTH.foreground), edge = (OVERSCAN - 1) / OVERSCAN / 2 * 0.9;
  const room = (t, f, max) => t * Math.max(0, max - f * Math.sign(t));
  const tf = (1 - crane.value) * (1 - bts.e), kt = 1 - Math.exp(-dt / TILT.smooth);
  tiltCam.x += (room(phoneTilt.x * TILT.roof[0] * tf, follow.x, spare.w * edge) - tiltCam.x) * kt;
  tiltCam.y += (room(phoneTilt.y * TILT.roof[1] * tf, follow.y, spare.h * edge) - tiltCam.y) * kt;
  const moveX = follow.x + tiltCam.x, moveY = follow.y + tiltCam.y;
  camera.position.x += moveX;
  camera.position.y += moveY;
  applyParallaxStrength(craneLift);
  camera.lookAt(pivot.x + moveX, pivot.y + lift + moveY, pivot.z);
  camBase.copy(camera.quaternion);
  const tr = aim.tremor, tw = tr && tr * (0.6 * Math.sin(now * 1.3) + 0.4 * Math.sin(now * 2.1 + 1.7));
  const tp = tr && tr * (0.6 * Math.sin(now * 1.1 + 0.6) + 0.4 * Math.sin(now * 1.9 + 2.9));
  const tilt = (settings.craneTilt + SKY_TILT + aim.pitch + aim.off.pitch + tp) * crane.value;
  turnLayers((aim.yaw - aim.hold) * crane.value * (1 - bts.e), (aim.yaw + aim.off.yaw) * crane.value * (1 - bts.e));
  turnSkyParallax(tilt, (aim.yaw + aim.off.yaw + tw) * crane.value, dt);
  turnScope(tilt, (aim.yaw + aim.off.yaw + tw) * crane.value);   // telescope swings sideways and tilts up
  camera.rotateZ(sk * SHAKE_ROLL * shakeWave(st, SHAKE_FREQ.roll, 4.3));
  blendBtsCamera();

  // Flat zoom: render a sub-window of the full view (released while Behind the Scenes is shown).
  view.zoom += (view.targetZoom - view.zoom) * k;
  view.cx += (view.targetCx - view.cx) * k;
  view.cy += (view.targetCy - view.cy) * k;
  const W = viewport.w, H = viewport.h, e = bts.e;
  const z = 1 + (view.zoom - 1) * (1 - e);
  const cx = THREE.MathUtils.lerp(view.cx, 0.5, e), cy = THREE.MathUtils.lerp(view.cy, 0.5, e);
  // the close-ups: the found constellation's (zoom in by F.zoom, its spot moving F.centre of the way to the middle),
  // then the flying star's (zoom in by its flyZoom about the star)
  const F = TELESCOPE.found, fy = CONSTELLATION_PLAY.focusY;
  Object.assign(closeUp, { zoom: F.zoom, sec: F.sec }); closeUp.at.y = fy; closeUp.to.y = fy * (1 - F.centre);
  Object.assign(flyZoom, { zoom: STAR_DELIVERY.flyZoom, sec: STAR_DELIVERY.flyZoomSec });
  let K = 1, bx = 0, by = 0;
  for (const L of [closeUp, flyZoom]) {
    if (L.drive === null) L.e += Math.sign(L.target - L.e) * Math.min(Math.abs(L.target - L.e), dt / L.sec);
    const c = (L.drive ?? easeInOut(L.e)) * (1 - e), kk = 1 + (L.zoom - 1) * c;
    K *= kk;
    bx = kk * bx + L.at.x + (L.to.x - L.at.x) * c - kk * L.at.x;
    by = kk * by + L.at.y + (L.to.y - L.at.y) * c - kk * L.at.y;
  }
  const zk = z * K, cxK = clampCenter(cx - bx / (2 * zk), zk), cyK = clampCenter(cy + by / (2 * zk), zk);
  skyZoom.k = K; skyZoom.bx = 2 * zk * (cx - cxK); skyZoom.by = 2 * zk * (cyK - cy);   // (as kept inside the view)
  camera.setViewOffset(W, H, (cxK - 0.5 / zk) * W, (cyK - 0.5 / zk) * H, W / zk, H / zk);
}

// Parallax strength for camera moves (shake, orbit, follow, Pan Up, From Below). A layer at depth d slides
// on screen by t / d when the camera moves t sideways or up. Moving the layer along by o makes that
// (t - o) / d, so o = t * (1 - d * s) gives it any screen speed s: here its strength times what its depth
// gives, blended towards the rooftop's speed by the Parallax X / Y sliders. Off in Behind the Scenes.
// craneLift: the Pan Up's rise, part of looking up into the sky (a turn), so no parallax: every layer moves along
// with it at the sky's pace (o = t × (1 - d / sky depth)), as if the camera only tilted.
function applyParallaxStrength(craneLift = 0) {
  const tx = camera.position.x * (1 - bts.e), ty = (camera.position.y - craneLift) * (1 - bts.e);   // camera rests at the origin
  const ly = craneLift * (1 - bts.e);
  for (const p of parallax) {
    const r = p.depth / PIVOT_DIST, sc = p.obj.scale.y;   // r: the layer's depth relative to the rooftop
    p.obj.position.x += tx * (1 - r - settings.parallaxX * (p.strength - r)) * sc;
    p.obj.position.y += (ty * (1 - r - settings.parallaxY * (p.strength - r)) + ly * (1 - p.depth / DEPTH.sky)) * sc;
    for (const f of p.followers) f.position.copy(p.obj.position);
  }
}

// The telescope's sideways swing turns the camera; every layer but the sky turns along with it about the camera
// (vertical axis), so on screen it only drifts by its share of the swing: a share that grows with its depth
// (TELESCOPE.aimParallax × depth / sky depth), the far city most, the roof hardly at all. Parallax instead of
// the whole rooftop sliding out of view while the sky (with the chart and constellations) turns fully.
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Vector3();
// Turned further round than TELESCOPE.layerFollow[0], they turn back to where they stand (by layerFollow[1]), so they
// slide out of view behind the scope and meet themselves at 180° (seamless when the yaw wraps round).
// How far a layer with drift share s shows turned away on screen at a swing of ay (radians, ≥ 0): s × the swing up
// to f0, then speeding up smoothly (a cubic matching both speeds) until it has gone round with the scope at f1. No
// sudden change of speed anywhere, so it never rushes in and stops short as the scope turns back.
function layerOffset(ay, s, f0, f1) {
  if (ay <= f0) return s * ay;
  if (ay >= f1) return ay;
  const w = f1 - f0, t = (ay - f0) / w, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * s * f0 + (t3 - 2 * t2 + t) * s * w + (-2 * t3 + 3 * t2) * f1 + (t3 - t2) * w;
}
// Turning together (TELESCOPE.swing): the layers that scroll instead, each with the layer whose pace it keeps (the far
// street glow lies behind the near city's roofs). Mirrored artwork (ex ≥ 1) moves as a whole and wraps every two frames
// (a mirrored pair repeats seamlessly); the soft sheets (mist, glow) shift in their shader (uShift, frame widths).
const scrollers = () => [[layers.cityFar], [layers.city], [layers.fog], [layers.cityGlowFar, layers.city]];
function turnLayers(yaw, full) {
  const [f0, f1] = TELESCOPE.layerFollow.map(THREE.MathUtils.degToRad), y = wrapPi(yaw), ay = Math.abs(y);
  // the layer turns along with the scope by what it doesn't show turned away
  const along = s => Math.sign(y) * (ay - layerOffset(ay, Math.min(1, s), f0, f1));
  const turn = (obj, a) => {
    _q.setFromAxisAngle(_up, a);
    obj.quaternion.copy(_q);
    obj.position.copy(camera.position).sub(_c.copy(camera.position).applyQuaternion(_q));   // about the camera
  };
  const SW = TELESCOPE.swing, fy = wrapPi(full), scrolling = new Set();
  if (SW.together) {
    // it turns with the scope (staying in view) while its artwork slides past at the sky's pace (at the middle of the
    // view; a little faster the nearer it is), and sinks away behind (where the wrap at ±180° hides too)
    const drop = SW.sink * THREE.MathUtils.smoothstep(Math.abs(fy), f0, f1);
    for (const [p, pace = p] of scrollers()) {
      if (!p) continue;
      scrolling.add(p);
      const frames = fy * (1 + SW.parallax * (DEPTH.cityFar / pace.depth - 1)) * pace.depth / pace.w;
      turn(p.turn, fy);
      const shift = p.obj.material.uniforms?.uShift;
      if (shift) shift.value = frames;
      const x = shift ? 0 : ((((frames + 1) % 2) + 2) % 2 - 1) * p.w;
      p.turn.position.add(_c.set(x, -drop * p.h, 0).applyQuaternion(_q));
      p.turned = true;
    }
  }
  for (const p of parallax) {
    if (p === layers.sky || scrolling.has(p)) continue;
    const shift = p.obj.material?.uniforms?.uShift;
    if (shift) shift.value = 0;
    const a = along(TELESCOPE.aimParallax * p.depth / DEPTH.sky);
    if (!a && !p.turned) continue;
    p.turned = a !== 0;
    turn(p.turn, a);
  }
  // The painted sky (moon, wisps) drifts like the layer at TELESCOPE.backdropDepth, so it stays in step with the
  // city instead of sliding past it with the stars (and sliding back into place on the way down to the roof).
  const bd = layers.sky?.backdrop;
  if (bd) turn(bd.group, SW.together ? 0 : along(TELESCOPE.aimParallax * TELESCOPE.backdropDepth / DEPTH.sky));   // (inside the sky, which doesn't turn)
}

// Sky parallax (SKY_PARALLAX): as the scope turns, parts of the sky turn a little the other way about the camera, so on
// screen they slide a little faster than the rigid constellations and chart (or, turned along, slower). Proportional
// to the scope's turn, so all of it is at home at the rooftop view. uParW = that turn at speed 1. The dome parts have
// sky all the way round, so they count the yaw on past ±180° (no jump at the wrap) and ease back down the way home; the
// backdrop has an edge and must land exactly, so it keeps the wrapped yaw (the jump at ±180° lies behind the camera).
const skyYaw = { total: 0, last: 0 }, _axis = new THREE.Vector3(), _n = new THREE.Vector3(), _w = new THREE.Vector3(), _pivot = new THREE.Vector3();
function turnPart(obj, w, k, pivot) {
  _q.setFromAxisAngle(_n.copy(w).normalize(), w.length() * k);
  obj.quaternion.copy(_q);
  obj.position.copy(pivot).sub(_c.copy(pivot).applyQuaternion(_q));
}
function turnSkyParallax(tilt, yaw, dt) {
  const y = wrapPi(yaw), keep = -(1 - bts.e);
  skyYaw.total += wrapPi(y - skyYaw.last); skyYaw.last = y;
  if (crane.value < 1) skyYaw.total += (y - skyYaw.total) * (1 - Math.exp(-dt / SKY_PARALLAX.settleSec));
  _axis.set(1, 0, 0).applyAxisAngle(_up, y);   // the axis the scope tilts about, facing where it looks
  const W = skyParallax.uParW.value.copy(_up).multiplyScalar(skyYaw.total).addScaledVector(_axis, tilt).multiplyScalar(keep);
  const far = layers.sky?.far, bd = layers.sky?.backdrop;
  if (far) turnPart(far, W, skyParallax.uParMilkyWay.value, _pivot.set(0, 0, DEPTH.sky));
  if (bd && TELESCOPE.swing.together) {
    _w.copy(_up).multiplyScalar(y).addScaledVector(_axis, tilt).multiplyScalar(keep);
    turnPart(bd.group, _w, skyParallax.uParBackdrop.value, camera.position);
  }
}

// Keep the zoomed window inside the full view.
const clampCenter = (c, z) => THREE.MathUtils.clamp(c, 0.5 / z, 1 - 0.5 / z);

function zoomAt(mx, my, factor) {
  const z0 = view.targetZoom, z1 = THREE.MathUtils.clamp(z0 * factor, 1, MAX_ZOOM);
  // Point under the cursor (in full-view coordinates) stays under the cursor.
  const u = view.targetCx + (mx - 0.5) / z0, v = view.targetCy + (my - 0.5) / z0;
  view.targetZoom = z1;
  view.targetCx = clampCenter(u - (mx - 0.5) / z1, z1);
  view.targetCy = clampCenter(v - (my - 0.5) / z1, z1);
}

function resetZoom() {
  view.targetZoom = 1; view.targetCx = view.targetCy = 0.5;
  dolly.target = 0;
}

// Black building underside hanging below the foreground's bottom edge, plus a gradient that softens
// the edge while the camera is low (it fades out as the camera arrives, so the game view is untouched).
let underside = null, undersideFade = null;
function fadeTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 256, 0, 0);
  for (let i = 0; i <= 8; i++) {   // eased falloff: dense at the edge, long soft tail upwards
    const t = i / 8;
    grad.addColorStop(t, `rgba(0,0,0,${(1 - t) ** 2})`);
  }
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}
function addUnderside() {
  const fg = layers.foreground, { w, h } = fg, H = h * 3;
  // Overlaps the foreground's bottom 1% so no gap shows; drawn just behind the foreground.
  const geo = new THREE.PlaneGeometry(w * 3, H).translate(0, -h / 2 - H / 2 + h * 0.01, 0);
  underside = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false }));
  underside.renderOrder = 7.9;
  const G = h * RISE_FADE_HEIGHT;
  undersideFade = new THREE.Mesh(new THREE.PlaneGeometry(w * 3, G).translate(0, -h / 2 + G / 2, 0),
    new THREE.MeshBasicMaterial({ map: fadeTexture(), transparent: true, depthWrite: false, opacity: 0 }));
  undersideFade.renderOrder = 8.1;   // over the foreground's bottom edge
  fg.group.add(underside, undersideFade);
  fg.followers.push(underside, undersideFade);
}

// Half view height at the foreground's depth.
const fgHalfView = () => DEPTH.foreground * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

// Camera drop for From Below: RISE_START half view heights below the foreground's bottom edge.
const riseDrop = () => frameAt(DEPTH.foreground).h / 2 + RISE_START * fgHalfView();

export { skyZoom, bakeAimOff, closeUp, flyZoom, setCloseUp, setFlyZoom, aimFlyZoom, focusNdc, withoutCloseUp, follow, pivot, orbit, pan, view, dolly, dollyScale, rigEvents, aim, aimTo, aimView, crane, rise, riseFromBelow, panTo, shakeWave, updateCamera, clampCenter, zoomAt, resetZoom, underside, undersideFade, fadeTexture, addUnderside, fgHalfView, riseDrop };
