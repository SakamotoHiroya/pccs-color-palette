"use client";

import { useEffect, useMemo, useState } from "react";
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, type RGB } from "@/lib/color";
import { isoSegments } from "@/lib/contour";
import { edgeHits } from "@/lib/gamutEdge";
import {
  PCCS_LIGHTNESSES,
  PCCS_TONES,
  TONE_BY_SYMBOL,
  formatPccs,
  hueCode,
  neutralColor,
  pccsReferenceColor,
  rgbToPccs,
  roundHalf,
  toneCenter,
  toneOf,
  toneRange,
} from "@/lib/pccs";
import {
  L_HALF,
  L_MAX,
  L_MIN,
  S_HALF,
  S_MAX,
  type Selection,
  selectionField,
  selectionForColor,
} from "@/lib/selection";
import { HueWheel } from "./HueWheel";
import { PccsSlider } from "./PccsSlider";
import { SvSquare, type Region } from "./SvSquare";
import { usePccsField } from "./usePccsField";

const FIELD_N = 160; // sampling grid of the HSB square
const SAT_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // 0 = neutral (n)

const css = (rgb: RGB) => rgbToHex(rgb);
const satLabel = (s: number) => (s === 0 ? "n" : `${s}s`);
/**
 * Signed band field for a range of scale values [lo, hi] widened by half a
 * step: <= 0 inside. Ends of the scale (scaleMin / scaleMax) are open.
 */
function bandField(x: number, lo: number, hi: number, half: number, scaleMin: number, scaleMax: number) {
  const below = lo <= scaleMin ? -Infinity : lo - half - x;
  const above = hi >= scaleMax ? -Infinity : x - (hi + half);
  return Math.max(below, above) / half;
}

const fmtRange = (a: number, b: number, f: (x: number) => string) =>
  a === b ? f(a) : `${f(a)} – ${f(b)}`;

const INITIAL = { hue: 350, sat: 0.75, val: 0.8 };

