"use client";

import { useEffect, useMemo, useState } from "react";
import { hsvToRgb, rgbToHex, textOn, type RGB } from "@/lib/color";
import { isoSegments } from "@/lib/contour";
import { edgeHits } from "@/lib/gamutEdge";
import {
  TONE_BY_SYMBOL,
  PCCS_LIGHTNESSES,
  colorName,
  formatPccs,
  hueName,
  neutralColor,
  pccsReferenceColor,
  roundHalf,
  hueCode,
  rgbToPccs,
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
  selectionFromPccs,
} from "@/lib/selection";
import { HueWheel } from "./HueWheel";
import { type MapHover, PccsMap } from "./PccsMap";
import { PccsSlider } from "./PccsSlider";
import { SvSquare, type Region } from "./SvSquare";
import { ToneButtons } from "./ToneButtons";
import { usePccsField } from "./usePccsField";

const FIELD_N = 160; // sampling grid of the HSB square

const SAT_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // 0 = neutral (n)

const css = (rgb: RGB) => rgbToHex(rgb);
const satLabel = (s: number) => (s === 0 ? "n" : `${s}s`);
const fmtRange = (a: number, b: number, f: (x: number) => string) =>
  a === b ? f(a) : `${f(a)} – ${f(b)}`;
/**
 * Signed band field for a range of scale values [lo, hi] widened by half a
 * step: <= 0 inside. Ends of the scale (scaleMin / scaleMax) are open.
 */
function bandField(x: number, lo: number, hi: number, half: number, scaleMin: number, scaleMax: number) {
  const below = lo <= scaleMin ? -Infinity : lo - half - x;
  const above = hi >= scaleMax ? -Infinity : x - (hi + half);
  return Math.max(below, above) / half;
}

const INITIAL = { hue: 350, sat: 0.75, val: 0.8 };

