"use client";

import { useEffect, useRef, useState } from "react";
import type { StaffChartPoint } from "@/lib/types";

/**
 * Doctors vs nurses on staff at the end of each month (line chart, plain SVG).
 * Colours validated with the dataviz skill's checker (teal #0d9488 + indigo #6366f1, light surface).
 * Their colour-blind separation is in the "needs a second cue" band, so each series also has its own
 * marker shape (circle / square), a direct label at the line's end and a legend; a table is there for screen readers.
 */
const SERIES = [
  { key: "doctors", label: "Doctors", color: "#0d9488", shape: "circle" },
  { key: "nurses", label: "Nurses", color: "#6366f1", shape: "square" },
] as const;

const H = 220, PAD = { top: 16, right: 70, bottom: 28, left: 34 };

export default function StaffChart({ data }: { data: StaffChartPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the card's real width (not a scaled-down picture), so labels stay 11 px on phones too.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(4, ...data.flatMap((d) => [d.doctors, d.nurses]));
  const top = Math.ceil(max / 4) * 4; // 4 even gridlines
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, data.length - 1);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const ticks = [0, 1, 2, 3, 4].map((t) => (top / 4) * t);
  const last = data.length - 1;

  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-slate-600" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <Marker shape={s.shape} color={s.color} x={6} y={6} svg />
            {s.label}
          </span>
        ))}
      </div>
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label="Doctors and nurses on staff, last 6 months">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">{t}</text>
            </g>
          ))}
          {data.map((d, i) => (
            <text key={d.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#64748b">{d.month}</text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="#94a3b8" strokeDasharray="3 3" />}
          {SERIES.map((s) => (
            <g key={s.key}>
              <polyline
                points={data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((d, i) => (
                <Marker key={i} shape={s.shape} color={s.color} x={x(i)} y={y(d[s.key])} />
              ))}
              {/* Direct label at the end of the line (text in ink, not the series colour) */}
              {last >= 0 && (
                <text x={x(last) + 10} y={y(data[last][s.key]) + 4} fontSize={11} fill="#334155">
                  {s.label} {data[last][s.key]}
                </text>
              )}
            </g>
          ))}
          {/* Hover targets: one wide column per month */}
          {data.map((d, i) => (
            <rect
              key={d.month}
              x={x(i) - (W - PAD.left - PAD.right) / Math.max(1, data.length - 1) / 2}
              y={0}
              width={(W - PAD.left - PAD.right) / Math.max(1, data.length - 1)}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > last / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
          >
            <p className="font-[650] text-slate-800">{data[hover].month}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 text-slate-600">
                <Marker shape={s.shape} color={s.color} x={5} y={5} svg small />
                {s.label}: <span className="font-[650] text-slate-800">{data[hover][s.key]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {/* Hidden in a div: a <table> itself won't shrink to sr-only's 1 px and would widen the page on phones. */}
      <div className="sr-only">
        <table>
          <caption>Doctors and nurses on staff at the end of each month</caption>
          <thead><tr><th>Month</th><th>Doctors</th><th>Nurses</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.month}><td>{d.month}</td><td>{d.doctors}</td><td>{d.nurses}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/** A circle or square marker (≥ 8 px), with a white ring so it stands out where the lines cross. */
function Marker({ shape, color, x, y, svg = false, small = false }: { shape: "circle" | "square"; color: string; x: number; y: number; svg?: boolean; small?: boolean }) {
  const r = small ? 3.5 : 4.5;
  const mark =
    shape === "circle" ? (
      <circle cx={x} cy={y} r={r} fill={color} stroke="#fff" strokeWidth={2} />
    ) : (
      <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} fill={color} stroke="#fff" strokeWidth={2} />
    );
  return svg ? <svg width={r * 2 + 4} height={r * 2 + 4} viewBox={`${x - r - 2} ${y - r - 2} ${r * 2 + 4} ${r * 2 + 4}`}>{mark}</svg> : mark;
}
