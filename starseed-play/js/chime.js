// Soft synthesized voices for the constellations, one per element (STAR_FAMILIES[…].voice):
//   bell    (Air)   — the original soft bell: sine with quiet overtones, slow decay
//   marimba (Earth) — warm wooden bar: short, round, a little lower
//   glass   (Water) — glass harp: gently swelling, two slightly detuned sines, long shimmer
//   epiano  (Fire)  — warm electric piano: a soft FM "tine" that mellows as it rings, like embers
// Every voice runs through a shared quiet room (generated reverb) and a faint echo, with its own send
// amounts, so they sound like one cozy space. The audio context starts on the first user gesture.
import { CONSTELLATION_PLAY } from './soundConfig.js';

let ctx = null, master = null, reverbIn = null, echoIn = null;

// ✦ Chimes button: mutes the star sounds only (the music keeps playing). Remembered in this browser.
let chimesOff = false;
try { chimesOff = localStorage.getItem('starGarden.chimesMuted') === '1'; } catch {}
function setChimesMuted(on) {
  chimesOff = on;
  try { localStorage.setItem('starGarden.chimesMuted', on ? '1' : '0'); } catch {}
}
const chimesMuted = () => chimesOff;

// Reverb impulse: two seconds of soft, decaying, slightly darkened stereo noise.
function roomImpulse(seconds = 2.4) {
  const rate = ctx.sampleRate, n = Math.floor(seconds * rate), ir = ctx.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += 0.25 * ((Math.random() * 2 - 1) - lp);              // simple low-pass: a warm, not hissy tail
      data[i] = lp * Math.pow(1 - i / n, 3.2);
    }
  }
  return ir;
}

function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();                  // keeps chords and finales from peaking
  comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
  master.connect(comp); comp.connect(ctx.destination);
  // Room.
  reverbIn = ctx.createGain();
  const conv = ctx.createConvolver(), revOut = ctx.createGain();
  conv.buffer = roomImpulse(); revOut.gain.value = 1.4;
  reverbIn.connect(conv); conv.connect(revOut); revOut.connect(master);
  // Faint echo: a low-passed feedback delay.
  echoIn = ctx.createGain();
  const delay = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
  delay.delayTime.value = 0.27; fb.gain.value = 0.32; lp.type = 'lowpass'; lp.frequency.value = 2400;
  echoIn.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(master);
}
window.addEventListener('pointerdown', ensureAudio);
window.addEventListener('keydown', ensureAudio);

// A note's output: dry to the master, plus sends to the room and the echo.
function voiceBus(t, end, dry, room, echo, tone = 0) {
  const bus = ctx.createGain();
  let head = bus;
  if (tone) {                                                    // optional low-pass for warmth
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = tone; lp.Q.value = 0.3;
    bus.connect(lp); head = lp;
  }
  for (const [dest, g] of [[master, dry], [reverbIn, room], [echoIn, echo]]) {
    if (g <= 0) continue;
    const s = ctx.createGain(); s.gain.value = g; head.connect(s); s.connect(dest);
  }
  setTimeout(() => bus.disconnect(), (end - ctx.currentTime + 0.5) * 1000);
  return bus;
}

// One enveloped sine partial into `dest`: attack, then exponential decay.
function partial(dest, f, t, amp, attack, decay, detune = 0) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'sine'; osc.frequency.value = f; osc.detune.value = detune;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  osc.connect(g); g.connect(dest);
  osc.start(t); osc.stop(t + attack + decay + 0.05);
  return osc;
}

