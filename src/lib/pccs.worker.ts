/// <reference lib="webworker" />
/**
 * Computes, for one picker hue:
 *
 * 1. The PCCS (lightness, saturation) field of the HSB square.
 *    Row j is brightness 1 - j/(n-1) (top = bright), column i is HSB
 *    saturation i/(n-1).
 *
 * 2. Out-of-gamut rays for the sRGB gamut boundary of the square (top edge
 *    B = 100% and right edge S = 100%). From each boundary colour we increase
 *    OKLCH chroma at constant OKLCH lightness and hue; every out-of-gamut
 *    colour on that ray is gamut-mapped (OKLCH chroma reduction) back onto
 *    this boundary point. We record the PCCS (l, s) along each ray so the UI
 *    can show where out-of-gamut PCCS values are approximated.
 */
import { hsvToRgb } from "./color";
import { computeGamutEdge } from "./gamutEdge";
import { rgbToPccs } from "./pccs";

export interface FieldRequest {
  id: number;
  hue: number;
  n: number;
}

export interface FieldResponse {
  id: number;
  hue: number;
  n: number;
  l: Float32Array;
  s: Float32Array;
  /** Continuous PCCS hue per sample (1..25). */
  h: Float32Array;
  /** Boundary points in grid coords [gx0, gy0, gx1, gy1, ...], ordered along the edge. */
  edge: Float32Array;
  /** Samples per ray. */
  rayK: number;
  /** PCCS lightness / saturation along each ray (edgeIndex * rayK + k); NaN = no sample. */
  rayL: Float32Array;
  rayS: Float32Array;
  rayH: Float32Array;
}

self.onmessage = (e: MessageEvent<FieldRequest>) => {
  const { id, hue, n } = e.data;
  const l = new Float32Array(n * n);
  const s = new Float32Array(n * n);
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const v = 1 - j / (n - 1);
    for (let i = 0; i < n; i++) {
      const p = rgbToPccs(hsvToRgb(hue, i / (n - 1), v));
      l[j * n + i] = p.l;
      s[j * n + i] = p.s;
      h[j * n + i] = p.h;
    }
  }
  const { edge, rayK, rayL, rayS, rayH } = computeGamutEdge(hue, n);
  const res: FieldResponse = { id, hue, n, l, s, h, edge, rayK, rayL, rayS, rayH };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, [
    l.buffer,
    s.buffer,
    h.buffer,
    edge.buffer,
    rayL.buffer,
    rayS.buffer,
    rayH.buffer,
  ]);
};
