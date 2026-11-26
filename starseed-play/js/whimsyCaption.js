// A hint for the player, written like the constellation names in the sky (style.css .whimsy-caption): a main line
// in spaced golden capitals that swooshes out of its centre letter by letter between two blooming stars, a smaller
// line under it, over a soft dark haze. Toggle the 'show' class to show it; the swoosh replays each time.
// The caller positions it (left / top = the point just below its bottom centre). className 'breathe': the letters
// breathe in one after another out of a soft blur, like the sky's "in rhythm" note, instead of the swoosh.

function whimsyCaption(parent, className = '') {
  const el = document.createElement('div');
  el.className = `whimsy-caption ${className}`.trim();
  parent.appendChild(el);
  let shown = null;
  // set the words (rebuilt only when they change; a change replays the swoosh)
  function set(main, sub = '') {
    const key = main + '|' + sub;
    if (key === shown) return;
    shown = key;
    // --d = steps from the middle letter (timing), --o = how far it starts towards the middle (in letters), --i = index
    const chars = [...main], mid = (chars.length - 1) / 2;
    el.innerHTML = '<span class="wc-main"><span class="wc-star">✦</span>' + chars.map((ch, i) =>
      `<span class="wc-ch" style="--i:${i};--d:${Math.abs(i - mid).toFixed(1)};--o:${(mid - i).toFixed(1)}">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('')
      + '<span class="wc-star">✦</span></span>' + (sub ? `<span class="wc-sub">${sub}</span>` : '');
  }
  return { el, set };
}

export { whimsyCaption };
