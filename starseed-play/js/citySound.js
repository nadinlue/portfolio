// Night ambience: a near-silent night over the sleeping town, all synthesized (no files). No steady noise bed:
// only now and then a faint, far-off sound from below, and soft night nature on the roof.
//   - town (through a gentle low-pass, far away): a car passing below, a dog barking, a door closing, a distant
//     church bell; each on its own slow random timer (CITY_SOUND.<kind>.every)
//   - nature (not low-passed, nearer): crickets chirping in short trills with long pauses, now and then an owl
// The crickets keep singing up in the sky (CITY_SOUND.crickets.sky = their level there, relative to the roof).
// Everything goes into the chimes' master and room, so it shares their space. All the rest fades out as soon as the
// camera starts panning up to the sky (telescope look-up: crane target = sky), over CITY_SOUND.lookUpFade, and comes
// back on the way down. It also follows how far above the roofs the bottom edge of the screen shows
// (layers.sky.aboveRoofs, between fadeFrom and fadeTo: the rise from below at the start); the town darkens as it fades.
// Tuning: CITY_SOUND (soundConfig.js); volume in Settings → Sound.
import * as THREE from 'three';
import { CITY_SOUND } from './config.js';
import { audio } from './chime.js';
import { camera } from './core.js';
import { crane } from './rig.js';
import { layers } from './layers.js';

let ctx = null, town = null, tone = null, nature = null, bugs = null;
let city = 1;
const next = {};           // per event kind: when it may sound next (audio clock)
const crickets = [];       // { pan, pitch, trillEnd, nextChirp, restUntil }
const chorus = { on: false, until: Infinity };   // the crickets sing together for a while, then all fall silent
let arrived = null, lastEvent = -Infinity;   // when the camera first settled on the roof; when a town / owl sound last played
const _bottom = new THREE.Vector3();
const rand = ([a, b]) => a + Math.random() * (b - a);
const pick = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
const S = () => CITY_SOUND;

function build() {
  const a = audio();
  ctx = a.ctx;
  const send = (node, room) => {   // dry to the master + a share into the room
    const r = ctx.createGain(); r.gain.value = room;
    node.connect(a.master); node.connect(r); r.connect(a.reverbIn);
  };
  town = ctx.createGain(); town.gain.value = 0;
  tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = S().tone; tone.Q.value = 0.4;
  tone.connect(town); send(town, S().room);
  nature = ctx.createGain(); nature.gain.value = 0;
  send(nature, S().room * 0.6);
  bugs = ctx.createGain(); bugs.gain.value = 0;   // the crickets, on their own level: they stay in the sky
  send(bugs, S().room * 0.6);
  setVoices(S().crickets.voices);
}
// The cricket voices, spread across the stereo field (the count can change live from the Dev sound panel).
function setVoices(n) {
  crickets.length = 0;
  for (let i = 0; i < n; i++)
    crickets.push({ pan: (i / Math.max(1, n - 1)) * 1.4 - 0.7, pitch: rand(S().crickets.pitch), trillEnd: 0, nextChirp: 0, restUntil: 0 });
}

// ---------------------------------------------------------------- building blocks
// A gain that rises to `peak` in `att` s and falls to silence by `att + dec` s; returns it.
function env(t, peak, att, dec, hold = 0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + att);
  g.gain.setValueAtTime(peak, t + att + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + att + hold + dec);
  return g;
}
function osc(type, f, t, end) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  o.start(t); o.stop(end);
  return o;
}
function panner(p, dest) { const n = ctx.createStereoPanner(); n.pan.value = p; n.connect(dest); return n; }
function lowpass(f, dest, q = 0.7) { const n = ctx.createBiquadFilter(); n.type = 'lowpass'; n.frequency.value = f; n.Q.value = q; n.connect(dest); return n; }
const side = () => (Math.random() < 0.5 ? -1 : 1) * rand([0.3, 0.8]);

