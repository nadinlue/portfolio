// Character walking: walkTo() sends the character to a floor spot, around obstacles (A* on a grid).
// Clicks are routed here by modes.js.
// Positions are composition pixels; the walked distance treats screen height as foreshortened depth.
import * as THREE from 'three';
import { ART_H, ART_W, CHAR_FOOT_PAD, CHAR_SHADOW, CHAR_RECT, CHAR_WALK, CHAR_CHEER, CHAR_LEAVES, CHAR_LEAF_FLICK, DEPTH, DEPTH_SORTED, TELESCOPE, WALK } from './config.js';
import { camera, frameAt, stage } from './core.js';
import { layers } from './layers.js';
import { character, PROP_BEHIND, PROP_IN_FRONT, shadowTexture } from './scene.js';

const START = { x: CHAR_RECT.x + CHAR_RECT.w / 2, y: CHAR_RECT.y + CHAR_RECT.h * (1 - CHAR_FOOT_PAD) };
// lean: 0 = upright, 1 = bent towards the telescope eyepiece (eased towards leanTarget).
// opacity: 1 = visible (fades out when stepping into the greenhouse).
// cycle: walk-cycle progress in full strides (restarts from frame 0 at each new walk).
const walker = { x: START.x, y: START.y, path: [], facing: 1, moving: false, phase: 0, cycle: 0, lean: 0, leanTarget: 0, opacity: 1,
  reach: 0, reachTarget: 0, cheer: 1, leafFlick: 1 };   // reach: stretching up on tiptoe (taking stars out of a net); cheer: 0..1 through a happy stretch
let onCheered = null;
let onArrive = null;   // resolves the promise of the current walkTo()

// Character size at a floor row, relative to its starting size.
const perspective = y => (y - WALK.horizonY) / (START.y - WALK.horizonY);

// ---------------------------------------------------------------------------
// Walkable grid
// ---------------------------------------------------------------------------
function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const obstacles = Object.values(WALK.obstacles);
const isWalkable = (x, y) => inPolygon(x, y, WALK.area) && !obstacles.some(p => inPolygon(x, y, p));

const xs = WALK.area.map(p => p[0]), ys = WALK.area.map(p => p[1]);
const grid = { x0: Math.min(...xs), y0: Math.min(...ys), c: WALK.cell };
grid.cols = Math.ceil((Math.max(...xs) - grid.x0) / grid.c);
grid.rows = Math.ceil((Math.max(...ys) - grid.y0) / grid.c);
const cellX = i => grid.x0 + (i % grid.cols + 0.5) * grid.c;
const cellY = i => grid.y0 + (Math.floor(i / grid.cols) + 0.5) * grid.c;
const open = new Uint8Array(grid.cols * grid.rows).map((_, i) => isWalkable(cellX(i), cellY(i)) ? 1 : 0);

// Walking distance: vertical screen pixels count extra because the floor recedes.
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, (by - ay) * WALK.depthStretch);

