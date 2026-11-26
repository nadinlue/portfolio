// Save / Reset for the Settings, Dev sky, Dev chart and Dev sound panels, per section (the controls between two <h3> headings).
// Save keeps the section's values; the game starts with them next time. A save becomes the section's new
// default: Reset returns to the last saved values (never-saved controls go back to the defaults in index.html).
//
// Where saves live: in settings.json next to the game (in git, so the team shares the tuning), through the dev
// server (serve.py, /api/settings), so they are the same on every port. Served without serve.py (a plain web
// server), the game still reads settings.json directly, read-only. The browser's own storage is kept as a copy and a
// fallback (it is separate per port, so on its own a different port meant "lost" settings). On start,
// anything this browser still has for this port that the file lacks, or saved later, is merged into the file,
// so opening the game once on an old port brings that session's saves back.
// File format: { values: { controlId: value }, times: { controlId: ms saved }, prefs: { name: value } }.
import { BUILD } from './build.js';
// Read-only (the mobile build, BUILD.readOnly): the published settings.json only. Nothing is read from or written to
// this browser's storage or the server, Save buttons are left out and Reset goes back to the published look.
const readOnly = !!BUILD.readOnly;
const KEY = 'starGarden.settings.v1', TIMES_KEY = 'starGarden.settings.times.v1';
const panels = ['settings', 'skySettings', 'chartSettings', 'soundSettings'].map(id => document.getElementById(id));

const readLocal = (k, fallback) => { if (readOnly) return fallback; try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch { return fallback; } };
const writeLocal = (k, v) => { if (readOnly) return false; try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
let fileOk = false;
async function fetchFile() {
  if (!readOnly) try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch('/api/settings', { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) { fileOk = true; return await r.json(); }
  } catch { /* no serve.py */ }
  try {   // no serve.py: the committed file as it is (saves then stay in this browser)
    const r = await fetch('settings.json', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
function writeFile() {
  if (!fileOk) return Promise.resolve(false);
  return fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(r => r.ok).catch(() => false);
}

// Load (top-level await: the UI binds its controls only after this, so they start from the saved values).
const file = await fetchFile();
const data = { values: { ...(file?.values ?? {}) }, times: { ...(file?.times ?? {}) }, prefs: { ...(file?.prefs ?? {}) } };
{
  const localValues = readLocal(KEY, {}), localTimes = readLocal(TIMES_KEY, {});
  let merged = 0;
  for (const [id, v] of Object.entries(localValues)) {
    const t = localTimes[id] ?? 0;   // saves from before this file existed have no time: they only fill gaps
    if (!(id in data.values) || t > (data.times[id] ?? 0)) { data.values[id] = v; data.times[id] = t; merged++; }
  }
  for (const [k, v] of Object.entries(readLocal(KEY + '.prefs', {}))) if (!(k in data.prefs)) { data.prefs[k] = v; merged++; }
  if (merged && fileOk) writeFile();
  writeLocal(KEY, data.values); writeLocal(TIMES_KEY, data.times); writeLocal(KEY + '.prefs', data.prefs);
}

const load = () => data.values;
function store(values, ids) {
  const now = Date.now();
  data.values = values;
  for (const id of ids) if (id in values) data.times[id] = now; else delete data.times[id];
  const local = writeLocal(KEY, data.values) && writeLocal(TIMES_KEY, data.times);
  writeFile();
  return local || fileOk;
}

// Small named preferences (e.g. the reveal ring style), stored the same way.
const getPref = (name, fallback) => (name in data.prefs ? data.prefs[name] : fallback);
function setPref(name, value) {
  data.prefs[name] = value;
  writeLocal(KEY + '.prefs', data.prefs);
  writeFile();
}

const controls = root => [...root.querySelectorAll('input[id], select[id]')];
const valueOf = el => (el.type === 'checkbox' ? el.checked : el.value);
function setValue(el, v) {
  if (el.type === 'checkbox') el.checked = v; else el.value = v;
}
function defaultOf(el) {
  if (el.type === 'checkbox') return el.defaultChecked;
  if (el.tagName === 'SELECT') return ([...el.options].find(o => o.defaultSelected) || el.options[0]).value;
  return el.defaultValue;
}
// Run the control's own handlers, as if the user had changed it.
function fire(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Before the UI binds its controls: put saved values into them, so every setting starts from there.
function applySavedSettings() {
  const saved = load();
  for (const el of panels.flatMap(controls)) if (el.id in saved) setValue(el, saved[el.id]);
}

// A Save / Reset row for some controls: Save keeps their values in this browser, Reset returns them
// to the last saved values (or the page defaults, if never saved).
function saveResetRow(title, els) {
  const row = document.createElement('div');
  row.className = 'section-actions';
  const save = document.createElement('button'), reset = document.createElement('button');
  save.textContent = 'Save'; reset.textContent = 'Reset';
  save.title = `Keep these ${title} settings in this browser`;
  reset.title = `Back to the last saved ${title} settings`;
  const flash = (btn, text) => {
    const old = btn.textContent; btn.textContent = text; btn.disabled = true;
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1100);
  };
  if (readOnly) reset.title = `Back to the published ${title} settings`;
  save.onclick = () => {
    const saved = { ...load() };
    for (const el of els) saved[el.id] = valueOf(el);
    flash(save, store(saved, els.map(el => el.id)) ? 'Saved ✓' : 'Not saved');
  };
  reset.onclick = () => {   // back to the last saved values; never-saved controls go back to the page defaults
    const saved = load();
    for (const el of els) { setValue(el, el.id in saved ? saved[el.id] : defaultOf(el)); fire(el); }
    flash(reset, 'Reset ✓');
  };
  if (readOnly) row.append(reset); else row.append(save, reset);
  return row;
}

// Saved value of a control outside the Settings panel (e.g. a Behind the Scenes card slider), or undefined.
const savedValue = id => load()[id];

// Group each panel's controls by heading and add a Save / Reset row at the end of each group.
function addSectionButtons() {
  for (const panel of panels) addPanelButtons(panel);
}
function addPanelButtons(panel) {
  const sections = [];
  for (const node of [...panel.children]) {
    if (node.tagName === 'H3') sections.push({ title: node.textContent.trim(), nodes: [] });
    else if (sections.length && !node.classList.contains('readout')) sections.at(-1).nodes.push(node);
  }
  for (const s of sections) {
    const els = s.nodes.flatMap(n => controls(n));
    if (els.length) s.nodes.at(-1).after(saveResetRow(s.title, els));
  }
}

export { readOnly, applySavedSettings, addSectionButtons, saveResetRow, savedValue, getPref, setPref };
