"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Small plain-SVG charts for the dashboards and reports (no chart library).
 * Colours validated with the dataviz skill's checker on a light surface: teal #0d9488 + indigo #6366f1.
 * Their colour-blind separation is in the "needs a second cue" band, so a 2-series line chart also uses
 * marker shapes (circle / square), direct end labels and a legend. One y-axis only; a hidden table
 * gives screen readers the numbers. Charts draw at the card's real width so labels stay 11 px on phones.
 */
const SERIES_STYLE = [
  { color: "#0d9488", shape: "circle" as const },
  { color: "#6366f1", shape: "square" as const },
];
const H = 220;
const PAD = { top: 16, right: 76, bottom: 28, left: 34 };

export type Series = { label: string; values: number[] };

function useWidth() {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  return { box, W };
}

/** Rounded-up axis top with 4 even gridlines. */
function scaleTop(values: number[]) {
  const max = Math.max(4, ...values);
  const step = Math.ceil(max / 4);
  return step * 4;
}

/** Month axis labels: "Nov 2026" → "Nov"; every k-th label when space is short. */
function shortLabel(l: string) {
  return l.split(" ")[0];
}

/** Line chart for one or two series over the same months (e.g. patients vs doctors). */
export function LineChart({ labels, series, ariaLabel }: { labels: string[]; series: Series[]; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const { box, W } = useWidth();
  const shown = series.slice(0, 2); // never more than two lines: more would need another encoding
  const top = scaleTop(shown.flatMap((s) => s.values));
  const plotW = W - PAD.left - PAD.right;
  const n = labels.length;
  const x = (i: number) => PAD.left + (i * plotW) / Math.max(1, n - 1);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const every = Math.max(1, Math.ceil((n * 38) / plotW));
  const last = n - 1;
  const colW = plotW / Math.max(1, n - 1);

  return (
    <div>
      {shown.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600" aria-hidden="true">
          {shown.map((s, k) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <Marker {...SERIES_STYLE[k]} x={6} y={6} svg />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={ariaLabel}>
          {[0, 1, 2, 3, 4].map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y((top / 4) * t)} y2={y((top / 4) * t)} stroke="#e2e8f0" />
              <text x={PAD.left - 8} y={y((top / 4) * t) + 4} textAnchor="end" fontSize={11} fill="#64748b">{(top / 4) * t}</text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === last ? (
              <text key={l} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#64748b">{shortLabel(l)}</text>
            ) : null,
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="#94a3b8" strokeDasharray="3 3" />}
          {shown.map((s, k) => (
            <g key={s.label}>
              <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={SERIES_STYLE[k].color}
                        strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) => <Marker key={i} {...SERIES_STYLE[k]} x={x(i)} y={y(v)} />)}
              {last >= 0 && (
                <text x={x(last) + 10} y={y(s.values[last]) + 4 + (shown.length > 1 && k === 1 && s.values[last] === shown[0].values[last]
                        ? (s.values[last] < top / 2 ? -13 : 13) // same end point: move the 2nd label away from the axis
                        : 0)}
                      fontSize={11} fill="#334155">
                  {s.label} {s.values[last]}
                </text>
              )}
            </g>
          ))}
          {labels.map((l, i) => (
            <rect key={l} x={x(i) - colW / 2} y={0} width={colW} height={H} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        {hover !== null && (
          <Tooltip left={(x(hover) / W) * 100} flip={hover > last / 2} title={labels[hover]}
                   rows={shown.map((s, k) => ({ label: s.label, value: s.values[hover], style: SERIES_STYLE[k] }))} />
        )}
      </div>
      <DataTable caption={ariaLabel} labels={labels} series={shown} />
    </div>
  );
}

/**
 * Bar chart for one value per month (e.g. new hospitals connected each month).
 * `tick` formats the axis labels and `value` the tooltip (e.g. money: "₹4.5L" on the axis, "₹4,56,000" on hover).
 */
export function BarChart({ labels, series, ariaLabel, tick = String, value = String }: {
  labels: string[]; series: Series; ariaLabel: string; tick?: (v: number) => string; value?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { box, W } = useWidth();
  const top = scaleTop(series.values);
  const right = 16;
  // Room on the left for the longest axis label (about 6.5 px per character at 11 px).
  const left = Math.max(PAD.left, 12 + Math.max(...[0, 1, 2, 3, 4].map((t) => tick((top / 4) * t).length)) * 6.5);
  const plotW = W - left - right;
  const n = labels.length;
  const slot = plotW / Math.max(1, n);
  const barW = Math.max(6, Math.min(36, slot * 0.6));
  const x = (i: number) => left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const base = y(0);
  const every = Math.max(1, Math.ceil((n * 38) / plotW));

  return (
    <div>
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={ariaLabel}>
          {[0, 1, 2, 3, 4].map((t) => (
            <g key={t}>
              <line x1={left} x2={W - right} y1={y((top / 4) * t)} y2={y((top / 4) * t)} stroke="#e2e8f0" />
              <text x={left - 8} y={y((top / 4) * t) + 4} textAnchor="end" fontSize={11} fill="#64748b">{tick((top / 4) * t)}</text>
            </g>
          ))}
          {series.values.map((v, i) => {
            const h = base - y(v);
            return (
              <g key={labels[i]}>
                {/* Rounded top, square base on the axis */}
                {v > 0 && (
                  <path
                    d={`M${x(i) - barW / 2},${base} V${base - h + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, h)},-${Math.min(4, h)} H${x(i) + barW / 2 - Math.min(4, h)} q${Math.min(4, h)},0 ${Math.min(4, h)},${Math.min(4, h)} V${base} Z`}
                    fill={hover === i ? "#0b7a70" : SERIES_STYLE[0].color}
                  />
                )}
                {(i % every === 0 || i === n - 1) && (
                  <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#64748b">{shortLabel(labels[i])}</text>
                )}
                <rect x={x(i) - slot / 2} y={0} width={slot} height={H} fill="transparent"
                      onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
        {hover !== null && (
          <Tooltip left={(x(hover) / W) * 100} flip={hover > (n - 1) / 2} title={labels[hover]}
                   rows={[{ label: series.label, value: value(series.values[hover]), style: SERIES_STYLE[0] }]} />
        )}
      </div>
      <DataTable caption={ariaLabel} labels={labels} series={[series]} />
    </div>
  );
}

function Tooltip({ left, flip, title, rows }: {
  left: number; flip: boolean; title: string;
  rows: { label: string; value: number | string; style: (typeof SERIES_STYLE)[number] }[];
}) {
  return (
    <div className="pointer-events-none absolute top-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
         style={{ left: `${left}%`, transform: flip ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}>
      <p className="font-[650] text-slate-800">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-1.5 text-slate-600">
          <Marker {...r.style} x={5} y={5} svg small />
          {r.label}: <span className="font-[650] text-slate-800">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Numbers for screen readers. Hidden in a div: a <table> won't shrink to sr-only's 1 px and widens phones. */
function DataTable({ caption, labels, series }: { caption: string; labels: string[]; series: Series[] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead><tr><th>Month</th>{series.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
        <tbody>{labels.map((l, i) => <tr key={l}><td>{l}</td>{series.map((s) => <td key={s.label}>{s.values[i]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A circle or square marker (≥ 8 px), with a white ring so it stands out where lines cross. */
function Marker({ shape, color, x, y, svg = false, small = false }: { shape: "circle" | "square"; color: string; x: number; y: number; svg?: boolean; small?: boolean }) {
  const r = small ? 3.5 : 4.5;
  const mark = shape === "circle"
    ? <circle cx={x} cy={y} r={r} fill={color} stroke="#fff" strokeWidth={2} />
    : <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} fill={color} stroke="#fff" strokeWidth={2} />;
  return svg ? <svg width={r * 2 + 4} height={r * 2 + 4} viewBox={`${x - r - 2} ${y - r - 2} ${r * 2 + 4} ${r * 2 + 4}`}>{mark}</svg> : mark;
}