function nearestOpenCell(x, y) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < open.length; i++) {
    if (!open[i]) continue;
    const d = dist(x, y, cellX(i), cellY(i));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Straight walk possible? Samples the segment at a quarter-cell spacing.
function clearLine(ax, ay, bx, by) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / (grid.c / 4));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (!isWalkable(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

// A* over the grid (8 neighbours), then shortcut to the farthest directly reachable waypoint.
function findPath(fx, fy, tx, ty) {
  const start = nearestOpenCell(fx, fy), goal = nearestOpenCell(tx, ty);
  if (start < 0 || goal < 0) return [];
  const goalPt = isWalkable(tx, ty) ? [tx, ty] : [cellX(goal), cellY(goal)];
  if (clearLine(fx, fy, goalPt[0], goalPt[1])) return [goalPt];

  const g = new Float64Array(open.length).fill(Infinity), from = new Int32Array(open.length).fill(-1);
  const closed = new Uint8Array(open.length), queue = [start];
  g[start] = 0;
  const h = i => dist(cellX(i), cellY(i), cellX(goal), cellY(goal));
  while (queue.length) {
    let qi = 0;
    for (let k = 1; k < queue.length; k++) if (g[queue[k]] + h(queue[k]) < g[queue[qi]] + h(queue[qi])) qi = k;
    const cur = queue.splice(qi, 1)[0];
    if (cur === goal) break;
    closed[cur] = 1;
    const cx = cur % grid.cols, cy = Math.floor(cur / grid.cols);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      const n = ny * grid.cols + nx;
      if (!open[n] || closed[n]) continue;
      const cost = g[cur] + dist(cellX(cur), cellY(cur), cellX(n), cellY(n));
      if (cost < g[n]) { if (g[n] === Infinity) queue.push(n); g[n] = cost; from[n] = cur; }
    }
  }
  if (from[goal] < 0 && goal !== start) return [];
  const cells = [];
  for (let i = goal; i !== start && i >= 0; i = from[i]) cells.unshift([cellX(i), cellY(i)]);
  cells[cells.length - 1] = goalPt;

  const path = [];
  let px = fx, py = fy, k = 0;
  while (k < cells.length) {
    let far = k;
    for (let j = cells.length - 1; j > k; j--) if (clearLine(px, py, cells[j][0], cells[j][1])) { far = j; break; }
    path.push(cells[far]);
    [px, py] = cells[far];
    k = far + 1;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Click on the floor
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

// Screen click → composition pixel on the midground (the painted floor), following pan/dolly/shake.
function clickToArt(e) {
  const r = stage.getBoundingClientRect(), mid = layers.midground.obj;
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  floorPlane.constant = -mid.position.z;
  if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
  const s = mid.scale.y, item = layers.midground;
  return { x: ((hit.x - mid.position.x) / s / item.w + 0.5) * ART_W, y: (0.5 - (hit.y - mid.position.y) / s / item.h) * ART_H };
}

// Is a composition point on (or just above) the floor, rather than sky or buildings?
const onFloor = p => p.y >= grid.y0 - grid.c * 2;

// Walk to a floor spot. Resolves true on arrival, false if another walkTo() replaced this one.
function walkTo(x, y) {
  onArrive?.(false);
  walker.path = findPath(walker.x, walker.y, x, y);
  if (!walker.path.length) { onArrive = null; return Promise.resolve(true); }
  return new Promise(resolve => { onArrive = resolve; });
}

// Walk in a straight line, ignoring the walkable floor (e.g. through the greenhouse door).
function walkDirect(x, y) {
  onArrive?.(false);
  walker.path = [[x, y]];
  return new Promise(resolve => { onArrive = resolve; });
}

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------
// Before updateCamera: advance along the path and place the character's base position.
function updateWalk(dt) {
  const ch = layers.character;
  if (!ch) return;
  walker.moving = walker.path.length > 0;
  const stride = CHAR_WALK.stride * CHAR_WALK.height * CHAR_RECT.h * perspective(walker.y);   // px per cycle here
  let budget = WALK.speed * perspective(walker.y) * dt;
  const step = budget;
  while (budget > 0 && walker.path.length) {
    const [tx, ty] = walker.path[0];
    const d = dist(walker.x, walker.y, tx, ty);
    if (Math.abs(tx - walker.x) > 2) walker.facing = Math.sign(tx - walker.x);
    if (d <= budget) {
      walker.x = tx; walker.y = ty; walker.path.shift(); budget -= d;
      if (!walker.path.length && onArrive) { const done = onArrive; onArrive = null; done(true); }
      continue;
    }
    walker.x += (tx - walker.x) * budget / d;
    walker.y += (ty - walker.y) * budget / d;
    budget = 0;
  }
  walker.phase = walker.moving ? walker.phase + dt * WALK.stepRate * Math.PI : 0;
  walker.cycle = walker.moving ? walker.cycle + (step - budget) / stride : 0;
  const leanStep = dt / TELESCOPE.leanSec;
  walker.lean = THREE.MathUtils.clamp(walker.lean + Math.sign(walker.leanTarget - walker.lean) * leanStep, 0, 1);
  walker.reach += (walker.reachTarget - walker.reach) * Math.min(1, dt * 6);
  walker.leafFlick = Math.min(1, walker.leafFlick + dt / CHAR_LEAF_FLICK.sec);
  if (walker.cheer < 1 && (walker.cheer = Math.min(1, walker.cheer + dt / CHAR_CHEER.sec)) >= 1 && onCheered) { const done = onCheered; onCheered = null; done(); }

  // The mesh origin is the sprite's bottom edge, a little below the boots.
  const f = frameAt(DEPTH.character), bottom = walker.y + CHAR_RECT.h * CHAR_FOOT_PAD * perspective(walker.y);
  ch.base.set((walker.x / ART_W - 0.5) * f.w, (0.5 - bottom / ART_H) * f.h, ch.base.z);
  ch.foot = { x: walker.x, y: walker.y };
}

// After updateCamera (which resets scale and position): perspective size, facing, step bounce.
function poseWalker() {
  if (!character) return;
  const walkSprite = character.userData.walkSprite, bob = walkSprite ? CHAR_WALK.bob : 1;
  const s = perspective(walker.y), hop = walker.moving ? Math.abs(Math.sin(walker.phase)) * bob : 0;
  const h = CHAR_RECT.h / ART_H * frameAt(DEPTH.character).h;
  character.scale.x *= s * walker.facing;
  // Leaning in: tilt towards the facing side around the feet and bend (squash) slightly.
  const lean = THREE.MathUtils.smoothstep(walker.lean, 0, 1);
  const base = character.scale.y * s;   // the scale without the bend / tiptoe stretch
  character.scale.y *= s * (1 - 0.05 * lean);
  let lift = hop * WALK.hop * h * character.scale.y;
  // Reaching up: on tiptoe and a little taller.
  character.scale.y *= 1 + 0.06 * walker.reach;
  lift += walker.reach * 0.03 * h * character.scale.y;
  // Cheering (CHAR_CHEER): a subtle stretch up, a touch onto tiptoe, while the hat's leaves sway; plus their idle sway.
  let leafDeg = CHAR_LEAVES.idleDeg * Math.sin(performance.now() / 1000 * 2 * Math.PI / CHAR_LEAVES.idleSec);
  if (walker.cheer < 1) {
    const C = CHAR_CHEER, t = walker.cheer, sm = THREE.MathUtils.smoothstep, env = sm(t, 0, 0.3) * (1 - sm(t, 0.65, 1));
    character.scale.y *= 1 + C.stretch * env;
    character.scale.x *= 1 - C.stretch * 0.4 * env;
    lift += C.rise * env * h * base;
    leafDeg += C.leafDeg * Math.sin(2 * Math.PI * C.swings * t) * Math.sin(Math.PI * t);
  }
  if (walker.leafFlick < 1) {   // a star just dropped into the bag: a quick flick that settles (CHAR_LEAF_FLICK)
    const F = CHAR_LEAF_FLICK, t = walker.leafFlick;
    leafDeg += F.deg * Math.sin(2 * Math.PI * F.swings * t) * Math.pow(1 - t, 2);
  }
  const leaves = character.userData.leaves;
  if (leaves) { leaves.rotation.z = THREE.MathUtils.degToRad(leafDeg); leaves.visible = !walker.moving; }
  character.position.y += lift;
  // Walking: hide the standing sprite and show the current sheet cell instead.
  if (walkSprite) {
    walkSprite.visible = walker.moving;
    character.material.visible = !walker.moving;
    if (walker.moving) {
      const i = Math.floor(walker.cycle * CHAR_WALK.frames) % CHAR_WALK.frames;
      walkSprite.material.map.offset.set((i % CHAR_WALK.cols) / CHAR_WALK.cols, 1 - (Math.floor(i / CHAR_WALK.cols) + 1) / CHAR_WALK.rows);
    }
  }
  character.material.opacity = walker.opacity;
  character.traverse(c => { if (c !== character && c.material) c.material.opacity = walker.opacity; });
  character.visible = walker.opacity > 0.001;
  character.rotation.z = (walker.moving ? Math.sin(walker.phase) * WALK.sway * bob : 0)
    - walker.facing * lean * THREE.MathUtils.degToRad(TELESCOPE.leanDeg);
  poseShadow(base, lift);
  // Props whose foot line is nearer the camera than the character's feet are drawn in front of it.
  for (const prop of DEPTH_SORTED) {
    const order = walker.y < prop.footY ? PROP_IN_FRONT : PROP_BEHIND;
    (prop.parts || [prop.mesh]).forEach((m, i) => { if (m) m.renderOrder = order + i * 0.01; });
  }
}

// Blob shadow: undo the character's tilt, bend and lift so it stays flat on the floor under the feet.
const _off = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
function poseShadow(base, lift) {
  const sh = character.userData.shadow;
  if (!sh) return;
  const { w, h } = character.userData.size, r = character.rotation.z, sx = character.scale.x, sy = character.scale.y;
  sh.material.opacity = walker.opacity * CHAR_SHADOW.opacity;
  sh.material.color.set(CHAR_SHADOW.color);
  if (sh.userData.softness !== CHAR_SHADOW.softness) shadowTexture(sh.userData.softness = CHAR_SHADOW.softness, sh.material.map);
  // Where the shadow should sit, from the character's origin in its parent's space (unrotated, unlifted) ...
  _off.set(CHAR_SHADOW.offsetX * w * base, (CHAR_FOOT_PAD * h + CHAR_SHADOW.offsetY * w) * base - lift, -0.001);
  // ... brought into the character's local space (inverse rotation, then inverse scale).
  _off.applyAxisAngle(_z, -r);
  sh.position.set(_off.x / sx, _off.y / sy, -0.001);
  sh.rotation.z = -walker.facing * r;   // the mirrored scale.x flips the rotation's sense
  sh.scale.set(w * CHAR_SHADOW.width, w * CHAR_SHADOW.height * base / sy, 1);
}

// A happy little stretch in place, the hat's leaves swaying (CHAR_CHEER); resolves when done.
function cheer() {
  walker.cheer = 0;
  onCheered?.();
  return new Promise(done => { onCheered = done; });
}

export { walker, cheer, findPath, isWalkable, clickToArt, onFloor, walkTo, walkDirect, updateWalk, poseWalker };
