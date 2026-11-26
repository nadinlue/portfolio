// Plant model and drawing (B1), ported from the Plant Lab (sketches/plant-lab.html, new rules): three stars →
// a species (the flower colour), its growth numbers, then a deterministic plant per (mix, variant) built from
// Nadin's painted pieces (concept heads + painted leaf setup) and generated stems, drawn on 2D canvases and lit
// as base × ambient + rim, with an additive flower glow. Same random sequence as the Lab, so variant n here
// looks like "Variation n" there. Species with concept heads, with a painted leaf setup (the orange star lily) or
// the Lab's generic leaves (leaf1–4 as base and stem leaves, side twigs; bells hang).
// Tuning: PLANTS (config.js), overlaid by the Lab's settings file in loadPlantArt(). Two places, as in the Lab:
// 'gh' (the greenhouse pot) and 'roof' (the planters), each with its own Tuning keys (gh… / roof…) and Shapes per mix.
import { PLANTS } from './config.js';

const ORDER = ['fire', 'water', 'earth', 'air'];
const COLOR_STARS = ['fire', 'water', 'air'];
const COLOR_OF = { fire: 'red', water: 'blue', air: 'yellow' };
const LEAF_LAYERS = ['back', 'behind', 'stem', 'front'];
const LEAF_HEAD_ROOM = 0.42, HEAD_SPREAD_MAX = 0.45, HEAD_ROOM = 0.42, HEAD_STAGGER = 0.3, HEAD_STAGGER_MAX = 0.35;
const CONCEPT_FOLLOW = 0.85, GLOW_SCALE = 0.5, deg = Math.PI / 180;

const T = { ...PLANTS.tuning };                 // Lab tuning (greenhouse + roof)
const MIXES = { gh: structuredClone(PLANTS.mixes), roof: {} };   // Lab Shapes per mix and place
const labSpots = [];                            // the Lab's roof spots (light, scale), filled by loadPlantArt
const HEADS = {}, PARTS = {}, img = {};
let GREEN = null;   // the climber's measured stem path and layer box (Assets/plants/green.json), once loaded

// ---------------------------------------------------------------- helpers
const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth01 = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const hex2rgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgb2hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mixHex = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
const scaleHex = (h, b) => rgb2hex(hex2rgb(h).map(v => v * b));
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function hashStr(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const canvas2 = (w = 1, h = 1) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

const countsOf = types => { const c = { fire: 0, water: 0, earth: 0, air: 0 }; for (const t of types) c[t]++; return c; };
const mixKey = c => ORDER.map(k => c[k]).join('');
const speciesOf = c => COLOR_STARS.filter(s => c[s] > 0).map(s => COLOR_OF[s]).sort().join('+') || 'green';
const leanOf = c => {   // the most-used colour star, when two or more colours are present and one leads
  const present = COLOR_STARS.filter(s => c[s] > 0); if (present.length < 2) return null;
  const max = Math.max(...present.map(s => c[s])), top = present.filter(s => c[s] === max);
  return top.length === 1 ? top[0] : null;
};
const recipeOf = key => ORDER.flatMap((k, i) => Array(+key[i]).fill(k));   // '1011' → ['fire', 'earth', 'air']

// ---------------------------------------------------------------- loading
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Missing ' + src)); i.src = src; });
const getJson = async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); };
let loading = null;
// Heads, leaf setups and their images for the species of the playable recipes, plus the Lab's current values.
function loadPlantArt() {
  return loading ??= (async () => {
    try {   // the values the Lab shows (its work in progress, else its saved state)
      const doc = await getJson(PLANTS.labFile).catch(() => getJson(PLANTS.labFileStatic)), w = doc.work || {};
      for (const k of Object.keys(T)) { const v = w.tuning?.[k] ?? doc.tuning?.gh?.[k] ?? doc.tuning?.roof?.[k]; if (v != null) T[k] = v; }
      for (const key of PLANTS.recipes) for (const place of ['gh', 'roof']) {
        const v = w.combos?.[key]?.[place] ?? doc.combos?.[key]?.[place]; if (v) MIXES[place][key] = { ...v };
      }
      const spots = w.spots ?? doc.spots;
      if (Array.isArray(spots)) labSpots.splice(0, labSpots.length, ...spots);
    } catch (e) { /* no Lab file: the values in config.js */ }
    const heads = await getJson(PLANTS.dir + 'heads.json'), jobs = [];
    for (const key of PLANTS.recipes) {
      const sp = PLANTS.species[speciesOf(countsOf(recipeOf(key)))];
      if (sp?.vine) {   // the climber: its two leaf layers and the painted stem's path
        if (!GREEN) {
          GREEN = await getJson(PLANTS.dir + 'green.json');
          for (const n of ['green/leavesback', 'green/leavesfront']) { img[n] = null; jobs.push(loadImage(PLANTS.dir + n + '.webp').then(i => { img[n] = i; })); }
        }
        continue;
      }
      if (!sp || HEADS[sp.heads]) continue;
      HEADS[sp.heads] = heads[sp.heads].map(h => ({ ...h, follow: CONCEPT_FOLLOW, hang: !!sp.hang }));
      // its painted leaf setup, or the generic leaves
      const parts = sp.leaves && (PARTS[sp.leaves.parts] ??= await getJson(PLANTS.dir + sp.leaves.parts + '.json'));
      const leaves = parts ? Object.values(parts.groups).flat().map(pc => pc.n) : PLANTS.leaves.map(l => l.n);
      for (const n of [...HEADS[sp.heads].map(h => h.n), ...leaves])
        if (!img[n]) { img[n] = null; jobs.push(loadImage(PLANTS.dir + n + '.webp').then(i => { img[n] = i; })); }
    }
    await Promise.all(jobs);
  })();
}

// ---------------------------------------------------------------- the plant model (deterministic per mix + variant)
function formOf(species, lean) {
  const F = { ...PLANTS.species[species].form }, n = lean && PLANTS.nudge[lean];
  if (n) { F.tall *= n.tall; F.spread = Math.max(0, F.spread + n.spread); F.droop = clamp01(F.droop + n.droop); F.stems = Math.max(1, F.stems + n.stems); }
  return F;
}
// The values a plant is built from (Lab plantParams): species defaults + the mix's own changes, per place.
function plantParams(c, F, place) {
  const e = c.earth, setup = PLANTS.species[speciesOf(c)].leaves, Lk = k => T[place + '_' + k];
  const defaults = {
    unit: T[place + 'Bloom'], height: Math.round(T[place + 'H' + Math.min(2, e)] * F.tall), stemW: +(Lk('stemW') * (1 + 0.12 * e)).toFixed(3),
    stems: Math.round(F.stems), headScale: F.headScale, follow: F.follow ?? 0.85, spread: F.spread,
    bend: Math.round(Lk('bendStraight') + (Lk('bendDroop') - Lk('bendStraight')) * F.droop), bendFrom: F.bendFrom ?? Lk('bendFrom'),
    heightVary: e > 0 ? 0.07 : 0, stemBase: F.stemBase ?? 0.22, side: F.side ?? 0,
  };
  if (PLANTS.species[speciesOf(c)].vine) Object.assign(defaults, { rosette: 0, ...PLANTS.species[speciesOf(c)].vine.params });   // the climber
  else if (setup) Object.assign(defaults, { paintLeaf: 1, paintFan: 0, stemLeavesMax: setup.stem ? setup.stem.count[1] : 0 });
  else Object.assign(defaults, {   // the generic leaves
    leafSize: +(Lk('leafSize') * (1 + Lk('leafGreen') * e)).toFixed(2), leafLen: F.leafLen, leafWid: F.leafWid,
    stemLeaves: F.stemLeaves > 0 ? Math.round(F.stemLeaves) + (e > 0 ? 1 : 0) : 0,
    rosette: Math.round(F.rosette) + 2 * e, rosetteSpread: +(F.rosetteSpread * (1 + e * 0.05)).toFixed(2),
  });
  return { ...defaults, ...MIXES[place][mixKey(c)] };
}

