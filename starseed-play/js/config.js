// Tuning: every constant and setting in one place.
import * as THREE from 'three';
import { CONSTELLATION_PLAY, MUSIC, CITY_SOUND } from './soundConfig.js';

// Layer artwork size (iteration-8, 2026-10-30): the painted 3840x2160 frame plus a 160 / 90 px margin on each side, spare
// art for camera moves. All pixel positions below use this grid (the frame's top left corner is at 160, 90).
const ART_W = 4160, ART_H = 2340, ART_ASPECT = ART_W / ART_H;
const VIEW_W = 3840, VIEW_H = 2160;   // the painted frame: what the camera shows at rest
// The greenhouse interior (Assets/scenes/greenhouse/) and the plants grown in it keep their own 3840x2160 grid.
const ROOM_W = 3840, ROOM_H = 2160;

// Layer artwork, back to front. Each entry is one parallax layer; when it lists several images
// (all full-frame ART_W x ART_H with transparency), they are stacked into one texture at load time.
const LAYER_ART = {
  sky: ['sky'],
  cityFar: ['city2'],
  city: ['city1'],
  midground: ['midground_floor'],   // the props standing on it are separate planes: MIDGROUND_PROPS
  foreground: ['foreground_ladder', 'foreground_wall'],   // the ladder stands behind the front wall
};
// The camera shows the painted frame (VIEW_H of the ART_H rows) at 40° vertical FOV; FIT_FOV is the FOV at which a
// layer shows its whole artwork, margin included, so a layer's size per art px stays as with the old 3840x2160 art.
const OVERSCAN = ART_H / VIEW_H;   // camera crops this much: the margin is spare artwork for orbiting and panning
const FIT_FOV = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) * OVERSCAN));

// Distance of each layer from the default camera. Larger gap = stronger parallax.
const DEPTH = { sky: 140, cityFar: 70, city: 40, fog: 20, midground: 12, character: 11.8, foreground: 7 };

// Midground props as their own planes, so they parallax subtly against each other and the floor.
// Depth follows where each prop stands on the floor (further back = slightly deeper; the floor
// plane is DEPTH.midground, the character 11.8). Listed back to front, the order they're drawn in.
const MIDGROUND_SPREAD = 1.5;   // parallax strength: scales each prop's depth offset from the floor (0 = flat)
// Raised beds with their withered plants (iteration-5): each box and plant is its own image, so a plant can be
// swapped for a grown one later. A list of images is stacked into one texture, back to front; a bed's plants share
// its plane so they don't slide on it. Each plane is cropped to its art (scene.js), except `fullFrame` ones.
const BED_LEFT_BACK = ['midground_planter1', 'midground_withered1', 'midground_withered2'];
const BED_MIDDLE = ['midground_planter3', 'midground_withered4', 'midground_withered5', 'midground_withered6'];
const BED_LEFT_FRONT = ['midground_planter2', 'midground_withered3'];
const BED_GREENHOUSE = ['midground_greenhouse_planter', 'midground_withered7', 'midground_withered8'];
// `apart`: images of the list that get their own plane on top of the prop instead of being stacked into it, so they
// can fade on their own (the withered plants give way to a new plant: roofGarden.js). layers[name].apart[image] = mesh.
const apart = bed => bed.filter(n => n.includes('withered'));
const MIDGROUND_PROPS = [   // depth comment: the row its base stands on
  // Side buildings framing the roof (iteration-7): one stacked plane, standing walls, so no floor row scroll.
  // `order` 4.9: drawn behind the floor and every other prop (but in front of the fog). `glows: false`: no extra light
  // overlay on its painted lights (the windows here, the bulbs of the fairy lights); other props get one automatically.
  { name: 'frames', image: ['midground_frameleft', 'midground_frameright'], depth: 13.0, fullFrame: true, rowScroll: false, order: 4.9, glows: false },
  { name: 'poles', image: 'midground_poles', depth: 12.95, fullFrame: true },   // the two big nets (iteration-8); netStars.js reads its art
  { name: 'fairyLights', image: 'midground_poles_fairylights', depth: 12.95, glows: false, wind: 'fairyLights' },   // strung between the poles
  { name: 'lanterns', image: 'midground_poles_lanterns', depth: 12.9 },          // the two hanging lanterns
  { name: 'planterCorner', image: 'midground_planter0', depth: 12.65 },          // 1715, potted plants in the left corner
  { name: 'bedLeftBack', image: BED_LEFT_BACK, depth: 12.75, apart: apart(BED_LEFT_BACK) },        // 1685
  { name: 'bedMiddle', image: BED_MIDDLE, depth: 12.75, apart: apart(BED_MIDDLE) },                // 1686
  { name: 'bedLeftFront', image: BED_LEFT_FRONT, depth: 12.55, apart: apart(BED_LEFT_FRONT) },     // 1755
  { name: 'pots', image: 'midground_pot1', depth: 12.45 },            // 1799
  { name: 'hut', image: 'midground_hut', depth: 11.75 },              // 1950, front left, next to the character
  { name: 'greenhouse', image: 'midground_greenhouse', depth: 12.25 },   // 1836
  { name: 'greenhouseBed', image: BED_GREENHOUSE, depth: 12.15, apart: apart(BED_GREENHOUSE) },   // 1877, the long bed in front of the greenhouse
  { name: 'seedlings', image: 'midground_planter4', depth: 12.5 },    // 1765, seedling box + pot
  { name: 'shovelCan', image: 'midground_shovelcan', depth: 12.42 },  // 1804, trowel + watering can
];

// Wind (a prop's `wind`: one of these, layers.js enableRowScroll): every `every` seconds a soft gust sweeps across from
// left to right (crossing the whole art in `travel` s). Where it passes, the art is pushed right by up to amp art px and
// lifted by lift × that, over `rise` s, then swings gently back and settles; each gust a little stronger or weaker. The
// lights dangle as it passes: a small quick swing (dingle × amp, dingleHz swings per second, neighbours out of step
// every dingleWave art px) that dies down over dingleSec. idle = a faint slow drift between gusts (× amp). anchors = x
// (art px) where the strings are tied (poles, house walls, the frame's edges): it all fades out within `fade` px of them.
const WIND = {
  fairyLights: { amp: 12, lift: 0.35, every: 10, travel: 3.5, rise: 0.8, idle: 0.08,
    dingle: 0.22, dingleHz: 1.4, dingleWave: 340, dingleSec: 1.6,
    anchors: [0, 667, 1000, 1840, 3333, 3790, 4160], fade: 220 },
};

// Stylized prop shadows on the floor (shadows.js): contact + cast for the props, and a separate contact + cast
// for the telescope. Every value below is the default of a Settings slider (Contact shadows / Cast shadows /
// Telescope contact / Telescope cast); strength updates live, the rest redraws on release.
const SHADOWS = {
  // Each entry casts on its own; a list of images is stacked and casts as one (a bed with its plants).
  casters: ['midground_poles', 'midground_planter0', BED_LEFT_BACK, BED_MIDDLE, BED_LEFT_FRONT, 'midground_pot1', 'midground_hut',
    'midground_greenhouse', BED_GREENHOUSE, 'midground_planter4', 'midground_shovelcan'],
  scopeCasters: ['foreground_telescope'],   // the telescope has its own shadow layers (scopeContact / scopeCast)
  scopeFeet: 60,                        // telescope: only columns within this many px of its lowest foot touch the floor
  scopeLift: 8,                         // telescope: its shadows stop this many px above where its feet meet the floor
  inset: 40,                            // shadows start this many px above a prop's base (hidden behind it): no gap
  floorTop: 1650, floorBottom: 2050,    // shadows only land on the floor between these rows
  vanish: [2150, 1150],                 // floor tiles' vanishing point: shadows run away from it, along the tiles
  // Contact shadow: short, soft, dark pool where a prop touches the floor, stretched along the tiles.
  // color + blend ('multiply' darkens the floor keeping its color; 'normal' lays the color over it) per layer.
  contact: { opacity: 0.85, size: 60, softness: 4, color: '#00010c', blend: 'multiply' },   // size: reach in front of the base, px
  // Cast shadow: longer shadow thrown by the light, along the tiles (away from the vanishing point).
  cast: {
    opacity: 0.55, color: '#00010c', blend: 'multiply',
    length: 0.8,        // shadow length relative to the casting height
    height: 700,        // only the lowest this-many px of a prop cast; the shadow fades out towards that height
    squash: 0.6,        // vertical flattening (floor perspective)
    softness: 6,        // blur radius, px at the 1/4-resolution shadow map
    clump: 8,           // merges details into simple graphic shapes (blur radius before the threshold; 0 = detailed)
    falloff: 1.5,       // how fast the shadow fades with distance from its start (higher = faster)
    bands: 3,           // stylized: number of flat tones
    hardness: 0.6,      // 0 = smooth gradient, 1 = hard bands
  },
  // Telescope shadow: same settings as contact / cast above, tuned on their own.
  scopeContact: { opacity: 0.85, size: 60, softness: 4, color: '#00010c', blend: 'multiply' },
  scopeCast: {
    opacity: 0.55, color: '#00010c', blend: 'multiply',
    length: 0.8, height: 700, squash: 0.6, softness: 4, clump: 3, falloff: 1.2, bands: 3, hardness: 0.6,   // thin legs: less clumping
  },
};

// Soft blob shadow under the character (scene.js / walk.js). Stays flat on the floor: it doesn't tilt with the
// lean at the telescope, squash with the bend or lift with a step. Defaults of the Settings sliders (Character shadow).
const CHAR_SHADOW = {
  opacity: 0.9,
  color: '#000000',
  width: 1.0,         // × the character sprite's width
  height: 0.24,       // × the character sprite's width (floor perspective: much flatter than wide)
  offsetX: 0,         // shift right, × the sprite width (not mirrored when the character turns)
  offsetY: 0,         // shift up, × the sprite width
  softness: 1,        // 0 = hard-edged disc, 1 = fades out from the very middle
};

const PIVOT_DIST = DEPTH.midground;     // orbit pivots around the rooftop so it stays put
const MAX_YAW = THREE.MathUtils.degToRad(7);
const MAX_PITCH = THREE.MathUtils.degToRad(4);
const ORBIT_SENS = 0.0035;              // radians per pixel dragged
const ORBIT_DAMP = 6;                   // higher = snappier follow

// Shaky cam: a slow handheld sway around the rooftop pivot (like a tiny automatic Orbit), so the
// layers shift against each other by depth. Each axis sums three slow sines with unrelated
// frequencies (rad/s), so the motion is smooth and never visibly repeats. Scaled by the Settings slider.
const SHAKE_YAW = THREE.MathUtils.degToRad(0.35);     // max sideways sway
const SHAKE_PITCH = THREE.MathUtils.degToRad(0.2);    // max up/down sway
const SHAKE_ROLL = THREE.MathUtils.degToRad(0.08);    // max tilt
const SHAKE_FREQ = { yaw: [0.29, 0.83, 1.9], pitch: [0.23, 0.71, 1.6], roll: [0.19, 0.57, 1.3] };
const SHAKE_SPEED = 1;
// Camera follow: the camera trucks a little towards the character as it walks (from where it starts),
// so the layers parallax by depth. World units per full artwork width / height of character movement.
const FOLLOW = { x: 0.38, y: 1.3, smooth: 0.9 };   // smooth: catch-up time constant in seconds                                // multiplies all frequencies

// Pan Orbit: camera stays fixed, layers slide in 2D. Weight = how far a layer slides per unit of drag,
// decreasing from far to near. Every layer moves; the pivot sits between the glow motes and the foreground, so only
// the foreground moves against the drag. Rooftop and character share a weight so the character stays planted.
// Max slide as a fraction of a layer's width (at weight 1); set by the settings slider.
// Vertical range is PAN_Y_RATIO of the horizontal one.
const settings = { panRange: 0.046, dollyDepth: 1, craneTilt: THREE.MathUtils.degToRad(37),
  rowFloorTop: 0.685, rowNearWeight: 0.1, vRowFloorTop: 0.685, vRowStrength: -0.06, shootingRate: 3, cometRate: 0.75,
  stars: true, shootingStars: true,   // Night sky on/off switches
  shake: 1, follow: 1,
  parallaxX: 1, parallaxY: 1 };   // Parallax X / Y sliders: depth difference between layers per axis (0 = all move like the rooftop)
const PAN_Y_RATIO = 0.7;
const PAN_SENS = 0.004;                 // normalized pan per pixel dragged
const PAN_WEIGHT = { sky: 1.0, cityFar: 0.87, city: 0.75, fog: 0.62, motesBack: 0.55, midground: 0.35, character: 0.35, motesNear: 0.2, foreground: -0.3 };

// Scroll: flat zoom of the whole rendered view, anchored at the cursor.
const MAX_ZOOM = 3;
const ZOOM_SENS = 0.0015;
// Ctrl+scroll: fake dolly. Each layer scales as if the camera moved DOLLY_MAX units forward,
// i.e. by d / (d - travel), so near layers grow faster than far ones. settings.dollyDepth blends
// from 0 (every layer scales like the rooftop: flat) to 1 (true ratios) and beyond (exaggerated).
const DOLLY_MAX = 4.5;
const DOLLY_SENS = 0.0012;

// Pan Up: the camera tilts up by settings.craneTilt (slider) and rises CRANE_RISE units at the
// reference tilt; the rise scales with the tilt so small tilts stay small moves.
const CRANE_RISE = 3;
const CRANE_REF_TILT = THREE.MathUtils.degToRad(37);
const CRANE_DURATION = 2.8;             // seconds

// Behind the Scenes: every layer becomes an equal-size card, fanned out diagonally (front card
// bottom-left, back cards stepping up-right) and viewed from a 3/4 angle.
const BTS_DURATION = 1.8;               // seconds for the fly-out / fly-back
const BTS_CARD_W = 16;                  // card width in world units
const BTS_STEP = { x: 4.45, y: 2.25, z: 2.75 };   // offset between neighbouring cards (8 cards in the room 7 had)
const BTS_CENTER = new THREE.Vector3(0, 0, -14);
const BTS_YAW = THREE.MathUtils.degToRad(-22), BTS_PITCH = THREE.MathUtils.degToRad(4), BTS_RADIUS = 56;
// Aim left of and below the stack so it sits right of the explainer panel and clear of the buttons.
const BTS_LOOK_OFFSET = new THREE.Vector3(-4, -1.2, 0);
const BTS_DEMO = 1.2;                   // amplitude of the demo slide (world units, foreground card)

const BTS_CARD_COUNT = 8;
const BTS_EXTRA_GAP = 1.2;             // furthest an effect on a card sits in front of / behind it (world units)
// Per-layer parallax strength, the default of each card's slider in Behind the Scenes. Scales how fast the
// layer slides on screen when the camera moves (1 = what its depth gives, 0 = stuck to the screen).
const LAYER_PARALLAX = { foreground: 1, character: 1, midground: 1, fog: 1, city: 1, cityGlow: 1, cityFar: 1, sky: 1 };

// Effects
const GLOW_SPREAD = 2.6;                // glow sprite diameter relative to the detected light's size
const GLOW_FLOOR_Y = 0.648;             // ignore warm pixels below this height (lit floor, pots, table)
const GLOW_SCAN_W = 960;                // glow detection runs at this width, whatever the artwork resolution
const GLOW_PROP_MIN_AREA = 40;          // on the roof props, only bright spots this big (scan px) get a glow: lanterns yes,
                                        // shiny pole-top knobs and brass ornaments (4-12 px) no


