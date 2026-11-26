// Parallax layers: registration, full-frame artwork planes, sky, point sprites, row scrolling.
import * as THREE from 'three';
import { AMBIENT, ART_ASPECT, ART_H, ART_W, PAN_WEIGHT, SKY_MOON, SKY_PARALLAX, WIND, settings } from './config.js';
import { frameAt, pointScale, renderer, scene } from './core.js';

const layers = {};   // parallax items by name, filled by the scene build
// Live sky parallax (SKY_PARALLAX): uParW = the turn of the sky at speed 1 (axis × radians, set by rig.js), the rest how
// much of it each part takes. The star fields read these in their shader.
const skyParallax = { uParW: { value: new THREE.Vector3() }, uParFar: { value: SKY_PARALLAX.stars[0] }, uParNear: { value: SKY_PARALLAX.stars[1] },
  uParBackdrop: { value: SKY_PARALLAX.backdrop }, uParMilkyWay: { value: SKY_PARALLAX.milkyWay } };

// A full-frame layer. `ex`/`ey` grow the plane past the artwork on each side
// (fraction of its size), filling the extra area with mirrored artwork.
// Everything that slides in Pan Orbit mode. Each object sits in its own group, which stays at
// identity in the game view; Behind the Scenes moves the group to lay the layer out as a card.
// The group sits in `turn`, which the rig turns along with the telescope's sideways swing in the sky, so
// the city and the roof only drift a little while the sky turns fully (rig.js, turnLayers).
const parallax = [];
function registerParallax(obj, depth, weight, ex = 0) {
  const { w, h } = frameAt(depth);
  const turn = new THREE.Group(), group = new THREE.Group();
  scene.add(turn);
  turn.add(group);
  group.add(obj);
  // followers: effect objects that copy the layer's slide and dolly (but not the BTS crop).
  // strength: parallax multiplier, set by the Behind the Scenes card sliders (1 = true depth).
  const item = { obj, group, turn, base: obj.position.clone(), depth, w, h, weight, ex, strength: 1, followers: [] };
  parallax.push(item);
  return item;
}

// `crop` = [x0, y0, x1, y1] in composition px: the plane covers only that part of the frame and `tex` holds only
// that part (small props without a full 4K texture each). The UVs stay full-frame, so the row scroll works the
// same; the material must use enableRowScroll, which maps them into the cropped texture.
function addLayer(tex, depth, order, weight, ex = 0, ey = 0, crop = null) {
  const { w, h } = frameAt(depth);
  const kx = 1 + 2 * ex, ky = 1 + 2 * ey;
  let geo, cropUv = null;
  if (crop) {
    const [u0, u1, v0, v1] = [crop[0] / ART_W, crop[2] / ART_W, 1 - crop[3] / ART_H, 1 - crop[1] / ART_H];
    geo = new THREE.PlaneGeometry((u1 - u0) * w, (v1 - v0) * h).translate(((u0 + u1) / 2 - 0.5) * w, ((v0 + v1) / 2 - 0.5) * h, 0);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    cropUv = new THREE.Vector4(u0, v0, 1 / (u1 - u0), 1 / (v1 - v0));
  } else {
    geo = new THREE.PlaneGeometry(w * kx, h * ky);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * kx - ex, uv.getY(i) * ky - ey);
  }
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  if (cropUv) mat.userData.cropUv = cropUv;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, -depth);
  mesh.renderOrder = order;
  return registerParallax(mesh, depth, weight, ex);
}

// Sky canvas: the moon drawn in (SKY_MOON, at AMBIENT.moon), the top edge faded so it melts into the procedural sky
// dome above it.
function buildSky(img, moon = null) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  if (moon) {
    const k = SKY_MOON.scale, [cx, cy] = SKY_MOON.centre, [x, y] = AMBIENT.moon;
    g.drawImage(moon, x - cx * k, y - cy * k, moon.width * k, moon.height * k);
  }
  const top = g.getImageData(0, 0, c.width, 8).data;
  let r = 0, gg = 0, b = 0, n = top.length / 4;
  for (let i = 0; i < top.length; i += 4) { r += top[i]; gg += top[i + 1]; b += top[i + 2]; }
  const topColor = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createLinearGradient(0, 0, 0, c.height * 0.12);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  return { canvas: c, topColor };
}

