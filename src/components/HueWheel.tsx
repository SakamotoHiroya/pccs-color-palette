"use client";

import { useRef } from "react";
import { hsvToRgb, rgbToHex } from "@/lib/color";

/** Default ring thickness and ring–content gap, in % of the wheel box. */
const RING = 3.5;
const GAP = 1.5;

/**
 * Hue ring around the HSB square. 0° (red) is at the top, increasing
 * clockwise. The ring is the only interactive area; children (the square)
 * are placed in the middle.
 */
export function HueWheel({
  hue,
  onChange,
  children,
  ring = RING,
  gap = GAP,
  className,
}: {
  hue: number;
  onChange: (hue: number) => void;
  /** Placed inside the ring (largest inscribed square). */
  children?: React.ReactNode;
  /** Ring thickness in % of the wheel box. */
  ring?: number;
  /** Gap between ring and content in % of the wheel box. */
  gap?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const hueFromPointer = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return Math.round((deg + 360) % 360);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 10 : 1;
    const delta: Record<string, number> = { ArrowRight: d, ArrowUp: d, ArrowLeft: -d, ArrowDown: -d };
    if (e.key in delta) {
      e.preventDefault();
      onChange((Math.round(hue) + delta[e.key] + 360) % 360);
    }
  };

  const rad = (hue * Math.PI) / 180;
  // Marker on the centre line of the ring (radius 50% - ring .. 50% of the box).
  const r = 50 - ring / 2;
  const mx = 50 + r * Math.sin(rad);
  const my = 50 - r * Math.cos(rad);

  return (
    <div
      className={`wheel ${className ?? ""}`}
      ref={ref}
      style={{ "--ring": `${ring}%`, "--gap": `${gap}%` } as React.CSSProperties}
    >
      <div
        className="hueRing"
        role="slider"
        tabIndex={0}
        aria-label="色相"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hue)}
        aria-valuetext={`${Math.round(hue)}°`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onChange(hueFromPointer(e));
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) onChange(hueFromPointer(e));
        }}
      />
      <div
        className="hueMarker"
        style={{ left: `${mx}%`, top: `${my}%`, background: rgbToHex(hsvToRgb(hue, 1, 1)) }}
      />
      {children && <div className="wheelCenter">{children}</div>}
    </div>
  );
}
