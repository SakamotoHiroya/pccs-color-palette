import { describe, expect, it } from "vitest";
import { PCCS_TONES, toneCenter, toneMembership, toneOf, toneRange } from "./pccs";
import { selectionField, selectionFromPccs } from "./selection";

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

