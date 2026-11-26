// Sound tuning, kept apart from config.js because it has no three.js dependency: the background music
// (music.js, loaded first by index.html) can then start while the big assets.js is still loading.
// config.js re-exports both objects, so the rest of the game imports them from there as usual.
// Echo game (A3): the stars wake up, brighten one after another to a soft chime melody, then the player
// taps the same order. Wrong taps never reset progress: the next star just glows as a hint.
const CONSTELLATION_PLAY = {
  beat: 0.62,                 // seconds per beat (a constellation can set its own `beat`)
  pauseBeforeShow: 0.2,       // after the wake-up, before the melody starts (then it still waits for the next music beat)
  hintAfter: 7,               // seconds without a tap before the next star glows softly by itself
  replayAfter: 16,            // seconds without a tap before the whole melody plays again as a reminder (and again after each replay)
  hitRadius: 0.075,           // tap tolerance around a star, as a fraction of the screen height
  focusY: 0.25,              // where a constellation's centre sits on screen: 0 = middle, 1 = top edge
  finaleSpeed: 0.8,           // the closing replay of the melody runs at this fraction of the beat length
  // Rhythm bonus: a tap whose gap to the previous tap matches the melody's gap sparkles extra. Never a
  // penalty; off-rhythm taps count just the same. Tolerance = the larger of the two.
  rhythmTolerance: 0.28,      // fraction of the expected gap
  rhythmMinTol: 0.12,         // seconds
  // Searching: after each constellation the telescope rises straight up out of the dip over the nets, then
  // searches across the sky to one side, far enough that the last constellation's circle leaves the screen, and
  // comes to rest with the next circle in the middle; the next constellation wakes up there (scopeSearch.js).
  // The first constellation of a look-up sits just over the rooftops; searched ones higher (searchPitch), where the
  // city has left the view. Degrees: searchSide = [nearest, furthest] it searches sideways (nearer more often),
  // never past searchMaxYaw; searchArc = how much higher it arcs over the longer stretches; searchRise = how far
  // the straight rise reaches up before it turns. Timing, pauses and the path's variety: TELESCOPE.search.
  searchSide: [42, 75], searchMaxYaw: 52, searchPitch: [13, 19], searchArc: 5, searchRise: 6,
  loopFrom: 0,                // after the last constellation the cycle starts again here (0 = Aries)
  volume: 0.35,               // chime loudness (0 = silent); Settings → Sound
  shimmerVolume: 0.3,         // in-rhythm glitter loudness, relative to the chimes; Settings → Sound
  scale: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],   // major pentatonic, semitones; higher stars sing higher
  root: 523.25,               // C5
};
// Background music (music.js): generated live in the chimes' key (C major) and tempo (one beat =
// CONSTELLATION_PLAY.beat). Each track's sound lives in its own file in js/music-tracks/.
const MUSIC = {
  volume: 0.3,                // overall music level (0 = off); Settings → Sound
  track: 'atmospheric',       // key in js/music-tracks/index.js; Settings → Sound → Music track
  fadeIn: 1.2,                // seconds from silence to full level when the music starts (any track)
  firstAttack: 0.3,           // the very first chord comes in this fast, so the music is there right away
};

// Night ambience under the rooftop (citySound.js), all synthesized: no steady noise, a near-silent night. Now and
// then a faint, far-off sound from the town below (a car, a dog, a door, a bell), and soft night nature on
// the roof (crickets in short trills with long pauses, now and then an owl). All of it far away: through a gentle
// low-pass and the chimes' room. It fades out as soon as the camera pans up to the sky (lookUpFade), all but the crickets.
// Each event: level (relative to `volume`), every = [min, max] seconds between two of them.
// startDelay: [min, max] s after the camera has settled on the roof before anything sounds (nothing during the
// rise from below); minGap: s at least between two town / owl sounds.
const CITY_SOUND = {
  volume: 0.7,                // overall level (0 = off); Dev sound → Volume (all of these are in the Dev sound panel)
  tone: 1400,                 // overall low-pass, Hz: far away and soft; darker as it fades
  room: 0.45,                 // send into the chimes' reverb (distance)
  startDelay: [3, 6], minGap: 15,
  car:   { level: 0.10, every: [42, 98], length: [5, 9] },        // a car passing far below, left to right or back
  dog:   { level: 0.05, every: [78, 182] },                       // one to three faint barks, far off
  door:  { level: 0.06, every: [66, 154] },                       // a door closing somewhere below
  bell:  { level: 0.05, every: [120, 280], strokes: [1, 3] },      // a distant church bell
  owl:   { level: 0.05, every: [60, 140] },                       // two soft hoots
  // Crickets: they sing for a while (chorus, s), then all fall silent (quiet, s) so only the music is left; while
  // singing, each voice chirps in short trills (s) with pauses (s) between, a chirp every `gap` s; tone = low-pass, Hz;
  // sky = their level up in the sky, relative to the roof (1 = they keep singing as loud)
  crickets: { level: 0.015, sky: 1, voices: 3, pitch: [3300, 3900], tone: 3600, gap: [0.55, 0.9], chorus: [15, 35], quiet: [27, 63], trill: [1.5, 4], pause: [6, 18] },
  // Fade with height: measured by how far above the roofs the bottom edge of the screen shows (layer heights,
  // < 0 = the city is still in view). Full sound at fadeFrom, silent at fadeTo.
  fadeFrom: -0.85, fadeTo: 0,  // roof ≈ -0.92 (full), first look-up ≈ -0.36 (about a third), searched constellations: gone
  fadeTime: 0.8,              // smoothing of level changes, seconds
  lookUpFade: 1.5,            // seconds to fade out once the camera starts panning up to the sky
};

export { CONSTELLATION_PLAY, MUSIC, CITY_SOUND };