const VOICES = {
  // Air: the original bell.
  bell(f, t, amp, len) {
    const end = t + 1.8 * len;
    const bus = voiceBus(t, end, 1, 0.35, 0.28);
    for (const [mul, gain, d] of [[1, 1, 1.8], [2.01, 0.18, 0.7], [3.98, 0.05, 0.35]]) partial(bus, f * mul, t, amp * gain, 0.012, d * len);
  },
  // Earth: wooden bar. Strong fundamental, the marimba's tuned 4th partial, a soft mallet knock.
  marimba(f, t, amp, len) {
    const end = t + 1.2 * len;
    const bus = voiceBus(t, end, 1, 0.3, 0.12, 3200);
    partial(bus, f, t, amp * 1.15, 0.004, 1.1 * len);
    partial(bus, f * 2, t, amp * 0.08, 0.004, 0.45 * len);
    partial(bus, f * 3.93, t, amp * 0.3, 0.003, 0.22);
    partial(bus, f * 9.2, t, amp * 0.05, 0.002, 0.06);
  },
  // Water: glass harp. Two detuned sines swell in softly and ring long with a slow shimmer.
  glass(f, t, amp, len) {
    const end = t + 2.6 * len;
    const bus = voiceBus(t, end, 0.8, 0.7, 0.35);
    const a = partial(bus, f, t, amp * 0.6, 0.05, 2.5 * len, -4);
    const b = partial(bus, f, t, amp * 0.6, 0.05, 2.5 * len, 4);
    partial(bus, f * 2, t, amp * 0.22, 0.06, 1.4 * len);
    partial(bus, f * 3, t, amp * 0.07, 0.04, 0.7 * len);
    const lfo = ctx.createOscillator(), depth = ctx.createGain();   // gentle vibrato
    lfo.frequency.value = 4.6; depth.gain.value = 3;              // cents
    lfo.connect(depth); depth.connect(a.detune); depth.connect(b.detune);
    lfo.start(t); lfo.stop(end + 0.1);
  },
  // Fire: warm electric piano. FM tine: the brightness fades fast, the warm body rings on.
  epiano(f, t, amp, len) {
    const end = t + 1.7 * len;
    const bus = voiceBus(t, end, 1, 0.35, 0.18, 2800);
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), idx = ctx.createGain(), g = ctx.createGain();
    car.type = mod.type = 'sine'; car.frequency.value = f; mod.frequency.value = f;
    idx.gain.setValueAtTime(f * 1.1, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5);
    mod.connect(idx); idx.connect(car.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * 0.95, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7 * len);
    car.connect(g); g.connect(bus);
    for (const o of [car, mod]) { o.start(t); o.stop(end + 0.05); }
    partial(bus, f * 7, t, amp * 0.04, 0.002, 0.08);              // the tine's little "tink"
  },
};

// One note. `step` indexes CONSTELLATION_PLAY.scale; `soft` scales loudness (0..1); `len` stretches the
// ring-out (long notes ring longer); `fam` picks the voice, octave and level (a STAR_FAMILIES entry).
function chime(step, soft = 1, when = 0, len = 1, fam = null) {
  const P = CONSTELLATION_PLAY;
  if (!ctx || P.volume <= 0 || chimesOff) return;
  const s = P.scale[Math.max(0, Math.min(P.scale.length - 1, step))] + 12 * (fam?.octave ?? 0);
  const f = P.root * Math.pow(2, s / 12), t = ctx.currentTime + when, amp = P.volume * soft * (fam?.level ?? 1);
  (VOICES[fam?.voice] ?? VOICES.bell)(f, t, amp, len);
}

// A muffled low note for a tap that wasn't the next star: gentle, not a buzzer.
function thud() {
  const P = CONSTELLATION_PLAY;
  if (!ctx || P.volume <= 0 || chimesOff) return;
  const t = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'triangle'; osc.frequency.setValueAtTime(P.root / 2, t); osc.frequency.exponentialRampToValueAtTime(P.root / 2.4, t + 0.3);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(P.volume * 0.25, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + 0.45);
}

// A tiny high glitter on top of a note: two quick soft bell pings, for a tap that landed in rhythm.
function shimmer(step) {
  const v = CONSTELLATION_PLAY.shimmerVolume;
  if (v <= 0) return;
  chime(step + 5, 0.22 * v, 0.05, 0.4);
  chime(step + 7, 0.16 * v, 0.11, 0.4);
}

// The shared audio graph, for the background music (music.js) to play into the same room.
const audio = () => ({ ctx, master, reverbIn });

export { chime, shimmer, thud, ensureAudio, audio, VOICES, setChimesMuted, chimesMuted };
