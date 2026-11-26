// Scene build: loads the artwork and assembles every layer, effect and sprite.
import * as THREE from 'three';
import { AMBIENT, CHAR_SHADOW, SKY_DOME, SKY_LOOK, SKY_MOON, SHADOWS, ART_ASPECT, ART_H, ART_W, CHAR_FOOT_PAD, CHAR_RECT, CHAR_WALK, CHAR_LEAVES, DEPTH, DEPTH_SORTED, LAYER_ART, MIDGROUND_PROPS, MIDGROUND_SPREAD, PAN_WEIGHT, STAR_FAMILIES, TELESCOPE, GLOW_PROP_MIN_AREA } from './config.js';
import { camera, frameAt, loadImage, makeTexture } from './core.js';
import { addCityGlow, addFog, addGlows, animated, findGlows, fxMats } from './effects.js';
import { addLayer, addPoints, addSkyDome, buildSky, cropChild, enableFireflyLight, enableRowScroll, layerAttach, layerBackdrop, layers, registerParallax, skylineOf, stackImages } from './layers.js';
import { addStars, initMeteors } from './stars.js';
import { addUnderside } from './rig.js';
import { addCard, addCardButtons, bts } from './bts.js';
import { buildNets } from './netStars.js';
import { buildCharms } from './netCharms.js';
import { buildCollect } from './collect.js';
import { addAnchors } from './anchors.js';
import { buildTelescope } from './telescope.js';
import { buildGreenhouse } from './greenhouse.js';
import { buildShadows } from './shadows.js';
import { applySkyLook } from './skyLook.js';
import { buildConstellations } from './constellation.js';
import { buildAmbient, floaters } from './ambient.js';

// White round blob (the material gives color and strength): solid up to 1 - softness of the radius,
// then a smooth falloff to the rim.
function shadowTexture(softness = CHAR_SHADOW.softness, tex) {
  const c = tex?.image || document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64), core = 1 - softness;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, r = core + (1 - core) * t;
    grad.addColorStop(Math.min(r, 1), `rgba(255,255,255,${1 - THREE.MathUtils.smoothstep(t, 0, 1)})`);
  }
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  if (tex) { tex.needsUpdate = true; return tex; }
  return new THREE.CanvasTexture(c);
}

const A = window.STAR_GARDEN_ASSETS;
let character;

// Pan Orbit weight for a plane between the rooftop and the fog, interpolated in 1/depth like the screen motion.
function propWeight(d) {
  const t = (1 / DEPTH.midground - 1 / d) / (1 / DEPTH.midground - 1 / DEPTH.fog);
  return PAN_WEIGHT.midground + (PAN_WEIGHT.fog - PAN_WEIGHT.midground) * t;
}
const PROP_BEHIND = 5.6, PROP_IN_FRONT = 6.2;   // draw order of depth-sorted props vs. the character (6)

// A prop's opaque area in composition px (scanned at 1/4 size), plus a transparent margin so the floor row scroll
// never shifts the art off its cropped plane. Returns the crop rect and the cropped canvas.
const CROP_SCAN = 4, CROP_PAD = [160, 80];
function cropProp(img) {
  const W = ART_W / CROP_SCAN, H = ART_H / CROP_SCAN;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const a = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 0) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const crop = [Math.max(0, x0 * CROP_SCAN - CROP_PAD[0]), Math.max(0, y0 * CROP_SCAN - CROP_PAD[1]),
    Math.min(ART_W, (x1 + 1) * CROP_SCAN + CROP_PAD[0]), Math.min(ART_H, (y1 + 1) * CROP_SCAN + CROP_PAD[1])];
  const out = document.createElement('canvas');
  out.width = crop[2] - crop[0]; out.height = crop[3] - crop[1];
  out.getContext('2d').drawImage(img, crop[0], crop[1], out.width, out.height, 0, 0, out.width, out.height);
  return { crop, canvas: out };
}