function makeModel(counts, seed = 0, place = 'gh') {
  const r = rng(hashStr(mixKey(counts) + ':' + seed));
  const species = speciesOf(counts), sp = PLANTS.species[species], F = formOf(species, leanOf(counts));
  const P = plantParams(counts, F, place), heads = sp.heads ? HEADS[sp.heads] : [], setup = sp.leaves, nH = heads.length || 1;
  r();   // (the Lab picks a start head here; painted setups deal their heads instead)
  const deck = [];
  const shuffled = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const head = t => {
    if (setup) {   // painted setup: every flower its own head (again only once all were used), all upright and front-facing
      if (!deck.length) deck.push(...shuffled([...Array(nH).keys()]));
      return { h: deck.shift(), mirror: r() < 0.5, spin: (r() - 0.5) * 0.2, size: 0.92 + r() * 0.16 - Math.abs(t) * 0.08 };
    }
    // concept heads as painted: 1 = middle, 2 = leaning left, 3 = leaning right; sometimes the other side's, mirrored
    const side = Math.abs(t) < 0.34 ? 0 : t < 0 ? 1 : 2, swap = side && r() < 0.35;
    return { h: swap ? 3 - side : side, mirror: !!swap, spin: (r() - 0.5) * 0.25, size: 0.9 + r() * 0.2 - Math.abs(t) * 0.08 };
  };
  const nLeaves = PLANTS.leaves.length;
  const stems = [], n = sp.vine ? 0 : P.stems;
  // stem heights spread evenly over ±heightVary in a random order (own random numbers)
  const rh = rng(hashStr(mixKey(counts) + ':h' + seed)), lift = Array.from({ length: n }, (_, i) => n > 1 ? i / (n - 1) * 2 - 1 : 0);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rh() * (i + 1)); [lift[i], lift[j]] = [lift[j], lift[i]]; }
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) * 2 - 1;   // -1 (left) … 1 (right)
    const st = {
      x: (t + (r() - 0.5) * 0.36) * P.stemBase, lean: t * P.spread + (r() - 0.5) * 0.12,
      lenF: (1 - Math.abs(t) * 0.2 - r() * 0.1) * (1 + lift[i] * (P.heightVary || 0)),
      dir: t === 0 ? (r() < 0.5 ? -1 : 1) : Math.sign(t), head: head(t), twigs: [], leaves: [],
    };
    st.stagger = rh();
    // generic leaves up the stem (none with a painted setup), and maybe a smaller flower on a side twig
    const extra = r() < 0.4, nL = setup ? 0 : Math.round(P.stemLeaves) + (extra && P.stemLeaves > 0 ? 1 : 0);
    st.leaves = Array.from({ length: nL }, (_, j) => ({ s: 0.12 + (j + r() * 0.5) / nL * 0.55, side: (j + i) % 2 ? 1 : -1,
      spread: (r() - 0.5) * 0.45, size: 0.85 + r() * 0.3, img: Math.floor(r() * nLeaves) }));
    if (r() < P.side) st.twigs.push({ s: 0.55 + r() * 0.2, side: r() < 0.5 ? -1 : 1, len: 0.8 + r() * 0.4, ...head(t), size: 0.66 + r() * 0.12 });
    stems.push(st);
  }
  const pleaves = [];
  let parts = null, rosette = [];
  if (setup) {
    // painted leaves: from the ground, split between the sides, and on the stems, dealt out evenly
    parts = PARTS[setup.parts];
    const used = new Map();
    const piece = group => {   // the least used piece of the group, picked at random
      const all = parts.groups[group] || [], least = Math.min(...all.map(pc => used.get(pc) || 0));
      const pool = all.filter(pc => (used.get(pc) || 0) === least), pc = pool[Math.floor(r() * pool.length)];
      used.set(pc, least + 1); return pc;
    };
    const span = (a, f) => a[0] + (a[1] - a[0]) * f;
    for (const gr of setup.ground) {
      if (!parts.groups[gr.group]) continue;
      const k = gr.count[0] + Math.floor(r() * (gr.count[1] - gr.count[0] + 1));
      const nLeft = k % 2 ? (k - 1) / 2 + (r() < 0.5 ? 1 : 0) : k / 2;
      for (const [side, m] of [[-1, nLeft], [1, k - nLeft]]) for (let j = 0; j < m; j++) {
        const f = m > 1 ? j / (m - 1) : 0.5;
        pleaves.push({ pc: piece(gr.group), side, layer: gr.layer, turn: (span(gr.turn, f) + (r() - 0.5) * 2 * gr.jitter) * deg,
          x: side * span(gr.x, r()), size: span(gr.size, r()), delay: gr.delay + f * 0.08 + r() * 0.04 });
      }
    }
    pleaves.sort((p, q) => LEAF_LAYERS.indexOf(p.layer) - LEAF_LAYERS.indexOf(q.layer) || p.turn - q.turn);
    const sl = setup.stem;
    if (sl && parts.groups[sl.group] && stems.length) {
      const most = Math.min(sl.count[1], Math.round(P.stemLeavesMax)), least = Math.min(sl.count[0], most);
      const total = least + Math.floor(r() * (most - least + 1)), order = shuffled(stems.map((st, i) => i));
      for (let j = 0; j < total; j++) (stems[order[j % stems.length]].pleaves ??= []).push({});
      for (const st of stems) {
        const list = st.pleaves || [], first = r() < 0.5 ? 1 : -1;
        list.forEach((lf, j) => Object.assign(lf, { pc: piece(sl.group), layer: 'stem', side: j % 2 ? -first : first,
          at: list.length > 1 ? span(sl.at, j / (list.length - 1)) + (r() - 0.5) * 0.04 : span(sl.at, r()),
          open: span(sl.open, r()) * deg, size: span(sl.size, r()) }));
      }
    }
  }
  stems.sort((p, q) => Math.abs(q.x) - Math.abs(p.x));   // outer stems behind, middle in front
  // the climber (Lab makeModel, pure Green): each variation winds its strands and sets its leaf stalks a little differently
  let vine = null;
  if (sp.vine && GREEN) {
    const V = sp.vine, nStr = Math.max(1, Math.round(P.vineStrands)), nSh = Math.max(0, Math.round(P.vineShoots)), first = r() < 0.5 ? 1 : -1;
    vine = {
      strands: Array.from({ length: nStr }, (_, k) => ({ phase: (k / nStr + (r() - 0.5) * 0.15) * Math.PI * 2, col: V.strands[k % V.strands.length],
        twist: P.vineTwist * (0.85 + r() * 0.3), w: 0.85 + r() * 0.3 })),
      shoots: Array.from({ length: nSh }, (_, i) => ({ t: 0.06 + (i + 0.3 + r() * 0.4) / nSh * 0.86, side: i % 2 ? -first : first,
        out: 0.9 + r() * 0.5, len: 0.8 + r() * 0.4, curl: 0.7 + r() * 0.6 })),
      sway: (r() - 0.5) * 0.04,
    };
  }
  if (!setup) {   // generic base leaves, fanned out by rosetteSpread
    const nR = Math.round(P.rosette);
    rosette = Array.from({ length: nR }, (_, j) => ({ a: (j / Math.max(1, nR - 1) * 2 - 1) * P.rosetteSpread + (r() - 0.5) * 0.25,
      x: (r() - 0.5) * 0.35, lenF: 0.8 + r() * 0.4, img: Math.floor(r() * nLeaves) }));
  }
  return { counts: { ...counts }, place, P, F, species, heads, parts, stems, pleaves, rosette, vine, vineLook: sp.vine, stemCol: sp.stem, petal: sp.show, glow: F.glow };
}

// Geometry at a given growth (0 … 1), in px relative to the soil point (y up = negative).
// u = plant unit in px (a flower's width), H = stem length in px.
const geom = (m, u, H, grow) => withBounds(m, u, vineGeom(m, H, grow, PLANTS.organic.on ? geomOrganic(m, u, H, grow) : geomBefore(m, u, H, grow)));
// springy ease-out: overshoots a little (s) and settles at 1
export const backOut = (t, s) => { t = clamp01(t) - 1; return 1 + (s + 1) * t * t * t + s * t * t; };

