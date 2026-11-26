// Star chart: a vintage celestial atlas over the sky around the constellation (ported from the night sky sketch,
// sketches/night-sky-ornaments.html, "Look: Star chart"). Thin ivory filigree: overlapping circle systems with
// graduated rings, dotted rings, spokes and roundels, a framing circle fitted around the constellation, markers
// where circles cross. It draws itself in (the framing ring sweeps around, then the map spreads to the screen
// edges), its circles turn very slowly, and it fades before the rooftops.
// The Star chart button (in the sky) switches between this screen and the plain night sky; the choice is kept.
// Two parts, both built in the world around the camera and attached to the sky layer, so they move with the sky:
// the map (buildMap), one continuous atlas over the whole sky, its circle systems packed evenly so no stretch of it is
// empty, tied together by a celestial grid; and the framing circle around the current constellation (buildFrame), with a
// soft quiet hole in the map around it (a shader mask, so the map itself never needs cutting or rebuilding). It draws
// itself in only once per look-up (constellation.js → buildStarChart); between constellations the telescope searches
// on across the same map (searchStarChart: the next framing circle and its hole fade in where the scope will point,
// the last one fades out; once in place the circle eases onto the new constellation, fitChartFrame).
// Layout in STAR_CHART (config.js), look in STAR_CHART.look (Dev chart panel, bound in ui.js).
import * as THREE from 'three';
import { STAR_CHART } from './config.js';
import { lensEase, zoomT } from './scopeSearch.js';
import { camera, renderer } from './core.js';
import { focusNdc } from './rig.js';
import { layerAttach, layers } from './layers.js';
import { getPref, setPref } from './settingsStore.js';

const V3 = THREE.Vector3, TAU = Math.PI * 2, L = STAR_CHART.look;
const SKETCH_TAN = Math.tan(THREE.MathUtils.degToRad(55 / 2));   // the sketch's view: the layout is in its screen units
const PXW = 0.0012;                                              // world width of 1 px per unit of distance in the sketch's view

// Colors are written straight to the screen by these shaders, so they're stored as they look (no linear conversion).
const raw = hex => new THREE.Color().setStyle(hex, THREE.LinearSRGBColorSpace);
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Shared uniforms: the panel changes these live (setChartLook); the rest are set when the chart is built.
const U = {
  uColor: { value: raw(L.color) }, uLook: { value: L.opacity }, uWidth: { value: L.width },
  uGlow: { value: L.glow }, uGlowSize: { value: L.glowSize }, uGlowSoft: { value: L.glowSoft }, uGlowColor: { value: raw(L.glowColor) },
  uHue: { value: THREE.MathUtils.degToRad(L.hue) }, uHueScale: { value: L.hueScale }, uHueSat: { value: L.hueSat },
  uTintAmt: { value: L.tint }, uTintFade: { value: L.tintFade },
  uBreaks: { value: L.breaks }, uBreakW: { value: L.breakWidth }, uBreakFade: { value: L.breakFade }, uDotBreaks: { value: L.dotBreaks },
  uDash: { value: STAR_CHART.dash }, uFadeEl: { value: new THREE.Vector2(L.fadeLow, L.fadeHigh) }, uHorizonEl: { value: new THREE.Vector2(L.horizonLow, L.horizonHigh) },
  uPx: { value: 1 },                                             // drawing-buffer height / 1000, for the dots
  uBrush: { value: 0 }, uBrushWidth: { value: L.brushWidth }, uBrushGrain: { value: L.brushGrain },   // brush strokes (on / off, look)
  uBrushRag: { value: L.brushRag }, uBrushDry: { value: L.brushDry }, uBrushStroke: { value: L.brushStroke }, uBrushBreaks: { value: L.brushBreaks },
  uClear: { value: STAR_CHART.frame.clear }, uGridNear: { value: STAR_CHART.frame.gridNear },                   // map systems stay this clear of a framing circle (× its radius)
  uZoom: { value: 1 }, uZoomDir: { value: new THREE.Vector3(0, 0, -1) }, uZoomEye: { value: new THREE.Vector3() },   // the lens zoom (ZOOM_GLSL)
  uPulse: { value: -1 }, uPulseStr: { value: L.pulse }, uPulseSat: { value: L.pulseSat },     // the highlight wave (pulseChart): progress,
  uPulseReach: { value: L.pulseReach }, uPulseWidth: { value: L.pulseWidth },                  // look of the set playing
};
// Each chart's own uniforms (an old one can fade out while the next one fades in).
const localUniforms = () => ({
  uShow: { value: 0 }, uReveal: { value: 0 },                    // fade in / out, and the draw-in (0 … 1)
  uFrameDir: { value: new V3(0, 0, -1) }, uFrameAng: { value: 0 }, uFrameX: { value: new V3(1, 0, 0) }, uFrameY: { value: new V3(0, 1, 0) },
  uRootInv: { value: new THREE.Matrix4() },                      // world → the chart's root (camera at build time, world axes)
  uTint: { value: new THREE.Color() }, uTintW: { value: 1 },
  // the map's quiet holes (fading lines out around a framing circle): the current one (uFrameDir / uFrameAng × uQuiet,
  // strength uHoleW) and, during a search, the last one (uHole2…); a framing circle's own lines have none
  uHoleW: { value: 0 }, uQuiet: { value: 1 },
  uHole2W: { value: 0 }, uHole2Dir: { value: new V3(0, 0, -1) }, uHole2Ang: { value: 0 }, uQuiet2: { value: 1 }, uTint2: { value: new THREE.Color() }, uTint2W: { value: 1 },
  // and, while searching by hand, the waiting constellations' circles (chart.spots, up to 4): (direction, angle), (strength, quiet)
  uSpotHole: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -1, 0)) }, uSpotWQ: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(0, 1)) },
});

