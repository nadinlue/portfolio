// Renderer, scene, camera and texture helpers.
import * as THREE from 'three';
import { ART_ASPECT, FIT_FOV } from './config.js';
import { BUILD } from './build.js';

const renderer = new THREE.WebGLRenderer({ antialias: !BUILD.mobile });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, BUILD.pixelRatio ?? 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const stage = document.getElementById('stage');
stage.appendChild(renderer.domElement);
const viewport = { w: 1, h: 1 };   // stage size in CSS px (always 16:9)

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FIT_FOV, 1, 0.1, 1000);
const TAN_FIT = Math.tan(THREE.MathUtils.degToRad(FIT_FOV / 2));
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// Size of the full composition when placed at distance d.
const frameAt = d => { const h = 2 * d * TAN_FIT; return { w: h * ART_ASPECT, h }; };

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Mobile build (BUILD.maxTexture): art bigger than that goes to the GPU as a scaled-down copy. The texture keeps
// the copy; a later `needsUpdate = true` (a redrawn canvas) redraws the copy from the full-size source first.
function shrunk(source) {
  const max = BUILD.maxTexture, w = source.width, h = source.height;
  if (!max || Math.max(w, h) <= max) return null;
  const k = max / Math.max(w, h), c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const redraw = () => { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.drawImage(source, 0, 0, c.width, c.height); };
  redraw();
  return { canvas: c, redraw };
}

function makeTexture(source, mirror = false) {
  const small = shrunk(source);
  const t = small ? new THREE.CanvasTexture(small.canvas)
    : source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  if (small) {
    const set = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate').set;
    Object.defineProperty(t, 'needsUpdate', { set(v) { if (v) small.redraw(); set.call(this, v); } });
  }
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  if (mirror) t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Screen-space point sprites (sky stars, star dust, motes) are sized in px of a 1080 px tall view and scale
// with the game view, so they shrink and grow with the browser window like everything else. Set by
// updateGlowViewport (effects.js) on every resize: drawing-buffer height / 1080.
const pointScale = { value: 1 };

export { pointScale, renderer, stage, viewport, scene, camera, TAN_FIT, maxAniso, frameAt, loadImage, makeTexture };
