// The character's speech bubble in the greenhouse (style.css .speech, .speech-bubble): entering with no stars at all
// (none in the satchel, the jars or the pot), after a few seconds it says there is nothing to grow yet, with a
// "Back to the rooftop" button under it (the pill buttons' look, with the roof icon). The character stands just out
// of the picture, so the bubble's tail points down to the right, towards the door.
// Both float in softly and stay (or fade after showSec, if set); leaving the greenhouse takes them along (they live
// in #interior). Values in GREENHOUSE.emptyBubble (config.js). modes.js calls sayNothingToGrow() once the player is
// inside, with what the button does.
import { GREENHOUSE } from './config.js';
import { house, interior } from './greenhouse.js';
import { starRecords } from './starRecords.js';
import { sleep } from './util.js';

const box = document.createElement('div');
box.className = 'speech';
box.innerHTML = '<div class="speech-bubble" role="status"></div>'
  + '<button class="return-btn speech-btn" tabindex="-1">'
  + '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24.5 16 14.5l11 10"/><path d="M20.5 18.6V12.5h4v9.7"/>'
  + '<path d="M9.5 6.5l1.25 2.75 2.75 1.25-2.75 1.25-1.25 2.75-1.25-2.75-2.75-1.25 2.75-1.25z" class="fill"/></svg>'
  + '<span></span></button>';
interior.appendChild(box);
const bubble = box.querySelector('.speech-bubble'), btn = box.querySelector('.speech-btn');
let visit = 0, onBack = null;   // a newer visit (or leaving) cancels an older one's bubble
btn.addEventListener('click', () => onBack?.());

const haveStars = () => starRecords.some(r => ['satchel', 'storage', 'pot'].includes(r.location));

function show(on) {
  box.classList.toggle('show', on);
  btn.classList.toggle('show', on); btn.tabIndex = on ? 0 : -1;
}

async function sayNothingToGrow(back) {
  const B = GREENHOUSE.emptyBubble, me = ++visit;
  if (!B.on || haveStars() || house.plantInPot) return;
  await sleep(B.delaySec * 1000);
  if (me !== visit || !interior.classList.contains('show') || haveStars()) return;
  onBack = back;
  bubble.textContent = B.text;
  btn.querySelector('span').textContent = B.button;
  box.style.left = `${B.at[0]}%`; box.style.top = `${B.at[1]}%`;
  show(true);
  if (B.showSec > 0) { await sleep(B.showSec * 1000); if (me === visit) show(false); }
}

// Leaving the greenhouse: no bubble waits or stays for the next visit.
function hushBubble() { visit++; show(false); }

export { sayNothingToGrow, hushBubble };
