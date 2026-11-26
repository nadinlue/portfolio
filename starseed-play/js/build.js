// Build flags. Empty in the normal game: every check below falls back to today's behaviour.
// build_mobile.py writes `window.STAR_GARDEN_BUILD = { ... }` into the mobile build's index.html (its MOBILE dict):
//   mobile        the menu buttons fold into one ☰ menu on every screen
//   readOnly      nothing a player changes is stored (settingsStore.js): Save is hidden, Reset = the published look
//   pixelRatio    cap on the device pixel ratio the 3D view renders at (fill rate is the phone's bottleneck)
//   maxTexture    largest texture side sent to the GPU; bigger art is scaled down on upload only (core.js), so all
//                 pixel maths on the full-size art stays as it is
const BUILD = window.STAR_GARDEN_BUILD || {};
export { BUILD };
