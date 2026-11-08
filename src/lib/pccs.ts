/**
 * PCCS estimation for arbitrary sRGB colours.
 *
 * PCCS lightness/saturation are perceptual scales, so we do NOT derive them
 * from RGB/HSB arithmetic. Instead we use reference data exported by
 * `scripts/export_pccs.py`:
 *
 *   PCCS (h, l, s) --[pccs lib: Kobayashi & Yoshiki 2001]--> Munsell HVC
 *                  --[Munsell Renotation (visual data)]-----> CIELAB (D65)
 *
 * and invert that table: a colour's PCCS value is found by locating it among
 * the reference samples in CIELAB.
 *
 *  - Lightness: PCCS lightness equals Munsell Value, a function of luminance
 *    only, so it is interpolated from the neutral scale (Bk .. W).
 *  - Hue / saturation: on each lightness level, every PCCS hue forms a
 *    "ladder" of samples from neutral (0s) to 9s. The colour's hue angle picks
 *    the two neighbouring hue ladders, and its radius from neutral is located
 *    on the blended ladder to get a fractional saturation.
 */
import table from "@/data/pccs-lab.json";
import { type Lab, type RGB, labToRgb, rgbToLab } from "./color";

type Vec = [number, number];
type LabTable = (number[] | null)[][][];

export const PCCS_HUE_CODES: string[] = table.hueCodes;
export const PCCS_LIGHTNESSES: number[] = table.lightnesses; // 1.5 .. 9.5
export const PCCS_SATURATIONS: number[] = table.saturations; // 1 .. 9

const LAB = table.lab as LabTable;
const NEUTRAL_LAB = table.neutralLab as number[][];
const NH = PCCS_HUE_CODES.length; // 24
const NL = PCCS_LIGHTNESSES.length; // 17
const NS = PCCS_SATURATIONS.length; // 9
const L_MIN = PCCS_LIGHTNESSES[0];
const L_STEP = PCCS_LIGHTNESSES[1] - PCCS_LIGHTNESSES[0];
const NEUTRAL_LSTAR = NEUTRAL_LAB.map((x) => x[0]);
const TAU = Math.PI * 2;

/** Tone centres in (s, t) from the pccs library (PCCS_TONE_COORDS). */
export const PCCS_TONE_COORDS: Record<string, [number, number]> =
  table.toneCoords as unknown as Record<string, [number, number]>;

// ---------------------------------------------------------------------------
// Precomputed ladders: LADDER[li][hi][s] = (a*, b*) for s = 0..9.
// Samples outside the Munsell Renotation domain (null) are linearly
// extrapolated from the previous two steps so every ladder is complete.
// ---------------------------------------------------------------------------
const LADDER: Vec[][][] = [];
const HUE_ANGLE: number[][] = []; // representative a*b* angle per (li, hi)

for (let li = 0; li < NL; li++) {
  const ladders: Vec[][] = [];
  const angles: number[] = [];
  for (let hi = 0; hi < NH; hi++) {
    const pts: Vec[] = [[0, 0]];
    let sumA = 0, sumB = 0;
    for (let si = 0; si < NS; si++) {
      const lab = LAB[hi][li][si];
      if (lab) {
        pts.push([lab[1], lab[2]]);
        sumA += lab[1];
        sumB += lab[2];
      } else {
        const p1 = pts[pts.length - 1];
        const p0 = pts[pts.length - 2];
        pts.push([2 * p1[0] - p0[0], 2 * p1[1] - p0[1]]);
      }
    }
    ladders.push(pts);
    angles.push(Math.atan2(sumB, sumA));
  }
  LADDER.push(ladders);
  HUE_ANGLE.push(angles);
}

const wrap = (x: number) => ((x % TAU) + TAU) % TAU;

/** PCCS lightness (= Munsell Value) from CIE L*, via the neutral scale. */
export function lightnessFromLstar(Lstar: number): number {
  const n = NEUTRAL_LSTAR;
  let i = 0;
  if (Lstar <= n[0]) i = 0;
  else if (Lstar >= n[n.length - 1]) i = n.length - 2;
  else while (i < n.length - 2 && Lstar > n[i + 1]) i++;
  const t = (Lstar - n[i]) / (n[i + 1] - n[i]);
  return PCCS_LIGHTNESSES[i] + t * L_STEP;
}

