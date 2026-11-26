// Game modes (A2): rooftop ↔ stargazing. Tap the telescope: the character walks to the eyepiece,
// leans in, the tube tilts up, and the camera pans up to the sky. Return reverses it.
// Modes: 'rooftop' | 'approach' (walking to the telescope) | 'toSky' | 'sky' | 'toRooftop'
//   | 'toDoor' (walking to the greenhouse) | 'entering' | 'greenhouse' | 'leaving'
//   | 'toPlant' (unused now).
import * as THREE from 'three';
import { $, sleep, until, wrapPi } from './util.js';
import { CRANE_DURATION, ROOF_GARDEN, TELESCOPE } from './config.js';
import { renderer, viewport } from './core.js';
import { aim, aimTo, crane, panTo, rise, setCloseUp, setFlyZoom, view } from './rig.js';
import { bts } from './bts.js';
import { mode as devMode } from './ui.js';
import { cheer, clickToArt, onFloor, walker, walkTo } from './walk.js';
import { flashTelescope, hitTelescope, scope, tappedTelescope, tiltTube } from './telescope.js';
import { lensZoomOf, setVignetteProgress } from './vignette.js';
import { approachGreenhouse, enterGreenhouse, hitGreenhouse, house, leaveGreenhouse } from './greenhouse.js';
import { COLLECT, NETS } from './config.js';
import { fullNets, gatherFirst, hitNet, noteInput, noticeNets, pickFromNet, refuseNet, satchelFull, startLinger } from './collect.js';
import { flashNet, onNet, setNetHover } from './netStars.js';
import { chart, holdChart, setChartBrush, setChartOn } from './starChart.js';
import { canLeaveSky, lookUpAim } from './constellation.js';
import { closeEyepiece, lensZoomNow, openEyepiece } from './scopeSearch.js';
import { poppedRecently } from './stars.js';
import { pickSkyColor } from './skyLook.js';
import { nudgeToGreenhouse, planted, skyLocked } from './firstTime.js';
import { hushBubble, sayNothingToGrow } from './speechBubble.js';
import { bringOutPlant, hitWaiting, hoverRoof, justDragged, moveRoof, pressRoof, releaseRoof, settlePlant, waitingSpot } from './roofGarden.js';

const game = { mode: 'rooftop' };
const canvas = renderer.domElement, btnReturn = $('btnReturn');

// Rooftop input only in the normal game view, with the camera resting on the roof.
const rooftopInput = () => ['rooftop', 'approach', 'toDoor', 'toNet', 'toPlant'].includes(game.mode)
  && devMode === 'none' && bts.e === 0 && !rise.active && crane.to === 0 && !crane.active;

canvas.addEventListener('click', e => {
  if (!rooftopInput() || poppedRecently()) return;   // (a tap that popped a shooting star)
  const p = clickToArt(e);
  if (!p || justDragged()) return;   // (a drag of the waiting plant ends in a click)
  if (hitWaiting(p)) { plantTheFlower(); return; }
  if (hitTelescope(p)) {
    tappedTelescope();   // (its idle highlight waits again, telescope.js)
    // The sky waits (first time: until the first plant; after a sky trip: until the nets are emptied). A star still in
    // the nets pops up above the character's head as it looks at its net; with every star gathered (or the satchel
    // full) the character turns to the greenhouse and the hint ring circles its door.
    if (skyLocked() || gatherFirst()) { if (fullNets().length && !satchelFull()) noticeNets(); else nudgeToGreenhouse(); }
    else lookUp();
    return;
  }
  if (hitGreenhouse(p)) { goIntoGreenhouse(); return; }
  noteInput();
  const net = hitNet(p);
  if (net >= 0) { collectFromNet(net); return; }
  if (!onFloor(p)) return;
  game.mode = 'rooftop';          // walking elsewhere cancels a look-up / greenhouse visit on the way
  walkTo(p.x, p.y);
});

// The net under a roof point (full or empty), or -1.
function netAt(p) {
  return NETS.findIndex((n, i) => onNet(p, i));
}

