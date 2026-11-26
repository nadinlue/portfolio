// Stars in the nets (A4): the nets start empty; each collected star (starRecords.js) waits until its
// flight from the sky lands (delivery.js calls landStar), then sits in its element's net with a small
// pop and a flare of light. A star that isn't landed within a while appears anyway.
// Stars in a net breathe softly; takeStar() lifts one out again (collect.js, into the satchel).
// Each star: sprite drawn behind the net ropes (a patch of the poles art redrawn on top) plus a glow
// (Settings → Star glows). Several stars in one net spread along its sag (NETS[i].slots).
import * as THREE from 'three';
import { ART_H, ART_W, COLLECT, GLOW_SPREAD, NETS, NET_HALO_R, NET_ROPE_PATCH, NET_STAR, STAR_FAMILIES } from './config.js';
import { addGlows, glowMats, updateGlowViewport } from './effects.js';
import { makeTexture } from './core.js';
import { layerAttach, layerPoint, layers } from './layers.js';
import { onStarCollected, starsInNet } from './starRecords.js';
import { lightCharms, updateCharms } from './netCharms.js';

function haloTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');      // bright bloom around the star
  grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.3)');  // pale disc
  grad.addColorStop(0.9, 'rgba(255,255,255,0.24)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return makeTexture(c);
}

let imgs = null, poles = null;
const textures = {};
const landing = [];        // stars still popping in: { star, glow, t, size }
const views = new Map();   // record → { star, ropes, glow, base, phase, pulse }
const pending = [];        // records waiting for their landing time: { record, t }

function buildNets(images, polesImage) {
  imgs = images; poles = polesImage;
  for (const [key, fam] of Object.entries(STAR_FAMILIES)) textures[key] = makeTexture(imgs[fam.image]);
}

// Where a record's star sits: the first free slot of its net (NETS[i].slots) in composition px, its order in
// the net and its size. When every slot is taken, stars reuse them with a small jitter.
function slotFor(record) {
  if (record.slot) return record.slot;
  const net = NETS[record.netIndex], others = starsInNet(record.netIndex).filter(r => r !== record && r.slot);
  const n = others.length, taken = new Set(others.map(r => r.slot.k));
  let k = net.slots.findIndex((s, i) => !taken.has(i));
  const full = k < 0;
  if (full) k = n % net.slots.length;
  const [x, y] = net.slots[k], jitter = () => (full ? (Math.random() - 0.5) * 40 : 0);
  return (record.slot = { x: x + jitter(), y: y + jitter(), n, k, size: NET_STAR.size * (n === 0 ? 1 : 0.82) });
}

// World position and world size of a record's star in its net (for the flight to aim at).
function netTarget(record) {
  const item = layers.poles, { x, y, size } = slotFor(record), attach = layerAttach(item);
  attach.updateMatrixWorld();
  const pos = attach.localToWorld(layerPoint(item, x, y, 0.006));
  const scale = new THREE.Vector3(); attach.getWorldScale(scale);
  return { pos, size: size * item.w / ART_W * scale.x };
}

// Place one record's star in its net; `from` = its starting scale for the pop (small when it flew in).
function showStar(record, from = 0.001) {
  const item = layers.poles, k = item.w / ART_W;
  const { x, y, n, size: px } = slotFor(record), size = px * k;
  const plane = (s, mat, order, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat);
    m.renderOrder = order; m.position.copy(pos);
    layerAttach(item).add(m);
    return m;
  };
  const basic = map => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
  const star = plane(size, basic(textures[record.type]), 5.4, layerPoint(item, x, y, 0.006 + n * 0.0001));
  star.rotation.z = THREE.MathUtils.degToRad((Math.random() - 0.5) * 30);
  star.scale.setScalar(from);
  // The ropes in front of the star: the poles art around it, redrawn on top.
  const P = NET_ROPE_PATCH, c = document.createElement('canvas'); c.width = c.height = P * 2;
  c.getContext('2d').drawImage(poles, x - P, y - P, P * 2, P * 2, 0, 0, P * 2, P * 2);
  const ropes = plane(P * 2 * k, basic(makeTexture(c)), 5.5, layerPoint(item, x, y, 0.008 + n * 0.0001));
  // Its light, in front of the ropes so the net is lit too. Colors used raw, like the glow pickers.
  const color = new THREE.Color().setStyle(STAR_FAMILIES[record.type].star, THREE.LinearSRGBColorSpace);
  const glow = addGlows(item, [{ u: x / ART_W, v: (y - 12) / ART_H, r: NET_HALO_R * (n === 0 ? 1.4 : 1) / (GLOW_SPREAD * ART_W), color }],
    { order: 5.55, intensity: 0, speed: 0.5, group: 'stars' });
  updateGlowViewport();   // the new glow needs the screen height like the others
  const base = (n === 0 ? 1 : NET_STAR.extraGlow) * NET_STAR.glow;   // extra stars add less light
  const view = { star, ropes, glow, base, phase: Math.random() * 6.28, pulse: 0, landed: false };
  views.set(record, view);
  landing.push({ view, star, glow, t: 0, from, base });
}