export default function PccsPalette() {
  const [hue, setHue] = useState(INITIAL.hue);
  const [sat, setSat] = useState(INITIAL.sat);
  const [val, setVal] = useState(INITIAL.val);
  const [selection, setSelection] = useState<Selection>(() =>
    selectionFromPccs(rgbToPccs(hsvToRgb(INITIAL.hue, INITIAL.sat, INITIAL.val))),
  );
  const [showBands, setShowBands] = useState(true);
  const [dimOutside, setDimOutside] = useState(false);
  // Picker click: also switch the highlighted range to the clicked colour's
  // cell (on), or keep the current range (off).
  const [followPick, setFollowPick] = useState(false);

  const field = usePccsField(hue, FIELD_N);

  const selected = useMemo(() => hsvToRgb(hue, sat, val), [hue, sat, val]);
  const selectedPccs = useMemo(() => rgbToPccs(selected), [selected]);
  const selectedNotation = formatPccs(selectedPccs);

  // Reference PCCS hue: the selected colour's hue, or (for near-neutral
  // selections) the hue of the picker's pure colour.
  const refHue = useMemo(() => {
    const h = selectedPccs.s >= 0.5 ? selectedPccs.h : rgbToPccs(hsvToRgb(hue, 1, 1)).h;
    return (Math.round(h - 1) % 24) + 1;
  }, [hue, selectedPccs]);

  // Hovering the map previews that cell / tone on the picker.
  const [hovered, setHovered] = useState<MapHover | null>(null);
  const shown = useMemo<Selection>(
    () =>
      hovered
        ? hovered.target === "tone"
          ? { kind: "tone", tone: hovered.tone }
          : { kind: "value", l: hovered.l, s: hovered.s }
        : selection,
    [hovered, selection],
  );

  // Lightness / saturation extent of the shown selection (tone extents use
  // the reference hue) — used for the band boundary lines.
  const ranges = useMemo(() => {
    if (shown.kind === "value") {
      return { lMin: shown.l, lMax: shown.l, sMin: shown.s, sMax: shown.s };
    }
    return toneRange(refHue, shown.tone);
  }, [shown, refHue]);

  const activeTone = selection.kind === "tone" ? selection.tone : null;
  // Tone that the selected cell belongs to (hint on the tone buttons).
  const valueTone =
    selection.kind === "value" && selection.s > 0
      ? toneOf({ h: refHue, l: selection.l, s: selection.s })
      : null;

  // Slider ranges for the (non-hover) selection; tone extents use the reference hue.
  const selRanges = useMemo(
    () =>
      selection.kind === "value"
        ? { lMin: selection.l, lMax: selection.l, sMin: selection.s, sMax: selection.s }
        : toneRange(refHue, selection.tone),
    [selection, refHue],
  );
  const lMid = roundHalf((selRanges.lMin + selRanges.lMax) / 2);
  const sMid = Math.round((selRanges.sMin + selRanges.sMax) / 2);
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

  const describe = (sel: Selection) => {
    if (sel.kind === "tone") {
      const t = TONE_BY_SYMBOL[sel.tone];
      return { main: `${sel.tone} ${t.ja}`, sub: `${t.en} ／ トーン全体` };
    }
    const n = formatPccs({ h: refHue, l: sel.l, s: sel.s });
    if (n.neutral) return { main: n.long, sub: `無彩色 ${n.short}` };
    const tone = toneOf({ h: refHue, l: sel.l, s: sel.s });
    return { main: n.long, sub: `${n.short}（${TONE_BY_SYMBOL[tone].ja}）の 1 区画` };
  };
  const mapHeadline = hovered
    ? { ...describe(shown), sub: `${describe(shown).sub} ／ プレビュー中` }
    : describe(selection);

  const region = useMemo<Region | null>(() => {
    if (!field) return null;
    const { n, l, s, h } = field;
    const reg = new Float32Array(n * n);
    let inside = 0;
    for (let k = 0; k < n * n; k++) {
      reg[k] = selectionField(shown, l[k], s[k], h[k]);
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
      (rl, rs, rh) => selectionField(shown, rl, rs, rh) <= 0,
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
  }, [field, shown, ranges]);

  // Picking a colour shows the PCCS cell containing it (if enabled).
  const pickColor = (h: number, s: number, v: number) => {
    setHue(h);
    setSat(s);
    setVal(v);
    if (followPick) setSelection(selectionFromPccs(rgbToPccs(hsvToRgb(h, s, v))));
  };

  const rgb255 = selected.map((c) => Math.round(c * 255));

  // Tab title follows the selected colour name, e.g. "Palette 深い青".
  const name = colorName(selectedPccs);
  useEffect(() => {
    document.title = `Palette ${name}`;
  }, [name]);

  return (
    <>
      <header className="siteHeader">
        <span className="siteTitle">PCCS Color Palette</span>
      </header>

      <div className="app">
        <main className="layout">
          {/* ---- Left: selected colour, hue + sliders, display settings ---- */}
          <section className="leftColumn" aria-label="選択色・色相・表示設定">
            <section
              className="card selCard"
              style={{ background: css(selected), color: textOn(selected) }}
              aria-label="選択色"
            >
              <h1 className="colorName" aria-live="polite">
                {name}
              </h1>
              <div className="selMain">
                <span>
                  <span className="mono">{selectedNotation.short}</span>{" "}
                  {selectedNotation.neutral
                    ? "無彩色"
                    : `${TONE_BY_SYMBOL[toneOf(selectedPccs)].ja}（${TONE_BY_SYMBOL[toneOf(selectedPccs)].en}）`}
                </span>
                <CopyCode code={css(selected).toUpperCase()} />
              </div>
              <div className="selSub mono">
                <span>RGB {rgb255.join(", ")}</span>
                <span>
                  HSB {Math.round(hue)}°, {Math.round(sat * 100)}%, {Math.round(val * 100)}%
                </span>
              </div>
            </section>

            {/* Hue circle with the PCCS lightness / saturation sliders beside it */}
            <section className="card hueCard">
              <h2>色相・PCCS 明度・彩度</h2>
              <div className="hueSliders">
                <div className="wheelHolder">
                  <HueWheel hue={hue} onChange={setHue} ring={11} gap={2} className="wheelSmall">
                    <div className="hueCenter">
                      <span className="hueValueBig mono">{Math.round(hue)}°</span>
                      <span className="muted small">
                        {hueCode(refHue)} {hueName(refHue)}
                      </span>
                    </div>
                  </HueWheel>
                </div>
                <div className="sliders">
                  <div className="sliderBlock">
                    <div className="sliderHead">
                      <span className="sliderName">明度</span>
                      <span className="mid mono">
                        {fmtRange(selRanges.lMin, selRanges.lMax, (x) => x.toFixed(1))}
                      </span>
                    </div>
                    <PccsSlider
                      label="PCCS明度"
                      min={L_MIN}
                      max={L_MAX}
                      step={0.5}
                      lo={selRanges.lMin}
                      hi={selRanges.lMax}
                      background={lightTrack}
                      ticks={[1.5, 3.5, 5.5, 7.5, 9.5].map((v) => ({ value: v, label: v.toFixed(1) }))}
                      valueText={(v) => `明度 ${v.toFixed(1)}`}
                      onChange={(l) => setSelection({ kind: "value", l, s: sMid })}
                    />
                  </div>
                  <div className="sliderBlock">
                    <div className="sliderHead">
                      <span className="sliderName">彩度</span>
                      <span className="mid mono">{fmtRange(selRanges.sMin, selRanges.sMax, satLabel)}</span>
                    </div>
                    <PccsSlider
                      label="PCCS彩度"
                      min={0}
                      max={S_MAX}
                      step={1}
                      lo={selRanges.sMin}
                      hi={selRanges.sMax}
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
                </div>
              </div>
            </section>

            <section className="card settingsCard">
              <h2>表示設定</h2>
              <div className="toggles">
                <Toggle checked={followPick} onChange={setFollowPick}>
                  クリックした色の区画を表示
                </Toggle>
                <Toggle checked={showBands} onChange={setShowBands}>
                  明度帯・彩度帯の境界線
                </Toggle>
                <Toggle checked={dimOutside} onChange={setDimOutside}>
                  範囲外を暗く表示
                </Toggle>
              </div>
            </section>
          </section>

          {/* ---- Centre: HSB picker ---- */}
          <section className="centerColumn" aria-label="カラーピッカー">
            <div className="pickerBox">
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
              <div className="axisNote">
                <span>横軸: 彩度 S</span>
                <span>縦軸: 明度 B（HSB）</span>
              </div>
            </div>
          </section>

          {/* ---- Right: map, tones ---- */}
          <aside className="controls">
            <section
              className="card mapCard"
              title="マスをクリック: その区画を選択 ／ トーン記号のクリック・マスのダブルクリック: トーン全体を選択 ／ 矢印キーで移動、Enterでトーン全体"
            >
              <div className="cardHead">
                <h2>PCCS 明度×彩度マップ</h2>
                <span className="muted small legendInline">
                  <span className="mapApproxKey" /> sRGB外 ○ 選択色
                </span>
              </div>
              <div className="mapHead">
                <span className="mapHeadMain mono">{mapHeadline.main}</span>
                <span className="muted small">{mapHeadline.sub}</span>
              </div>
              <div className="mapBox">
                <PccsMap
                  hue={refHue}
                  selection={selection}
                  selected={selectedPccs}
                  onSelectCell={(l, s) => setSelection({ kind: "value", l, s })}
                  onSelectTone={(tone) => setSelection({ kind: "tone", tone })}
                  onHover={setHovered}
                />
              </div>
            </section>

            <section className="card toneCard">
              <h2>PCCS トーン</h2>
              <p className="muted small toneNote">
                {activeTone
                  ? `${activeTone}（${TONE_BY_SYMBOL[activeTone].ja}）の範囲を表示中`
                  : valueTone
                    ? `現在の区画は ${valueTone}（${TONE_BY_SYMBOL[valueTone].ja}）`
                    : "押すとトーン全体を表示"}
                ／ 色相 {hueCode(refHue)} 基準
              </p>
              <ToneButtons
                hue={refHue}
                active={activeTone}
                current={valueTone}
                onSelect={(tone) => setSelection({ kind: "tone", tone })}
              />
            </section>
          </aside>
        </main>
      </div>

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
    </>
  );
}

/** On/off switch (a checkbox styled as a sliding toggle). */
function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="toggle">
      <span>{children}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** Colour code that copies itself to the clipboard on click. */
function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="copyCode mono"
      onClick={() => {
        navigator.clipboard?.writeText(code).then(
          () => setCopied(true),
          () => {},
        );
      }}
      aria-label={`カラーコード ${code} をコピー`}
    >
      {code}
      {copied ? (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="copyIcon">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true" className="copyIcon">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )}
    </button>
  );
}
