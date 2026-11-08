"use client";

import { useMemo, useState } from "react";
import { rgbToHex } from "@/lib/color";
import {
  PCCS_LIGHTNESSES,
  type PccsValue,
  TONE_BY_SYMBOL,
  neutralColor,
  pccsReferenceColor,
  toneCenter,
  toneOf,
} from "@/lib/pccs";
import type { Selection } from "@/lib/selection";

/**
 * PCCS lightness × saturation map for one hue: every official grid cell
 * (lightness 9.5 .. 1.5 by 0.5, saturation n, 1s .. 9s) painted with its
 * colour, with tone boundaries and tone symbols — i.e. the PCCS tone map of
 * that hue, computed from the reference data.
 */

const ROWS = [...PCCS_LIGHTNESSES].reverse(); // 9.5 (top) .. 1.5 (bottom)
const COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // 0 = neutral (n)
const LW = 24; // row-label column width
const HH = 14; // header height
const CW = 28; // cell width
const CH = 15; // cell height
const W = LW + COLS.length * CW;
const H = HH + ROWS.length * CH;

interface MapCell {
  l: number;
  s: number;
  /** Tone symbol, or "n" for the neutral column. */
  tone: string;
}

/** What the pointer is over: a single cell, or a tone symbol. */
export interface MapHover extends MapCell {
  target: "cell" | "tone";
}

interface Cell extends MapCell {
  row: number;
  col: number;
  fill: string | null; // null: outside Munsell Renotation (no colour)
  inGamut: boolean;
}

const cx = (col: number) => LW + col * CW;
const cy = (row: number) => HH + row * CH;

