"use client";

import { useEffect, useMemo, useState } from "react";
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, type RGB } from "@/lib/color";
import { isoSegments } from "@/lib/contour";
import { edgeHits } from "@/lib/gamutEdge";
import {
  TONE_BY_SYMBOL,
  formatPccs,
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
import { SvSquare, type Region } from "./SvSquare";
import { usePccsField } from "./usePccsField";

const FIELD_N = 160; // sampling grid of the HSB square

const css = (rgb: RGB) => rgbToHex(rgb);
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
  const [dimOutside, setDimOutside] = useState(true);
  // Picker click: also switch the highlighted range to the clicked colour's
  // cell (on), or keep the current range (off).
  const [followPick, setFollowPick] = useState(true);

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

  // Is the selected colour on the boundary at an approximated position?
  const selectedIsApprox = useMemo(() => {
    if (!region || region.hue !== hue) return false;
    const n = region.n;
    let e = -1;
    if (val >= 0.995) e = Math.round(sat * (n - 1));
    else if (sat >= 0.995) e = n - 1 + Math.round((1 - val) * (n - 1));
    return e >= 0 && e < region.hits.length && region.hits[e] === 1;
  }, [region, hue, sat, val]);

  // Picking a colour shows the PCCS cell containing it (if enabled).
  const pickColor = (h: number, s: number, v: number) => {
    setHue(h);
    setSat(s);
    setVal(v);
    if (followPick) setSelection(selectionFromPccs(rgbToPccs(hsvToRgb(h, s, v))));
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
          ピッカーをクリックするとその色を含むPCCSの区画を、PCCSマップのマスやトーン記号を押すとその区画・トーン全体を囲んで表示します
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
              <input type="checkbox" checked={followPick} onChange={(e) => setFollowPick(e.target.checked)} />
              クリックした色の区画を表示
            </label>
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
          {/* ---- PCCS lightness × saturation map ---- */}
          <section className="card">
            <h2>PCCS 明度・彩度・トーン</h2>
            <div className="mapHead">
              <span className="mapHeadMain mono">{mapHeadline.main}</span>
              <span className="muted small">{mapHeadline.sub}</span>
            </div>
            <PccsMap
              hue={refHue}
              selection={selection}
              selected={selectedPccs}
              onSelectCell={(l, s) => setSelection({ kind: "value", l, s })}
              onSelectTone={(tone) => setSelection({ kind: "tone", tone })}
              onHover={setHovered}
            />
            <p className="muted small hint">
              色相 {hueCode(refHue)} の明度（縦）×彩度（横）。マスをクリックでその区画、
              トーン記号のクリックかマスのダブルクリックでトーン全体を選択。
              <span className="mapApproxKey" /> = sRGB外（近似色）、○ = 選択色の位置
            </p>
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