// ---------- shaders (as in the sketch; directions are from the camera where the chart was built) ----------
// Hue shift: the ink's hue drifts smoothly across the sky (a low-frequency field of the direction, so neighbouring
// lines share a tint). Frame tint: around the framing circle the ink takes the constellation's color, fading back
// into the chart's own further out. Reveal, in two movements that flow into each other: first the framing ring
// draws itself around the constellation (from the left, over the top, round to the bottom), then the rest of the
// map spreads outwards from it. Returns (shown, front glow) at progress r (0 … 1).
const HUE_GLSL = `uniform vec2 uFadeEl, uHorizonEl; varying float vSysFade;
  // the fade above the rooftops: along a grid line or the framing circle (vSysFade < 0), else the whole circle system's
  // fade by its centre's height (SYS_GLSL) with only the horizon haze along its lines
  float elFade(float el){ return vSysFade < 0.0 ? smoothstep(uFadeEl.x, uFadeEl.y, el) : vSysFade * smoothstep(uHorizonEl.x, uHorizonEl.y, el); }
  uniform float uHue, uHueScale, uHueSat, uShow, uTintAmt, uTintFade, uFrameAng, uTintW, uHoleW, uQuiet, uHole2W, uHole2Ang, uQuiet2, uTint2W;
  uniform vec3 uTint, uFrameDir, uFrameX, uFrameY, uHole2Dir, uTint2;
  uniform vec4 uSpotHole[4]; uniform vec2 uSpotWQ[4];
  uniform float uPulse, uPulseStr, uPulseSat, uPulseReach, uPulseWidth;
  float angTo(vec3 dir, vec3 c){ return acos(clamp(dot(dir, c), -1.0, 1.0)); }
  // the quiet holes: the map's lines fade out softly inside the framing circle
  float holeMask(vec3 dir){
    float m = 1.0;
    if (uHoleW > 0.0) m *= 1.0 - uHoleW * (1.0 - smoothstep(uFrameAng * uQuiet * 0.85, uFrameAng * uQuiet, angTo(dir, uFrameDir)));
    if (uHole2W > 0.0) m *= 1.0 - uHole2W * (1.0 - smoothstep(uHole2Ang * uQuiet2 * 0.85, uHole2Ang * uQuiet2, angTo(dir, uHole2Dir)));
    for (int i = 0; i < 4; i++) if (uSpotWQ[i].x > 0.0) {
      float a = uSpotHole[i].w * uSpotWQ[i].y;
      m *= 1.0 - uSpotWQ[i].x * (1.0 - smoothstep(a * 0.85, a, angTo(dir, uSpotHole[i].xyz)));
    }
    return m;
  }
  vec2 radialReveal(vec3 dir, float r){
    if (r >= 1.0) return vec2(1.0, 0.0);   // drawn in: everywhere, however far the map reaches
    float ang = acos(clamp(dot(dir, uFrameDir), -1.0, 1.0)), R = uFrameAng;
    float q = fract((3.14159265 - atan(dot(dir, uFrameY), dot(dir, uFrameX))) / 6.2831853);   // along the ring, clockwise from the left
    float p1 = clamp(r / 0.4, 0.0, 1.0) * 1.15;
    float ring = 1.0 - smoothstep(p1 - 0.18, p1, q);
    // where the sweep starts (q = 0) it meets its own end (q = 1): fade the start in, and let it fill in as the sweep
    // closes the circle, so there's no hard seam
    ring *= mix(smoothstep(0.0, 0.14, q), 1.0, smoothstep(0.85, 1.15, p1));
    float p2 = clamp((r - 0.25) / 0.75, 0.0, 1.0), front = R * 1.25 + p2 * 1.6, soft = 0.45;   // a wide, soft front past the screen edges
    float out_ = 1.0 - smoothstep(front - soft, front, ang);
    float nearRing = 1.0 - smoothstep(R * 1.3, R * 1.55, ang);   // the ring and its close rings follow the sweep, the rest the spread
    float shown = mix(out_, ring, nearRing) * smoothstep(0.0, 0.3, r);   // and the whole chart fades in gently
    float glow = mix(exp(-pow((ang - front + soft * 0.4) / (soft * 0.3), 2.0)) * smoothstep(0.0, 0.15, p2) * (1.0 - smoothstep(0.8, 1.0, p2)),
                     exp(-pow((q - p1 + 0.06) / 0.05, 2.0)) * smoothstep(0.0, 0.2, p1) * (1.0 - smoothstep(0.95, 1.12, p1)), nearRing);   // the bright tips fade in and out
    return vec2(shown * shown * (3.0 - 2.0 * shown), glow);   // eased, so lines fade in rather than switch on
  }
  // In rhythm with the sky: a wave of brighter, richer frame tint runs out from the circle's centre and fades as it
  // goes (uPulse = progress 0 … 1, < 0 = off; distances in framing-circle radii).
  float pulseW(vec3 dir){
    if (uPulse < 0.0 || uPulse >= 1.0 || uFrameAng <= 0.0) return 0.0;
    float a = angTo(dir, uFrameDir) / uFrameAng;
    float front = (1.0 - (1.0 - uPulse) * (1.0 - uPulse)) * uPulseReach;   // quick off the mark, slowing as it spreads
    float wave = exp(-pow((a - front) / uPulseWidth, 2.0));
    float trail = a < front ? 0.35 * exp(-(front - a) / (uPulseWidth * 2.5)) : 0.0;   // a soft afterglow behind the front
    return clamp((wave + trail) * smoothstep(0.0, 0.08, uPulse) * pow(1.0 - uPulse, 1.5) * uTintW, 0.0, 1.0);
  }
  // Color: the constellation's own, pushed towards its pure hue (darkest channel to 0) so the added light stays
  // colored instead of washing to white. Brightness: the lines' opacity × pulseBoost (colors can't go above 1).
  vec3 pulseTint(vec3 c, vec3 dir){
    float w = pulseW(dir);
    if (w <= 0.0) return c;
    float mx = max(max(uTint.r, uTint.g), uTint.b), mn = min(min(uTint.r, uTint.g), uTint.b);
    vec3 rich = mix(uTint / max(mx, 1e-3), (uTint - mn) / max(mx - mn, 1e-3), clamp(uPulseSat, 0.0, 1.0));
    return mix(c, rich, w);
  }
  float pulseBoost(vec3 dir){ return 1.0 + pulseW(dir) * uPulseStr; }
  vec3 frameTint(vec3 c, vec3 dir){
    if (uTintAmt <= 0.0) return pulseTint(c, dir);
    // full on the frame, fading outwards (and around the last frame while it fades during a search)
    float k = uTintW * (1.0 - smoothstep(uFrameAng * 1.08, uFrameAng * (1.12 + 2.5 * uTintFade), angTo(dir, uFrameDir)));
    float k2 = uHole2W * (1.0 - smoothstep(uHole2Ang * 1.08, uHole2Ang * (1.12 + 2.5 * uTintFade), angTo(dir, uHole2Dir)));
    return pulseTint(mix(mix(c, uTint, k * uTintAmt), uTint2, k2 * uTint2W * uTintAmt), dir);
  }
  vec3 hueShift(vec3 c, vec3 dir){
    if (uHue <= 0.0) return c;
    vec3 q = dir * 3.0 * uHueScale;
    float f = (sin(q.x * 1.0 + 1.3) * sin(q.y * 1.37 + 0.7) + sin(q.z * 0.83 + q.x * 0.4 + 2.1)) / 2.0;   // -1 … 1
    float a = f * uHue, ca = cos(a); const vec3 k = vec3(0.57735);
    vec3 r = max(c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca), 0.0);   // rotate the color around the grey axis
    float l = dot(r, vec3(0.299, 0.587, 0.114));
    return max(mix(vec3(l), r, 1.0 + uHueSat * abs(f)), 0.0);   // richer shifted tints, so pale ink shows them too
  }`;
// The telescope's lens zoom on the chart (chart.zoom): the whole chart magnified about the scope's aim (uZoomDir,
// from the camera at uZoomEye) as a lens would (on screen: scaled about that point), its lines keeping their width.
// Everything else (masks, tint, reveal) works on the chart as built, so it zooms along.
const ZOOM_GLSL = `uniform float uZoom; uniform vec3 uZoomDir, uZoomEye;
  vec3 zoomed(vec3 w){
    if (abs(uZoom - 1.0) < 1e-4) return w;
    vec3 r = w - uZoomEye; float len = length(r); vec3 d = r / len;
    float c = clamp(dot(d, uZoomDir), -1.0, 1.0), th = acos(c);
    if (th < 1e-4 || th > 1.45) return w;   // (beyond that it's far off screen)
    vec3 side = normalize(d - uZoomDir * c);
    float th2 = atan(uZoom * tan(th));
    return uZoomEye + (uZoomDir * cos(th2) + side * sin(th2)) * len;
  }`;
// A map system near a framing circle fades as a whole (aSys = its centre direction from the root and its angular
// radius; w < 0 = not a system: grid lines, the framing circle itself), so it's never cut into loose pieces next to
// the frame: whatever reaches within uClear × the circle's radius goes. Grid lines show only along their stretches
// (aVis), but always near a framing circle (within uGridNear × its radius), so a line running into the circle visibly
// runs on out of its other side.
const SYS_GLSL = `attribute vec4 aSys; attribute float aVis; uniform vec3 uFrameDir, uHole2Dir; uniform float uFrameAng, uHoleW, uHole2Ang, uHole2W, uClear, uGridNear;
  uniform vec4 uSpotHole[4]; uniform vec2 uSpotWQ[4]; uniform vec2 uFadeEl;
  varying float vSysK, vSysFade;
  // a circle system fades as a whole by its centre's height above the horizon (-1 = not a system: fades along its length)
  float sysFade(){ return aSys.w < 0.0 ? -1.0 : smoothstep(uFadeEl.x, uFadeEl.y, degrees(asin(clamp(aSys.y, -1.0, 1.0)))); }
  float near(vec3 dir, vec3 c, float R, float w){
    return w * (1.0 - smoothstep(R * uGridNear, R * uGridNear * 1.6, acos(clamp(dot(dir, c), -1.0, 1.0))));
  }
  float gridVis(vec3 dir){
    if (aVis >= 1.0) return 1.0;
    float v = max(aVis, max(near(dir, uFrameDir, uFrameAng, uHoleW), near(dir, uHole2Dir, uHole2Ang, uHole2W)));
    for (int i = 0; i < 4; i++) v = max(v, near(dir, uSpotHole[i].xyz, uSpotHole[i].w, uSpotWQ[i].x));
    return v;
  }
  float sysAway(vec3 c, float R, float w){
    float gap = acos(clamp(dot(aSys.xyz, c), -1.0, 1.0)) - aSys.w - R * uClear;
    return 1.0 - w * (1.0 - smoothstep(0.0, 0.08, gap));
  }
  float sysK(){
    if (aSys.w < 0.0) return 1.0;
    float k = 1.0;
    if (uHoleW > 0.0) k *= sysAway(uFrameDir, uFrameAng, uHoleW);
    if (uHole2W > 0.0) k *= sysAway(uHole2Dir, uHole2Ang, uHole2W);
    for (int i = 0; i < 4; i++) if (uSpotWQ[i].x > 0.0) k *= sysAway(uSpotHole[i].xyz, uSpotHole[i].w, uSpotWQ[i].x);
    return k;
  }`;
// Lines: camera-facing ribbons (position = centre line, aOff = half width), soft-edged; the glow pass draws them
// again uGlowSize× as wide, faint and soft.
const LINE_VS = ZOOM_GLSL + SYS_GLSL + `attribute float aSide, aT, aA, aL; attribute vec3 aOff; uniform float uWidth, uGlowPass, uGlowSize, uBrush, uBrushWidth; uniform mat4 uRootInv;
  varying float vSide, vT, vA, vL, vEl, vHW; varying vec3 vDir;
  void main(){ vSide = aSide; vT = aT; vA = aA; vL = aL;
    vec3 off = aOff * uWidth * mix(mix(1.0, uBrushWidth, uBrush), uGlowSize, uGlowPass); vHW = length(off);
    vec4 wc = modelMatrix * vec4(position, 1.0); vec3 wo = mat3(modelMatrix) * off;
    vDir = normalize((uRootInv * vec4(wc.xyz + wo, 1.0)).xyz); vSysK = sysK() * gridVis(vDir); vSysFade = sysFade();
    vEl = degrees(asin(vDir.y));   // elevation above the horizon, for the fade before the city
    gl_Position = projectionMatrix * viewMatrix * vec4(zoomed(wc.xyz) + wo, 1.0); }`;
