// Track 2 — Atmospheric (2026-10-11, after "too intense, notes too high and present").
// Everything stays low (G2 … D4), well under the chimes (C5 and up): a dark, slowly breathing pad, a bass
// that swells in without a thump, and rare drifting tones that fade in and out. No plucks, no shaker.
// Mostly room sound. Ducks far back while a constellation sings.
// All notes in semitones from C3; levels relative (Settings → Sound → Music volume scales them all).
export default {
  name: '2 · Atmospheric',
  duck: 0.35,
  arpWhenDucked: 0,           // the drifting tones rest completely while the stars sing
  dry: 0.4, wet: 0.9,
  barsPerChord: 2,
  chords: [
    { name: 'Cadd9', bass: 0,   pad: [-5, 2, 4, 7],  arp: [4, 7, 12] },
    { name: 'Am7',   bass: -3,  pad: [-3, 0, 4, 7],  arp: [4, 9, 12] },
    { name: 'Fmaj7', bass: -7,  pad: [-7, -3, 0, 4], arp: [0, 4, 9] },
    { name: 'G6sus', bass: -5,  pad: [-5, 2, 7, 9],  arp: [2, 7, 9] },
  ],
  pad: 0.09, padTone: 420, padAttack: 3.5, padRelease: 4,
  bass: 0.09, bassAttack: 0.35, bassBeats: 6, bassFifth: false,
  arpStyle: 'swell',
  arpSwell: 1.2, arpLen: 5,   // drifting tone: seconds to swell in / to fade away
  arpPattern: [0.45, 0, 0, 0, 0.2, 0, 0, 0],   // rare, mostly on the downbeat
  arp: 0.05,
  shaker: 0,
};