// From Below: the camera starts so low that the screen is entirely the black underside below the
// foreground's bottom edge, then rises to the normal view; a soft gradient eases the edge. This is
// also the startup move, played after the loading screen. RISE_START is in half view heights at the
// foreground's depth, so the framing holds at any aspect ratio.
const RISE_DURATION = 5;                // seconds
const RISE_START = 1.05;                // camera start: this many half view heights below the foreground's bottom edge
const LOADER_FADE_MS = 600;
const RISE_FADE_HEIGHT = 0.32;          // gradient height above the edge, in foreground frame heights

const CHAR_RECT = { x: 1257, y: 1450, w: 297, h: 472 };   // pixel placement in the composition (ART_W x ART_H)
const CHAR_FOOT_PAD = 0.012;            // transparent space below the boots, as a fraction of the sprite height
// Happy reaction (planting on the roof, walk.js cheer()), over sec seconds: a subtle stretch up (stretch × height, a touch
// onto tiptoe: rise × height) while the leaves on the hat sway (swings back-and-forths of up to leafDeg degrees).
const CHAR_CHEER = { sec: 2.4, stretch: 0.03, rise: 0.006, leafDeg: 7, swings: 2 };
// The hat's two leaves, cut out of the character sprite so they can sway (walk.js): poly = their outline and
// pivot = the stem's foot, in px of Assets/layers/character.png; idleDeg = a constant gentle sway (0 = still).
const CHAR_LEAVES = { poly: [[100, 0], [470, 0], [470, 195], [364, 203], [356, 213], [330, 216], [100, 216]], pivot: [357, 211], idleDeg: 0, idleSec: 3.5 };
// A star dropping into the bag (collect.js) flicks the leaves: a sway of up to deg degrees that dies down over sec
// seconds (swings back-and-forths); each new star restarts it.
const CHAR_LEAF_FLICK = { deg: 7, sec: 1.1, swings: 2 };
// Walk cycle: sprite sheet shown instead of the standing sprite while the character walks.
// Made from Art/Character/walkcycle1.mp4 by Art/Character/extract_walkcycle.py (frames left to right, top to bottom).
const CHAR_WALK = {
  image: 'character_walk',
  cols: 6, rows: 6, frames: 34,
  // Playback follows the distance walked, so the planted boot stays put whatever WALK.speed is.
  // stride: ground covered by one full cycle (two steps), in frame heights. Measured from the video's
  // planted boot (~8.5 px per frame of 606): 0.477. Lower = faster steps, higher = slower (feet slide).
  stride: 0.477,
  height: 0.989,              // frame height as a fraction of CHAR_RECT.h (matches the standing sprite's size)
  aspect: 253 / 424,          // frame width / height
  footPad: 0.0099,            // transparent space below the lowest boot, as a fraction of the frame height
  offsetX: 0,                 // nudge sideways against the standing sprite, as a fraction of CHAR_RECT.w
  bob: 0,                     // 0..1: how much of the old procedural hop + sway (WALK.hop / sway) to keep on top
};

// Gameplay anchors: where interactions happen. Like CHAR_RECT, x/y/r are pixels in the
// composition, on the layer whose artwork they belong to, so they slide with that layer.
// Markers are shown only while Dev is on.
const ANCHORS = {
  stargaze: { layer: 'midground', x: 1925, y: 1540, r: 130, label: 'Look up' },         // telescope
  nets: [                                                                                 // the 2 nets (iteration-8 poles)
    { layer: 'poles', x: 1160, y: 1020, r: 120, label: 'Net 1' },
    { layer: 'poles', x: 2410, y: 790, r: 120, label: 'Net 2' },
  ],
};
// Open sky for constellations in the stargazing view (Pan Up at the default 14° tilt), in degrees
// above the horizon and left/right of center. Below SKY_FIELD.elMin the skyline and pole tops show.
const SKY_FIELD = { elMin: 17.5, elMax: 30, azMax: 24 };
const ANCHOR_COLOR = '#7ff7ff';

// The two big nets spanned over the roof (iteration-8). They start empty; every completed constellation drops one
// star into one of them, any element: the net holding fewer stars (a coin toss when even), so they fill evenly.
// Stars are drawn behind the net ropes with a glow (Settings → Star glows). Positions/sizes in composition pixels.
// x, y: the net's middle (walk-to and ring). `outline`: the net in the poles art (hover highlight and tap area).
// `slots`: where the 1st, 2nd, … star of the net rests, spread along the bottom of its sag (first free one is taken;
// more stars reuse them with a small jitter). ring: size of the tap ring around it.
const NETS = [
  { x: 1160, y: 1020, ring: 520,
    outline: [[650, 570], [860, 690], [1160, 890], [1610, 890], [1800, 810], [1830, 860], [1610, 990], [1410, 1100],
      [1160, 1170], [940, 1100], [760, 970], [650, 730]],
    slots: [[1170, 1080], [1310, 1050], [1060, 1030], [1430, 1000], [920, 960], [1240, 995], [1540, 940], [800, 880]] },
  { x: 2410, y: 790, ring: 560,
    outline: [[1800, 560], [1960, 580], [2200, 630], [2560, 614], [2900, 480], [3340, 314], [3400, 340], [3240, 610],
      [3020, 810], [2800, 906], [2560, 926], [2280, 890], [2080, 800], [1900, 674], [1800, 600]],
    slots: [[2360, 840], [2530, 825], [2200, 810], [2690, 780], [2060, 750], [2450, 770], [2840, 700], [2980, 610]] },
];
// The charm strings hanging under each net (netCharms.js; none on the big nets of iteration-8), net by net: box = the string in the poles art
// [left, top, right, bottom] (it's cut out and drawn on its own), pivot = the knot it hangs from (art px). When stars
// are collected from a net its charms dangle: a push of about kickDeg (degrees), freq = swings per second of a
// 100 px string (longer ones slower), damping = how soon they settle (0 … 1), maxDeg = the most they swing.
const NET_CHARMS = {
  kickDeg: 6, freq: 0.9, damping: 0.12, maxDeg: 14,
  strings: [[], []],
};
const NET_STAR = {
  size: 138,                  // first star in a net (art px); later ones a little smaller. 150% of the first 92 (2026-10-21)
  arrivalSec: 0.9,            // the landing pop: grows in with a small overshoot, glow flares then settles
  extraGlow: 0.45,            // glow strength of the 2nd, 3rd, … star in a net (the first has 1)
  breathe: 0.18,              // how much a settled star's light swells and fades (slowly)
  glow: 0.5,                  // strength of a settled star's light on the net (× the Star glows setting)
  humPulse: 0.45,             // extra light while its net hums
};
// Props the character can walk behind. Each is a full-frame image drawn on the midground plane as its
// own sprite; while the character's feet are above `footY` (further back), the prop is drawn in front.
const DEPTH_SORTED = [
  { image: 'foreground_telescope', footY: 1860 },   // tripod feet
];

// Telescope (A2): tap it and the character walks to the eyepiece, leans in, the tube tilts up and the
// camera pans to the sky. The tube is cut out of the telescope image with `tube` and tilts around `pivot`.
const TELESCOPE = {
  image: 'foreground_telescope',
  tube: [[1770, 1530], [1788, 1638], [1860, 1622], [1932, 1590], [2005, 1558], [2181, 1515], [2181, 1390], [2020, 1390]],
  pivot: [1953, 1590],        // altitude axis: the knob on the mount
  objective: [2115, 1452],    // front lens: where the glint appears
  stand: [1705, 1855],        // where the character's feet go to look through the eyepiece
  tiltDeg: 6,                 // how far the tube tilts up
  tiltSec: 0.9,               // tube tilt duration
  leanDeg: 9,                 // character leans towards the eyepiece
  leanSec: 0.6,
  hitPad: 30,                 // tap tolerance around the telescope, px
  hover: 0.18,                // brightening while the pointer is over it
  flash: 0.45,                // extra brightness right after a tap
  // The telescope not tapped for idleAfter s (other taps don't count; the wait pauses while it can't be used: walking,
  // off the roof, locked): it lights up once
  // like under the pointer, but stronger (idleLight): idlePulses soft pulses in a row, each fading in and out over
  // idleSec, then the wait starts over.
  idleAfter: 5,
  idleSec: 1.1,               // one pulse
  idlePulses: 2,
  idleLight: 0.9,             // its brightening at each pulse's peak (hover's 0.18 is too faint to notice without the cursor on it)
  glintSize: 150,             // lens glint diameter, px
  zoom: 1.12,                 // gentle zoom-in that rides along with the pan up ("looking through the telescope")
  skyTiltDeg: 6,              // the pan up tilts this much further than the Pan Up slider, to centre the constellations
  // The telescope's sideways swing in the sky turns the sky fully, the other layers only by this × their depth /
  // the sky's depth (far city ≈ 0.3 of the swing, near city ≈ 0.17, the roof a few hundredths): they drift, parallax.
  aimParallax: 0.6,
  // Turned further round than layerFollow[0] degrees, the city and the roof stop drifting along and slide out of view
  // (gone by layerFollow[1]): behind the roof there is only sky (rig.js turnLayers).
  layerFollow: [90, 170],
  // Turning together (swing.together): the city, its mist and the far street glow turn fully with the sky, as in a
  // real telescope pan (their mirrored artwork scrolls past, rig.js turnLayers), and the painted sky (moon, wisps)
  // turns with the stars. parallax: how much faster a nearer one slides than the far city (× (far city's depth / its
  // depth - 1)), a hint of depth. Turned further round than layerFollow they sink below the view (sink × the frame
  // height by layerFollow[1]): behind the roof there is only sky. The roof and what stands on it keep the drift above
  // (they only show at home). together: false = everything drifts as before.
  swing: { together: true, parallax: 0, sink: 1 },   // parallax 0: a turn, so no depth hint (all slide as one)
  // The painted sky (moon, wisps, the stars over it) drifts like a layer at this depth (DEPTH units; the far city is
  // 70), not with the turning star sky: it stays in step with the skyline, also on the way back down to the roof.
  backdropDepth: 70,
  // Returning to the roof (modes.js returnToRooftop) is one move: the scope turns home the short way round as the camera
  // pans down. On the way down the eyepiece vignette (and the search's round lens, if closed) stays as it is until the camera is
  // back on the roof, then fades out over homeOpenSec; homeBlur = how soft the view goes while it pans down (px per
  // 1000 px of screen height, eased in and out with the move). homeMotionBlur = the vertical streak on top, by how fast
  // the camera moves (px per 1000 px of screen height at full speed; 0 = none).
  homeOpenSec: 0.8, homeBlur: 0, homeMotionBlur: 0,   // blurs off (2026-10-28; were 4.5 and 14)
  // ...but turned round more than homeCentre.minDeg, the scope first turns home up in the sky (degPerSec, at least
  // minSec) and only then pans down, so the city doesn't swing round as it comes into view.
  homeCentre: { minDeg: 2, degPerSec: 120, minSec: 0.5 },
  // Searching between constellations (scopeSearch.js). The path: straight up, sometimes a detour first (detour =
  // chance), one to three looks along the way (± wander degrees, more on longer searches), past the spot
  // (overshoot degrees, varied) and back; sweepSpeed = degrees per second, each stretch segSec [least, most]
  // seconds; pauses = seconds it holds still: after rising, at each look [least, most], past the spot. The eyepiece closes in while
  // searching: lensSize = how much smaller, lensSoften = harder rim, lensRim = faint glassy edge, lensZoom = extra
  // zoom, lensSec = how fast it closes. Focus: blurPx = blur at full speed (px per 1000 px of screen height),
  // blurSpeed = degrees per second that count as full speed, focusSoft = how out of focus it settles, focusSec =
  // the focus pull, focusGlow = the lift of light as it pulls in; zoomBlur = how soft the view goes while the star
  // chart's lens zoom runs (with the focus pull; most as it sets off, × blurPx). tremorDeg = a slow faint hand tremor; sound =
  // loudness of the mount, ticks and found chime (× the chime volume).
  search: { detour: 0.3, wander: 3, overshoot: 3.5, sweepSpeed: 11, segSec: [0.8, 3.2], pauses: { rise: 0.35, look: [0.4, 1], past: 0.3 },
    lensSize: 0.22, lensSoften: 0.45, lensRim: 0.07, lensZoom: 0.1, lensSec: 0.9,
    blurPx: 3, blurSpeed: 14, focusSoft: 0.55, zoomBlur: 1.1, focusSec: 0.9, focusGlow: 0.1, tremorDeg: 0.12, sound: 0.25 },
  // Close-up once a search has found the next constellation (rig.js closeUp): the camera zooms in onto its star circle
  // so the stars are bigger and easier to tap (zoom = how much), moving it centre of the way to the middle of the screen
  // (0 = stays at CONSTELLATION_PLAY.focusY, 1 = middle). It zooms in as the scope finds the spot, still blurred, with
  // the eyepiece opening and the focus pull (on the chart's zoomSec); sec = the ease back out as its star flies to the net.
  found: { zoom: 1.2, centre: 1, sec: 1.4 },
  // Searching by hand (dragSearch.js, from the sky search sketch): instead of the scope searching by itself, the player
  // drags the sky through the closed eyepiece to one of the constellations still waiting in this tier (tiers: the zodiac
  // in rows of four, one of each element, CONSTELLATION_TIER). Each waits at its own spot: a glimmer in its element's
  // color (glimmerSize × a constellation star) in the middle of its own circle on the star chart. Close enough
  // (captureDeg) and the scope settles onto it (settleSec, soft as it moves), then the focus pull and the chart's lens
  // zoom until that circle fits, as the automatic search did. on: false = the old automatic
  // search, in zodiac order. Degrees: the spots lie within ±maxYaw sideways and spotElev above the horizon (whatever
  // the Pan up slider; up high a sideways turn covers less sky, so they stay low enough to spread out), at least
  // spotGap apart on the sky and startGap from where the search starts; the player can steer within ±maxYaw (+6) and
  // dragElev (the flat sky runs out at the zenith). maxYaw ≥ 180 (with the sky dome, SKY_DOME): steering goes all
  // the way round and the spots spread round the whole sky, one per 360° / n slice (jittered by `spread` of a slice),
  // so each search is a real journey and the rim hints become the compass. After a find, the scope comes round to the
  // roof as it follows the star down to its net (STAR_DELIVERY.turnShare). Once the star has landed the scope returns to where that constellation was (at backSpeed °/s, at
  // least riseSec) and the search goes on from there. riseSec: the scope first
  // lifts out of the dip over the nets by itself. drift = how long a flick keeps gliding (s), driftMax = its top speed
  // (°/s). Rim hints (a soft glow on the eyepiece's edge pointing to a spot out of view): hidden at first, fading in
  // from hintRange degrees away and stronger the closer; after hintAfter seconds of searching all fade in anyway (over
  // hintFade). hintSize = × the screen height. Tapping a glimmer chooses it too, from wherever the scope points: a tap
  // (moved less than tapMove px) within tapR × the screen height of it. grab: the hint that the sky can be dragged,
  // once the scope has risen (after delay s), until the player has dragged `learned` × the screen height in all;
  // from then on only after idleAfter s with the view standing still.
  drag: { on: true, glimmerSize: 1.25, captureDeg: 5, settleSec: 1.1, riseSec: 1.4,
    // dragElev's low end keeps the city and the roof out of view all the way round (38°: checked in the eyepiece); the
    // return after a find comes back at least that high too. The player's first drag ends the way back and steers from there.
    maxYaw: 180, spotElev: [40, 62], dragElev: [38, 80], spotGap: 34, startGap: 30, spread: 0.35, backSpeed: 60,
    drift: 0.45, driftMax: 55,
    hintRange: 45, hintAfter: 8, hintFade: 3, hintSize: 0.11, tapR: 0.09, tapMove: 10,
    grab: { on: true, delay: 1.6, learned: 0.2, idleAfter: 10 } },
};
// Tiers (dragSearch.js): the zodiac in rows of this many constellations (Aries–Cancer, Leo–Scorpio, Sagittarius–Pisces:
// one of each element, in the difficulty curve's order). The player picks the order within a tier, each once; the next
// tier opens, unannounced, once all of it is found. The first look-up plays the whole first tier, then pans down.
const CONSTELLATION_TIER = 4;
// After the first tier, and then after every SKY_TRIP_TIERS tiers, the camera pans back down to the roof by itself and
// the telescope waits until the nets are emptied (collect.js).
const SKY_TRIP_TIERS = 2;

