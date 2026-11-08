"use client";

import { rgbToHex } from "@/lib/color";
import { PCCS_TONES, pccsReferenceColor, toneCenter } from "@/lib/pccs";

/**
 * Tone buttons laid out like the PCCS tone map:
 * columns = saturation (2s, 3s, 5s, 6s, 8s, 9s), rows = light -> dark.
 * Each button is painted with the tone's centre colour on the given hue.
 */
const TONE_MAP_POS: Record<string, [col: number, row: number]> = {
  p: [1, 1], ltg: [1, 2], g: [1, 3], dkg: [1, 4],
  "p+": [2, 1],
  lt: [3, 1], sf: [3, 2], d: [3, 3], dk: [3, 4],
  "lt+": [4, 1],
  b: [5, 1], s: [5, 2], dp: [5, 3],
  v: [6, 2],
};

export function ToneButtons({
  hue,
  active,
  current,
  onSelect,
}: {
  /** PCCS hue (1..24). */
  hue: number;
  /** Selected tone (whole-tone selection). */
  active: string | null;
  /** Tone the selected cell belongs to (hint). */
  current: string | null;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="toneMap" role="group" aria-label="トーン">
      {PCCS_TONES.map((t) => {
        const c = toneCenter(hue, t.symbol);
        const ref = pccsReferenceColor(hue, c.l, c.s);
        const [col, row] = TONE_MAP_POS[t.symbol];
        const cls = [
          "toneButton",
          t.symbol === active ? "active" : "",
          t.symbol === current ? "current" : "",
          ref ? "" : "toneEmpty",
        ].join(" ");
        return (
          <button
            key={t.symbol}
            type="button"
            className={cls}
            style={{
              gridColumn: col,
              gridRow: row,
              background: ref ? rgbToHex(ref.rgb) : undefined,
              color: c.l >= 6 ? "#111" : "#fff",
            }}
            onClick={() => onSelect(t.symbol)}
            title={`${t.symbol} ${t.ja}（${t.en}） 中央値 明度 ${c.l.toFixed(1)} / 彩度 ${c.s}s${
              ref && !ref.inGamut ? "（sRGB外：OKLCHで彩度を下げた近似色）" : ""
            }`}
            aria-pressed={t.symbol === active}
          >
            {ref && !ref.inGamut && <span className="approxBadge toneBadge">≈</span>}
            <span className="toneSym">{t.symbol}</span>
            <span className="toneJa">
              {/* allow a line break only after 明るい／暗い (e.g. 明るい|灰み) */}
              {t.ja.split(/(?<=明るい|暗い)/).map((part, i) => (
                <span key={i}>
                  {i > 0 && <wbr />}
                  {part}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