// The organic growth (Lab geom with REVEAL_ORGANIC, PLANTS.organic). Every piece springs on its own right after it
// has grown: m.growSec = seconds per unit of growth (set while it grows, null once settled), m.bounceT = seconds since.
// m.headOpen(stem), if set, scales how open that stem's flowers are (the roof garden closes and reopens them).
function geomOrganic(m, u, H, grow) {
  const O = PLANTS.organic, Bn = O.spring, FS = O.flower, P = m.P, bend = P.bend * deg, bf = P.bendFrom;
  const out = { stems: [], heads: [], pleaves: [], leaves: [] };
  const since = e => m.growSec == null || grow < e ? -1 : (grow - e) * m.growSec + (m.bounceT ?? 0);
  const spring = (amp, f, delay, end) => { const t = since(end) - delay; return t < 0 ? 0 : amp * O.bounce * Math.exp(-t * Bn.damp) * Math.sin(t * Math.PI * 2 * f); };
  const pop = t => ({ len: t > 0 ? backOut(t / 0.75, O.pop) : 0, open: smooth01((t - 0.2) / 0.8) });   // a leaf pops out, opening a little later
  const addHead = (hd, x, y, a, size, g, st, open, ripe) => {
    const sz = size * m.heads[hd.h].w;   // a bell's middle hangs below its anchor
    if (m.headOpen) open *= m.headOpen(st);
    out.heads.push({ ...hd, st, follow: P.follow, x, y, a, size, g, open, ripe, cx: x, cy: m.heads[hd.h].hang ? y + sz * 0.55 : y, r: open > 0.5 ? sz * 0.5 : 0 });
  };
  const ps = m.parts ? H / m.parts.stem * (P.paintLeaf ?? 1) : 0, leafLen = u * (P.leafSize ?? 0);
  // generic base leaves: pop out of the soil one by one, fanning out as they open; the outer ones in front of the stems
  m.rosette.forEach((ro, j) => {
    const { len: g, open } = pop(clamp01((grow - O.leaves[0] - j * 0.04) / O.leafDur));
    const len = leafLen * P.leafLen * 1.1 * ro.lenF * g; if (len < 0.5) return;
    const flex = spring(Bn.leaf, Bn.freq * (0.8 + 0.3 * ro.lenF), Bn.lag * Math.min(1, Math.abs(ro.a)), O.leaves[0] + j * 0.04 + O.leafDur) * Math.sign(ro.a || 1);
    out.leaves.push({ x: ro.x * u, y: 0, a: ro.a * (0.3 + 0.7 * open) + flex, len, wid: P.leafWid * (0.15 + 0.85 * open), img: ro.img,
      layer: Math.abs(ro.a) > P.rosetteSpread * 0.8 ? 2 : 0 });
  });
  const pushPainted = (lf, x, y, d, g, open) => {   // wf: its width across the foot→tip line while it opens
    if (g <= 0.001) return;
    out.pleaves.push({ pc: lf.pc, side: lf.side, layer: lf.layer, ref: lf, x, y, g, wf: 0.15 + 0.85 * open, k: ps * lf.size * (lf.adjSize ?? 1), rot: d - lf.side * lf.pc.angle });
  };
  m.pleaves.forEach((lf, li) => {   // ground leaves: pop out of the soil standing up, settling outwards; the long ones flex slower
    const fl = Bn.freq * Math.sqrt(0.8 / Math.max(0.4, lf.size)) * (0.8 + 0.35 * ((li * 0.618) % 1));
    const flex = spring(Bn.leaf, fl, Bn.lag * (0.3 + 0.7 * Math.min(1, Math.abs(lf.turn) / 0.4)), O.leaves[0] + lf.delay * O.leaves[1] + O.leafDur);
    const dir = lf.side * (lf.pc.angle + lf.turn + (P.paintFan || 0) * deg + (lf.adjTurn || 0) + flex);
    const { len, open } = pop(clamp01((grow - O.leaves[0] - lf.delay * O.leaves[1]) / O.leafDur));
    pushPainted(lf, lf.x * ps, 0, dir * (0.35 + 0.65 * open), len, open);
  });
  // young = 1 - the stem's growth: stands closer to the middle; nod = its searching tip; wob = the flower's sway at the top
  const curve = (st, L, drawn, bendA, young, nod, wob) => {
    const N = 40, ds = L / N; let x = st.x * u, y = 0, trav = 0;
    const lean = (st.lean + (st.leanAdj || 0)) * (1 - O.fan * young), pts = [[x, y, lean, 0]];
    for (let i = 0; i < N && trav < drawn - 1e-6; i++) {
      const s = (i + 0.5) / N, curl = nod * smooth01((trav / Math.max(1, drawn) - 0.35) / 0.65);
      const a = lean + bendA * st.dir * smooth01((s - bf) / (1 - bf)) + curl + wob * s * s, seg = Math.min(ds, drawn - trav);
      x += Math.sin(a) * seg; y -= Math.cos(a) * seg; trav += seg; pts.push([x, y, a, trav / L]);
    }
    const at = len => {
      const fi = len / ds, i = Math.max(0, Math.min(pts.length - 2, Math.floor(fi))), t = Math.min(1, fi - i), p = pts[i], q = pts[i + 1];
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, q[2]];
    };
    return { pts, at };
  };
  // the stems shoot up one after another, the tallest first
  const nSt = m.stems.length, rank = new Map([...m.stems].sort((p, q) => q.lenF - p.lenF).map((st, i) => [st, i]));
  const stemSpan = Math.max(0.05, O.stems[1] - O.stems[0] - (nSt - 1) * O.stemStagger);
  for (const st of m.stems) {
    const j = rank.get(st), st0 = O.stems[0] + j * O.stemStagger;
    const t = clamp01((grow - st0) / stemSpan), sg = t * (2 - t), young = 1 - sg;   // fast, then slowing
    const nod = O.nod * young * Math.sin(t * O.nodWaves * Math.PI * 2 + st.x * 3 + j * 1.7);
    const headStart = st0 + stemSpan * O.openAt, ff = FS.freq * Math.sqrt(1 / Math.max(0.5, st.lenF));   // longer stems sway slower
    const sway = (delay = 0) => { const tt = since(headStart) - delay; return tt < 0 ? 0 : Math.exp(-tt * FS.damp) * Math.sin(tt * Math.PI * 2 * ff); };
    const fs = Bn.freq * Math.sqrt(1 / Math.max(0.5, st.lenF)) * (0.88 + 0.24 * (st.stagger ?? 0.5));
    const L = st.lenF * (1 + (st.lenAdj || 0)) * H, drawn = L * sg;
    const { pts, at } = curve(st, L, drawn, bend * (0.3 + 0.7 * sg), young, nod, FS.amp * sway() * (st.dir || 1));
    if (pts.length < 2) continue;
    const w0 = u * P.stemW * (0.75 + 0.25 * st.lenF) * (0.5 + 0.5 * sg);   // thickens as it grows
    out.stems.push({ pts, w0, tip: young > 0 ? { L, drawn, len: u * O.tipLen, k: Math.sqrt(young) } : null });
    // a stem leaf is fully grown once the stem has climbed leafGrow flower widths past it (sg = t(2 - t))
    const leafEnd = pos => st0 + (1 - Math.sqrt(1 - Math.min(1, (pos + u * O.leafGrow) / Math.max(1, L)))) * stemSpan;
    for (const lf of st.pleaves || []) {
      const pos = Math.max(0.2, lf.at + (lf.adjAt || 0)) * L; if (pos >= drawn) continue;
      const p = at(pos), { len, open } = pop(clamp01((drawn - pos) / (u * O.leafGrow)));
      const flut = spring(Bn.stemLeaf, fs * 1.5, Bn.lag * (1 + lf.at), leafEnd(pos)) * lf.side;
      pushPainted(lf, p[0], p[1], p[2] + lf.side * lf.open + flut - lf.side * (1 - open) * 0.45, len, open);
    }
    st.leaves.forEach(lf => {   // generic leaves: sprout under the tip, grow as it climbs, flutter once grown
      const pos = lf.s * L; if (pos >= drawn) return;
      const p = at(pos), { len: g, open } = pop(clamp01((drawn - pos) / (u * O.leafGrow)));
      const flut = spring(Bn.stemLeaf, fs * 1.5, Bn.lag * (1 + lf.s), leafEnd(pos)) * lf.side;
      out.leaves.push({ x: p[0], y: p[1], a: p[2] + lf.side * (0.95 + lf.spread) * (0.4 + 0.6 * open) + flut,
        len: leafLen * P.leafLen * lf.size * (1 - 0.35 * lf.s) * g, wid: P.leafWid * (0.15 + 0.85 * open), img: lf.img, layer: 1 });
    });
    // a pointed tip first, then a small bud swelling and ripening; it pops open once its stem is openAt grown
    const openOf = d => (v => (v > 0 ? backOut(v, O.headPop) : 0))(clamp01((grow - headStart - d) / O.openDur)), open = openOf(0);
    const budG = smooth01((sg - 0.35) / 0.3) * (O.budFrom + (1 - O.budFrom) * sg), ripe = smooth01((sg - 0.45) / 0.5);
    for (const tw of st.twigs) {   // a side twig with a smaller flower, popping out once the stem has passed it
      const pos = tw.s * L; if (pos >= drawn) continue;
      const p = at(pos), g = backOut(clamp01((drawn - pos) / (u * 0.8)), O.pop), ta = p[2] + tw.side * 0.8, tl = u * 0.3 * tw.len * g;
      const ex = p[0] + Math.sin(ta) * tl, ey = p[1] - Math.cos(ta) * tl;
      out.stems.push({ pts: [[p[0], p[1], ta, 0], [ex, ey, ta, 1]], w0: w0 * 0.55 });
      addHead(tw, ex, ey, ta, u * P.headScale * tw.size, g, st, openOf(0.04), ripe);
    }
    const hb = FS.head * sway(FS.lag) * (st.dir || 1), hd = hb ? { ...st.head, spin: st.head.spin + hb } : st.head;   // the flower turns on its tip
    if (budG > 0) { const tip = pts[pts.length - 1]; addHead(hd, tip[0], tip[1], tip[2], u * P.headScale * st.head.size, budG, st, open, ripe); }
  }
  return out;
}

