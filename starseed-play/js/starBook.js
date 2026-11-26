// The star book on the greenhouse table: a botanical journal of the flowers grown from stars. Tap the book (its own
// tap area over greenhouse_book) and it rises from the table, the cover swings open and the pages turn (arrows, a tap
// on a page, a swipe, ← / →; Esc, ✕ or a tap beside the book closes it).
// One page per flower (species): the 20 mixes of three stars make 8 flowers. A grown flower fills its page with
// Nadin's painting in a little night-sky window, its name, the mixes it grows from (the grown ones lit) and a field
// note. A flower not grown yet shows a pencil sketch of itself and its star mixes as dotted outlines, so the book
// also shows how much is left to find. The title page counts the flowers found; the last page hints at the rare
// stars to come. While the book holds a flower not looked at yet, it glows softly on the table and opens there,
// with a ribbon on that page.
// Art: Assets/book/ (build_book.py). Tuning and texts: STAR_BOOK (config.js). Styles: style.css "Star book".
import { PLANTS, ROOM_H, ROOM_W, STAR_BOOK, STAR_FAMILIES } from './config.js';
import { house, interior, roomLayer, roomSheet } from './greenhouse.js';
import { plantRecords } from './planting.js';
import { countsOf, recipeOf, speciesOf } from './plantModel.js';
import { audio, chime, ensureAudio } from './chime.js';
import { game } from './modes.js';

const B = STAR_BOOK;
const JAR_ORDER = ['water', 'air', 'fire', 'earth'];   // stars in a mix are drawn in the jars' order
const px = (v, of) => `${(v / of * 100).toFixed(3)}%`;

// The mixes (recipe keys) of each flower
const mixesOf = {};
for (const key of PLANTS.recipes) (mixesOf[speciesOf(countsOf(recipeOf(key)))] ??= []).push(key);

// ---------------------------------------------------------------- the book on the table
const bookLayer = roomLayer('greenhouse_book');
const glowArt = roomSheet('greenhouse_book', { className: 'interior-lights' });
const glow = document.createElement('div');
glow.className = 'book-beckon';
Object.assign(glow.style, { left: px(B.beckon.glow[0], ROOM_W), top: px(B.beckon.glow[1], ROOM_H),
  width: px(B.beckon.size[0], ROOM_W), height: px(B.beckon.size[1], ROOM_H), '--strength': B.beckon.strength, '--breath': `${B.beckon.breathSec}s` });
glowArt.appendChild(glow);
const top = roomSheet('greenhouse_book', { top: true, className: 'interior-top' });
const hit = document.createElement('div');
hit.className = 'book-hit';
hit.title = 'Star book';
const [hx, hy, hw, hh] = B.hit;
Object.assign(hit.style, { left: px(hx, ROOM_W), top: px(hy, ROOM_H), width: px(hw, ROOM_W), height: px(hh, ROOM_H) });
// a few sparkles over the cover while it beckons
for (const [x, y, s, d] of [[0.42, 0.18, 1, 0], [0.63, 0.05, 0.7, 1.1], [0.3, 0.42, 0.55, 2]]) {
  const sp = document.createElement('i');
  sp.className = 'book-sparkle';
  Object.assign(sp.style, { left: `${x * 100}%`, top: `${y * 100}%`, '--s': s, animationDelay: `${d}s` });
  hit.appendChild(sp);
}
top.appendChild(hit);

const canOpen = () => game.mode === 'greenhouse' && !house.growing && !document.body.classList.contains('plant-dragging');
hit.addEventListener('pointerenter', () => { if (canOpen()) bookLayer.style.filter = `brightness(${1 + B.hover})`; });
hit.addEventListener('pointerleave', () => { bookLayer.style.filter = ''; });
hit.addEventListener('click', () => { if (canOpen()) openBook(); });

