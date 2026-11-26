// Constellations (A3): an echo game in the sky. After the pan up a constellation wakes up (stars fade in
// one by one, lines draw in faintly), then its stars brighten one after another to a soft chime melody.
// The player taps the same order; each right tap lights the star for good and sings its note. A tap on
// the wrong star never resets anything: the next star just glows as a hint.
// Melodies grow over the game: first an even beat with every star once, then rhythm (long notes, quick
// pairs), then longer melodies that come back to a star. Tapping in the melody's rhythm is optional: a
// tap whose gap matches the melody's gap sparkles extra, off-rhythm taps count just the same.
// When the melody is complete the constellation plays it once more and shows its name; exactly one star
// record is created. Then the stars glide along the lines into the brightest star (a rising note for
// each arrival), the collected star pops out there and flies down to its net (delivery.js). After it
// has landed the player searches the sky by hand for the next one (dragSearch.js): the constellations still waiting
// in this tier (rows of four in zodiac order, one of each element, CONSTELLATION_TIER) wait at their own spots, each
// a glimmer in its element's color in the middle of its own circle on the star chart; the scope settles onto the one
// the player steers to, the lens zooms the chart until that circle fits, and the constellation appears in it. TELESCOPE.drag.on = false: the telescope searches by itself instead, in zodiac order.
// The first look-up plays the whole first tier (from Aries), then the camera pans down to the nets by itself.
// Shapes and melodies in CONSTELLATIONS, look in CONSTELLATION_STYLE, rhythm and forgiveness in CONSTELLATION_PLAY.
import * as THREE from 'three';
import { ART_W, CRANE_DURATION, CONSTELLATIONS, CONSTELLATION_PLAY, CONSTELLATION_STYLE, CONSTELLATION_TIER, SKY_TRIP_TIERS, DEPTH, SKY_DOME, STAR_CHART, STAR_DELIVERY, STAR_FAMILIES, TELESCOPE } from './config.js';
import { camera, renderer, stage, viewport } from './core.js';
import { layerAttach, layers } from './layers.js';
import { meteorCalm, nodeStarTexture } from './stars.js';
import { skyFieldPoint } from './anchors.js';
import { mode as devMode } from './ui.js';
import { bts } from './bts.js';
import { until, wrapPi } from './util.js';
import { skyView, SKY_VIEW } from './skyView.js';
import { eyepieceOn, lensRim } from './vignette.js';
import { aim, aimFlyZoom, aimTo, aimView, crane, focusNdc, setCloseUp, setFlyZoom, view, withoutCloseUp } from './rig.js';
import { chime, shimmer, thud } from './chime.js';
import { setMusicDuck, untilNextBeat } from './music.js';
import { collectStar } from './starRecords.js';
import { landStar, netTarget } from './netStars.js';
import { planArc, delivery, finishDelivery, novaLook, novaMaterial, startDelivery, fallProgress, turnProgress, anglesOf } from './delivery.js';
import { cancelSearch, closeEyepiece, search, settleSearch, startFreeSearch, startSearch, updateSearch } from './scopeSearch.js';
import { buildStarChart, chart, chartClash, chartHooks, chartMiddle, chartTilt, chartZoomed, chooseSpotFrame, dropSpotFrames, fitChartFrame, pulseChart, searchStarChart, spotChartFrames, updateStarChart } from './starChart.js';
import { beginDrag, drag, dragRange, endDrag, placeSpots, spotRange, updateDrag } from './dragSearch.js';

const all = [];            // built constellations: { def, group, nodes, lines, offsets, steps, at, beat, glim }
// tier / tierSeen: the row of the zodiac being played and which of it are found; spots: the constellations waiting
// while searching by hand ({ index, pitch, yaw, color, fade }), dragging: still searching (no spot chosen yet).
const run = { index: 0, state: 'idle', t: 0, next: 0, idle: 0, played: 0, finale: 0, lastTap: null, pannedDown: false, restSent: false, found: false,
  replaying: false, replay: 0, replayed: 0, hits: 0, judged: 0, completed: [], tier: 0, tierSeen: new Set(), spots: null, dragging: false,
  sinceRest: 0 };   // sinceRest: tiers finished since the camera last panned down by itself
const DRAG = TELESCOPE.drag;
let fade = 0;              // 1 while in the sky, eases to 0 on the way back down
let inSky = false;
const caption = document.createElement('div');
caption.className = 'constellation-name';
// A fully in-rhythm echo: a little note under the constellation while the finale plays. Built letter by
// letter so it can breathe in (blur → sharp, a wave of light through the letters, the stars blooming last)
// and drift away again; the animation itself lives in style.css (.rhythm-note).
const rhythmNote = document.createElement('div');
rhythmNote.className = 'constellation-name rhythm-note';
{
  const text = [...'in rhythm with the sky'].map((ch, i) =>
    `<span class="rn-ch" style="--i:${i}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
  rhythmNote.innerHTML = `<span class="rn-star">✦</span><span class="rn-text">${text}</span><span class="rn-star">✦</span>`;
  rhythmNote.style.setProperty('--n', 22);   // letter count: the stars bloom after the last one
}
stage.append(caption, rhythmNote);
// It stays CONSTELLATION_STYLE.rhythmNoteSec (or until the star reveals itself, if that comes first), then drifts away.
let rhythmNoteT = -1;
function showRhythmNote(on) {
  if (on) { rhythmNote.classList.remove('leaving'); void rhythmNote.offsetWidth; rhythmNote.classList.add('show'); rhythmNoteT = 0; }   // reflow: restart
  else if (rhythmNote.classList.contains('show')) { rhythmNote.classList.replace('show', 'leaving'); rhythmNoteT = -1; }
}

// Curved four-pointed star texture: red = hard star, green = soft halo (same encoding as the sky stars).
function nodeMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uMap: { value: nodeStarTexture() }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main(){
        vec4 t = texture2D(uMap, vUv);
        // Almost white core with a subtle glow in the family color.
        vec3 col = uColor * (t.g * 0.8) + mix(vec3(1.0), uColor, 0.15) * t.r;
        gl_FragColor = vec4(col * uOpacity, 1.0);
      }`,
  });
}

// Tails of a glowing star: thin rays of light from its four tips, white near the star and fading into the
// family color, the up / down ones a little longer. uReach = how far they run (fraction of the plane's
// half-size), uI = brightness (both set per frame from the star's singing / lit state).
function rayMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uReach: { value: 0 }, uI: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uReach, uI; varying vec2 vUv;
      float ray(float along, float across, float reach){
        float t = clamp(along / max(reach, 0.001), 0.0, 1.0);
        float w = mix(0.035, 0.004, t);                              // thin, tapering to a hair
        return exp(-pow(across / w, 2.0)) * pow(1.0 - t, 1.6);
      }
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float h = ray(abs(p.x), abs(p.y), uReach), v = ray(abs(p.y), abs(p.x), uReach * 1.15);
        float r = max(h, v), glow = exp(-dot(p, p) * 40.0) * 0.35;   // a soft bloom where the rays meet
        vec3 col = mix(uColor, vec3(1.0), clamp(r * 1.3, 0.0, 0.85));
        gl_FragColor = vec4(col, (r + glow) * uI);
      }`,
  });
}

// Constellation line: soft-edged, starting a little away from both stars, broken into pieces with gaps
// and gentle fading along it (a fixed pattern per line, from its seed). x along the line = vUv.x × current
// drawn length (mesh.scale.x), so the pattern doesn't stretch while the line draws out.
function lineMaterial(color, gapA, gapB, dash) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 }, uDrawn: { value: 0 }, uLen: { value: 1 },
      uGapA: { value: gapA }, uGapB: { value: gapB }, uDash: { value: dash }, uBreaks: { value: CONSTELLATION_STYLE.lineBreaks },
      uSeed: { value: Math.random() * 100 },
      uDim: { value: CONSTELLATION_STYLE.dimLines }, uFront: { value: 0 }, uFromB: { value: 0 }, uCrest: { value: 0 }, uFlash: { value: 0 },
      uFlashFront: { value: 1.3 }, uFlashFromB: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uDrawn, uLen, uGapA, uGapB, uDash, uBreaks, uSeed;
      uniform float uDim, uFront, uFromB, uCrest, uFlash, uFlashFront, uFlashFromB; varying vec2 vUv;
      float hash(float x){ return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
      float noise(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
      void main(){
        float s = vUv.x * uDrawn;                                         // distance from the start star
        float ends = smoothstep(uGapA, uGapA + uDash * 0.6, s) * smoothstep(uGapB, uGapB + uDash * 0.6, uLen - s);
        // Many small breaks (short dashes and dots), now and then a longer gap, and slow fading along it.
        float fine = smoothstep(mix(0.0, 0.55, uBreaks), mix(0.0, 0.55, uBreaks) + 0.08, noise(s / uDash));
        float coarse = smoothstep(mix(-0.2, 0.35, uBreaks), mix(-0.2, 0.35, uBreaks) + 0.12, noise(s / (uDash * 3.1) + 41.0));
        float piece = fine * coarse;
        float shade = 0.4 + 0.6 * noise(s / (uDash * 4.7) + 17.0);
        float across = abs(vUv.y - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.25, 0.55, across), glow = (1.0 - smoothstep(0.3, 1.0, across)) * 0.35;
        // Lighting up: a soft wave runs from the star lit before to the one just tapped (uFront 0 → 1.3),
        // with a brighter crest at its front that settles once it arrives.
        float u = s / uLen; u = mix(u, 1.0 - u, uFromB);
        float lit = 1.0 - smoothstep(uFront - 0.25, uFront, u);
        float crest = exp(-pow((u - uFront + 0.08) / 0.1, 2.0)) * uCrest;
        float uf = mix(s / uLen, 1.0 - s / uLen, uFlashFromB);         // a note's flash runs the same way
        float flash = uFlash * (1.0 - smoothstep(uFlashFront - 0.25, uFlashFront, uf));
        float bright = min(1.6, uDim + (1.0 - uDim) * lit + 0.8 * crest + 0.8 * flash);
        gl_FragColor = vec4(uColor, (core + glow) * ends * piece * shade * bright * uOpacity);
      }`,
  });
}

