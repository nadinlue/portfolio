// Background music tracks (music.js plays the one picked in MUSIC.track / Settings → Sound → Music track).
// One file per track, so earlier versions stay available. To try a new idea: copy a track file, give it the
// next number, change it, and add it here. Keys are what MUSIC.track stores.
import cozyKalimba from './01-cozy-kalimba.js';
import atmospheric from './02-atmospheric.js';

export const TRACKS = {
  cozyKalimba,
  atmospheric,
};
