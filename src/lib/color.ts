/** sRGB / HSB / CIELAB(D65) conversions. RGB components are encoded sRGB 0..1. */

export type RGB = [number, number, number];
export type Lab = [number, number, number];

/** HSB(HSV) -> sRGB. h: 0..360, s/v: 0..1 */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toEncoded = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

// sRGB primaries, D65 white (xy 0.3127, 0.3290) — same as colour-science.
const M = [
  [0.4123908, 0.35758434, 0.18048079],
  [0.21263901, 0.71516868, 0.07219232],
  [0.01933082, 0.11919478, 0.95053215],
];
const M_INV = [
  [3.24096994, -1.53738318, -0.49861076],
  [-0.96924364, 1.8759675, 0.04155506],
  [0.05563008, -0.20397696, 1.05697151],
];
const WHITE = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];

const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > EPS ? t ** 3 : (116 * t - 16) / KAPPA);

/** Linear-light sRGB (may be outside 0..1) -> CIELAB (D65). */
export function linearToLab([r, g, b]: RGB): Lab {
  const fx = f((M[0][0] * r + M[0][1] * g + M[0][2] * b) / WHITE[0]);
  const fy = f((M[1][0] * r + M[1][1] * g + M[1][2] * b) / WHITE[1]);
  const fz = f((M[2][0] * r + M[2][1] * g + M[2][2] * b) / WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELAB (D65) -> linear-light sRGB, unbounded (no gamut handling). */
export function labToLinear([L, a, b]: Lab): RGB {
  const fy = (L + 16) / 116;
  const X = fInv(fy + a / 500) * WHITE[0];
  const Y = fInv(fy) * WHITE[1];
  const Z = fInv(fy - b / 200) * WHITE[2];
  return M_INV.map((row) => row[0] * X + row[1] * Y + row[2] * Z) as RGB;
}

export function rgbToLab(rgb: RGB): Lab {
  return linearToLab(rgb.map(toLinear) as RGB);
}

export const linearToEncoded = (lin: RGB): RGB => lin.map(toEncoded) as RGB;
export const encodedToLinear = (rgb: RGB): RGB => rgb.map(toLinear) as RGB;

// ---------------------------------------------------------------------------
// OKLab / OKLCH (Björn Ottosson), on linear-light sRGB
// ---------------------------------------------------------------------------

export type Oklab = [number, number, number];

export function linearToOklab([r, g, b]: RGB): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, a, b]: Oklab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const GAMUT_EPS = 1e-4;
export const isInGamut = (lin: RGB) => lin.every((c) => c >= -GAMUT_EPS && c <= 1 + GAMUT_EPS);

/**
 * Gamut mapping: keep OKLCH lightness and hue, reduce chroma until the colour
 * fits in sRGB (binary search). Returns linear-light sRGB in 0..1.
 */
export function gamutMapOklch(lin: RGB): RGB {
  if (isInGamut(lin)) return lin.map((c) => Math.min(1, Math.max(0, c))) as RGB;
  const [L, a, b] = linearToOklab(lin);
  if (L >= 1) return [1, 1, 1];
  if (L <= 0) return [0, 0, 0];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (isInGamut(oklabToLinear([L, a * mid, b * mid]))) lo = mid;
    else hi = mid;
  }
  return oklabToLinear([L, a * lo, b * lo]).map((c) => Math.min(1, Math.max(0, c))) as RGB;
}

/**
 * Lab -> displayable sRGB (encoded). Out-of-gamut colours are approximated by
 * OKLCH chroma reduction; `inGamut` is false in that case.
 */
export function labToRgb(lab: Lab): { rgb: RGB; inGamut: boolean } {
  const lin = labToLinear(lab);
  const inGamut = isInGamut(lin);
  return { rgb: linearToEncoded(gamutMapOklch(lin)), inGamut };
}

export function rgbToHex(rgb: RGB): string {
  return (
    "#" +
    rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