const LINE_FS = HUE_GLSL + `varying vec3 vDir; varying float vSysK; uniform vec3 uColor, uGlowColor; uniform float uOpacity, uLook, uReveal, uBreaks, uBreakW, uBreakFade, uDash, uDotBreaks, uGlowPass, uGlow, uGlowSoft;
  uniform float uBrush, uBrushWidth, uBrushGrain, uBrushRag, uBrushDry, uBrushStroke, uBrushBreaks;
  varying float vSide, vT, vA, vL, vEl, vHW;
  float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
  float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + 1.0), f.x), f.y); }
  // Brush stroke (main pass only): the line is painted in strokes about uBrushStroke widths long, each starting from
  // a pointed tip with full paint and running dry towards its end; bristle streaks along it, ragged edges. The
  // pattern sits on the line (its length and side), so it never moves on its own. Returns (coverage, paint brightness).
  // The texture is measured in the line's width at the default Brush width (3.2), so a wider brush paints the same
  // bristles and edges, only more of them side by side (sideW = the side in those units), instead of stretching them.
  vec2 brush(float side){
    float k = max(uBrushWidth / 3.2, 0.2), W = max(vHW * 2.0 / k, 1e-4), a = vL / W, sl = uBrushStroke, sideW = side * k;
    float ci = floor(a / sl), fu = fract(a / sl), sd = h1(ci * 1.37 + 9.0);   // which stroke, how far along it, its seed
    float sideK = step(0.0, side);
    float edgeN = n1(a * 0.6 + sideK * 37.0 + ci * 11.0) * 0.5 + n1(a * 3.0 + sideK * 19.0) * 0.5;
    float e = 1.0 - uBrushRag * 0.6 * edgeN;                                                  // ragged edges, each side its own
    e *= mix(0.45, 1.0, smoothstep(0.0, 0.1, fu)) * mix(1.0, 0.75, smoothstep(0.6, 1.0, fu)); // pointed start, thinner as it runs dry
    float cover = 1.0 - smoothstep(e * (1.0 - 0.2 / max(k, 0.25)), e, abs(side));   // the soft edge keeps its size
    float bristle = n2(vec2(sideW * 4.0 + sd * 40.0, a * 0.05)), fine = n2(vec2(sideW * 9.0 + 7.0, a * 0.9)), fleck = n2(vec2(sideW * 6.0 + 3.0, a * 2.2));
    float streak = mix(1.0, 0.15 + 1.1 * bristle, uBrushGrain) * mix(1.0, 0.45 + 0.8 * fine, uBrushGrain);
    // paint runs out along the stroke: short dry flecks (about a line width long, never a long gap), more towards its end
    float dry = uBrushDry * 0.7 * (0.3 + 0.7 * smoothstep(0.3, 1.0, fu));
    cover *= smoothstep(dry - 0.08, dry + 0.08, fleck * 0.45 + fine * 0.4 + bristle * 0.15);
    return vec2(cover * streak, 0.85 + 0.4 * bristle);
  }
  void main(){ float prof = 1.0 - smoothstep(0.15, 1.0, abs(vSide)), paint = 1.0;
    if (uBrush > 0.0 && uGlowPass < 0.5) { vec2 br = brush(vSide); prof = mix(prof, br.x, uBrush); paint = mix(1.0, br.y, uBrush); }
    prof = mix(prof, exp(-vSide * vSide * mix(9.0, 1.5, uGlowSoft)) * (1.0 - smoothstep(0.85, 1.0, abs(vSide))), uGlowPass);   // glow: soft falloff
    // soft breaks: each stretch of 2 dash units gets at most one soft gap (uBreaks = how many), with slow fading
    float piece = 1.0, bk = max(mix(1.0, uBrushBreaks, uBrush), 0.02);   // the brush has gaps of its own: shorter breaks with it
    if (uBreaks > 0.0) {
      float S = uDash * 2.0, cell = floor(vL / S), u = fract(vL / S) * S;
      float has = step(h1(cell * 3.17 + 1.0), uBreaks);
      float c = S * (0.2 + 0.6 * h1(cell * 5.31 + 2.0)), hw = uDash * uBreakW * 0.5 * bk * (0.6 + 0.8 * h1(cell * 7.13 + 3.0));
      float fine = 1.0 - has * (1.0 - smoothstep(hw * (1.0 - 0.8 * uBreakFade), hw + uDash * (0.05 + 1.4 * uBreakFade) * bk, abs(u - c)));
      float coarse = smoothstep(mix(-0.2, 0.3, uBreaks), mix(-0.2, 0.3, uBreaks) + 0.15, n1(vL / (uDash * 3.1) + 41.0));
      float shade = mix(0.35 + 0.65 * n1(vL / (uDash * 4.7) + 17.0), 1.0, uBrush * 0.6);
      piece = fine * coarse * shade;
    }
    // dot breaks: now and then the line pauses with a short gap and a tiny bright dot floating in its middle (— • —)
    if (uDotBreaks > 0.0) {
      float every = uDash * 18.0 / max(1.0, uDotBreaks), cell = floor(vL / every), d = abs(fract(vL / every) - 0.5) * every;
      if (h1(cell * 1.731 + 5.0) < uDotBreaks) {
        float dotLen = uDash * 0.16, gapLen = uDash * 0.7 * bk;
        float dot = 1.35 * (1.0 - smoothstep(dotLen * 0.25, dotLen * 1.6, d));
        float line = piece * smoothstep(gapLen * (1.0 - 0.6 * uBreakFade), gapLen + uDash * (0.25 + 1.0 * uBreakFade), d);
        piece = max(dot, line);
      }
    }
    piece *= elFade(vEl);   // soft fade above the rooftops, like the shooting stars
    vec2 rr = radialReveal(vDir, uReveal); float shown = rr.x, tip = rr.y * 0.5;
    gl_FragColor = vec4(mix(frameTint(hueShift(mix(uColor, uGlowColor, uGlowPass), vDir), vDir) * paint, vec3(1.0), tip * 0.6),
      (vA * shown * piece + tip * 0.9) * prof * uOpacity * uLook * uShow * holeMask(vDir) * vSysK * mix(1.0, uGlow * 0.2, uGlowPass) * pulseBoost(vDir)); }`;
const DOT_VS = ZOOM_GLSL + SYS_GLSL + `attribute float aSize, aT, aA; uniform float uPx, uWidth; uniform mat4 uRootInv; varying float vT, vA, vEl; varying vec3 vDir;
  void main(){ vT = aT; vA = aA; vec4 wc = modelMatrix * vec4(position, 1.0);
    vDir = normalize((uRootInv * wc).xyz); vSysK = sysK() * gridVis(vDir); vSysFade = sysFade(); vEl = degrees(asin(vDir.y));
    gl_PointSize = aSize * uPx * uWidth; gl_Position = projectionMatrix * viewMatrix * vec4(zoomed(wc.xyz), 1.0); }`;
const DOT_FS = HUE_GLSL + `varying float vSysK; uniform vec3 uColor; uniform float uOpacity, uLook, uReveal; varying float vT, vA, vEl; varying vec3 vDir;
  void main(){ float r = length(gl_PointCoord * 2.0 - 1.0), shown = radialReveal(vDir, uReveal).x;
    gl_FragColor = vec4(frameTint(hueShift(uColor, vDir), vDir), (1.0 - smoothstep(0.35, 1.0, r)) * vA * shown * uOpacity * uLook * uShow * holeMask(vDir) * vSysK * elFade(vEl) * pulseBoost(vDir)); }`;

// Blend modes (look.blend / look.glowBlend): 'additive' adds light (brightens towards white), 'screen' lightens more
// softly, 'normal' lays the ink over the sky (keeps its color, can also darken).
const mats = [];
function setBlend(m) {
  const mode = m.userData.glow ? L.glowBlend : L.blend;
  m.blending = mode === 'normal' ? THREE.NormalBlending : mode === 'screen' ? THREE.CustomBlending : THREE.AdditiveBlending;
  if (mode === 'screen') Object.assign(m, { blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcColorFactor });
  m.needsUpdate = true;
}