// Greenhouse (start of B1): tap it → the character walks to the door, steps in and fades out, the camera
// zooms towards the door and the interior picture fades in. "Leave greenhouse" / Esc reverses it.
const GREENHOUSE = {
  layer: 'greenhouse',              // MIDGROUND_PROPS entry (its image is used for the tap hit test)
  stand: [2760, 1855],              // in front of the step
  door: [2872, 1735],               // doorway threshold: where the character disappears
  zoomTo: [2872, 1490],             // camera zooms towards this point (middle of the door)
  zoom: 2.6,                        // zoom factor at the door
  // Stepping through the door (character fade), the zoom and the interior cross-fade all start together;
  // with equal durations they also end together.
  stepSec: 1.2,                     // character fades out / in
  zoomSec: 1.2,                     // zoom towards / away from the door
  fadeSec: 0.5,                     // interior picture cross-fade (shorter: the rooftop shouldn't linger)
  // Interior: layers back to front (Assets/scenes/greenhouse/, loaded by URL), each with a parallax depth
  // (1 = nearest). Things standing on the table share the table's depth so they don't slide on it. front: drawn in front
  // of the growing plant too (planting.js), for things standing before the pot.
  // The pictures are 4160x2340: the painted 3840x2160 frame (shown at rest) plus `bleed` px on each side, spare
  // art for the parallax. All positions below are in the frame's 3840x2160 grid.
  interiorDir: 'Assets/scenes/greenhouse/',
  bleed: [160, 90],
  // Art px at the top of each layer fading out, seen when the camera pans up (sky and layers with topFade: false
  // excepted). Keep it below the bleed minus the pointer / sway shift (~25 px), or it shows at rest.
  topFade: 20,
  // The lamp's cord, drawn behind the lamp up into the roof (the picture ends at the shade's cap): x, from y up to y, width, colour
  lampCord: { x: 1546, from: -80, to: -3000, width: 18, color: '#24150c' },
  interior: [
    // depth = how far a layer shifts with the pointer: falls off with distance (foreground leaves close by, the
    // table and what stands on it, the greenhouse wall behind it, then the city and the sky far away)
    { image: 'greenhouse_sky', depth: 0.02, pan: 0.12 },
    { image: 'greenhouse_sky_moon', depth: 0.02, pan: 0.12 },
    { image: 'greenhouse_city2', depth: 0.05, pan: 0.25 },
    { image: 'greenhouse_city1', depth: 0.09, pan: 0.4 },
    { image: 'greenhouse_frame', depth: 0.25, pan: 0.7 },
    { image: 'greenhouse_table', depth: 0.42, pan: 1 },
    { image: 'greenhouse_glasses', depth: 0.42, pan: 1 },
    { image: 'greenhouse_plantpot', depth: 0.42, pan: 1 },
    { image: 'greenhouse_book', depth: 0.42, pan: 1, front: true },   // the star book, in front of the pot (its saucer)
    { image: 'greenhouse_shovel', depth: 0.42, pan: 1, front: true },   // the little shovel, in front of the pot and the jars
    { image: 'greenhouse_lamp', depth: 0.4, pan: 0.85, topFade: false },
    { image: 'greenhouse_forground', depth: 1, pan: 1.1 },
  ],
  // pan: how much a layer follows the camera's pan up while a tall plant grows (1 = with the pot; Plant Lab values)
  // Lamp light, styled and flickering like the rooftop lanterns (Settings → Lamp glows): a glow around the
  // bulb (on the lamp layer) and a soft pool of light on the table under it. Positions in 4K pixels.
  lampLight: { bulb: [1547, 128], glowSize: 1100, glowStrength: 0.9, pool: [1650, 1850], poolSize: [2000, 520], poolStrength: 0.35 },
  parallax: {
    pointer: 0.022,                 // max shift of the nearest layer from the pointer, share of the view width
    sway: 0.004,                    // slow handheld drift (× the Shaky cam setting)
    smooth: 0.35,                   // pointer follow time constant, seconds
    enterZoom: 0.07,                // layers start this much zoomed (× depth) and settle when you enter
    enterSec: 1.4,
  },
  // Entering with no stars at all (satchel, jars and pot empty): after delaySec the character says so in a speech
  // bubble (speechBubble.js) with a button under it back to the roof; showSec 0 = they stay until the player leaves.
  // at = the bubble's middle (x) and top (y), % of the picture; text: \n = new line.
  emptyBubble: { on: true, text: 'Nothing to grow yet.\nI need stars first.', button: 'Rooftop',
    delaySec: 2, showSec: 0, at: [76, 26] },
  hitPad: 20,                       // tap tolerance, px
  hover: 0.12,                      // brightening while the pointer is over it
  flash: 0.35,                      // extra brightness right after a tap
  // While the satchel holds stars, the greenhouse breathes softly brighter: the stars belong in there.
  beckon: { strength: 0.1, speed: 1.6, fade: 1.5 },   // extra brightness at the peak, breaths (rad/s), fade in/out (s)
  // Star storage: the four jars on the table (greenhouse_glasses), one per element, blue · yellow · red · green
  // from left to right (same order as the nets). body = inside of the glass where stars settle: centre x, y, width, height (4K px).
  // Centres = where the star floats: low in the glass, under the jar's star tag (jars without corks since 2026-11-26).
  jars: {
    water: [930, 1770, 280, 270],
    air:   [1358, 1660, 280, 270],
    fire:  [2552, 1680, 280, 270],
    earth: [2980, 1780, 280, 270],
  },
  jarStars: 7,                      // star sprites shown per jar (the count can go higher)
  jarStarSize: 210,                 // a stored star's visible size when it's alone in its jar, 4K px (as in Greenhouse_mockup)
  jarFull: 6,                       // stars for a jar to glow at full strength
  jarHover: 0.18,                   // a jar brightens this much while the pointer is over it (as the telescope)
  jarFlash: 0.35,                   // extra brightness right after tapping a jar
  // While the satchel holds stars the jars call (like a net under the pointer): their glass lights up, breathing one
  // after another; after COLLECT.hintAfter s without a tap, a white ring circles the left jar (ring: centre offset from
  // the water jar's body and diameter, art px).
  jarCall: 0.55, jarCallBreath: 0.4,
  jarRing: { dy: -160, size: 470 },
  flyFrom: [1920, 2350],            // where the satchel's stars rise from (just below the bottom edge)
  flySec: 1.1, flyGap: 0.22,        // each star's flight into its jar, and the gap between stars
  flySize: 170,                     // a flying star's size at the start, 4K px
};

// The star book on the greenhouse table (starBook.js): tap it and it opens, one page per flower that can grow from
// three stars (the 20 mixes make 8 flowers: the flower colour picks the species, Green only shapes it). A grown
// flower fills its page with Nadin's painting (Assets/book/, from build_book.py), its name, the mixes it grows from
// (the ones grown so far lit) and a field note; the others show a pencil sketch and their star mixes, still to grow.
// Not saved yet (A6): the book forgets with a reload, like the plants.
const STAR_BOOK = {
  dir: 'Assets/book/',
  hit: [2010, 1820, 740, 270],      // tap area over the book: x, y, w, h (art px of the 3840x2160 room)
  hover: 0.16,                      // the book brightens this much under the pointer
  // While it holds a flower not looked at yet, a warm light breathes over the book and a few sparkles twinkle.
  beckon: { glow: [2380, 1950], size: [1100, 560], strength: 0.9, breathSec: 2.6 },
  openSec: 1.1,                     // from the table to the middle of the screen, then the cover swings open
  flipSec: 0.75,                    // one page turn
  // A flower grown for the first time: after its growth the book opens by itself (delaySec), waits on the title page
  // (pauseSec), riffles through to its page (flip / lastFlip = share of flipSec per turn) and the entry inks itself in
  // (revealSec; the book can't be closed until then). Its name and Carry it outside follow once the book is closed.
  newFlower: { on: true, delaySec: 0.7, pauseSec: 0.5, flip: 0.28, lastFlip: 0.7, revealSec: 2.8 },
  title: 'Starseed Herbarium',
  subtitle: 'Flowers grown from fallen stars',
  owner: 'kept by the Night Gardener',
  missingNote: 'This page is still waiting for its flower.',
  // Page order: the one-colour flowers, the two-colour ones, all three colours, the pure Green climber.
  // art = the file name in Assets/book/; latin and note are made up for the book (change freely).
  pages: [
    { species: 'blue', art: 'blue', latin: 'Lilium caelestis',
      note: 'Opens only under a clear sky. Its trumpets hum when the dew falls.' },
    { species: 'yellow', art: 'yellow', latin: 'Dahlia aurea noctis',
      note: 'Keeps the warmth of a summer evening long after the sun has gone.' },
    { species: 'red', art: 'red', latin: 'Tulipa ignicula',
      note: 'Glows like an ember in the grate. Keep it away from dry leaves.' },
    { species: 'blue+yellow', art: 'blueyellow', latin: 'Plumaria marina',
      note: 'Its feathered heads lean towards the sea breeze, even on a still night.' },
    { species: 'blue+red', art: 'bluered', latin: 'Anemone crepuscula',
      note: 'Blooms in the hour between dusk and dark, and closes at first light.' },
    { species: 'red+yellow', art: 'redyellow', latin: 'Stellaria flammea',
      note: 'Each petal points back to the star it fell from.' },
    { species: 'blue+red+yellow', art: 'blueredyellow', latin: 'Campanula lunaris',
      note: 'Rings very softly whenever the moon is full.' },
    { species: 'green', art: 'green', latin: 'Hedera ascendens',
      note: 'Climbs towards the brightest star it can see, a little every night.' },
  ],
  // The last page: flowers that need the rare stars (A8 / A9), only hinted at for now
  end: { title: 'Pages yet unwritten', note: 'Some seeds only fall on rare nights: when the sky wears an aurora, or when the moon goes dark.' },
};