canvas.addEventListener('pointermove', e => {
  if (game.mode === 'sky') return;   // the constellation sets the cursor in the sky
  const p = rooftopInput() && game.mode === 'rooftop' ? clickToArt(e) : null;
  const plant = hoverRoof(p);                                        // the plant waiting to be planted
  const overScope = !!p && !plant && hitTelescope(p);
  scope.hover = overScope && !scope.locked;                           // (first time: it doesn't light up before the first plant)
  house.hover = !!p && !plant && !overScope && hitGreenhouse(p);
  const free = !!p && !plant && !overScope && !house.hover;
  setNetHover(free ? netAt(p) : -1);                                 // every net lights up under the pointer
  const net = free ? hitNet(p) : -1;                                 // only full nets can be tapped
  canvas.style.cursor = plant ? 'grab' : overScope || house.hover || net >= 0 ? 'pointer' : '';
});
canvas.addEventListener('pointerleave', () => { scope.hover = house.hover = false; hoverRoof(null); setNetHover(-1); canvas.style.cursor = ''; });

// The waiting plant: press (and hold or move) to drag it along the planters (roofGarden.js).
canvas.addEventListener('pointerdown', e => {
  if (e.defaultPrevented || !rooftopInput() || !['rooftop', 'toPlant'].includes(game.mode)) return;
  const p = clickToArt(e);
  if (p) pressRoof(e, p);
});
window.addEventListener('pointermove', e => moveRoof(e, clickToArt(e)));
window.addEventListener('pointerup', releaseRoof);
window.addEventListener('pointercancel', releaseRoof);

// Zoom and eyepiece vignette in step with the crane: none on the roof, full at the top of the pan. With the eyepiece
// closing for a search on the way up (lookUp), the search's zoom comes in with it. On the way down (`home`) the vignette
// stays full (it fades once back on the roof: fadeHome) and the view goes soft with the move (TELESCOPE.homeBlur).
let homeLens = 0;   // on the way down: the search's zoom (0 … 1) as the view had it when the camera set off (returnToRooftop)
function zoomWithPan(home = false) {
  setVignetteProgress(home ? 1 : crane.value);
  const z = (1 + (TELESCOPE.zoom - 1) * crane.value) * Math.pow(1 + lensZoomOf(), (home ? homeLens : lensZoomNow()) * crane.value);
  view.zoom = view.targetZoom = z;
  view.cx = view.targetCx = view.cy = view.targetCy = 0.5;
  if (home) {
    const px = TELESCOPE.homeBlur * Math.pow(Math.sin(Math.PI * crane.value), 0.6) * viewport.h / 1000;
    const streak = TELESCOPE.homeMotionBlur * panSpeed() * viewport.h / 1000;
    motionBlur.setAttribute('stdDeviation', `0 ${streak.toFixed(2)}`);
    canvas.style.filter = !crane.active ? '' : [streak > 0.1 ? 'url(#homeMotion)' : '', px > 0.05 ? `blur(${px.toFixed(2)}px)` : ''].join(' ').trim();
  }
  if (crane.active) requestAnimationFrame(() => zoomWithPan(home));
  else last.t = 0;
}
// Motion blur on the way down: an up-down-only blur (SVG filter on the canvas), as long as the camera is fast. panSpeed =
// how fast the crane moves now, 0 … 1 (1 = the eased pan's top speed: the cubic ease peaks at 3× the average).
const motionBlur = (() => {
  document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute"><filter id="homeMotion" x="0" y="-5%" width="100%" height="110%"><feGaussianBlur stdDeviation="0 0" edgeMode="duplicate"/></filter></svg>');
  return document.querySelector('#homeMotion feGaussianBlur');
})();
const last = { t: 0, v: 0, s: 0 };
function panSpeed() {
  const t = performance.now() / 1000, v = crane.value;
  if (last.t) {
    const dt = t - last.t;
    if (dt > 0) last.s = Math.min(1, Math.abs(v - last.v) / dt * CRANE_DURATION / 3);
  } else last.s = 0;
  last.t = t; last.v = v;
  return last.s;
}
// Back on the roof: the vignette, the round lens and the star chart fade out together.
async function fadeHome() {
  const sec = TELESCOPE.homeOpenSec, t0 = performance.now();
  openEyepiece(sec);
  holdChart(false);
  for (let k = 0; k < 1 && !crane.active;) {   // (a new look-up already: the pan up takes the vignette over)
    await new Promise(requestAnimationFrame);
    k = Math.min(1, (performance.now() - t0) / 1000 / sec);
    setVignetteProgress(1 - k * k * (3 - 2 * k));
  }
}