/**
 * Inverse bilinear interpolation inside quad A(0,0) B(1,0) C(1,1) D(0,1)
 * (u: hue direction, v: saturation direction) via Newton iteration.
 */
function invBilinear(A: Vec, B: Vec, C: Vec, D: Vec, px: number, py: number): Vec | null {
  let u = 0.5, v = 0.5;
  for (let it = 0; it < 12; it++) {
    const lx = A[0] + u * (B[0] - A[0]), ly = A[1] + u * (B[1] - A[1]);
    const hx = D[0] + u * (C[0] - D[0]), hy = D[1] + u * (C[1] - D[1]);
    const ex = px - (lx + v * (hx - lx));
    const ey = py - (ly + v * (hy - ly));
    if (ex * ex + ey * ey < 1e-10) return [u, v];
    const jux = (1 - v) * (B[0] - A[0]) + v * (C[0] - D[0]);
    const juy = (1 - v) * (B[1] - A[1]) + v * (C[1] - D[1]);
    const jvx = hx - lx, jvy = hy - ly;
    const det = jux * jvy - jvx * juy;
    if (Math.abs(det) < 1e-12) return null;
    u += (ex * jvy - jvx * ey) / det;
    v += (jux * ey - ex * juy) / det;
  }
  return null; // not converged

}

/**
 * Hue (1..25 continuous, 25 == 1) and saturation on one lightness level.
 * Finds the grid cell (hue sector × saturation step) containing (a, b) and
 * inverts it bilinearly, so reference grid points are reproduced exactly.
 */
function hueSatOnLevel(li: number, a: number, b: number): { h: number; s: number } {
  const guess = hueSatOnLevelApprox(li, a, b);
  const h0 = Math.floor(guess.h) - 1;
  const s0 = Math.min(NS, Math.max(1, Math.ceil(guess.s)));
  const EPS_UV = 1e-6;
  for (const dh of [0, -1, 1, -2, 2]) {
    const hi = (((h0 + dh) % NH) + NH) % NH;
    const L0 = LADDER[li][hi];
    const L1 = LADDER[li][(hi + 1) % NH];
    for (const ds of [0, -1, 1, -2, 2]) {
      const k = s0 + ds;
      if (k < 1 || k > NS) continue;
      const uv = invBilinear(L0[k - 1], L1[k - 1], L1[k], L0[k], a, b);
      if (!uv) continue;
      const [u, v] = uv;
      const vMax = k === NS ? Infinity : 1 + EPS_UV; // beyond 9s: extrapolate
      if (u >= -EPS_UV && u <= 1 + EPS_UV && v >= -EPS_UV && v <= vMax) {
        return { h: hi + 1 + Math.min(1, Math.max(0, u)), s: Math.max(0, k - 1 + v) };
      }
    }
  }
  return guess;
}

/** Fast approximate inverse (mean hue angle + blended ladder radius). */
function hueSatOnLevelApprox(li: number, a: number, b: number): { h: number; s: number } {
  const r = Math.hypot(a, b);
  const ang = HUE_ANGLE[li];
  const theta = Math.atan2(b, a);

  // Find hue sector [hi, hi+1) that contains theta (angles increase with hue).
  let hi = NH - 1;
  let t = 0;
  for (let k = 0; k < NH; k++) {
    const a0 = ang[k];
    const span = wrap(ang[(k + 1) % NH] - a0);
    const d = wrap(theta - a0);
    if (d <= span) {
      hi = k;
      t = span > 0 ? d / span : 0;
      break;
    }
  }
  const L0 = LADDER[li][hi];
  const L1 = LADDER[li][(hi + 1) % NH];

  // Radius of the blended ladder at each step, then invert r -> s.
  let prev = 0;
  let s = 0;
  for (let k = 1; k <= NS; k++) {
    const x = L0[k][0] + t * (L1[k][0] - L0[k][0]);
    const y = L0[k][1] + t * (L1[k][1] - L0[k][1]);
    const rk = Math.hypot(x, y);
    if (r <= rk || k === NS) {
      // Linear within the step; beyond 9s, extrapolate with the last step.
      s = k - 1 + (rk > prev ? (r - prev) / (rk - prev) : 0);
      break;
    }
    prev = rk;
  }
  return { h: hi + 1 + t, s: Math.max(0, s) };
}

