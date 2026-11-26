// Mouse, wheel and keyboard input for the dev camera modes.
// Wheel on window (not just the canvas) so Ctrl+wheel never falls through to browser zoom.
import * as THREE from 'three';
import { $ } from './util.js';
import { DOLLY_SENS, MAX_PITCH, MAX_YAW, ORBIT_SENS, PAN_SENS, ZOOM_SENS } from './config.js';
import { renderer, stage } from './core.js';
import { dolly, orbit, pan, panTo, resetZoom, zoomAt } from './rig.js';
import { bts } from './bts.js';
import { btnDev, leaveBts, mode, recenter, setMode, toggleMode } from './ui.js';
import { startScreenUp } from './startScreen.js';

window.addEventListener('wheel', e => {
  e.preventDefault();
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  if (mode === 'bts') bts.targetRadius = THREE.MathUtils.clamp(bts.targetRadius * Math.exp(dy * 0.001), 22, 70);
  else if (e.ctrlKey) dolly.target = THREE.MathUtils.clamp(dolly.target - dy * DOLLY_SENS, 0, 1);
  else {
    const r = stage.getBoundingClientRect();
    zoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, Math.exp(-dy * ZOOM_SENS));
  }
}, { passive: false });

const canvas = renderer.domElement;
let drag = null;
canvas.addEventListener('pointerdown', e => {
  if (mode === 'none') return;
  drag = { x: e.clientX, y: e.clientY, yaw: orbit.targetYaw, pitch: orbit.targetPitch, px: pan.targetX, py: pan.targetY,
    by: bts.targetYaw, bp: bts.targetPitch };
  canvas.setPointerCapture(e.pointerId);
  document.body.classList.add('dragging');
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  if (mode === 'bts') {
    bts.targetYaw = THREE.MathUtils.clamp(drag.by - (e.clientX - drag.x) * 0.005, -1.3, 1.3);
    bts.targetPitch = THREE.MathUtils.clamp(drag.bp + (e.clientY - drag.y) * 0.004, -0.5, 0.9);
    return;
  }
  if (mode === 'pan') {
    // Same feel as Orbit: background follows the drag horizontally, opposes it vertically.
    pan.targetX = THREE.MathUtils.clamp(drag.px - (e.clientX - drag.x) * PAN_SENS, -1, 1);
    pan.targetY = THREE.MathUtils.clamp(drag.py - (e.clientY - drag.y) * PAN_SENS, -1, 1);
    return;
  }
  orbit.targetYaw = THREE.MathUtils.clamp(drag.yaw - (e.clientX - drag.x) * ORBIT_SENS, -MAX_YAW, MAX_YAW);
  orbit.targetPitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * ORBIT_SENS, -MAX_PITCH, MAX_PITCH);
});
const endDrag = () => { drag = null; document.body.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', () => { recenter(); resetZoom(); });

window.addEventListener('keydown', e => {
  if (startScreenUp()) return;                         // Enter / Space belong to the Play button then
  if (e.target.closest?.('input, select')) return;   // arrow keys on a slider move the slider, not the camera
  if (e.key === 'o' || e.key === 'O') toggleMode('orbit');
  else if (e.key === 'p' || e.key === 'P') toggleMode('pan');
  else if (e.key === 'b' || e.key === 'B') toggleMode('bts');
  else if (e.key === 'f' || e.key === 'F') $('btnRise').click();
  else if (e.key === 'm' || e.key === 'M') btnDev.click();
  else if (e.key === 'ArrowUp') { leaveBts(); panTo(1); }
  else if (e.key === 'ArrowDown') { leaveBts(); panTo(0); }
  else if (e.key === 'r' || e.key === 'R') { setMode('none'); panTo(0); resetZoom(); }
});