const NO_SYS = [0, 0, -1, -1];
// A Batch draws 2D lines and dots in the local xy plane of an Object3D; ribbons face the viewer (world position).
let pxw = PXW;   // set per build: line widths keep their size on screen in the game's view
class Batch {
  constructor(obj, viewer, inst) {
    this.obj = obj; this.inst = inst; obj.updateMatrixWorld(true);
    this.viewer = viewer; this.o = obj.worldToLocal(viewer.clone()); this.rng = mulberry(7);
    this.P = []; this.O = []; this.L = []; this.S = []; this.T = []; this.A = []; this.I = []; this.dP = []; this.dS = []; this.dT = []; this.dA = [];
    this.sys = NO_SYS; this.Y = []; this.dY = [];   // the map system the next lines / dots belong to (SYS_GLSL)
    this.vis = 1; this.V = []; this.dV = [];         // shown (1), or a grid line's visibility (poly: vis = one per point)
  }
  poly(pts, { w = 1.2, t0 = 0, t1 = 1, fade = 0, alpha = 1, wob = 0, vis = null } = {}) {
    const P = pts.map(p => p.clone()), n = P.length; if (n < 2) return;
    const Ls = [0]; for (let i = 1; i < n; i++) Ls[i] = Ls[i - 1] + P[i].distanceTo(P[i - 1]);
    const tot = Ls[n - 1] || 1, k1 = 2 + this.rng() * 4, k2 = 5 + this.rng() * 7, ph = this.rng() * TAU;
    const base = this.P.length / 3, T = new V3(), V = new V3(), S = new V3(), W = new V3(), off = (base * 7.31) % 997;
    for (let i = 0; i < n; i++) {
      T.subVectors(P[Math.min(i + 1, n - 1)], P[Math.max(i - 1, 0)]).normalize();
      V.subVectors(P[i], this.o); S.crossVectors(T, V).normalize();
      W.copy(P[i]).applyMatrix4(this.obj.matrixWorld);
      const hw = w * W.distanceTo(this.viewer) * pxw * 0.9, u = Ls[i] / tot;
      let a = alpha * (fade ? smooth(0, fade, u) * smooth(0, fade, 1 - u) : 1);
      if (wob) a *= 1 - wob * (0.5 + 0.5 * Math.sin(u * k1 * TAU + ph) * Math.sin(u * k2 * TAU * 0.5 + ph * 1.7));
      for (const sd of [1, -1]) { this.P.push(P[i].x, P[i].y, P[i].z); this.O.push(S.x * hw * sd, S.y * hw * sd, S.z * hw * sd); this.L.push(off + Ls[i]); this.S.push(sd); this.T.push(t0 + (t1 - t0) * u); this.A.push(a); this.Y.push(...this.sys); this.V.push(vis ? vis[i] : this.vis); }
      if (i < n - 1) { const b = base + i * 2; this.I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
  }
  dot(v, { size = 2, t = 0, alpha = 1 } = {}) { this.dP.push(v.x, v.y, v.z); this.dS.push(size); this.dT.push(t); this.dA.push(alpha); this.dY.push(...this.sys); this.dV.push(this.vis); }
  finish(order = 2.18) {
    const mat = (vs, fs, glow) => {
      const m = new THREE.ShaderMaterial({ uniforms: { ...U, ...this.inst.u, uOpacity: { value: STAR_CHART.lineOpacity }, uGlowPass: { value: glow ? 1 : 0 } },
        vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false });
      m.userData.glow = glow; setBlend(m); mats.push(m); this.inst.mats.push(m); return m;
    };
    if (this.I.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
      g.setAttribute('aOff', new THREE.Float32BufferAttribute(this.O, 3));
      g.setAttribute('aL', new THREE.Float32BufferAttribute(this.L, 1));
      g.setAttribute('aSide', new THREE.Float32BufferAttribute(this.S, 1));
      g.setAttribute('aT', new THREE.Float32BufferAttribute(this.T, 1));
      g.setAttribute('aA', new THREE.Float32BufferAttribute(this.A, 1));
      g.setAttribute('aSys', new THREE.Float32BufferAttribute(this.Y, 4));
      g.setAttribute('aVis', new THREE.Float32BufferAttribute(this.V, 1));
      g.setIndex(this.I);
      const m = new THREE.Mesh(g, mat(LINE_VS, LINE_FS, false)); m.renderOrder = order; m.frustumCulled = false; this.obj.add(m);
      const gm = new THREE.Mesh(g, mat(LINE_VS, LINE_FS, true)); gm.renderOrder = order - 0.005; gm.frustumCulled = false; this.obj.add(gm);   // glow: the same lines, wider and faint
    }
    if (this.dP.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.dP, 3));
      g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.dS, 1));
      g.setAttribute('aT', new THREE.Float32BufferAttribute(this.dT, 1));
      g.setAttribute('aA', new THREE.Float32BufferAttribute(this.dA, 1));
      g.setAttribute('aSys', new THREE.Float32BufferAttribute(this.dY, 4));
      g.setAttribute('aVis', new THREE.Float32BufferAttribute(this.dV, 1));
      const p = new THREE.Points(g, mat(DOT_VS, DOT_FS, false)); p.renderOrder = order; p.frustumCulled = false; this.obj.add(p);
    }
  }
}

// ---------- state ----------
// map = the map over the sky; cur = the framing circle around the current constellation; old = circles left behind
// by the search; spots = the circles of the constellations waiting while the player searches by hand (spotChartFrames).
// Each: { root, spinners, u (its uniforms), mats, revealT, mix (0 … 1, fading in / out during a search), … }.
// zoom = the telescope's lens zoom on the whole chart (ZOOM_GLSL; 1 = as built), kept from search to search.
const chart = { on: false, hold: false, map: null, cur: null, old: [], done: [], spots: [], search: null, zoom: 1, away: null, pulse: -1, pulseKind: 'pulse' };   // away: the search's ease further out   // pulse: the highlight wave's progress (0 … 1, < 0 = off)   // hold: stays shown while the camera pans back to the roof (holdChart)
const CHART_PREF = 'starGarden.starChart';
chart.on = !!getPref(CHART_PREF, true);
const BRUSH_PREF = 'starGarden.chartBrush';
chart.brush = !!getPref(BRUSH_PREF, true);
U.uBrush.value = chart.brush ? 1 : 0;
// constellation.js sets this: re-fit and re-tilt the current constellation, then rebuild the chart around it.
const chartHooks = { refresh: () => {} };

function dispose(inst) {
  inst.root.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  inst.root.parent?.remove(inst.root);
  for (const m of inst.mats) mats.splice(mats.indexOf(m), 1);
}
function clearChart() {
  for (const inst of [chart.map, chart.cur, ...chart.old, ...chart.done, ...chart.spots]) if (inst) dispose(inst);
  chart.map = null; chart.cur = null; chart.old = []; chart.done = []; chart.spots = []; chart.search = null; chart.zoom = 1; chart.away = null;
}

// The map's frame in the world, as seen from the camera now: centred on `centre` (world) at distance d.
function chartFrame(centre) {
  camera.updateMatrixWorld();
  const cam = camera.getWorldPosition(new V3()), view = centre.clone().sub(cam).normalize();
  const base = new THREE.Object3D(); base.position.copy(cam).addScaledVector(view, STAR_CHART.d); base.lookAt(cam);   // +z faces the camera
  const surfQ = base.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-STAR_CHART.tilt * L.tilt, 0, STAR_CHART.rot)));
  return { cam, view, base, surfQ };
}
// The rotation (local to an object whose world rotation is parentQ) that turns it to lie like the chart around
// `centre`, × look.star3d (0 = none).
function chartTilt(parentQ, centre) {
  const rel = parentQ.clone().invert().multiply(chartFrame(centre).surfQ);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(rel.w, -1, 1)), sn = Math.sqrt(Math.max(0, 1 - rel.w * rel.w));
  if (sn < 1e-6) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromAxisAngle(new V3(rel.x / sn, rel.y / sn, rel.z / sn), angle * L.star3d);
}

// ---------- drawing ----------
// Lines of a chart instance go into a Batch on obj (its widths × STAR_CHART.width).
function makeBatch(obj, inst) {
  const b = new Batch(obj, inst.cam, inst), poly0 = b.poly.bind(b);
  b.poly = (pts, o = {}) => poly0(pts, { ...o, w: (o.w ?? 1) * STAR_CHART.width });
  return b;
}
const circleXY = (r, a0 = 0, a1 = 1) => { const n = Math.max(48, Math.round(r * 700 * (a1 - a0)));
  return Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * TAU; return [Math.cos(a) * r, Math.sin(a) * r]; }); };
const segXY = (x0, y0, x1, y1) => Array.from({ length: 13 }, (_, t) => [x0 + (x1 - x0) * t / 12, y0 + (y1 - y0) * t / 12]);
// A tiny circle at (x, y) (map units, through pt); big ones get a second ring and a cross.
function mark(b, pt, x, y, big) {
  const rr = big ? 0.011 : 0.006, n = 28;
  const circ = s2 => Array.from({ length: n + 1 }, (_, i) => pt(x + Math.cos(i / n * TAU) * rr * s2, y + Math.sin(i / n * TAU) * rr * s2));
  b.poly(circ(1), { w: 0.4 });
  if (big) {
    b.poly(circ(1.9), { w: 0.3, alpha: 0.7 });
    b.poly([pt(x - rr * 2.6, y), pt(x + rr * 2.6, y)], { w: 0.3 });
    b.poly([pt(x, y - rr * 2.6), pt(x, y + rr * 2.6)], { w: 0.3 });
  }
  b.dot(pt(x, y), { size: big ? 1.9 : 1.3 });
}
// One circle system around (0, 0) in map units: rings, spokes, cross hairs. pt(x, y) → the point in the batches'
// local space; batchFor('in' | 'out') = where the inner / outer rings go (a spinning system turns them apart).
// Returns its solid rings as point lists (for the intersection markers).
function drawSystem(sys, pt, batchFor) {
  const P = xy => xy.map(([x, y]) => pt(x, y)), solid = [];
  const radii = sys.rings.map(([r]) => r), split = (Math.min(...radii) + Math.max(...radii)) / 2;
  for (const [r, style, arc] of sys.rings) {
    const [a0, a1] = arc || [0, 1], b = batchFor(r > split && radii.length > 1 ? 'out' : 'in'), fade = arc ? 0.03 : 0;
    if (style === 'dots') {
      const n = Math.round(r * 260 * (a1 - a0) + 12);
      for (let i = 0; i < n; i++) { const a = (a0 + (a1 - a0) * i / n) * TAU; b.dot(pt(Math.cos(a) * r, Math.sin(a) * r), { size: 1.15, t: i / n, alpha: arc ? 0.45 : 0.7 }); }
      continue;
    }
    const ring = P(circleXY(r, a0, a1));
    b.poly(ring, { w: style === 'band' ? 0.5 : 0.42, alpha: 0.85, wob: 0.18, fade });
    if (style === 'band' || style === 'double') b.poly(P(circleXY(r + 0.012, a0, a1)), { w: 0.32, alpha: 0.7, fade });
    if (style === 'band') {   // fine graduation, longer every 5th
      const n = Math.round(r * 380 * (a1 - a0));
      for (let i = 0; i < n; i++) {
        const a = (a0 + (a1 - a0) * i / n) * TAU, c = Math.cos(a), s2 = Math.sin(a), l = i % 5 === 0 ? 0.012 : 0.006;
        b.poly([pt(c * r, s2 * r), pt(c * (r + l), s2 * (r + l))], { w: 0.28, alpha: 0.8, t0: i / n, t1: i / n });
      }
    }
    solid.push(ring);
  }
  const b = batchFor('in');
  if (sys.spokes) {   // short radial lines between two of the system's rings
    const { n, r: [r0, r1] } = sys.spokes;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * TAU, c = Math.cos(a), s2 = Math.sin(a);
      b.poly(P(segXY(c * r0, s2 * r0, c * r1, s2 * r1)), { w: 0.32, alpha: i % 4 === 0 ? 0.8 : 0.5, fade: 0.03 });
      if (i % 4 === 0) mark(b, pt, c * r1, s2 * r1, false);
    }
  }
  if (sys.cross) {   // a roundel's cross hairs
    const q = sys.cross;
    b.poly(P(segXY(-q, 0, q, 0)), { w: 0.3, alpha: 0.6, fade: 0.03 }); b.poly(P(segXY(0, -q, 0, q)), { w: 0.3, alpha: 0.6, fade: 0.03 });
    mark(b, pt, 0, 0, true);
  }
  return solid;
}