// In the sky: the Return button.
function showReturn(on) {
  btnReturn.classList.toggle('show', on); btnReturn.tabIndex = on ? 0 : -1;
}

async function lookUp() {
  if (!['rooftop', 'toDoor'].includes(game.mode)) return;   // repeated taps ignored; switching from the greenhouse is fine
  game.mode = 'approach';
  scope.hover = false; canvas.style.cursor = '';
  flashTelescope();
  const [sx, sy] = TELESCOPE.stand;
  const arrived = await walkTo(sx, sy);
  if (!arrived || game.mode !== 'approach') return;   // the player walked somewhere else

  game.mode = 'toSky';
  pickSkyColor();                          // (none of the sky's color shows from the roof, so the scheme changes unseen)
  walker.facing = 1;                       // the eyepiece is to the character's right
  walker.leanTarget = 1;
  await sleep(TELESCOPE.leanSec * 1000);
  tiltTube(true);
  await sleep(TELESCOPE.tiltSec * 500);
  // After the game's first constellation every look-up starts with a search: the scope is set to where the search
  // sets off before the camera moves (the aim only counts as far as the crane has panned up, so nothing jumps), and the
  // round eyepiece closes in at once. The pan up and the lift into the search are then one swift move.
  const pre = lookUpAim();
  if (pre) {
    Object.assign(aim, { pitch: pre.pitch, yaw: pre.yaw, active: false, from: { ...pre }, to: { ...pre } });
    closeEyepiece();
  }
  panTo(1);
  zoomWithPan();
  await until(() => !crane.active);
  zoomWithPan();
  game.mode = 'sky';
  showReturn(canLeaveSky());   // the first look-up plays the whole first tier, then pans down by itself
}

async function returnToRooftop() {
  if (game.mode !== 'sky') return;
  game.mode = 'toRooftop';
  showReturn(false);
  setCloseUp(false); setFlyZoom(false);
  // The star chart (the waiting circles too) and the search's round lens stay until the camera is back on the roof
  // (fadeHome). The view keeps the search's zoom as far as it has it now (homeLens; else it was the star's little zoom).
  holdChart(true);
  homeLens = lensZoomOf() ? THREE.MathUtils.clamp(Math.log(view.zoom / TELESCOPE.zoom) / Math.log(1 + lensZoomOf()), 0, 1) : 0;
  for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);   // the sky winds down first (stops a search's swings)
  closeEyepiece();   // (the lens closes in if it was open: after the sky has let the search go, cancelSearch)
  // Turned round, the scope first turns home the short way round, still up in the sky (TELESCOPE.homeCentre); then
  // it pans down facing the roof, so the city doesn't swing round as it comes into view.
  aim.yaw = wrapPi(aim.yaw);
  const HC = TELESCOPE.homeCentre, off = Math.abs(aim.yaw);
  if (off > THREE.MathUtils.degToRad(HC.minDeg)) {
    aimTo(aim.pitch, 0, Math.max(HC.minSec, off / THREE.MathUtils.degToRad(HC.degPerSec)));
    await until(() => !aim.active);
  }
  aimTo(0, 0, CRANE_DURATION);
  panTo(0);
  zoomWithPan(true);
  tiltTube(false);
  await until(() => !crane.active);
  zoomWithPan(true);
  fadeHome();   // (alongside the lean back)
  walker.leanTarget = 0;
  await sleep(TELESCOPE.leanSec * 1000);
  game.mode = 'rooftop';
}

// Tap a full net: walk under it, then its stars float down into the satchel.
async function collectFromNet(i) {
  if (!['rooftop', 'toNet'].includes(game.mode)) return;
  if (satchelFull()) { refuseNet(i); return; }   // no room in the satchel: the net flashes instead (stronger each try)
  game.mode = 'toNet';
  setNetHover(-1); flashNet(i);
  const arrived = await walkTo(...COLLECT.netStand[i]);
  if (!arrived || game.mode !== 'toNet') return;   // the player walked somewhere else
  game.mode = 'collecting';
  await pickFromNet(i);
  game.mode = 'rooftop';
}

