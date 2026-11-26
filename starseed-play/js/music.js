// Soft background music, generated live so it always fits the chimes:
//   - same key: C major, the arpeggio voice uses only the chimes' pentatonic notes (C D E G A), so whatever
//     a constellation sings never clashes; the pads add the gentle colour notes underneath
//   - same tempo: one beat = CONSTELLATION_PLAY.beat, and a constellation's melody starts on a music beat
//     (untilNextBeat), so the chimes land in the groove
//   - same room: it plays through the chimes' reverb
// Layers: a pad per chord, a soft bass on each bar, an arpeggio voice ('pluck' felt kalimba or 'swell'
// drifting tones) and an optional brushed shaker. While a constellation sings or is echoed the music steps
// back (track.duck) and the arpeggio rests, so the melody leads.
// The sound of each track lives in js/music-tracks/ (one file per track, so earlier versions stay
// available); MUSIC (config.js) holds the volume and the chosen track, both in Settings → Sound.
import { CONSTELLATION_PLAY, MUSIC } from './soundConfig.js';
import { audio, ensureAudio } from './chime.js';
import { TRACKS } from './music-tracks/index.js';

const C3 = CONSTELLATION_PLAY.root / 4;                          // chimes sit at C5; notes count from C3
const hz = semi => C3 * Math.pow(2, semi / 12);
const track = () => TRACKS[MUSIC.track] ?? Object.values(TRACKS)[0];

let ctx = null, out = null, arpOut = null, dry = null, wet = null, noise = null;
let firstChord = true, step = 0, nextT = 0, t0 = 0, gridBeat = 0, ducked = false, lastArp = -1, fadeUntil = 0;
// Mute button (music only, the chimes keep playing); remembered in this browser.
let muted = false;
// Music volume right now (defined before start() runs: it fades the music in to this level).
const level = () => (muted ? 0 : MUSIC.volume * (ducked ? track().duck : 1));
try { muted = localStorage.getItem('starGarden.musicMuted') === '1'; } catch {}

function start() {
  ensureAudio();
  const a = audio();
  if (!a.ctx || ctx) return;
  ctx = a.ctx;
  const T = track();
  out = ctx.createGain(); out.gain.value = 0;
  dry = ctx.createGain(); wet = ctx.createGain();
  dry.gain.value = T.dry; wet.gain.value = T.wet;                 // direct sound / send into the chimes' room
  out.connect(dry); dry.connect(a.master);
  out.connect(wet); wet.connect(a.reverbIn);
  arpOut = ctx.createGain(); arpOut.connect(out);
  // One second of white noise for the shaker.
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  nextT = t0 = ctx.currentTime + 0.05;
  gridBeat = CONSTELLATION_PLAY.beat;
  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.linearRampToValueAtTime(level(), ctx.currentTime + MUSIC.fadeIn);
  fadeUntil = ctx.currentTime + MUSIC.fadeIn;
  tick();                                                        // plan the first chord now, before the page gets busy loading
  setInterval(tick, 50);
}
window.addEventListener('pointerdown', start);
window.addEventListener('keydown', start);
// Try right away, while the loading screen is still up. Browsers only allow sound before the first click
// when they trust the site (e.g. Chrome after earlier visits); otherwise the audio clock waits, and the
// music swells in from the very start on the first click or key.
start();

// Lookahead scheduler: plan every eighth note a little ahead on the audio clock (sample-exact timing).
function tick() {
  const now = ctx.currentTime, eighth = gridBeat / 2, T = track();
  if (CONSTELLATION_PLAY.beat !== gridBeat) {                     // tempo changed: keep the grid continuous
    gridBeat = CONSTELLATION_PLAY.beat;
    t0 = nextT - step * gridBeat / 2;
  }
  let skipped = false;
  while (nextT < now) { nextT += eighth; step++; skipped = true; }   // page was busy (loading) or asleep: skip, don't burst
  if (skipped && MUSIC.volume > 0) joinChord(T, step, nextT);
  while (nextT < now + 0.3) {
    if (MUSIC.volume > 0) playStep(T, step, nextT);
    nextT += eighth; step++;
  }
  if (now > fadeUntil) out.gain.setTargetAtTime(level(), now, 0.6);   // after the gentle start: follow volume + duck
  arpOut.gain.setTargetAtTime(ducked ? T.arpWhenDucked : 1, now, 0.5);
  dry.gain.setTargetAtTime(T.dry, now, 0.5);                     // a track switch blends the room over
  wet.gain.setTargetAtTime(T.wet, now, 0.5);
}

function playStep(T, s, t) {
  const beat = gridBeat, inBar = s % 8, bar = Math.floor(s / 8), chordBars = T.barsPerChord;
  const chord = T.chords[Math.floor(bar / chordBars) % T.chords.length];
  if (inBar === 0) {
    if (bar % chordBars === 0) pad(T, chord.pad, t, chordBars * 4 * beat);
    bass(T, chord.bass, t, beat * T.bassBeats);
  }
  if (T.bassFifth && inBar === 4 && bar % chordBars === chordBars - 1) bass(T, chord.bass + 7, t, beat * 1.6);   // a soft fifth before the change
  if (inBar % 2 === 1) shaker(T, t, inBar === 3 || inBar === 7 ? 1 : 0.6);
  const p = T.arpPattern[inBar];
  if (p > 0 && Math.random() < p) (T.arpStyle === 'pluck' ? pluck : swell)(T, chord.arp, t, inBar === 0 ? 1 : 0.75);
}