// ---------------------------------------------------------------- the town below
const EVENTS = {
  // A car far below: a low engine tone (two soft saws) swelling in and out, its pitch dropping a little as it
  // passes (Doppler), gliding from one side to the other.
  car(t) {
    const C = S().car, len = rand(C.length), amp = C.level * rand([0.6, 1]), f = rand([52, 72]), dir = Math.random() < 0.5 ? -1 : 1;
    const g = ctx.createGain(), pan = panner(-dir * 0.8, tone), lp = lowpass(260, g);
    g.connect(pan);
    g.gain.setValueCurveAtTime(Float32Array.from({ length: 48 }, (_, i) => Math.sin(Math.PI * i / 47) ** 2 * amp), t, len);
    pan.pan.linearRampToValueAtTime(dir * 0.8, t + len);
    lp.frequency.setValueAtTime(200, t); lp.frequency.linearRampToValueAtTime(420, t + len * 0.5); lp.frequency.linearRampToValueAtTime(200, t + len);
    for (const [k, v] of [[1, 1], [1.5, 0.35]]) {
      const o = osc('sawtooth', f * k * 1.04, t, t + len + 0.1), og = ctx.createGain(); og.gain.value = v;
      o.frequency.setValueAtTime(f * k * 1.04, t + len * 0.45); o.frequency.linearRampToValueAtTime(f * k * 0.95, t + len * 0.6);
      o.connect(og); og.connect(lp);
    }
  },
  // One to three faint barks: a short voiced yelp falling in pitch through a mouth-like band.
  dog(t) {
    const D = S().dog, n = pick([1, 3]), p = side(), base = rand([380, 520]);
    for (let i = 0; i < n; i++) {
      const tt = t + i * rand([0.32, 0.5]), f = base * rand([0.95, 1.05]);
      const o = osc('sawtooth', f, tt, tt + 0.3);
      o.frequency.exponentialRampToValueAtTime(f * 0.62, tt + 0.13);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.4;
      const g = env(tt, D.level * rand([0.7, 1]), 0.012, 0.16);
      o.connect(bp); bp.connect(g); g.connect(panner(p, tone));
    }
  },
  // A door closing somewhere below: a soft low thump and a faint latch click.
  door(t) {
    const L = S().door, p = side(), out = panner(p, tone);
    const th = osc('sine', 95, t, t + 0.5); th.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    const g = env(t, L.level, 0.005, 0.3); th.connect(g); g.connect(out);
    const cl = osc('triangle', 1700, t - 0.04, t + 0.03), cg = env(t - 0.04, L.level * 0.25, 0.002, 0.03);
    cl.connect(cg); cg.connect(out);
  },
  // A distant church bell: inharmonic partials (hum, prime, minor third, fifth, nominal), each fading at its own pace.
  bell(t) {
    const B = S().bell, n = pick(B.strokes), f = rand([260, 330]), p = side() * 0.4;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 2.4;
      for (const [k, a, dec] of [[0.5, 0.5, 7], [1, 1, 5], [1.19, 0.45, 3.5], [1.5, 0.3, 3], [2, 0.5, 2.5], [2.6, 0.15, 1.5]]) {
        const g = env(tt, B.level * a * 0.4, 0.004, dec);
        osc('sine', f * k, tt, tt + dec + 0.1).connect(g); g.connect(panner(p, tone));
      }
    }
  },
  // An owl (nature, nearer): a soft hoot, a pause, then a longer one, gliding down a little.
  owl(t) {
    const O = S().owl, p = side(), f = rand([360, 420]);
    for (const [start, dur] of [[0, 0.35], [0.75, 0.6]]) {
      const tt = t + start, o = osc('sine', f, tt, tt + dur + 0.3);
      o.frequency.linearRampToValueAtTime(f * 0.9, tt + dur);
      const g = env(tt, O.level, 0.08, dur);
      o.connect(g); g.connect(panner(p, nature));
    }
  },
};

