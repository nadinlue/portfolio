// Dev UI: camera mode buttons, Settings panel, Dev toggle.
import * as THREE from 'three';
import { $ } from './util.js';
import { previewHintRing, redrawHintRing } from './collect.js';
import { CHAR_SHADOW, COLLECT, BTS_PITCH, BTS_RADIUS, BTS_YAW, CONSTELLATION_PLAY, CONSTELLATION_STYLE, MUSIC, CITY_SOUND, ROOF_GARDEN, SHADOWS, SKY_LOOK, STAR_CHART, STAR_DELIVERY, TELESCOPE, settings } from './config.js';
import { cityGlowShared, cityGlowStrength, fogShared, glowGroups, setGlowBlending } from './effects.js';
import { layers, rowScroll, skyParallax } from './layers.js';
import { crane, orbit, pan, panTo, resetZoom, rigEvents, riseFromBelow } from './rig.js';
import { bts } from './bts.js';
import { showAnchors } from './anchors.js';
import { SKY_STAR_CONTROLS, setSkyDotAmount, setSkyStarBlend, setSkyStarLook, setStarFieldAmount, setStarsVisible, starFields, spawnComet, spawnMeteor } from './stars.js';
import { milky, milkyArc, milkyStarLook, placeMilkyStars, pickSkyColor, setMilkyColor, setMilkyEdge, setMilkyFade, setMilkyOn, setSkyColorFade, sky, skyColor } from './skyLook.js';
import { previewReveal } from './delivery.js';
import { renderShadows, setShadowBlend, setShadowColor, setShadowOpacity } from './shadows.js';
import { TRACKS, musicMuted, setMusicMuted } from './music.js';
import { cityEvent, cricketsNow } from './citySound.js';
import { chimesMuted, setChimesMuted } from './chime.js';
import { addSectionButtons, applySavedSettings, getPref, readOnly, setPref } from './settingsStore.js';
import { BUILD } from './build.js';
import { setVignetteLook } from './vignette.js';
import { AMBIENT_EFFECTS, setAmbientAmount, setAmbientOn, setFireflyLook, setSkyFxLook } from './ambient.js';
import { SHAPE_KEYS, chartHooks, pulseChart, replayChart, setChartLook } from './starChart.js';
import { previewSpots, setSpotOffset } from './roofGarden.js';

// Music track picker: one option per file in js/music-tracks/; the default is MUSIC.track (for Reset).
for (const [key, t] of Object.entries(TRACKS)) $('musicTrack').add(new Option(t.name, key, key === MUSIC.track, key === MUSIC.track));
// Plant spots: a left/right and an up/down slider per roof spot (art px from its ROOF_GARDEN position), to line the
// plants up with the planters; built here so the saved values apply to them like to the rest.
const BED_NAMES = { bedLeftBack: 'left back', bedLeftFront: 'left front', bedMiddle: 'middle', greenhouseBed: 'greenhouse', seedlings: 'small box' };
{
  const spotsHtml = ROOF_GARDEN.spots.map((s, i) => `
    <label title="Spot ${i + 1} (${BED_NAMES[s.bed] || s.bed} bed): left / right"><span>Spot ${i + 1} · ${BED_NAMES[s.bed] || s.bed} ←→ <output id="spot${i}XOut"></output></span>
      <input type="range" id="spot${i}X" min="-80" max="80" step="1" value="0"></label>
    <label title="Spot ${i + 1} (${BED_NAMES[s.bed] || s.bed} bed): up / down"><span>Spot ${i + 1} · ${BED_NAMES[s.bed] || s.bed} ↑↓ <output id="spot${i}YOut"></output></span>
      <input type="range" id="spot${i}Y" min="-80" max="80" step="1" value="0"></label>`).join('');
  $('readout').insertAdjacentHTML('beforebegin', `
    <h3 title="Where the plants stand in the planters (ROOF_GARDEN.spots); shifts in art px">Plant spots</h3>
    <div class="section-actions"><button type="button" id="btnSpotPreview" aria-pressed="false" title="Put a planted plant on every free spot to line them up">Show a plant on every spot</button></div>
    ${spotsHtml}`);
}
applySavedSettings();   // saved Settings values first, so every binding below starts from them

let mode = 'none';                                     // dev camera mode: 'none' | 'orbit' | 'pan' | 'bts'