// A new chart instance: its root sits at the camera with world axes, on the sky layer (so it moves with the sky).
function newInst() {
  const kf = 1 / camera.projectionMatrix.elements[5] / SKETCH_TAN;   // the game's view vs the sketch's: map units scale with it
  pxw = PXW * kf;                                                    // line widths keep their size on screen
  camera.updateMatrixWorld();
  const cam = camera.getWorldPosition(new V3());
  const root = new THREE.Group(); root.position.copy(cam); root.updateMatrixWorld(true);
  layerAttach(layers.sky).attach(root);
  root.updateMatrixWorld(true);
  return { u: localUniforms(), mats: [], spinners: [], revealT: 0, mix: 1, root, cam, kf, S: STAR_CHART.d * L.size * kf };
}

// The framing circle around a constellation: its stars' world positions and its element color (#hex). It lies on
// its own gently leaned surface facing the constellation (as the constellation itself leans: chartTilt).
// opts: size = fitR => the circle's radius (map units) instead of the fitted one, quiet = × the quiet hole, vary = a slightly different circle (outer ring, spokes, turning), keep = leave the current circle to fade out,
// revealed = already drawn in.
function buildFrame(starWorld, color, opts = {}) {
  const C = STAR_CHART, rnd = Math.random;
  if (chart.cur) { if (opts.keep) chart.old.push(chart.cur); else dispose(chart.cur); }
  chart.cur = null;
  const inst = newInst(), lo = starWorld[0].clone(), hi = starWorld[0].clone();
  for (const w of starWorld) { lo.min(w); hi.max(w); }
  const { base } = chartFrame(lo.clone().add(hi).multiplyScalar(0.5));
  inst.root.attach(base);   // keeps its place in the world
  const surf = new THREE.Object3D(); surf.rotation.set(-C.tilt * L.tilt, 0, C.rot); base.add(surf);
  inst.root.updateMatrixWorld(true);
  inst.surf = surf;
  // where the stars land on the map, seen from the camera → the framing circle around them
  const fit = frameAround(inst, starWorld), fc = fit.fc, FR = opts.size ? opts.size(fit.FR) : fit.FR;
  inst.fitR = fit.FR;
  inst.frame = { fc, FR };
  inst.quiet = C.frame.quiet * (opts.quiet ?? 1);
  inst.u.uTint.value.copy(raw(color));
  // A searched-for frame looks almost like the last one: its outer ring a touch wider or narrower (sometimes dotted
  // or doubled), more or fewer spokes, turning either way.
  const vary = opts.vary, outR = vary ? 1.14 + 0.12 * rnd() : 0;
  const rings = C.frame.rings.map(([r, st], i) => vary && i > 0 ? [outR, ['ring', 'ring', 'double', 'dots'][Math.floor(rnd() * 4)]] : [r, st]);
  const spokes = vary ? { n: [8, 12, 12, 16][Math.floor(rnd() * 4)], r: [1, outR] } : C.frame.spokes;
  const sys = { rings: rings.map(([r, st]) => [r * FR, st]), spokes: { n: spokes.n, r: spokes.r.map(r => r * FR) } };
  const spin = C.frame.spin * (vary && rnd() < 0.5 ? -1 : 1);
  // it turns in two parts about its centre: inner ring and spokes one way, outer ring the other
  const at = mapPoint(inst, fc[0], fc[1]), pivotIn = new THREE.Object3D(), pivotOut = new THREE.Object3D();
  for (const pv of [pivotIn, pivotOut]) { pv.position.copy(at); surf.add(pv); pv.updateMatrixWorld(true); }
  inst.spinners.push({ pivot: pivotIn, speed: spin }, { pivot: pivotOut, speed: spin * C.outerSpin });
  inst.middle = pivotIn;   // the circle's centre (chartMiddle)
  const bIn = makeBatch(pivotIn, inst), bOut = makeBatch(pivotOut, inst);
  drawSystem(sys, (x, y) => mapPoint(inst, fc[0] + x, fc[1] + y).sub(at), w => w === 'out' ? bOut : bIn);
  bIn.finish(); bOut.finish();
  setFrameUniforms(inst, fc, FR);
  chart.cur = inst;
  if (opts.revealed) { inst.revealT = L.revealSec; inst.u.uReveal.value = 1; }
  return inst;
}