// ---------------------------------------------------------------- what has been found
const seen = new Set();   // flowers whose page has been looked at
function found() {
  const keys = new Set(plantRecords.map(p => p.recipe).filter(Boolean)), species = new Map();
  for (const p of plantRecords) if (p.recipe) { const sp = speciesOf(countsOf(recipeOf(p.recipe))); species.set(sp, (species.get(sp) || 0) + 1); }
  return { keys, species };
}
let hiding = null;   // a new flower, drawn as not grown yet while the pages riffle towards it (showNewFlower)
const has = (f, sp) => f.species.has(sp) && sp !== hiding;
const isNew = (sp, f) => has(f, sp) && !seen.has(sp);
function updateBeckon() {
  const f = found(), any = B.pages.some(p => isNew(p.species, f));
  glow.classList.toggle('on', any); hit.classList.toggle('beckon', any);
}
window.addEventListener('plantcarried', updateBeckon);
window.addEventListener('greenhouseenter', updateBeckon);

// ---------------------------------------------------------------- pages
// Page 0: the title page; 1 … 8: the flowers; last: the rare pages. Spread s shows pages 2s (left) and 2s + 1.
const PAGES = [{ kind: 'title' }, ...B.pages.map((p, i) => ({ kind: 'plant', no: i + 1, ...p })), { kind: 'end' }];
if (PAGES.length % 2) PAGES.push({ kind: 'blank' });
const SPREADS = PAGES.length / 2;

const STAR_PATH = 'M12 1.5C12.9 8.2 15.8 11.1 22.5 12 15.8 12.9 12.9 15.8 12 22.5 11.1 15.8 8.2 12.9 1.5 12 8.2 11.1 11.1 8.2 12 1.5Z';
const star = (color, cls = '') => `<svg class="bk-star ${cls}" viewBox="0 0 24 24" style="--c:${color}"><path d="${STAR_PATH}"/></svg>`;
const corners = '<i class="bk-corner tl"></i><i class="bk-corner tr"></i><i class="bk-corner bl"></i><i class="bk-corner br"></i>';
const showOf = sp => PLANTS.species[sp]?.show ?? '#ffe7a8';

// A seeded scatter of tiny stars for a page's night window (the same every time for that page)
function skyStars(seed) {
  let s = seed * 9301 + 49297, out = '';
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 16; i++) {
    const x = 6 + r() * 88, y = 4 + r() * 58, big = r() < 0.2;
    out += `<i class="bk-sky-star${big ? ' big' : ''}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;animation-delay:${(-r() * 7).toFixed(2)}s"></i>`;
  }
  return out;
}

function mixRow(sp, f, freshKey = null) {
  return (mixesOf[sp] || []).map(key => {
    const stars = recipeOf(key).sort((a, b) => JAR_ORDER.indexOf(a) - JAR_ORDER.indexOf(b));
    const grown = f.keys.has(key);
    return `<span class="bk-mix${grown ? ' grown' : ''}${key === freshKey ? ' fresh' : ''}">${stars.map(t => star(STAR_FAMILIES[t].star, grown ? '' : 'outline')).join('')}</span>`;
  }).join('');
}