// Plants (B1): three stars from the jars become a plant in the pot (planting.js, plantModel.js). Rules and
// look come from the Plant Lab (sketches/plant-lab.html, wiki: plant-growth-spec). Only the recipes listed
// in `recipes` can be grown yet. Positions in 4K px of the greenhouse art.
// The numbers below are the Lab's values (2026-10-18). On start the game also reads the Lab's settings file
// (settings.plantlab.json via serve.py) and takes the values the Lab shows, so tuning a plant there
// carries over; without the file these stay.
const PLANTS = {
  dir: 'Assets/plants/',
  labFile: '/api/settings/plantlab', labFileStatic: 'settings.plantlab.json',   // (the file itself: without serve.py)
  // Mix key = star counts in the order fire, water, earth, air ('1011' = one red, one green, one yellow).
  // Every mix of three stars grows (all 20, as in the Plant Lab): the flower colour picks the species, Green makes it
  // taller and leafier, three Green = the green climber. The first one is the dev shortcut's (Dev → First plant ✦).
  recipes: ['1011', ...(() => { const out = []; for (let f = 3; f >= 0; f--) for (let w = 3 - f; w >= 0; w--) for (let e = 3 - f - w; e >= 0; e--) out.push(`${f}${w}${e}${3 - f - w - e}`); return out; })().filter(k => k !== '1011')],
  soil: [1955, 1575],               // where the stems enter the soil (visual centre of the pot's soil)
  // Choosing: three circles float above the pot (any three stars that make one of the recipes)
  slotY: 1200, slotGap: 300, slotSize: 210, // slot row height, spacing and star size
  hintDelay: 4,             // s without placing a star before "Drag the stars" appears over the circles
  // Reveal timing (as in the Lab; grow speed, camera follow, hold and return are Lab tuning, below)
  reveal: { starFly: 0.9, starGap: 0.45, soilSec: 0.8, bloomSec: 0.6 },
  // camFollow: the camera pans up after the growing tip when the plant is taller than the view, then eases back
  // (tuning.follow / returnSec). Off since the pot is smaller and the plants fit the view.
  camFollow: false,
  // The reveal's camera and room (planting.js updateRevealCamera, drawn by greenhouse.js), in four beats:
  // lean in: from Grow the view pushes in towards `focus` (art px), the pot's layer zooming by `push` (the others by
  // their depth: the foreground most, the sky hardly), eased over pushSec (springs: there in about 2.5 × sec);
  // hush: meanwhile the lamp dims by `lamp`, the room's sway stops and the edges darken (vignette = strength, size =
  // the clear ellipse, % of the view; sec in, outSec back); bloom: while it grows the camera orbits round the pot
  // (`arc` = the sideways slide per unit of depth from the pot, share of the view width; left or right at random;
  // arcSec); at bloomAt of the growth the light answers: swell rises over `rise` s and fades over `fall` s, lamp =
  // extra lamp light, sky = extra brightness of the sky and moon, glow = a light spreading from the plant (glowSize
  // art px, growing as it fades); gust = one breath through the foreground leaves (amount = share of the view width,
  // freq per s, damp); breathe out: from bloomAt everything eases back to rest over outSec.
  camera: { on: true, focus: [1955, 1420], push: 0.14, pushSec: 1.1, arc: 0.06, arcSec: 2.2, outSec: 1.1, bloomAt: 0.8,
    hush: { lamp: 0.6, vignette: 0.9, size: [42, 52], sec: 0.9, outSec: 0.6 },
    swell: { rise: 0.45, fall: 2.4, lamp: 0.7, sky: 0.3, glow: 0.8, glowSize: 1500 },
    gust: { amount: 0.008, freq: 0.7, damp: 1.4 } },
  // Growing FX. sparkle: the coloured light bursts (stars landing in the soil, flowers opening), count × strength.
  // motes: soft glowing particles like the star reveal's swirl (bright core, round glow, paler than the stars).
  // They puff out around the soil spot as the plant breaks through (puff, swirling out to puffDist art px), then
  // keep rising from the spot after the growing tip (every s; each follows reach × the way up to the tip, drifting
  // spread px sideways on a gentle swirl), shimmer and fade (life s); size = glow radius, art px; pale = towards white.
  growFx: { sparkle: 0.35,
    motes: { puff: 14, puffDist: 230, every: 0.035, life: [1.1, 1.9], reach: [0.25, 0.85], spread: 110, swirl: 1.1, size: [60, 120], pale: 0.55, bright: 1 } },
  // The organic growth (Lab "Growth: organic", 2026-10-24; Lab REVEAL_ORGANIC, keep both alike), after Nadin's two
  // reference clips. on: false = the earlier reveal (stems straight up, the flowers fading in at the end). fx: the
  // light bursts, soil glow and rising motes while it grows (the Lab's organic reveal has none). Windows are shares
  // of the growth (0 … 1): the stems shoot up one after another (stemStagger apart, the tallest first), fast then
  // slowing, with a thin pointed tip (tipLen × the flower's width) that sways as it searches (nod: radians, nodWaves
  // over its growth); young stems stand close together and fan out as they grow (fan). A small closed bud (budShape:
  // length, width × the flower's width; budFrom = its first size) rides each tip, ripening from budColors[0] over
  // budColors[1] to the flower colour; once its stem is openAt grown the flower pops open (openDur, easing out with
  // a slight overshoot: headPop; bud = the unfolding flower's first size, width, height). Stem leaves sprout under
  // the tip and keep growing while it climbs (leafGrow × the flower's width). Ground leaves pop out of the soil one
  // by one (leaves: from, delay spread; leafDur; pop = their overshoot), standing up first, settling outwards.
  // Each leaf springs on its own once grown (spring × bounce: freq per second, damp, lag s, leaf / stemLeaf =
  // radians); each opening flower sways on its stem (flower: amp radians at the tip, freq, damp, head = its own
  // turn, lag s; sec = how long the plant keeps moving after it has grown).
  organic: { on: true, fx: false, stems: [0.02, 0.8], stemStagger: 0.1, tipLen: 0.5, nod: 0.35, nodWaves: 1.6, fan: 0.85,
    budFrom: 0.3, budColors: ['#5f8a3a', '#b9c45a'], budShape: [0.34, 0.13], bud: [0.38, 0.3, 0.9], openAt: 0.78, openDur: 0.2, headPop: 1,
    leafGrow: 1.8, leaves: [0.16, 0.9], leafDur: 0.22, pop: 1.5, bounce: 1.2,
    spring: { freq: 2.1, damp: 2.6, lag: 0.08, leaf: 0.08, stemLeaf: 0.16 },
    flower: { amp: 0.13, freq: 0.85, damp: 1.1, head: 0.07, lag: 0.12, sec: 4 } },
  // Grown and ready to take out: the plant breathes brighter (breath = extra brightness at the peak, speed rad/s,
  // hover = extra under the pointer); sparkles = the star reveal's particles without its rings (STAR_DELIVERY.revealFx):
  // puff of them spiral out from the plant as it finishes growing, then one every `every` s while it waits. dist = art px
  // beyond the plant's edge, sec = how long each lives, size = glow radius (art px), pale = towards white;
  // captionY = where its name ends, under the pot, and buttonY = where "Carry it outside" ends, under the name (art px);
  // captionYTouch = captionY on touch screens (the button keeps a minimum size there, so it reaches up closer to the name);
  // hintAfter = s after it is grown (bloomSec after the growth, the flowers still settling) before the name breathes
  // in; buttonAfter = s after that before "Carry it outside" blooms in under it
  ready: { breath: 0.12, speed: 1.8, hover: 0.18,
    sparkles: { puff: 14, every: 0.5, dist: [180, 370], sec: 1.6, size: [40, 90], swirl: 1.1, pale: 0.75 },
    captionY: 1830, captionYTouch: 1780, buttonY: 2000, hintAfter: 0.15, buttonAfter: 0.9 },
  // The plant grows out of the earth (Lab GH.soilMask): drawn sink px lower, the pot drawn again over its foot,
  // fading in from fadeUp above the soil point to fadeDown below; soft contact shadow (strength, w × h art px).
  // The ground leaves are drawn again over the pot (hanging over its rim), except in a band at the soil where their feet
  // are buried: frontHole px to each side of the foot (soft sides: frontEdge), down to frontBelow under it, soft by frontFade.
  soilMask: { sink: 22, fadeUp: 8, fadeDown: 20, shadow: 0.4, shadowW: 170, shadowH: 34, frontHole: 60, frontEdge: 0.6, frontBelow: 6, frontFade: 8 },
  // Above the painted greenhouse, seen while the camera pans up (placeholders until there is art, as in the Lab):
  // night sky gradient + stars (they pan by starsPan), and a glass roof on the frame
  above: { skyHeight: 2600, skyDark: '#040820', stars: 260, starsPan: 0.3 },
  // Greenhouse light on the plant: warm lamp light near the table, cooler towards the top (ambient → ambientTop
  // between the heights warmUntil and coolFrom), rim light from the left
  light: { ambient: '#f2caa2', ambientTop: '#8a98dc', warmUntil: 250, coolFrom: -900, brightness: 1,
    rim: 'L', rimColor: '#ffb35c', rimStrength: 0.75 },
  // Lab "Greenhouse tuning": reveal (grow speed px/s; camera keeps the tip `follow` × screen height below the top;
  // revealSec: growing takes at least this long, s; hold at the top, s; camera back down, s), overall size, flower glow, rim light, and the starting values of every mix
  tuning: { growSpeed: 850, revealSec: 5, follow: 0.14, hold: 1.6, returnSec: 2.4, ghScale: 0.66, gh_glow: 0.59, gh_rimW: 0.022, gh_rimSoft: 0.6, gh_rimFlower: 0.53, gh_flowerSelf: 0.54,
    // prototype flower rim (Lab "Light": Flower rim …): own hue, cooler and weaker high up, light from lower left
    gh_rimFix: false, gh_rimFlowerW: 0.04, gh_rimTint: 0.6, gh_rimCool: 0.6, gh_rimTopFade: 0.45, gh_rimDy: -0.35,
    gh_glowSpread: 1, gh_glowOver: 1,   // Lab "Light": how far the flower glow reaches; over the flowers (0 = only around them)
    gh_leafSize: 0.62, gh_leafGreen: 0.22,   // generic leaves: size, and more per Green star
    ghBloom: 380, ghH0: 700, ghH1: 1000, ghH2: 2600, gh_stemW: 0.034, gh_bendStraight: 8, gh_bendDroop: 160, gh_bendFrom: 0.45,
    // Lab "Roof tuning": the same plant in the planters (overall size, flower glow, rim light, starting values, sway)
    roofScale: 1.49, roof_glow: 1, roof_rimW: 0.022, roof_rimSoft: 0.6, roof_rimFlower: 0.45, roof_flowerSelf: 0.57, sway: 0.04,
    roof_rimFix: false, roof_rimFlowerW: 0.04, roof_rimTint: 0.6, roof_rimCool: 0.6, roof_rimTopFade: 0.45, roof_rimDy: -0.35,
    roof_glowSpread: 1, roof_glowOver: 1,
    roof_leafSize: 0.62, roof_leafGreen: 0.22,
    roofBloom: 80, roofH0: 170, roofH1: 260, roofH2: 520, roof_stemW: 0.034, roof_bendStraight: 8, roof_bendDroop: 160, roof_bendFrom: 0.45 },
  // Lab "Shapes" per mix (greenhouse): only the values changed from the species' defaults
  mixes: {
    '1011': { unit: 478, height: 1080, stemW: 0.059, headScale: 1.48, bendFrom: 0.45, heightVary: 0.05, spread: 0.33, bend: 10 },
    '1101': { height: 1740, spread: 0.17, bend: 164, bendFrom: 0.71, stemW: 0.086 },
  },
  // Species = flower colour (which colour stars are present). form: growth numbers (Lab FORMS); heads: the
  // concept heads in heads.json; leaves: the painted leaf setup (Lab LEAF_SETUPS; <parts>.json); stem: [dark, light].
  species: {
    'red+yellow': {
      title: 'Orange star lily', heads: 'redyellow', stem: ['#55561c', '#c4a444'], show: '#ff9a6a',   // show: bloom burst colour
      form: { stems: 3, spread: 0.3, tall: 1.15, droop: 0, headScale: 1, glow: 0.25, follow: 0.85, bendFrom: 0.45, stemBase: 0.05 },
      leaves: {
        parts: 'redyellow',
        ground: [
          { group: 'backoutside', count: [3, 5], layer: 'back',   turn: [-14, 16], jitter: 6, x: [8, 34], size: [0.85, 1.05], delay: 0 },
          { group: 'backcenter',  count: [2, 2], layer: 'behind', turn: [-4, -4],  jitter: 8, x: [0, 18], size: [0.9, 1.05], delay: 0.05 },
          { group: 'front',       count: [2, 2], layer: 'front',  turn: [-4, -4],  jitter: 8, x: [10, 30], size: [0.85, 1], delay: 0.1 },
        ],
        stem: { group: 'stem', count: [0, 4], at: [0.5, 0.74], open: [24, 42], size: [0.85, 1.1] },
      },
    },
    red: {
      title: 'Red tulip', heads: 'red', stem: ['#6e0f2c', '#d8456c'], show: '#ff6f7f',
      form: { stems: 3, spread: 0.3, tall: 0.9, droop: 0, leafLen: 0.95, leafWid: 1, rosette: 5, rosetteSpread: 1.3, stemLeaves: 0, side: 0, headScale: 1.1, glow: 0.2, follow: 0.85, bendFrom: 0.45, stemBase: 0.22 },
    },
    blue: {
      title: 'Blue trumpet lily', heads: 'blue', stem: ['#2b4638', '#7f9c6c'], show: '#4aa0ff',
      form: { stems: 3, spread: 0.36, tall: 1.1, droop: 0, leafLen: 1.7, leafWid: 0.45, rosette: 8, rosetteSpread: 1.3, stemLeaves: 0, side: 0, headScale: 1.15, glow: 0.3, follow: 0.85, bendFrom: 0.45, stemBase: 0.22 },
    },
    yellow: {
      title: 'Golden dahlia', heads: 'yellow', stem: ['#7d5e10', '#e6b83a'], show: '#ffe08a',
      form: { stems: 3, spread: 0.42, tall: 1, droop: 0, leafLen: 0.42, leafWid: 0.9, rosette: 2, rosetteSpread: 1.4, stemLeaves: 5, side: 0.5, headScale: 1.1, glow: 0.2, follow: 0.85, bendFrom: 0.45, stemBase: 0.22 },
    },
    // Three Green stars: no flower, Nadin's climber (Lab "Pure Green", green.json from cut_green_plant.py): her leaves in
    // two layers around a generated braided stem with leaf stalks. vine: as the Lab's VINE (strands [dark, light] per
    // strand in turn; shoot = the leaf stalks' colours; width × the painted stem's; amp = how far the strands wind
    // round; shootLen [low, high] concept px; reveal = the leaves open this far below the climbing tip; open = their
    // first width) and the plant's own values (Lab Shapes: thickness, strands, turns, stalks, stalk length, leaf width).
    green: {
      title: 'Green climber', heads: null, stem: ['#45561f', '#b9b14e'], show: '#9fe39a',
      form: { stems: 0, spread: 0.5, tall: 1, droop: 0, rosette: 0, rosetteSpread: 1.2, stemLeaves: 0, side: 0, headScale: 1, glow: 0, follow: 0, bendFrom: 0.45, stemBase: 0.22 },
      vine: { strands: [['#4a150c', '#c2502a'], ['#24301a', '#6f7f3a'], ['#5a1d10', '#d0643a']], shoot: ['#26331a', '#7d8c44'],
        width: 0.42, amp: 0.3, shootLen: [330, 190], reveal: 260, open: 0.55,
        params: { vineW: 1, vineStrands: 3, vineTwist: 3.5, vineShoots: 12, shootLen: 1, leafW: 1 } },
    },
    // Without a painted leaf setup (as in the Lab): the generic painted leaves (leaf1–4) as base leaves (rosette, fanning
    // out by rosetteSpread) and on the stems (stemLeaves each), leafLen / leafWid stretching them; side = the chance of a
    // second, smaller flower on a side twig; hang: the heads hang from their stem (bells).
    'blue+red': {
      title: 'Purple anemone', heads: 'bluered', stem: ['#4c3846', '#a3828f'], show: '#a57bff',
      form: { stems: 3, spread: 0.4, tall: 0.85, droop: 0, leafLen: 1.2, leafWid: 0.95, rosette: 7, rosetteSpread: 1.4, stemLeaves: 1, side: 0, headScale: 1.1, glow: 0.25, follow: 0.85, bendFrom: 0.45, stemBase: 0.22 },
    },
    'blue+yellow': {
      title: 'Turquoise clusters', heads: 'blueyellow', stem: ['#82600e', '#e8b430'], show: '#8ff0d2',
      form: { stems: 3, spread: 0.3, tall: 1.05, droop: 0.12, leafLen: 0.75, leafWid: 0.8, rosette: 3, rosetteSpread: 1.4, stemLeaves: 4, side: 0, headScale: 0.85, glow: 0.25, follow: 0.3, bendFrom: 0.6, stemBase: 0.22 },
    },
    'blue+red+yellow': {
      title: 'White bells', heads: 'blueredyellow', hang: true, stem: ['#655f16', '#cdb944'], show: '#f4f2ff',
      form: { stems: 3, spread: 0.32, tall: 1.4, droop: 1, leafLen: 1.8, leafWid: 0.45, rosette: 7, rosetteSpread: 1, stemLeaves: 0, side: 0, headScale: 0.95, glow: 0.45, follow: 0, bendFrom: 0.8, stemBase: 0.22 },
    },
  },
  // The generic painted leaves (Lab LEAVES): pointing left, anchor = the petiole, tip = the leaf tip (0..1 of the image)
  leaves: [{ n: 'leaf1', anchor: [0.98, 0.99], tip: [0, 0.46] }, { n: 'leaf2', anchor: [0.99, 0.98], tip: [0, 0.02] },
           { n: 'leaf3', anchor: [0.99, 0.97], tip: [0, 0.05] }, { n: 'leaf4', anchor: [0.99, 0.95], tip: [0, 0.31] }],
  // The most-used colour star (two or more colours, no tie) nudges its species
  nudge: {
    fire:  { tall: 0.94, spread: -0.06, droop: 0,    stems: 0 },
    water: { tall: 1.1,  spread: -0.03, droop: 0,    stems: 0 },
    air:   { tall: 1,    spread: 0.08,  droop: 0.12, stems: 1 },
  },
};

