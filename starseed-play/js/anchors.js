// Gameplay anchors and their dev-only markers (A1).
import * as THREE from 'three';
import { ANCHORS, ANCHOR_COLOR, ART_H, ART_W, DEPTH, SKY_FIELD } from './config.js';
import { makeTexture } from './core.js';
import { layerAttach, layers } from './layers.js';

const anchorMarkers = [];
const ANCHOR_TEX = 256, ANCHOR_RING = 80, ANCHOR_RING_Y = 100;   // ring radius and center height in texture px

// Dashed ring with a label underneath, or just the label when ring = false.
function anchorTexture(label, ring = true) {
  const c = document.createElement('canvas'); c.width = c.height = ANCHOR_TEX;
  const g = c.getContext('2d');
  g.strokeStyle = g.fillStyle = ANCHOR_COLOR;
  if (ring) {
    g.lineWidth = 6; g.setLineDash([14, 10]);
    g.beginPath(); g.arc(ANCHOR_TEX / 2, ANCHOR_RING_Y, ANCHOR_RING, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.beginPath(); g.arc(ANCHOR_TEX / 2, ANCHOR_RING_Y, 6, 0, Math.PI * 2); g.fill();
  }
  g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center';
  g.shadowColor = '#000'; g.shadowBlur = 6;
  g.fillText(label, ANCHOR_TEX / 2, ring ? 222 : ANCHOR_TEX / 2);
  return makeTexture(c);
}

function markerMaterial(map) {
  return new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false });
}

// Ring marker attached to its layer's mesh, so it follows the layer's slide, dolly and BTS card.
function addAnchorMarker(a) {
  const item = layers[a.layer];
  const s = a.r / ANCHOR_RING;                                   // composition px per texture px
  const size = ANCHOR_TEX * s / ART_W * item.w;
  // `point` is the anchor itself; the marker hangs off it so the ring center sits on the anchor.
  const point = new THREE.Object3D();
  point.position.set((a.x / ART_W - 0.5) * item.w, (0.5 - a.y / ART_H) * item.h, 0.01);
  layerAttach(item).add(point);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), markerMaterial(anchorTexture(a.label)));
  mesh.position.y = -(ANCHOR_TEX / 2 - ANCHOR_RING_Y) * s / ART_H * item.h;
  mesh.renderOrder = 9;
  point.add(mesh);
  a.point = point;
  anchorMarkers.push(mesh);
}

// Sky field outline on the sky layer: a point at azimuth `az`, elevation `el` (degrees) hits the
// sky plane at x = d·tan(az), y = d·tan(el)/cos(az).
function skyFieldPoint(az, el, d) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return new THREE.Vector3(d * Math.tan(a), d * Math.tan(e) / Math.cos(a), 0.5);
}

function addSkyFieldMarker() {
  const { elMin, elMax, azMax } = SKY_FIELD, d = DEPTH.sky, pts = [], N = 24;
  for (let i = 0; i <= N; i++) pts.push(skyFieldPoint(-azMax + 2 * azMax * i / N, elMax, d));
  for (let i = 0; i <= N; i++) pts.push(skyFieldPoint(azMax, elMax - (elMax - elMin) * i / N, d));
  for (let i = 0; i <= N; i++) pts.push(skyFieldPoint(azMax - 2 * azMax * i / N, elMin, d));
  for (let i = 0; i <= N; i++) pts.push(skyFieldPoint(-azMax, elMin + (elMax - elMin) * i / N, d));
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: ANCHOR_COLOR, dashSize: 2.5, gapSize: 1.5, depthTest: false, transparent: true }));
  line.computeLineDistances();
  line.renderOrder = 9;
  const size = 0.18 * layers.sky.w;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(size, size), markerMaterial(anchorTexture('Constellation field', false)));
  label.position.copy(skyFieldPoint(0, elMax, d)).add(new THREE.Vector3(0, -0.06 * size, 0));
  label.renderOrder = 9;
  for (const m of [line, label]) { layerAttach(layers.sky).add(m); anchorMarkers.push(m); }
  SKY_FIELD.marker = line;
}

function addAnchors() {
  for (const a of [ANCHORS.stargaze, ...ANCHORS.nets]) addAnchorMarker(a);
  addSkyFieldMarker();
  showAnchors(document.body.classList.contains('dev'));
}

function showAnchors(on) { for (const m of anchorMarkers) m.visible = on; }

// World position of an anchor right now (follows parallax, dolly and Pan Up).
function anchorWorld(a, out = new THREE.Vector3()) { return a.point.getWorldPosition(out); }

export { anchorMarkers, ANCHOR_TEX, ANCHOR_RING, ANCHOR_RING_Y, anchorTexture, markerMaterial, addAnchorMarker, skyFieldPoint, addSkyFieldMarker, addAnchors, showAnchors, anchorWorld };
