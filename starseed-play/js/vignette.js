// Telescope eyepiece vignette for the star view. Its look (strength, roundness, softness) comes from
// Settings → Telescope view; modes.js drives how far it's faded in (0 on the roof, 1 in the sky).
import { $ } from './util.js';
import { viewport } from './core.js';
import { TELESCOPE } from './config.js';

const el = $('vignette');
const look = { on: true, strength: 1, roundness: 0, softness: 0.48 };   // on: false = no eyepiece look at all (Settings → Telescope view)
const PREVIEW_MS = 1500;   // while tuning on the rooftop, show the vignette this long after a slider moves
let progress = 0, previewUntil = 0, lens = 0;

function paint() {
  const w = viewport.w, h = viewport.h, L = TELESCOPE.search, k = lens;
  // While searching (lens 0 … 1) the eyepiece closes in to a round lens with a firmer rim and a faint glassy edge.
  const roundness = look.roundness + (1 - look.roundness) * k, softness = look.softness * (1 - L.lensSoften * k);
  const strength = look.strength * (1 + 0.4 * k);
  // Oval following the 16:9 view (roundness 0) to a circle (roundness 1).
  const ry = 0.8 * h * (1 - L.lensSize * k), rx = 0.72 * w + (ry - 0.72 * w) * roundness;
  // Softness: where the darkening starts, as a share of the radius (1 = from the center, 0 = hard ring).
  const start = (1 - softness) * 100, at = f => `${(start + (100 - start) * f).toFixed(1)}%`;
  // Strength scales the darkness of each ring (0..2; above 1 the rim goes towards solid black).
  const a = v => Math.min(1, v * strength).toFixed(3);
  const shape = `ellipse ${rx.toFixed(0)}px ${ry.toFixed(0)}px at 50% 50%`;
  const dark = `radial-gradient(${shape}, ` +
    `rgba(0,2,12,0) ${start.toFixed(1)}%, rgba(0,2,12,${a(0.45)}) ${at(0.46)}, rgba(0,2,12,${a(0.85)}) ${at(0.83)}, rgba(0,2,12,${a(0.95)}) 100%)`;
  const rim = k > 0.01 ? `radial-gradient(${shape}, rgba(150,180,255,0) ${at(0.26)}, rgba(150,180,255,${(L.lensRim * k).toFixed(3)}) ${at(0.36)}, ` +
    `rgba(150,180,255,0) ${at(0.5)}), ` : '';
  el.style.background = rim + dark;
  el.style.opacity = !look.on ? 0 : performance.now() < previewUntil ? 1 : progress;
}

// Where the eyepiece's clear view ends, in CSS px from the stage's centre (x, y radii; the vignette is fixed in the
// stage, which is its frame): a rim hint sits there (dragSearch.js). `at` = how far into the darkening ring (0 = its inner edge).
// With the eyepiece off, the clear view is the whole screen (a little in from its edges).
function lensRim(at = 0.3) {
  const w = viewport.w, h = viewport.h, L = TELESCOPE.search, k = lens;
  if (!look.on) return { x: 0.46 * w, y: 0.44 * h };
  const roundness = look.roundness + (1 - look.roundness) * k, softness = look.softness * (1 - L.lensSoften * k);
  const ry = 0.8 * h * (1 - L.lensSize * k), rx = 0.72 * w + (ry - 0.72 * w) * roundness, start = 1 - softness;
  const f = start + (1 - start) * at;
  return { x: rx * f, y: ry * f };
}

// The search's eyepiece (scopeSearch.js): 0 = the normal view, 1 = closed in to a round lens.
function setVignetteLens(l) { if (l !== lens) { lens = l; paint(); } }

// How far the vignette is faded in, 0..1 (follows the pan up / down).
function setVignetteProgress(p) { progress = p; paint(); }

// Change one look value; `preview` shows it for a moment even on the rooftop.
function setVignetteLook(key, value, preview = false) {
  look[key] = value;
  if (preview) { previewUntil = performance.now() + PREVIEW_MS; setTimeout(paint, PREVIEW_MS + 50); }
  paint();
}

// Is the eyepiece look on? Off: no vignette, no round lens, and the search adds no zoom of its own (lensZoomOf).
const eyepieceOn = () => look.on;
const lensZoomOf = () => (look.on ? TELESCOPE.search.lensZoom : 0);

window.addEventListener('resize', () => requestAnimationFrame(paint));   // after main.js has resized the stage

export { setVignetteProgress, setVignetteLook, setVignetteLens, lensRim, eyepieceOn, lensZoomOf };