// Lift a star out of its net: its sprite, rope patch and glow go away; returns where it was (world
// position and size) and its texture, so it can float on from there.
function takeStar(record) {
  const v = views.get(record);
  if (!v) return null;
  views.delete(record);
  const i = landing.findIndex(l => l.view === v);
  if (i >= 0) landing.splice(i, 1);
  const pos = v.star.getWorldPosition(new THREE.Vector3()), scale = new THREE.Vector3();
  v.star.getWorldScale(scale);
  const size = v.star.geometry.parameters.width * scale.x, rot = v.star.rotation.z;
  for (const m of [v.star, v.ropes, v.glow]) {
    m.removeFromParent(); m.geometry.dispose();
    if (m.material.map && m !== v.star) m.material.map.dispose();
    m.material.dispose();
  }
  const g = glowMats.indexOf(v.glow.material);
  if (g >= 0) glowMats.splice(g, 1);
  return { pos, size, rot, texture: textures[record.type] };
}

// A soft brightening of every star in net i (when the net hums).
function pulseNet(i) {
  for (const [record, v] of views) if (record.netIndex === i) v.pulse = 1;
}

// The stars currently shown in nets, with their sprites (collect.js lets sparkles rise from them).
const netViews = () => views;

const LAND_FALLBACK = 30;  // seconds: a collected star whose flight never lands shows up anyway
onStarCollected(record => pending.push({ record, t: LAND_FALLBACK }));

// The flight has arrived (or was cut short): the star appears in its net.
function landStar(record, from = 0.001) {
  const i = pending.findIndex(p => p.record === record);
  if (i < 0) return;
  pending.splice(i, 1);
  showStar(record, from);
}