export interface PccsValue {
  /** Continuous hue 1..<25 (1:pR .. 24:RP); meaningless when s ≈ 0. */
  h: number;
  /** Lightness (Munsell Value), 1.5 (Bk) .. 9.5 (W); may extend beyond. */
  l: number;
  /** Saturation 0s (neutral) .. 9s; may exceed 9 for very vivid colours. */
  s: number;
}

export function labToPccs([L, a, b]: Lab): PccsValue {
  const l = lightnessFromLstar(L);
  const pos = Math.min(NL - 1, Math.max(0, (l - L_MIN) / L_STEP));
  const lo = Math.min(NL - 2, Math.floor(pos));
  const ft = pos - lo;
  const p0 = hueSatOnLevel(lo, a, b);
  const p1 = hueSatOnLevel(lo + 1, a, b);
  let dh = p1.h - p0.h;
  if (dh > NH / 2) dh -= NH;
  if (dh < -NH / 2) dh += NH;
  let h = p0.h + ft * dh;
  h = ((((h - 1) % NH) + NH) % NH) + 1;
  return { h, l, s: p0.s + ft * (p1.s - p0.s) };
}

export function rgbToPccs(rgb: RGB): PccsValue {
  return labToPccs(rgbToLab(rgb));
}

// ---------------------------------------------------------------------------
// Notation helpers
// ---------------------------------------------------------------------------

export const roundHalf = (x: number) => Math.round(x * 2) / 2;

export function nearestHueIndex(h: number): number {
  return ((Math.round(h) - 1) % NH + NH) % NH; // 0..23
}

export function hueCode(h: number): string {
  return PCCS_HUE_CODES[nearestHueIndex(h)];
}

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------

export interface ToneInfo {
  symbol: string;
  en: string;
  ja: string;
}

/** PCCS tones (12 basic tones + p+ / lt+ used by the pccs library). */
export const PCCS_TONES: ToneInfo[] = [
  { symbol: "v", en: "vivid", ja: "純色" },
  { symbol: "b", en: "bright", ja: "明るい" },
  { symbol: "s", en: "strong", ja: "強い" },
  { symbol: "dp", en: "deep", ja: "深い" },
  { symbol: "lt+", en: "light plus", ja: "浅い＋" },
  { symbol: "lt", en: "light", ja: "浅い" },
  { symbol: "sf", en: "soft", ja: "柔らかい" },
  { symbol: "d", en: "dull", ja: "鈍い" },
  { symbol: "dk", en: "dark", ja: "暗い" },
  { symbol: "p+", en: "pale plus", ja: "薄い＋" },
  { symbol: "p", en: "pale", ja: "薄い" },
  { symbol: "ltg", en: "light grayish", ja: "明るい灰み" },
  { symbol: "g", en: "grayish", ja: "灰み" },
  { symbol: "dkg", en: "dark grayish", ja: "暗い灰み" },
];

export const TONE_BY_SYMBOL: Record<string, ToneInfo> = Object.fromEntries(
  PCCS_TONES.map((t) => [t.symbol, t]),
);

/**
 * Hue-dependent offset of the tone coordinate (Kobayashi & Yoshiki 2001):
 *   t = l - k(h) * s,  k(h) = 0.25 - 0.34 * sqrt(1 - sin((h - 2) / 12 * π))
 * Tone centres are fixed points in the (s, t) plane, so their lightness
 * depends on hue (e.g. v8 yellow is light, v20 violet is dark).
 */
const toneSlope = (h: number) =>
  0.25 - 0.34 * Math.sqrt(Math.max(0, 1 - Math.sin(((h - 2) / 12) * Math.PI)));

/**
 * Centre (l, s) of a tone on the given hue, rounded to 0.5 like
 * pccs.pccs_tone_to_lightness_and_saturation.
 */
export function toneCenter(h: number, symbol: string): { l: number; s: number } {
  const [s, t] = PCCS_TONE_COORDS[symbol];
  const l = t + toneSlope(Math.round(h)) * s;
  return { l: Math.min(9.5, Math.max(1.5, roundHalfEven(l))), s: roundHalfEven(s) };
}

