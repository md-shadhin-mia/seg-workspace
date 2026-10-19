import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/* Small SVG charts. No chart library: these cover what the app shows, stay light, and share one look.
   Every chart has an accessible summary (aria-label), hover + keyboard tooltips, and an entrance
   animation that the global reduced-motion rule turns off. */

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/** Animates a number towards `target` (ease-out), starting from the previous value. */
export function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0));
  const cur = useRef(v);
  useEffect(() => {
    if (reducedMotion() || typeof requestAnimationFrame === 'undefined') { cur.current = target; setV(target); return; }
    const start = performance.now();
    const a = cur.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const x = a + (target - a) * (1 - Math.pow(1 - p, 3));
      cur.current = x;
      setV(x);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const v = useCountUp(value);
  return <span className="num">{v.toFixed(decimals)}{suffix}</span>;
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const svgId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');

/** Smooth path through points without overshooting between neighbours. */
export function smoothPath(pts: [number, number][]) {
  if (!pts.length) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const t = 0.2;
    const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
    const clamp = (y: number) => Math.min(hi, Math.max(lo, y));
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${clamp(p1[1] + (p2[1] - p0[1]) * t)} ${p2[0] - (p3[0] - p1[0]) * t},${clamp(p2[1] - (p3[1] - p1[1]) * t)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** A "nice" axis maximum: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(v: number) {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Axis ticks: about four even steps, whole numbers when the data is counts. */
export function niceTicks(v: number, whole = true) {
  let step = niceMax(Math.max(v, 1) / 4);
  if (whole) step = Math.max(1, Math.ceil(step));
  const max = Math.max(step, Math.ceil(v / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return { max, ticks };
}

export function Sparkline({ data, color = 'var(--blue-solid)', height = 40, label }: { data: number[]; color?: string; height?: number; label?: string }) {
  const id = svgId(useId());
  if (data.length < 2) return <div style={{ height }} aria-hidden="true" />;
  const max = Math.max(1, ...data);
  const pts = data.map((d, i) => [(i / (data.length - 1)) * 100, 96 - (d / max) * 84] as [number, number]);
  const line = smoothPath(pts);
  return (
    <svg className="spark reveal" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} role="img" aria-label={label ?? `Trend: ${data.join(', ')}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.3" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L100,100 L0,100 Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Progress ring, 0–100. */
export function Ring({ value, size = 120, stroke = 12, color = 'var(--green-solid)', track = 'var(--muted)', children, label }: {
  value: number | null; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode; label?: string;
}) {
  const [shown, setShown] = useState(reducedMotion() ? value ?? 0 : 0);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(value ?? 0)); return () => cancelAnimationFrame(t); }, [value]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label ?? (value === null ? 'No data' : `${Math.round(value)}%`)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        {value !== null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, shown)) / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 1s var(--ease)' }} />
        )}
      </svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

export interface Segment { key: string; label: string; value: number; color: string }

/** Donut with a hoverable legend. */
export function Donut({ segments, size = 148, thickness = 18, center, onPick }: {
  segments: Segment[]; size?: number; thickness?: number; center?: ReactNode; onPick?: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  let acc = 0;
  const active = segments.find((s) => s.key === hover);
  return (
    <div className="donut">
      <div className="ring" style={{ width: size, height: size }} role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="reveal-spin" aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={thickness} />
          {total > 0 && segments.map((s) => {
            const len = (s.value / total) * c;
            const off = acc;
            acc += len;
            if (!s.value) return null;
            return (
              <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
                strokeWidth={hover === s.key ? thickness + 4 : thickness}
                strokeDasharray={`${Math.max(0.1, len - gap)} ${c}`} strokeDashoffset={-off}
                transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-width 0.15s', cursor: onPick ? 'pointer' : undefined }}
                onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(s.key)} />
            );
          })}
        </svg>
        <div className="ring-c">
          {active ? <><b className="num">{active.value}</b><small>{active.label}</small></> : center}
        </div>
      </div>
      <ul className="legend col">
        {segments.map((s) => (
          <li key={s.key} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} className={hover && hover !== s.key ? 'dim' : ''}>
            {onPick ? (
              <button type="button" onClick={() => onPick(s.key)} onFocus={() => setHover(s.key)} onBlur={() => setHover(null)}>
                <i style={{ background: s.color }} />{s.label}<b className="num">{s.value}</b>
              </button>
            ) : <><i style={{ background: s.color }} />{s.label}<b className="num">{s.value}</b></>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Series { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean; area?: boolean }

function Tip({ x, y, w, title, rows }: { x: number; y: number; w: number; title: ReactNode; rows: { label: string; color: string; value: ReactNode }[] }) {
  const left = Math.min(Math.max(8, x + 14), Math.max(8, w - 190));
  return (
    <div className="chart-tip" style={{ left, top: Math.max(0, y - 10) }} role="status">
      <div className="tt">{title}</div>
      {rows.map((r) => <div key={r.label} className="tr"><i style={{ background: r.color }} />{r.label}<b className="num">{r.value}</b></div>)}
    </div>
  );
}

/** Keyboard support shared by the line and bar charts: arrow keys move the highlighted point. */
function useActiveIndex(n: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (!n) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive((a) => (a === null ? n - 1 : Math.min(n - 1, Math.max(0, a + (e.key === 'ArrowRight' ? 1 : -1)))));
    }
    if (e.key === 'Escape') setActive(null);
  };
  return { active, setActive, onKeyDown };
}

const PAD = { l: 34, r: 10, t: 12, b: 26 };

export function LineChart({ labels, series, height = 250, format = (v) => String(v), title, onPick, ariaLabel }: {
  labels: string[]; series: Series[]; height?: number; format?: (v: number) => string; title?: (i: number) => ReactNode;
  onPick?: (i: number) => void; ariaLabel: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const id = svgId(useId());
  const n = labels.length;
  const { active, setActive, onKeyDown } = useActiveIndex(n);
  const all = series.flatMap((s) => s.values.map((v) => v ?? 0));
  const { max, ticks } = niceTicks(Math.max(0, ...all), all.every(Number.isInteger));
  const iw = Math.max(10, w - PAD.l - PAD.r), ih = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  const paths = series.map((s) => {
    const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)] as [number, number])).filter(Boolean) as [number, number][];
    return { s, d: smoothPath(pts), pts };
  });
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKeyDown} onBlur={() => setActive(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left - PAD.l) / iw) * (n - 1));
            setActive(Math.min(n - 1, Math.max(0, i)));
          }}
          onMouseLeave={() => setActive(null)} onClick={() => active !== null && onPick?.(active)} style={{ cursor: onPick ? 'pointer' : undefined }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${id}${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity="0.22" /><stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{format(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 || i === n - 1) && (n - 1 - i >= every || i === n - 1) ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} className="axis">{l}</text>
          ) : null)}
          <g className="reveal">
            {paths.map(({ s, d, pts }) => (
              <g key={s.key}>
                {s.area && pts.length > 1 && <path d={`${d} L${pts.at(-1)![0]},${y(0)} L${pts[0][0]},${y(0)} Z`} fill={`url(#${id}${s.key})`} />}
                <path d={d} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinecap="round" strokeDasharray={s.dashed ? '5 5' : undefined} />
              </g>
            ))}
          </g>
          {active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--fg)" strokeDasharray="3 3" opacity={0.5} />
              {series.map((s) => s.values[active] !== null && (
                <circle key={s.key} cx={x(active)} cy={y(s.values[active]!)} r={4.5} fill="var(--surface)" stroke={s.color} strokeWidth={2.5} />
              ))}
            </g>
          )}
        </svg>
      )}
      {active !== null && w > 0 && (
        <Tip x={x(active)} y={Math.min(...series.map((s) => y(s.values[active] ?? 0)))} w={w} title={title ? title(active) : labels[active]}
          rows={series.map((s) => ({ label: s.label, color: s.color, value: s.values[active] === null ? '–' : format(s.values[active]!) }))} />
      )}
    </div>
  );
}

export function BarChart({ labels, series, stacked, height = 250, format = (v) => String(v), title, onPick, ariaLabel }: {
  labels: string[]; series: Series[]; stacked?: boolean; height?: number; format?: (v: number) => string; title?: (i: number) => ReactNode;
  onPick?: (i: number) => void; ariaLabel: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const { active, setActive, onKeyDown } = useActiveIndex(n);
  const totals = labels.map((_, i) => (stacked ? series.reduce((s, x) => s + (x.values[i] ?? 0), 0) : Math.max(0, ...series.map((x) => x.values[i] ?? 0))));
  const { max, ticks } = niceTicks(Math.max(0, ...totals), totals.every(Number.isInteger));
  const mid = ticks.length > 3 ? ticks.filter((_, i) => i % 2 === 0 || i === ticks.length - 1) : ticks;
  const iw = Math.max(10, w - PAD.l - PAD.r), ih = height - PAD.t - PAD.b;
  const slot = iw / Math.max(1, n);
  const groupW = Math.min(stacked ? 26 : 34, slot * 0.66);
  const barW = stacked ? groupW : groupW / series.length;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKeyDown} onBlur={() => setActive(null)} onMouseLeave={() => setActive(null)}>
          {mid.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{format(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const gx = PAD.l + slot * i + (slot - groupW) / 2;
            let base = 0;
            return (
              <g key={i} onMouseEnter={() => setActive(i)} onClick={() => onPick?.(i)} style={{ cursor: onPick ? 'pointer' : undefined }}>
                <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={ih} fill={active === i ? 'var(--hover)' : 'transparent'} rx={8} />
                {series.map((s, k) => {
                  const v = s.values[i] ?? 0;
                  if (!v) return null;
                  const top = stacked ? y(base + v) : y(v);
                  const bottom = stacked ? y(base) : y(0);
                  base += v;
                  return (
                    <rect key={s.key} className="bar" x={stacked ? gx : gx + k * barW + 1} y={top} width={Math.max(2, barW - (stacked ? 0 : 2))}
                      height={Math.max(1, bottom - top - (stacked ? 1.5 : 0))} rx={Math.min(5, barW / 3)} fill={s.color} opacity={active === null || active === i ? 1 : 0.55} />
                  );
                })}
                {(i % every === 0) && <text x={PAD.l + slot * i + slot / 2} y={height - 6} textAnchor="middle" className="axis">{l}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {active !== null && w > 0 && (
        <Tip x={PAD.l + slot * active + slot / 2} y={y(totals[active])} w={w} title={title ? title(active) : labels[active]}
          rows={series.map((s) => ({ label: s.label, color: s.color, value: format(s.values[active] ?? 0) }))} />
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => <li key={i.label}><i style={{ background: i.dashed ? 'transparent' : i.color, borderColor: i.color }} className={i.dashed ? 'dashed' : ''} />{i.label}</li>)}
    </ul>
  );
}

/** Horizontal stacked bar (HTML), e.g. one person's workload by status. */
export function StackBar({ parts, max, height = 10, label }: { parts: { key: string; label: string; value: number; color: string }[]; max: number; height?: number; label?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="stackbar" style={{ height }} role="img" aria-label={label ?? parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
      <div className="grow-x" style={{ width: `${max ? (total / max) * 100 : 0}%` }}>
        {parts.map((p) => p.value > 0 && <i key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />)}
      </div>
    </div>
  );
}
