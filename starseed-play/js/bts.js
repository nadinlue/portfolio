// Behind the Scenes: the layers fan out as cards to show how the scene is built.
// `dome`: the sky dome material, which turns into a dark studio backdrop.
import * as THREE from 'three';
import { $, easeInOut } from './util.js';
import { BTS_CARD_COUNT, LAYER_PARALLAX, BTS_CARD_W, BTS_CENTER, BTS_DEMO, BTS_DURATION, BTS_EXTRA_GAP, BTS_LOOK_OFFSET, BTS_PITCH, BTS_RADIUS, BTS_STEP, BTS_YAW, DEPTH } from './config.js';
import { camera, scene, viewport } from './core.js';
import { animated } from './effects.js';
import { saveResetRow, savedValue } from './settingsStore.js';

const bts = { dome: null, t: 0, target: 0, e: 0, yaw: BTS_YAW, pitch: BTS_PITCH, radius: BTS_RADIUS,
  targetYaw: BTS_YAW, targetPitch: BTS_PITCH, targetRadius: BTS_RADIUS };
const cards = [];

// A dark backing sheet and an outline make each (mostly transparent) layer read as a card.
// `extra`: more parallax items shown on the same card (the midground props, the effects near its depth). Each is
// fitted to the card by its own frame, a little in front of or behind it by its depth (at most BTS_EXTRA_GAP).
// `key`: the LAYER_PARALLAX entry that holds the default of the card's parallax slider.
function addCard(item, key, slotIndex, title, desc, extra = []) {
  const { w, h, depth } = item, order = item.obj.renderOrder;
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: 0x0a1430, transparent: true, opacity: 0, depthWrite: false }));
  backing.position.z = -depth;
  backing.renderOrder = order - 0.4;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => new THREE.Vector3(x * w / 2, y * h / 2, -depth));
  const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners),
    new THREE.LineBasicMaterial({ color: 0xb8c6ee, transparent: true, opacity: 0, depthWrite: false }));
  border.renderOrder = order + 0.4;
  item.group.add(backing, border);

  const el = document.createElement('div');
  el.className = 'bts-label';
  el.innerHTML = `<b><i>${BTS_CARD_COUNT - slotIndex}</i>${title}<em title="Screen speed relative to the foreground"></em>` +
    `<label class="bts-knob" title="Parallax strength of this layer: how fast it slides when the camera moves. ` +
    `100% = what its depth gives, 0% = stuck to the screen">Parallax <input type="range" id="parallax-${key}" ` +
    `min="0" max="3" step="0.05" value="${LAYER_PARALLAX[key]}"><output></output></label></b><span>${desc}</span>`;
  $('btsLabels').appendChild(el);

  const off = slotIndex - (BTS_CARD_COUNT - 1) / 2;
  const slot = new THREE.Vector3(BTS_CENTER.x + off * BTS_STEP.x, BTS_CENTER.y + off * BTS_STEP.y, BTS_CENTER.z - off * BTS_STEP.z);
  const card = { item, extra, backing, border, el, slot, slotIndex, scale: BTS_CARD_W / w, speed: 1 };
  cards.push(card);

  const input = el.querySelector('input'), out = el.querySelector('output');
  const saved = savedValue(input.id);
  if (saved !== undefined) input.value = saved;
  input.addEventListener('input', () => {
    for (const x of [item, ...extra]) x.strength = Number(input.value);
    out.textContent = `${Math.round(input.value * 100)}%`;
    updateSpeeds();
  });
  input.dispatchEvent(new Event('input'));
}

// Screen speed of each card relative to the foreground card (front slot): strength / depth.
function updateSpeeds() {
  const front = cards.find(c => c.slotIndex === 0) || cards[0];
  const ref = front.item.strength / front.item.depth;
  for (const c of cards) {
    c.speed = ref ? c.item.strength / c.item.depth / ref : 0;
    c.el.querySelector('em').textContent = `${Math.round(c.speed * 100)}% speed`;
  }
}

// Save / Reset for the card sliders, at the end of the Behind the Scenes panel.
function addCardButtons() {
  $('btsPanel').appendChild(saveResetRow('parallax', cards.map(c => c.el.querySelector('input'))));
}