export function PccsMap({
  hue,
  selection,
  selected,
  onSelectCell,
  onSelectTone,
  onHover,
}: {
  /** PCCS hue (1..24) the map is drawn for. */
  hue: number;
  selection: Selection;
  /** Estimated PCCS value of the selected colour (drawn as a dot). */
  selected: PccsValue;
  onSelectCell: (l: number, s: number) => void;
  onSelectTone: (tone: string) => void;
  onHover: (hover: MapHover | null) => void;
}) {
  const cells = useMemo<Cell[][]>(
    () =>
      ROWS.map((l, row) =>
        COLS.map((s, col) => {
          if (s === 0) {
            return { row, col, l, s, tone: "n", fill: rgbToHex(neutralColor(l)), inGamut: true };
          }
          const ref = pccsReferenceColor(hue, l, s);
          return {
            row,
            col,
            l,
            s,
            tone: toneOf({ h: hue, l, s }),
            fill: ref ? rgbToHex(ref.rgb) : null,
            inGamut: ref?.inGamut ?? false,
          };
        }),
      ),
    [hue],
  );
  const flat = useMemo(() => cells.flat(), [cells]);
  const [hover, setHover] = useState<MapHover | null>(null);
  const hoverTo = (h: MapHover | null) => {
    setHover(h);
    onHover(h);
  };

  // Lines between cells of different tones.
  const toneBorders = useMemo(() => {
    let d = "";
    for (const c of flat) {
      const right = cells[c.row][c.col + 1];
      const below = cells[c.row + 1]?.[c.col];
      if (right && right.tone !== c.tone) d += `M${cx(c.col + 1)} ${cy(c.row)}v${CH}`;
      if (below && below.tone !== c.tone) d += `M${cx(c.col)} ${cy(c.row + 1)}h${CW}`;
    }
    return d;
  }, [cells, flat]);

  // One label per tone, on the member cell nearest to the tone's centroid.
  const labels = useMemo(() => {
    const groups = new Map<string, Cell[]>();
    for (const c of flat) {
      if (c.tone === "n") continue;
      groups.set(c.tone, [...(groups.get(c.tone) ?? []), c]);
    }
    return [...groups.entries()].map(([tone, members]) => {
      const mr = members.reduce((a, c) => a + c.row, 0) / members.length;
      const mc = members.reduce((a, c) => a + c.col, 0) / members.length;
      const at = members.reduce((best, c) =>
        (c.row - mr) ** 2 + (c.col - mc) ** 2 < (best.row - mr) ** 2 + (best.col - mc) ** 2 ? c : best,
      );
      return { tone, at };
    });
  }, [flat]);

  const inSelection = (c: Cell) =>
    selection.kind === "tone"
      ? c.tone === selection.tone
      : c.l === selection.l && c.s === selection.s;

  // Outline (path) of a set of cells.
  const outline = (member: (c: Cell) => boolean) => {
    const sel = (r: number, k: number) => {
      const c = cells[r]?.[k];
      return !!c && member(c);
    };
    let d = "";
    for (const c of flat) {
      if (!sel(c.row, c.col)) continue;
      const x = cx(c.col);
      const y = cy(c.row);
      if (!sel(c.row - 1, c.col)) d += `M${x} ${y}h${CW}`;
      if (!sel(c.row + 1, c.col)) d += `M${x} ${y + CH}h${CW}`;
      if (!sel(c.row, c.col - 1)) d += `M${x} ${y}v${CH}`;
      if (!sel(c.row, c.col + 1)) d += `M${x + CW} ${y}v${CH}`;
    }
    return d;
  };
  const selectionOutline = outline(inSelection);
  const hoverOutline = hover
    ? outline((c) =>
        hover.target === "tone" ? c.tone === hover.tone : c.l === hover.l && c.s === hover.s,
      )
    : "";

  // Selected colour position (continuous lightness / saturation). Rounded so
  // server and client render identical attributes (float noise differs).
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const dot = {
    x: round2(LW + (Math.min(9.5, Math.max(0, selected.s < 0.5 ? 0 : selected.s)) + 0.5) * CW),
    y: round2(HH + ((9.5 - Math.min(9.75, Math.max(1.25, selected.l))) / 0.5 + 0.5) * CH),
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur =
      selection.kind === "value" ? { l: selection.l, s: selection.s } : toneCenter(hue, selection.tone);
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0.5, 0],
      ArrowDown: [-0.5, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (e.key in moves) {
      e.preventDefault();
      const [dl, ds] = moves[e.key];
      onSelectCell(Math.min(9.5, Math.max(1.5, cur.l + dl)), Math.min(9, Math.max(0, cur.s + ds)));
    } else if ((e.key === "Enter" || e.key === " ") && selection.kind === "value" && selection.s > 0) {
      e.preventDefault();
      onSelectTone(toneOf({ h: hue, l: selection.l, s: selection.s }));
    }
  };

  return (
    <svg
      className="pccsMap"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMinYMin meet"
      role="application"
      aria-label="PCCS 明度×彩度マップ（矢印キーで区画を移動、Enterでトーン全体を選択）"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerLeave={() => hoverTo(null)}
    >
      {/* header & row labels */}
      {COLS.map((s, col) => (
        <text key={s} className="mapAxis" x={cx(col) + CW / 2} y={HH - 4} textAnchor="middle">
          {s === 0 ? "n" : s}
        </text>
      ))}
      {ROWS.map((l, row) =>
        row % 2 === 0 ? (
          <text key={l} className="mapAxis" x={LW - 4} y={cy(row) + CH / 2 + 3} textAnchor="end">
            {l.toFixed(1)}
          </text>
        ) : null,
      )}

      {/* cells */}
      {flat.map((c) => (
        <rect
          key={`${c.row}-${c.col}`}
          x={cx(c.col)}
          y={cy(c.row)}
          width={CW}
          height={CH}
          fill={c.fill ?? "url(#mapMissing)"}
          className="mapCell"
          onClick={() => onSelectCell(c.l, c.s)}
          onDoubleClick={() => c.tone !== "n" && onSelectTone(c.tone)}
          onPointerEnter={() => hoverTo({ l: c.l, s: c.s, tone: c.tone, target: "cell" })}
        />
      ))}

      {/* out-of-sRGB marks (top-right corner triangle) */}
      {flat
        .filter((c) => c.fill && !c.inGamut)
        .map((c) => (
          <path
            key={`g${c.row}-${c.col}`}
            d={`M${cx(c.col + 1) - 7} ${cy(c.row)}h7v7z`}
            className="mapApprox"
          />
        ))}

      <path d={toneBorders} className="mapToneBorder" />
      <rect x={LW} y={HH} width={W - LW} height={H - HH} className="mapFrame" />

      {/* tone symbols (click: whole tone) */}
      {labels.map(({ tone, at }) => (
        <text
          key={tone}
          x={cx(at.col) + CW / 2}
          y={cy(at.row) + CH / 2 + 3.5}
          textAnchor="middle"
          className={`mapLabel ${at.l >= 6 ? "dark" : "light"} ${
            selection.kind === "tone" && selection.tone === tone ? "on" : ""
          }`}
          onClick={() => onSelectTone(tone)}
          onPointerEnter={() => hoverTo({ l: at.l, s: at.s, tone, target: "tone" })}
        >
          <title>{`${tone} ${TONE_BY_SYMBOL[tone].ja}（${TONE_BY_SYMBOL[tone].en}）`}</title>
          {tone}
        </text>
      ))}

      <path d={selectionOutline} className="mapSelHalo" />
      <path d={selectionOutline} className="mapSel" />
      {hoverOutline && <path d={hoverOutline} className="mapHover" />}

      <circle cx={dot.x} cy={dot.y} r={4.5} className="mapDot" />

      <defs>
        <pattern id="mapMissing" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#ececec" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#d6d6d6" strokeWidth="2" />
        </pattern>
      </defs>
    </svg>
  );
}