export default function PccsPalette() {
  const [hue, setHue] = useState(INITIAL.hue);
  const [sat, setSat] = useState(INITIAL.sat);
  const [val, setVal] = useState(INITIAL.val);
  const [selection, setSelection] = useState<Selection>(() =>
    selectionForColor(rgbToPccs(hsvToRgb(INITIAL.hue, INITIAL.sat, INITIAL.val))),
  );
  const [showBands, setShowBands] = useState(true);
  const [dimOutside, setDimOutside] = useState(true);

  const field = usePccsField(hue, FIELD_N);

  const selected = useMemo(() => hsvToRgb(hue, sat, val), [hue, sat, val]);
  const selectedPccs = useMemo(() => rgbToPccs(selected), [selected]);
  const selectedNotation = formatPccs(selectedPccs);
  const selectedTone = selectedNotation.neutral ? null : toneOf(selectedPccs);

  // Reference PCCS hue: the selected colour's hue, or (for near-neutral
  // selections) the hue of the picker's pure colour.
  const refHue = useMemo(() => {
    const h = selectedPccs.s >= 0.5 ? selectedPccs.h : rgbToPccs(hsvToRgb(hue, 1, 1)).h;
    return (Math.round(h - 1) % 24) + 1;
  }, [hue, selectedPccs]);

  // Slider ranges for the current selection (tone extents use the reference hue).
  const ranges = useMemo(() => {
    if (selection.kind === "value") {
      return { lMin: selection.l, lMax: selection.l, sMin: selection.s, sMax: selection.s };
    }
    return toneRange(refHue, selection.tone);
  }, [selection, refHue]);
  const lMid = roundHalf((ranges.lMin + ranges.lMax) / 2);
  const sMid = Math.round((ranges.sMin + ranges.sMax) / 2);


  const activeTone = selection.kind === "tone" ? selection.tone : null;
  // Tone that the selected value cell belongs to (hint only).
  const valueTone =
    selection.kind === "value" && selection.s > 0
      ? toneOf({ h: refHue, l: selection.l, s: selection.s })
      : null;

  const lightTrack = useMemo(
    () =>
      `linear-gradient(to right, ${PCCS_LIGHTNESSES.map((l) => css(neutralColor(l))).join(", ")})`,
    [],
  );
  const satColors = useMemo(
    () => SAT_STEPS.map((s) => pccsReferenceColor(refHue, lMid, s)),
    [refHue, lMid],
  );
  const satTrack = `linear-gradient(to right, ${satColors
    .map((c) => (c ? css(c.rgb) : "transparent"))
    .join(", ")})`;
  const satApprox = satColors.map((c) => !c || !c.inGamut);

  const region = useMemo<Region | null>(() => {
    if (!field) return null;
    const { n, l, s, h } = field;
    const reg = new Float32Array(n * n);
    let inside = 0;
    for (let k = 0; k < n * n; k++) {
      reg[k] = selectionField(selection, l[k], s[k], h[k]);
      if (reg[k] <= 0) inside++;
    }

    // Lightness / saturation band boundaries for the slider ranges
    // (a single cell, or the extent of the selected tone).
    const lb = new Float32Array(n * n);
    const sb = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) {
      lb[k] = bandField(l[k], ranges.lMin, ranges.lMax, L_HALF, L_MIN, L_MAX);
      sb[k] = bandField(s[k], ranges.sMin, ranges.sMax, S_HALF, -Infinity, S_MAX);
    }
    const lightSegs = isoSegments(lb, n);
    const satSegs = isoSegments(sb, n);

    // Out-of-gamut part: boundary points where those PCCS colours land after
    // OKLCH chroma reduction. Group consecutive hits into polylines.
    const hits = edgeHits(
      field.rayK,
      field.rayL,
      field.rayS,
      field.rayH,
      (rl, rs, rh) => selectionField(selection, rl, rs, rh) <= 0,
    );
    const approxRuns: number[][] = [];
    let run: number[] | null = null;
    let approxCount = 0;
    for (let e = 0; e < hits.length; e++) {
      if (hits[e]) {
        approxCount++;
        if (!run) approxRuns.push((run = []));
        run.push(field.edge[e * 2], field.edge[e * 2 + 1]);
      } else {
        run = null;
      }
    }

    return {
      n,
      hue: field.hue,
      reg,
      inside,
      regionSegs: isoSegments(reg, n),
      lightSegs,
      satSegs,
      hits,
      approxRuns,
      approxCount,
    };
  }, [field, selection, ranges]);

  // Is the selected colour on the boundary at an approximated position?
  const selectedIsApprox = useMemo(() => {
    if (!region || region.hue !== hue) return false;
    const n = region.n;
    let e = -1;
    if (val >= 0.995) e = Math.round(sat * (n - 1));
    else if (sat >= 0.995) e = n - 1 + Math.round((1 - val) * (n - 1));
    return e >= 0 && e < region.hits.length && region.hits[e] === 1;
  }, [region, hue, sat, val]);

  // Picking a colour shows the whole PCCS tone it belongs to.
  const pickColor = (h: number, s: number, v: number) => {
    setHue(h);
    setSat(s);
    setVal(v);
    setSelection(selectionForColor(rgbToPccs(hsvToRgb(h, s, v))));
  };

  const [hexInput, setHexInput] = useState("");
  useEffect(() => setHexInput(rgbToHex(selected)), [selected]);
  const commitHex = () => {
    const rgb = hexToRgb(hexInput);
    if (!rgb) return setHexInput(rgbToHex(selected));
    const [h, s, v] = rgbToHsv(rgb);
    pickColor(s > 0 ? h : hue, s, v);
  };

  const rgb255 = selected.map((c) => Math.round(c * 255));

  return (
    <div className="app">
      <header className="header">
        <h1>PCCS Color Palette</h1>
        <p>
          ピッカーをクリックするとその色が属するPCCSトーンの範囲全体を、トーンを押すとそのトーンの範囲を囲んで表示します
        </p>
      </header>

      <main className="layout">
        <section className="pickerColumn" aria-label="カラーピッカー">
          <HueWheel hue={hue} onChange={setHue}>
            <SvSquare
              hue={hue}
              sat={sat}
              val={val}
              onPick={(s, v) => pickColor(hue, s, v)}
              region={region}
              showBands={showBands}
              dimOutside={dimOutside}
              stale={!field || field.hue !== hue}
            />
          </HueWheel>
          <div className="axisNote">
            <span>外周: 色相 H</span>
            <span>横軸: 彩度 S ／ 縦軸: 明度 B (HSB)</span>
          </div>
          <div className="viewOptions">
            <label className="check">
              <input type="checkbox" checked={showBands} onChange={(e) => setShowBands(e.target.checked)} />
              明度帯・彩度帯の境界線
            </label>
            <label className="check">
              <input type="checkbox" checked={dimOutside} onChange={(e) => setDimOutside(e.target.checked)} />
              範囲外を暗く表示
            </label>
          </div>
        </section>

        <aside className="panel">
          {/* ---- PCCS lightness & saturation ---- */}
          <section className="card">
            <h2>PCCS 明度・彩度</h2>
            <div className="sliderBlock">
              <div className="sliderHead">
                <span className="sliderName">明度</span>
                <span className="mid mono">
                  {fmtRange(ranges.lMin, ranges.lMax, (x) => x.toFixed(1))}
                </span>
              </div>
              <PccsSlider
                label="PCCS明度"
                min={L_MIN}
                max={L_MAX}
                step={0.5}
                lo={ranges.lMin}
                hi={ranges.lMax}
                background={lightTrack}
                ticks={[1.5, 3.5, 5.5, 7.5, 9.5].map((v) => ({ value: v, label: v.toFixed(1) }))}
                valueText={(v) => `明度 ${v.toFixed(1)}`}
                onChange={(l) => setSelection({ kind: "value", l, s: sMid })}
              />
            </div>
            <div className="sliderBlock">
              <div className="sliderHead">
                <span className="sliderName">彩度</span>
                <span className="mid mono">{fmtRange(ranges.sMin, ranges.sMax, satLabel)}</span>
              </div>
              <PccsSlider
                label="PCCS彩度"
                min={0}
                max={S_MAX}
                step={1}
                lo={ranges.sMin}
                hi={ranges.sMax}
                background={satTrack}
                ticks={SAT_STEPS.map((v) => ({
                  value: v,
                  label: v === 0 ? "n" : `${v}`,
                  approx: v > 0 && satApprox[v],
                }))}
                valueText={(v) => (v === 0 ? "無彩色" : `彩度 ${v}s`)}
                onChange={(s) => setSelection({ kind: "value", l: lMid, s })}
              />
            </div>
            <p className="muted small hint">
              n = 無彩色。
              {satApprox.some(Boolean) && (
                <>
                  <span className="approxBadge">≈</span> = sRGB外（近似色で表示）。
                </>
              )}
              {selection.kind === "tone" && "トーン選択中は、そのトーンに含まれる明度・彩度の幅を枠で表示しています。"}
            </p>
          </section>

          {/* ---- PCCS tones ---- */}
          <section className="card">
            <h2>PCCS トーン</h2>
            <p className="muted small toneNote">
              {activeTone
                ? `${activeTone}（${TONE_BY_SYMBOL[activeTone].ja}）のすべての範囲を表示中`
                : valueTone
                  ? `現在の区画は ${valueTone}（${TONE_BY_SYMBOL[valueTone].ja}）に属します。クリックでトーン全体を表示`
                  : "クリックでそのトーンのすべての範囲を表示"}
              ／ 色相 {hueCode(refHue)} 基準
            </p>
            <ToneMap
              hue={refHue}
              active={activeTone}
              current={valueTone}
              onSelect={(tone) => setSelection({ kind: "tone", tone })}
            />
          </section>

          {/* ---- Selected colour ---- */}
          <section className="card">
            <h2>選択色</h2>
            <div className="chipRow">
              <div className="chip" style={{ background: css(selected) }} />
              <div className="chipText">
                <input
                  className="hexInput mono"
                  value={hexInput}
                  onChange={(e) => setHexInput(e.target.value)}
                  onBlur={commitHex}
                  onKeyDown={(e) => e.key === "Enter" && commitHex()}
                  aria-label="HEX"
                  spellCheck={false}
                />
                <div className="muted small mono">
                  RGB {rgb255.join(", ")} ／ HSB {Math.round(hue)}°, {Math.round(sat * 100)}%,{" "}
                  {Math.round(val * 100)}%
                </div>
              </div>
            </div>
            <dl className="pccsInfo">
              <dt>PCCS</dt>
              <dd className="mono">{selectedNotation.long}</dd>
              <dt>トーン</dt>
              <dd>
                <span className="mono">{selectedNotation.short}</span>
                <span className="muted">
                  {selectedTone
                    ? ` ${TONE_BY_SYMBOL[selectedTone].ja}（${TONE_BY_SYMBOL[selectedTone].en}）`
                    : " 無彩色"}
                </span>
              </dd>
              <dt>推定値</dt>
              <dd className="mono small">
                {selectedNotation.neutral ? "—" : `h ${selectedPccs.h.toFixed(1)}`} ／ 明度{" "}
                {selectedPccs.l.toFixed(2)} ／ 彩度 {selectedPccs.s.toFixed(2)}s
              </dd>
            </dl>
            {selectedIsApprox && (
              <p className="approxNote">
                <span className="approxBadge">≈</span>
                この位置は、囲んでいる範囲のうちsRGB外の色を、彩度を下げて近似した位置でもあります
              </p>
            )}

          </section>
        </aside>
      </main>

      <footer className="footer">
        <p>
          PCCSの明度・彩度は人間の視感評価に基づく尺度であり、RGBやHSBの値から単純計算はできません。
          本アプリでは Python の <code>pccs</code> ライブラリ（Kobayashi &amp; Yoshiki, 2001
          の PCCS–マンセル関係式）と、視感実験に基づくマンセル再表記データ（colour-science）で
          全PCCSパターンをCIELABに変換した参照表を作り、各ピクセルの色をその参照表上に位置づけて
          PCCSの明度・彩度を求めています。トーンは同論文のトーン座標で判定しています。
          sRGBで表示できない色は、OKLCHで明度・色相を保ったまま彩度を下げて近似表示しています（≈）。
        </p>
      </footer>
    </div>
  );
}

/**
 * Tone buttons laid out like the PCCS tone map:
 * columns = saturation (2s, 3s, 5s, 6s, 8s, 9s), rows = light -> dark.
 */
const TONE_MAP_POS: Record<string, [col: number, row: number]> = {
  p: [1, 1], ltg: [1, 2], g: [1, 3], dkg: [1, 4],
  "p+": [2, 1],
  lt: [3, 1], sf: [3, 2], d: [3, 3], dk: [3, 4],
  "lt+": [4, 1],
  b: [5, 1], s: [5, 2], dp: [5, 3],
  v: [6, 2],
};

function ToneMap({
  hue,
  active,
  current,
  onSelect,
}: {
  hue: number;
  active: string | null;
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
          ref ? "" : "chipEmpty",
        ].join(" ");
        return (
          <button
            key={t.symbol}
            type="button"
            className={cls}
            style={{
              gridColumn: col,
              gridRow: row,
              background: ref ? css(ref.rgb) : undefined,
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
