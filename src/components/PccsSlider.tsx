"use client";

import { useRef } from "react";

const R = 10; // thumb radius (px); values map to [R, width - R]

export interface Tick {
  value: number;
  label: string;
  approx?: boolean;
}

/**
 * Slider that can *display* a range (lo..hi) but is operated as a single
 * value: pointer / keyboard input always emits one snapped value.
 */
export function PccsSlider({
  label,
  min,
  max,
  step,
  lo,
  hi,
  background,
  ticks,
  valueText,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  lo: number;
  hi: number;
  background: string;
  ticks: Tick[];
  valueText: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frac = (v: number) => (v - min) / (max - min);
  const pos = (v: number) => `calc(${R}px + (100% - ${2 * R}px) * ${frac(v)})`;
  const snap = (v: number) =>
    Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
  const isRange = hi > lo;
  const mid = snap((lo + hi) / 2);

  const fromPointer = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = (clientX - rect.left - R) / Math.max(1, rect.width - 2 * R);
    return snap(min + Math.min(1, Math.max(0, x)) * (max - min));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = {
      ArrowLeft: -step,
      ArrowDown: -step,
      ArrowRight: step,
      ArrowUp: step,
    };
    if (e.key in map) {
      e.preventDefault();
      onChange(snap(mid + map[e.key]));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  };

  return (
    <div className="pslider">
      <div
        ref={ref}
        className="psHit"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={mid}
        aria-valuetext={isRange ? `${valueText(lo)} – ${valueText(hi)}` : valueText(lo)}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onChange(fromPointer(e.clientX));
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) {
            const v = fromPointer(e.clientX);
            if (isRange || v !== lo) onChange(v);
          }
        }}
      >
        <div className="psTrack" style={{ background }} />
        {isRange ? (
          <div
            className="psRange"
            style={{
              left: `calc(${pos(lo)} - ${R}px)`,
              width: `calc((100% - ${2 * R}px) * ${frac(hi) - frac(lo)} + ${2 * R}px)`,
            }}
          />
        ) : (
          <div className="psThumb" style={{ left: pos(lo) }} />
        )}
      </div>
      <div className="psTicks" aria-hidden="true">
        {ticks.map((t) => (
          <span
            key={t.value}
            className={`${t.approx ? "tickApprox" : ""} ${t.value >= lo && t.value <= hi ? "tickOn" : ""}`}
            style={{ left: pos(t.value) }}
          >
            {t.approx && "≈"}
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
