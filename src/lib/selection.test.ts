import { describe, expect, it } from "vitest";
import { PCCS_TONES, toneCenter, toneMembership, toneOf, toneRange } from "./pccs";
import { selectionField, selectionForColor, selectionFromPccs } from "./selection";

describe("tone selection", () => {
  it("toneMembership <= 0 exactly where toneOf picks that tone", () => {
    let mismatches = 0;
    for (let h = 1; h <= 24; h += 0.5) {
      for (let l = 1.5; l <= 9.5; l += 0.25) {
        for (let s = 0.6; s <= 10; s += 0.35) {
          const tone = toneOf({ h, l, s });
          for (const { symbol } of PCCS_TONES) {
            const m = toneMembership(h, l, s, symbol);
            if (symbol === tone ? m > 1e-9 : m < -1e-9) mismatches++;
          }
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it("tone range contains the tone centre", () => {
    for (let h = 1; h <= 24; h++) {
      for (const { symbol } of PCCS_TONES) {
        const c = toneCenter(h, symbol);
        const r = toneRange(h, symbol);
        expect(c.l).toBeGreaterThanOrEqual(r.lMin);
        expect(c.l).toBeLessThanOrEqual(r.lMax);
        expect(c.s).toBeGreaterThanOrEqual(r.sMin);
        expect(c.s).toBeLessThanOrEqual(r.sMax);
      }
    }
  });

  it("neutral colours belong to no tone", () => {
    expect(selectionField({ kind: "tone", tone: "g" }, 5, 0.2, 2)).toBeGreaterThan(0);
  });
});

describe("value selection", () => {
  it("the cell made from a colour contains that colour", () => {
    for (const p of [
      { h: 2, l: 4.57, s: 9.35 },
      { h: 8, l: 9.9, s: 3.2 },
      { h: 18, l: 1.1, s: 0.3 },
      { h: 12, l: 5.2, s: 12 },
    ]) {
      const sel = selectionFromPccs(p);
      expect(selectionField(sel, p.l, p.s, p.h)).toBeLessThanOrEqual(0);
    }
  });
});

describe("picking a colour", () => {
  it("selects the whole tone of a chromatic colour, which contains it", () => {
    for (const p of [
      { h: 2, l: 4.57, s: 9.35 },
      { h: 14, l: 3.4, s: 4.2 },
      { h: 20, l: 7.8, s: 2.1 },
    ]) {
      const sel = selectionForColor(p);
      expect(sel).toEqual({ kind: "tone", tone: toneOf(p) });
      expect(selectionField(sel, p.l, p.s, p.h)).toBeLessThanOrEqual(0);
    }
  });

  it("selects the neutral cell for an achromatic colour", () => {
    const sel = selectionForColor({ h: 5, l: 5.1, s: 0.2 });
    expect(sel).toEqual({ kind: "value", l: 5, s: 0 });
  });
});