/** Round to 0.5 steps with ties to even, like numpy.round used by pccs. */
function roundHalfEven(x: number): number {
  const y = x * 2;
  const r = Math.round(y);
  const isTie = Math.abs(y - Math.trunc(y)) === 0.5;
  return (isTie && r % 2 !== 0 ? r - 1 : r) / 2;
}

/**
 * PCCS tone symbol from (h, l, s): the nearest tone centre in the (s, t)
 * plane (Euclidean distance).
 */
export function toneOf({ h, l, s }: PccsValue): string {
  const t = l - toneSlope(h) * s;
  let best = "";
  let bestD = Infinity;
  for (const [name, [s0, t0]] of Object.entries(PCCS_TONE_COORDS)) {
    const d = (s0 - s) ** 2 + (t0 - t) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/**
 * Signed membership of (h, l, s) in a tone's Voronoi cell in the (s, t)
 * plane: distance to the tone's centre minus distance to the nearest other
 * tone centre. <= 0 inside; 0 on the tone boundary; continuous, so it can be
 * contoured smoothly.
 */
export function toneMembership(h: number, l: number, s: number, symbol: string): number {
  const t = l - toneSlope(h) * s;
  let own = Infinity;
  let other = Infinity;
  for (const [name, [s0, t0]] of Object.entries(PCCS_TONE_COORDS)) {
    const d = Math.hypot(s0 - s, t0 - t);
    if (name === symbol) own = d;
    else if (d < other) other = d;
  }
  return own - other;
}

/**
 * Lightness / saturation extent of a tone on the given hue, over the official
 * PCCS grid (lightness 1.5–9.5 by 0.5, saturation 1s–9s).
 */
export function toneRange(
  h: number,
  symbol: string,
): { lMin: number; lMax: number; sMin: number; sMax: number } {
  let lMin = Infinity, lMax = -Infinity, sMin = Infinity, sMax = -Infinity;
  for (const l of PCCS_LIGHTNESSES) {
    for (const s of PCCS_SATURATIONS) {
      if (toneOf({ h: Math.round(h), l, s }) !== symbol) continue;
      lMin = Math.min(lMin, l);
      lMax = Math.max(lMax, l);
      sMin = Math.min(sMin, s);
      sMax = Math.max(sMax, s);
    }
  }
  if (!Number.isFinite(lMin)) {
    const c = toneCenter(h, symbol);
    return { lMin: c.l, lMax: c.l, sMin: c.s, sMax: c.s };
  }
  return { lMin, lMax, sMin, sMax };
}

export function neutralName(l: number): string {
  const v = roundHalf(l);
  if (v >= 9.5) return "W";
  if (v <= 1.5) return "Bk";
  return `Gy-${v.toFixed(1)}`;
}

/** Short / long PCCS notation, e.g. "v2" and "2:R-4.5-9s". */
export function formatPccs(p: PccsValue): { short: string; long: string; neutral: boolean } {
  const l = roundHalf(p.l);
  const s = Math.round(p.s);
  if (s < 1) {
    return { short: neutralName(l), long: `n-${l.toFixed(1)}`, neutral: true };
  }
  const hi = nearestHueIndex(p.h);
  return {
    short: `${toneOf({ h: hi + 1, l, s })}${hi + 1}`,
    long: `${PCCS_HUE_CODES[hi]}-${l.toFixed(1)}-${s}s`,
    neutral: false,
  };
}

/** Reference colour of an official PCCS grid point (integer hue & s). */
export function pccsReferenceColor(
  hue: number,
  l: number,
  s: number,
): { rgb: RGB; inGamut: boolean } | null {
  const li = Math.round((l - L_MIN) / L_STEP);
  if (li < 0 || li >= NL) return null;
  if (s <= 0) {
    const n = NEUTRAL_LAB[li];
    return labToRgb([n[0], n[1], n[2]]);
  }
  const lab = LAB[nearestHueIndex(hue)][li][Math.round(s) - 1];
  return lab ? labToRgb([lab[0], lab[1], lab[2]]) : null;
}

export function neutralColor(l: number): RGB {
  return pccsReferenceColor(0, l, 0)!.rgb;
}