// The earlier reveal (PLANTS.organic.on = false): stems straight up, the flowers fading in at the end.
function geomBefore(m, u, H, grow) {
  const stemG = clamp01(grow / 0.82), bloomG = smooth01((grow - 0.78) / 0.22);
  const P = m.P, bend = P.bend * deg, bf = P.bendFrom;
  const out = { stems: [], heads: [], pleaves: [], leaves: [], bloomG };
  const addHead = (hd, x, y, a, size, g, st) => {
    const sz = size * m.heads[hd.h].w;
    out.heads.push({ ...hd, st, follow: P.follow, x, y, a, size, g, cx: x, cy: m.heads[hd.h].hang ? y + sz * 0.55 : y, r: g > 0.5 ? sz * 0.5 : 0 });
  };
  const ps = m.parts ? H / m.parts.stem * (P.paintLeaf ?? 1) : 0, leafLen = u * (P.leafSize ?? 0);
  m.rosette.forEach((ro, j) => {   // generic base leaves, growing in one by one
    const g = smooth01((grow - j * 0.025) / 0.4), len = leafLen * P.leafLen * 1.1 * ro.lenF * g;
    if (len >= 0.5) out.leaves.push({ x: ro.x * u, y: 0, a: ro.a, len, wid: P.leafWid, img: ro.img, layer: Math.abs(ro.a) > P.rosetteSpread * 0.8 ? 2 : 0 });
  });
  const addPainted = (lf, x, y, dir, g) => {
    if (g <= 0.001) return;
    const d = dir - lf.side * (1 - g) * 0.35;   // young leaves stand more upright
    out.pleaves.push({ pc: lf.pc, side: lf.side, layer: lf.layer, ref: lf, x, y, g, k: ps * lf.size * (lf.adjSize ?? 1), rot: d - lf.side * lf.pc.angle });
  };
  for (const lf of m.pleaves)
    addPainted(lf, lf.x * ps, 0, lf.side * (lf.pc.angle + lf.turn + (P.paintFan || 0) * deg + (lf.adjTurn || 0)), smooth01((grow - lf.delay) / 0.4));
  const curve = (st, L, drawn) => {   // stem points along a curve that bends from bendFrom upwards
    const N = 40, ds = L / N; let x = st.x * u, y = 0, trav = 0;
    const lean = st.lean + (st.leanAdj || 0), pts = [[x, y, lean, 0]];
    for (let i = 0; i < N && trav < drawn - 1e-6; i++) {
      const s = (i + 0.5) / N, a = lean + bend * st.dir * smooth01((s - bf) / (1 - bf)), seg = Math.min(ds, drawn - trav);
      x += Math.sin(a) * seg; y -= Math.cos(a) * seg; trav += seg; pts.push([x, y, a, trav / L]);
    }
    const at = len => {
      const fi = len / ds, i = Math.max(0, Math.min(pts.length - 2, Math.floor(fi))), t = Math.min(1, fi - i), p = pts[i], q = pts[i + 1];
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, q[2]];
    };
    return { pts, at };
  };
  for (const st of m.stems) {
    const L = st.lenF * (1 + (st.lenAdj || 0)) * H, drawn = L * stemG, { pts, at } = curve(st, L, drawn);
    if (pts.length < 2) continue;
    out.stems.push({ pts, w0: u * P.stemW * (0.75 + 0.25 * st.lenF) });
    for (const lf of st.pleaves || []) {
      const pos = Math.max(0.2, lf.at + (lf.adjAt || 0)) * L; if (pos >= drawn) continue;
      const p = at(pos);
      addPainted(lf, p[0], p[1], p[2] + lf.side * lf.open, smooth01((drawn - pos) / (u * 0.6)));
    }
    for (const lf of st.leaves) {   // generic stem leaves
      const pos = lf.s * L; if (pos >= drawn) continue;
      const p = at(pos), g = smooth01((drawn - pos) / (u * 0.9));
      out.leaves.push({ x: p[0], y: p[1], a: p[2] + lf.side * (0.95 + lf.spread), len: leafLen * P.leafLen * lf.size * (1 - 0.35 * lf.s) * g, wid: P.leafWid, img: lf.img, layer: 1 });
    }
    for (const tw of st.twigs) {   // side twigs with a smaller flower
      const pos = tw.s * L; if (pos >= drawn) continue;
      const p = at(pos), g = smooth01((drawn - pos) / (u * 0.8)), ta = p[2] + tw.side * 0.8, tl = u * 0.3 * tw.len * g;
      const ex = p[0] + Math.sin(ta) * tl, ey = p[1] - Math.cos(ta) * tl;
      out.stems.push({ pts: [[p[0], p[1], ta, 0], [ex, ey, ta, 1]], w0: u * P.stemW * 0.55 });
      if (bloomG > 0) addHead(tw, ex, ey, ta, u * P.headScale * tw.size, bloomG * g, st);
    }
    if (stemG >= 1 && bloomG > 0) { const tip = pts[pts.length - 1]; addHead(st.head, tip[0], tip[1], tip[2], u * P.headScale * st.head.size, bloomG, st); }
  }
  return out;
}
// The climber (Lab geom, pure Green): s = concept px → px (the concept plant is H tall). The braided stem climbs (fast,
// then slowing, within the organic growth's stem window), the leaf stalks reach out once it has passed them, the
// leaves open behind its tip (drawVineLayer); after growing it leans and springs back once.
function vineGeom(m, H, grow, out) {
  if (!m.vine || !GREEN) return out;
  const V = m.vine, L = m.vineLook, P = m.P, O = PLANTS.organic, s = H / GREEN.height, top = GREEN.top, pts = GREEN.stem, step = -pts[1][1];
  const tG = clamp01((grow - O.stems[0]) / (O.stems[1] - O.stems[0])), climb = tG * (2 - tG);
  const tip = climb * top, reveal = climb * (GREEN.height + L.reveal);
  const since = m.growSec == null || grow < O.stems[1] ? -1 : (grow - O.stems[1]) * m.growSec + (m.bounceT ?? 0);
  const spring = since < 0 ? 0 : O.spring.leaf * 0.5 * O.bounce * Math.exp(-since * O.spring.damp) * Math.sin(since * Math.PI * 2 * O.spring.freq * 0.6);
  const sw = (V.sway + spring) / GREEN.height;   // a lean, growing upwards
  const mid = y => {   // the painted stem's middle at y px above the foot: [x, width], leaning with the sway
    const f = Math.min(pts.length - 1.001, Math.max(0, y / step)), i = Math.floor(f), t = f - i, p = pts[i], q = pts[i + 1];
    return [p[0] + (q[0] - p[0]) * t + sw * y * y / GREEN.height, p[2] + (q[2] - p[2]) * t];
  };
  const strands = V.strands.map(sd => {   // each strand winds round the middle; [x, y, z (> 0 = in front), width]
    const list = [];
    for (let y = 0; y <= tip; y += 12) {
      const f = y / top, [x, w] = mid(y), ang = sd.phase + f * sd.twist * Math.PI * 2, taper = (1 - 0.55 * f) * smooth01((tip - y) / 60 + 0.25);
      list.push([(x + Math.sin(ang) * w * L.amp * (1 - 0.4 * f)) * s, -y * s, Math.cos(ang), w * L.width * sd.w * P.vineW * taper * s]);
    }
    return { col: sd.col, pts: list };
  });
  const shoots = V.shoots.map(sh => {   // a leaf stalk: out from the stem, arching up, its tip curling over
    const y0 = sh.t * top, g = clamp01((tip - y0) / 160); if (g <= 0) return null;
    const len = (L.shootLen[0] + (L.shootLen[1] - L.shootLen[0]) * sh.t) * sh.len * P.shootLen * backOut(g, O.pop);
    let [x, w] = mid(y0), y = -y0; const list = [[x * s, y * s, 0, w * 0.22 * P.vineW * s]];
    for (let i = 1; i <= 14; i++) {
      const u2 = i / 14, a = sh.side * (sh.out - 0.55 * u2 + sh.curl * 1.6 * smooth01((u2 - 0.7) / 0.3));
      x += Math.sin(a) * len / 14; y -= Math.cos(a) * len / 14;
      list.push([x * s, y * s, 0, w * 0.22 * P.vineW * (1 - 0.8 * u2) * s]);
    }
    return { pts: list };
  }).filter(Boolean);
  out.vine = { s, reveal, sw, strands, shoots, wf: P.leafW, look: L };
  return out;
}
function withBounds(m, u, out) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, r = 0) => { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); };
  add(0, 0, u * 0.5);
  for (const s of out.stems) for (const p of s.pts) add(p[0], p[1], s.w0);
  for (const l of out.leaves) add(l.x + Math.sin(l.a) * l.len, l.y - Math.cos(l.a) * l.len, l.len * 0.5 * Math.max(1, l.wid));
  for (const h of out.heads) {   // round its anchor: as far as the head picture's farthest corner (tall heads reach far up); bells hang below it
    const H0 = m.heads[h.h], sz = h.size * H0.w, im = img[H0.n], asp = im ? im.height / im.width : 1;
    const reach = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => Math.hypot(a - H0.anchor[0], (b - H0.anchor[1]) * asp)));
    add(h.x, h.y, sz * Math.max(0.85, reach * 1.05));
    if (m.heads[h.h].hang) add(h.x, h.y + sz * 1.1, sz * 0.7);
  }
  for (const pl of out.pleaves) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) add(...pleafAt(pl, a, b));
  if (out.vine) {   // the climber's leaf layers (wider by the leaf width) and its stalks
    const v = out.vine, k = v.s, [fx, fy] = GREEN.foot, [pw, ph] = GREEN.px, wf = Math.max(1, v.wf), sx = Math.abs(v.sw) * GREEN.height * k;
    add(-fx * k * wf - sx, -fy * k); add((pw - fx) * k * wf + sx, (ph - fy) * k);
    for (const sh of v.shoots) for (const p of sh.pts) add(p[0], p[1], p[3]);
  }
  out.bounds = { x0, y0, x1, y1 };
  return out;
}