// The map: circle systems packed evenly over the sky (no stretch of it left empty), each on its own gently
// leaned-back surface facing the camera, small fillers in what room is left, a celestial grid across it all, and
// markers where solid rings cross. Built once per look-up; the framing circles fade a quiet hole into it.
function buildMap(opts = {}) {
  if (chart.map) dispose(chart.map);
  const C = STAR_CHART, M = C.map, D = C.d, inst = newInst(), { root } = inst, rng = mulberry(Math.random() * 2 ** 31);
  const K = L.size * inst.kf, rad = THREE.MathUtils.degToRad, Y = new V3(0, 1, 0);
  const between = ([a, b]) => a + (b - a) * rng(), angOf = r => Math.atan(r * K);   // a radius (map units) as an angle
  const [e0, e1] = M.elRange.map(e => Math.sin(rad(e)));
  const randomDir = () => { const y = e0 + (e1 - e0) * rng(), az = rng() * TAU, c = Math.sqrt(1 - y * y); return new V3(c * Math.sin(az), y, -c * Math.cos(az)); };
  // the celestial grid's pole (drawn below): the polar circle with its meridians reads as a circle system of its own,
  // so the map's systems keep clear of it (grid.polar.clear)
  const G = M.grid, pe = rad(between(G.poleEl)), pa = rng() * TAU;
  const pole = new V3(Math.cos(pe) * Math.sin(pa), Math.sin(pe), -Math.cos(pe) * Math.cos(pa));
  const poleClear = rad(90 - G.polar.dec) * G.polar.clear;
  // Pack: random spots, each kept only where it leaves its neighbours room; many tries fill the sky evenly. Rings of
  // neighbours may cross a little (gap < 1), but a system crosses at most maxCross others, so they never pile up.
  const placed = [];
  const pack = (designs, scale, gapK, tries) => {
    for (let t = 0; t < tries; t++) {
      const sys = designs[Math.floor(rng() * designs.length)], s = between(scale), R = Math.max(...sys.rings.map(([r]) => r)) * s;
      const dir = randomDir(), ang = angOf(R), gap = (Array.isArray(gapK) ? between(gapK) : gapK) / L.density;
      if (Math.min(dir.angleTo(pole), Math.PI - dir.angleTo(pole)) < ang + poleClear) continue;
      const crossed = [];
      const fits = placed.every(p => {
        const d = dir.angleTo(p.dir);
        if (d < (ang + p.ang) * Math.max(gap, p.gap)) return false;
        if (d < ang + p.ang) crossed.push(p);
        return true;
      });
      if (!fits || crossed.length > M.maxCross || crossed.some(p => p.crosses >= M.maxCross)) continue;
      for (const p of crossed) p.crosses++;
      placed.push({ sys, s, dir, ang, gap, crosses: crossed.length });
    }
  };
  pack(C.systems, M.scale, M.gap, M.tries);
  pack(M.fillers, M.fillerScale, M.fillerGap, M.tries);
  // solid: rings as point lists in root space, for the markers (with their system, and a grid line's visibility per point)
  const mapBatch = makeBatch(root, inst), solid = [], solidSys = [], solidVis = [];
  for (const { sys, s, dir, ang } of placed) {
    const tag = [dir.x, dir.y, dir.z, ang];   // fades as a whole near a framing circle
    // its surface: at distance d along dir, facing the camera, leaned back about its horizontal, turned at random
    const z = dir.clone().negate(), x = new V3().crossVectors(Y, z).normalize(), y = new V3().crossVectors(z, x);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-C.tilt * L.tilt, 0, rng() * TAU)));
    const scaled = { ...sys, rings: sys.rings.map(([r, st, arc]) => [r * s, st, arc]), cross: sys.cross && sys.cross * s,
      spokes: sys.spokes && { n: sys.spokes.n, r: sys.spokes.r.map(r => r * s) } };
    const local = (px, py) => new V3(px * K * D, py * K * D, 0);
    if (sys.spin) {   // turns in two parts on pivots at its centre: inner rings one way, outer rings the other
      const base = new THREE.Object3D(); base.position.copy(dir).multiplyScalar(D); base.quaternion.copy(q); root.add(base);
      const pivotIn = new THREE.Object3D(), pivotOut = new THREE.Object3D(), speed = sys.spin * (rng() < 0.5 ? -1 : 1);
      base.add(pivotIn, pivotOut); base.updateMatrixWorld(true);
      inst.spinners.push({ pivot: pivotIn, speed }, { pivot: pivotOut, speed: speed * C.outerSpin });
      const bIn = makeBatch(pivotIn, inst), bOut = makeBatch(pivotOut, inst);
      bIn.sys = bOut.sys = tag;
      drawSystem(scaled, local, w => w === 'out' ? bOut : bIn);
      bIn.finish(); bOut.finish();
    } else {
      const c = dir.clone().multiplyScalar(D);
      mapBatch.sys = tag;
      for (const ring of drawSystem(scaled, (px, py) => local(px, py).applyQuaternion(q).add(c), () => mapBatch)) { solid.push(ring); solidSys.push(tag); solidVis.push(null); }
      mapBatch.sys = NO_SYS;
    }
  }
  // the celestial grid: meridians and parallels of one huge sky sphere around a tilted pole. Each line is drawn whole,
  // but shows only along long stretches with wide soft-ended gaps (aVis), so the screen shows a piece or two of an
  // enormous grid; near a framing circle it always shows (SYS_GLSL gridVis), running on across the circle.
  const below = d => Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) < rad(M.elRange[0]);
  inst.pole = pole;   // (root space; for a look at it from the console)
  const g1 = new V3().crossVectors(pole, Y).normalize(), g2 = new V3().crossVectors(pole, g1);
  const sky = (ra, dec) => g1.clone().multiplyScalar(Math.cos(dec) * Math.cos(ra)).addScaledVector(g2, Math.cos(dec) * Math.sin(ra)).addScaledVector(pole, Math.sin(dec));
  const across = angOf(0.012);   // a graduated line's second line and its ticks (radians), as on the circle bands
  // a grid line: pt(s, off) = its direction s degrees along it (0 … len), off radians to one side; band = graduated;
  // alpha = its ink; showAt(s) = how much it shows there (0 … 1) instead of its own stretches and gaps. Returns its visAt.
  const gridLine = (pt, len, band, alpha = G.alpha, showAt = null) => {
    if (G.whole) { showAt = () => 1; alpha *= G.wholeAlpha; }   // the whole grid, fainter (STAR_CHART.map.grid.whole)
    const shown = [];
    if (!showAt) for (let s = -rng() * G.gap[1]; s < len; ) {
      const a = Math.max(0, s), b = Math.min(len, s + between(G.stretch));
      if (b - a > 4) shown.push([a, b]);
      s = b + between(G.gap);
    }
    const visAt = showAt ?? (s => shown.reduce((v, [a, b]) => Math.max(v, smooth(a, a + G.fade, s) * smooth(b, b - G.fade, s)), 0));
    for (const [off, w] of band ? [[0, 0.42], [across, 0.3]] : [[0, 0.34]]) {
      let run = [], vis = [];
      const flush = () => {
        if (run.length > 1) { mapBatch.poly(run, { w, alpha, wob: 0.1, vis }); if (!off) { solid.push(run); solidSys.push(NO_SYS); solidVis.push(vis); } }
        run = []; vis = [];
      };
      for (let s = 0; s <= len; s += 0.5) { const d = pt(s, off); if (below(d)) flush(); else { run.push(d.multiplyScalar(D)); vis.push(visAt(s)); } }
      flush();
    }
    if (band) for (let s = 0; s <= len; s += 2) {   // graduation along it, longer every 10°
      const d = pt(s, 0), v = visAt(s);
      if (!below(d)) mapBatch.poly([d.multiplyScalar(D), pt(s, across * (s % 10 === 0 ? 1 : 0.5)).multiplyScalar(D)], { w: 0.26, alpha, vis: [v, v] });
    }
    return visAt;
  };
  const P = G.polar, ends = [];   // ends: each meridian's ra and how much it shows where it stops, south and north
  for (let ra = 0; ra < 360; ra += G.meridian) {   // meridians, pole to pole (not quite into the pole, where they'd bunch up); the first graduated
    const vis = gridLine((s, off) => { const dec = rad(s - P.dec); return sky(rad(ra) + off / Math.cos(dec), dec); }, 2 * P.dec, ra === 0);
    ends.push({ ra, [-1]: vis(0), [1]: vis(2 * P.dec) });
  }
  // where the meridians stop, a quiet polar circle round each pole (a graduated band, a plain ring a little inside it),
  // showing in arcs where a meridian runs into it (fading out within P.reach × the meridians' spacing either side)
  for (const sign of [1, -1]) for (const [d, band, k] of [[P.dec, true, 1], [P.dec + P.inner, false, 0.7]]) {
    const c = Math.cos(rad(d)), span = G.meridian * P.reach;
    const showAt = s => ends.reduce((v, e) => {
      const a = Math.abs(((s / c - e.ra) % 360 + 540) % 360 - 180);   // degrees round the pole from that meridian
      return Math.max(v, e[sign] * smooth(span, span * 0.4, a));
    }, 0);
    gridLine((s, off) => sky(rad(s / c), sign * (rad(d) + off)), 360 * c, band, G.alpha * P.alpha * k, showAt);
  }
  for (const dec of G.parallels) {               // parallels, all the way round; the equator graduated
    const c = Math.cos(rad(dec));
    gridLine((s, off) => sky(rad(s / c), rad(dec) + off), 360 * c, dec === 0);
  }
  // markers where solid rings really cross (not on turning systems: they'd drift off), spread out, a quiet few
  // (a marker goes with a system it sits on, so it fades with it, and shows only where a grid line it sits on shows)
  const visOn = (ri, d) => {   // a ring's visibility at its point nearest d
    const vis = solidVis[ri];
    if (!vis) return 1;
    let best = 0, bd = Infinity;
    solid[ri].forEach((p, i) => { const a = p.angleTo(d); if (a < bd) { bd = a; best = i; } });
    return vis[best];
  };
  const marks = [];
  for (const cr of ringCrossings(solid)) {
    const d = cr.d;
    if (marks.length >= M.marks) break;
    if (Math.asin(d.y) < rad(M.elRange[0] + 10) || marks.some(m => m.d.angleTo(d) < rad(M.markGap))) continue;
    marks.push({ d, sys: solidSys[cr.ri][3] >= 0 ? solidSys[cr.ri] : solidSys[cr.ti], vis: Math.min(visOn(cr.ri, d), visOn(cr.ti, d)) });
  }
  marks.forEach(({ d, sys, vis }, i) => {
    const x = new V3().crossVectors(d, Y).normalize(), y = new V3().crossVectors(x, d), c = d.clone().multiplyScalar(D);
    mapBatch.sys = sys; mapBatch.vis = vis;
    mark(mapBatch, (px, py) => c.clone().addScaledVector(x, px * K * D).addScaledVector(y, py * K * D), 0, 0, i % 6 === 0);
  });
  mapBatch.sys = NO_SYS; mapBatch.vis = 1;
  mapBatch.finish();
  chart.map = inst;
  if (opts.revealed) { inst.revealT = L.revealSec; inst.u.uReveal.value = 1; }
  return inst;
}

// Where the rings (point lists, from the camera) cross each other: { d (direction), ri, ti (the two rings) }, shuffled. Segments are
// sorted into small patches of sky; only those in neighbouring patches are compared, on a flat view of that spot.
function ringCrossings(rings) {
  const cell = 0.05, grid = new Map(), out = [];
  const key = (i, j) => `${i},${j}`, cellOf = d => [Math.floor(Math.atan2(d.x, -d.z) / cell), Math.floor(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / cell)];
  rings.forEach((pts, ri) => {
    const dirs = pts.map(p => p.clone().normalize());
    for (let i = 1; i < dirs.length; i++) {
      const s = { a: dirs[i - 1], b: dirs[i], ri }, k = key(...cellOf(s.a.clone().add(s.b).normalize()));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    }
  });
  const e1 = new V3(), e2 = new V3(), m = new V3(), X = new V3(1, 0, 0), Y = new V3(0, 1, 0);
  for (const [k, list] of grid) {
    const [ci, cj] = k.split(',').map(Number), near = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const t of grid.get(key(ci + di, cj + dj)) ?? []) near.push(t);   // (no spread: a busy cell can hold more than a call takes)
    for (const s of list) for (const t of near) {
      if (t.ri <= s.ri) continue;   // each pair once, never a ring with itself
      m.copy(s.a).add(s.b).normalize();
      e1.crossVectors(m, Math.abs(m.y) < 0.9 ? Y : X).normalize(); e2.crossVectors(m, e1);
      const f = p => { const w = p.dot(m); return [p.dot(e1) / w, p.dot(e2) / w]; };
      const [ax, ay] = f(s.a), [bx, by] = f(s.b), [cx, cy] = f(t.a), [dx, dy] = f(t.b);
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-14) continue;
      const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den, v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) out.push({ d: s.a.clone().lerp(s.b, u).normalize(), ri: s.ri, ti: t.ri });
    }
  }
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// The first constellation of a look-up (or a rebuild from the panel): a fresh map and framing circle, drawn in.
function buildStarChart(starWorld, color, opts = {}) {
  if (!opts.keep) clearChart();
  if (!starWorld.length) return;
  buildFrame(starWorld, color, opts);
  if (!chart.map) buildMap(opts);
}

