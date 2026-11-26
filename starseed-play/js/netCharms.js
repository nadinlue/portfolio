// The little charms hanging under the nets (beads, moon, star, rings: NET_CHARMS.strings in config.js). Each string
// is cut out of the poles art (like the telescope tube) and hangs from its knot, so it can swing: a soft damped
// pendulum, longer strings slower. Collecting stars from a net sets its charms dangling (collect.js → swingCharms);
// they share the net's hover highlight (netStars.js → lightCharms).
import * as THREE from 'three';
import { ART_W, NET_CHARMS } from './config.js';
import { makeTexture } from './core.js';
import { layerAttach, layerPoint, layers } from './layers.js';

const charms = [];   // { net, pivot (group), mat, angle, vel, omega }

// Cut the strings out of the poles art: the poles layer gets the art without them (also returned, for the rope
// patches and highlights in netStars.js, so no still copy of a charm shows), each string its own hanging plane.
function buildCharms(polesImg) {
  const item = layers.poles, k = item.w / ART_W, C = NET_CHARMS;
  const bare = document.createElement('canvas'); bare.width = polesImg.width; bare.height = polesImg.height;
  const g = bare.getContext('2d');
  g.drawImage(polesImg, 0, 0);
  C.strings.forEach((list, net) => list.forEach(({ box: [x0, y0, x1, y1], pivot: [px, py] }) => {
    const w = x1 - x0, h = y1 - y0, c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(polesImg, x0, y0, w, h, 0, 0, w, h);
    g.clearRect(x0, y0, w, h);
    const mat = new THREE.MeshBasicMaterial({ map: makeTexture(c), transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * k, h * k), mat);
    mesh.position.set((x0 + w / 2 - px) * k, -(y0 + h / 2 - py) * k, 0);
    const pivot = new THREE.Group();
    pivot.position.copy(layerPoint(item, px, py, 0.001));
    pivot.add(mesh);
    mesh.renderOrder = item.obj.renderOrder + 0.005;
    layerAttach(item).add(pivot);
    const len = Math.max(20, y1 - py) / 100;   // length in 100s of art px: a pendulum's speed goes with 1 / √length
    charms.push({ net, pivot, mat, angle: 0, vel: 0, omega: 2 * Math.PI * C.freq / Math.sqrt(len) });
  }));
  const old = item.obj.material.map;
  item.obj.material.map = makeTexture(bare);
  old?.dispose();
  return bare;
}

// Set a net's charms dangling: each gets a push of about `strength` × NET_CHARMS.kickDeg, either way, a little varied.
function swingCharms(net, strength = 1) {
  for (const c of charms) if (c.net === net) {
    const push = THREE.MathUtils.degToRad(NET_CHARMS.kickDeg) * strength * (0.7 + 0.6 * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
    c.vel += push * c.omega;   // as fast as a swing of that size passes the middle
  }
}

// The net's hover / tap highlight on its charms too (add = light added, as on the net).
function lightCharms(net, add) {
  for (const c of charms) if (c.net === net) c.mat.color.setScalar(1 + add);
}

// Per frame: damped pendulums (sub-stepped, so a long frame can't blow them up).
function updateCharms(dt) {
  const z = NET_CHARMS.damping, max = THREE.MathUtils.degToRad(NET_CHARMS.maxDeg);
  for (const c of charms) {
    if (!c.vel && !c.angle) continue;
    const n = Math.ceil(Math.min(dt, 0.1) / 0.008), h = Math.min(dt, 0.1) / n;
    for (let i = 0; i < n; i++) {
      c.vel += (-c.omega * c.omega * c.angle - 2 * z * c.omega * c.vel) * h;
      c.angle = THREE.MathUtils.clamp(c.angle + c.vel * h, -max, max);
    }
    if (Math.abs(c.angle) < 1e-4 && Math.abs(c.vel) < 1e-3) c.angle = c.vel = 0;
    c.pivot.rotation.z = c.angle;
  }
}

export { buildCharms, swingCharms, lightCharms, updateCharms };