// a point of a painted leaf (0..1 of its image) → plant px
function pleafAt(pl, a, b) {
  const k = pl.k * pl.g, lx = (a - pl.pc.foot[0]) * pl.pc.px[0] * k * pl.side, ly = (b - pl.pc.foot[1]) * pl.pc.px[1] * k;
  const c = Math.cos(pl.rot), s = Math.sin(pl.rot);
  return [pl.x + lx * c - ly * s, pl.y + lx * s + ly * c];
}

// On the grown plant: leaves reaching into a flower's room turn out / slide down; overlapping flowers lean
// apart; flowers never sit on one flat line (Lab settleLeaves, spreadHeads, staggerHeads).
function settleLeaves(m, u, H) {
  const all = [...m.pleaves, ...m.stems.flatMap(st => st.pleaves || [])];
  for (const lf of all) { lf.adjTurn = 0; lf.adjSize = 1; lf.adjAt = 0; }
  for (let round = 0; round < 14; round++) {
    const g = geom(m, u, H, 1);
    const heads = g.heads.map(h => {
      const r = h.size * m.heads[h.h].w * LEAF_HEAD_ROOM, a = h.a * (h.follow ?? 0.85);
      return { x: h.cx + Math.sin(a) * r * 0.7, y: h.cy - Math.cos(a) * r * 0.7, r };
    });
    let moved = false;
    for (const pl of g.pleaves) {
      const pts = [...pl.pc.spine, pl.pc.tip].map(([a, b]) => pleafAt(pl, a, b));
      if (!pts.some(([x, y]) => heads.some(h => Math.hypot(x - h.x, y - h.y) < h.r))) continue;
      const lf = pl.ref; moved = true;
      if (lf.layer === 'stem') { lf.adjAt = Math.max(-0.3, lf.adjAt - 0.04); lf.adjSize = Math.max(0.7, lf.adjSize * 0.96); }
      else { lf.adjTurn = Math.min(30 * deg, lf.adjTurn + 4 * deg); lf.adjSize = Math.max(0.7, lf.adjSize * 0.96); }
    }
    if (!moved) break;
  }
}
function spreadHeads(m, u, H) {
  if (m.stems.length < 2) return;
  for (const st of m.stems) st.leanAdj = 0;
  for (let round = 0; round < 16; round++) {
    const hs = geom(m, u, H, 1).heads.map(h => ({ st: h.st, x: h.cx, y: h.cy, r: h.size * m.heads[h.h].w * HEAD_ROOM }));
    let moved = false;
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j]; if (a.st === b.st) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), need = a.r + b.r;
      if (d >= need) continue;
      const side = Math.abs(dx) > 1e-3 ? Math.sign(dx) : Math.sign(b.st.x - a.st.x) || 1;
      const turn = (need - d) * 0.6 / Math.max(1, H * 0.8);
      a.st.leanAdj = Math.max(-HEAD_SPREAD_MAX, Math.min(HEAD_SPREAD_MAX, a.st.leanAdj - side * turn));
      b.st.leanAdj = Math.max(-HEAD_SPREAD_MAX, Math.min(HEAD_SPREAD_MAX, b.st.leanAdj + side * turn));
      moved = true;
    }
    if (!moved) break;
  }
}
function staggerHeads(m, u, H) {
  if (m.stems.length < 2) return;
  for (let round = 0; round < 8; round++) {
    const hs = geom(m, u, H, 1).heads.filter(h => h.s == null)   // the stems' own flowers (side twigs follow their stem)
      .map(h => ({ st: h.st, y: h.cy, a: h.a, w: h.size * m.heads[h.h].w })).sort((p, q) => p.y - q.y);
    let moved = false;
    for (let i = 1; i < hs.length; i++) {
      const up = hs[i - 1], lo = hs[i], need = HEAD_STAGGER * (up.w + lo.w) / 2 * (0.8 + 0.5 * lo.st.stagger) - (lo.y - up.y);
      if (need <= 1) continue;
      const was = lo.st.lenAdj || 0, adj = Math.max(-HEAD_STAGGER_MAX, was - need / (H * Math.max(0.5, Math.cos(lo.a))));
      if (adj > was - 1e-4) continue;
      lo.st.lenAdj = adj; lo.y += (was - adj) * H * Math.max(0.5, Math.cos(lo.a)); moved = true;
    }
    if (!moved) break;
  }
}