// Where stars (world positions) fall on a chart's map: the centre of their box and the framing circle's radius.
function frameAround(inst, starWorld) {
  const { surf, cam, S } = inst;
  const n0 = new V3(0, 0, 1).transformDirection(surf.matrixWorld), p0 = new V3().setFromMatrixPosition(surf.matrixWorld);
  const onMap = starWorld.map(w => { const dir = w.clone().sub(cam), t = n0.dot(p0.clone().sub(cam)) / n0.dot(dir);
    const loc = surf.worldToLocal(cam.clone().addScaledVector(dir, t)); return [loc.x / S, loc.y / S]; });
  const xs = onMap.map(q => q[0]), ys = onMap.map(q => q[1]);
  const fc = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return { fc, FR: Math.max(...onMap.map(q => Math.hypot(q[0] - fc[0], q[1] - fc[1]))) + STAR_CHART.frame.margin };
}
// A map point (map units) on a chart's surface, in its surf's local space.
function mapPoint(inst, x, y) {
  const K = L.size * inst.kf, X = x * K, Y = y * K, D = STAR_CHART.d;
  return new V3(X * D, Y * D, STAR_CHART.curve * (X * X + Y * Y) * D);
}
// Frame tint, reveal and the quiet hole: where the frame sits (direction from the root), how big it is, right / up
// around it. Also kept in world terms (dirW, ang), for the map's hole.
function setFrameUniforms(inst, fc, FR) {
  const IU = inst.u, toRoot = inst.root.matrixWorld.clone().invert().multiply(inst.surf.matrixWorld);
  const c0 = mapPoint(inst, fc[0], fc[1]).applyMatrix4(toRoot), c1 = mapPoint(inst, fc[0] + FR, fc[1]).applyMatrix4(toRoot);
  IU.uFrameDir.value.copy(c0).normalize(); IU.uFrameAng.value = c0.angleTo(c1);
  IU.uFrameX.value.crossVectors(IU.uFrameDir.value, new V3(0, 1, 0)).normalize(); IU.uFrameY.value.crossVectors(IU.uFrameX.value, IU.uFrameDir.value).normalize();
  inst.dirW = IU.uFrameDir.value.clone().transformDirection(inst.root.matrixWorld); inst.ang = IU.uFrameAng.value;
}
// The map follows the framing circles: the current one's hole, tint and reveal centre, and the last one's while it
// fades during a search.
const _toMap = new THREE.Matrix4(), _sd = new V3();
function syncMapHoles() {
  const map = chart.map;
  if (!map) return;
  const MU = map.u, cur = chart.cur, prev = chart.done[chart.done.length - 1] ?? chart.old[chart.old.length - 1];
  _toMap.copy(map.root.matrixWorld).invert();
  if (cur?.dirW) {
    MU.uFrameDir.value.copy(cur.dirW).transformDirection(_toMap); MU.uFrameAng.value = cur.ang;
    MU.uFrameX.value.crossVectors(MU.uFrameDir.value, new V3(0, 1, 0)).normalize(); MU.uFrameY.value.crossVectors(MU.uFrameX.value, MU.uFrameDir.value).normalize();
    MU.uTint.value.copy(cur.u.uTint.value); MU.uQuiet.value = cur.quiet;
  }
  MU.uHoleW.value = MU.uTintW.value = cur?.dirW ? cur.mix : 0;
  if (prev?.dirW) {
    MU.uHole2Dir.value.copy(prev.dirW).transformDirection(_toMap); MU.uHole2Ang.value = prev.ang;
    MU.uTint2.value.copy(prev.u.uTint.value); MU.uQuiet2.value = prev.quiet; MU.uTint2W.value = prev.u.uTintW.value;
  }
  MU.uHole2W.value = prev?.dirW ? prev.mix : 0;
  for (let i = 0; i < 4; i++) {
    const sp = chart.spots[i];
    if (sp?.dirW) { _sd.copy(sp.dirW).transformDirection(_toMap); MU.uSpotHole.value[i].set(_sd.x, _sd.y, _sd.z, sp.ang); }
    MU.uSpotWQ.value[i].set(sp?.dirW ? sp.mix : 0, sp?.quiet ?? 1);
  }
}

// The search between constellations: the next framing circle where the next constellation will be (its stars'
// world positions once the scope points there), already drawn, tinted for it, on the same map (built now if there
// is none yet). It looks almost like the last circle, its size too (up to sizeVary either way), so while searching
// the circles all look alike; once the scope has found it, the lens zooms the whole chart (chart.zoom) until the
// circle fits the constellation, which only then wakes up (constellation.js waits while chart.search is on).
// `sec` = the whole search: the new circle fades in early on (still off screen), the last one fades out after.
function searchStarChart(starWorld, color, sec) {
  if (!chart.on) return false;
  for (const o of chart.old) dispose(o);   // anything still left from an earlier search
  chart.old = [];
  const X = STAR_CHART.search, was = chart.cur, show = was?.show ?? chart.map?.show ?? 0, [zMin, zMax] = X.zoomRange;
  if (was && X.keepDone) { retire(was); chart.cur = null; }   // the finished circle stays (else buildFrame fades it out)
  // the size it shows at now (× the current zoom) like the last circle; afterwards the zoom makes it fit (within zoomRange)
  const size = fitR => THREE.MathUtils.clamp((was?.frame.FR ?? fitR / chart.zoom) * (1 + X.sizeVary * (2 * Math.random() - 1)), fitR / zMax, fitR / zMin);
  const now = buildFrame(starWorld, color, { keep: true, revealed: true, vary: true, quiet: X.quiet, size });
  now.mix = 0; now.show = show;   // shows as much as the chart before
  if (!chart.map) { buildMap({ revealed: true }); chart.map.show = show; }
  // the lens adjusts once the scope has found the spot, as its eyepiece opens (scopeSearch.js, zoomT)
  chart.search = { t: 0, sec, zoom: { from: chart.zoom, to: now.fitR / now.frame.FR } };
  return true;
}
// Searching by hand (dragSearch.js): every constellation waiting in the tier gets its framing circle where it waits,
// already drawn and tinted in its element's color, each with its quiet hole in the map (`list`: [{ starWorld, color }],
// as searchStarChart). They look like the last circle (its size too, give or take sizeVary), so all circles look
// alike while searching; the last one fades out. The map stays (built now if there is none yet).
function spotChartFrames(list) {
  dropSpotFrames();
  if (!chart.on) return;
  const X = STAR_CHART.search, was = chart.cur, show = was?.show ?? chart.map?.show ?? 0, [zMin, zMax] = X.zoomRange;
  if (!chart.map) { buildMap({ revealed: true }); chart.map.show = show; }
  const size = fitR => THREE.MathUtils.clamp((was?.frame.FR ?? fitR / chart.zoom) * (1 + X.sizeVary * (2 * Math.random() - 1)), fitR / zMax, fitR / zMin);
  chart.cur = null;
  chart.spots = list.slice(0, 4).map(({ starWorld, color }) => {
    const f = buildFrame(starWorld, color, { revealed: true, vary: true, quiet: X.quiet, size });
    chart.cur = null; f.mix = 0; f.show = show;
    return f;
  });
  if (was) retire(was);
  // a kept circle one of the new ones still runs into (placeSpots found no room) fades out
  const clash = (a, b) => a.dirW && b.dirW && a.dirW.angleTo(b.dirW) < (a.ang + b.ang) * X.doneGap;
  chart.done = chart.done.filter(o => !chart.spots.some(s => clash(s, o)) || (chart.old.push(o), false));
  // further away while searching (STAR_CHART.search.away)
  if (X.away !== 1) chart.away = { t: 0, from: chart.zoom, to: chart.zoom * X.away };
}
// Whether a circle about `dir` (world direction from the camera) would run into a finished constellation's kept
// circle; its own size taken as the last circle's (the searched-for circles look alike).
function chartClash(dir) {
  if (!chart.on) return false;
  const r = chart.cur?.ang ?? chart.done[chart.done.length - 1]?.ang ?? 0;
  return chart.done.some(o => o.dirW && o.dirW.angleTo(dir) < (o.ang + r) * STAR_CHART.search.doneGap);
}
// The player chose spot i: its circle becomes the current one, the others fade out, and the lens zooms the chart until
// the circle fits the constellation (as at the end of a search; `sec` = the scope's settle + focus pull).
function chooseSpotFrame(i, sec) {
  const pick = chart.spots[i];
  if (!pick) return false;
  for (const o of chart.spots) if (o !== pick) chart.old.push(o);
  chart.spots = [];
  if (chart.cur) chart.old.push(chart.cur);
  chart.cur = pick;
  chart.away = null;   // (the lens zoom takes over from where the ease out got to)
  chart.search = { t: 0, sec, keep: true, zoom: { from: chart.zoom, to: pick.fitR / pick.frame.FR } };
  return true;
}
// A finished constellation's circle: it stays on the chart and only its tint fades (STAR_CHART.search.keepDone), or
// it fades out with the search.
function retire(inst) {
  if (!STAR_CHART.search.keepDone) { chart.old.push(inst); return; }
  inst.mix = 1;
  chart.done.push(inst);
}
// Back to the roof: the chart stays as it is (the waiting constellations' circles too) while the camera pans down, and
// fades out once there (on: false; its circles go with it).
function holdChart(on) {
  chart.hold = on;
  if (!on) { chart.old.push(...chart.spots); chart.spots = []; }
}
function dropSpotFrames() {
  for (const o of chart.spots) dispose(o);
  chart.spots = [];
}
// Where a point (world) shows with the chart's lens zoom (as ZOOM_GLSL; changes w): the glimmers sit in their circles' middles.
const _zr = new V3(), _zs = new V3();
function chartZoomed(w) {
  const z = chart.zoom, dir = U.uZoomDir.value, eye = U.uZoomEye.value;
  if (Math.abs(z - 1) < 1e-4) return w;
  _zr.copy(w).sub(eye);
  const len = _zr.length(), d = _zr.divideScalar(len), c = THREE.MathUtils.clamp(d.dot(dir), -1, 1), th = Math.acos(c);
  if (th < 1e-4 || th > 1.45) return w;
  _zs.copy(d).addScaledVector(dir, -c).normalize();
  const th2 = Math.atan(z * Math.tan(th));
  return w.copy(eye).addScaledVector(dir, Math.cos(th2) * len).addScaledVector(_zs, Math.sin(th2) * len);
}
// Where the current circle's centre shows (world, magnified with the chart), or null without a chart.
function chartMiddle() {
  const m = chart.on && chart.cur?.middle;
  return m ? chartZoomed(m.getWorldPosition(new THREE.Vector3())) : null;
}
// The new constellation is in place, inside the circle the search found (the lens zoom made it fit): its color.
function fitChartFrame(starWorld, color) {
  chart.cur?.u.uTint.value.copy(raw(color));
}