// reveal: the page of a flower just found, inking itself in (starBook.css .bk-pg.reveal); freshKey = its mix, lit last
function pageHtml(i, f, { reveal = false, freshKey = null } = {}) {
  const p = PAGES[i];
  if (!p || p.kind === 'blank') return '<div class="bk-pg blank"></div>';
  if (p.kind === 'title') {
    const n = B.pages.filter(q => has(f, q.species)).length;
    const tally = B.pages.map(q => has(f, q.species) ? `<span class="bk-medal lit">${star(showOf(q.species))}</span>`
      : `<span class="bk-medal">${star('#4a3a5c', 'outline')}</span>`).join('');
    return `<div class="bk-pg bk-titlepage">${corners}
      <svg class="bk-moon" viewBox="0 0 100 60"><path class="moon" d="M58 8a24 24 0 1 0 0 44 20 20 0 1 1 0-44z"/>
        <path class="spark" d="${STAR_PATH}" transform="translate(70 6) scale(.9)"/><path class="spark" d="${STAR_PATH}" transform="translate(16 30) scale(.55)"/></svg>
      <h1 class="bk-title">${B.title}</h1>
      <div class="bk-subtitle">${B.subtitle}</div>
      <div class="bk-rule"><span></span>${star('#c9a45a', 'tiny')}<span></span></div>
      <div class="bk-tally">${tally}</div>
      <div class="bk-count"><b>${n}</b> of ${B.pages.length} flowers found</div>
      <div class="bk-owner">${B.owner}</div>
      <div class="bk-folio">✦</div></div>`;
  }
  if (p.kind === 'end') {
    return `<div class="bk-pg bk-endpage">${corners}
      <h2 class="bk-endtitle">${B.end.title}</h2>
      <div class="bk-rule"><span></span>${star('#c9a45a', 'tiny')}<span></span></div>
      <div class="bk-rare">
        <div class="bk-rare-one"><div class="bk-rare-ring">${star('#7ae0c8', 'outline big')}</div><span>?</span></div>
        <div class="bk-rare-one"><div class="bk-rare-ring">${star('#b9a6ff', 'outline big')}</div><span>?</span></div>
      </div>
      <p class="bk-note">${B.end.note}</p>
      <div class="bk-folio">— ${i} —</div></div>`;
  }
  const grown = has(f, p.species), fresh = isNew(p.species, f), title = PLANTS.species[p.species]?.title ?? p.species;
  const keys = mixesOf[p.species] || [], have = keys.filter(k => f.keys.has(k)).length;
  const plate = grown
    ? `<div class="bk-plate"><div class="bk-sky">${skyStars(p.no)}</div><img class="bk-art" src="${B.dir}${p.art}.webp" alt="${title}" draggable="false">
        <i class="bk-tape l"></i><i class="bk-tape r"></i>${reveal ? `<i class="bk-blank"></i><img class="bk-art bk-ghost" src="${B.dir}${p.art}_sketch.webp" alt="" draggable="false">` : ''}</div>`
    : `<div class="bk-plate missing"><img class="bk-art" src="${B.dir}${p.art}_sketch.webp" alt="" draggable="false"><span class="bk-q">?</span></div>`;
  return `<div class="bk-pg plant${grown ? '' : ' missing'}${fresh ? ' new' : ''}${reveal ? ' reveal' : ''}" style="--tint:${showOf(p.species)}">${corners}
    <div class="bk-no">No. ${p.no}</div>
    ${plate}
    ${grown ? `<div class="bk-name">${title}</div><div class="bk-latin">${p.latin}</div>`
            : '<div class="bk-name unknown">not yet grown</div><div class="bk-latin unknown">· · ·</div>'}
    <div class="bk-sown"><span class="bk-label">${grown ? `sown from · ${have} of ${keys.length} found` : 'sown from'}</span>
      <div class="bk-mixes">${mixRow(p.species, f, freshKey)}</div></div>
    <p class="bk-note">${grown ? p.note : B.missingNote}</p>
    ${fresh ? '<i class="bk-ribbon"></i>' : ''}
    <div class="bk-folio">— ${i} —</div></div>`;
}

// ---------------------------------------------------------------- the open book
const root = document.createElement('div');
root.className = 'star-book';
root.innerHTML = `
  <div class="bk-dim"></div>
  <div class="bk-body">
    <div class="bk-board"></div>
    <div class="bk-page left"></div>
    <div class="bk-page right"></div>
    <div class="bk-spine"></div>
    <div class="bk-cover">
      <div class="bk-face front">
        <div class="bk-cover-art">
          <svg class="bk-cover-star" viewBox="0 0 24 24"><path d="M12 2.2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.1l-6.1 3.5 1.5-6.8L2.2 9.2l6.9-.7z"/></svg>
          <div class="bk-cover-title">${B.title}</div>
        </div>
      </div>
      <div class="bk-face back"><div class="bk-page-in"></div></div>
    </div>
  </div>
  <button class="bk-nav prev" aria-label="Previous page"><svg viewBox="0 0 32 32"><path d="M19.5 7 10.5 16l9 9"/></svg></button>
  <button class="bk-nav next" aria-label="Next page"><svg viewBox="0 0 32 32"><path d="M12.5 7l9 9-9 9"/></svg></button>
  <button class="bk-close return-btn" aria-label="Close the book"><svg viewBox="0 0 32 32"><path d="M9 9l14 14M23 9 9 23"/></svg></button>`;