// Roof garden (roofGarden.js): a grown plant is carried out of the greenhouse and waits, not yet planted, hovering
// over a spot in a planter with a soft light under it. Hold and drag it: it slides along the planters' soil (never into
// the air) and snaps to the nearest spot when let go; the withered plant of the spot it is over gives way while it is
// there. Tap it (or the ring under it) once it has snapped: the character walks over, bends down and plants it.
// Spots: 9, as many as in the Plant Lab, set on the iteration-5 beds; each sits on a withered plant where there is one.
// x, y = where the stems enter the soil (4K px); lab = the Plant Lab spot whose light + scale it takes (Lab "Edit
// spots" panel: ambient, brightness, rim, scale; the Lab's positions are for the old planter art, so they're set here);
// stand = where the character stands to plant it.
const ROOF_GARDEN = {
  beds: {   // soil line of each bed (x from … to, 4K px): a dragged plant slides along these
    bedLeftBack:   { soil: [1450, 1660] },
    bedLeftFront:  { soil: [1360, 1640] },
    bedMiddle:     { soil: [2020, 2560] },
    greenhouseBed: { soil: [3120, 3600] },
    seedlings:     { soil: [2360, 2600] },   // the small box by the watering can (no withered plant in it)
  },
  spots: [
    { bed: 'bedLeftBack',   x: 1503, y: 1552, withered: 'midground_withered1', lab: 0, stand: [1490, 1790] },
    { bed: 'bedLeftBack',   x: 1634, y: 1564, withered: 'midground_withered2', lab: 1, stand: [1640, 1790] },
    { bed: 'bedLeftFront',  x: 1375, y: 1635, withered: 'midground_withered3', lab: 2, stand: [1380, 1790] },
    { bed: 'bedLeftFront',  x: 1600, y: 1635, withered: null,                  lab: 3, stand: [1580, 1790] },
    { bed: 'bedMiddle',     x: 2060, y: 1580, withered: 'midground_withered4', lab: 4, stand: [2060, 1730] },
    { bed: 'bedMiddle',     x: 2298, y: 1586, withered: 'midground_withered5', lab: 5, stand: [2180, 1730] },
    { bed: 'bedMiddle',     x: 2516, y: 1574, withered: 'midground_withered6', lab: 6, stand: [2690, 1750] },
    { bed: 'greenhouseBed', x: 3181, y: 1774, withered: 'midground_withered7', lab: 7, stand: [3160, 1910] },
    { bed: 'greenhouseBed', x: 3531, y: 1770, withered: 'midground_withered8', lab: 8, stand: [3530, 1910] },
    { bed: 'seedlings',     x: 2478, y: 1640, withered: null,                  lab: 5, stand: [2480, 1880] },   // Lab light: the middle bed's spot behind it
  ],
  firstSpot: 0,                 // where a plant carried out of the greenhouse appears (the first free one from here on)
  // Light per spot when the Lab file isn't there (its spot values replace these)
  light: { ambient: '#8f93c4', brightness: 0.72, rim: 'L', rimColor: '#ffb466', rimStrength: 0.5 },
  // Waiting (not planted yet): standing in the soil (lift px above it, bobbing ± bob px every bobSec; 0 = still), a
  // white-ish overlay on the plant (shine: opacity, + shineBreath breathing, + shineHover under the pointer; shineColor)
  // and a soft pool of light on the soil (pool: radius px, strength)
  wait: { lift: 0, bob: 0, bobSec: 3.2, shine: 0.2, shineBreath: 0.12, shineHover: 0.12, shineColor: '#fff3df', pool: 120, poolStrength: 0.55 },
  witheredFade: 0.5,            // s, the withered plant giving way / coming back
  witheredSway: 0.5,            // the withered plants sway this much of the flowers' sway (Lab T.sway)
  drag: { holdSec: 0.25, startPx: 8, follow: 14, snapSec: 0.35, lift: 60 },   // hold (or move) to pick it up; follow = how fast it glides after the pointer; lift = extra height while carried
  hitPad: 30,                   // tap tolerance around the plant, px
  captionY: 30,                 // the hint's bottom this far above the waiting plant's top, px
  // The plant in the earth (Lab ROOF_SOIL): drawn sink px lower, the planter art drawn again over its foot in a patch
  // halfW px to each side (soft sides: edge), fading in from fadeUp above the soil point to fadeDown below; contact shadow
  soil: { sink: 9, fadeUp: 3, fadeDown: 8, halfW: 70, edge: 0.55, shadow: 0.35, shadowW: 48, shadowH: 9 },
  // Taking root (tap it): one slow breath. All times in seconds from the tap; [a, b] = eases from a to b, [a, b, c] =
  // eases in from a to b and out again to c. sec = the whole moment, doneSec = it counts as planted. The character stays
  // free to walk all through it.
  root: {
    sec: 6, doneSec: 3.2,
    gather: [0, 0.8, 1.7], gatherShine: 0.28, gatherGlow: 2,   // first its shine (extra opacity) and glow (extra × glow) intensifying
    sink: [0.7, 2.4],               // settling into the earth (soil.sink px)
    shineOut: [0.7, 1.7],           // the waiting look melting away
    drain: [0.9, 1.6, 2.7], drainStrength: 0.5,   // its light drawing down the plant towards the soil
    ringOut: 2, ringWiden: 0.7,     // the dashed ring opening (× its size) and fading (rate, higher = quicker)
    bloom: [1.6, 2.8, 6], bloomStrength: 1.15, bloomWide: 1.1,   // the earth answering: the pool of light swelling (extra size) and fading
    breath: [2.1, 3.4, 5.4], breathUp: 0.028, breathWide: 0.018, breathLag: 0.25,   // the plant breathing in: height, then width after breathLag s
    wake: 0.9,                      // its own glow swelling with the breath (extra × glow)
    sway: [2.2, 4.6],               // its sway easing in (still before)
    // its flower heads closing and popping open again (s; stagger = up to this much later per stem), then flowers, stems
    // and leaves settling on the growth's springs (PLANTS.organic) from bounceAt, for sec
    flowers: { close: [0, 1.1], open: [1.7, 2.8], stagger: 0.3, bounceAt: 2.6, sec: 4 },
    hush: [0, 1.2, 5], hushStrength: 0.65,   // the roof around it dimming; the music steps back until the end of this window
    chordAt: 1.8, chordStep: 0.45, chordSoft: 0.38, chordLen: 4,   // its stars' notes, one by one, low soft root note at chordAt
    cheerAt: 2.3,                   // the character's quiet stretch of joy (CHAR_CHEER), if it is standing still by then
    motes: { n: 10, from: 2, every: 0.22, life: [2, 3], rise: [80, 140], drift: 12, size: [12, 22], strength: 0.95, spread: 0.55 },   // soft lights rising from the soil (px; spread = × the plant's width)
  },
  appearSec: 1.2,               // the plant fading in on the roof after leaving the greenhouse
};

// Sky look ("Concept" art direction, picked on 2026-10-10 from Art/Ingame_Background/NightSky/references).
// Applied once the scene is built (skyLook.js). The gradient's horizon color is the painted sky's own top
// color × skyTint, so the two meet without a seam. Fog and window-glow defaults live in the Settings panel.
const SKY_LOOK = {
  zenith: '#050c2e',                   // sky gradient color straight up
  skyTint: '#dfe3ff',                  // multiplies the painted sky
  cityTint: '#b9c3ec',                 // multiplies near + far city
  // Background stars (stars.js), two kinds; the gameplay constellations are separate. Look values are live in Dev sky.
  stars: {
    blend: 'additive',                 // glow blend: 'additive' (brightens towards white) or 'normal' (Tint: keeps the hue)
    // Twinkle stars keep this gap above the city skyline (frame heights up, frame widths to the side, so parallax
    // can't slide them over a roof); dots may sit anywhere.
    skylineGap: { y: 0.065, x: 0.028 },
    // Dots in the sky's own muted hues. size in px (sprite with its glow; sizePow > 1 = mostly small ones), bright 0..1
    // per star; colorAmt 0 = grey … 1 = the colors as listed; sizeMul / brightMul on all of them; glow = the soft halo;
    // breathe = how far the slow breath dims (over about breatheSec seconds); twinkle = how far the quicker wobble dims.
    // bodyWhite = how white the star's body is (0 = its own color, 1 = white); glowColor = how colorful its glow is
    // (0 = grey, 1 = its color, above = more); hueShare = the share of stars that lean to another hue, one to each of the
    // sky scheme's two (SKY_LOOK.color, high up only), skyHue = how far they lean. Twinkle stars too.
    dots: { bodyWhite: 0.2, glowColor: 1.2, skyHue: 0.5, hueShare: 0.35, size: [4, 11], sizePow: 2.2, bright: [0.3, 0.8],
      colors: ['#9fb8e6', '#9fb8e6', '#7fa6dc', '#7fa6dc', '#8fc7d6', '#a99be0', '#c9a6d6', '#cdd9f2', '#cdd9f2'],
      colorAmt: 1, sizeMul: 1, brightMul: 1, glow: 0.25, breathe: 0.35, breatheSec: 7, twinkle: 0.3,
      amount: 1, maxAmount: 2 },   // amount = how many dots (1 = the usual number), maxAmount = the most the slider can show (fixed at build)
    // Twinkle stars: a small cross with a glow in the middle. share of all stars (up to maxShare, fixed at build);
    // Between twinkles a plain dot of radius `dot` px, a little bigger than the dots above. size in px (sprite: the
    // rays' longest reach); flare = how far the rays' light fades out at the height of a twinkle (× half the sprite);
    // thickness = ray width (× half the sprite); glow = the middle's glow while twinkling;
    // every = about this many seconds between a star's twinkles; sec = how long one lasts.
    twinkles: { bodyWhite: 0.35, glowColor: 1.2, skyHue: 0.5, hueShare: 0.5, maxShare: 0.12, share: 0.03, size: [40, 56], bright: [0.7, 1],
      colors: ['#d6e4ff', '#d6e4ff', '#bfe3ea', '#dcd3f7'],
      sizeMul: 1, brightMul: 1, dot: 1.3, flare: 0.38, thickness: 0.035, glow: 0.3, every: 9, sec: 2.4 } },
  // Shooting stars: round glowing head + long thin trail fading into the sky (sizes as fractions of the sky width).
  // speed = screen heights per second, life = seconds (as in the sky search sketch, 2026-10-26: slower, easier to tap;
  // was about 0.9–1.8 screen heights per second for 0.9–1.5 s).
  meteors: { colors: ['#ff6fd8', '#5fe8ff', '#8fb4ff', '#ffd27a', '#b28cff'], len: [0.13, 0.26], width: 0.0015,
    glow: 0.7, headSize: 0.0185, speed: [0.55, 0.8], life: [1.3, 1.7],
    // Color sits in the tail, the head is pale. soften = saturation kept in the head's glow and sparks (1 = as listed);
    // tailSat = saturation kept in the tail; tailHue = hue shift towards the tail (in turns of the color wheel);
    // whiteFrom = where along the trail the color starts giving way to white (0 = tail end, 1 = head);
    // tailFade = how soon the tail fades out (lower = stays visible further back).
    soften: 0.3, tailSat: 0.85, tailHue: -0.1, whiteFrom: 0.7, tailFade: 1.1,
    // Some are a little slower, easier to catch: `share` of them fly at `speed` × the above, for just as far (they last longer).
    slow: { share: 0.4, speed: 0.75 },
    // They fade out softly before reaching the roofs: fully gone `fadeGap` above the skyline, starting to
    // fade `fadeBand` higher (frame heights). Their spawn height is unchanged.
    fadeGap: 0.037, fadeBand: 0.092,
    // Tap one to pop it (stars.js): it flashes and bursts into a few soft sparks with a quiet chime. popR = tap
    // tolerance around its head (× screen height); sparks = how many, sparkSec = how long they drift out.
    popR: 0.09, sparks: 12, sparkSec: 1.2 },
  // Comets: rare shooting stars (same flight, fade and pop, stars.js), a bit bigger and much slower, so easier to catch,
  // with a glowing four-pointed body. headSize = the body's whole glow; star = its look: rays = how long the points reach,
  // thin = how narrow they are, breathe = slow swell of its size. sparkSize = size of the pop's sparks. pathTries = how
  // many paths it compares, taking the one longest in the open sky.
  comets: { colors: ['#ff9d5c', '#ff6fc4', '#5fc4ff', '#ffc94d'], len: [0.2, 0.3], width: 0.0021,
    glow: 0.8, soften: 0.3, tailSat: 0.85, tailHue: -0.1, whiteFrom: 0.7, tailFade: 1.1, headSize: 0.062, speed: [0.26, 0.34], life: [3.6, 4.6], slow: { share: 0, speed: 1 }, angle: [8, 30], pathTries: 24,
    star: { rays: 4.5, thin: 42, breathe: 0.07 },
    popR: 0.11, sparks: 18, sparkSec: 1.5, sparkSize: 0.024 },
  // Color in the high sky (skyLook.js): big soft shapes over the blue, one scheme per trip to the sky. a = the wide
  // gradient, b = the flowing shape in it (both as seen on screen, muted to suit the roof). amount = how far each covers the
  // blue at most, strength = all of it. from / full = elevation (deg) where it starts and is at full strength: below
  // `from` the sky stays its own blue (the view from the roof reaches about 20°).
  // stars = the two hues some background stars lean to on a trip with this scheme (skyHue, hueShare below).
  color: { strength: 1, amount: [0.48, 0.28], from: 26, full: 46,
    schemes: { green: { a: '#0f4460', b: '#1a5a5e', stars: ['#6fa4ff', '#62e0b4'] },
      purple: { a: '#302a72', b: '#4a3070', stars: ['#6fa4ff', '#b48cff'] } } },
  // Milky Way: a great circle on the sky dome. on: false hides it and its stars. Live in Dev sky → Milky Way.
  // a, b, glow, strength, dust, dustCount: only the old flat band (SKY_DOME.on false) and the second cloud below.
  nebula: { on: true, a: '#5a3fb8', b: '#2b56c8', glow: '#d7a6ff', strength: 1.5, dust: '#fff0c8', dustCount: 1600,
    // Its colors follow the background: one set per sky scheme (SKY_LOOK.color.schemes), as seen on screen.
    // deep = the dark body, ribbon / ribbonHi = the mottled glow of the band and its brighter clumps, warm = the soft clouds.
    // (purple is a first guess, until its references are in.)
    schemes: { green: { deep: '#0b1a48', ribbon: '#1f6a78', ribbonHi: '#4a9ea3', warm: '#e8907f' },
      purple: { deep: '#15114a', ribbon: '#4636b0', ribbonHi: '#8a62da', warm: '#c46ad2' } },
    // band = all of it; width = how wide (flat-sky units, about 28° per 1; the shapes scale with it); deepAmt / ribbonAmt / warmAmt = how far each
    // part covers the sky at most. stars = the background stars gathered along it (built once: count = at amount 1).
    band: { strength: 1, width: 0.24, deepAmt: 0.7, ribbonAmt: 0.7, warmAmt: 0.6 },
    // Edges of its four layers (body, glow, bright clumps, clouds): hard = 0 soft and misty … 1 a crisp cut-paper edge;
    // grain = a ragged, brushy fringe on the hard edges.
    edges: { grain: 0, hard: [0, 0, 0, 0] },
    // stars: built once (count = at amount 1; amount = its dots, twAmount = its twinkle stars, × the shared amounts);
    // Two layers across the band: spread = how far the dense middle reaches (× its width); edgeSpread = how far the sparse
    // outer stars reach (same units), edgeShare = the share of all its stars out there. clump = how unevenly they bunch along it (0 = even);
    // dotSize / dotBright / twSize / twBright = × the shared star look; twCross = how far a twinkle's cross reaches (× its size, dot kept); tint = how far they lean to the band's own
    // strand and cloud colors. Live in Dev sky → Milky Way stars.
    stars: { count: 8000, amount: 1, twAmount: 1, spread: 1, edgeSpread: 2.5, edgeShare: 0.25, clump: 0.35, dotSize: 1, dotBright: 1, twSize: 1, twCross: 1.6, twBright: 1, tint: 0 },
    // fade = elevations (deg) where it starts and where it is at full strength: it begins above the high wisps (they
    // thin out by about 28°), so from the roof (about 20° up) it doesn't show. Its stars thin in over the same range.
    fade: [28, 40],
    // Where it runs: a great circle whose highest point is `peak` degrees up, in the direction `az` (degrees, 0 = straight
    // ahead from the roof, > 0 = to the right). High peak = it arches up across the sky; 90 = straight over the top.
    arc: { peak: 70, az: 50 },
    // A faint second nebula cloud away from the band (az/el in degrees like the sky field, size × sky width,
    // aspect = height / width, tilt in degrees, seed varies the noise). on: false = hidden.
    patch: { on: false, az: -15, el: 30, size: 0.5, aspect: 0.55, tilt: -12, strength: 0.75, glow: '#f0a8e8', seed: 4.3 },
    // Slow life in both nebulas: drift = speed of the gas flowing through its warp (noise units/s, 0 = still),
    // breathe = seconds per glow pulse of the bright wisps, breatheAmt = how much they brighten/dim (0..1).
    motion: { drift: 0.012, breathe: 18, breatheAmt: 0.35 } },
};
// Sky dome (2026-10-26): the background stars and the Milky Way lie on a full sphere around the camera (on the sky
// layer, like the star chart), so every direction has sky. on: false = the old flat sky plane. radius = the dome's
// distance (the sky's depth keeps the stars sliding exactly as before). elFade = elevations (deg) over which the
// Milky Way fades in above the horizon (as the old band's lower edge did straight ahead).
const SKY_DOME = { on: true, radius: 140, elFade: [8, 14] };
// A hint of depth in the sky as the telescope turns (rig.js turnSkyParallax): how much faster than the constellations
// each part slides on screen (0.03 = 3% faster, < 0 = slower). The constellations and star chart are the rigid
// reference. stars = [smallest, biggest]: bigger stars read as closer, each star by its size. milkyWay = the Milky Way,
// its dust and the nebula cloud. backdrop = the painted sky with the moon, halo, wisps and glints. Nothing moves at
// the rooftop view. settleSec: after a trip all the way round, the eased return to the home position on the way down.
const SKY_PARALLAX = { stars: [-0.02, 0.03], milkyWay: -0.035, backdrop: 0.015, settleSec: 1.5 };
// How constellations look (A3): gold sparkle nodes joined by thin gold lines.
const CONSTELLATION_STYLE = { node: 'sparkle', star: '#ffd77a', line: '#ffd88a', lineOpacity: 0.75, lineWidth: 3, starSize: 120,
  // Whimsical lines: they start just outside each star's tips as it looks untapped (lineGap × that star's
  // size; tapped stars grow and may reach a little over it), and break into pieces of about lineDash
  // composition px with soft gaps (lineBreaks 0 = solid … 1 = mostly gaps) and fading.
  lineGap: 0.4, lineDash: 9, lineBreaks: 0.45,
  lineWave: 0.55,                // seconds for the light to run along a line after a tap
  shape: { curve: 0.3, width: 0.8 },   // star outline, like the sky stars (SKY_LOOK.stars.shape): curve 0 = needle rays … 0.5 = plump
  fadeIn: 0.9, starStagger: 0.35, lineDraw: 0.6, fadeOut: 0.5,   // seconds: wake-up after the pan up, hide on return
  twinkle: 0.15,                                                 // gentle brightness wobble per node
  rhythmNoteSec: 2.8,            // "in rhythm with the sky" stays this long (seconds), then fades out (style.css .rhythm-note.leaving)
  dim: 0.4, dimLines: 0.3,       // woken but not yet tapped: star brightness, line brightness (× lineOpacity)
  litBright: 1.4, litScale: 1.25,   // a tapped star: brightness and size
  flashScale: 1.7, flashDecay: 0.55,   // a star brightening up: size multiplier, seconds to settle back
  burstSize: 3.2, burstSec: 0.8, glitter: 6,   // in-rhythm sparkle: ring size (× star), duration, flying glints
  // Tails: thin rays of light from the star's four tips while it sings or is lit, pulsing with the beat.
  // rayLen = reach (× star size) when singing, rayLit = the same while only lit (idle); rayLitBright = idle
  // brightness (× rayBright); rayPulse = how much they breathe while singing, rayIdlePulse = while idle.
  rayLen: 1.9, rayLit: 0.8, rayLitBright: 0.3, rayPulse: 0.18, rayIdlePulse: 0.05, rayBright: 0.75,
  // Size on screen: each constellation is scaled to fill about fitW x fitH of the screen (fractions of its
  // width / height) around the telescope's focus, by no less than fitMin and no more than fitMax. Its stars
  // grow along by starGrow of that (0 = stars keep their size, 1 = they grow as much as the shape).
  // starVary: how much the reference sheet's per-star sizes show (0 = every star the same base size, 1 = as drawn).
  fitW: 0.32, fitH: 0.3, fitMin: 0.75, fitMax: 2.6, starGrow: 0, starVary: 0,
  // Dev sky → Constellation sliders, on top of all that: the whole shape (after fitMin / fitMax, so it always
  // shows), each star, the lines' thickness (× their usual size).
  shapeScale: 1, starScale: 1, lineScale: 1,
  // faceFront: every constellation is shown straight on, as drawn, wherever the telescope points: laid out flat
  // and turned to face the camera, upright (no leaning with the star chart, no stretch off to the side).
  // false = drawn onto the sky plane where it is (and leaning with the chart by STAR_CHART.look.star3d).
  faceFront: true };