// Per frame. vis (0 … 1) = how much the constellation shows right now; the chart follows it while switched on.
const _buf = new THREE.Vector2(), _ray = new THREE.Raycaster(), _focus = new THREE.Vector2();
const ease = t => t * t * (3 - 2 * t);
function updateStarChart(dt, vis) {
  const step = dt / STAR_CHART.showSec, X = STAR_CHART.search, se = chart.search;
  // the search: the new circle fades in early in the swing (still off screen), the last one over the rest of it;
  // once the scope has found it, the lens zoom (eased) until the circle fits
  if (se) {
    se.t += dt;
    // the zoom runs as the scope finds the spot, with its eyepiece opening (done if the search was cut short)
    const p = se.t / se.sec, z = se.zoom, q = zoomT();
    if (chart.cur && !se.keep) chart.cur.mix = smooth(0, X.fadeIn, p);   // (keep: a spot's circle, already there)
    for (const o of chart.old) o.mix = 1 - smooth(X.fadeIn, 1, p);
    chart.zoom = z.from * Math.pow(z.to / z.from, lensEase(q));   // even steps of magnification, quick then settling
    if (p >= 1 && q >= 1) chart.search = null;
  } else for (const o of chart.old) o.mix = Math.max(0, o.mix - step);   // a search cut short: fade out anyway
  if (chart.away && !se) {   // searching by hand: the chart eases further away
    const a = chart.away; a.t += dt;
    chart.zoom = a.from * Math.pow(a.to / a.from, ease(Math.min(1, a.t / Math.max(0.01, X.awaySec))));
    if (a.t >= X.awaySec) chart.away = null;
  }
  for (const o of chart.spots) o.mix = Math.min(1, o.mix + step);       // the waiting constellations' circles fade in
  for (const o of chart.done) o.u.uTintW.value = Math.max(0, o.u.uTintW.value - dt / X.doneTintSec);   // finished: the tint fades
  chart.old = chart.old.filter(o => o.mix > 0 || (dispose(o), false));
  for (const inst of [chart.map, chart.cur, ...chart.old, ...chart.done, ...chart.spots]) {
    if (!inst) continue;
    const IU = inst.u, target = chart.on ? (chart.hold ? Math.max(vis, inst.show ?? 0) : vis) : 0;   // (hold: no fading out)
    // uShow follows the constellation (eased); mix is the search's fade, applied on top
    inst.show = inst.show ?? IU.uShow.value;
    inst.show = target > inst.show ? Math.min(target, inst.show + step) : Math.max(target, inst.show - step);
    IU.uShow.value = inst.show * inst.mix;
    inst.root.visible = IU.uShow.value > 0;
    if (IU.uShow.value > 0.02) inst.revealT += dt;   // draws in once it starts to show
    const u = Math.min(1, inst.revealT / L.revealSec);
    IU.uReveal.value = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;   // eases in and out
    for (const sp of inst.spinners) sp.pivot.rotation.z += dt * sp.speed * L.spin;   // the circles turn very slowly
    IU.uRootInv.value.copy(inst.root.matrixWorld).invert();
  }
  syncMapHoles();
  // the lens: magnified about where the scope points (the constellations' spot on screen, CONSTELLATION_PLAY.focusY)
  U.uZoom.value = chart.zoom;
  if (chart.zoom !== 1) {
    camera.updateMatrixWorld();
    _ray.setFromCamera(focusNdc(_focus), camera);
    U.uZoomDir.value.copy(_ray.ray.direction); U.uZoomEye.value.copy(_ray.ray.origin);
  }
  if (chart.pulse >= 0) {
    const k = chart.pulseKind;   // the playing set's look, live from Dev chart
    chart.pulse += dt / L[k + 'Sec'];
    U.uPulseStr.value = L[k]; U.uPulseSat.value = L[k + 'Sat']; U.uPulseReach.value = L[k + 'Reach']; U.uPulseWidth.value = L[k + 'Width'];
  }
  U.uPulse.value = chart.pulse >= 0 && chart.pulse < 1 ? chart.pulse : -1;
  renderer.getDrawingBufferSize(_buf); U.uPx.value = _buf.y / 1000;
}

// The highlight wave runs out from the framing circle's centre: kind = which look set plays ('pulse' = in rhythm
// with the sky, 'starPulse' = the star appears).
function pulseChart(kind = 'pulse') { if (chart.on && chart.cur) { chart.pulse = 0; chart.pulseKind = kind; } }

// Look settings (Dev chart panel). Live ones change uniforms; shape ones rebuild around the constellation.
const SHAPE_KEYS = ['size', 'density', 'tilt', 'star3d', 'starScale'];
function setChartLook(key, v) {
  L[key] = v;
  if (key === 'color') U.uColor.value.copy(raw(v));
  else if (key === 'glowColor') U.uGlowColor.value.copy(raw(v));
  else if (key === 'blend' || key === 'glowBlend') mats.forEach(setBlend);
  else if (key === 'hue') U.uHue.value = THREE.MathUtils.degToRad(v);
  else if (key === 'fadeLow') U.uFadeEl.value.x = v;
  else if (key === 'fadeHigh') U.uFadeEl.value.y = v;
  else if (key === 'horizonLow') U.uHorizonEl.value.x = v;
  else if (key === 'horizonHigh') U.uHorizonEl.value.y = v;
  else {
    const uni = { opacity: 'uLook', width: 'uWidth', glow: 'uGlow', glowSize: 'uGlowSize', glowSoft: 'uGlowSoft', hueScale: 'uHueScale', hueSat: 'uHueSat',
      tint: 'uTintAmt', tintFade: 'uTintFade', breaks: 'uBreaks', breakWidth: 'uBreakW', breakFade: 'uBreakFade', dotBreaks: 'uDotBreaks',
      brushWidth: 'uBrushWidth', brushGrain: 'uBrushGrain', brushRag: 'uBrushRag', brushDry: 'uBrushDry', brushStroke: 'uBrushStroke', brushBreaks: 'uBrushBreaks' }[key];
    if (uni) U[uni].value = v;
  }
}
const replayChart = () => { for (const inst of [chart.map, chart.cur]) if (inst) inst.revealT = 0; };

// Star chart ↔ plain night sky (key C in modes.js) and brush strokes on / off (key V). No on-screen buttons.
function setChartOn(on) { chart.on = on; setPref(CHART_PREF, on); chartHooks.refresh(); }
function setChartBrush(on) { chart.brush = on; setPref(BRUSH_PREF, on); U.uBrush.value = on ? 1 : 0; }

export { chart, chartClash, holdChart, chartHooks, chartTilt, buildStarChart, pulseChart, searchStarChart, spotChartFrames, chooseSpotFrame, dropSpotFrames, chartZoomed, chartMiddle, fitChartFrame, clearChart, updateStarChart, setChartLook, setChartOn, setChartBrush, replayChart, SHAPE_KEYS };