interior.appendChild(root);
const $b = sel => root.querySelector(sel);
const body = $b('.bk-body'), leftPage = $b('.bk-page.left'), rightPage = $b('.bk-page.right'), cover = $b('.bk-cover');
const coverBack = $b('.bk-face.back .bk-page-in'), btnPrev = $b('.bk-nav.prev'), btnNext = $b('.bk-nav.next');

const book = { open: false, busy: false, opening: false, closeAfter: false, auto: false, spread: 0 };
let f = found();

function fill(el, i) { el.innerHTML = pageHtml(i, f); }
function showSpread(s, refill = true) {
  book.spread = s;
  if (refill) { fill(leftPage, 2 * s); fill(rightPage, 2 * s + 1); }
  markSeen(s);
  btnPrev.classList.toggle('off', s === 0); btnNext.classList.toggle('off', s === SPREADS - 1);
}
function markSeen(s) {
  for (const i of [2 * s, 2 * s + 1]) { const p = PAGES[i]; if (p?.kind === 'plant' && has(f, p.species)) seen.add(p.species); }
  updateBeckon();
}

// Where the book lies on the table, relative to the middle of the screen, and how small it is there
function fromTable() {
  const r = hit.getBoundingClientRect(), o = root.getBoundingClientRect(), u = o.height / 100;
  const k = Math.max(0.12, r.width / (63 * u));
  return { x: r.left + r.width / 2 - (o.left + o.width / 2), y: r.top + r.height / 2 - (o.top + o.height / 2), k };
}
const P = 'perspective(240cqh) ';   // each turning part has its own perspective, vanishing at the spine
const closedAt = () => `translate(-${30.8}cqh, 0) `;   // a closed book: only its right half, centred

