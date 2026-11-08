import { describe, expect, it } from "vitest";
import {
  encodedToLinear,
  gamutMapOklch,
  hsvToRgb,
  isInGamut,
  labToLinear,
  linearToOklab,
  type Lab,
} from "./color";
import { computeGamutEdge, edgeHits } from "./gamutEdge";
import { pccsReferenceColor, rgbToPccs, toneCenter } from "./pccs";
import table from "@/data/pccs-lab.json";

describe("OKLCH gamut mapping", () => {
  it("keeps OKLCH lightness and hue, lands inside sRGB", () => {
    // dp14 (14:BG-3.5-8s) is outside sRGB.
    const lab = table.lab[13][PCCS_L(3.5)][7] as Lab;
    const lin = labToLinear(lab);
    expect(isInGamut(lin)).toBe(false);
    const mapped = gamutMapOklch(lin);
    expect(isInGamut(mapped)).toBe(true);
    const [L0, a0, b0] = linearToOklab(lin);
    const [L1, a1, b1] = linearToOklab(mapped);
    expect(L1).toBeCloseTo(L0, 3);
    expect(Math.atan2(b1, a1)).toBeCloseTo(Math.atan2(b0, a0), 2);
    expect(Math.hypot(a1, b1)).toBeLessThan(Math.hypot(a0, b0));
  });

  it("leaves in-gamut colours unchanged", () => {
    const lin = encodedToLinear([0.2, 0.5, 0.7]);
    gamutMapOklch(lin).forEach((c, i) => expect(c).toBeCloseTo(lin[i], 9));
  });

  it("reference colours report out-of-gamut", () => {
    expect(pccsReferenceColor(14, 3.5, 8)!.inGamut).toBe(false);
    expect(pccsReferenceColor(2, 8.5, 2)!.inGamut).toBe(true);
  });
});

function PCCS_L(l: number) {
  return table.lightnesses.indexOf(l);
}

describe("approximated region on the picker boundary", () => {
  it("dp14 has no in-gamut pixels but an approximated position on the edge", () => {
    const H = 175;
    const n = 160;
    const c = toneCenter(14, "dp");
    // no in-gamut pixel matches
    let inside = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const p = rgbToPccs(hsvToRgb(H, i / (n - 1), 1 - j / (n - 1)));
        if (Math.abs(p.l - c.l) <= 0.25 && Math.abs(p.s - c.s) <= 0.5) inside++;
      }
    expect(inside).toBe(0);

    const { edge, rayK, rayL, rayS, rayH } = computeGamutEdge(H, n);
    const hits = edgeHits(rayK, rayL, rayS, rayH, (l, s) =>
      Math.abs(l - c.l) <= 0.25 && Math.abs(s - c.s) <= 0.5,
    );
    const idx = [...hits.keys()].filter((e) => hits[e]);
    expect(idx.length).toBeGreaterThan(0);
    // All hits are on the right edge (S = 100%) for this dark colour, and the
    // edge colour there has roughly the target PCCS lightness.
    for (const e of idx) {
      expect(edge[e * 2]).toBe(n - 1);
      const v = 1 - edge[e * 2 + 1] / (n - 1);
      const p = rgbToPccs(hsvToRgb(H, 1, v));
      expect(Math.abs(p.l - c.l)).toBeLessThan(0.6);
    }
  });
});