// ---------------------------------------------------------------- crickets
// One chirp: a soft high tone pulsing 3–4 times, the pulses rounded and blurred into each other (no hard clicks),
// each chirp a little louder or softer, heard from a few metres away (low-passed).
function chirp(c, t) {
  const K = S().crickets, pulses = pick([3, 4]), pw = 0.026, gap = 0.008, len = pulses * (pw + gap), amp = K.level * rand([0.5, 1]);
  const curve = new Float32Array(64);
  for (let i = 0; i < 64; i++) { const x = (i / 63) * len, k = x % (pw + gap); curve[i] = k < pw ? Math.sin(Math.PI * k / pw) ** 2 * amp : 0; }
  const o = osc('sine', c.pitch, t, t + len + 0.02), g = ctx.createGain();
  g.gain.setValueCurveAtTime(curve, t, len);
  o.connect(g); g.connect(cricketBus(c.pan));
}
const cricketPans = {};
function cricketBus(pan) {   // per voice: pan → low-pass → bugs
  if (cricketPans[pan]) return cricketPans[pan];
  const lp = lowpass(S().crickets.tone, bugs, 0.5), p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(lp);
  return (cricketPans[pan] = p);
}
function updateCrickets(now) {
  const K = S().crickets;
  if (crickets.length !== K.voices) setVoices(K.voices);
  if (K.level <= 0 || (city < 0.05 && K.sky < 0.05)) return;
  if (now >= chorus.until) {   // a singing stretch begins or ends
    chorus.on = !chorus.on; chorus.until = now + rand(chorus.on ? K.chorus : K.quiet);
    for (const c of crickets) { c.trillEnd = 0; c.restUntil = now + (chorus.on ? rand([0, 4]) : 0); }
  }
  if (!chorus.on) return;
  for (const c of crickets) {
    if (now < c.restUntil) continue;
    if (!c.trillEnd) { c.trillEnd = now + rand(K.trill); c.nextChirp = now + 0.05; }
    if (now > c.trillEnd) { c.trillEnd = 0; c.restUntil = now + rand(K.pause); continue; }
    while (c.nextChirp < now + 0.2) { chirp(c, c.nextChirp); c.nextChirp += rand(S().crickets.gap); }
  }
}

// ---------------------------------------------------------------- per frame
// Follow the camera's height and the tuning; schedule what is due. Starts once the chimes' audio is up (first click).
function updateCitySound() {
  if (!ctx) { if (!audio().ctx) return; build(); }
  const C = S(), now = ctx.currentTime;
  if (layers.sky?.aboveRoofs) {
    const above = layers.sky.aboveRoofs(_bottom.set(0, -1, 0.5).unproject(camera));
    const k = THREE.MathUtils.clamp((above - C.fadeFrom) / (C.fadeTo - C.fadeFrom), 0, 1);
    city = 1 - k * k * (3 - 2 * k);
  }
  const up = crane.to > 0;   // looking through the telescope: everything fades out at once
  if (up) city = 0;
  const fade = up ? C.lookUpFade / 3 : C.fadeTime;   // time constant: ~95 % gone after 3 of them
  town.gain.setTargetAtTime(C.volume * city, now, fade);
  tone.frequency.setTargetAtTime(C.tone * (0.4 + 0.6 * city), now, fade);
  nature.gain.setTargetAtTime(C.volume * city, now, fade);
  bugs.gain.setTargetAtTime(C.volume * (C.crickets.sky + (1 - C.crickets.sky) * city), now, fade);
  if (C.volume <= 0) return;
  // Nothing during the rise from below: the first sounds come a few seconds after the camera has settled on the roof
  // (crickets first, the town and the owl later, each on its own timer).
  if (arrived === null) {
    if (city < 0.95 || up) return;
    arrived = now;
    const start = now + rand(C.startDelay);
    chorus.until = start;
    for (const kind of Object.keys(EVENTS)) next[kind] = start + rand(C[kind].every) * rand([0.3, 1]);
  }
  for (const [kind, play] of Object.entries(EVENTS)) {
    if (now < next[kind]) continue;
    if (now - lastEvent < C.minGap) { next[kind] = lastEvent + C.minGap + rand([0, 15]); continue; }   // never two close together
    if (city >= 0.05 && C[kind].level > 0) { play(now + 0.05); lastEvent = now; }   // only while it can be heard
    next[kind] = now + rand(C[kind].every);
  }
  updateCrickets(now);
}

const citySoundLevel = () => city;   // 1 = the whole city in view, 0 = up in the sky (for the console)
// Dev/console: play one event now, e.g. starGarden.cityEvent('dog')
const cityEvent = kind => { if (ctx && EVENTS[kind]) EVENTS[kind](ctx.currentTime + 0.05); };

// Dev: the crickets start a singing stretch now.
const cricketsNow = () => { if (!ctx) return; chorus.on = false; chorus.until = ctx.currentTime; };

export { updateCitySound, citySoundLevel, cityEvent, cricketsNow };