async function openBook(at = null) {
  if (book.open || book.busy) return;
  book.open = book.busy = book.opening = true; book.closeAfter = false;
  f = found();
  // open where something new waits, else where it was left
  const fresh = PAGES.findIndex(p => p.kind === 'plant' && isNew(p.species, f));
  const target = at ?? (fresh >= 0 ? Math.floor(fresh / 2) : book.spread);
  fill(coverBack, 2 * target); fill(rightPage, 2 * target + 1); leftPage.innerHTML = '';
  leftPage.style.visibility = 'hidden';
  document.body.classList.add('book-open');
  root.classList.add('show', 'lit');
  bookLayer.style.filter = ''; bookLayer.style.opacity = '0';   // it has left the table
  ensureAudio();
  chime(7, 0.22, 0, 2.4, STAR_FAMILIES.air); chime(11, 0.16, 0.18, 2.4, STAR_FAMILIES.air);
  const t = fromTable(), sec = B.openSec * 1000;
  cover.style.transform = `${P}rotateY(0deg)`; cover.style.zIndex = 5;
  await body.animate([
    { transform: `translate(${t.x}px, ${t.y}px) ${closedAt()} ${P}scale(${t.k}) rotateX(62deg)`, opacity: 0 },
    { opacity: 1, offset: 0.25 },
    { transform: `translate(0px, 0px) ${closedAt()} ${P}scale(1) rotateX(0deg)`, opacity: 1 },
  ], { duration: sec * 0.55, easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'forwards' }).finished;
  rustle(0.9);
  const swing = cover.animate([{ transform: `${P}rotateY(0deg)` }, { transform: `${P}rotateY(-180deg)` }],
    { duration: sec * 0.75, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
  body.animate([{ transform: `${closedAt()} ${P}scale(1) rotateX(0deg)` }, { transform: `translate(0, 0) ${P}scale(1) rotateX(0deg)` }],
    { duration: sec * 0.75, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
  await swing.finished;
  cover.style.transform = `${P}rotateY(-180deg)`; cover.style.zIndex = 0;   // now the left board, under the left page
  showSpread(target);
  leftPage.style.visibility = '';
  if (fresh >= 0 && at === null) setTimeout(() => chime(9, 0.18, 0, 2, STAR_FAMILIES.water), 150);
  book.busy = book.opening = false; queued = 0;   // (no turns saved up while it opened)
  if (book.closeAfter) { book.closeAfter = false; closeBook(); }
}

async function closeBook() {
  queued = 0;
  if (book.auto) return;   // (a new flower is being written in)
  if (book.opening) { book.closeAfter = true; return; }   // still opening: it closes once open
  if (!book.open || book.busy) return;
  book.busy = true;
  fill(coverBack, 2 * book.spread);
  leftPage.style.visibility = 'hidden'; cover.style.zIndex = 5;
  const sec = B.openSec * 1000;
  rustle(0.7);
  const swing = cover.animate([{ transform: `${P}rotateY(-180deg)` }, { transform: `${P}rotateY(0deg)` }],
    { duration: sec * 0.6, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
  body.animate([{ transform: `translate(0, 0) ${P}scale(1) rotateX(0deg)` }, { transform: `${closedAt()} ${P}scale(1) rotateX(0deg)` }],
    { duration: sec * 0.6, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'forwards' });
  await swing.finished;
  const t = fromTable();
  root.classList.remove('lit');   // the dim and the buttons fade while the book goes back down
  await body.animate([
    { transform: `translate(0px, 0px) ${closedAt()} ${P}scale(1) rotateX(0deg)`, opacity: 1 },
    { opacity: 1, offset: 0.75 },
    { transform: `translate(${t.x}px, ${t.y}px) ${closedAt()} ${P}scale(${t.k}) rotateX(62deg)`, opacity: 0 },
  ], { duration: sec * 0.45, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' }).finished;
  bookLayer.style.opacity = '';
  root.classList.remove('show');
  document.body.classList.remove('book-open');
  book.open = book.busy = false;
  house.bookHold = false;   // (planting.js: the new flower's name and Carry it outside follow now)
}

// One page turn: a leaf lifts off one side and lays down on the other, shading as it turns.
let queued = 0;   // a turn asked for while a page is still turning follows right after it
// speed: share of STAR_BOOK.flipSec (the quick riffle to a new flower)
async function turn(dir, speed = 1) {
  if (!book.open) return;
  if (book.busy) { queued = dir; return; }
  const to = book.spread + dir;
  if (to < 0 || to >= SPREADS) { nudge(dir); return; }
  book.busy = true;
  const leaf = document.createElement('div');
  leaf.className = 'bk-leaf';
  leaf.innerHTML = '<div class="bk-face front"><div class="bk-page-in"></div><i class="bk-shade"></i></div>'
    + '<div class="bk-face back"><div class="bk-page-in"></div><i class="bk-shade"></i></div>';
  const [front, back] = leaf.querySelectorAll('.bk-page-in'), [shF, shB] = leaf.querySelectorAll('.bk-shade');
  // forward: the leaf is the right page now (front) and the next left page (back); backward the other way round
  fill(front, dir > 0 ? 2 * book.spread + 1 : 2 * to + 1);
  fill(back, dir > 0 ? 2 * to : 2 * book.spread);
  if (dir > 0) fill(rightPage, 2 * to + 1); else fill(leftPage, 2 * to);
  body.appendChild(leaf);
  const under = document.createElement('i');   // the shadow the leaf casts on the page it uncovers
  under.className = 'bk-under ' + (dir > 0 ? 'right' : 'left');
  body.insertBefore(under, leaf);
  const sec = B.flipSec * 1000 * speed, ease = speed < 1 ? 'cubic-bezier(.3,.1,.4,1)' : 'cubic-bezier(.42,.02,.28,1)';
  const from = dir > 0 ? 0 : -180, toDeg = dir > 0 ? -180 : 0;
  rustle((0.6 + Math.random() * 0.3) * (speed < 1 ? 0.6 : 1));
  const a = leaf.animate([{ transform: `${P}rotateY(${from}deg)` }, { transform: `${P}rotateY(${toDeg}deg)` }],
    { duration: sec, easing: ease, fill: 'forwards' });
  const opts = { duration: sec, easing: ease, fill: 'forwards' };
  (dir > 0 ? shF : shB).animate([{ opacity: 0 }, { opacity: 0.45 }], opts);
  (dir > 0 ? shB : shF).animate([{ opacity: 0.45 }, { opacity: 0 }], opts);
  under.animate([{ opacity: 0.55 }, { opacity: 0 }], opts);
  await a.finished;
  if (dir > 0) fill(leftPage, 2 * to); else fill(rightPage, 2 * to + 1);
  leaf.remove(); under.remove();
  showSpread(to, false);
  book.busy = false;
  if (queued) { const q = queued; queued = 0; turn(q); }
}
// at the first / last page: the edge lifts a little and settles back
function nudge(dir) {
  const page = dir > 0 ? rightPage : leftPage;
  page.animate([{ transform: `${P}rotateY(0deg)` }, { transform: `${P}rotateY(${dir > 0 ? -7 : 7}deg)` }, { transform: `${P}rotateY(0deg)` }],
    { duration: 420, easing: 'ease-in-out' });
}

// A soft paper rustle: filtered noise through the chimes' room
let noise = null;
function rustle(level = 1) {
  const { ctx, master } = audio();
  if (!ctx) return;
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime, src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  bp.type = 'bandpass'; bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(1800, t); bp.frequency.exponentialRampToValueAtTime(4200, t + 0.35);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t); src.stop(t + 0.6);
}

// ---------------------------------------------------------------- a new flower
// The first plant of a flower has grown (planting.js 'plantgrown'): before its name and Carry it outside show
// (house.bookHold), the book rises from the table, opens on the title page, riffles quickly through to the flower's
// page (drawn as a sketch until then) and the entry inks itself in. Closing the book lets the greenhouse carry on.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function showNewFlower(plant) {
  const N = B.newFlower;
  if (!N.on || !plant?.recipe || book.open) return;
  const spOf = key => speciesOf(countsOf(recipeOf(key))), sp = spOf(plant.recipe);
  if (plantRecords.filter(p => p.recipe && spOf(p.recipe) === sp).length !== 1) return;   // not the first of its flower
  const idx = PAGES.findIndex(p => p.kind === 'plant' && p.species === sp);
  if (idx < 0) return;
  house.bookHold = true; book.auto = true; hiding = sp;
  await sleep(N.delaySec * 1000);
  await openBook(0);
  await sleep(N.pauseSec * 1000);
  const target = Math.floor(idx / 2);
  for (let s = book.spread; s < target; s++) await turn(1, s === target - 1 ? N.lastFlip : N.flip);
  hiding = null; f = found();
  const el = idx % 2 ? rightPage : leftPage;
  el.innerHTML = pageHtml(idx, f, { reveal: true, freshKey: plant.recipe });
  markSeen(target);
  [7, 9, 11, 14].forEach((n, i) => chime(n, 0.2 - i * 0.03, 0.7 + i * 0.16, 2.4, STAR_FAMILIES.air));
  await sleep(N.revealSec * 1000);
  if (target === 0) fill(leftPage, 0);   // the title page beside it: the count goes up
  book.auto = false;
}
window.addEventListener('plantgrown', e => showNewFlower(e.detail));

// ---------------------------------------------------------------- controls
const userTurn = dir => { if (!book.auto) turn(dir); };   // (not while a new flower is written in)
btnPrev.addEventListener('click', () => userTurn(-1));
btnNext.addEventListener('click', () => userTurn(1));
$b('.bk-close').addEventListener('click', closeBook);
$b('.bk-dim').addEventListener('click', closeBook);
leftPage.addEventListener('click', () => { if (!swiped) userTurn(-1); });
rightPage.addEventListener('click', () => { if (!swiped) userTurn(1); });
let swipeX = null, swiped = false;
body.addEventListener('pointerdown', e => { swipeX = e.clientX; swiped = false; });
body.addEventListener('pointerup', e => {
  if (swipeX === null) return;
  const dx = e.clientX - swipeX, u = root.clientHeight / 100;
  swipeX = null;
  if (Math.abs(dx) > 6 * u) { swiped = true; userTurn(dx < 0 ? 1 : -1); }
});
// While the book is open its keys come first (Esc closes the book, not the greenhouse: modes.js listens later)
window.addEventListener('keydown', e => {
  if (!book.open) return;
  if (e.key === 'Escape') closeBook();
  else if (e.key === 'ArrowRight') userTurn(1);
  else if (e.key === 'ArrowLeft') userTurn(-1);
  else return;
  e.stopImmediatePropagation(); e.preventDefault();
}, true);

export { book as starBook, openBook, closeBook };