// Star chart (starChart.js; from the night sky sketch, sketches/night-sky-ornaments.html): a vintage celestial
// atlas laid over the sky around the constellation, switched on and off with the Star chart button in the sky.
// Several circular systems overlap, each with its own centre and scale: graduated double rings, dotted rings,
// short spokes, small roundels and the lines of a huge celestial grid; small markers sit where lines really cross. A
// framing circle is fitted around the constellation, which sits in a quiet gap of the map. The map covers the whole
// sky (built once per look-up, every constellation of it a part of the same map): its circle systems are spread
// evenly over the sky, each on its own gently leaned-back surface. Radii are in map units: 1 = d at distance d, as
// seen in the sketch's 55° view; the game scales them to its own view, so the circles keep their size on screen.
const STAR_CHART = {
  lineOpacity: 0.7, width: 1.25,                     // the chart's ink: base opacity and line width (× the panel's)
  d: 100,                                            // distance to the map (world units)
  tilt: 0.32, curve: 0.04, rot: -0.04,               // a gentle lean back (radians); the framing circle's slight bend and turn
  // the framing circle: its main ring encloses every star with margin (map units) to spare; other rings in R = that
  // radius. The map's lines fade out inside quiet × R (a soft hole around the constellation, moving with it), and any
  // of the map's circle systems reaching within clear × R fades out as a whole, so the frame sits in clean space
  // instead of between loose pieces of rings (grid lines only fade inside the hole). Grid lines always show within
  // gridNear × R (fading out to 1.6 × that), even in their gaps, so a line into the circle runs on out of its other side.
  frame: { margin: 0.075, rings: [[1.0, 'band'], [1.2, 'ring']], spokes: { n: 12, r: [1.0, 1.2] }, quiet: 0.94, clear: 1.4, gridNear: 2.2, spin: 0.004 },
  outerSpin: -0.7,                                   // a spinning system's outer rings turn the other way, at this × the inner speed
  showSec: 0.8,                                      // fade in / out when it's switched on or off, or the constellation changes
  // Between constellations the chart draws itself in only once per look-up; after that the telescope searches on
  // across the same map. The next framing circle (and the quiet hole around it) fades in where the next
  // constellation will be, during the first fadeIn of the swing (0 … 1, while it's still off screen); the last one
  // fades out over the rest of the swing. While searching it shows at about the last circle's size (± sizeVary);
  // once found, the telescope's lens zooms the whole chart in or out over zoomSec (as the eyepiece opens) until the
  // circle fits the constellation (never the other way around), and only then does the constellation fade in. The zoom stays
  // between zoomRange = [least, most] (× the chart as built). Its quiet gap × quiet.
  // Searching by hand: the chart eases further away (× away, over awaySec, as the scope lifts out of the dip), so its
  // rings and circles look a little smaller while searching; choosing a spot zooms back in until its circle fits, so the
  // zoom into the gameplay is bigger (1 = as before).
  search: { fadeIn: 0.2, quiet: 1.15, sizeVary: 0.12, zoomSec: 0.7, zoomRange: [0.7, 1.45], away: 0.8, awaySec: 1.4,
    // A finished constellation's circle stays on the chart (keepDone; false = it fades out as the search starts, as
    // before); only its tint in the star's color fades back into the chart's own ink, over doneTintSec seconds.
    // The waiting constellations' spots keep their circles clear of the kept ones (centres at least doneGap × the two
    // radii apart); where there's no room left, a kept circle a new one runs into fades out instead.
    keepDone: true, doneTintSec: 1.6, doneGap: 1.12 },
  dash: 2.2,                                         // soft breaks: the length of one piece (map units)
  // the circle systems' designs: rings [radius, style] with style band (graduated double ring), ring (single),
  // double, dots; spokes = short radial lines between two radii; cross = a roundel's cross hairs. spin = radians per
  // second the system very slowly turns (× the panel's Spin; its outer rings turn the other way, × outerSpin).
  systems: [
    { rings: [[0.4, 'ring'], [0.47, 'band']], spin: -0.003 },
    { rings: [[0.3, 'ring'], [0.36, 'dots']] },
    { rings: [[0.32, 'band'], [0.4, 'ring']], spin: 0.005 },
    { rings: [[0.1, 'ring'], [0.22, 'band'], [0.28, 'ring']], spokes: { n: 12, r: [0.1, 0.22] }, spin: -0.012 },   // roundels
    { rings: [[0.08, 'ring'], [0.18, 'ring'], [0.26, 'band']], spokes: { n: 16, r: [0.08, 0.18] }, cross: 0.3, spin: 0.01 },
    { rings: [[0.36, 'ring'], [0.42, 'band']], spin: 0.004 },
    { rings: [[0.34, 'band'], [0.42, 'ring']], spin: -0.005 },
    { rings: [[0.32, 'ring'], [0.38, 'dots']] },
    { rings: [[0.36, 'ring']] },
  ],
  // The map over the sky: systems (a random design each, × scale) are packed evenly, so no stretch of sky is empty:
  // two neighbours' centres stay gap × (their outer radii added up) apart (a random gap per system; < 1 = their
  // outer rings cross a little), but one system crosses at most maxCross others (0 = none touch). Then small fillers
  // (same rules, fillerGap) take what room is left, and a celestial
  // grid (grid) ties it all together; markers sit where solid lines cross (at most marks of them, at least markGap
  // degrees apart). elRange = the band of sky it
  // covers (degrees above the horizon; it fades out above the rooftops anyway: look.fadeLow / fadeHigh).
  map: {
    gap: [0.82, 1.0], maxCross: 1, scale: [0.85, 1.15], tries: 5000, elRange: [-4, 86],
    fillers: [
      { rings: [[0.05, 'ring'], [0.11, 'dots']], cross: 0.15 },
      { rings: [[0.07, 'ring'], [0.13, 'ring']], spokes: { n: 8, r: [0.07, 0.13] }, spin: 0.008 },
      { rings: [[0.1, 'band']], spin: -0.006 },
      { rings: [[0.12, 'ring'], [0.15, 'dots']] },
    ],
    fillerGap: 1.0, fillerScale: [0.9, 1.4],
    marks: 70, markGap: 6,
    // the celestial grid: meridians every `meridian` degrees and the `parallels` (declination, degrees) of one huge
    // sphere around a pole poleEl degrees above the horizon (random side), each showing only in stretches of
    // `stretch` degrees with gaps of `gap` between, fading in and out over `fade` degrees (alpha = their ink), and
    // always near the constellation's circle (frame.gridNear); the equator and the first meridian are graduated
    // The meridians stop dec degrees from the equator (short of the pole, where they'd bunch up) and run into a quiet
    // polar circle there: a graduated band, and a plain ring inner degrees further in (ink × alpha), showing in arcs
    // where a meridian ends (reach = how far either side, × the meridians' spacing). The map's circle systems keep
    // clear × the polar circle's radius away from the pole, so none sit on it (it reads as a circle system of its own).
    // whole (2026-10-26, trying out): every grid line shows all the way, so the meridians visibly meet at the pole and
    // cross the parallels, at wholeAlpha × alpha (fainter); false = the pieces described above.
    grid: { whole: true, wholeAlpha: 0.6, meridian: 30, parallels: [-30, 0, 30, 60], poleEl: [35, 60], stretch: [35, 90], gap: [30, 80], fade: 12, alpha: 0.7,
      polar: { dec: 80, inner: 2.5, alpha: 0.6, reach: 0.8, clear: 1.6 } },
  },
  // The look, live from Dev chart (defaults = Nadin's saved look of 2026-10-20). Colors are as seen on screen.
  look: {
    color: '#b36319', blend: 'additive', opacity: 0.2, width: 3.4,   // ink color, blend (additive / screen / normal), opacity, line width
    hue: 66, hueScale: 1, hueSat: 0.7,                 // hue shift across the chart: up to ± degrees, how quickly it changes over the sky, how rich the tints get
    tint: 0.65, tintFade: 0.1,                         // the framing ring in the constellation's color (strength), and how far that fades out into the chart
    glow: 1.3, glowSize: 9.55, glowSoft: 0.15, glowColor: '#7473de', glowBlend: 'additive',   // glow around the lines: strength, width (× the line), softness, color, blend
    breaks: 0.15, breakWidth: 0.25, breakFade: 0.05, dotBreaks: 1.1,   // soft gaps along the lines (how many, how wide, how softly), and dots floating in short gaps
    // brush strokes (Brush button in the sky): line width × this, bristle streaks, ragged edges, how dry the paint
    // runs towards a stroke's end, a stroke's length (× the line width), and the soft breaks' size with the brush (× theirs)
    brushWidth: 1.6, brushGrain: 0.05, brushRag: 1, brushDry: 0.7, brushStroke: 120, brushBreaks: 0.65,
    size: 1.6, tilt: 0.95, spin: 2.95,                      // the map's size and lean back (× the values above); how fast the circle systems turn
    density: 1,                                        // how closely the map's circle systems pack (more = closer together, more of them)
    star3d: 1,                                         // the constellation leans into space with the chart: 0 = flat on the sky, 1 = the chart's own tilt (off while CONSTELLATION_STYLE.faceFront)
    starScale: 1.15,                                      // the constellation's stars while the chart is shown (× their usual size)
    revealSec: 3.2,                                    // the reveal: the framing ring draws around, then the map spreads to the edges
    fadeLow: 14, fadeHigh: 25,                         // fades out above the rooftops: gone below the first elevation (degrees), full from the second
    // (the long grid lines and the framing circle fade along their length; a circle system fades as a whole by the height
    // of its centre, so it's never cut in half where no city hides the fade, behind the roof; only a haze right at the
    // horizon, gone below horizonLow and clear from horizonHigh, touches its lines)
    horizonLow: 2, horizonHigh: 10,
    // "in rhythm with the sky": a highlight wave in a richer, brighter ring tint runs out from the circle's centre and
    // fades as it goes, in the constellation's color. The same wave plays when the star appears, with its own values
    // (starPulse…; Dev chart → Star appears pulse). pulse = strength (how much brighter the lines get at the wave,
    // 0 = only recoloured); pulseSat = how pure that color gets (0 = the color as it is … 1 = its pure hue, which stays
    // colored however bright); pulseReach / pulseWidth = how far it travels and how wide the wave is (× the ring's
    // radius); pulseSec = how long.
    pulse: 10, pulseSat: 0.85, pulseReach: 3.2, pulseWidth: 0.5, pulseSec: 2.4,
    starPulse: 10, starPulseSat: 0.85, starPulseReach: 3.2, starPulseWidth: 0.5, starPulseSec: 2.4,
  },
};
// Echo game rhythm/sound (CONSTELLATION_PLAY), background music (MUSIC) and city ambience (CITY_SOUND) live in soundConfig.js, so the
// music can start before the rest of the game has loaded; re-exported below like everything else here.
// Star families are the zodiac elements: each sign gives the star of its element. Colors match the
// star art (star_special1 pink, star2 cyan, star3 green, star1 yellow) and tint the constellation's glow,
// lines, sparkle and name; the star cores stay almost white. Rare families (Aurora, Eclipse) come with their events.
const STAR_FAMILIES = {
  // `voice` = the element's instrument (chime.js), `octave` shifts it, `level` balances loudness.
  fire:  { name: 'Fire',  image: 'star_special1', star: '#ff7896', line: '#ff94ab', voice: 'epiano',  octave: 0,  level: 1.15 },   // pink — Aries, Leo, Sagittarius
  water: { name: 'Water', image: 'star2', star: '#38e0ff', line: '#7fe8ff', voice: 'glass',   octave: 0,  level: 0.85 },  // cyan — Cancer, Scorpio, Pisces
  earth: { name: 'Earth', image: 'star3', star: '#4fd673', line: '#86e69a', voice: 'marimba', octave: -1, level: 1.1 },   // green — Taurus, Virgo, Capricorn
  air:   { name: 'Air',   image: 'star1', star: '#ffd23c', line: '#ffe07a', voice: 'bell',    octave: 0,  level: 1 },     // yellow — Gemini, Libra, Aquarius
};
// First time through the loop (firstTime.js): after the first four stars come down, the sky waits until the first
// plant is planted. The greenhouse calls: it glows like a net under the pointer, breathing; after COLLECT.hintAfter s
// (or right away on a telescope tap) the hint ring circles its door. Inside, the way out stays closed until the plant
// has grown.
const FIRST_TIME = {
  on: true,                   // false = no first-time flow (the sky is always open)
  highlight: 0.6,             // light added to the greenhouse while it calls (share of its own colors, like COLLECT.netHover)
  highlightBreath: 0.35,      // part of that which breathes (at GREENHOUSE.beckon.speed)
  admireSec: 5,               // after the first planting: time to admire it before the telescope starts glinting
};

