// The telescope (A2): the tube is cut out of the image so it can tilt up; hover/tap highlight,
// a starlight glint on the lens, and the tap hit test.
import * as THREE from 'three';
import { ART_H, ART_W, DEPTH_SORTED, TELESCOPE } from './config.js';
import { makeTexture } from './core.js';
import { enableRowScroll, layerAttach, layerPoint, layers } from './layers.js';
import { haloTexture } from './netStars.js';

// tilt/glint: 0..1, eased towards their targets. hover: pointer over the telescope. flash: tap feedback.
// idleOk: the telescope could be used now (collect.js); idle: seconds since the telescope was last tapped (other
// taps don't count; it only counts while idleOk); idleT: the soft highlight it then fades in and out once (-1: none).
const scope = { tilt: 0, tiltTarget: 0, glint: 0, glintT: -1, hover: false, flash: 0, pivot: null, mats: [], mask: null,
  idleOk: false, idle: 0, idleT: -1 };
// A tap on the telescope starts the wait over (modes.js).
const tappedTelescope = () => { scope.idle = 0; scope.idleT = -1; };
const MASK_SCALE = 4;   // the hit-test mask is the image's alpha at 1/4 resolution

// Telescope image with the tube kept (keepTube) or cut away.
function cutTube(img, keepTube) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = keepTube ? 'destination-in' : 'destination-out';
  g.beginPath();
  TELESCOPE.tube.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath(); g.fill();
  return c;
}

// Called by the scene build after the depth-sorted props exist.
function buildTelescope(img) {
  const prop = DEPTH_SORTED.find(p => p.image === TELESCOPE.image), item = layers.midground;
  const stand = prop.mesh;
  stand.material.map.dispose();
  stand.material.map = makeTexture(cutTube(img, false));

  // The tube hangs off a pivot at the mount knob, so rotating the pivot tilts it.
  const [px, py] = TELESCOPE.pivot;
  scope.pivot = new THREE.Group();
  scope.pivot.position.copy(layerPoint(item, px, py, stand.position.z + 0.001));
  layerAttach(item).add(scope.pivot);
  const tubeMat = new THREE.MeshBasicMaterial({ map: makeTexture(cutTube(img, true)), transparent: true, depthWrite: false });
  enableRowScroll(tubeMat);
  const tube = new THREE.Mesh(stand.geometry, tubeMat);
  const p0 = layerPoint(item, px, py);
  tube.position.set(-p0.x, -p0.y, 0);
  scope.pivot.add(tube);

  // Lens glint: a soft additive glow at the objective, riding on the tube.
  const k = item.w / ART_W, [ox, oy] = TELESCOPE.objective, o = layerPoint(item, ox, oy);
  const glint = new THREE.Mesh(new THREE.PlaneGeometry(TELESCOPE.glintSize * k, TELESCOPE.glintSize * k),
    new THREE.MeshBasicMaterial({ map: haloTexture(), color: '#cfe8ff', transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending }));
  glint.position.set(o.x - p0.x, o.y - p0.y, 0.001);
  scope.pivot.add(glint);
  scope.glintMesh = glint;

  prop.parts = [stand, tube, glint];
  scope.mats = [stand.material, tubeMat];

  // Alpha mask for tap hit tests.
  const W = Math.ceil(img.width / MASK_SCALE), H = Math.ceil(img.height / MASK_SCALE);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  scope.mask = { W, H, a: g.getImageData(0, 0, W, H).data };
}

// Is a composition point on the telescope (within hitPad)?
function hitTelescope(p) {
  if (!scope.mask) return false;
  const { W, H, a } = scope.mask, r = Math.ceil(TELESCOPE.hitPad / MASK_SCALE);
  const cx = Math.round(p.x / MASK_SCALE), cy = Math.round(p.y / MASK_SCALE);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (x >= 0 && y >= 0 && x < W && y < H && a[(y * W + x) * 4 + 3] > 100) return true;
  }
  return false;
}

const tiltTube = up => { scope.tiltTarget = up ? 1 : 0; if (up) scope.glintT = 0; };
const flashTelescope = () => { scope.flash = 1; };

function updateTelescope(dt) {
  if (!scope.pivot) return;
  scope.tilt = THREE.MathUtils.clamp(scope.tilt + Math.sign(scope.tiltTarget - scope.tilt) * dt / TELESCOPE.tiltSec, 0, 1);
  scope.pivot.rotation.z = THREE.MathUtils.smoothstep(scope.tilt, 0, 1) * THREE.MathUtils.degToRad(TELESCOPE.tiltDeg);
  // Glint: rises while the tube tilts, then fades (about 1.6 s in total).
  if (scope.glintT >= 0) {
    scope.glintT += dt;
    const t = scope.glintT / 1.6;
    scope.glintMesh.material.opacity = t < 1 ? Math.sin(Math.PI * t) * 0.9 : 0;
    scope.glintMesh.scale.setScalar(0.6 + 0.6 * Math.sin(Math.PI * Math.min(t, 1)));
    if (t >= 1) scope.glintT = -1;
  }
  scope.flash = Math.max(0, scope.flash - dt * 2.5);
  // The telescope not tapped for a while: a soft highlight, like the hover's but stronger, pulsing in and out
  // (TELESCOPE.idlePulses times). While it can't be used (walking, off the roof, locked) the wait pauses and a highlight stops.
  if (!scope.idleOk) scope.idleT = -1;
  else if (scope.idleT >= 0) {
    scope.idleT += dt;
    if (scope.idleT >= TELESCOPE.idleSec * TELESCOPE.idlePulses) { scope.idleT = -1; scope.idle = 0; }
  } else if ((scope.idle += dt) >= TELESCOPE.idleAfter) scope.idleT = 0;
  const idleLight = scope.idleT >= 0 ? Math.sin(Math.PI * scope.idleT / TELESCOPE.idleSec) ** 2 : 0;   // (one pulse per idleSec)
  const bright = 1 + Math.max(scope.hover ? TELESCOPE.hover : 0, idleLight * TELESCOPE.idleLight) + scope.flash * TELESCOPE.flash;
  for (const m of scope.mats) m.color.setScalar(bright);
}

export { scope, buildTelescope, hitTelescope, tiltTube, flashTelescope, tappedTelescope, updateTelescope };
