// First time through the loop: stars → greenhouse → first plant → back to the stars.
// Stages: 'stars' (looking up, the first tier) → 'grow' (from the first pan-down: the sky waits, the greenhouse calls)
//   → 'plant' (the grown plant waits on the roof) → 'done' (it is planted; the sky is open again, for good).
// Nothing is forbidden out loud:
//   • while the sky waits (scope.locked), the telescope doesn't light up under the pointer or glint; a tap on it makes
//     the character look up at a net with a star still in it (that star pops up above its head, collect.js noticeNets),
//     or, once every star is gathered, turn to the greenhouse while the hint ring circles its door (modes.js);
//   • the greenhouse glows like a net under the pointer, breathing (house.calling); after a while the hint ring
//     (collect.js) circles its door;
//   • stepping in with every net emptied closes the way out (house.trapped: no leave button, no Esc) until the plant
//     has grown, then the way out carries the plant (planting.js);
//   • once it is planted on the roof, a pause to admire it, then the telescope glints again.
// Values in FIRST_TIME (config.js). modes.js asks skyLocked() and calls planted().
import { FIRST_TIME as F } from './config.js';
import { house } from './greenhouse.js';
import { scope } from './telescope.js';
import { gatherFirst, inviteAfter, noticeGreenhouse } from './collect.js';
import { starRecords } from './starRecords.js';

const first = { stage: F.on ? 'stars' : 'done' };

// Every star found so far is out of the nets (in the satchel or the jars).
const gathered = () => starRecords.length > 0 && !starRecords.some(r => r.location === 'net');
const skyLocked = () => first.stage === 'grow' || first.stage === 'plant';

// constellation.js: the first tier is played and the camera pans down by itself.
window.addEventListener('skyrest', () => { if (first.stage === 'stars') first.stage = 'grow'; });
// greenhouse.js: stepping in with all the first stars gathered closes the way out until the plant has grown.
window.addEventListener('greenhouseenter', () => {
  if (first.stage === 'grow' && gathered()) house.trapped = true;
});
// planting.js: the grown plant goes out with the character.
window.addEventListener('plantcarried', () => {
  if (first.stage !== 'grow') return;
  first.stage = 'plant'; house.trapped = false;
});

// modes.js: a tap on the telescope while the sky waits.
function nudgeToGreenhouse() {
  noticeGreenhouse();
  house.flash = 1;
}

// modes.js: the first plant is in the earth.
function planted() {
  if (first.stage !== 'plant') return;
  first.stage = 'done';
  inviteAfter(F.admireSec);
}

function updateFirstTime() {
  scope.locked = skyLocked() || gatherFirst();   // (after a sky trip: until the nets are emptied, collect.js)
  house.calling = first.stage === 'grow';
}

export { first as firstTime, skyLocked, nudgeToGreenhouse, planted, updateFirstTime };