// Per frame: land waiting stars, animate the pop.
// Hover highlight: each net (NETS[i].outline, without its pole) cut out of the poles art as an overlay
// that adds its own colors on top while the pointer is over it, like the telescope brightening. Additive,
// so the stars' glow on the ropes stays and the net can only get brighter.
const lit = { hover: -1, meshes: null, amt: NETS.map(() => 0), flash: NETS.map(() => 0) };
function buildHighlights() {
  const item = layers.poles, k = item.w / ART_W;
  lit.meshes = NETS.map(net => {
    // Padded by the feather so the blurred mask fades out over the pole instead of ending in a hard cut.
    const f = COLLECT.netFeather, xs = net.outline.map(p => p[0]), ys = net.outline.map(p => p[1]);
    const x0 = Math.min(...xs) - f, y0 = Math.min(...ys) - f, w = Math.max(...xs) - x0 + f, h = Math.max(...ys) - y0 + f;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(poles, x0, y0, w, h, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.filter = `blur(${f / 3}px)`;
    g.beginPath(); net.outline.forEach(([x, y], i) => (i ? g.lineTo(x - x0, y - y0) : g.moveTo(x - x0, y - y0)));
    g.closePath(); g.fill();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w * k, h * k),
      new THREE.MeshBasicMaterial({ map: makeTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.renderOrder = 5.6; m.visible = false;                       // over the stars, like the rope patches
    m.position.copy(layerPoint(item, x0 + w / 2, y0 + h / 2, 0.0095));
    layerAttach(item).add(m);
    return m;
  });
}
// Is art point p on net i (its outline, padded by `pad` px)? Taps and hover use it: the big nets are no circles.
function onNet(p, i, pad = 30) {
  const o = NETS[i].outline;
  let inside = false;
  for (let a = 0, b = o.length - 1; a < o.length; b = a++) {
    const [xa, ya] = o[a], [xb, yb] = o[b];
    if ((ya > p.y) !== (yb > p.y) && p.x < xa + (p.y - ya) * (xb - xa) / (yb - ya)) inside = !inside;
  }
  if (inside || !pad) return inside;
  for (let a = 0, b = o.length - 1; a < o.length; b = a++) {   // near an edge counts too (forgiving taps)
    const [xa, ya] = o[a], [xb, yb] = o[b], dx = xb - xa, dy = yb - ya;
    const t = Math.max(0, Math.min(1, ((p.x - xa) * dx + (p.y - ya) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(p.x - xa - t * dx, p.y - ya - t * dy) < pad) return true;
  }
  return false;
}
const setNetHover = i => { lit.hover = i; };
const flashNet = (i, k = 1) => { if (i >= 0) lit.flash[i] = Math.max(lit.flash[i], k); };   // k > 1: brighter (a tap on a net the satchel can't take)
function updateHighlights(dt) {
  if (!lit.meshes) { if (!layers.poles || !poles) return; buildHighlights(); }
  lit.meshes.forEach((m, i) => {
    lit.amt[i] += ((lit.hover === i ? 1 : 0) - lit.amt[i]) * Math.min(1, dt * 10);
    lit.flash[i] = Math.max(0, lit.flash[i] - dt * 2.5 * Math.max(1, lit.flash[i]));   // (a stronger flash fades as quickly)
    const hover = starsInNet(i).length ? COLLECT.netHover : COLLECT.netHoverEmpty;
    const add = hover * lit.amt[i] + COLLECT.netFlash * lit.flash[i];
    m.visible = add > 0.002;
    m.material.color.setScalar(add);
    lightCharms(i, add);
  });
}

function updateNetStars(dt) {
  updateHighlights(dt);
  updateCharms(dt);
  for (let i = pending.length - 1; i >= 0; i--) {
    if ((pending[i].t -= dt) > 0) continue;
    showStar(pending[i].record);
    pending.splice(i, 1);
  }
  for (let i = landing.length - 1; i >= 0; i--) {
    const l = landing[i];
    l.t = Math.min(1, l.t + dt / NET_STAR.arrivalSec);
    const t = l.t, back = 1.7;                                   // ease-out-back: a small overshoot
    const e = 1 + (back + 1) * Math.pow(t - 1, 3) + back * Math.pow(t - 1, 2);
    l.star.scale.setScalar(Math.max(0.001, l.from + (1 - l.from) * e));
    l.glow.material.uniforms.uIntensity.value = l.base * (1 + 1.5 * Math.sin(Math.PI * t));
    if (t >= 1) { l.view.landed = true; landing.splice(i, 1); }
  }
  // Settled stars breathe: their light swells gently, and a hum makes it swell a bit more.
  clock += dt;
  for (const v of views.values()) {
    if (!v.landed) continue;
    v.pulse = Math.max(0, v.pulse - dt / 1.6);
    const breathe = 1 + NET_STAR.breathe * Math.sin(clock * 1.5 + v.phase) + NET_STAR.humPulse * Math.sin(Math.PI * v.pulse);
    v.glow.material.uniforms.uIntensity.value = v.base * breathe;
    v.star.scale.setScalar(1 + 0.04 * Math.sin(clock * 1.5 + v.phase) + 0.12 * Math.sin(Math.PI * v.pulse));
  }
}
let clock = 0;

const familyTexture = type => textures[type];

export { onNet, setNetHover, flashNet, haloTexture, buildNets, updateNetStars, landStar, netTarget, familyTexture, takeStar, pulseNet, netViews };