// ---------------------------------------------------------------- drawing the pieces
// tip (organic growth, while growing): the last tip.len px narrow to a point, by tip.k
function drawStem(c, pts, w0, dark, light, tip = null) {
  c.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    c.strokeStyle = pass ? light : dark;
    for (let i = 1; i < pts.length; i++) {
      const sharp = tip ? 1 - tip.k * (1 - (0.12 + 0.88 * smooth01((tip.drawn - pts[i][3] * tip.L) / Math.max(1, tip.len)))) : 1;
      const w = w0 * (1 - 0.55 * pts[i][3]) * (pass ? 0.4 : 1) * sharp, off = pass ? -w0 * 0.18 : 0;
      c.lineWidth = Math.max(0.6, w); c.beginPath(); c.moveTo(pts[i - 1][0] + off, pts[i - 1][1]); c.lineTo(pts[i][0] + off, pts[i][1]); c.stroke();
    }
  }
}
function headTransform(c, hd, m, art, spriteScale = 1, pad = 0) {
  const o = hd.open ?? 1, [bs, bw, bh] = PLANTS.organic.bud, sz = bs + (1 - bs) * o;   // unfolding: small, narrow, a bit taller
  const H = m.heads[hd.h], s = hd.size * hd.g * sz * H.w / art.width, sx = bw + (1 - bw) * o, sy = bh + (1 - bh) * o;
  const f = hd.follow ?? H.follow, turn = (hd.a - (hd.mirror ? -H.tilt : H.tilt)) * f;   // the painted stem direction turns onto the stem's
  const rot = (H.hang ? hd.spin * 0.4 : turn + hd.spin) + (1 - hd.g) * 0.5;   // bells hang straight down from their stem
  c.translate(hd.x, hd.y); c.rotate(rot); c.scale((hd.mirror ? -s : s) * sx / spriteScale, s * sy / spriteScale);
  return [-(H.anchor[0] * art.width * spriteScale + pad), -(H.anchor[1] * art.height * spriteScale + pad)];
}
function drawHead(c, hd, m) {
  if (hd.size * hd.g < 1) return;
  const art = img[m.heads[hd.h].n], o = hd.open ?? 1;
  if (o < 0.55) drawBud(c, hd, m, 1 - smooth01(o / 0.55));   // the closed bud, fading as its petals unfold
  if (o <= 0.02) return;
  c.save(); const [ox, oy] = headTransform(c, hd, m, art);
  c.globalAlpha = smooth01(o / 0.35);
  if (o < 0.999) c.filter = `saturate(${(0.45 + 0.55 * o).toFixed(3)}) brightness(${(0.72 + 0.28 * o).toFixed(3)})`;   // still duller while unfolding
  c.drawImage(art, ox, oy); c.restore();
}
// A closed bud on the stem tip: a pointed teardrop ripening to the flower's colour, darker at its foot, held by green sepals.
const shade = (h, k) => k >= 0 ? mixHex(h, '#ffffff', k) : mixHex(h, '#000000', -k);
function drawBud(c, hd, m, alpha) {
  const O = PLANTS.organic, [bl, bw] = O.budShape, sz = hd.size * hd.g * m.heads[hd.h].w, L = sz * bl, W = sz * bw;
  if (L < 1 || alpha <= 0.001) return;
  c.save(); c.globalAlpha = alpha; c.translate(hd.x, hd.y); c.rotate(m.heads[hd.h].hang ? Math.PI : hd.a + hd.spin * 0.3);   // a bell's bud hangs
  const rp = hd.ripe ?? 1, [c0, c1] = O.budColors, col = rp < 0.5 ? mixHex(c0, c1, rp * 2) : mixHex(c1, m.petal, (rp - 0.5) * 2);
  const bud = new Path2D();
  bud.moveTo(0, 0); bud.bezierCurveTo(W * 0.9, -L * 0.15, W * 0.75, -L * 0.75, 0, -L);
  bud.bezierCurveTo(-W * 0.75, -L * 0.75, -W * 0.9, -L * 0.15, 0, 0);
  const gr = c.createLinearGradient(0, 0, 0, -L);
  gr.addColorStop(0, shade(col, -0.45)); gr.addColorStop(0.55, shade(col, -0.1)); gr.addColorStop(1, shade(col, 0.25));
  c.fillStyle = gr; c.fill(bud);
  c.strokeStyle = shade(col, -0.3); c.lineWidth = Math.max(0.6, W * 0.06); c.beginPath(); c.moveTo(0, -L * 0.1); c.quadraticCurveTo(W * 0.15, -L * 0.6, 0, -L * 0.97); c.stroke();   // a petal seam
  c.fillStyle = m.stemCol[0];   // sepals hugging the foot of the bud
  for (const sd of [-1, 1]) {
    c.beginPath(); c.moveTo(0, W * 0.1); c.quadraticCurveTo(sd * W * 0.95, -L * 0.1, sd * W * 0.35, -L * 0.42);
    c.quadraticCurveTo(sd * W * 0.25, -L * 0.15, 0, W * 0.1); c.fill();
  }
  c.restore();
}
// glow sprite per head: a soft blurred copy plus the head itself (half size, padded), added on top unlit. Where the
// flower itself is, the glow is taken out again (glowOver, see render()), so it shines around the flower.
const glowSprites = {};
function glowSprite(art, key, spread = 1) {
  key += '|' + spread.toFixed(2); if (glowSprites[key]) return glowSprites[key];
  const w = art.width * GLOW_SCALE, h = art.height * GLOW_SCALE, pad = Math.ceil(Math.max(w, h) * 0.3 * Math.max(1, spread));
  const c = canvas2(Math.ceil(w + pad * 2), Math.ceil(h + pad * 2)), x = c.getContext('2d');
  x.filter = `blur(${(Math.max(w, h) * 0.09 * spread).toFixed(1)}px)`; x.drawImage(art, pad, pad, w, h);
  x.filter = 'none'; x.globalAlpha = 0.45; x.drawImage(art, pad, pad, w, h);
  return (glowSprites[key] = { c, pad });
}
function drawGlow(gc, hd, m, str) {
  // the outer glow loses its brightest part (on the flower), so it is drawn up to twice as strong
  str *= (m.heads[hd.h].glow ?? 1) * (2 - T[m.place + '_glowOver']) * (hd.open ?? 1) ** 2;   // glows once open
  if (str <= 0.001 || hd.size * hd.g < 1) return;
  const n = m.heads[hd.h].n, art = img[n], sp = glowSprite(art, n, T[m.place + '_glowSpread']);
  gc.save(); const [ox, oy] = headTransform(gc, hd, m, art, GLOW_SCALE, sp.pad);
  for (let left = str * hd.g; left > 0.001; left -= 1) { gc.globalAlpha = Math.min(1, left); gc.drawImage(sp.c, ox, oy); }   // above 1: drawn again
  gc.restore();
}
function drawPaintedLeaf(c, pl) {
  const im = img[pl.pc.n]; if (!im) return;
  const k = pl.k * pl.g; if (k * im.width < 1) return;
  c.save(); c.translate(pl.x, pl.y); c.rotate(pl.rot); c.scale(pl.side * k, k);
  const wf = pl.wf ?? 1;
  if (Math.abs(wf - 1) > 0.001) { c.rotate(pl.pc.angle); c.scale(wf, 1); c.rotate(-pl.pc.angle); }   // opening: its width across its foot→tip line
  c.drawImage(im, -pl.pc.foot[0] * im.width, -pl.pc.foot[1] * im.height); c.restore();
}
// A generic leaf (PLANTS.leaves): its petiole at (x, y), pointing along a (0 = up, + = clockwise), len long; wid stretches
// it across its axis. Leaves pointing right are mirrored, so the painted light side stays on top; dim = a back leaf.
function drawLeaf(c, l, dim) {
  const L = PLANTS.leaves[l.img], im = img[L.n]; if (!im || l.len < 1) return;
  const W = im.width, Hh = im.height, ax = L.anchor[0] * W, ay = L.anchor[1] * Hh, tx = L.tip[0] * W, ty = L.tip[1] * Hh;
  const dirImg = Math.atan2(tx - ax, -(ty - ay)), s = l.len / Math.hypot(tx - ax, ty - ay), right = Math.sin(l.a) > 0;
  c.save(); c.translate(l.x, l.y); c.rotate(l.a); c.scale((right ? -s : s) * (l.wid || 1), s); c.rotate(-dirImg);
  if (dim) c.filter = 'brightness(0.68)';
  c.drawImage(im, -ax, -ay); c.restore();
}
// One of the climber's leaf layers (behind / in front of its stem), revealed from the bottom up: a band opens (fades in,
// widening from the stem) once the climbing stem is look.reveal above it; the sway shifts each band by its height.
// The bands are drawn opaque (overlapping, no seams) into a scratch canvas, then faded with one smooth mask.
function drawVineLayer(c, v, name) {
  const im = img['green/' + name]; if (!im) return;
  const L = v.look, [fx, fy] = GREEN.foot, k = v.s, W = im.width, Hi = im.height, pts = GREEN.stem, step = -pts[1][1];
  const midX = y => { const f = Math.min(pts.length - 1.001, Math.max(0, y / step)), i = Math.floor(f); return pts[i][0] + (pts[i + 1][0] - pts[i][0]) * (f - i); };
  if (v.reveal >= GREEN.height + L.reveal && Math.abs(v.sw) < 1e-6 && Math.abs(v.wf - 1) < 1e-3) { c.drawImage(im, -fx * k, -fy * k, W * k, Hi * k); return; }
  const N = 64, band = Hi / N, bands = [];
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < N; i++) {
    const sy = i * band, y = Math.max(120, fy - (sy + band / 2));   // px above the foot (the leaves hanging below it open with the lowest)
    const o = smooth01((v.reveal - y) / L.reveal), cx = fx + midX(y), wk = v.wf * (L.open + (1 - L.open) * o);
    const x = (cx - cx * wk - fx + v.sw * y * y / GREEN.height) * k;
    bands.push({ sy, o, x, w: W * wk * k }); if (o > 0.002) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + W * wk * k); }
  }
  if (x1 <= x0) return;
  const tc = drawVineLayer.tmp ??= canvas2(), tw = Math.ceil(x1 - x0) + 2, th = Math.ceil(Hi * k) + 2;
  if (tc.width < tw || tc.height < th) { tc.width = Math.max(tc.width, tw); tc.height = Math.max(tc.height, th); }
  const t = tc.getContext('2d'), mask = t.createLinearGradient(0, 0, 0, Hi * k);
  t.clearRect(0, 0, tc.width, tc.height);
  for (const b of bands) {
    mask.addColorStop(Math.min(1, (b.sy + band / 2) / Hi), `rgba(0,0,0,${b.o})`);
    if (b.o <= 0.002) continue;
    const ov = band * 0.4, s0 = Math.max(0, b.sy - ov), s1 = Math.min(Hi, b.sy + band + ov);
    t.drawImage(im, 0, s0, W, s1 - s0, b.x - x0, s0 * k, b.w, (s1 - s0) * k);
  }
  t.globalCompositeOperation = 'destination-in'; t.fillStyle = mask; t.fillRect(0, 0, tc.width, tc.height); t.globalCompositeOperation = 'source-over';
  c.drawImage(tc, 0, 0, tw, th, x0, -fy * k, tw, th);
}
// the climber's stem: leaf stalks first, then the strands' far halves, then their near halves (so they braid)
function drawVineStem(c, v) {
  c.lineCap = 'round';
  const line = (pts, i, w, col) => { c.strokeStyle = col; c.lineWidth = Math.max(0.5, w); c.beginPath(); c.moveTo(pts[i - 1][0], pts[i - 1][1]); c.lineTo(pts[i][0], pts[i][1]); c.stroke(); };
  for (const sh of v.shoots) for (let pass = 0; pass < 2; pass++)
    for (let i = 1; i < sh.pts.length; i++) line(sh.pts, i, sh.pts[i][3] * (pass ? 0.4 : 1), v.look.shoot[pass]);
  for (const near of [false, true]) for (const st of v.strands) for (let pass = 0; pass < 2; pass++)
    for (let i = 1; i < st.pts.length; i++) {
      const p = st.pts[i]; if ((p[2] > 0) !== near) continue;
      const lit = 0.55 + 0.45 * Math.max(0, p[2]);   // the near side catches more light
      line(st.pts, i, p[3] * (pass ? 0.38 * lit : 1), pass ? st.col[1] : near ? st.col[0] : mixHex(st.col[0], '#000000', 0.3));
    }
}
// Every piece (leaf, stem, flower) is drawn through piece(target, [x0, y0, x1, y1] its bounds, draw, front), as in the
// Lab: PlantView.piece gives each its own rim light. front = a ground leaf (base leaves, painted ground leaves, the
// climber's front leaves; where nothing drawn later covers it): these may hang over the pot's / planter's rim, so
// they are drawn again over it (PlantView.frontCut).
function drawGeom(gc, m, g, piece) {
  const round = (x, y, r) => [x - r, y - r, x + r, y + r];
  const ptsBox = (pts, r) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
    return [x0 - r, y0 - r, x1 + r, y1 + r]; };
  const painted = layer => { for (const pl of g.pleaves) if (pl.layer === layer) {
    const cs = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => pleafAt(pl, a, b));
    piece('base', ptsBox(cs, 2), x => drawPaintedLeaf(x, pl), layer !== 'stem');
  } };
  const leaves = layer => { for (const l of g.leaves) if (l.layer === layer)
    piece('base', round(l.x, l.y, l.len * Math.max(1, l.wid || 1) * 1.15 + 2), x => drawLeaf(x, l, layer === 0), layer !== 1); };
  painted('back'); painted('behind');
  if (g.vine) {   // the climber: its leaves behind, the stem with its leaf stalks, its leaves in front
    const v = g.vine, k = v.s, [fx, fy] = GREEN.foot, [pw, ph] = GREEN.px, wf = Math.max(1, v.wf), sx = Math.abs(v.sw) * GREEN.height * k;
    const box = [-fx * k * wf - sx - 2, -fy * k - 2, (pw - fx) * k * wf + sx + 2, (ph - fy) * k + 2];
    piece('base', box, x => drawVineLayer(x, v, 'leavesback'));
    piece('base', box, x => drawVineStem(x, v));
    piece('base', box, x => drawVineLayer(x, v, 'leavesfront'), true);
  }
  leaves(0);
  for (const s of g.stems) piece('base', ptsBox(s.pts, s.w0 + 2), x => drawStem(x, s.pts, s.w0, m.stemCol[0], m.stemCol[1], s.tip));
  painted('stem'); painted('front'); leaves(1); leaves(2);
  const str = m.glow * T[m.place + '_glow'];
  for (const hd of g.heads) {
    const H0 = m.heads[hd.h], r = hd.size * H0.w * 1.25 + 4;
    piece('heads', round(hd.x, H0.hang ? hd.y + r * 0.4 : hd.y - r * 0.4, r), x => drawHead(x, hd, m));
    drawGlow(gc, hd, m, str);
  }
}
function makeRim(src, dst, dx, dy) {
  const c = dst.getContext('2d'), w = dst.width, h = dst.height;
  c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w, h); c.drawImage(src, 0, 0);
  c.globalCompositeOperation = 'source-in'; c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'destination-out'; c.drawImage(src, dx, dy);
  c.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- one plant = foliage + flowers + glow, lit