async function goIntoGreenhouse() {
  if (!['rooftop', 'approach'].includes(game.mode)) return;   // repeated taps ignored; switching from the telescope is fine
  game.mode = 'toDoor';
  house.hover = false; canvas.style.cursor = '';
  const arrived = await approachGreenhouse();
  if (!arrived || game.mode !== 'toDoor') return;   // the player walked somewhere else
  game.mode = 'entering';
  await enterGreenhouse();
  game.mode = 'greenhouse';
  sayNothingToGrow(leaveTheGreenhouse);   // no stars at all yet: the character says so, with a way back (speechBubble.js)
}

async function leaveTheGreenhouse() {
  if (game.mode !== 'greenhouse' || house.growing) return;   // the plant's reveal plays to the end
  if (house.trapped && !house.plantInPot) return;             // first time: not before the first plant has grown
  if (house.plantInPot) { window.dispatchEvent(new Event('carryplant')); return; }   // the grown plant comes along (planting.js; then 'plantcarried')
  game.mode = 'leaving';
  hushBubble();
  await leaveGreenhouse();
  game.mode = 'rooftop';
}

// Tap the waiting plant: it takes root on its spot (roofGarden.js settlePlant).
async function plantTheFlower() {
  const spot = waitingSpot();
  if (!spot || !['rooftop', 'approach', 'toDoor', 'toNet', 'toPlant'].includes(game.mode)) return;
  // The character stops and turns to the plant, and stretches with quiet joy as the plant breathes in, unless the player
  // has walked it off by then: the moment never holds the character.
  game.mode = 'rooftop';
  walkTo(walker.x, walker.y);
  walker.facing = spot.x >= walker.x ? 1 : -1;
  sleep(ROOF_GARDEN.root.cheerAt * 1000).then(() => { if (game.mode === 'rooftop' && !walker.moving) cheer(); });
  await settlePlant();
  planted();   // first time: the sky opens again after a moment to admire it
}

// planting.js: the grown plant was lifted out of the pot. It appears on the roof while we leave the greenhouse.
window.addEventListener('plantcarried', e => {
  bringOutPlant(e.detail);
  leaveTheGreenhouse();
});

btnReturn.addEventListener('click', returnToRooftop);
// Dev roof (for testing): straight back down, even while the sky isn't done (no waiting for canLeaveSky); shown in the sky.
$('btnDevRoof').addEventListener('click', returnToRooftop);
setInterval(() => document.body.classList.toggle('in-sky', game.mode === 'sky'), 200);
// constellation.js: time to look at the nets. Back down, then the character looks up at them.
window.addEventListener('skyrest', async () => { await returnToRooftop(); if (game.mode === 'rooftop') startLinger(); });
$('btnLeaveGreenhouse').addEventListener('click', leaveTheGreenhouse);
window.addEventListener('keydown', e => {
  if ((e.key === 'c' || e.key === 'C') && game.mode === 'sky' && !e.target.closest?.('input, select, textarea')) setChartOn(!chart.on);
  if ((e.key === 'v' || e.key === 'V') && game.mode === 'sky' && !e.target.closest?.('input, select, textarea')) setChartBrush(!chart.brush);
  if (e.key !== 'Escape' || document.body.classList.contains('book-open')) return;   // (Esc closes the star book first: starBook.js)
  if (game.mode === 'sky' && canLeaveSky()) returnToRooftop();
  else if (game.mode === 'greenhouse') leaveTheGreenhouse();
});

// Sky view (skyView.js, index.html?sky): straight up into the sky after Play, no rise from below, no walk; the eyepiece
// closes for the search (constellation.js starts it, as on a look-up).
function startSkyView() {
  rise.value = 0; rise.active = false;
  Object.assign(crane, { value: 1, from: 1, to: 1, active: false });
  closeEyepiece();
  zoomWithPan();
  game.mode = 'sky';
  showReturn(false);
}

export { game, lookUp, returnToRooftop, goIntoGreenhouse, leaveTheGreenhouse, startSkyView };
