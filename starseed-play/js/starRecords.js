// Star records (A4): one record per collected star, the single source of truth. Net and jar sprites are
// only views of these records. Not saved yet (A6).
//   { id, type, location: 'net' | 'storage' | 'pot' (chosen for a plant) | 'consumed' (+ plantId), netIndex, source, rhythm }
import { NETS } from './config.js';

const records = [];
const listeners = [];
let nextId = 1;

// Any element goes to the net holding fewer stars; a coin toss when they hold the same (NETS).
function netFor() {
  const counts = NETS.map((n, i) => starsInNet(i).length), min = Math.min(...counts);
  const free = counts.flatMap((c, i) => (c === min ? [i] : []));
  return free[Math.floor(Math.random() * free.length)];
}

// A completed constellation → exactly one star (constellation.js calls this once per completion); it
// belongs to its net right away, even while its flight is still on the way.
function collectStar(type, source, rhythm = null) {
  const r = { id: `star-${nextId++}`, type, location: 'net', netIndex: netFor(), source, rhythm };
  records.push(r);
  for (const fn of listeners) fn(r);
  return r;
}

const onStarCollected = fn => listeners.push(fn);
const starsInNet = i => records.filter(r => r.location === 'net' && r.netIndex === i);

export { records as starRecords, collectStar, onStarCollected, starsInNet };
