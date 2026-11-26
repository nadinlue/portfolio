// Start screen, which is also the loading screen. index.html runs this module first (before the big
// assets.js), so the art shows right away:
//   1. the layers (sky, city, logo, flowers from Assets/startscreen) fade in once decoded, drifting a little
//      with the pointer like a parallax postcard; a loading swirl spins where the Play button will be
//   2. when the game has loaded, main.js calls gameReady(): the swirl fades and the Play button appears
//   3. Play fades the screen out and resolves gameReady(), and main.js starts the intro rise. The click is
//      also the browser's "user gesture", so the background music (music.js) can start with it.
// No three.js here (it must not wait for the CDN), so its tuning (START) lives here, not in config.js.
import { tilt, TILT } from './tilt.js';

const START = {
  artTimeout: 3000,           // ms: show the art even if an image is still missing by then
  artFade: 700,               // ms: the art fades in (keep in sync with .start-layer in style.css)
  drift: [1.6, 1.0],          // % of the screen a depth-1 layer moves with the pointer (x, y)
  follow: 0.05,               // how quickly the layers follow the pointer (per frame)
  idle: 0.12,                 // slow breathing drift without pointer movement (fraction of `drift`)
};

const el = document.getElementById('startscreen');
const btn = document.getElementById('btnPlay');
const layers = [...el.querySelectorAll('.start-layer')].map(node => ({ node, depth: Number(node.dataset.depth) || 0 }));
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let up = true;

// 1. Art in when every layer image is decoded (or after a timeout, so a slow image never blocks the screen).
const images = [...el.querySelectorAll('.start-layer > img')];
// `artShown` resolves once it has fully faded in: index.html only then runs the big assets.js, whose parsing
// freezes the page for a few seconds (otherwise the screen would stay black or half faded until it is done).
const artShown = Promise.race([
  Promise.all(images.map(img => img.decode().catch(() => {}))),
  new Promise(r => setTimeout(r, START.artTimeout)),
]).then(() => {
  el.classList.add('art');
  return new Promise(r => setTimeout(r, START.artFade + 50));   // fully faded in (a fade can't run while the page is frozen)
});

// Parallax: the pointer's place on the screen, -0.5 … 0.5, eased.
let tx = 0, ty = 0, cx = 0, cy = 0;
el.addEventListener('pointermove', e => {
  const r = el.getBoundingClientRect();
  tx = (e.clientX - r.left) / r.width - 0.5;
  ty = (e.clientY - r.top) / r.height - 0.5;
});
function frame(ms) {
  if (!up) return;
  const t = ms / 1000;
  cx += (tx + tilt.x * TILT.start + START.idle * Math.sin(t * 0.21) - cx) * START.follow;
  cy += (ty - tilt.y * TILT.start + START.idle * Math.sin(t * 0.17 + 1) - cy) * START.follow;
  for (const { node, depth } of layers) {
    node.style.transform = `scale(1.04) translate(${(-cx * depth * START.drift[0]).toFixed(3)}%, ${(-cy * depth * START.drift[1]).toFixed(3)}%)`;
  }
  requestAnimationFrame(frame);
}
if (!still) requestAnimationFrame(frame);

// 2 + 3. The game is loaded: offer Play; resolves when it is pressed (the screen is fading out by then).
function gameReady() {
  el.classList.add('ready');
  btn.disabled = false;
  btn.focus({ preventScroll: true });                            // Enter / Space work too
  return new Promise(resolve => btn.addEventListener('click', () => {
    btn.disabled = true;
    el.classList.add('gone');
    up = false;
    setTimeout(() => { el.hidden = true; }, 1000);               // after the fade: out of the way entirely
    resolve();
  }, { once: true }));
}

// Loading failed: say so where the swirl was.
function startScreenError(message) {
  const p = document.createElement('p');
  p.className = 'start-error'; p.textContent = message;
  el.querySelector('.start-wait').replaceChildren(p);
}

// True while the start screen is showing (the game's keyboard shortcuts wait until it is gone).
const startScreenUp = () => up;

export { artShown, gameReady, startScreenError, startScreenUp, START };
