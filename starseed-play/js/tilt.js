// Tilt parallax for phones and tablets: tilting the screen is like looking through a window from a little to one side,
// so the layers slide against each other. Only the change counts: the rest pose slowly follows however the device is
// held, so any comfortable angle becomes the middle. Used by rig.js (roof), greenhouse.js and startScreen.js.
// Android only sends the sensor to https pages (or localhost); iPhone also asks for permission, on the Play tap.
// No three.js here (the start screen must not wait for the CDN), so its tuning (TILT) lives here, not in config.js.
const TILT = {
  range: 0.22,      // tilt away from the rest pose (sine of the angle, about 13°) that gives 3/4 of the full effect
  recenter: 5,      // seconds: how slowly the rest pose follows the way the device is held
  smooth: 0.25,     // seconds: the roof camera's follow time constant (the other screens ease in their own way)
  roof: [0.6, 0.6], // roof camera at full tilt (x, y), share of the room the foreground's spare artwork leaves
  start: 0.5,       // start screen at full tilt, in its pointer's scale (0.5 = the pointer at the screen's edge)
};

// x > 0: the view moves right, y > 0: up (-1 … 1, soft at the ends). Zero on devices without the sensor.
const tilt = { x: 0, y: 0 };

const RAD = Math.PI / 180;
let restX = 0, restY = 0, lastT = -Infinity, lastAngle = null;

function onOrientation(e) {
  if (e.beta === null || e.gamma === null) return;   // no sensor behind it (some desktops send one empty event)
  // Which way is up, seen from the device. Unlike beta and gamma themselves it has no jump when a phone held in
  // landscape passes upright (gamma wraps at ±90° there).
  const b = e.beta * RAD, g = e.gamma * RAD;
  const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b);
  // ... and from the screen, which may be turned on the device
  const angle = (screen.orientation?.angle ?? window.orientation ?? 0) * RAD;
  const sx = ux * Math.cos(angle) - uy * Math.sin(angle), sy = ux * Math.sin(angle) + uy * Math.cos(angle);
  const now = e.timeStamp / 1000, dt = now - lastT;
  lastT = now;
  if (angle !== lastAngle || dt > 1) {   // first reading, the screen just turned, or back from a pause: start from here
    restX = sx; restY = sy; lastAngle = angle;
  } else {
    const k = 1 - Math.exp(-dt / TILT.recenter);
    restX += (sx - restX) * k;
    restY += (sy - restY) * k;
  }
  tilt.x = Math.tanh((sx - restX) / TILT.range);
  tilt.y = Math.tanh((restY - sy) / TILT.range);
}

window.addEventListener('deviceorientation', onOrientation);
// iPhone: nothing arrives until the player has allowed it, and only a tap may ask.
if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission)
  document.getElementById('btnPlay')?.addEventListener('click', () => DeviceOrientationEvent.requestPermission().catch(() => {}));

export { tilt, TILT };