const btnOrbit = $('btnOrbit'), btnPanOrbit = $('btnPanOrbit'), btnBts = $('btnBts'), btnUp = $('btnUp'), btnDown = $('btnDown'), hint = $('hint');

// Modes are exclusive; leaving a mode eases its offsets back to center.
function setMode(next) {
  mode = next;
  if (mode !== 'orbit') orbit.targetYaw = orbit.targetPitch = 0;
  if (mode !== 'pan') pan.targetX = pan.targetY = 0;
  bts.target = mode === 'bts' ? 1 : 0;
  if (mode === 'bts') {
    panTo(0); resetZoom();
    bts.targetYaw = bts.yaw = BTS_YAW; bts.targetPitch = bts.pitch = BTS_PITCH; bts.targetRadius = bts.radius = BTS_RADIUS;
  }
  document.body.classList.toggle('orbit', mode !== 'none');
  document.body.classList.toggle('bts', mode === 'bts');
  updateUI();
}
const leaveBts = () => { if (mode === 'bts') setMode('none'); };
const toggleMode = m => setMode(mode === m ? 'none' : m);
const recenter = () => {
  orbit.targetYaw = orbit.targetPitch = 0; pan.targetX = pan.targetY = 0;
  bts.targetYaw = BTS_YAW; bts.targetPitch = BTS_PITCH; bts.targetRadius = BTS_RADIUS;
};

function updateUI() {
  btnOrbit.setAttribute('aria-pressed', String(mode === 'orbit'));
  btnPanOrbit.setAttribute('aria-pressed', String(mode === 'pan'));
  btnBts.setAttribute('aria-pressed', String(mode === 'bts'));
  btnUp.disabled = crane.to === 1;
  btnDown.disabled = crane.to === 0;
  hint.textContent = mode === 'orbit' ? 'Drag to orbit the 3D camera · double-click to recenter'
    : mode === 'pan' ? 'Drag to slide the 2D parallax layers · double-click to recenter · try Row-scroll floor in Settings'
    : mode === 'bts' ? 'Drag to rotate · scroll to move closer · click Behind the Scenes again to return'
    : 'Orbit / Pan Orbit: drag to look around · Scroll: zoom · Ctrl+scroll: dolly zoom';
}

btnOrbit.onclick = () => toggleMode('orbit');
btnPanOrbit.onclick = () => toggleMode('pan');
btnBts.onclick = () => toggleMode('bts');
btnUp.onclick = () => { leaveBts(); panTo(1); };
$('btnRise').onclick = () => { leaveBts(); panTo(0); riseFromBelow(); };
btnDown.onclick = () => { leaveBts(); panTo(0); };
$('btnReset').onclick = () => { setMode('none'); panTo(0); resetZoom(); };

const panRange = $('panRange'), dollyDepth = $('dollyDepth'), craneTilt = $('craneTilt');
const rowFloorTop = $('rowFloorTop'), rowNearWeight = $('rowNearWeight');
function readSettings() {
  settings.panRange = panRange.value / 100;
  settings.dollyDepth = Number(dollyDepth.value);
  settings.craneTilt = THREE.MathUtils.degToRad(Number(craneTilt.value));
  $('craneTiltOut').textContent = `${craneTilt.value}°`;
  settings.rowFloorTop = rowFloorTop.value / 100;
  settings.rowNearWeight = Number(rowNearWeight.value);
  $('rowFloorTopOut').textContent = `${rowFloorTop.value}%`;
  $('rowNearWeightOut').textContent = settings.rowNearWeight.toFixed(2);
  $('panRangeOut').textContent = `${panRange.value}%`;
  $('dollyDepthOut').textContent = settings.dollyDepth.toFixed(2);
}
panRange.oninput = dollyDepth.oninput = craneTilt.oninput = rowFloorTop.oninput = rowNearWeight.oninput = readSettings;
$('rowScroll').onchange = e => { rowScroll.enabled = e.target.checked; };
rowScroll.enabled = $('rowScroll').checked;
rowScroll.mix = rowScroll.enabled ? 1 : 0;

