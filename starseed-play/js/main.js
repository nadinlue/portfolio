// Entry point: sizes the 16:9 stage, builds the scene, runs the render loop.
import * as THREE from 'three';
import { $ } from './util.js';
import { ANCHORS, ART_ASPECT, DEPTH, LOADER_FADE_MS, OVERSCAN, PAN_WEIGHT, SKY_FIELD, settings } from './config.js';
import { TAN_FIT, camera, renderer, scene, stage, viewport } from './core.js';
import { animated, fxMats, updateGlowViewport } from './effects.js';
import { layers, rowScroll, windTime } from './layers.js';
import { updateMeteors } from './stars.js';
import { crane, dolly, orbit, pan, panTo, rise, riseFromBelow, updateCamera, view } from './rig.js';
import { bts, updateLabels } from './bts.js';
import { anchorWorld, showAnchors } from './anchors.js';
import { build, character } from './scene.js';
import { poseWalker, updateWalk, walker } from './walk.js';
import { updateTelescope } from './telescope.js';
import { updateGreenhouse } from './greenhouse.js';
import { game, startSkyView } from './modes.js';
import { skyView } from './skyView.js';
import { constellationRun, constellations, updateConstellations } from './constellation.js';
import { updateNetStars } from './netStars.js';
import { updateDelivery } from './delivery.js';
import { updateCollect } from './collect.js';
import { firstTime, updateFirstTime } from './firstTime.js';
import { updateJars } from './jars.js';
import { plantRecords, updatePlanting } from './planting.js';
import { starBook } from './starBook.js';
import { renderFireflyLight, updateAmbient } from './ambient.js';
import { cityEvent, updateCitySound } from './citySound.js';
import { roofPlants, updateRoofGarden } from './roofGarden.js';
import { starRecords } from './starRecords.js';
import { setMode } from './ui.js';
import { gameReady, startScreenError } from './startScreen.js';
import './input.js';   // mouse, wheel and keyboard handlers

function resize() {
  // Largest 16:9 area that fits the window; the rest stays black.
  const w = Math.floor(Math.min(window.innerWidth, window.innerHeight * ART_ASPECT));
  const h = Math.floor(w / ART_ASPECT), aspect = w / h;
  viewport.w = w; viewport.h = h;
  stage.style.setProperty('--stage-w', `${w}px`);
  stage.style.setProperty('--stage-h', `${h}px`);
  // Centred on whole pixels (style.css .stage: a half pixel let the rooftop flicker through the greenhouse's edge).
  stage.style.setProperty('--stage-x', `${Math.floor((window.innerWidth - w) / 2)}px`);
  stage.style.setProperty('--stage-y', `${Math.floor((window.innerHeight - h) / 2)}px`);
  // Cover the viewport with the 16:9 composition, cropped by OVERSCAN.
  let tanV = TAN_FIT / OVERSCAN;
  if (aspect > ART_ASPECT) tanV *= ART_ASPECT / aspect;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  updateGlowViewport();
}

window.addEventListener('resize', resize);
resize();

build().then(async () => {
  rise.value = 1;   // first frame is already the black underside behind the start screen
  updateGlowViewport();
  const readout = $('readout');
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1), now = performance.now() / 1000;
    updateWalk(dt);
    updateCamera(dt, now);
    poseWalker();
    updateTelescope(dt);
    updateGreenhouse(dt);
    updateMeteors(dt);
    updateConstellations(dt, now, game.mode === 'sky');
    updateDelivery(dt);
    updateNetStars(dt);
    updateFirstTime();
    updateCollect(dt, now, game.mode);
    updateJars(dt, now);
    updatePlanting(dt, now);
    updateRoofGarden(dt, now);
    updateAmbient(dt);
    updateCitySound();
    for (const m of animated) m.uniforms.uTime.value = now;
    for (const m of fxMats) m.uniforms.uTime.value = now;
    windTime.value = now;   // fairy lights swaying (WIND)
    if (character) character.scale.y *= 1 + Math.sin(now * 1.6) * 0.008;   // idle breathing (on top of dolly scale)
    updateLabels();
    readout.textContent = `Zoom ${view.zoom.toFixed(2)}× · Dolly ${Math.round(dolly.t * 100)}%`;
    renderFireflyLight(renderer, scene, camera);   // the fireflies' light on the roof, read by the roof art below
    renderer.render(scene, camera);
  });
  // The start screen offers Play; once pressed it fades to black, then the camera rises to the roof.
  await gameReady();
  await new Promise(r => setTimeout(r, LOADER_FADE_MS));
  if (skyView) startSkyView();   // the sky on its own (index.html?sky)
  else if (rise.value === 1 && !rise.active) riseFromBelow();
}).catch(err => { startScreenError('Failed to load assets: ' + err); console.error(err); });

// Expose for tuning from the devtools console.
window.starGarden = { camera, orbit, pan, crane, rise, view, dolly, bts, settings, layers, rowScroll, panTo, setMode, DEPTH, PAN_WEIGHT,
  ANCHORS, SKY_FIELD, anchorWorld, showAnchors, walker, game, constellationRun, constellations, starRecords, plantRecords, roofPlants, cityEvent, firstTime, starBook };
