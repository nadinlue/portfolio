// Small shared helpers.


const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = cond => new Promise(r => { const tick = () => (cond() ? r() : requestAnimationFrame(tick)); tick(); });
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const randomOf = arr => arr[Math.floor(Math.random() * arr.length)];
// An angle (radians) wrapped into -π … π: the short way round.
const wrapPi = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export { $, sleep, until, easeInOut, randomOf, wrapPi };
