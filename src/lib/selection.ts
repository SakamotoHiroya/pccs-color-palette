/**
 * What the picker overlay highlights:
 *  - "value": one PCCS (lightness, saturation) cell — lightness ±0.25,
 *    saturation ±0.5s. The ends of the scales are open (lightness 9.5 includes
 *    everything lighter, 1.5 everything darker, 9s everything more vivid);
 *    s = 0 means neutral (achromatic).
 *  - "tone": every colour whose PCCS tone is the given tone.
 */
import { type PccsValue, roundHalf, toneMembership, toneOf } from "./pccs";

export type Selection =
  | { kind: "value"; l: number; s: number }
  | { kind: "tone"; tone: string };

export const L_MIN = 1.5;
export const L_MAX = 9.5;
export const S_MAX = 9;
export const L_HALF = 0.25;
export const S_HALF = 0.5;
/** Below this saturation a colour is treated as neutral (no tone). */
export const NEUTRAL_S = 0.5;

/** Signed field: <= 0 inside the selection. */
export function selectionField(sel: Selection, l: number, s: number, h: number): number {
  if (sel.kind === "value") {
    let dl = (l - sel.l) / L_HALF;
    if (sel.l >= L_MAX && dl > 0) dl = 0;
    if (sel.l <= L_MIN && dl < 0) dl = 0;
    let ds = (s - sel.s) / S_HALF;
    if (sel.s >= S_MAX && ds > 0) ds = 0;
    return Math.max(Math.abs(dl), Math.abs(ds)) - 1;
  }
  return Math.max(toneMembership(h, l, s, sel.tone), NEUTRAL_S - s);
}

/** The value cell containing the given colour. */
export function selectionFromPccs(p: PccsValue): Selection {
  return {
    kind: "value",
    l: Math.min(L_MAX, Math.max(L_MIN, roundHalf(p.l))),
    s: p.s < NEUTRAL_S ? 0 : Math.min(S_MAX, Math.max(1, Math.round(p.s))),
  };
}

/**
 * Selection for a picked colour: the whole PCCS tone it belongs to.
 * Neutral colours have no tone, so they get the neutral cell at their
 * lightness instead.
 */
export function selectionForColor(p: PccsValue): Selection {
  if (p.s < NEUTRAL_S) return selectionFromPccs(p);
  return { kind: "tone", tone: toneOf(p) };
}
