// Track 1 — Cozy kalimba (2026-10-11, first version).
// Warm pad, round bass with a soft fifth before each chord change, a lilting felt-kalimba arpeggio
// (C4 … D5) and a faint brushed shaker. Feedback: too present, the arpeggio clashes with the star chimes.
// All notes in semitones from C3; levels relative (Settings → Sound → Music volume scales them all).
export default {
  name: '1 · Cozy kalimba',
  duck: 0.6,                  // level while a constellation sings / is echoed
  arpWhenDucked: 0.25,        // the arpeggio almost rests then
  dry: 0.8, wet: 0.55,        // direct sound / send into the chimes' room
  barsPerChord: 2,
  chords: [
    { name: 'Cadd9', bass: 0,   pad: [4, 7, 12, 14], arp: [12, 16, 19, 26] },
    { name: 'Am7',   bass: -3,  pad: [0, 4, 7, 9],   arp: [9, 12, 16, 21] },
    { name: 'Fmaj7', bass: -7,  pad: [5, 9, 12, 16], arp: [12, 16, 21, 24] },
    { name: 'G6sus', bass: -5,  pad: [2, 7, 9, 14],  arp: [14, 19, 21, 26] },
  ],
  pad: 0.11, padTone: 750, padAttack: 2.2, padRelease: 2.8,   // level, low-pass Hz, swell / fade seconds
  bass: 0.16, bassAttack: 0.04, bassBeats: 3, bassFifth: true,
  arpStyle: 'pluck',          // 'pluck' = felt kalimba, 'swell' = drifting tone
  arpPattern: [0.9, 0, 0.35, 0.55, 0.5, 0, 0.6, 0.2],   // chance of a note on each eighth of the bar
  arp: 0.09,
  shaker: 0.5,                // brushed off-beat shaker (0 = none)
};