function updateBts(dt, now, k) {
  bts.t = THREE.MathUtils.clamp(bts.t + Math.sign(bts.target - bts.t) * dt / BTS_DURATION, 0, 1);
  const e = bts.e = easeInOut(bts.t);
  bts.yaw += (bts.targetYaw - bts.yaw) * k;
  bts.pitch += (bts.targetPitch - bts.pitch) * k;
  bts.radius += (bts.targetRadius - bts.radius) * k;

  // Effects on a card stay; the others (outside every card) fade out. Found once per visit, as it opens.
  if (e > 0 && !onCards) onCards = cardMaterials();
  else if (e === 0) onCards = null;
  for (const c of cards) {
    const { group, depth, obj, ex } = c.item;
    // Move the layer's frame center from (0,0,-depth) to its card slot while shrinking it to card size.
    const sc = Math.pow(c.scale, e);
    // Parallax demo: near cards slide further (BTS_DEMO for the foreground at full strength).
    const demo = Math.sin(now * 0.9) * BTS_DEMO * c.item.strength * DEPTH.foreground / depth * e;
    group.scale.setScalar(sc);
    group.position.set(e * (c.slot.x + demo), e * c.slot.y, (1 - e) * -depth + e * c.slot.z + sc * depth);
    for (const x of c.extra) {
      // its own frame onto the card; point clouds (fireflies, motes) flattened onto its plane
      const xs = Math.pow(BTS_CARD_W / x.w, e), fz = 1 - 0.9 * e;
      const gap = THREE.MathUtils.clamp((x.depth - depth) * c.scale, -BTS_EXTRA_GAP, BTS_EXTRA_GAP);
      x.group.scale.set(xs, xs, xs * fz);
      x.group.position.set(group.position.x, group.position.y, (1 - e) * -x.depth + e * (c.slot.z - gap) + xs * fz * x.depth);
    }
    c.backing.material.opacity = 0.22 * e;
    c.border.material.opacity = 0.7 * e;
    for (const x of [c.item, ...c.extra]) {   // fog, street glow: hide what lies outside the card
      const crop = x.obj.material?.uniforms?.uCrop;
      if (crop && typeof crop.value === 'number') crop.value = e;
    }
    if (ex) {
      // Crop the mirrored margin so the card shows exactly the painted artwork.
      const kx = 1 + 2 * ex, crop = THREE.MathUtils.lerp(1, 1 / kx, e);
      obj.scale.x *= crop;
      obj.material.map.repeat.x = crop;
      obj.material.map.offset.x = e * ex / kx;
    }
  }
  for (const m of animated) m.uniforms.uFade.value = onCards?.has(m) ? 1 : 1 - e;
  if (bts.dome) bts.dome.uniforms.uStudio.value = e;
}

// Fading materials (effects.js animated) that lie on a card, unless marked to fade anyway (userData.btsFade).
let onCards = null;
function cardMaterials() {
  const found = new Set();
  for (const c of cards) for (const x of [c.item, ...c.extra]) x.group.traverse(o => {
    for (const m of [o.material].flat()) if (m?.uniforms?.uFade && !m.userData.btsFade) found.add(m);
  });
  return found;
}

const _rig = new THREE.PerspectiveCamera(), _btsPos = new THREE.Vector3(), _v = new THREE.Vector3();

function blendBtsCamera() {
  const e = bts.e;
  if (e <= 0) return;
  const cp = Math.cos(bts.pitch);
  _btsPos.set(
    BTS_CENTER.x + bts.radius * Math.sin(bts.yaw) * cp,
    BTS_CENTER.y + bts.radius * Math.sin(bts.pitch),
    BTS_CENTER.z + bts.radius * Math.cos(bts.yaw) * cp);
  _rig.position.copy(_btsPos);
  _rig.lookAt(_v.copy(BTS_CENTER).add(BTS_LOOK_OFFSET));
  camera.position.lerp(_btsPos, e);
  camera.quaternion.slerp(_rig.quaternion, e);
}

// Pin each label to the top-left corner of its card.
function updateLabels() {
  const show = THREE.MathUtils.clamp((bts.e - 0.7) / 0.3, 0, 1);
  if (show > 0) { scene.updateMatrixWorld(); camera.updateMatrixWorld(); }
  const W = viewport.w, H = viewport.h;
  for (const c of cards) {
    c.el.style.opacity = show;
    c.el.style.pointerEvents = show > 0.5 ? 'auto' : 'none';   // the slider only works once the card is shown
    if (!show) continue;
    _v.set(-c.item.w / 2, c.item.h / 2, -c.item.depth);
    c.item.group.localToWorld(_v).project(camera);
    c.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * W}px, ${(0.5 - _v.y * 0.5) * H}px) translate(0, calc(-100% - 6px))`;
  }
}

export { bts, cards, addCard, addCardButtons, updateBts, blendBtsCamera, updateLabels };