// After a skip (the loading screen keeps the page busy, or the tab slept): bring in the chord that should be
// sounding now, for the rest of its length, instead of waiting in silence for the next chord change.
function joinChord(T, s, t) {
  const perChord = T.barsPerChord * 8, left = perChord - (s % perChord);
  if (left === perChord || left < 2) return;                     // a chord change is due anyway
  const chord = T.chords[Math.floor(s / perChord) % T.chords.length];
  pad(T, chord.pad, t, left * gridBeat / 2, firstChord ? MUSIC.firstAttack : 1);
  bass(T, chord.bass, t, Math.min(left, 8) * gridBeat / 2);
}

// Pad: two detuned triangles per note through a slowly breathing low-pass; long swell, long fade.
function pad(T, notes, t, len, attackOverride) {
  const g = ctx.createGain(), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lfoAmt = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = T.padTone; lp.Q.value = 0.5;
  lfo.frequency.value = 0.12; lfoAmt.gain.value = T.padTone * 0.35;
  lfo.connect(lfoAmt); lfoAmt.connect(lp.frequency);
  const amp = T.pad / notes.length, end = t + len + T.padRelease;
  const attack = attackOverride ?? (firstChord ? MUSIC.firstAttack : T.padAttack);  // later chords swell in slowly
  firstChord = false;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + attack);
  g.gain.setValueAtTime(amp, t + len);
  g.gain.linearRampToValueAtTime(0, end);
  lp.connect(g); g.connect(out);
  for (const n of notes) for (const det of [-7, 7]) {
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = hz(n); o.detune.value = det;
    o.connect(lp); o.start(t); o.stop(end + 0.05);
  }
  lfo.start(t); lfo.stop(end + 0.05);
}

// Round bass: a sine with a whisper of its octave so it still reads on small speakers.
function bass(T, semi, t, len) {
  const g = ctx.createGain(), f = hz(semi - 12);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(T.bass, t + T.bassAttack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(out);
  for (const [mul, a] of [[1, 1], [2, 0.25]]) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f * mul; og.gain.value = a;
    o.connect(og); og.connect(g); o.start(t); o.stop(t + len + 0.05);
  }
}

// The arpeggio's next note: random from the chord, never the same twice in a row, so it keeps flowing.
function nextArpNote(notes) {
  let i = Math.floor(Math.random() * notes.length);
  if (i === lastArp && notes.length > 1) i = (i + 1) % notes.length;
  lastArp = i;
  return notes[i];
}

// Felt kalimba: soft sine pluck with a faint bright partial, rounded off by a low-pass.
function pluck(T, notes, t, soft) {
  const f = hz(nextArpNote(notes)), amp = T.arp * soft * (0.8 + 0.2 * Math.random()), len = 1.6;
  const g = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2200;
  g.connect(lp); lp.connect(arpOut);
  for (const [mul, a, d] of [[1, 1, len], [3, 0.12, 0.25], [5.4, 0.04, 0.08]]) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f * mul;
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(amp * a, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(og); og.connect(g); o.start(t); o.stop(t + d + 0.05);
  }
}

// Drifting tone: a soft sine pair that swells in and fades away slowly, with a faint octave for air. No pluck.
function swell(T, notes, t, soft) {
  const f = hz(nextArpNote(notes)), amp = T.arp * soft * (0.8 + 0.2 * Math.random());
  const end = t + T.arpSwell + T.arpLen;
  const g = ctx.createGain(), lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 900;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + T.arpSwell);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.connect(lp); lp.connect(arpOut);
  for (const [mul, a, det] of [[1, 1, -3], [1, 1, 3], [2, 0.15, 0]]) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f * mul; o.detune.value = det; og.gain.value = a / 2;
    o.connect(og); og.connect(g); o.start(t); o.stop(end + 0.05);
  }
}

// Brushed shaker: a short breath of high, band-passed noise.
function shaker(T, t, accent) {
  if (!(T.shaker > 0)) return;
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  bp.type = 'bandpass'; bp.frequency.value = 7000; bp.Q.value = 0.8;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(T.shaker * 0.05 * accent, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  src.connect(bp); bp.connect(g); g.connect(out);
  src.start(t, Math.random() * 0.8); src.stop(t + 0.1);
}

// Seconds from now until the next music beat (0 while the music isn't playing), so gameplay can start in time.
function untilNextBeat() {
  if (!ctx || MUSIC.volume <= 0) return 0;
  const beats = (ctx.currentTime - t0) / gridBeat;
  return Math.max(0, (Math.ceil(beats) - beats) * gridBeat);
}

// The music steps back while a constellation melody is the focus.
function setMusicDuck(on) { ducked = on; }

function setMusicMuted(on) {
  muted = on;
  fadeUntil = 0;                                                 // stop / come back softly right away, even during the first swell
  try { localStorage.setItem('starGarden.musicMuted', on ? '1' : '0'); } catch {}
}
const musicMuted = () => muted;

export { untilNextBeat, setMusicDuck, setMusicMuted, musicMuted, TRACKS };