// A star's size factor from the reference sheet's size, scaled by CONSTELLATION_STYLE.starVary (0 = all alike).
const starK = size => 1 + (size - 1) * CONSTELLATION_STYLE.starVary;

function buildConstellations() {
  const S = CONSTELLATION_STYLE, item = layers.sky, d = DEPTH.sky, px = item.w / ART_W;   // world units per composition px
  for (const def of CONSTELLATIONS) {
    const group = new THREE.Group();
    group.visible = false;
    const fam = STAR_FAMILIES[def.family] ?? { star: S.star, line: S.line };   // the sign's element
    layerAttach(item).add(group);
    // Reference-sheet pixels → degree offsets from the shape's centre; placed in the sky by place().
    const xs = def.stars.map(s => s[0]), ys = def.stars.map(s => s[1]);
    const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
    const offsets = def.stars.map(([x, y]) => ({ az: (x - mx) * def.scale, el: -(y - my) * def.scale }));
    const pts = offsets.map(o => skyFieldPoint(o.az, 20 + o.el, d));
    // Notes follow the shape: the higher the star, the higher its note.
    const byHeight = pts.map((p, i) => i).sort((a, b) => pts[a].y - pts[b].y);
    const nodes = pts.map((p, i) => {
      const size = S.starSize * px * starK(def.stars[i][2]);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), nodeMaterial(fam.star));
      mesh.renderOrder = 2.35;
      // In-rhythm burst ring: the same supernova ring as the star reveal (delivery.js).
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(size, size), novaMaterial());
      ring.material.uniforms.uColor.value.set(fam.star);
      ring.renderOrder = 2.33;
      const glints = Array.from({ length: S.glitter }, () => {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.35, size * 0.35), nodeMaterial(fam.star));
        g.renderOrder = 2.34;
        return g;
      });
      const rays = new THREE.Mesh(new THREE.PlaneGeometry(size * 6, size * 6), rayMaterial(fam.star));
      rays.renderOrder = 2.345;
      group.add(ring, mesh, ...glints, rays);
      return { mesh, ring, glints, rays, home: p.clone(), cur: p.clone(), phase: Math.random() * Math.PI * 2, note: byHeight.indexOf(i) + 1,
        wake: 0, lit: 0, litTarget: 0, flash: 0, hold: 0, hint: 0, shake: 0, burst: -1, spin: 0 };
    });
    const lines = def.lines.map(([a, b]) => {
      const geo = new THREE.PlaneGeometry(1, S.lineWidth * px * 2).translate(0.5, 0, 0);   // grows from its start; room for soft edges
      const starSize = i => S.starSize * px * starK(def.stars[i][2]);
      const mesh = new THREE.Mesh(geo, lineMaterial(fam.line, S.lineGap * starSize(a), S.lineGap * starSize(b), S.lineDash * px));
      mesh.scale.x = 0.0001;
      mesh.renderOrder = 2.3;
      group.add(mesh);
      return { mesh, a, b, len: 0, draw: 0, glow: 0, flash: 0, wave: 1, fromB: 0, flashWave: 1, flashFromB: 0,
        gapA: S.lineGap * starSize(a), gapB: S.lineGap * starSize(b), dash: S.lineDash * px };
    });
    // Melody: [star, beats] steps; `at` = when each step sounds, in beats from the first.
    const steps = def.melody ?? def.stars.map((s, i) => [i, 1]);
    const at = []; steps.reduce((t, [, beats]) => (at.push(t), t + beats), 0);
    // The glimmer that marks it while it waits to be found (searching by hand): one bigger star with long rays in its
    // element's color, in the middle of its circle on the star chart.
    const gs = S.starSize * px * DRAG.glimmerSize;
    const glim = { core: new THREE.Mesh(new THREE.PlaneGeometry(gs, gs), nodeMaterial(fam.star)),
      rays: new THREE.Mesh(new THREE.PlaneGeometry(gs * 6, gs * 6), rayMaterial(fam.star)) };
    glim.core.renderOrder = 2.36; glim.rays.renderOrder = 2.355;
    group.add(glim.rays, glim.core);
    all.push({ def, fam, group, nodes, lines, offsets, steps, at, glim, frameShift: new THREE.Vector3(), beat: def.beat ?? CONSTELLATION_PLAY.beat });
  }
}

const ease = t => t * t * (3 - 2 * t);
const clamp01 = t => Math.min(1, Math.max(0, t));
const current = () => all[run.index];
// Length of a melody in seconds: up to the last note, plus that note's own beats (at most one).
const melodyLength = (c, speed = 1) => (c.at[c.at.length - 1] + Math.min(1, c.steps[c.steps.length - 1][1])) * c.beat * speed;