// Bind a Settings control to an effect value; shows the value in the matching <output>, if any.
function bind(id, apply, fmt = v => v) {
  const el = $(id), out = $(id + 'Out');
  const update = () => {
    apply(el.type === 'range' ? Number(el.value) : el.value);
    if (out) out.textContent = fmt(Number(el.value));
  };
  el.addEventListener('input', update);
  update();
}
const f2 = v => v.toFixed(2);
if (matchMedia('(prefers-reduced-motion: reduce)').matches) $('shake').value = 0;
bind('shake', v => { settings.shake = v / 100; }, v => `${v}%`);
bind('follow', v => { settings.follow = v / 100; }, v => `${v}%`);
bind('parallaxX', v => { settings.parallaxX = v / 100; }, v => `${v}%`);
bind('parallaxY', v => { settings.parallaxY = v / 100; }, v => `${v}%`);
// Glow color is used raw (additive), so take the picker's hex values without color management.
// One Settings section per glow group; control ids are prefixed 'mid' / 'bg' / 'star'.
for (const [group, id] of [['midground', 'mid'], ['background', 'bg'], ['stars', 'star']]) {
  const u = glowGroups[group].uniforms;
  bind(`${id}GlowColor`, v => u.uColor.value.setStyle(v, THREE.LinearSRGBColorSpace));
  bind(`${id}GlowBlend`, v => setGlowBlending(group, v === 'additive'));
  bind(`${id}GlowGain`, v => { u.uGain.value = v; }, f2);
  bind(`${id}GlowSize`, v => { u.uSizeMul.value = v; }, f2);
  bind(`${id}GlowHardness`, v => { u.uHardness.value = v; }, f2);
  bind(`${id}GlowBands`, v => { u.uBands.value = v; });
  bind(`${id}GlowFlicker`, v => { u.uFlicker.value = v; }, f2);
  bind(`${id}GlowFlickerSpeed`, v => { u.uFlickerSpeed.value = v; }, v => v.toFixed(1));
  bind(`${id}GlowPulse`, v => { u.uPulse.value = v; }, f2);
}
// Shadows: strength updates live; the others redraw that shadow layer when the slider is released.
// One section per shadow layer; control ids are the layer name + setting ('contactSize', 'scopeCastLength', ...).
for (const which of ['contact', 'cast', 'scopeContact', 'scopeCast']) {
  bind(`${which}Opacity`, v => setShadowOpacity(which, v), f2);
  bind(`${which}Color`, v => setShadowColor(which, v));
  bind(`${which}Blend`, v => setShadowBlend(which, v));
}
const px = v => `${v} px`, raw = v => v;
const contactKeys = [['size', px], ['softness', raw]];
const castKeys = [['length', f2], ['height', px], ['softness', raw], ['hardness', f2], ['clump', raw], ['falloff', f2]];
const shadowSliders = (which, keys) => keys.map(([key, fmt]) => [which + key[0].toUpperCase() + key.slice(1), which, key, fmt]);
for (const [id, which, key, fmt] of [...shadowSliders('contact', contactKeys), ...shadowSliders('cast', castKeys),
  ...shadowSliders('scopeContact', contactKeys), ...shadowSliders('scopeCast', castKeys)]) {
  const el = $(id), out = $(id + 'Out');
  const show = () => { out.textContent = fmt(Number(el.value)); };
  SHADOWS[which][key] = Number(el.value);   // the slider's starting value is the default
  el.addEventListener('input', show);
  el.addEventListener('change', () => { SHADOWS[which][key] = Number(el.value); renderShadows(which); });
  show();
}
// Character shadow: all live (walk.js reads CHAR_SHADOW every frame).
for (const key of ['opacity', 'width', 'height', 'offsetX', 'offsetY', 'softness', 'color']) {
  const fmt = key === 'color' ? undefined : key.startsWith('offset') ? v => v.toFixed(3) : f2;
  bind('charShadow' + key[0].toUpperCase() + key.slice(1), v => { CHAR_SHADOW[key] = v; }, fmt);
}
$('vRowScroll').onchange =e => { rowScroll.enabledY = e.target.checked; };
rowScroll.enabledY = $('vRowScroll').checked;
rowScroll.mixY = rowScroll.enabledY ? 1 : 0;
bind('vRowFloorTop', v => { settings.vRowFloorTop = v / 100; }, v => `${v}%`);
bind('vRowStrength', v => { settings.vRowStrength = v / 100; }, v => `${v}%`);
bind('shootingRate', v => { settings.shootingRate = v; });
bind('skyCometRate', v => { settings.cometRate = v; });
bind('chimeVolume', v => { CONSTELLATION_PLAY.volume = v / 100; }, v => `${v}%`);
bind('shimmerVolume', v => { CONSTELLATION_PLAY.shimmerVolume = v / 100; }, v => `${v}%`);
bind('musicVolume', v => { MUSIC.volume = v / 100; }, v => `${v}%`);
bind('cityVolume', v => { CITY_SOUND.volume = v / 100; }, v => `${v}%`);
// Dev sound panel: the night ambience (citySound.js). "Every" sliders set a random range around the value.
const around = v => [v * 0.6, v * 1.4], secs = v => `${v} s`, f3 = v => v.toFixed(3);
bind('as_tone', v => { CITY_SOUND.tone = v; }, v => `${v} Hz`);
bind('as_minGap', v => { CITY_SOUND.minGap = v; }, secs);
for (const k of ['car', 'dog', 'door', 'bell', 'owl']) {
  bind(`as_${k}Level`, v => { CITY_SOUND[k].level = v; }, f3);
  bind(`as_${k}Every`, v => { CITY_SOUND[k].every = around(v); }, v => `~${v} s`);
}
const K = CITY_SOUND.crickets;
bind('as_cricketsLevel', v => { K.level = v; }, f3);
bind('as_cricketsSky', v => { K.sky = v / 100; }, v => `${v}%`);
bind('as_cricketsVoices', v => { K.voices = v; });
bind('as_cricketsChorus', v => { K.chorus = around(v); }, v => `~${v} s`);
bind('as_cricketsQuiet', v => { K.quiet = around(v); }, v => `~${v} s`);
for (const b of $('soundSettings').querySelectorAll('[data-play]'))
  b.onclick = () => (b.dataset.play === 'crickets' ? cricketsNow() : cityEvent(b.dataset.play));