// Foliage and flowers are each lit as base × ambient + rim (each piece's own light edges, see piece()); flowers keep
// part of their own colour (flowerSelf) and take less rim (rimFlower). `lit` and `glow` (added on top) are the results.
class PlantView {
  // place: 'gh' or 'roof', whose look (Lab Tuning + Shapes) it uses
  constructor(types, variant = 0, place = 'gh') { this.counts = countsOf(types); this.place = place; this.model = makeModel(this.counts, variant, place); this.cv = {}; this.u = null; }
  size() { const S = T[this.place + 'Scale']; return [this.model.P.unit * S, this.model.P.height * S]; }   // art px
  L(k) { return T[this.place + '_' + k]; }
  // u, H in canvas px; false when nothing changed
  layout(u, H) {
    if (this.u === u && this.H === H) return false;
    this.u = u; this.H = H;
    for (const st of this.model.stems) st.lenAdj = 0;
    spreadHeads(this.model, u, H); staggerHeads(this.model, u, H);
    spreadHeads(this.model, u, H); staggerHeads(this.model, u, H);
    settleLeaves(this.model, u, H);
    const b = geom(this.model, u, H, 1).bounds, pad = Math.ceil(u * 0.3 + 6);
    const w = Math.max(4, Math.ceil(b.x1 - b.x0 + pad * 2)), h = Math.max(4, Math.ceil(b.y1 - b.y0 + pad * 2));
    this.ox = pad - b.x0; this.oy = pad - b.y0;
    for (const n of ['base', 'heads', 'glow', 'rimL', 'rimR', 'hrimL', 'hrimR', 'tmp', 'mask', 'part', 'lit', 'frontMask', 'front', 'frontCut']) { const c = this.cv[n] || canvas2(); c.width = w; c.height = h; this.cv[n] = c; }
    return true;
  }
  // grad: [y, y] in canvas px where the light turns from ambient (warm, low) to ambientTop (cool, high)
  render(grow, light, grad) {
    const g = geom(this.model, this.u, this.H, grow); this.g = g;
    const { base, heads, glow, lit } = this.cv, w = base.width, h = base.height;
    const cs = [base, heads, glow, this.cv.frontMask].map(cv => cv.getContext('2d'));
    for (const c of cs) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h); c.setTransform(1, 0, 0, 1, this.ox, this.oy); }
    cs[2].globalCompositeOperation = 'lighter';
    // rim light per piece: which sides are lit, how wide (px)
    const sides = light.rim === 'both' ? ['L', 'R'] : light.rim === 'L' || light.rim === 'R' ? [light.rim] : [];
    this.rimSides = light.rimStrength > 0 && this.L('rimW') > 0 ? sides : [];
    this.rw = Math.max(1, this.u * this.L('rimW'));
    for (const n of ['rimL', 'rimR', 'hrimL', 'hrimR']) this.cv[n].getContext('2d').clearRect(0, 0, w, h);
    this.hasFront = false;
    drawGeom(cs[2], this.model, g, this.rimSides.length ? (t, b, fn, front) => this.piece(t, b, fn, front) : (t, b, fn, front) => {
      if (t === 'heads') { fn(cs[1]); return; }
      fn(cs[0]);
      cs[3].globalCompositeOperation = front ? 'source-over' : 'destination-out'; fn(cs[3]); cs[3].globalCompositeOperation = 'source-over';
    });
    for (const c of cs) c.setTransform(1, 0, 0, 1, 0, 0);
    const over = this.L('glowOver');
    if (over < 1) {   // outer glow: take the glow out where the flowers are (fully at 0), so their colour stays their own
      cs[2].globalCompositeOperation = 'destination-out'; cs[2].globalAlpha = 1 - over; cs[2].drawImage(heads, 0, 0); cs[2].globalAlpha = 1;
    }
    cs[2].globalCompositeOperation = 'source-over';
    const l = lit.getContext('2d');
    l.globalCompositeOperation = 'source-over'; l.globalAlpha = 1; l.filter = 'none'; l.clearRect(0, 0, w, h);
    this.compose(l, base, light, grad, 0, 1, [this.cv.rimL, this.cv.rimR]);
    this.compose(l, heads, light, grad, this.L('flowerSelf'), this.L('rimFlower'), [this.cv.hrimL, this.cv.hrimR], true);
    const f = this.cv.front.getContext('2d');   // the ground leaves as lit, flowers over them taken out
    f.globalCompositeOperation = 'source-over'; f.clearRect(0, 0, w, h); f.drawImage(lit, 0, 0);
    f.globalCompositeOperation = 'destination-in'; f.drawImage(this.cv.frontMask, 0, 0);
    f.globalCompositeOperation = 'destination-out'; f.drawImage(heads, 0, 0); f.globalCompositeOperation = 'source-over';
  }
  // The ground leaves for drawing again over the pot / planter that covers the plant's foot (same size and place as
  // cv.lit): everything but a thin band at the soil where their feet are buried (cut, canvas px from the foot: half
  // width hw (at least a quarter of the plant unit), soft sides edge × hw, from `top` above the foot to `bottom` below
  // it, soft by `fade`)
  frontCut(cut) {
    const { front, frontCut: c } = this.cv, w = c.width, h = c.height, x = c.getContext('2d');
    const cx = this.ox, y0 = this.oy - cut.top, y1 = this.oy + cut.bottom, hw = Math.max(cut.hw, this.u * 0.25);
    x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
    const gx = x.createLinearGradient(cx - hw, 0, cx + hw, 0), e = cut.edge / 2;
    gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(e, 'rgba(0,0,0,1)'); gx.addColorStop(1 - e, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gx; x.fillRect(cx - hw, y0 - cut.fade, hw * 2, y1 - y0 + cut.fade * 2);
    const H2 = y1 - y0 + cut.fade * 2, fr = cut.fade / Math.max(1, H2), gy = x.createLinearGradient(0, y0 - cut.fade, 0, y1 + cut.fade);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(fr, 'rgba(0,0,0,1)'); gy.addColorStop(1 - fr, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    x.globalCompositeOperation = 'destination-in'; x.fillStyle = gy; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-out'; x.drawImage(front, 0, 0); x.globalCompositeOperation = 'source-over';
    return c;
  }
  // One piece, drawn by fn in plant coordinates within bounds b, onto the foliage (target 'base') or the flowers
  // ('heads'), with its own rim: its lit edges (the piece minus itself shifted away from the light) are added to the
  // rim layers, after the piece has covered the rims of the pieces behind it.
  piece(target, b, fn, front = false) {
    const heads = target === 'heads', rw = heads && this.L('rimFix') ? Math.max(1, this.u * this.L('rimFlowerW')) : this.rw;   // flower rim fix: own width
    const pad = Math.ceil(rw) + 2, W = this.cv.base.width, Hc = this.cv.base.height;
    const bx = Math.max(0, Math.floor(b[0] + this.ox) - pad), by = Math.max(0, Math.floor(b[1] + this.oy) - pad);
    const w = Math.min(W, Math.ceil(b[2] + this.ox) + pad) - bx, h = Math.min(Hc, Math.ceil(b[3] + this.oy) + pad) - by;
    if (w <= 0 || h <= 0) return;
    const pc = this.pc ??= canvas2(), pe = this.pe ??= canvas2();
    for (const cv of [pc, pe]) if (cv.width < w || cv.height < h) { cv.width = Math.max(cv.width, w); cv.height = Math.max(cv.height, h); }
    const p = pc.getContext('2d');
    p.setTransform(1, 0, 0, 1, 0, 0); p.globalCompositeOperation = 'source-over'; p.globalAlpha = 1; p.filter = 'none'; p.clearRect(0, 0, w, h);
    p.setTransform(1, 0, 0, 1, this.ox - bx, this.oy - by); fn(p); p.setTransform(1, 0, 0, 1, 0, 0);
    const t = (heads ? this.cv.heads : this.cv.base).getContext('2d');
    t.save(); t.setTransform(1, 0, 0, 1, 0, 0); t.drawImage(pc, 0, 0, w, h, bx, by, w, h); t.restore();
    if (front || this.hasFront) {   // the front leaves' mask; a piece drawn later covers them there
      const m = this.cv.frontMask.getContext('2d'); m.save(); m.setTransform(1, 0, 0, 1, 0, 0);
      m.globalCompositeOperation = front ? 'source-over' : 'destination-out'; m.drawImage(pc, 0, 0, w, h, bx, by, w, h); m.restore();
      if (front) this.hasFront = true;
    }
    const e = pe.getContext('2d');
    for (const side of ['L', 'R']) {
      const r = this.cv[(heads ? 'hrim' : 'rim') + side].getContext('2d');
      r.globalCompositeOperation = 'destination-out'; r.drawImage(pc, 0, 0, w, h, bx, by, w, h);   // covers the rims behind it
      r.globalCompositeOperation = 'source-over';
      if (!this.rimSides.includes(side)) continue;
      e.globalCompositeOperation = 'source-over'; e.clearRect(0, 0, w, h); e.drawImage(pc, 0, 0);
      e.globalCompositeOperation = 'source-in'; e.fillStyle = '#fff'; e.fillRect(0, 0, w, h);
      const dy = heads && this.L('rimFix') ? this.L('rimDy') : 0.6;   // flower rim fix: its own light height
      e.globalCompositeOperation = 'destination-out'; e.drawImage(pc, side === 'L' ? rw : -rw, rw * dy);   // lit from the left: left (and top) edges
      r.drawImage(pe, 0, 0, w, h, bx, by, w, h);
    }
  }
  // rims = the per-piece rim layers [left, right] (no rim sides: made from the silhouette)
  // flower + rimFix (prototype, set in the Lab): the rim takes the flower's own hue (rimTint), cools and fades
  // with height like the ambient (rimCool, rimTopFade), and comes from lower left (rimDy, × width; < 0 = from below)
  compose(l, src, light, grad, self, rimMul, rims, flower = false) {
    const { rimL, rimR, tmp, mask, part } = this.cv, w = part.width, h = part.height, p = part.getContext('2d');
    p.globalCompositeOperation = 'source-over'; p.globalAlpha = 1; p.filter = 'none'; p.clearRect(0, 0, w, h);
    p.drawImage(src, 0, 0);
    const amb = hex => mixHex(scaleHex(hex, light.brightness), '#ffffff', self);
    p.globalCompositeOperation = 'multiply';
    if (light.ambientTop && grad) {
      const gr = p.createLinearGradient(0, grad[0], 0, grad[1]);
      gr.addColorStop(0, amb(light.ambient)); gr.addColorStop(1, amb(light.ambientTop));
      p.fillStyle = gr;
    } else p.fillStyle = amb(light.ambient);
    p.fillRect(0, 0, w, h);
    p.globalCompositeOperation = 'destination-in'; p.drawImage(src, 0, 0);
    const fix = flower && this.L('rimFix'), rimW = fix ? this.L('rimFlowerW') : this.L('rimW');   // flower rim fix: own width
    const str = light.rimStrength * rimMul, rw = Math.max(1, this.u * rimW);
    if (light.rim !== 'none' && str > 0 && rimW > 0) {
      const [rL, rR] = this.rimSides.length ? rims : [rimL, rimR];
      const cool = fix && light.ambientTop && grad, dy = rw * (fix ? this.L('rimDy') : 0.6);
      if (!this.rimSides.length) { makeRim(src, rimL, rw, dy); makeRim(src, rimR, -rw, dy); }
      const t = tmp.getContext('2d');
      t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, w, h);
      if (light.rim === 'L' || light.rim === 'both') t.drawImage(rL, 0, 0);
      if (light.rim === 'R' || light.rim === 'both') t.drawImage(rR, 0, 0);
      if (fix) { const m = mask.getContext('2d'); m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, w, h); m.drawImage(tmp, 0, 0); }
      t.globalCompositeOperation = 'source-in';
      if (cool) {
        const gr = t.createLinearGradient(0, grad[0], 0, grad[1]);
        gr.addColorStop(0, light.rimColor); gr.addColorStop(1, mixHex(light.rimColor, light.ambientTop, this.L('rimCool')));
        t.fillStyle = gr;
      } else t.fillStyle = light.rimColor;
      t.fillRect(0, 0, w, h);
      if (fix && this.L('rimTint') > 0) {   // hue and saturation of the flower, brightness of the rim
        t.globalCompositeOperation = 'color'; t.globalAlpha = this.L('rimTint'); t.drawImage(src, 0, 0); t.globalAlpha = 1;
        t.globalCompositeOperation = 'destination-in'; t.drawImage(mask, 0, 0);
      }
      if (cool) {   // weaker towards the top
        const fa = t.createLinearGradient(0, grad[0], 0, grad[1]);
        fa.addColorStop(0, 'rgba(0,0,0,1)'); fa.addColorStop(1, `rgba(0,0,0,${this.L('rimTopFade')})`);
        t.globalCompositeOperation = 'destination-in'; t.fillStyle = fa; t.fillRect(0, 0, w, h);
      }
      t.globalCompositeOperation = 'destination-in'; t.drawImage(src, 0, 0);
      t.globalCompositeOperation = 'source-over';
      // new look: screen, which brightens without clipping to white, so the rim keeps its colour
      p.globalCompositeOperation = fix ? 'screen' : 'lighter'; p.filter = this.L('rimSoft') > 0 ? `blur(${(rw * this.L('rimSoft')).toFixed(1)}px)` : 'none';
      p.globalAlpha = Math.min(1, str); p.drawImage(tmp, 0, 0);
      if (str > 1) { p.globalAlpha = Math.min(1, str - 1); p.drawImage(tmp, 0, 0); }
      p.filter = 'none'; p.globalAlpha = 1;
      p.globalCompositeOperation = 'destination-in'; p.drawImage(src, 0, 0);
      p.globalCompositeOperation = 'source-over';
    }
    l.drawImage(part, 0, 0);
  }
}

export { T as plantTuning, labSpots, PlantView, loadPlantArt, countsOf, mixKey, recipeOf, speciesOf };