// Centre the constellation where the telescope points: the camera ray through (0, focusY) on screen,
// met with the sky plane, turned into sky-field degrees; the stars keep their degree offsets around it.
// With the sky dome (SKY_DOME.on) the ray meets the dome instead (skyLook.js: centred `depth` behind the sky plane,
// where the camera rests), so a constellation can sit anywhere, even behind the roof; az / el are then true degrees.
const ray = new THREE.Raycaster(), skyPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.5), hit = new THREE.Vector3();
const dome = new THREE.Sphere(new THREE.Vector3(), 1);
// Where the telescope points: sky-field degrees (az, el) and the point itself (at, sky layer), or null.
function aimPoint(parent) {
  const d = DEPTH.sky;
  camera.updateMatrixWorld(); parent.updateMatrixWorld();
  ray.setFromCamera(focusNdc(), camera);   // (through the close-ups, if any)
  ray.ray.applyMatrix4(parent.matrixWorld.clone().invert());
  const deg = THREE.MathUtils.radToDeg;
  if (SKY_DOME.on) {
    dome.center.set(0, 0, d); dome.radius = SKY_DOME.radius;
    if (!ray.ray.intersectSphere(dome, hit)) return null;   // (from inside: where it leaves the dome)
    const v = hit.clone().sub(dome.center).normalize();
    return { az: deg(Math.atan2(v.x, -v.z)), el: deg(Math.asin(v.y)), at: hit.clone() };
  }
  if (!ray.ray.intersectPlane(skyPlane, hit)) return null;
  const az = deg(Math.atan(hit.x / d)), el = deg(Math.atan(hit.y * Math.cos(Math.atan(hit.x / d)) / d));
  return { az, el, at: skyFieldPoint(az, el, d) };
}
// The dome needs the constellations shown straight on (its points don't lie in one plane).
const faceFront = () => CONSTELLATION_STYLE.faceFront || SKY_DOME.on;
// Where the constellation's stars go with the camera as it is now: around where the telescope points, the shape fitted
// to the screen (CONSTELLATION_STYLE.fitW / fitH: measured on screen at its own size, then its stars' degree offsets
// spread by fit). Measured as it will show: with the star chart, leaning with the map (fitToChart), which off to the
// side makes it much bigger on screen than flat on the sky. Returns { pts (sky layer, flat), fit, shift (def.frameShift,
// sky layer), world (as shown, moved by shift: what the chart's circle is drawn around) }, or null. Changes nothing (the search uses it to look ahead).
function shapeAt(c) {
  const d = DEPTH.sky, parent = c.group.parent, p = aimPoint(parent);
  if (!p) return null;
  const { az, el } = p;
  // faceFront: the degree offsets laid out flat around the aim point, turned to face the camera, a degree of offset
  // spanning a degree of view however far off the flat sky the point lies (searching by hand reaches far to the sides
  // and up, where the sky plane is much further away: laid out as straight ahead they shrank past what fitMax allows).
  // On the dome the aim point lies off the sky plane: the shape is laid out on the plane as before (its stars, lines and
  // glimmer keep their places in the sky layer) and the whole group is lifted by `lift` (sky layer z) onto the dome.
  const S = CONSTELLATION_STYLE, front = faceFront(), mid = p.at.clone(), lift = new THREE.Vector3(0, 0, mid.z - 0.5);
  const away = parent.localToWorld(mid.clone()).distanceTo(camera.getWorldPosition(new THREE.Vector3())) / parent.getWorldScale(new THREE.Vector3()).x;
  mid.z = 0.5;
  const u = THREE.MathUtils.degToRad(1) * (front ? away : d);
  const at = k => c.offsets.map(o => front ? new THREE.Vector3(o.az * k * u, o.el * k * u, 0).add(mid)
    : skyFieldPoint(az + o.az * k, el + o.el * k, d));
  const boxCentre = pts => { const lo = pts[0].clone(), hi = lo.clone(); for (const q of pts) { lo.min(q); hi.max(q); } return lo.add(hi).multiplyScalar(0.5); };
  const c1 = boxCentre(at(1)), Q = shapeTurn(parent, c1.clone().add(lift));
  const shown = (pts, by = new THREE.Vector3()) => { const m = boxCentre(pts); return pts.map(q => parent.localToWorld(q.clone().add(by).sub(m).applyQuaternion(Q).add(m).add(lift))); };
  const ndc = shown(at(1)).map(q => withoutCloseUp(q.project(camera)));   // its size without the close-up
  const w = Math.max(...ndc.map(p => p.x)) - Math.min(...ndc.map(p => p.x)), h = Math.max(...ndc.map(p => p.y)) - Math.min(...ndc.map(p => p.y));
  const fit = THREE.MathUtils.clamp(Math.min(2 * S.fitW / Math.max(w, 1e-3), 2 * S.fitH / Math.max(h, 1e-3)), S.fitMin, S.fitMax) * S.shapeScale;
  const pts = at(fit), [sx, sy] = c.def.frameShift ?? [0, 0], px = c.def.scale * fit * u;
  const shift = new THREE.Vector3(-sx * px, sy * px, 0);   // the circle moves the other way than its stars should
  return { pts, fit, shift, world: shown(pts, shift), lift: lift.z };
}
// How the constellation turns about its centre (in the sky layer): faceFront = straight towards the camera,
// upright; otherwise leaning with the star chart (when it's on), or not at all.
const UP = new THREE.Vector3(0, 1, 0);
function shapeTurn(parent, centre) {
  const parentQ = parent.getWorldQuaternion(new THREE.Quaternion()), w = parent.localToWorld(centre.clone());
  if (faceFront()) {
    const face = new THREE.Matrix4().lookAt(camera.getWorldPosition(new THREE.Vector3()), w, UP);   // +z towards the camera
    return parentQ.invert().multiply(new THREE.Quaternion().setFromRotationMatrix(face));
  }
  return chart.on && STAR_CHART.look.star3d ? chartTilt(parentQ, w) : new THREE.Quaternion();
}
// Place the constellation where the telescope points (shapeAt); its stars grow by starGrow of the fit (c.sizeK).
// withChart = false: only leans it with the chart, the chart itself is left alone (a spot waiting to be found).
function place(c, withChart = true) {
  const d = DEPTH.sky, parent = c.group.parent, shape = shapeAt(c);
  if (!shape) return;
  const S = CONSTELLATION_STYLE, { pts, fit } = shape;
  c.lift = shape.lift; c.frameShift.copy(shape.shift);
  const look = chart.on ? STAR_CHART.look : null;   // with the star chart: its own star size (look.starScale)
  // On the flat sky plane a constellation far off to the side or high up lies further from the camera and its
  // stars and lines would look smaller (on the dome they lie about as far everywhere: distK stays near 1). They grow by that distance (c.distK) to look as big as straight ahead, where
  // the scope points from home; the rest of the sky keeps its perspective.
  const cam = camera.getWorldPosition(new THREE.Vector3()), distTo = q => parent.localToWorld(q.clone()).distanceTo(cam);
  const home = aimView(0, 0, () => aimPoint(parent));
  const centre = pts.reduce((s, q) => s.add(q), new THREE.Vector3()).divideScalar(pts.length).setZ(0.5 + c.lift);
  c.distK = home ? distTo(centre) / distTo(home.at) : 1;
  c.sizeK = (1 + (fit - 1) * S.starGrow) * (look ? look.starScale : 1) * c.distK;
  c.nodes.forEach((n, i) => {
    n.home.copy(pts[i]); n.cur.copy(pts[i]);
    n.mesh.position.set(pts[i].x, pts[i].y, 0.52);
    n.ring.position.set(pts[i].x, pts[i].y, 0.515);
  });
  for (const l of c.lines) {
    const p = pts[l.a], q = pts[l.b];
    l.mesh.position.set(p.x, p.y, 0.51);
    l.mesh.rotation.z = Math.atan2(q.y - p.y, q.x - p.x);
    l.len = p.distanceTo(q);
    l.mesh.material.uniforms.uDash.value = l.dash * c.distK;               // dashes as seen from straight ahead (the width: every frame)
  }
  const lo = pts[0].clone(), hi = lo.clone();
  for (const q of pts) { lo.min(q); hi.max(q); }
  c.glimAt = new THREE.Vector3((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0.53).add(c.frameShift);   // (where the chart's circle is centred)
  c.glim.core.position.copy(c.glimAt); c.glim.rays.position.copy(c.glimAt);
  fitToChart(c, withChart);
}

// What the chart's circle is drawn around (world): its stars, moved by def.frameShift (shapeAt).
const frameStars = c => c.nodes.map(n => c.group.localToWorld(n.home.clone().add(c.frameShift)));
// Star chart (starChart.js): with the chart on, the constellation leans into space with the map (turned about its
// centre by STAR_CHART.look.star3d × the map's tilt; the star sprites keep facing as before), and the chart is
// built around its stars. Switched off: flat on the sky again; the old chart fades out.
function fitToChart(c, withChart = true) {
  const g = c.group, Q = new THREE.Quaternion();
  g.position.set(0, 0, c.lift || 0); g.quaternion.identity(); g.updateMatrixWorld(true);   // (lifted onto the dome: shapeAt)
  if (faceFront() || (chart.on && STAR_CHART.look.star3d)) {
    const lo = c.nodes[0].home.clone(), hi = lo.clone();
    for (const n of c.nodes) { lo.min(n.home); hi.max(n.home); }
    const centre = lo.add(hi).multiplyScalar(0.5);
    Q.copy(shapeTurn(g.parent, centre.clone().setZ(centre.z + (c.lift || 0))));
    g.quaternion.copy(Q); g.position.copy(centre).sub(centre.clone().applyQuaternion(Q)).setZ(g.position.z + (c.lift || 0));
    g.updateMatrixWorld(true);
  }
  if (!chart.on || !withChart) return;   // (the star sprites face the camera every frame: faceCamera)
  const stars = frameStars(c);
  if (run.found) fitChartFrame(stars, c.fam.star);   // the search already drew its circle: it settles onto the stars
  else buildStarChart(stars, c.fam.star);
}
// The Star chart button or a shape slider: re-fit the constellation while it's still in place, else only the chart.
chartHooks.refresh = () => {
  if (run.state === 'idle' || run.state === 'leaving') return;   // the next constellation picks it up
  const c = current();
  if (['waking', 'show', 'play', 'done'].includes(run.state)) place(c);
  else if (chart.on) buildStarChart(frameStars(c), c.fam.star);
};

// The telescope's next search step: up from the dip and across the sky to the upper left or right, far enough
// that the last circle leaves the screen, higher than the first constellation (the city leaves the view), in
// hand-guided nudges through a closing eyepiece (scopeSearch.js), coming to rest with the next circle in the
// middle. Measured from `base` (where the scope pointed before it followed the star down), not from the dip. With
// the star chart on, the next part of the chart is already there where it will point (starChart.js).
// `index` = the constellation it is searching for ('leaving' starts it once the scope has found it).
function searchStep(base = aim.to, index = nextIndex()) {
  const P = CONSTELLATION_PLAY, rad = THREE.MathUtils.degToRad, [lo, hi] = P.searchPitch;
  run.searchTo = index;
  // how far: from the nearest new circle to much further (nearer more often), either way, within bounds
  const [near, furthest] = P.searchSide, dist = rad(near + (furthest - near) * Math.pow(Math.random(), 1.6)), max = rad(P.searchMaxYaw);
  let side = (Math.random() < 0.5 ? -1 : 1) * dist;
  if (Math.abs(base.yaw + side) > max) side = -side;                                   // back the other way
  if (Math.abs(base.yaw + side) > max) side = Math.sign(side) * (max - Math.sign(side) * base.yaw);   // as far as it can
  const yaw = base.yaw + side, pitch = rad(lo + (hi - lo) * Math.random()), fam = all[index].fam;
  const sec = startSearch({ pitch, yaw }, fam, chart.on ? STAR_CHART.search.zoomSec : 0);   // with the chart: holds while it zooms to fit
  // where the next constellation's stars will be once the scope is there: its circle is drawn around them
  const shape = aimView(pitch, yaw, () => shapeAt(all[index]));
  if (shape) run.found = searchStarChart(shape.world, fam.star, sec);
}

// Tiers: the zodiac in rows of CONSTELLATION_TIER; the constellations of this row not found yet.
const TIERS = Math.ceil(CONSTELLATIONS.length / CONSTELLATION_TIER);
const waiting = () => CONSTELLATIONS.map((_, i) => i).filter(i => Math.floor(i / CONSTELLATION_TIER) === run.tier && !run.tierSeen.has(i));
// The first look-up plays the whole first tier, then pans down (and the Return button stays away until then); after
// that the camera pans down by itself again after every SKY_TRIP_TIERS tiers: time to gather the stars (collect.js).
const restDue = () => !skyView && !waiting().length && (!run.pannedDown || run.sinceRest + 1 >= SKY_TRIP_TIERS);
function rest() { run.pannedDown = true; run.sinceRest = 0; run.restSent = false; }
const canLeaveSky = () => run.pannedDown;

// Where a look-up's search sets off from (halfway up the spots, dragStep), so the scope can lift there in the same
// move as the camera pans up (modes.js lookUp); null for the game's very first look-up (its constellation shows
// straight ahead) or without searching by hand.
function lookUpAim() {
  if (!run.completed.length || !DRAG.on || run.state !== 'idle') return null;
  const [lo, hi] = spotRange();
  return { pitch: THREE.MathUtils.degToRad((lo + hi) / 2), yaw: aim.to.yaw };
}

// The next search: by hand (dragStep) or, with TELESCOPE.drag.on off, by itself in zodiac order (searchStep).
// lookUp = the start of a look-up (the scope points home; by itself it searches for the one waiting, run.index).
function nextSearch(base, lookUp = false) {
  setState('leaving');
  if (DRAG.on) dragStep(base);
  else searchStep(base, lookUp ? run.index : nextIndex());
}

// Searching by hand: the constellations still waiting in this tier (all of the next row once this one is found,
// unannounced) wait at their own spots: a glimmer in the middle of the circle the star chart draws for each where its
// stars will be. The scope lifts out of the dip by itself, then the player steers.
function dragStep(base) {
  if (!waiting().length) { run.tier = (run.tier + 1) % TIERS; run.tierSeen.clear(); }
  const rad = THREE.MathUtils.degToRad, ray = new THREE.Raycaster();
  // clear of the finished constellations' circles the chart keeps (seen along the scope's focus for that aim)
  const clash = p => aimView(rad(p.pitch), rad(p.yaw), () => { ray.setFromCamera(focusNdc(new THREE.Vector2()), camera); return chartClash(ray.ray.direction); });
  const idx = waiting(), at = placeSpots(idx.length, base, clash);
  // the last one found stays current (it has flown to its net) while the waiting ones show
  const last = all.findIndex(c => c.def.id === run.completed[run.completed.length - 1]);
  if (last >= 0) run.index = last;
  run.spots = idx.map((i, k) => ({ index: i, ...at[k], color: all[i].fam.star, fade: 0 }));
  for (const s of run.spots) {
    const c = all[s.index];
    s.world = aimView(s.pitch, s.yaw, () => { place(c, false); return shapeAt(c)?.world; });
    c.group.visible = true;
    for (const n of c.nodes) { n.ring.visible = false; n.cur.copy(n.home); }
  }
  Object.assign(run, { dragging: true, searchTo: null, found: false });
  spotChartFrames(run.spots.map(s => ({ starWorld: s.world, color: s.color })));
  startFreeSearch();
  // the scope lifts out of the dip: back to where the last constellation was (base.back; within the steering's range,
  // so the first drag doesn't snap into it: the game's first constellation can sit lower), else halfway up the spots
  const [lo, hi] = spotRange(), [dLo, dHi] = dragRange();
  let onGrab = null;
  if (base.back) {
    // within the steering's range (its low end keeps the city out of view)
    const pitch = THREE.MathUtils.clamp(base.pitch, rad(dLo), rad(dHi));
    const yaw = aim.yaw + wrapPi(base.yaw - aim.yaw), far = THREE.MathUtils.radToDeg(Math.abs(yaw - aim.yaw));
    // The way the star came down, backwards: first straight up (no turn, the roof keeps its place: aim.hold stays), then,
    // up in the sky, round to where it was. The player's first drag ends the way back and they search on from there:
    // while it still rises it keeps rising (above the city) and the drag carries it along; on the way round it
    // stops where it is. Any other move cancels the turn too.
    const y0 = aim.yaw, smooth = t => t * t * (3 - 2 * t);
    aimTo(pitch, y0, DRAG.riseSec, null, smooth, aim.hold);
    const rise = aim.to;
    let grabbed = false, round = null;
    onGrab = () => {
      grabbed = true;
      if (round && aim.to === round) { aim.active = false; aim.to = { pitch: aim.pitch, yaw: aim.yaw }; }
    };
    until(() => !aim.active).then(() => {
      if (grabbed || aim.to !== rise || !run.dragging) return;
      aimTo(rise.pitch, yaw, Math.max(DRAG.riseSec, far / DRAG.backSpeed));
      round = aim.to;
    });
  } else aimTo(rad((lo + hi) / 2), base.yaw, DRAG.riseSec);
  beginDrag(run.spots);
  drag.onGrab = onGrab;
}
// The player steered close to spot s: the scope settles onto it (soft as it moves, then the focus pull), the other
// circles fade and the lens zooms the chart until its circle fits, as the automatic search did; then it wakes up there.
function chooseSpot(s) {
  run.dragging = false; endDrag();
  run.searchTo = s.index;
  const c = all[s.index], sec = settleSearch({ pitch: s.pitch, yaw: s.yaw }, c.fam, chart.on ? STAR_CHART.search.zoomSec : 0);
  run.found = chooseSpotFrame(run.spots.indexOf(s), sec);
}
// The waiting constellations' glimmers while searching, in the middle of their circles (as the chart's lens zoom shows
// them); they brighten a little as the scope nears them. Once one is chosen they all fade; it then wakes up as usual.
const _gw = new THREE.Vector3();
function updateSpots(dt, now) {
  let any = false;
  for (const s of run.spots) {
    const c = all[s.index];
    s.fade = run.dragging ? Math.min(1, s.fade + dt / 0.8) : Math.max(0, s.fade - dt / 0.6);
    any = any || s.fade > 0;
    if (run.state !== 'leaving') continue;   // the chosen one has started: its own update runs
    c.group.visible = s.fade > 0;
    if (!c.group.visible) continue;
    faceCamera(c);
    const v = s.fade * fade, lift = 1 + 0.8 * (s.close ?? 0), K = (c.sizeK ?? 1) * CONSTELLATION_STYLE.starScale;
    for (const n of c.nodes) {
      n.mesh.material.uniforms.uOpacity.value = 0; n.rays.material.uniforms.uI.value = 0;
      for (const gl of n.glints) gl.material.uniforms.uOpacity.value = 0;
    }
    for (const l of c.lines) l.mesh.material.uniforms.uOpacity.value = 0;
    if (chart.on) {   // where its circle's middle shows, magnified with the chart
      chartZoomed(c.group.localToWorld(_gw.copy(c.glimAt)));
      c.group.worldToLocal(_gw);
      c.glim.core.position.copy(_gw); c.glim.rays.position.copy(_gw);
    } else { c.glim.core.position.copy(c.glimAt); c.glim.rays.position.copy(c.glimAt); }
    const breathe = 0.85 + 0.15 * Math.sin(now * 2.4 + c.nodes[0].phase);
    c.glim.core.material.uniforms.uOpacity.value = v * breathe * lift;
    c.glim.core.scale.setScalar(K * breathe * (1 + 0.3 * (s.close ?? 0)));
    c.glim.rays.material.uniforms.uI.value = v * 0.75 * lift;
    c.glim.rays.material.uniforms.uReach.value = 0.4 * breathe * (1 + 0.4 * (s.close ?? 0));
    c.glim.rays.scale.setScalar(K);
  }
  if (!any && !run.dragging) run.spots = null;
}

// The scope follows the flying star down on the star's own curves (delivery.js): it turns round to the roof (home)
// early in the fall, high in the sky (turnProgress), and dips on the fall curve (fallProgress) until the net shows at
// STAR_DELIVERY.landY on screen as the star lands. So the roof comes into view already facing the scope.
function followStar() {
  const D = STAR_DELIVERY, rad = THREE.MathUtils.degToRad;
  run.aimBase = { pitch: aim.to.pitch, yaw: aim.to.yaw };
  camera.updateMatrixWorld();
  if (delivery.nod) {   // past the first stars: only a little nod after the star (STAR_DELIVERY.nod); the lens and the
    // zoom out come as the search lifts out of the dip (lensOnRise), else they came while it showed itself ('reveal')
    aimTo(aim.pitch - THREE.MathUtils.degToRad(D.nod.dipDeg), aim.yaw, D.nod.sec, null, undefined, aim.hold);
    return;
  }
  // The close-up on the constellation eases out as the star flies down; a little zoom follows the star instead (about
  // the middle on a straight flight: the scope keeps it near there), and the eyepiece closes in to its round lens (it
  // stays so for the search that comes next, or opens again as the camera pans down to the roof: scopeSearch.js cancelSearch).
  setCloseUp(false); setFlyZoom(true, delivery.straight ? { x: 0, y: 0 } : delivery.pos);
  closeEyepiece();
  // Elevations (angles up from level) of the view's centre and of the net; turning round doesn't change them.
  const netPos = netTarget(run.record ?? delivery.record).pos;
  const viewEl = anglesOf(camera.getWorldDirection(new THREE.Vector3()))[1];
  const netEl = anglesOf(netPos.clone().sub(camera.getWorldPosition(new THREE.Vector3())).normalize())[1];
  // At the landing the net shows landY below the centre (as an angle, with the eyepiece zoom).
  const below = Math.atan(D.landY * Math.tan(rad(camera.fov / 2)) / view.zoom);
  const dip = Math.max(rad(D.followDown), (viewEl - (netEl - below)) / Math.max(0.01, crane.value));
  // In the round lens an outer net would land outside the circle: the scope also turns towards it, until it's within
  // lensX of the middle (at most followTurnMax degrees). The whole view turns as one picture (aim.hold: roof, city and
  // sky alike, nothing sliding apart), and the lens hides the artwork's edges. With the eyepiece look off there is no
  // lens to hide them (the turned view would run past the side buildings into the fog), and the whole view shows
  // every net anyway: no turn then.
  const camPos = camera.getWorldPosition(new THREE.Vector3()), q = layers.poles.turn.quaternion.clone().invert();
  const netYaw = anglesOf(netPos.clone().sub(camPos).applyQuaternion(q).normalize())[0];   // as seen facing the roof
  const homeYaw = anglesOf(camera.getWorldDirection(new THREE.Vector3()))[0] - aim.yaw * crane.value;
  const off = wrapPi(netYaw - homeYaw), ok = Math.atan(D.lensX * Math.tan(rad(camera.fov / 2)) * camera.aspect / view.zoom);
  const turn = !eyepieceOn() ? 0 : Math.sign(off) * Math.min(rad(D.followTurnMax), Math.max(0, Math.abs(off) - ok));
  // Straight flight: turn and dip together on the star's own curve (delivery.js), a little behind it.
  const smooth = t => t * t * (3 - 2 * t);
  if (delivery.straight) {
    const yawTo = aim.yaw + wrapPi(turn - aim.yaw), A = D.straight.arc;
    if (!A.on) { aimTo(aim.pitch - dip, yawTo, D.straight.flySec + D.straight.camLag, null, smooth, turn); return; }
    // The arc (delivery.js): one move. The scope turns round to face the roof all through the flight, and dips after
    // the star from where it tops its arc, settling camLag after it lands.
    const sec = Math.min(A.maxSec, A.sec + Math.abs(yawTo - aim.yaw) / rad(1) * A.secPerDeg), dur = sec + A.camLag;
    const [round, down] = planArc(sec, viewEl);
    aimTo(aim.pitch - dip, yawTo, dur, null, down, turn, round);
    return;
  }
  aimTo(aim.pitch - dip, aim.yaw + wrapPi(turn - aim.yaw), D.flySec, null, fallProgress, turn, turnProgress);
}

function setState(state) {
  run.state = state; run.t = 0;
  setMusicDuck(state === 'show' || state === 'play' || state === 'done');   // the music steps back for the melody
}

function start(index) {
  for (const c of all) c.group.visible = false;
  run.index = index;
  const c = current();
  place(c);
  c.group.visible = true;
  for (const n of c.nodes) {
    Object.assign(n, { wake: 0, lit: 0, litTarget: 0, flash: 0, hold: 0, hint: 0, shake: 0, burst: -1, arrived: false, melted: false });
    n.cur.copy(n.home); n.ring.visible = true;
  }
  c.glim.core.material.uniforms.uOpacity.value = 0; c.glim.rays.material.uniforms.uI.value = 0;   // (it may have waited as a spot)
  for (const l of c.lines) Object.assign(l, { draw: 0, glow: 0, flash: 0, wave: 1, fromB: 0, flashWave: 1, flashFromB: 0 });
  Object.assign(run, { next: 0, idle: 0, played: 0, finale: 0, lastTap: null, replaying: false, replayed: 0, hits: 0, judged: 0, record: null, gatherAt: -1, arrivals: 0, aimBase: null, landed: 0, found: false, lensIn: false });
  caption.classList.remove('show');
  setState('waking');
}

// Melody step i: its star brightens up with its note (long notes glow and ring longer); the line from
// the previous step's star flashes along.
function sing(c, i, soft = 1, speed = 1) {
  const [k, beats] = c.steps[i], n = c.nodes[k];
  n.flash = 1;
  n.hold = beats * c.beat * speed * 0.5;
  chime(n.note, soft, 0, 0.6 + 0.4 * beats, c.fam);
  const prev = i > 0 ? c.steps[i - 1][0] : -1;
  for (const l of c.lines) if ((l.a === k && l.b === prev) || (l.b === k && l.a === prev)) {
    l.flash = 1; l.flashWave = 0; l.flashFromB = l.a === k ? 1 : 0;   // a flash that runs towards the note's star
  }
}

// The extra sparkle: an expanding ring and a few glints flying out.
function burst(n) {
  n.burst = 0;
  n.spin = Math.random() * Math.PI * 2;
}

function complete(c) {
  run.completed.push(c.def.id);
  run.tierSeen.add(run.index);
  const perfect = run.judged > 0 && run.hits === run.judged, rhythm = { hits: run.hits, of: run.judged };
  run.record = skyView ? null : collectStar(c.def.family, c.def.id, rhythm);       // the one star this completion gives (none in the sky view)
  const detail = { id: c.def.id, name: c.def.name, family: c.def.family, rhythm, record: run.record };
  if (!skyView) window.dispatchEvent(new CustomEvent('constellationcomplete', { detail }));
  // Letter by letter, so the name can swoosh out of its centre and a wave can run through it (style.css):
  // --d = steps from the middle letter (timing), --o = how far it starts towards the middle (in letters).
  const chars = [...c.def.name], mid = (chars.length - 1) / 2;
  caption.innerHTML = '<span class="cn-name">' + chars.map((ch, i) =>
    `<span class="cn-ch" style="--d:${Math.abs(i - mid).toFixed(1)};--o:${(mid - i).toFixed(1)}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')
    + '</span>' + (c.fam.name ? `<small style="--n:${chars.length}">${c.fam.name}</small>` : '');
  caption.style.setProperty('--name-color', c.fam.star);   // shown together with the star (gather → reveal)
  if (perfect) {
    rhythmNote.style.setProperty('--name-color', c.fam.star);
    placeRhythmNote(c);
    showRhythmNote(true);
    pulseChart();   // the star chart lights up with it, outwards from the circle
  }
  setState('done'); run.t = -untilNextBeat();
}

// Skip (testing): the echo game is skipped and its star appears right away, as after a completion (no rhythm bonus).
// The Skip button shows only while the constellation wakes, sings or waits for taps (body.can-skip).
const canSkip = () => inSky && ['waking', 'show', 'play'].includes(run.state);
// From waking until its star sets off for the net: no shooting stars then (stars.js meteorCalm).
const constellationShows = () => inSky && (['waking', 'show', 'play', 'done', 'gather', 'skyShown'].includes(run.state) || (run.state === 'reveal' && delivery.state === 'reveal'));
function skipConstellation() {
  if (!canSkip()) return;
  const c = current();
  for (const n of c.nodes) { n.wake = 1; n.litTarget = 1; n.hint = 0; }
  for (const l of c.lines) l.draw = 1;
  run.replaying = false;
  complete(c);
  startGather(c);
}
document.getElementById('btnSkip').onclick = skipConstellation;

const nextIndex = () => (run.index + 1 < all.length ? run.index + 1 : Math.min(CONSTELLATION_PLAY.loopFrom, all.length - 1));

// Gathering: every star flies straight to the middle (the star chart's circle, else the brightest star); near stars
// arrive first, one after another (evenly spaced over gatherMin … gatherMax), so the arrivals ripple in.
// The star the others gather into: the biggest, the most central of equals.
function gatherIndex(c) {
  const sizes = c.def.stars.map(s => s[2]), cx = c.nodes.reduce((a, n) => a + n.home.x, 0) / c.nodes.length;
  let g = 0;
  c.nodes.forEach((n, i) => {
    if (sizes[i] > sizes[g] || (sizes[i] === sizes[g] && Math.abs(n.home.x - cx) < Math.abs(c.nodes[g].home.x - cx))) g = i;
  });
  return g;
}

function startGather(c) {
  const g = gatherIndex(c);
  // With the star chart they meet in the middle of its circle, where the star appears; else in the brightest star.
  const mid = ringMiddle(c) ?? c.nodes[g].home;
  c.nodes.forEach(n => {
    n.path = [n.home.clone(), mid.clone()];
    n.pathLen = n.home.distanceTo(mid);
  });
  // Arrival times by distance (nearest first), but evenly spaced, so even stars just as far away arrive one after
  // another and each gets its own little note. The gathering star itself comes first (it makes no sound).
  const D = STAR_DELIVERY, others = c.nodes.filter((n, i) => i !== g && n.pathLen > 0).sort((a, b) => a.pathLen - b.pathLen);
  const gn = c.nodes[g];
  gn.dur = gn.pathLen > 0 ? D.gatherMin : 0;
  others.forEach((n, k) => { n.dur = others.length > 1 ? D.gatherMin + (D.gatherMax - D.gatherMin) * k / (others.length - 1) : D.gatherMax; });
  c.nodes.forEach(n => {
    if (!(n.pathLen > 0)) n.dur = 0;
    n.arrived = n.dur === 0;
  });
  run.gatherAt = g; run.arrivals = 0;
  setState('gather');
}

// The middle of the star chart's circle, as it shows from the camera, on the constellation's plane (its local z of
// the star sprites), or null without a chart.
function ringMiddle(c) {
  const w = chartMiddle();
  if (!w) return null;
  c.group.updateMatrixWorld(true);
  const eye = c.group.worldToLocal(camera.getWorldPosition(new THREE.Vector3())), at = c.group.worldToLocal(w);
  const t = (0.52 - eye.z) / (at.z - eye.z);
  return Number.isFinite(t) && t > 0 ? eye.lerp(at, t).setZ(c.nodes[0].home.z) : null;
}

// A point `k` (0..1) of the way along a path of points.
function along(path, len, k, out) {
  let d = k * len;
  for (let j = 1; j < path.length; j++) {
    const seg = path[j].distanceTo(path[j - 1]);
    if (d <= seg || j === path.length - 1) return out.lerpVectors(path[j - 1], path[j], seg ? Math.min(1, d / seg) : 1);
    d -= seg;
  }
  return out.copy(path[0]);
}

// ---------------------------------------------------------------------------
// Taps
// ---------------------------------------------------------------------------
const canvas = renderer.domElement, tmp = new THREE.Vector3();

// The star sprites (star, ring, glints, rays) always face the camera: the sky is a flat plane, so once the
// telescope has turned far to one side, sprites lying in it would look squeezed.
const _gq = new THREE.Quaternion(), _face = new THREE.Quaternion();
function faceCamera(c) {
  c.group.getWorldQuaternion(_gq);
  _face.copy(_gq).invert().multiply(camera.quaternion);
  for (const n of c.nodes) for (const m of [n.mesh, n.ring, n.rays, ...n.glints]) m.quaternion.copy(_face);
  c.glim.core.quaternion.copy(_face); c.glim.rays.quaternion.copy(_face);
}
const canTap = () => inSky && devMode === 'none' && bts.e === 0;
drag.allowed = canTap;
drag.pick = s => { if (run.dragging && run.spots?.includes(s)) chooseSpot(s); };   // a rim hint tapped

// Nearest star of the current constellation within the tap tolerance, or -1.
function starAt(e) {
  const c = current(), rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top, r = CONSTELLATION_PLAY.hitRadius * rect.height;
  let best = -1, bestD = r;
  c.nodes.forEach((n, i) => {
    n.mesh.getWorldPosition(tmp).project(camera);
    const d = Math.hypot((tmp.x + 1) / 2 * rect.width - mx, (1 - tmp.y) / 2 * rect.height - my);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.defaultPrevented || !canTap() || run.state !== 'play') return;   // (defaultPrevented: it popped a shooting star)
  const k = starAt(e);
  if (k < 0) return;
  const P = CONSTELLATION_PLAY, c = current(), n = c.nodes[k], now = performance.now() / 1000;
  run.idle = 0; run.replaying = false;              // a tap ends a reminder replay
  if (k === c.steps[run.next][0]) {
    // In rhythm? Compare the gap to the previous tap with the melody's gap (first tap: nothing to compare).
    if (run.lastTap !== null) {
      const want = c.steps[run.next - 1][1] * c.beat, gap = now - run.lastTap;
      run.judged++;
      if (Math.abs(gap - want) <= Math.max(P.rhythmMinTol, P.rhythmTolerance * want)) { run.hits++; burst(n); shimmer(n.note); }
    }
    run.lastTap = now;
    n.litTarget = 1; n.hint = 0;
    sing(c, run.next);
    for (const l of c.lines) if ((l.a === k && c.nodes[l.b].litTarget) || (l.b === k && c.nodes[l.a].litTarget)) {
      l.glow = 1; l.wave = 0; l.fromB = l.a === k ? 1 : 0;   // the light runs towards the star just tapped
    }
    run.next++;
    if (run.next === c.steps.length) complete(c);
  } else {
    run.lastTap = null;                               // the rhythm starts over from the next right tap
    if (n.litTarget) { n.flash = 0.5; chime(n.note, 0.4, 0, 1, c.fam); }   // a lit star just sings again, softly
    else { n.shake = 1; thud(); }                     // not this one yet: no reset, show the way
    c.nodes[c.steps[run.next][0]].hint = 1;
  }
});

// Searching by hand: a tap on a glimmer chooses its constellation (the scope settles onto it as when steered close).
// A press that moves further than DRAG.tapMove px is a drag, not a tap.
let glimDown = null;
canvas.addEventListener('pointerdown', e => {
  glimDown = run.dragging && e.button === 0 && !e.defaultPrevented && canTap() ? { x: e.clientX, y: e.clientY } : null;
});
canvas.addEventListener('pointerup', e => {
  const d = glimDown; glimDown = null;
  if (!d || !run.dragging || !run.spots || Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG.tapMove) return;
  const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const rim = lensRim(1), kx = rect.width / viewport.w;   // only glimmers seen through the eyepiece (its soft edge included)
  let best = null, bestD = DRAG.tapR * rect.height;
  for (const s of run.spots) {
    const c = all[s.index];
    if (s.fade < 0.5 || !c.group.visible) continue;
    c.glim.core.getWorldPosition(tmp).project(camera);
    if (tmp.z > 1) continue;   // behind the camera
    if (((tmp.x * rect.width / 2) / (rim.x * kx)) ** 2 + ((tmp.y * rect.height / 2) / (rim.y * kx)) ** 2 > 1) continue;
    const dd = Math.hypot((tmp.x + 1) / 2 * rect.width - mx, (1 - tmp.y) / 2 * rect.height - my);
    if (dd < bestD) { bestD = dd; best = s; }
  }
  if (best) chooseSpot(best);
});

canvas.addEventListener('pointermove', e => {
  if (!canTap() || run.state !== 'play') return;
  canvas.style.cursor = starAt(e) >= 0 ? 'pointer' : '';
});

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------
function updateConstellations(dt, now, visible) {
  const S = CONSTELLATION_STYLE, P = CONSTELLATION_PLAY;
  inSky = visible;
  document.body.classList.toggle('can-skip', canSkip());
  meteorCalm.on = constellationShows();
  if (rhythmNoteT >= 0 && (rhythmNoteT += dt) > S.rhythmNoteSec) showRhythmNote(false);
  updateSearch(dt);
  if (visible) {
    fade = 1;
    // Every look-up after the game's first constellation searches the sky for the next one first.
    if (run.state === 'idle') {
      if (run.completed.length || skyView) nextSearch(aim.to, true);   // (the sky view: never one by itself)
      else start(run.index);
    }
  } else if (fade > 0) {
    if (fade === 1) {
      cancelSearch();
      // searching by hand: the next look-up offers the spots anew (their circles stay while the chart is held: holdChart)
      if (run.dragging) { run.dragging = false; endDrag(); if (!chart.hold) dropSpotFrames(); }
      // (the scope's way home: modes.js returnToRooftop)
      if (run.record) {                            // left during the celebration: the star still arrives
        if (restDue()) { rest(); run.restSent = true; window.dispatchEvent(new Event('skyrest')); }   // (its tier's trip ends here)
        else if (!waiting().length) run.sinceRest++;
        finishDelivery(); landStar(run.record); run.record = null;
        run.index = nextIndex();                   // this one is done; the next look-up shows the next
      }
    }
    fade = Math.max(0, fade - dt / S.fadeOut);
    caption.classList.remove('show'); showRhythmNote(false);
    if (fade === 0) { setState('idle'); run.found = false; run.swungHome = false; run.foundAim = null; run.spots = null; for (const c of all) c.group.visible = false; }   // the chart draws in anew next time   // wakes up again next time
  }
  if (run.state === 'idle') { updateStarChart(dt, 0); return; }

  const c = current(), N = c.nodes.length, M = c.steps.length;
  run.t += dt;
  const wakeLen = S.fadeIn + S.starStagger * (N - 1), linesLen = wakeLen + S.lineDraw * (1 + 0.6 * (c.lines.length - 1));

  switch (run.state) {
    case 'waking':
      c.nodes.forEach((n, i) => { n.wake = ease(clamp01((run.t - i * S.starStagger) / S.fadeIn)); });
      c.lines.forEach((l, i) => { l.draw = ease(clamp01((run.t - wakeLen - i * S.lineDraw * 0.6) / S.lineDraw)); });
      if (run.t > linesLen + P.pauseBeforeShow) { setState('show'); run.t = -untilNextBeat(); }   // first note on a music beat
      break;
    case 'show':
      // The melody, in the rhythm the player can echo.
      while (run.played < M && run.t >= c.at[run.played] * c.beat) sing(c, run.played++);
      if (run.t > melodyLength(c) + 0.3) { setState('play'); run.idle = 0; }
      break;
    case 'play':
      run.idle += dt;
      if (run.idle > P.hintAfter) c.nodes[c.steps[run.next][0]].hint = 1;
      // Left alone for a while: the melody plays again as a reminder (progress stays; a tap stops it).
      if (!run.replaying && run.idle > P.replayAfter) { run.replaying = true; run.replay = -untilNextBeat(); run.replayed = 0; }   // first note on a music beat
      if (run.replaying) {
        run.replay += dt;
        while (run.replayed < M && run.replay >= c.at[run.replayed] * c.beat) sing(c, run.replayed++, 0.85);
        if (run.replayed === M && run.replay > melodyLength(c)) { run.replaying = false; run.idle = 0; }   // the wait starts over
      }
      break;
    case 'done': {
      // The melody once more, a little quicker; a fully in-rhythm echo ends in a burst from every star.
      const t = run.t - c.beat;
      while (t > 0 && run.finale < M && t >= c.at[run.finale] * c.beat * P.finaleSpeed) sing(c, run.finale++, 0.8, P.finaleSpeed);
      if (run.finale === M && run.judged > 0 && run.hits === run.judged && t > melodyLength(c, P.finaleSpeed)) {
        for (const n of c.nodes) burst(n);
        run.finale++;
      }
      const perfectBurst = run.judged > 0 && run.hits === run.judged ? 0.6 : 0;
      if (run.t > c.beat + melodyLength(c, P.finaleSpeed) + STAR_DELIVERY.afterFinale + perfectBurst) startGather(c);
      break;
    }
    case 'gather': {
      const g = c.nodes[run.gatherAt];
      let together = true;
      c.nodes.forEach(n => {
        if (n.arrived) return;
        const k = ease(clamp01(run.t / n.dur));
        along(n.path, n.pathLen, k, n.cur);
        if (k < 1) { together = false; return; }
        if (n === g) { n.arrived = true; return; }   // the gathering star itself, at the circle's middle: the others melt into it
        n.arrived = n.melted = true;
        g.flash = 1; g.hold = 0.15;                // the gathering star brightens with every arrival
        chime(Math.min(9, g.note + ++run.arrivals), 0.45, 0, 0.7, c.fam);
      });
      if (together && run.t > STAR_DELIVERY.gatherMax + STAR_DELIVERY.revealPause && skyView) {
        // the sky view: the star flashes with its name, then fades (no flight to a net)
        burst(g); pulseChart('starPulse');
        setState('skyShown');
        placeCaption(); caption.classList.add('show');
        showRhythmNote(false);
      } else if (together && run.t > STAR_DELIVERY.gatherMax + STAR_DELIVERY.revealPause) {
        g.mesh.getWorldPosition(tmp);
        startDelivery(run.record, tmp);
        pulseChart('starPulse');                   // the star chart lights up with the star, outwards from the circle
        g.melted = true;
        setState('reveal');
        placeCaption();                            // name and element appear with the star, right beneath it
        caption.classList.add('show');
        showRhythmNote(false);
      }
      break;
    }
    case 'reveal':
      // The search goes on from here once the star has landed. (The scope stays on the star while it shows itself; it
      // comes round to the roof as it follows the star down: followStar.)
      if (!run.swungHome) {
        run.swungHome = true;
        run.foundAim = { pitch: aim.to.pitch, yaw: aim.to.yaw };
      }
      // Nod (past the first stars): the round lens forms while the star shows itself, before it sets off. The little
      // zoom comes in about the middle as the close-up eases out (same length: one steady zoom out, no bump), so the
      // search takes over from it at the same size, as after a full follow (scopeSearch.js: zin).
      // (lensOnRise: not here; the search eases the close-up out as the lens closes, scopeSearch.js handOver)
      if (delivery.nod && !STAR_DELIVERY.nod.lensOnRise && delivery.state === 'reveal' && delivery.t >= STAR_DELIVERY.nod.lensAt && !run.lensIn) {
        run.lensIn = true;
        setCloseUp(false); setFlyZoom(true, { x: 0, y: 0 }); closeEyepiece();
      }
      // The star shows itself and flies to its net (delivery.js); the name stays until it sets off.
      if (delivery.state === 'fly') {
        caption.classList.remove('show');
        if (!run.aimBase) followStar();
        if (!delivery.nod && !delivery.straight) aimFlyZoom(delivery.pos);   // the little zoom stays on the star
      }
      // After the landing: the camera rests on the net a moment before searching on.
      if (delivery.state === 'idle' && !aim.active) run.landed += dt;
      if (run.landed > (delivery.nod ? STAR_DELIVERY.nod.hold : STAR_DELIVERY.landHold)) {
        run.record = null;
        if (restDue()) {
          // After the first tier, then every SKY_TRIP_TIERS tiers, the camera goes back to the roof on its own.
          rest();
          run.index = nextIndex();
          setState('resting');
        } else {
          if (!waiting().length) run.sinceRest++;
          // (nod, stayDown: the search sets off from the dip, the view only zooms out, no lift back up)
          const stay = delivery.nod && STAR_DELIVERY.nod.stayDown;
          nextSearch(stay ? { pitch: aim.pitch, yaw: aim.yaw, back: true } : run.foundAim ? { ...run.foundAim, back: true } : run.aimBase ?? aim.to);
        }
        run.aimBase = null; run.swungHome = false; run.foundAim = null; run.lensIn = false;
      }
      break;
    case 'skyShown':
      // the sky view: the found star fades, then the search goes on from here
      if (run.t > 0.6) c.nodes[run.gatherAt].melted = true;
      if (run.t > SKY_VIEW.showSec) {
        caption.classList.remove('show');
        setCloseUp(false); closeEyepiece();
        nextSearch({ pitch: aim.to.pitch, yaw: aim.to.yaw, back: true });
      }
      break;
    case 'resting':
      // A breath after the landing, then back down to the roof (modes.js listens).
      if (run.t > 0.9 && !run.restSent) { run.restSent = true; window.dispatchEvent(new Event('skyrest')); }
      break;
    case 'leaving':
      if (run.dragging) { const k = updateDrag(dt); if (k >= 0) chooseSpot(run.spots[k]); }
      if (run.t > S.fadeOut * 2 && !aim.active && !search.active && !chart.search && !run.dragging && run.searchTo != null) {   // once the scope has found it (and the lens has zoomed the chart to fit)
        start(run.searchTo);
        setCloseUp(true);   // closed in on the found circle already (scopeSearch.js); stays for the constellation
      }
      break;
  }
  const out = run.state === 'leaving' ? 1 - ease(clamp01(run.t / (S.fadeOut * 2))) : 1;
  updateStarChart(dt, run.found || run.dragging ? fade : fade * out);   // searching by hand: the map stays
  if (run.spots) updateSpots(dt, now);   // while searching, the chart cross-fades by itself

  faceCamera(c);
  for (const n of c.nodes) {
    n.lit += (n.litTarget - n.lit) * Math.min(1, dt * 6);
    if (n.hold > 0) n.hold -= dt; else n.flash = Math.max(0, n.flash - dt / S.flashDecay);
    n.shake = Math.max(0, n.shake - dt * 2.5);
    const hint = n.hint * (0.5 + 0.5 * Math.sin(now * 3.2));
    const tw = 1 - S.twinkle * (0.5 + 0.5 * Math.sin(now * 1.3 + n.phase));
    const f = ease(n.flash), vis = n.wake * fade * out * (n.melted ? 0 : 1);   // arrived stars melt into one
    n.mesh.material.uniforms.uOpacity.value = vis * ((S.dim + (S.litBright - S.dim) * n.lit) * tw + 0.8 * f + 0.4 * hint);
    const K = (c.sizeK ?? 1) * S.starScale;   // the constellation's star size from fitting it to the screen (place) and its slider
    n.mesh.scale.setScalar(K * (1 + (S.litScale - 1) * n.lit + (S.flashScale - 1) * f + 0.25 * hint));
    n.rays.scale.setScalar(K);
    // Tails: long while it sings, shorter while it's only lit, breathing with the beat.
    const pulse = 1 + (S.rayIdlePulse + (S.rayPulse - S.rayIdlePulse) * f) * Math.sin(now * Math.PI * 2 / c.beat + n.phase);
    const glowing = Math.max(f, n.lit * S.rayLitBright);   // idle (only lit): short, faint, barely breathing
    n.rays.position.set(n.cur.x, n.cur.y, 0.519);
    n.rays.material.uniforms.uReach.value = (S.rayLit * n.lit + (S.rayLen - S.rayLit * n.lit) * f) * pulse / 3;   // in star sizes → fraction of the plane's half-size (3 star sizes)
    n.rays.material.uniforms.uI.value = vis * glowing * S.rayBright * (0.85 + 0.15 * pulse);
    n.mesh.position.set(n.cur.x + Math.sin(now * 45) * n.shake * n.shake * 0.004 * layers.sky.w, n.cur.y, 0.52);
    // In-rhythm burst: ring grows and fades, glints fly outwards and fade.
    if (n.burst >= 0) n.burst += dt / S.burstSec;
    if (n.burst > 1) n.burst = -1;
    const on = n.burst >= 0;   // after the reset: else its last frame shows at full start brightness (a one-frame flash)
    const b = Math.max(0, n.burst), e = 1 - Math.pow(1 - b, 3), alpha = on ? Math.pow(1 - b, 1.5) * vis : 0;
    n.ring.scale.setScalar(K * (1 + (S.burstSize - 1) * e));
    novaLook(n.ring.material, b, alpha * 0.8 * STAR_DELIVERY.revealFx.ringBright / 0.6);   // 0.6: default ripple brightness
    const size = n.mesh.geometry.parameters.width;
    n.glints.forEach((g, j) => {
      const a = n.spin + j / n.glints.length * Math.PI * 2, r = K * size * S.burstSize * 0.55 * e;
      g.position.set(n.cur.x + Math.cos(a) * r, n.cur.y + Math.sin(a) * r, 0.525);
      g.material.uniforms.uOpacity.value = alpha * 1.2;
      g.scale.setScalar(K * (1 - 0.5 * b));
    });
  }
  // While gathering, each line stretches between its two travelling stars (so it shrinks as they meet)
  // and fades away.
  const delivering = run.state === 'reveal' || run.state === 'resting' || (run.state === 'leaving' && run.gatherAt >= 0);
  const lineFade = run.state === 'gather' ? 1 - ease(clamp01(run.t / STAR_DELIVERY.gatherMax)) : delivering ? 0 : 1;
  for (const l of c.lines) {
    l.flash = Math.max(0, l.flash - dt / S.flashDecay);
    l.wave = Math.min(1, l.wave + dt / S.lineWave);
    l.flashWave = Math.min(1, l.flashWave + dt / S.lineWave);
    if (run.state === 'gather') {
      const p = c.nodes[l.a].cur, q = c.nodes[l.b].cur;
      l.mesh.position.set(p.x, p.y, 0.51);
      l.mesh.rotation.z = Math.atan2(q.y - p.y, q.x - p.x);
      l.len = p.distanceTo(q);
    }
    l.mesh.scale.x = Math.max(0.0001, l.draw * l.len);
    const u = l.mesh.material.uniforms, K = (c.sizeK ?? 1) * S.starScale;
    l.mesh.scale.y = (c.distK ?? 1) * S.lineScale;                          // width as seen from straight ahead, and its slider
    u.uGapA.value = l.gapA * K; u.uGapB.value = l.gapB * K;                 // the gap grows with its stars
    u.uDrawn.value = l.mesh.scale.x; u.uLen.value = l.len;
    u.uOpacity.value = l.draw * fade * out * lineFade * S.lineOpacity;
    u.uFront.value = l.glow ? ease(l.wave) * 1.3 : 0;            // past 1: fully lit
    u.uCrest.value = l.glow ? 1 - ease(clamp01((l.wave - 0.7) / 0.3)) : 0;   // the crest settles as the wave arrives
    u.uFromB.value = l.fromB; u.uFlash.value = ease(l.flash);
    u.uFlashFront.value = ease(l.flashWave) * 1.3; u.uFlashFromB.value = l.flashFromB;
  }
}

// An overlay just under a constellation's lowest star.
function placeUnder(el, c) {
  let low = 1, x = 0;
  for (const n of c.nodes) { n.mesh.getWorldPosition(tmp).project(camera); low = Math.min(low, tmp.y); x += tmp.x / c.nodes.length; }
  el.style.top = `${(1 - low) / 2 * 100 + 5}%`;
  el.style.left = `${(x + 1) / 2 * 100}%`;
}

// "in rhythm with the sky": big, in the middle of the constellation. Comes after the last tap (nothing left to tap,
// pointer-events off), so it only has to keep clear of the stars singing the finale: it takes the spot nearest the
// constellation's centre line (centred across it, stepping up / down) that stays on screen and clear of every star
// at its lit size. It leaves as the star reveals itself.
function placeRhythmNote(c) {
  const W = stage.clientWidth, H = stage.clientHeight, pad = 10;
  const toPx = v => { tmp.copy(v).project(camera); return [(tmp.x + 1) / 2 * W, (1 - tmp.y) / 2 * H]; };
  const keepOut = c.nodes.map(n => {   // each star at its lit size: centre and an edge point, on screen
    const p = n.mesh.getWorldPosition(new THREE.Vector3()), scale = n.mesh.getWorldScale(new THREE.Vector3()).x;
    const [x, y] = toPx(p), [ex] = toPx(p.add(new THREE.Vector3(n.mesh.geometry.parameters.width * scale * CONSTELLATION_STYLE.litScale * 0.5, 0, 0)));
    const r = Math.abs(ex - x);
    return { x0: x - r, x1: x + r, y0: y - r, y1: y + r };
  });
  const w = rhythmNote.offsetWidth, h = rhythmNote.offsetHeight;
  const mx = (Math.min(...keepOut.map(b => b.x0)) + Math.max(...keepOut.map(b => b.x1))) / 2;   // the constellation's centre
  const my = (Math.min(...keepOut.map(b => b.y0)) + Math.max(...keepOut.map(b => b.y1))) / 2;
  const cx = Math.min(W - pad - w / 2, Math.max(pad + w / 2, mx));
  const fits = top => top >= pad && top + h <= H - pad
    && keepOut.every(b => cx + w / 2 + pad < b.x0 || cx - w / 2 - pad > b.x1 || top + h + pad < b.y0 || top - pad > b.y1);
  let best = null;
  const stepPx = h * 0.25, steps = 2 * Math.ceil(H / stepPx);   // as far as the screen goes, nearest the centre first
  for (let step = 0; step < steps && best === null; step++) {   // 0, up, down, further up, further down …
    const top = my - h / 2 + (step % 2 ? -1 : 1) * Math.ceil(step / 2) * stepPx;
    if (fits(top)) best = top;
  }
  rhythmNote.style.left = `${cx / W * 100}%`;
  rhythmNote.style.top = `${(best ?? Math.max(pad, my - h / 2)) / H * 100}%`;
}

// Name and element under the revealed star.
function placeCaption() {
  const { x, y } = delivery.start;
  caption.style.top = `${(1 - (y - STAR_DELIVERY.revealSize * 1.1)) / 2 * 100 + 5}%`;
  caption.style.left = `${(x + 1) / 2 * 100}%`;
}

export { buildConstellations, updateConstellations, canLeaveSky, lookUpAim, run as constellationRun, all as constellations };