const btnDevSound = $('btnDevSound');
btnDevSound.onclick = () => btnDevSound.setAttribute('aria-pressed', String(document.body.classList.toggle('dev-sound')));
$('musicTrack').addEventListener('change', e => { MUSIC.track = e.target.value; });
MUSIC.track = $('musicTrack').value;
// Telescope view (vignette): the switch turns the whole eyepiece look off (vignette, round lens, the search's zoom).
$('vignetteOn').addEventListener('change', e => setVignetteLook('on', e.target.checked));
setVignetteLook('on', $('vignetteOn').checked);
// Moving a slider previews the vignette briefly, even on the rooftop.
for (const [id, key] of [['vignetteStrength', 'strength'], ['vignetteRoundness', 'roundness'], ['vignetteSoftness', 'softness']]) {
  const el = $(id), out = $(id + 'Out'), value = () => Number(el.value);
  setVignetteLook(key, value());
  out.textContent = f2(value());
  el.addEventListener('input', () => { setVignetteLook(key, value(), true); out.textContent = f2(value()); });
}
// Night sky switches.
$('starsOn').onchange = e => setStarsVisible(e.target.checked);
$('shootingOn').onchange = e => { settings.shootingStars = e.target.checked; };
settings.stars = $('starsOn').checked; settings.shootingStars = $('shootingOn').checked;
bind('fogColor', v => fogShared.uColor.value.set(v));
bind('fogOpacity', v => { fogShared.uOpacity.value = v; }, f2);
bind('fogHardness', v => { fogShared.uHardness.value = v; }, f2);
bind('fogSpeed', v => { fogShared.uSpeed.value = v; }, v => v.toFixed(3));
ROOF_GARDEN.spots.forEach((s, i) => {
  const shift = () => setSpotOffset(i, Number($(`spot${i}X`).value), Number($(`spot${i}Y`).value));
  bind(`spot${i}X`, shift, v => `${v > 0 ? '+' : ''}${v}`);
  bind(`spot${i}Y`, shift, v => `${v > 0 ? '+' : ''}${v}`);
});
$('btnSpotPreview').onclick = e => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  e.currentTarget.textContent = on ? 'Hide the spot plants' : 'Show a plant on every spot';
  previewSpots(on);
};
// City tint: writes SKY_LOOK too, so the scene build (skyLook.js) keeps it.
bind('cityTint', v => {
  SKY_LOOK.cityTint = v;
  for (const n of ['city', 'cityFar']) layers[n]?.obj.material.color.set(v);
});
bind('cityGlowColor',v => cityGlowShared.uColor.value.set(v));
bind('cityGlowFar', v => { cityGlowStrength.far.value = v; }, f2);
bind('cityGlowNear', v => { cityGlowStrength.near.value = v; }, f2);
// Ambient FX: master switch, one strength slider per effect.
$('ambOn').onchange = e => setAmbientOn(e.target.checked);
setAmbientOn($('ambOn').checked);
for (const k of AMBIENT_EFFECTS) if (k !== 'glints') bind(`amb_${k}`, v => setAmbientAmount(k, v / 100), v => `${v}%`);
// Fireflies (their Brightness slider is amb_fireflies, bound above).
const pct = v => `${v}%`;
bind('flyColor', v => setFireflyLook('color', v));
bind('flyDensity', v => setFireflyLook('density', v / 100), pct);
bind('flySize', v => setFireflyLook('size', v / 100), pct);
bind('flyCore', v => setFireflyLook('core', v), v => v.toFixed(3));
bind('flyHalo', v => setFireflyLook('halo', v / 100), pct);
bind('flyLight', v => setFireflyLook('light', v / 100), pct);
bind('flyRimAmt', v => setFireflyLook('rimAmt', v / 100), pct);
bind('flyRim', v => setFireflyLook('rim', v), v => `${v.toFixed(1)}×`);
bind('flyRimSoft', v => setFireflyLook('rimSoft', v / 100), pct);
bind('flyBlink', v => setFireflyLook('blinkSpeed', v / 100), pct);
bind('flyRest', v => setFireflyLook('rest', v / 100), pct);
bind('flyWander', v => setFireflyLook('wander', v / 100), pct);
bind('flyWanderSpeed', v => setFireflyLook('wanderSpeed', v / 100), pct);