// Collecting (A4): tap a net → the character walks under it, reaches up, and its stars float down into
// the star satchel one by one. The jars in the greenhouse store them (GREENHOUSE.jars, jars.js).
// Positions in composition pixels, seconds otherwise.
const COLLECT = {
  // where the character stands under net 1, 2. Net 2's spot is in front of the trowel + can (at 2410, 1810 the feet
  // covered the trowel, and the walk there squeezed between the pots and the telescope, behind the tripod)
  netStand: [[1160, 1810], [2480, 1880]],
  netHitR: 170,               // greenhouse tap ring size (× 1.6); the nets use NETS[i].outline and .ring
  satchel: [-0.135, 0.325],   // the star on the satchel, on the character sprite: x from its centre (× width, as drawn in character.webp), y from the feet (× height)
  reachSec: 0.45,             // stretching up before the first star comes down
  floatSec: 0.85, floatGap: 0.32,   // each star's float down, and the gap between stars
  // The satchel holds satchelMax stars; its glow grows with every one (glow: opacity at one star → full, size growth).
  // Full: a soft ring ripples out around it every fullEvery s. A tap on a net while it's full: the net flashes
  // (refuseFlash × COLLECT.netFlash, + refuseStep for every further try within refuseReset s, up to refuseMax) and the
  // bag's ring ripples brighter. After a sky trip the telescope waits until the nets are emptied (SKY_TRIP_TIERS).
  satchelMax: 8,
  satchelGlow: { min: 0.22, max: 0.9, grow: 0.35 },
  fullEvery: 1.8, fullRing: 0.55,   // ring size: × the character's width at its widest
  refuseFlash: 0.8, refuseStep: 0.45, refuseMax: 2.6, refuseReset: 3,
  // The soft glowing tail behind each star on its way to the satchel: length = how far it reaches back
  // (share of the flight), dots = smoothness, size = × the star's size, bright = opacity just behind the star.
  tail: { length: 0.34, dots: 20, size: 0.95, bright: 0.32 },
  // Showing the player the way (no text):
  netHover: 0.14, netFlash: 0.5,   // light added to a net under the pointer, and right after a tap (share of its own colors)
  netFeather: 14,             // soft edge of that highlight (art px), so it fades out over the pole instead of cutting off
  netHoverEmpty: 0.06,      // the same under the pointer for an empty net (it can't be tapped), so subtler
  hintAfter: 8,               // seconds without progress before a soft ring appears around what to tap
  // Look of those rings (and the satchel's ripple, the jar's ring), like the moon's ring: one painted brushstroke
  // (tapered ends; sweep = share of the circle it covers) turning slowly (spin: degrees per second). Live in
  // Settings → Hint ring. style: 'bristles' (soft separate bristles; bristles = how many) or 'ink' (the star chart's
  // brush: grain = bristle streaks, rag = ragged edges, dry = paint running dry towards the end). color = the base
  // color; hueShift 0 … 1 = how far the hue drifts along the stroke through color2 and color3 (and back).
  // width = stroke width (× the ring's radius), glow = strength of the soft halo around it (above 1: stacked),
  // glowSize = its blur (× the stroke width), inner = the faint light inside (color3), bright = overall strength.
  hintRing: { style: 'bristles', color: '#ffe9c4', color2: '#f6c9e6', color3: '#bcd2ff', hueShift: 1, sweep: 0.94,
    width: 0.1, bristles: 9, grain: 0.5, rag: 0.6, dry: 0.4, glow: 0.55, glowSize: 0.9, inner: 0.12, bright: 0.7, spin: 4 },
  humEvery: [7, 11],          // a full net hums a bit of its constellation's melody every so often
  sparkleEvery: 0.45,         // sparkles rising from full nets
  inviteEvery: 6,             // once all stars are stored, the telescope glints now and then
};

// Star delivery after a completed constellation (A4): the finale glow, then the stars glide along the
// lines into one point, the star itself pops out there, holds for a moment, and flies down into its net.
// Seconds unless noted; sizes as a fraction of the screen height.
const STAR_DELIVERY = {
  afterFinale: 0.5,           // pause after the finale melody before the stars start gathering
  gatherMin: 0.6, gatherMax: 1.25,   // the stars fly straight to the middle: first / last arrival (the others evenly between)
  revealPause: 0.25,          // all stars together: a breath before the pop
  revealSec: 1.5,             // the pop, a little wobble, then a gentle hover
  revealSize: 0.16,           // star size while it shows itself
  flySec: 1.3,                // the flight down to the net
  // The flight is a fall from the middle of its ring towards its net: it lets go softly, then drops faster, settling
  // into the net. fallPow = how strongly it accelerates (1 = even), bowDeg = how far its path bows gently to one side
  // (degrees of view), approach = how much it swells on the way, as if coming closer (× its size), tumble = its slow
  // turn (turns). turnShare = the share of the flight in which the sideways part of the way is done (found further
  // round, the star and the scope come round to the roof high in the sky, so the roof shows up already facing it).
  fallPow: 1.7, bowDeg: 3, approach: 0.35, tumble: 0.15, turnShare: 0.55,
  // While it flies, the telescope follows it down until its net is in view (the net arrives at `landY`
  // on screen: -1 = bottom edge, 0 = middle), comes to rest as it lands, holds there for `landHold`
  // seconds so the landing can be seen, and only then swings up to search for the next constellation.
  // `followDown` = the least it dips (degrees). In the round lens (a search comes next) it also turns towards an outer
  // net until that is within `lensX` of the middle (−1 … 1 across the screen), by at most `followTurnMax` degrees.
  landY: -0.45, followDown: 2.2, landHold: 1.1, lensX: 0.3, followTurnMax: 20,
  // Test: only the first `fullStars` stars of the game are followed all the way down to their nets. After that the
  // scope only nods (dips `dipDeg` degrees over `sec`, rests `hold` s) and the star drops straight down off the bottom
  // of the screen in `flySec`, drifting a little sideways towards its net: `spread` = its sideways drift per net, left
  // to right (−1 … 1 across the screen). `on: false` = always follow all the way.
  // lensOnRise: the close-up stays while the star flies down and the scope nods; the round lens (vignette) forms and
  // the view zooms out only as the scope lifts out of the dip into the search. Off: the lens forms `lensAt` seconds
  // after the star appears, before it sets off (TELESCOPE.search.lensSec to close; keep lensAt + lensSec under revealSec).
  // stayDown: after the dip the scope stays where it followed the star to and the search sets off from there (the
  // view only zooms out); off: it lifts back up to where the constellation was first.
  // Straight flight (2026-10-27; replaces the curved fall and the nod while on): the star flies in a straight line
  // through the sky to its net (`flySec`, eased in and out), the scope following it on the same curve, `camLag` s
  // behind, while the eyepiece closes into the search's round lens. The view streaks with the camera's motion (the same
  // filter as the way back to the roof): motionBlur = px per 1000 px of screen height at one screen height per second,
  // along the motion (0 = none); softBlur = an even softness at the flight's fastest (px per 1000 px).
  // arc (2026-10-28): one motion like a throw: the star flies up over an arch (topping out archDeg above the higher of
  // its spot and the view's middle), slowing towards the top, then falls faster and faster into its net, while the scope
  // turns to face the roof and dips after it. sec = the whole flight (+ secPerDeg for each degree the scope turns round,
  // at most maxSec); launch = the share of it spent speeding up as it sets off; side = degrees it swings out sideways
  // when its net lies (almost) straight below it; camLag = how long after the landing the scope settles; camTau = how
  // far the scope trails the star (seconds; it follows the star's own pace, never ahead of it).
  // centre (2026-10-30): on top of that the scope steers onto the star so it flies in the middle of the view (and the
  // net lands there): tau = how far the view trails it (s; 0 = right on it), easeIn = how long it takes to take over as it sets off (s).
  straight: { on: true, flySec: 1.4, camLag: 0.12, motionBlur: 0, softBlur: 0,   // blurs off (2026-10-28; were 10 and 1.5)
    centre: { on: true, tau: 0, easeIn: 0.5 },
    arc: { on: true, sec: 2.0, secPerDeg: 0.006, maxSec: 3.0, archDeg: 8, launch: 0.12, side: 10, camLag: 0.35, camTau: 0.08 } },
  nod: { on: true, fullStars: 1, lensOnRise: true, stayDown: true, lensAt: 0.35, dipDeg: 10, sec: 1.1, hold: 0.35, flySec: 1.0, spread: [-0.18, 0.18] },
  // A little zoom onto the star as it flies down (× the view; rig.js flyZoom), eased in over flyZoomSec, while the
  // eyepiece closes in to the search's round lens (when a search comes next); the search's own zoom takes over from it
  // (the same as TELESCOPE.search.lensZoom: no change of size as it does).
  flyZoom: 1.1, flyZoomSec: 1.4,
  trailEvery: 0.03, trailLife: 0.75, trailSize: 0.035,   // sparkle trail behind the flying star
  // Reveal FX around the star as it appears (classic): soft rings rippling out (size x revealSize, seconds
  // apart) and a swirl of glowing particles drifting out on a spiral (distance in screen heights).
  // Rings are supernova ripples: ringTrail = how far the light trails in behind the edge (fraction of the
  // radius), ringHue = hue shift along it (turns: + warmer edge, - cooler trail). ringStyle 'soft' = the
  // earlier soft ring instead (Dev sky -> Star reveal -> Ring button). ringBright = the whole ripple,
  // ringEdge = its edge alone (x), ringEdgeSoft = edge softness (x the designed width).
  revealFx: { ringStyle: 'nova', rings: 2, ringSize: 2.8, ringGap: 0.3, ringSec: 1.3, ringBright: 0.6, ringEdge: 1, ringEdgeSoft: 1, ringTrail: 0.4, ringHue: 0.08,
    sparkles: 14, sparkleDist: 0.3, sparkleSec: 1.6, sparkleSize: 0.04, swirl: 1.1 },
};
// Real constellations (shapes from the zodiac reference sheet), played in zodiac order from Aries. `stars` are [x, y, size] in reference-sheet pixels
// (y down); `scale` = degrees per reference pixel; `lines` joins stars by index. Each appears where the
// telescope points.
// `melody` = [star, beats] steps: `beats` is the gap until the next note (0.5 = quick pair, 2 = long
// note). A star may come back later in the melody. Without a melody: every star in order, one beat each.
const CONSTELLATIONS = [
  // The whole zodiac in its own order, from Aries. The difficulty grows gently along the cycle (cozy: a
  // wrong tap never resets, the next star always hints): first an even beat, then richer rhythms, then
  // longer melodies that come back to a star, and last melodies that jump around the shape, so the order
  // has to be remembered. After Pisces the cycle starts again at Aries (CONSTELLATION_PLAY.loopFrom).
  // 1–3 · Easy: every star once, in order along the shape; Gemini adds one long note.
  { id: 'aries', name: 'Aries', family: 'fire', scale: 0.095,
    stars: [[800, 113, 0.6], [885, 162, 1], [922, 193, 0.6], [918, 230, 0.8]],
    lines: [[0, 1], [1, 2], [2, 3]] },
  { id: 'taurus', name: 'Taurus', family: 'earth', scale: 0.085,   // simplified: the face and both horns (up to Elnath, across to ζ Tauri)
    frameShift: [-1.5, -2],
    stars: [[234, 456, 0.6], [191, 439, 0.9], [157, 414, 0.6], [103, 357, 1], [88, 424, 0.8]],   // arranged by Nadin's overpaint (2026-11-02)
    lines: [[0, 1], [1, 2], [2, 3], [2, 4]] },
  { id: 'gemini', name: 'Gemini', family: 'air', scale: 0.075,   // simplified: the two twins, joined at the shoulder
    frameShift: [-2, 3],
    stars: [[473, 406, 0.7], [387, 375, 0.7], [347, 364, 1], [320, 396, 1], [347, 415, 0.8], [439, 467, 1]],   // arranged by Nadin's overpaint (2026-11-02)
    lines: [[0, 1], [1, 2], [1, 4], [3, 4], [4, 5]],   // 4 = υ beside Pollux (3): the shoulders join there, Pollux's body runs down to 5
    melody: [[0, 1], [1, 1], [2, 2], [3, 1], [4, 1], [5, 1]] },
  // 4–5 · Rhythm: quick pairs, dotted notes, long holds.
  { id: 'cancer', name: 'Cancer', family: 'water', scale: 0.085,
    frameShift: [12, 10],   // its stars within the chart's circle, in sheet px (right, down): a lopsided shape looks centred by its weight, not its box
    stars: [[562, 350, 0.6], [620, 407, 1], [725, 432, 0.8], [625, 478, 0.6], [600, 381, 0.6]],   // 4 = Asellus Borealis, on the long arm
    lines: [[0, 4], [4, 1], [1, 2], [1, 3]],
    melody: [[0, 0.5], [4, 0.5], [1, 1.5], [2, 0.5], [3, 1]] },
  { id: 'leo', name: 'Leo', family: 'fire', scale: 0.08,
    stars: [[793, 467, 1], [822, 428, 0.6], [896, 405, 0.8], [914, 352, 0.6], [933, 361, 0.6], [930, 443, 1]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 0]],
    melody: [[0, 1], [1, 0.5], [2, 0.5], [3, 1], [4, 2], [5, 2]] },
  // 6–8 · Longer melodies (8–10 notes); Libra walks back over its beam, Scorpio over the fork in its head.
  { id: 'virgo', name: 'Virgo', family: 'earth', scale: 0.075,   // simplified: the body and one arm
    stars: [[81, 635, 1], [127, 631, 0.6], [156, 640, 0.6], [187, 615, 1], [206, 634, 0.6], [231, 626, 0.8], [172, 689, 0.9], [127, 691, 0.8]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [4, 6], [6, 7]],
    melody: [[0, 1], [1, 0.5], [2, 0.5], [3, 1.5], [4, 0.5], [5, 2], [6, 0.5], [7, 1]] },
  { id: 'libra', name: 'Libra', family: 'air', scale: 0.085,
    stars: [[450, 715, 0.6], [430, 695, 1], [340, 654, 0.8], [346, 583, 1], [417, 578, 0.7], [474, 632, 0.6]],   // redrawn 2026-10-20 (Nadin's sketch)
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 2], [4, 5]],
    melody: [[0, 0.5], [1, 0.5], [2, 1], [3, 1], [4, 0.5], [2, 1.5], [4, 0.5], [5, 2]] },
  { id: 'scorpio', name: 'Scorpio', family: 'water', scale: 0.075,   // simplified: the forked head (1 = δ, as in the sky), the tail
    frameShift: [-10, -12],
    stars: [[680, 577, 0.6], [695, 597, 0.7], [706, 617, 0.6], [650, 622, 0.6], [648, 665, 0.6], [645, 705, 0.8], [600, 715, 0.6], [562, 690, 0.6], [565, 625, 1]],   // head by Nadin's overpaint (2026-11-02), tail spread to fill the chart's circle
    lines: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]],
    melody: [[0, 0.5], [1, 0.5], [2, 0.5], [1, 1.5], [3, 0.5], [4, 0.5], [5, 1], [6, 0.5], [7, 0.5], [8, 2]] },
  // 9–12 · Memory, introduced very slowly; the rhythms stay as rich as Scorpio's. Sagittarius: round the
  // Teapot from handle to spout, with one star a step early (skip, then back). Capricorn: two of those. Aquarius: starts in the middle and walks
  // up the arm, then the stream in order. Pisces: down the cord, a jump to the fish, one skip-back in its ring,
  // and home to the knot.
  // Sagittarius as the Teapot (from real star positions, 2026-10-20): τ σ φ ζ handle and body, λ lid, δ ε γ spout, η below.
  { id: 'sagittarius', name: 'Sagittarius', family: 'fire', scale: 0.078,
    stars: [[762, 603, 0.6], [795, 586, 1], [822, 594, 0.6], [775, 632, 0.8], [872, 574, 0.8], [891, 631, 0.8], [882, 689, 1], [934, 638, 0.7], [901, 720, 0.7]],
    lines: [[7, 5], [5, 6], [6, 7], [5, 4], [4, 2], [2, 5], [2, 1], [1, 0], [0, 3], [3, 2], [3, 6], [6, 8]],
    melody: [[3, 0.5], [0, 0.5], [1, 1], [4, 0.5], [2, 0.5], [5, 1.5], [7, 0.5], [6, 1], [8, 2]] },   // the lid (4) a step early, then back to φ (2)
  { id: 'capricorn', name: 'Capricorn', family: 'earth', scale: 0.07,
    stars: [[80, 188, 1], [160, 170, 0.7], [245, 128, 1], [205, 214, 0.6], [187, 232, 0.9], [135, 216, 0.6]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]],
    melody: [[0, 1], [2, 0.5], [1, 1.5], [3, 0.5], [5, 0.5], [4, 1], [0, 2]] },
  { id: 'aquarius', name: 'Aquarius', family: 'air', scale: 0.07,   // from real star positions (2026-10-20): arm ε β α, jar ζ, body θ ι, stream λ δ 88
    stars: [[483, 171, 0.8], [434, 153, 1], [395, 129, 1], [369, 128, 0.7], [382, 163, 0.6], [342, 162, 0.8], [340, 200, 0.9], [323, 225, 0.8], [394, 191, 0.6]],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5], [5, 6], [6, 7], [4, 8]],
    melody: [[2, 1], [1, 0.5], [0, 1.5], [3, 1], [4, 0.5], [8, 0.5], [5, 1], [6, 0.5], [7, 2]] },
  { id: 'pisces', name: 'Pisces', family: 'water', scale: 0.07,   // simplified: the cord, the two fish
    stars: [[602, 116, 0.6], [586, 123, 0.8], [591, 174, 0.6], [563, 228, 1], [617, 200, 1], [672, 194, 0.6], [706, 187, 1], [722, 209, 1], [690, 219, 0.6]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 5]],
    melody: [[3, 1], [2, 0.5], [1, 0.5], [0, 1.5], [4, 1], [5, 0.5], [6, 0.5], [8, 0.5], [7, 1], [3, 2]] },
];

