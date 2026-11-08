"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { hsvToRgb, rgbToHex } from "@/lib/color";

export interface Region {
  n: number;
  hue: number;
  reg: Float32Array;
  inside: number;
  regionSegs: Float32Array;
  lightSegs: Float32Array;
  satSegs: Float32Array;
  hits: Uint8Array;
  approxRuns: number[][];
  approxCount: number;
}

export function SvSquare({
  hue,
  sat,
  val,
  onPick,
  region,
  showBands,
  dimOutside,
  stale,
}: {
  hue: number;
  sat: number;
  val: number;
  onPick: (s: number, v: number) => void;
  region: Region | null;
  showBands: boolean;
  dimOutside: boolean;
  stale: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const [dpr, setDpr] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize(Math.round(entry.contentRect.width));
      setDpr(window.devicePixelRatio || 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Base HSB square: V * lerp(white, hue colour, S)
  useEffect(() => {
    const c = baseRef.current;
    if (!c || !size) return;
    const W = Math.round(size * dpr);
    c.width = W;
    c.height = W;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = rgbToHex(hsvToRgb(hue, 1, 1));
    ctx.fillRect(0, 0, W, W);
    const white = ctx.createLinearGradient(0, 0, W, 0);
    white.addColorStop(0, "rgba(255,255,255,1)");
    white.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, W, W);
    const black = ctx.createLinearGradient(0, 0, 0, W);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, W, W);
  }, [hue, size, dpr]);

  // Overlay: dimmed outside, band lines, region outline, marker.
  useEffect(() => {
    const c = overRef.current;
    if (!c || !size) return;
    const W = Math.round(size * dpr);
    c.width = W;
    c.height = W;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, W);

    if (region) {
      const { n } = region;
      const cell = W / (n - 1);
      const toPx = (g: number) => g * cell;

      if (dimOutside && region.inside > 0) {
        const img = new ImageData(n, n);
        for (let k = 0; k < n * n; k++) {
          img.data[k * 4 + 3] = region.reg[k] > 0 ? 100 : 0;
        }
        const off = document.createElement("canvas");
        off.width = n;
        off.height = n;
        off.getContext("2d")!.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, -cell / 2, -cell / 2, n * cell, n * cell);
      }

      const stroke = (segs: Float32Array, width: number, color: string, dash: number[] = []) => {
        ctx.beginPath();
        for (let k = 0; k < segs.length; k += 4) {
          ctx.moveTo(toPx(segs[k]), toPx(segs[k + 1]));
          ctx.lineTo(toPx(segs[k + 2]), toPx(segs[k + 3]));
        }
        ctx.setLineDash(dash.map((d) => d * dpr));
        ctx.lineWidth = width * dpr;
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.setLineDash([]);
      };

      if (showBands) {
        stroke(region.lightSegs, 1, "rgba(255,255,255,0.75)", [4, 4]);
        stroke(region.satSegs, 1, "rgba(0,0,0,0.6)", [2, 3]);
      }
      stroke(region.regionSegs, 4, "rgba(0,0,0,0.65)");
      stroke(region.regionSegs, 2, "#ffffff");

      // Approximated (out-of-gamut) positions along the sRGB boundary.
      const inset = 5 * dpr;
      const clampPx = (g: number) => Math.min(W - inset, Math.max(inset, toPx(g)));
      const polyline = (pts: number[]) => {
        ctx.beginPath();
        ctx.moveTo(clampPx(pts[0]), clampPx(pts[1]));
        if (pts.length === 2) ctx.lineTo(clampPx(pts[0]) + 0.01, clampPx(pts[1]));
        for (let k = 2; k < pts.length; k += 2) ctx.lineTo(clampPx(pts[k]), clampPx(pts[k + 1]));
      };
      for (const run of region.approxRuns) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        polyline(run);
        ctx.setLineDash([]);
        ctx.lineWidth = 10 * dpr;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.stroke();
        polyline(run);
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.lineWidth = 5 * dpr;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // "≈ 近似" label next to the longest run
      const longest = region.approxRuns.reduce<number[] | null>(
        (a, r) => (!a || r.length > a.length ? r : a),
        null,
      );
      if (longest) {
        const m = Math.floor(longest.length / 4) * 2;
        const onTop = longest[m + 1] === 0 && longest[m] < n - 1;
        const text = "≈ sRGB外の近似";
        ctx.font = `${12 * dpr}px system-ui, sans-serif`;
        const tw = ctx.measureText(text).width;
        const pad = 5 * dpr;
        const bw = tw + pad * 2;
        const bh = 20 * dpr;
        let bx = onTop ? clampPx(longest[m]) - bw / 2 : W - inset - 12 * dpr - bw;
        let by = onTop ? inset + 12 * dpr : clampPx(longest[m + 1]) - bh / 2;
        bx = Math.min(W - bw - 2 * dpr, Math.max(2 * dpr, bx));
        by = Math.min(W - bh - 2 * dpr, Math.max(2 * dpr, by));
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 4 * dpr);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(text, bx + pad, by + bh / 2);
      }
    }

    // Selection marker
    const x = sat * W;
    const y = (1 - val) * W;
    ctx.beginPath();
    ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.stroke();
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }, [region, sat, val, size, dpr, showBands, dimOutside]);

  const pick = useCallback(
    (e: React.PointerEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const v = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
      onPick(s, v);
    },
    [onPick],
  );

  const onKey = (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.01;
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-d, 0],
      ArrowRight: [d, 0],
      ArrowUp: [0, d],
      ArrowDown: [0, -d],
    };
    const k = keys[e.key];
    if (!k) return;
    e.preventDefault();
    onPick(Math.min(1, Math.max(0, sat + k[0])), Math.min(1, Math.max(0, val + k[1])));
  };

  return (
    <div
      ref={wrapRef}
      className={`square ${stale ? "stale" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label="彩度と明度 (HSB)"
      aria-valuetext={`S ${Math.round(sat * 100)}%, B ${Math.round(val * 100)}%`}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) pick(e);
      }}
    >
      <canvas ref={baseRef} className="layer" />
      <canvas ref={overRef} className="layer" />
    </div>
  );
}
