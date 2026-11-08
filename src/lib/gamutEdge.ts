import { encodedToLinear, hsvToRgb, isInGamut, linearToLab, linearToOklab, oklabToLinear } from "./color";
import { labToPccs } from "./pccs";

const RAY_K = 80;
const RAY_DC = 0.004; // OKLCH chroma step
const RAY_S_MAX = 16;

/**
 * Out-of-gamut rays along the sRGB boundary of the HSB square for `hue`
 * (see pccs.worker.ts). Boundary points are ordered: top edge left -> right,
 * then right edge top -> bottom.
 */
export function computeGamutEdge(hue: number, n: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([i, 0]); // top edge, left -> right
  for (let j = 1; j < n; j++) pts.push([n - 1, j]); // right edge, top -> bottom

  const edge = new Float32Array(pts.length * 2);
  const rayL = new Float32Array(pts.length * RAY_K).fill(NaN);
  const rayS = new Float32Array(pts.length * RAY_K).fill(NaN);
  const rayH = new Float32Array(pts.length * RAY_K).fill(NaN);

  pts.forEach(([gi, gj], e) => {
    edge[e * 2] = gi;
    edge[e * 2 + 1] = gj;
    const v = 1 - gj / (n - 1);
    if (v < 0.03) return; // black: no meaningful chroma direction
    const lin = encodedToLinear(hsvToRgb(hue, gi / (n - 1), v));
    const [L, a, b] = linearToOklab(lin);
    const C0 = Math.hypot(a, b);
    if (C0 < 0.002) return; // white corner: hue undefined
    const ca = a / C0;
    const cb = b / C0;
    for (let k = 0; k < RAY_K; k++) {
      const C = C0 + (k + 1) * RAY_DC;
      const out = oklabToLinear([L, ca * C, cb * C]);
      if (isInGamut(out)) break; // ray (re-)enters gamut: no longer maps here
      const p = labToPccs(linearToLab(out));
      if (p.s > RAY_S_MAX) break;
      rayL[e * RAY_K + k] = p.l;
      rayS[e * RAY_K + k] = p.s;
      rayH[e * RAY_K + k] = p.h;
    }
  });
  return { edge, rayK: RAY_K, rayL, rayS, rayH };
}

/**
 * Boundary points whose out-of-gamut ray contains a colour for which
 * `inside(l, s, h)` holds, i.e. where those (out-of-gamut) PCCS colours are
 * displayed after OKLCH chroma reduction.
 */
export function edgeHits(
  rayK: number,
  rayL: Float32Array,
  rayS: Float32Array,
  rayH: Float32Array,
  inside: (l: number, s: number, h: number) => boolean,
): Uint8Array {
  const count = rayL.length / rayK;
  const hits = new Uint8Array(count);
  for (let e = 0; e < count; e++) {
    for (let k = 0; k < rayK; k++) {
      const i = e * rayK + k;
      if (Number.isNaN(rayL[i])) break;
      if (inside(rayL[i], rayS[i], rayH[i])) {
        hits[e] = 1;
        break;
      }
    }
  }
  return hits;
}
