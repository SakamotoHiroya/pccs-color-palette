import { describe, expect, it } from "vitest";
import full from "../../data/pccs-patterns.json";
import { hsvToRgb, rgbToHsv, rgbToLab, labToRgb, type RGB } from "./color";
import { PCCS_TONES, formatPccs, lightnessFromLstar, rgbToPccs, toneCenter, toneOf } from "./pccs";

type Pattern = {
  hue: number;
  lightness: number;
  saturation: number;
  color: { srgb: number[]; inGamut: boolean } | null;
};

const inGamut = (full.patterns as Pattern[]).filter((p) => p.color?.inGamut);

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
};

describe("color conversions", () => {
  it("HSV round trip", () => {
    const rgb = hsvToRgb(200, 0.6, 0.8);
    const [h, s, v] = rgbToHsv(rgb);
    expect(h).toBeCloseTo(200, 6);
    expect(s).toBeCloseTo(0.6, 6);
    expect(v).toBeCloseTo(0.8, 6);
  });

  it("Lab round trip", () => {
    const rgb: RGB = [0.2, 0.5, 0.9];
    const back = labToRgb(rgbToLab(rgb)).rgb;
    back.forEach((c, i) => expect(c).toBeCloseTo(rgb[i], 5));
  });
});

describe("PCCS estimation reproduces the exported reference patterns", () => {
  it(`has in-gamut reference patterns (${inGamut.length})`, () => {
    expect(inGamut.length).toBeGreaterThan(2000);
  });

  it("lightness / saturation / hue match for every in-gamut pattern", () => {
    let maxDl = 0, maxDs = 0, maxDh = 0, sOver01 = 0;
    for (const p of inGamut) {
      const est = rgbToPccs(p.color!.srgb as RGB);
      const ds = Math.abs(est.s - p.saturation);
      maxDl = Math.max(maxDl, Math.abs(est.l - p.lightness));
      maxDs = Math.max(maxDs, ds);
      maxDh = Math.max(maxDh, hueDiff(est.h, p.hue));
      if (ds > 0.1) sOver01++;
    }
    // Lightness is offset slightly (<0.035) because the Bradford C->D65
    // adaptation does not preserve Y exactly for chromatic samples; near the
    // renotation boundary (l=9.0, high s, yellow-green) that small offset is
    // amplified in s. Everywhere else grid points are reproduced closely.
    expect(maxDl).toBeLessThan(0.035);
    expect(maxDh).toBeLessThan(0.05);
    expect(maxDs).toBeLessThan(0.3);
    expect(sOver01 / inGamut.length).toBeLessThan(0.01);
  });

  it("formats notation of grid points", () => {
    const p = (full.patterns as Pattern[]).find(
      (x) => x.hue === 2 && x.lightness === 4.5 && x.saturation === 9,
    )!;
    // Use a pale (clearly in-gamut) pattern for the round trip.
    const q = inGamut.find((x) => x.hue === 2 && x.lightness === 8.5 && x.saturation === 2)!;
    expect(p).toBeTruthy();
    expect(formatPccs(rgbToPccs(q.color!.srgb as RGB))).toEqual({
      short: "p2",
      long: "2:R-8.5-2s",
      neutral: false,
    });
  });

  it("neutral greys", () => {
    expect(lightnessFromLstar(100)).toBeGreaterThan(9.5);
    expect(formatPccs(rgbToPccs([0.5, 0.5, 0.5])).neutral).toBe(true);
  });
});

describe("tones", () => {
  type ToneRow = { tone: string; hue: number; lightness: number; saturation: number };

  it("tone centres match the pccs library (pccs_tone_to_lightness_and_saturation)", () => {
    for (const t of full.tones as ToneRow[]) {
      expect(toneCenter(t.hue, t.tone), t.tone + t.hue).toEqual({ l: t.lightness, s: t.saturation });
    }
  });

  it("every tone centre is classified as its own tone", () => {
    for (let h = 1; h <= 24; h++) {
      for (const { symbol } of PCCS_TONES) {
        const c = toneCenter(h, symbol);
        expect(toneOf({ h, l: c.l, s: c.s }), symbol + h).toBe(symbol);
      }
    }
  });
});