// Dev sky panel: the background stars' look. Writes SKY_LOOK.stars too.
for (const id of Object.keys(SKY_STAR_CONTROLS)) bind(id, v => setSkyStarLook(id, v), f2);
bind('skyDotAmount', setSkyDotAmount, v => `${Math.round(v * 100)}%`);
bind('skyStarBlend', setSkyStarBlend);
bind('skyColorScheme', v => { skyColor.scheme = v; pickSkyColor(); });
bind('skyColorStrength', v => { SKY_LOOK.color.strength = skyColor.uStrength.value = v; }, f2);
bind('skyColorFrom', v => setSkyColorFade(v, SKY_LOOK.color.full), v => `${v}°`);
bind('skyColorFull', v => setSkyColorFade(SKY_LOOK.color.from, v), v => `${v}°`);
// Dev sky → Milky Way (SKY_LOOK.nebula)
$('milkyOn').addEventListener('change', e => setMilkyOn(e.target.checked));
setMilkyOn($('milkyOn').checked);
for (const [id, key, u] of [['milkyStrength', 'strength', 'uStrength'], ['milkyWidth', 'width', 'uWidth'], ['milkyDeep', 'deepAmt', 'uDeepAmt'],
  ['milkyRibbon', 'ribbonAmt', 'uRibbonAmt'], ['milkyWarm', 'warmAmt', 'uWarmAmt']]) {
  bind(id, v => { SKY_LOOK.nebula.band[key] = milky[u].value = v; }, f2);
}
// Dev sky → Milky Way edges: the layers' outlines, from soft and misty to stylized, painterly cuts.
bind('mweGrain', v => setMilkyEdge('grain', v), f2);
['Body', 'Glow', 'Clumps', 'Clouds'].forEach((name, i) => bind(`mweHard${name}`, v => setMilkyEdge('hard', v, i), f2));
bind('milkyFrom', v => setMilkyFade(v, SKY_LOOK.nebula.fade[1]), v => `${v}°`);
bind('milkyFull', v => setMilkyFade(SKY_LOOK.nebula.fade[0], v), v => `${v}°`);
bind('milkyPeak', v => milkyArc(v, SKY_LOOK.nebula.arc.az), v => `${v}°`);
bind('milkyAz', v => milkyArc(SKY_LOOK.nebula.arc.peak, v), v => `${v}°`);
// Its stars follow once a slider that moves them is let go.
for (const id of ['milkyPeak', 'milkyAz', 'milkyWidth', 'milkyFrom', 'milkyFull', 'mwsSpread', 'mwsEdgeSpread', 'mwsEdgeShare', 'mwsClump']) $(id).addEventListener('change', () => {
  if (!sky.dust) return;
  const old = placeMilkyStars();
  if (old) starFields.splice(starFields.indexOf(old), 1);
});
// Dev sky → Milky Way stars (SKY_LOOK.nebula.stars): Spread and Clumps place them anew when let go (above).
bind('milkyStars', v => { SKY_LOOK.nebula.stars.amount = v; setStarFieldAmount(sky.dust, v); }, f2);
bind('mwsSpread', v => { SKY_LOOK.nebula.stars.spread = v; }, f2);
bind('mwsEdgeSpread', v => { SKY_LOOK.nebula.stars.edgeSpread = v; }, f2);
bind('mwsEdgeShare', v => { SKY_LOOK.nebula.stars.edgeShare = v; }, v => `${Math.round(v * 100)}%`);
bind('mwsClump', v => { SKY_LOOK.nebula.stars.clump = v; }, f2);
for (const [id, key, u] of [['mwsTwAmount', 'twAmount', 'uFTwShare'], ['mwsDotSize', 'dotSize', 'uFDotSize'], ['mwsDotBright', 'dotBright', 'uFDotBright'],
  ['mwsTwSize', 'twSize', 'uFTwSize'], ['mwsTwCross', 'twCross', 'uFTwCross'], ['mwsTwBright', 'twBright', 'uFTwBright'], ['mwsTint', 'tint', 'uFTint']]) {
  bind(id, v => { SKY_LOOK.nebula.stars[key] = milkyStarLook[u].value = v; }, f2);
}
for (const scheme of ['green', 'purple']) for (const key of ['deep', 'ribbon', 'ribbonHi', 'warm']) {
  bind(`milky_${scheme}_${key}`, v => setMilkyColor(scheme, key, v));
}
// Dev sky → Sky parallax (SKY_PARALLAX)
bind('skyParSmall', v => { skyParallax.uParFar.value = v; }, f3);
bind('skyParBig', v => { skyParallax.uParNear.value = v; }, f3);
bind('skyParMilkyWay', v => { skyParallax.uParMilkyWay.value = v; }, f3);
bind('skyParBackdrop', v => { skyParallax.uParBackdrop.value = v; }, f3);
// Dev sky → Constellation: stars and lines follow every frame, the shape is placed anew once its slider is let go.
bind('conShapeScale', v => { CONSTELLATION_STYLE.shapeScale = v; }, f2);
$('conShapeScale').addEventListener('change', () => chartHooks.refresh());
bind('conStarScale', v => { CONSTELLATION_STYLE.starScale = v; }, f2);
bind('conLineScale', v => { CONSTELLATION_STYLE.lineScale = v; }, f2);
// Dev sky: stardust, moon halo (their Strength sliders are amb_*, bound with Ambient FX).
for (const [id, effect, key, fmt] of [
  ['dustTint', 'stardust', 'tint'], ['dustTintAmt', 'stardust', 'tintAmt', f2], ['dustSize', 'stardust', 'sizeMul', f2],
  ['dustGlow', 'stardust', 'glow', f2], ['dustRate', 'stardust', 'rate'], ['dustCurl', 'stardust', 'curl', f2], ['dustSpread', 'stardust', 'spread', v => v.toFixed(3)], ['dustLife', 'stardust', 'lifeMul', f2],
  ['moonColor', 'moonHalo', 'color'], ['moonGlowAmt', 'moonHalo', 'glowAmt', f2], ['moonGlowSize', 'moonHalo', 'glowSize', f2],
  ['moonRingColor', 'moonHalo', 'ringColor'], ['moonRingAmt', 'moonHalo', 'ringAmt', f2], ['moonRing', 'moonHalo', 'ring', f2],
  ['moonBreathe', 'moonHalo', 'breathe', v => `${v} s`],
  ['wispColor', 'wisps', 'color'], ['wispColor2', 'wisps', 'color2'], ['wispBlend', 'wisps', 'blend'], ['wispOpacity', 'wisps', 'opacity', f2],
]) bind(id, v => setSkyFxLook(effect, key, v), fmt);
// Settings → Hint ring (COLLECT.hintRing, collect.js): the look repaints the ring; strength and spin are read each frame.
for (const key of Object.keys(COLLECT.hintRing)) {
  if (!$('hr_' + key)) continue;
  bind('hr_' + key, v => { COLLECT.hintRing[key] = v; if (key !== 'bright' && key !== 'spin') redrawHintRing(); },
    key === 'spin' ? v => `${v}°/s` : key === 'bristles' ? v => v : f2);
}
$('btnHintRingShow').onclick = () => previewHintRing();
$('btnMeteorShoot').onclick = () => spawnMeteor();
$('btnCometShoot').onclick = () => spawnComet();
$('btnRevealShow').onclick = () => previewReveal();
// Reveal ripple: the supernova ring or the earlier soft ring. Saved with the settings (settings.json).
const btnRingStyle = $('btnRingStyle'), RING_KEY = 'starGarden.ringStyle';
function setRingStyle(style) {
  STAR_DELIVERY.revealFx.ringStyle = style;
  btnRingStyle.textContent = `Ring: ${style === 'soft' ? 'Soft' : 'Supernova'}`;
  setPref(RING_KEY, style);
}
let savedRing = getPref(RING_KEY, null);
if (!savedRing && !readOnly) try { savedRing = localStorage.getItem(RING_KEY); } catch {}   // from before the settings file
setRingStyle(savedRing || STAR_DELIVERY.revealFx.ringStyle);
btnRingStyle.onclick = () => setRingStyle(STAR_DELIVERY.revealFx.ringStyle === 'soft' ? 'nova' : 'soft');
// Star reveal sliders: write STAR_DELIVERY, read by delivery.js at the next reveal.
const D = STAR_DELIVERY, sec = v => `${v.toFixed(2)} s`;
for (const [id, obj, key, fmt] of [
  ['rvSize', D, 'revealSize', f2], ['rvSec', D, 'revealSec', sec],
  ['rvRings', D.revealFx, 'rings'], ['rvRingSize', D.revealFx, 'ringSize', f2], ['rvRingGap', D.revealFx, 'ringGap', sec],
  ['rvRingSec', D.revealFx, 'ringSec', sec], ['rvRingBright', D.revealFx, 'ringBright', f2],
  ['rvRingEdge', D.revealFx, 'ringEdge', f2], ['rvRingEdgeSoft', D.revealFx, 'ringEdgeSoft', f2],
  ['rvRingTrail', D.revealFx, 'ringTrail', f2], ['rvRingHue', D.revealFx, 'ringHue', f2],
  ['rvSparkles', D.revealFx, 'sparkles'], ['rvSparkDist', D.revealFx, 'sparkleDist', f2], ['rvSparkSize', D.revealFx, 'sparkleSize', v => v.toFixed(3)],
  ['rvSparkSec', D.revealFx, 'sparkleSec', sec], ['rvSwirl', D.revealFx, 'swirl', f2],
]) bind(id, v => { obj[key] = v; }, fmt);
// Dev chart: the star chart's look (STAR_CHART.look, starChart.js). Shape sliders rebuild it once let go.
for (const key of Object.keys(STAR_CHART.look)) {
  const id = 'sc_' + key, el = $(id);
  if (!el) continue;
  bind(id, v => setChartLook(key, v), key === 'hue' || key.startsWith('fade') ? v => `${v}°` : key === 'revealSec' || key.endsWith('ulseSec') ? v => `${v.toFixed(1)} s` : f2);
  if (SHAPE_KEYS.includes(key)) el.addEventListener('change', () => chartHooks.refresh());
}
// Dev chart → Sky search: searching by hand (dragSearch.js; TELESCOPE.drag).
bind('ss_captureDeg', v => { TELESCOPE.drag.captureDeg = v; }, v => `${v}°`);
bind('ss_hintRange', v => { TELESCOPE.drag.hintRange = v; }, v => `${v}°`);
bind('ss_hintAfter', v => { TELESCOPE.drag.hintAfter = v; }, v => `${v} s`);
$('btnChartReplay').onclick = replayChart;
$('btnChartPulse').onclick = () => pulseChart('pulse');
$('btnChartStarPulse').onclick = () => pulseChart('starPulse');
$('btnChartOriginal').onclick = () => {   // the page's defaults (= config.js); saves stay until the next Save
  for (const el of $('chartSettings').querySelectorAll('input[id], select[id]')) {
    el.value = el.tagName === 'SELECT' ? ([...el.options].find(o => o.defaultSelected) || el.options[0]).value : el.defaultValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  chartHooks.refresh();
};
const btnDevChart = $('btnDevChart');
btnDevChart.onclick = () => btnDevChart.setAttribute('aria-pressed', String(document.body.classList.toggle('dev-chart')));
const btnDevSky = $('btnDevSky');
btnDevSky.onclick = () => {
  const on = document.body.classList.toggle('dev-sky');
  btnDevSky.setAttribute('aria-pressed', String(on));
};

// Dev button: shows/hides the dev UI (camera buttons, hint, settings). Hidden by default.
const btnDev = $('btnDev');
function setDev(on) {
  document.body.classList.toggle('dev', on);
  btnDev.setAttribute('aria-pressed', String(on));
  showAnchors(on);
}
btnDev.onclick = () => setDev(!document.body.classList.contains('dev'));
setDev(false);

// Mobile menu toggle (+ / −, top left, touch screens only): shows or hides the menu buttons. Hidden by default.
// Mobile build (BUILD.mobile): on every screen, as a ☰ / ✕ hamburger (html.build-mobile in style.css).
const btnMenuToggle = $('btnMenuToggle'), menuGlyph = BUILD.mobile ? ['☰', '✕'] : ['+', '−'];
btnMenuToggle.textContent = menuGlyph[0];
btnMenuToggle.onclick = () => {
  const open = document.body.classList.toggle('menu-open');
  btnMenuToggle.textContent = menuGlyph[open ? 1 : 0];
  btnMenuToggle.setAttribute('aria-expanded', String(open));
  btnMenuToggle.setAttribute('aria-label', open ? 'Hide the menu' : 'Show the menu');
};

// Fullscreen button (in the + menu on touch screens): the whole page goes fullscreen; resize() in main.js
// refits the 16:9 stage. Phones also turn to landscape where the browser allows it (Android: only while
// fullscreen; iPhone can't, it gets the "turn your phone" hint from style.css). Hidden where unsupported.
const btnFullscreen = $('btnFullscreen');
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
btnFullscreen.hidden = !canFullscreen;
async function enterFullscreen() {
  try {
    const root = document.documentElement;
    await (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    await screen.orientation?.lock?.('landscape').catch(() => {});
  } catch { /* refused by the browser: stay as we are */ }
}
btnFullscreen.onclick = () => fsElement()
  ? Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(() => {})
  : enterFullscreen();
// Phones: tapping Play goes fullscreen and turns the game to landscape right away.
if (canFullscreen && matchMedia('(pointer: coarse)').matches)
  $('btnPlay').addEventListener('click', () => { if (!fsElement()) enterFullscreen(); });
function showFullscreen() {
  const on = !!fsElement();
  btnFullscreen.setAttribute('aria-pressed', String(on));
  btnFullscreen.textContent = on ? '⛶ Exit fullscreen' : '⛶ Fullscreen';
}
document.addEventListener('fullscreenchange', showFullscreen);
document.addEventListener('webkitfullscreenchange', showFullscreen);

// Music button: mutes only the background music (music.js), the chimes stay.
const btnMusic = $('btnMusic');
function showMusicMuted() {
  btnMusic.setAttribute('aria-pressed', String(musicMuted()));
  btnMusic.textContent = musicMuted() ? '♪ Music off' : '♪ Music';
}
btnMusic.onclick = () => { setMusicMuted(!musicMuted()); showMusicMuted(); };
showMusicMuted();

// Chimes button: mutes only the star constellation sounds (chime.js), the music stays.
const btnChimes = $('btnChimes');
function showChimesMuted() {
  btnChimes.setAttribute('aria-pressed', String(chimesMuted()));
  btnChimes.textContent = chimesMuted() ? '✦ Chimes off' : '✦ Chimes';
}
btnChimes.onclick = () => { setChimesMuted(!chimesMuted()); showChimesMuted(); };
showChimesMuted();

rigEvents.onChange = updateUI;
readSettings();
addSectionButtons();

export { mode, btnOrbit, btnPanOrbit, btnBts, btnUp, btnDown, hint, setMode, leaveBts, toggleMode, recenter, updateUI, panRange, dollyDepth, craneTilt, rowFloorTop, rowNearWeight, readSettings, bind, btnDev, setDev };