const NET_HALO_R = 145;                 // star light radius (glow look: Settings → Star glows)
const NET_ROPE_PATCH = 150;             // half-size of the poles patch redrawn over each star (ropes in front)

// Character walking: click the floor and the character walks there, around obstacles.
// `area` traces where the feet may go; `obstacles` are footprints of props standing on the floor.
// Both are polygons in composition pixels (same grid as CHAR_RECT).
const WALK = {
  speed: 520,                 // px per second across the screen, at the starting size
  depthStretch: 2.4,          // the floor is foreshortened: 1 px up the screen counts as this much walking
  horizonY: 990,              // perspective: size = (footY - horizonY) / (startFootY - horizonY)
  cell: 24,                   // pathfinding grid size in px
  hop: 0.018,                 // step bounce, as a fraction of the character's height
  sway: 0.035,                // side-to-side tilt while walking (radians)
  stepRate: 2.6,              // steps per second
  // The character is drawn over the props, so the back edge stays just in front of what stands behind it (iteration-5
  // art): the pole by the hut, the left front bed (front at 1665), the middle bed (1596), the greenhouse step and
  // its bed (1787). Left edge: clear of the ladder.
  area: [[540, 1740], [1230, 1740], [1250, 1770], [1800, 1770], [1820, 1705], [2660, 1705], [2720, 1755],
    [2800, 1835], [2960, 1855], [3000, 1890], [3800, 1890], [3880, 2040], [540, 2040]],
  obstacles: {
    hut: [[410, 1680], [1030, 1680], [1030, 1930], [740, 1975], [490, 1975], [410, 1940]],   // hut + crate in front
    pots: [[1580, 1730], [1780, 1730], [1780, 1815], [1580, 1815]],
    telescope: [[1810, 1805], [2120, 1805], [2140, 1905], [1790, 1905]],                   // tripod feet
    seedlings: [[2200, 1700], [2650, 1700], [2655, 1810], [2300, 1810], [2300, 1750], [2200, 1750]],   // pot, then box + trowel + can
  },
};

// Warm city glow (iteration-6): the streets below light the air softly orange, laid over the art (normal blend). Two
// sheets: `far` between the far and the near city (seen behind the near city's roofs), `near` just behind the rooftop
// (seen between the props and at the sides). Each is full below its `edge`, a wavy line through art px points (Nadin's
// sketch: green = far, pink = near), and fades out upwards from it: from fadeDown px below the line to fadeUp px above.
// The line slowly undulates (wave: art px up/down, waveSec per swell); drift = a soft unevenness along it (0 = even).
// Colour and strengths live in Settings → City glow. Measured from iteration-6.png against iteration-5: about #c8693c,
// 25 % behind the roof, 10–15 % behind the near city.
const CITY_GLOW = {
  far:  { depth: 55, order: 2.8, weight: 0.81, fadeUp: 300, fadeDown: 80,
    edge: [[0, 991], [456, 982], [521, 1021], [620, 1155], [718, 1100], [850, 1034], [1178, 795], [1507, 654], [1671, 614], [1802, 631], [1901, 713], [2000, 791], [2131, 791], [2295, 746], [2427, 746], [2558, 795], [2624, 909], [2722, 995], [2886, 1073], [3445, 1041], [4160, 1008]] },
  near: { depth: 18, order: 4.5, weight: 0.57, fadeUp: 340, fadeDown: 100,
    edge: [[0, 1762], [324, 1604], [456, 1558], [620, 1598], [817, 1712], [1047, 1631], [1244, 1385], [1375, 1499], [1638, 1516], [1967, 1480], [2295, 1480], [2492, 1401], [2689, 1322], [2821, 1362], [2952, 1467], [3116, 1516], [3281, 1532], [3445, 1558], [3642, 1565], [3773, 1532], [3872, 1581], [4160, 1729]] },
  wave: 18, waveSec: 14, drift: 0.3,
};

// Ambient FX (ambient.js): subtle, soft atmosphere in the sky, over the city and on the roof.
// Positions, rects and sizes are composition pixels (ART_W x ART_H). How strong each effect is (0 = off) is a
// Settings slider (Settings → Ambient FX); the fireflies have their own section (Settings → Fireflies).
// The moon (sky_moon.png, its own image since iteration-8): drawn into the sky texture at load with its disc's centre
// (`centre`, px of sky_moon.webp) on AMBIENT.moon, at `scale` × its size.
const SKY_MOON = { image: 'sky_moon', centre: [824, 818], scale: 1 };
const AMBIENT = {
  moon: [3006, 296],            // centre of the moon disc (sky_moon.png, drawn into the sky at load: SKY_MOON)
  // Sky
  // Look values below (tint … glow, every, ringAmt …) are live in the Dev sky panel.
  // Off since the twinkle stars (SKY_LOOK.stars.twinkles) took over: count was 16, upperCount 10.
  glints: { count: 0, upperCount: 0, size: [34, 60], period: [7, 16], flash: 1.1, colors: ['#ffe2a6', '#fff4dc', '#cfe2ff'],
    tint: '#ffe2a6', tintAmt: 0,      // blend every glint towards tint (0 = each keeps its own color)
    sizeMul: 1, glow: 0.55, every: 1,   // every: × the gap between flashes
    width: 0.6, thickness: 1, bend: 0.03 },   // shape: side rays vs. top/bottom rays, ray thickness, ray bow (+ fuller, - pinched)
  moonHalo: { radius: 420, ring: 0.72, color: '#bcd2ff', ringColor: '#ffe9c4', breathe: 9,   // breathe: seconds per breath
    glowAmt: 0.32, glowSize: 1, ringAmt: 0.06 },   // inner glow strength / reach, ring strength
  wisps: { color: '#d9d4ff', top: -0.19, bottom: 0.5, speed: 0.014, stretch: 7,             // top/bottom: frame rows they occupy (< 0 = above the painted sky)
    topFade: 0.35,       // rows over which they thin out towards the top
    above: 0.5,          // how far their plane reaches above the painted sky (sky heights; seen from the telescope)
    morph: 0.35,         // share of a second, counter-drifting layer that slowly reshapes the streaks (0 = they only slide)
    color2: '#d9d4ff',   // color of the denser cores (= color: one tone)
    blend: 'normal',     // 'normal' (laid over) | 'additive' (adds light) | 'screen' (soft lighten) | 'glow' (keeps the hue, still glows)
    opacity: 0.2 },
  // Sparks shed behind shooting stars: a dotted trail that widens slowly. spread = sideways drift (sky widths / s).
  stardust: { max: 1600, rate: 300, life: [0.8, 1.8], size: [12, 22], curl: 0, spread: 0.03,
    tint: '#ffe2a6', tintAmt: 0, sizeMul: 1, glow: 0.4,   // tint 0 = the shooting star's own color
    lifeMul: 1 },                     // trail length: × how long each spark lives (and so how far it drifts)
  // City
  steam: { chimneys: [[2215, 700], [2122, 745], [3400, 862], [3289, 888], [2725, 1112]],     // city1 chimney tops
    puffs: 5, rise: 260, drift: 90, size: [40, 170], life: [9, 14], color: '#b3c4ee', opacity: 0.35 },
  // Rooftop
  // Fireflies, after Art/Ingame_Background/FX (Reka): a tiny white-hot body in a thin warm ember rim and a faint wide
  // halo, darting about in quick little curves and loops, mostly lit with a faint flicker, spread through the depth
  // (far ones over the city are pinpricks). color = the rim + halo (Settings → Fireflies → Color); hueSpread ± per fly.
  fireflies: { color: '#ff8a45', hueSpread: 0.025,
    size: [120, 190], wander: 70,      // sprite size (art px, glow included), slow drift distance (art px)
    dart: 28, dartRate: 1.0,          // darting: how far (art px) and how often (direction changes per second)
    loop: 7,                          // small fast loops on top (art px)
    rim: 2.6,                         // ember glow around the body: radius × the body's (Settings → Fireflies → Glow size)
    rimSoft: 0.67,                    // its edge: 0 = crisp … 1 = long soft fade (Settings → Fireflies → Glow softness)
    flicker: 0.12,                    // quick brightness flicker (0 = steady)
    light: { radius: 70, strength: 3.2 },    // their warm light on the roof art right around them: reach (art px), strength
    blink: [8, 16],   // seconds per glow cycle: mostly lit, a short dim rest now and then
    core: 0.035,      // radius of the white-hot body, as a fraction of the glow sprite
    groups: [   // rect = [x0, y0, x1, y1]; depth = plane distance (rooftop 12, fog 20); sizeMul shrinks far ones
      { count: 14, depth: 12.3, rect: [860, 1040, 2860, 1740] },          // around the planters
      { count: 5, depth: 12.1, rect: [2460, 1090, 3460, 1690] },         // by the greenhouse
      { count: 9, depth: 15, rect: [0, 840, 4160, 1440], sizeMul: 0.6 },    // just beyond the parapet
      { count: 11, depth: 24, rect: [0, 690, 4160, 1390], sizeMul: 0.35 },   // far, over the city: pinpricks
      // (soft: 1 = out of focus: no body, a wide soft glow; the close-to-camera group was removed at Nadin's request)
    ] },
};

export { WIND, VIEW_W, VIEW_H, ROOM_W, ROOM_H, SKY_MOON, FIRST_TIME, SKY_DOME, SKY_PARALLAX, CONSTELLATION_TIER, SKY_TRIP_TIERS, CHAR_SHADOW, AMBIENT, GLOW_PROP_MIN_AREA, SKY_LOOK, STAR_CHART, STAR_FAMILIES, NETS, NET_CHARMS, NET_STAR, STAR_DELIVERY, COLLECT, CONSTELLATION_STYLE, CONSTELLATION_PLAY, MUSIC, CITY_SOUND, CONSTELLATIONS, ART_W, ART_H, ART_ASPECT, SHADOWS, LAYER_ART, MIDGROUND_PROPS, MIDGROUND_SPREAD, FIT_FOV, OVERSCAN, DEPTH, PIVOT_DIST, MAX_YAW, MAX_PITCH, ORBIT_SENS, ORBIT_DAMP, SHAKE_YAW, SHAKE_PITCH, SHAKE_ROLL, SHAKE_FREQ, SHAKE_SPEED, FOLLOW, settings, PAN_Y_RATIO, PAN_SENS, PAN_WEIGHT, MAX_ZOOM, ZOOM_SENS, DOLLY_MAX, DOLLY_SENS, CRANE_RISE, CRANE_REF_TILT, CRANE_DURATION, BTS_DURATION, BTS_CARD_W, BTS_STEP, BTS_CENTER, BTS_YAW, BTS_PITCH, BTS_RADIUS, BTS_LOOK_OFFSET, BTS_DEMO, BTS_CARD_COUNT, BTS_EXTRA_GAP, LAYER_PARALLAX, GLOW_SPREAD, GLOW_FLOOR_Y, GLOW_SCAN_W, RISE_DURATION, RISE_START, LOADER_FADE_MS, RISE_FADE_HEIGHT, CHAR_RECT, CHAR_FOOT_PAD, CHAR_WALK, CHAR_CHEER, CHAR_LEAVES, CHAR_LEAF_FLICK, ANCHORS, SKY_FIELD, ANCHOR_COLOR, NET_HALO_R, NET_ROPE_PATCH, WALK, DEPTH_SORTED, TELESCOPE, GREENHOUSE, STAR_BOOK, PLANTS, ROOF_GARDEN, CITY_GLOW };