// The character sprite without its hat leaves, and the leaves on their own canvas (with x / y: where it sat).
function splitHatLeaves(img) {
  const poly = CHAR_LEAVES.poly, xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys)), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const outline = g => { g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  const base = document.createElement('canvas'); base.width = img.width; base.height = img.height;
  const b = base.getContext('2d');
  b.drawImage(img, 0, 0);
  b.globalCompositeOperation = 'destination-out'; outline(b); b.fill();
  const leaves = document.createElement('canvas'); leaves.width = x1 - x0; leaves.height = y1 - y0;
  const l = leaves.getContext('2d');
  l.translate(-x0, -y0); outline(l); l.clip(); l.drawImage(img, 0, 0);
  leaves.x = x0; leaves.y = y0;
  return { base, leaves };
}

async function build() {
  const names = new Set([...Object.values(LAYER_ART).flat(), 'character', CHAR_WALK.image, SKY_MOON.image, ...Object.values(STAR_FAMILIES).map(f => f.image),
    ...DEPTH_SORTED.map(p => p.image), ...MIDGROUND_PROPS.flatMap(p => p.image), ...SHADOWS.casters.flat()]);
  const imgs = Object.fromEntries(await Promise.all([...names].map(async k => [k, await loadImage(A[k])])));
  const [sky, cityFar, city, mid, fore] = ['sky', 'cityFar', 'city', 'midground', 'foreground']
    .map(k => stackImages(LAYER_ART[k].map(n => imgs[n])));
  const chr = imgs.character;

  const skyData = buildSky(sky, imgs[SKY_MOON.image]);
  bts.dome = addSkyDome(skyData.topColor);


  layers.sky = addLayer(makeTexture(skyData.canvas, true), DEPTH.sky, 2, PAN_WEIGHT.sky, 0.1, 0);     // no vertical mirror: it would repeat the faded top edge
  layerBackdrop(layers.sky).group.add(layers.sky.obj);   // the painted sky drifts like the far city (rig.js turnLayers)
  // Sparkles (stars, glints) stay this far above the near + far city; see SKY_LOOK.stars.skylineGap.
  const skyline = skylineOf([cityFar, city]), gap = SKY_LOOK.stars.skylineGap;
  layers.sky.clearOfCity = (fx, fy) => fy > skyline(fx, gap.x) + gap.y;
  // Stars above the painted sky, revealed when panning up. They sit on the sky layer's plane extended
  // upwards (behind the sky image, which hides them until its faded top edge), so they slide and dolly
  // exactly like the sky. Sampled by elevation angle so they look evenly spread when looking up.
  {
    const { w, depth } = layers.sky, flatEl = () => THREE.MathUtils.degToRad(12 + Math.pow(Math.random(), 0.7) * 74);
    // Sky dome (SKY_DOME.on): the same stars all the way around, on a sphere about where the camera rests (the
    // sky layer's plane lies `depth` in front of it). Each elevation keeps the flat plane's density straight ahead:
    // the plane's rows span ±atan(2.4 w / depth) of view, a dome ring 360° × cos(elevation) (so a draw is kept with
    // chance cos(el)); same elevations, sizes and mix, so the front looks as before.
    const span = Math.atan(2.4 * w / depth), R = SKY_DOME.radius;
    const upper = SKY_DOME.on ? addStars({
      count: Math.round(5400 * Math.PI / span * 0.53), order: 1, parent: layers.sky.group,   // 0.53 = the mean kept share
      place: (v) => {
        const el = flatEl(), az = Math.random() * Math.PI * 2;
        if (Math.random() > Math.cos(el)) return false;
        v.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el), depth - R * Math.cos(el) * Math.cos(az));
      },
    }) : addStars({
      // three times as wide as the first version (and three times as many, so just as dense), a little higher:
      // searching by hand (dragSearch.js) reaches well to the sides and up
      count: 5400, order: 1, parent: layers.sky.group,
      place: (v) => {
        const el = flatEl();
        v.set((Math.random() - 0.5) * 4.8 * w / Math.cos(el), depth * Math.tan(el), -0.3);
      },
    });
    layers.sky.followers.push(upper);
    animated.push(upper.material);
    upper.material.userData.btsFade = true;   // fades out in Behind the Scenes (it lies outside the sky card)
  }

  // Stars over the painted sky, attached to the sky layer (the city covers the ones behind buildings).
  {
    const { w, h } = layers.sky, moon = { x: AMBIENT.moon[0] / ART_W - 0.5, y: 0.5 - AMBIENT.moon[1] / ART_H };
    const field = addStars({
      count: 480, order: 2.1, parent: layerBackdrop(layers.sky).group, onBackdrop: true,
      place: (v, st) => {
        for (let tries = 0; tries < 30; tries++) {   // twinkle stars look again until they're clear of the roofs
          const fx = (Math.random() - 0.5) * 1.2, fy = 0.5 - Math.random() * 0.7;   // frame coords, top 70%
          if (Math.hypot(fx - moon.x, (fy - moon.y) / ART_ASPECT) < 0.05) continue;    // keep the moon clear
          if (st.kind === 'twinkle' && !layers.sky.clearOfCity(fx, fy)) continue;     // only dots near the roofs
          v.set(fx * w, fy * h, 0.5);
          return true;
        }
        return false;
      },
    });
    layers.sky.followers.push(field);
    fxMats.push(field.material);
  }
  initMeteors();

  layers.cityFar = addLayer(makeTexture(cityFar, true), DEPTH.cityFar, 2.5, PAN_WEIGHT.cityFar, 1, 0);   // a mirrored copy each side: the search swing drifts it far
  addGlows(layers.cityFar, findGlows(cityFar), { order: 2.6, intensity: 0.35, speed: 0.3, group: 'background' });   // distant windows

  layers.cityGlowFar = addCityGlow('far');   // warm light from the streets, behind the near city's roofs

  layers.city = addLayer(makeTexture(city, true), DEPTH.city, 3, PAN_WEIGHT.city, 1, 0);   // horizontal only: mirroring vertically flips the skyline into the sky
  // How far above the roofs a world point shows on screen right now (frame heights; < 0 = over a building),
  // through the camera onto the near and far city as they are placed this frame, so parallax (Pan Up,
  // orbit) is included. Shooting stars fade out before the roofs with it.
  {
    const roofs = [[layers.cityFar, skylineOf([cityFar])], [layers.city, skylineOf([city])]];
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector3(), loc = new THREE.Vector3();
    layers.sky.aboveRoofs = world => {
      ndc.copy(world).project(camera);
      ray.setFromCamera(ndc, camera);
      let lowest = Infinity;
      for (const [item, top] of roofs) {
        const hit = ray.intersectObject(item.obj, false)[0];
        if (!hit) continue;
        item.obj.worldToLocal(loc.copy(hit.point));
        lowest = Math.min(lowest, loc.y / item.h - top(loc.x / item.w, 0.02));
      }
      return lowest;
    };
  }

  addGlows(layers.city, findGlows(city), { order: 3.2, intensity: 0.45, speed: 0.35, group: 'background' });   // windows: slow breathing
  layers.fog = addFog();
  layers.cityGlowNear = addCityGlow('near');   // and just behind the rooftop

  // Glow motes between skyline and rooftop.
  const fBack = frameAt(28);
  const motesBack = addPoints({
    count: 40, order: 4.6, size: 5, drift: 0.8,
    place: (v) => v.set((Math.random() - 0.5) * fBack.w, (Math.random() - 0.6) * fBack.h * 0.7, -(16 + Math.random() * 20)),
    color: (c) => c.setHSL(Math.random() < 0.5 ? 0.55 : 0.1, 0.9, 0.65),
  });
  animated.push(motesBack.material);
  layers.motesBack = registerParallax(motesBack, 28, PAN_WEIGHT.motesBack);

  layers.midground = addLayer(makeTexture(mid, true), DEPTH.midground, 5, PAN_WEIGHT.midground, 0.05, 0);   // slim mirror margin for max pan range

  enableRowScroll(layers.midground.obj.material);

  // Props standing on the floor, each on its own plane (MIDGROUND_PROPS). They keep the floor's row
  // scrolling, and their glows (lamps, greenhouse light) ride on the prop they belong to.
  MIDGROUND_PROPS.forEach((p, i) => {
    const depth = DEPTH.midground + (p.depth - DEPTH.midground) * MIDGROUND_SPREAD;
    const own = p.apart || [], stacked = [p.image].flat().filter(n => !own.includes(n));
    const img = stackImages(stacked.map(n => imgs[n]));   // a list of images = one stacked texture
    const order = p.order ?? 5 + (i + 1) * 0.015;   // stays below the lamp glows (5.2)
    const { crop, canvas } = p.fullFrame ? { crop: null, canvas: img } : cropProp(img);
    const item = layers[p.name] = addLayer(makeTexture(canvas), depth, order, propWeight(depth), 0, 0, crop);
    if (p.rowScroll !== false) enableRowScroll(item.obj.material, true, p.wind);   // off: only for fullFrame props (crops need it)
    item.order = order;
    item.apart = Object.fromEntries(own.map((n, j) => {   // its own plane each, right on top of the prop (see MIDGROUND_PROPS)
      const c = cropProp(imgs[n]);
      return [n, cropChild(item, makeTexture(c.canvas), order + 0.001 * (j + 1), c.crop)];
    }));
    const glows = p.glows === false ? [] : findGlows(img, GLOW_PROP_MIN_AREA);   // real lamps only, not shiny knobs or ornaments
    if (glows.length) addGlows(item, glows, { order: 5.2, intensity: 0.75, speed: 1, group: 'midground' });   // lamps: livelier flicker
  });
  buildNets(imgs, buildCharms(imgs.midground_poles));   // the charms under the nets cut out to swing
  buildShadows(imgs);

  // Props the character can walk behind: same plane and floor row-scroll as the midground, own draw order.
  for (const prop of DEPTH_SORTED) {
    const { w, h } = layers.midground;
    const mat = new THREE.MeshBasicMaterial({ map: makeTexture(imgs[prop.image]), transparent: true, depthWrite: false });
    enableRowScroll(mat);
    prop.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    prop.mesh.position.z = 0.002;
    prop.mesh.renderOrder = PROP_BEHIND;
    layerAttach(layers.midground).add(prop.mesh);
  }
  buildTelescope(imgs[TELESCOPE.image]);
  buildGreenhouse(imgs.midground_greenhouse);

  // Character as its own plane just in front of the rooftop, anchored at the feet.
  {
    const d = DEPTH.character, f = frameAt(d);
    const w = CHAR_RECT.w / ART_W * f.w, h = CHAR_RECT.h / ART_H * f.h;
    const geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
    const { base: chrBase, leaves: leafCv } = splitHatLeaves(chr);
    const mat = new THREE.MeshBasicMaterial({ map: makeTexture(chrBase), transparent: true, depthWrite: false });
    character = new THREE.Mesh(geo, mat);
    const footX = (CHAR_RECT.x + CHAR_RECT.w / 2) / ART_W, footY = (CHAR_RECT.y + CHAR_RECT.h) / ART_H;
    character.position.set((footX - 0.5) * f.w, (0.5 - footY) * f.h, -d);
    character.renderOrder = 6;
    // Blob shadow at the feet: a unit plane, sized, placed and kept flat by poseWalker (CHAR_SHADOW).
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), color: CHAR_SHADOW.color, transparent: true, depthWrite: false }));
    shadow.position.set(0, h * CHAR_FOOT_PAD, -0.001);
    shadow.scale.set(w * CHAR_SHADOW.width, w * CHAR_SHADOW.height, 1);
    shadow.renderOrder = 5.8;
    character.add(shadow);
    character.userData.shadow = shadow;
    character.userData.size = { w, h };
    // Walk cycle: a child plane showing one cell of the sprite sheet (walk.js picks the frame and swaps it in).
    const wh = h * CHAR_WALK.height, ww = wh * CHAR_WALK.aspect;
    const sheet = makeTexture(imgs[CHAR_WALK.image]);
    sheet.repeat.set(1 / CHAR_WALK.cols, 1 / CHAR_WALK.rows);
    const walkSprite = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh).translate(0, wh / 2, 0),
      new THREE.MeshBasicMaterial({ map: sheet, transparent: true, depthWrite: false }));
    walkSprite.position.set(CHAR_WALK.offsetX * w, h * CHAR_FOOT_PAD - wh * CHAR_WALK.footPad, 0);   // boots on the same line
    walkSprite.renderOrder = 6;
    walkSprite.visible = false;
    character.add(walkSprite);
    character.userData.walkSprite = walkSprite;
    // The hat's leaves: their own plane on a pivot at the stem's foot, so walk.js can sway them (CHAR_LEAVES).
    {
      const k = w / chr.width, [px, py] = CHAR_LEAVES.pivot;
      const pivot = new THREE.Group();
      pivot.position.set((px / chr.width - 0.5) * w, (1 - py / chr.height) * h, 0.0005);
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(leafCv.width * k, leafCv.height * k),
        new THREE.MeshBasicMaterial({ map: makeTexture(leafCv), transparent: true, depthWrite: false }));
      leaf.position.set((leafCv.x + leafCv.width / 2 - px) * k, (py - leafCv.y - leafCv.height / 2) * k, 0);
      leaf.renderOrder = 6.01;
      pivot.add(leaf);
      character.add(pivot);
      character.userData.leaves = pivot;
    }
    for (const m of [mat, walkSprite.material, character.userData.leaves.children[0].material]) enableFireflyLight(m);   // lit by the fireflies too
    layers.character = registerParallax(character, d, PAN_WEIGHT.character);
    buildCollect(character);   // satchel glow, jars, hint ring
  }

  // Glow motes drifting over the garden, in front of the rooftop.
  const fNear = frameAt(9.5);
  const motesNear = addPoints({
    count: 22, order: 7, size: 6, drift: 0.25,
    place: (v) => v.set((Math.random() - 0.5) * fNear.w * 0.9, (Math.random() - 0.45) * fNear.h * 0.6, -(8.5 + Math.random() * 2.5)),
    color: (c) => c.setHSL(Math.random() < 0.6 ? 0.52 : 0.09, 0.95, 0.7),
  });
  animated.push(motesNear.material);
  layers.motesNear = registerParallax(motesNear, 9.5, PAN_WEIGHT.motesNear);

  layers.foreground = addLayer(makeTexture(fore), DEPTH.foreground, 8, PAN_WEIGHT.foreground);
  addUnderside();
  addAnchors();
  applySkyLook(addStars);   // after the anchors: the Milky Way is placed with the sky-field helper
  buildConstellations();
  buildAmbient();   // glints, moon halo, wisps, stardust, steam, fireflies (ambient.js)

  // Behind the Scenes cards, 0 = front (bottom-left) … 7 = back (top-right). The free-floating effects (fireflies,
  // motes, the near street glow) ride on the card nearest their depth; those attached to a layer are on its card.
  const roofFlies = floaters.filter(f => f.depth < DEPTH.midground + 1), farFlies = floaters.filter(f => !roofFlies.includes(f));
  addCard(layers.foreground, 'foreground', 0, 'Foreground', 'Wall and ladder, right in front of the camera');
  addCard(layers.character, 'character', 1, 'Character', 'Walk cycle, swaying hat leaves, soft shadow',
    [layers.motesNear]);
  addCard(layers.midground, 'midground', 2, 'Midground', 'Rooftop garden: props on their own planes, telescope, nets, shadows, fireflies',
    [...MIDGROUND_PROPS.map(p => layers[p.name]), ...roofFlies]);
  addCard(layers.fog, 'fog', 3, 'Fog & glow', 'Drifting mist, street glow behind the roof, fireflies',
    [layers.cityGlowNear, layers.motesBack, ...farFlies]);
  addCard(layers.city, 'city', 4, 'Near city', 'Buildings behind the roof, with breathing windows');
  addCard(layers.cityGlowFar, 'cityGlow', 5, 'Street glow', 'Warm light from the streets, slowly swelling');
  addCard(layers.cityFar, 'cityFar', 6, 'Far city', 'Distant skyline, slower than the near city');
  addCard(layers.sky, 'sky', 7, 'Sky', 'Moon with halo, wisps, glinting stars; almost static');
  addCardButtons();
}

export { shadowTexture, A, character, PROP_BEHIND, PROP_IN_FRONT, build };