function addSkyDome(horizonColor) {
  const zenith = new THREE.Color().setRGB(3 / 255, 20 / 255, 66 / 255, THREE.SRGBColorSpace);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uHorizon: { value: horizonColor }, uZenith: { value: zenith }, uStudio: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uStudio; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        float t = smoothstep(0.24, 0.95, vDir.y);
        vec3 c = mix(uHorizon, uZenith, pow(t, 0.85));
        vec3 studio = mix(vec3(0.012, 0.013, 0.028), vec3(0.03, 0.032, 0.06), smoothstep(-0.4, 0.6, vDir.y));
        c = mix(c, studio, uStudio);   // dark backdrop for Behind the Scenes
        c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;   // dither against banding
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), mat);
  dome.renderOrder = 0;
  scene.add(dome);
  return mat;
}

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Twinkling points. Used for stars in the upper sky and for drifting glow motes.
function addPoints({ count, order, place, color, size, drift = 0 }) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), seed = new Float32Array(count);
  const tmp = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    place(tmp, i); tmp.toArray(pos, i * 3);
    color(c, i); c.toArray(col, i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSize: { value: size }, uDrift: { value: drift },
      uPixelRatio: pointScale, uMap: { value: softDot() }, uFade: { value: 1 } },   // scales with the game view
    vertexShader: `attribute vec3 aColor; attribute float aSeed; uniform float uTime, uSize, uDrift, uPixelRatio;
      varying vec3 vColor; varying float vAlpha;
      void main(){
        vec3 p = position;
        float ph = aSeed * 6.2831;
        p += uDrift * vec3(sin(uTime*0.31 + ph*3.0), sin(uTime*0.23 + ph*5.0), cos(uTime*0.27 + ph*2.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vAlpha = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 2.2) + ph);
        vColor = aColor;
        gl_PointSize = uSize * uPixelRatio * (0.6 + aSeed * 0.8) * (uDrift > 0.0 ? 12.0 / -mv.z : 1.0);
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uFade; varying vec3 vColor; varying float vAlpha;
      void main(){ float a = texture2D(uMap, gl_PointCoord).a * vAlpha * uFade; gl_FragColor = vec4(vColor * a, a); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = order;
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
}

// Row scrolling (Pan Orbit): floor rows of the midground slide by different amounts, from the
// midground's weight at the back edge of the floor to settings.rowNearWeight at the bottom of the
// frame. Pan weight changes linearly with screen row, like inverse depth on a flat floor.
// settings.rowFloorTop: frame row (0 = top, 1 = bottom) where the floor starts. Both set by sliders.

// Row scrolling: shear the floor part of a layer per row in its fragment shader.
const rowScroll = { enabled: false, mix: 0,
  uniforms: { uRowShift: { value: 0 }, uFloorTop: { value: settings.rowFloorTop },
    uRowShiftY: { value: 0 }, uFloorTopY: { value: settings.vRowFloorTop } },
  enabledY: true, mixY: 1 };
const rowWeight = row => PAN_WEIGHT.midground + (settings.rowNearWeight - PAN_WEIGHT.midground) *
  THREE.MathUtils.clamp((row - settings.rowFloorTop) / (1 - settings.rowFloorTop), 0, 1);

// The fireflies' light (ambient.js renderFireflyLight draws it each frame): a screen-size light map, added onto the
// painted roof art in proportion to its own colour, so things near a firefly look lit rather than glowed over.
const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
black.needsUpdate = true;
const flyLight = { uFlyLight: { value: black }, uFlyLightOn: { value: 0 }, uFlyLightRes: { value: new THREE.Vector2(1, 1) } };
const FLY_LIGHT_HEAD = '\nuniform sampler2D uFlyLight; uniform float uFlyLightOn; uniform vec2 uFlyLightRes;';
const FLY_LIGHT = '\ndiffuseColor.rgb += diffuseColor.rgb * texture2D(uFlyLight, gl_FragCoord.xy / uFlyLightRes).rgb * uFlyLightOn;';
// For a plain sprite material (the character): only the firefly light.
function enableFireflyLight(mat) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, flyLight);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + FLY_LIGHT_HEAD)
      .replace('#include <map_fragment>', '#include <map_fragment>' + FLY_LIGHT);
  };
  mat.needsUpdate = true;
}

// lit: false = the firefly light leaves it alone (the floor shadows). wind: a WIND entry's name: the art sways softly
// (its time comes from the render loop: windTime, main.js).
const windTime = { value: 0 };
function enableRowScroll(mat, lit = true, wind = null) {
  const W = wind && WIND[wind];
  // One compiled shader per variant: three.js would otherwise share the first one built from this function.
  mat.customProgramCacheKey = () => `rowScroll:${lit ? 1 : 0}:${wind || ''}`;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, rowScroll.uniforms, lit ? flyLight : {});
    // Cropped layer (addLayer `crop`): full-frame UV → UV in the cropped texture. Identity otherwise.
    shader.uniforms.uCrop = { value: mat.userData.cropUv || new THREE.Vector4(0, 0, 1, 1) };
    if (W) shader.uniforms.uTime = windTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRowShift, uFloorTop, uRowShiftY, uFloorTopY;\nuniform vec4 uCrop;' +
        (lit ? FLY_LIGHT_HEAD : '') + (W ? '\nuniform float uTime;' : ''))
      .replace('#include <map_fragment>', `
        vec2 rowUv = vMapUv;${W ? windShift(W) : ''}
        float rowT = clamp(((1.0 - rowUv.y) - uFloorTop) / (1.0 - uFloorTop), 0.0, 1.0);   // 0 at floor's back edge, 1 at bottom
        rowUv.x -= uRowShift * rowT;
        // Vertical: rows nearer the bottom drop further, so the floor stretches open as the camera rises.
        float rowTY = clamp(((1.0 - vMapUv.y) - uFloorTopY) / (1.0 - uFloorTopY), 0.0, 1.0);
        rowUv.y += uRowShiftY * rowTY;
        diffuseColor *= texture2D(map, (rowUv - uCrop.xy) * uCrop.zw);${lit ? FLY_LIGHT : ''}`);
  };
  mat.needsUpdate = true;
}

// Wind (WIND): gusts sweeping left to right. At each point s = seconds since the current gust reached it; the push
// rises and falls as u·e^(1-u) (u = s / rise) minus a later, smaller back-swing, faded out before the next gust; the
// dangle is a damped quick swing on top. Shifts the full-frame UV, fading out at the tie points.
function windShift(W) {
  const f = v => v.toFixed(5);
  const near = W.anchors.map(a => `abs(px - ${f(a)})`).reduce((a, b) => `min(${a}, ${b})`);
  return `
        {
          float px = rowUv.x * ${f(ART_W)};
          float hold = smoothstep(0.0, ${f(W.fade)}, ${near});
          float s0 = uTime - px / ${f(ART_W / W.travel)}, n = floor(s0 / ${f(W.every)}), s = s0 - n * ${f(W.every)};
          float strength = 0.65 + 0.35 * fract(sin(n * 12.9898) * 43758.5453);   // each gust a little different
          float u = s / ${f(W.rise)};
          float push = (u * exp(1.0 - u) - 0.25 * (u / 3.0) * exp(1.0 - u / 3.0)) * (1.0 - smoothstep(${f(0.6 * W.every)}, ${f(W.every)}, s));
          float dangle = ${f(W.dingle)} * sin(6.2832 * (${f(W.dingleHz)} * s + px / ${f(W.dingleWave)})) * exp(-s / ${f(W.dingleSec)}) * smoothstep(0.0, ${f(W.rise)}, s);
          float a = ${f(W.amp)} * hold;
          float dx = a * (strength * push + strength * dangle + ${f(W.idle)} * sin(uTime * 0.5 + px * 0.0019));
          float dy = a * (${f(W.lift)} * strength * push + ${f(W.idle)} * sin(uTime * 0.37 + px * 0.0013 + 1.1));
          rowUv -= vec2(dx / ${f(ART_W)}, dy / ${f(ART_H)});   // pushed right, lifted up (UV y runs up)
        }`;
}

// Group for things placed on a layer's artwork (markers, net stars). It follows the layer's slide and
// dolly like the glows do, but not the Behind the Scenes margin crop, which would squeeze it.
function layerAttach(item) {
  if (!item.attach) {
    item.attach = new THREE.Group();
    item.group.add(item.attach);
    item.followers.push(item.attach);
  }
  return item.attach;
}

// The sky's painted backdrop (the sky art with its moon, and what belongs to it: moon halo, wisps, the stars over the
// painted sky): a group inside the layer that the rig turns like the far city (rig.js turnLayers), while the rest of
// the sky (the star dome, the constellations, the chart) turns fully with the telescope. `attach` slides with the layer.
function layerBackdrop(item) {
  if (!item.backdrop) {
    const group = new THREE.Group(), attach = new THREE.Group();
    item.group.add(group);
    group.add(attach);
    item.followers.push(attach);
    item.backdrop = { group, attach };
  }
  return item.backdrop;
}

// Local position of a composition pixel on a layer (relative to its attach group).
function layerPoint(item, x, y, z = 0) {
  return new THREE.Vector3((x / ART_W - 0.5) * item.w, (0.5 - y / ART_H) * item.h, z);
}

// A plane on a layer's prop, showing `tex` over the composition rect `rect` ([x0, y0, x1, y1] px) with the same
// floor row scroll as the prop (UVs stay full-frame, the texture fills the rect). A child of the prop's plane, so it
// moves exactly with it; setCropRect moves or resizes it later (a plant dragged between spots).
function cropChild(item, tex, order, rect) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  mat.userData.cropUv = new THREE.Vector4(0, 0, 1, 1);
  enableRowScroll(mat);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = order;
  item.obj.add(mesh);
  if (rect) setCropRect(mesh, item, rect);
  return mesh;
}
function setCropRect(mesh, item, [x0, y0, x1, y1]) {
  const [u0, u1, v0, v1] = [x0 / ART_W, x1 / ART_W, 1 - y1 / ART_H, 1 - y0 / ART_H];
  mesh.scale.set((u1 - u0) * item.w, (v1 - v0) * item.h, 1);
  mesh.position.set(((u0 + u1) / 2 - 0.5) * item.w, ((v0 + v1) / 2 - 0.5) * item.h, 0);
  const uv = mesh.geometry.attributes.uv;
  [[u0, v1], [u1, v1], [u0, v0], [u1, v0]].forEach(([u, v], i) => uv.setXY(i, u, v));   // PlaneGeometry corner order
  uv.needsUpdate = true;
  mesh.material.userData.cropUv.set(u0, v0, 1 / (u1 - u0), 1 / (v1 - v0));
  mesh.userData.rect = [x0, y0, x1, y1];
}

// Stack full-frame images into one canvas (back to front). A single image is returned as is.
// Skyline of the city art: skylineTop(fx) = frame y (0.5 = top edge … -0.5 = bottom) of the highest
// opaque pixel of any of the images in that column. fx is a frame x (-0.5 … 0.5); outside the frame the
// art is mirrored, like the layers' overscan; `spread` (frame widths) takes the highest point within ±spread.
// Used to keep sparkle stars clear of the buildings.
function skylineOf(imgs, cols = 480) {
  const rows = Math.round(cols / ART_ASPECT), c = document.createElement('canvas'); c.width = cols; c.height = rows;
  const g = c.getContext('2d', { willReadFrequently: true });
  for (const img of imgs) g.drawImage(img, 0, 0, cols, rows);
  const a = g.getImageData(0, 0, cols, rows).data, top = new Float32Array(cols).fill(-0.5);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) if (a[(y * cols + x) * 4 + 3] > 24) { top[x] = 0.5 - y / rows; break; }
  }
  const at = fx => {
    let u = Math.abs(fx + 0.5); u = u > 1 ? 2 - u : u;   // mirrored outside the frame
    return top[Math.min(cols - 1, Math.max(0, Math.floor(u * cols)))];
  };
  return (fx, spread = 0) => {
    let hi = -0.5;
    for (let d = -spread; d <= spread + 1e-9; d += 1 / cols) hi = Math.max(hi, at(fx + d));
    return hi;
  };
}

function stackImages(imgs) {
  if (imgs.length === 1) return imgs[0];
  const c = document.createElement('canvas');
  c.width = imgs[0].width; c.height = imgs[0].height;
  const g = c.getContext('2d');
  for (const img of imgs) g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export { windTime, flyLight, enableFireflyLight, skylineOf, layers, skyParallax, parallax, registerParallax, addLayer, buildSky, addSkyDome, softDot, addPoints, rowScroll, rowWeight, enableRowScroll, layerAttach, layerBackdrop, layerPoint, stackImages, cropChild, setCropRect };
