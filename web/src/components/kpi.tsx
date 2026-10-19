import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, CalendarRange, ChevronLeft, ChevronRight, Info, Maximize2, Minimize2, Minus } from 'lucide-react';
import { PRESETS, pctText, rangeLabel, tone, type ActivityFeed, type DeadlineTask, type KpiSettings, type Metrics, type Preset } from '../lib/analytics';
import { STATUS, ago, dayDiff, dueClass, dueLabel, todayISO } from '../lib/format';
import type { Status } from '../lib/types';
import { CountUp, Sparkline } from './charts';
import { AvatarStack, Popover, StatusPill, useAnchor } from './ui';

export type Tone = 'yellow' | 'pink' | 'green' | 'blue' | 'violet' | 'coral' | 'plain';

/* ---------- change vs previous period ---------- */
export function Delta({ now, prev, unit = '', invert, label = 'vs previous period' }: { now: number | null; prev: number | null; unit?: string; invert?: boolean; label?: string }) {
  if (now === null || prev === null) return null;
  const d = Math.round((now - prev) * 10) / 10;
  const good = invert ? d < 0 : d > 0;
  const cls = d === 0 ? 'flat' : good ? 'up' : 'down';
  const Icon = d === 0 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`delta ${cls}`} title={`${d > 0 ? '+' : ''}${d}${unit} ${label}`}>
      <Icon size={13} aria-hidden="true" />{d > 0 ? '+' : ''}{d}{unit}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

/* ---------- KPI card ---------- */
export function KpiCard({ tone = 'plain', icon, label, value, decimals = 0, suffix = '', empty, delta, sub, spark, sparkColor, to, children, delay = 0 }: {
  tone?: Tone; icon: ReactNode; label: string; value: number | null; decimals?: number; suffix?: string; empty?: string;
  delta?: ReactNode; sub?: ReactNode; spark?: number[]; sparkColor?: string; to?: string; children?: ReactNode; delay?: number;
}) {
  const body = (
    <>
      <div className="kpi-h">
        <span className="kpi-ic" aria-hidden="true">{icon}</span>
        <span className="kpi-l">{label}</span>
        {to && <ArrowUpRight size={16} className="kpi-go" aria-hidden="true" />}
      </div>
      <div className="kpi-v">
        {value === null ? <span className="kpi-empty">{empty ?? '–'}</span> : <CountUp value={value} decimals={decimals} suffix={suffix} />}
        {delta}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {spark && spark.length > 1 && <div className="kpi-spark"><Sparkline data={spark} color={sparkColor} height={38} label={`${label} trend`} /></div>}
      {children}
    </>
  );
  const cls = `kpi tone-${tone}`;
  const style = { animationDelay: `${delay}ms` };
  return to ? <Link to={to} className={cls} style={style}>{body}</Link> : <div className={cls} style={style}>{body}</div>;
}

/* ---------- widget card, optionally expandable to full width with extra detail ---------- */
export function Widget({ title, sub, icon, tone = 'plain', actions, children, details, className = '', id }: {
  title: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone; actions?: ReactNode; children: ReactNode; details?: ReactNode; className?: string; id?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`widget ${open ? 'expanded' : ''} ${className}`} id={id}>
      <header className="widget-h">
        {icon && <span className={`w-ic tone-${tone}`} aria-hidden="true">{icon}</span>}
        <div className="w-t"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
        <span className="sp" />
        {actions}
        {details && (
          <button className="icon-btn sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Show less' : 'Expand for details'} title={open ? 'Show less' : 'Expand for details'}>
            {open ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        )}
      </header>
      <div className="widget-b">{children}</div>
      {open && details && <div className="widget-x">{details}</div>}
    </section>
  );
}

/* ---------- date range ---------- */
export function RangePicker({ preset, from, to, onChange }: { preset: Preset; from: string; to: string; onChange: (p: Preset, r?: { from: string; to: string }) => void }) {
  const pop = useAnchor();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const today = todayISO();
  return (
    <div className="range">
      <div className="subtabs" role="group" aria-label="Date range">
        {PRESETS.map(([k, l]) => <button key={k} className={preset === k ? 'active' : ''} aria-pressed={preset === k} onClick={() => onChange(k)}>{l}</button>)}
        <button className={preset === 'custom' ? 'active' : ''} aria-pressed={preset === 'custom'} onClick={(e) => { setF(from); setT(to); pop.open(e); }}>
          <CalendarRange size={14} style={{ marginRight: 6, verticalAlign: -2 }} />{preset === 'custom' ? rangeLabel({ from, to }) : 'Custom'}
        </button>
      </div>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={260}>
          <form className="form" style={{ padding: 10, gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (f && t && f <= t) { onChange('custom', { from: f, to: t }); pop.close(); } }}>
            <div className="field"><label htmlFor="rg-from">From</label><input id="rg-from" type="date" className="input sm" value={f} max={t || today} onChange={(e) => setF(e.target.value)} /></div>
            <div className="field"><label htmlFor="rg-to">To</label><input id="rg-to" type="date" className="input sm" value={t} min={f} max={today} onChange={(e) => setT(e.target.value)} /></div>
            <button className="btn primary sm" disabled={!f || !t || f > t}>Apply</button>
          </form>
        </Popover>
      )}
    </div>
  );
}

/* ---------- breadcrumbs ---------- */
export function Crumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            {it.to && i < items.length - 1 ? <Link to={it.to}>{it.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{it.label}</span>}
            {i < items.length - 1 && <ChevronRight size={13} aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ---------- score ---------- */
export function ScoreChip({ score, size = 'md' }: { score: number | null; size?: 'sm' | 'md' }) {
  const t = score === null ? 'grey' : score >= 80 ? 'green' : score >= 60 ? 'amber' : 'red';
  return <span className={`score ${t} ${size}`} title={score === null ? 'Not enough work in this period to score' : `KPI score ${score} of 100`}>{score ?? '–'}</span>;
}

/** Shows exactly how a score is made, so nobody is judged by an unexplained number. */
export function ScoreBreakdown({ m, settings }: { m: Metrics; settings: KpiSettings }) {
  const total = m.scoreParts.reduce((s, p) => s + p.weight, 0);
  // "Nothing overdue" has no admin target; anything under 90% open-and-on-schedule is worth a look.
  const target = (k: Metrics['scoreParts'][number]['key']) => (k === 'backlog' ? null : settings.targets[k]);
  if (!m.scoreParts.length) return <p className="bd-note"><Info size={13} aria-hidden="true" />No finished, reviewed or open work in this period yet.</p>;
  return (
    <div className="breakdown">
      <ul className="bd-list">
        {m.scoreParts.map((p) => {
          const t = target(p.key);
          const share = total ? p.weight / total : 0;
          return (
            <li key={p.key} className={`bd-row tone-${tone(p.value, t ?? 90)}`}>
              <div className="bd-top"><span className="bd-l">{p.label}</span><b className="bd-v num">{Math.round(p.value)}%</b></div>
              <div className="bd-bar" role="img" aria-label={`${p.label} ${Math.round(p.value)}%${t ? `, target ${t}%` : ''}`}>
                <i style={{ width: `${p.value}%` }} />
                {t && <span className="bd-tick" style={{ left: `${t}%` }} title={`Target ${t}%`} />}
              </div>
              <div className="bd-meta">
                <span>Weight {Math.round(share * 100)}%{m.score !== null && <> · adds <b className="num">{Math.round(p.value * share)}</b> pts</>}</span>
                {t && <span>Target {t}%</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="bd-note"><Info size={13} aria-hidden="true" />
        {m.enoughData
          ? 'The score adds up the points from each part (rounded). Parts with no data in this period are left out.'
          : `A score appears once there are at least ${settings.minSample} tasks in the period.`}
      </p>
    </div>
  );
}

export function GoalBar({ label, value, target, unit = '%', hint }: { label: string; value: number | null; target: number; unit?: string; hint?: string }) {
  const pct = value === null ? 0 : Math.min(100, (value / target) * 100);
  const met = value !== null && value >= target;
  return (
    <div className="goal">
      <div className="goal-h"><span>{label}</span><b className="num">{value === null ? '–' : `${Math.round(value * 10) / 10}${unit}`}<small> / {target}{unit}</small></b></div>
      <div className={`goal-bar ${met ? 'met' : value === null ? '' : pct >= 75 ? 'near' : 'far'}`}><i style={{ width: `${pct}%` }} /><span className="tick" style={{ left: '100%' }} /></div>
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

/* ---------- rates row ---------- */
export function RateStat({ label, value, prev, target }: { label: string; value: number | null; prev: number | null; target?: number }) {
  return (
    <div className="rate">
      <span className="rate-l">{label}</span>
      <span className="rate-v num">{pctText(value)}</span>
      <Delta now={value} prev={prev} unit=" pts" />
      {target !== undefined && <span className="rate-t">Target {target}%</span>}
    </div>
  );
}

/* ---------- deadlines ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function DeadlineList({ items, personal, empty = 'No deadlines in the next two weeks.' }: { items: DeadlineTask[]; personal?: boolean; empty?: string }) {
  if (!items.length) return <p className="muted small-empty">{empty}</p>;
  return (
    <ul className="deadlines">
      {items.map((t) => {
        const [, m, d] = t.dueDate.split('-').map(Number);
        const st = (personal ? t.myStatus : t.status) as Status;
        const over = dayDiff(t.dueDate) < 0;
        return (
          <li key={t.id}>
            <Link to={`/tasks/${t.id}`} className={`dl ${over ? 'over' : dayDiff(t.dueDate) <= 2 ? 'soon' : ''}`}>
              <span className="dl-date" aria-hidden="true"><b>{d}</b><small>{MON[m - 1]}</small></span>
              <span className="dl-main">
                <span className="dl-t">{t.title}</span>
                <span className="dl-s">{t.projectName} · <span className={`due ${dueClass(t.dueDate, st === 'done')}`}>{dueLabel(t.dueDate)}</span></span>
              </span>
              {!personal && t.assignees.length > 0 && <AvatarStack names={t.assignees.map((a) => a.name)} size={24} max={3} />}
              <StatusPill status={st} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- calendar of due dates ---------- */
export function DueCalendar({ days, selected, onSelect }: { days: { date: string; count: number }[]; selected?: string | null; onSelect?: (d: string | null) => void }) {
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const today = todayISO(now);
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const first = (month.getDay() + 6) % 7; // Monday first
  const len = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: len }, (_, i) => i + 1)];
  const minMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1), maxMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  return (
    <div className="cal">
      <div className="cal-h">
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} disabled={month <= minMonth} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <span className="cal-m">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button className="icon-btn sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} disabled={month >= maxMonth} aria-label="Next month"><ChevronRight size={16} /></button>
      </div>
      <div className="cal-g" role="grid" aria-label="Open work by due date">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} className="cal-dow" aria-hidden="true">{d}</span>)}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const iso = todayISO(new Date(month.getFullYear(), month.getMonth(), d));
          const n = counts.get(iso) ?? 0;
          const cls = ['cal-d', iso === today && 'today', n > 0 && (iso < today ? 'over' : 'due'), selected === iso && 'sel'].filter(Boolean).join(' ');
          return (
            <button key={iso} className={cls} disabled={!n} onClick={() => onSelect?.(selected === iso ? null : iso)}
              aria-label={`${d} ${MON[month.getMonth()]}: ${n ? `${n} open ${n === 1 ? 'task' : 'tasks'} due` : 'nothing due'}`} aria-pressed={selected === iso}>
              {d}{n > 0 && <i className="cal-dot">{n > 1 ? n : ''}</i>}
            </button>
          );
        })}
      </div>
      <div className="cal-k"><span><i className="k due" />Due</span><span><i className="k over" />Overdue</span><span><i className="k today" />Today</span></div>
    </div>
  );
}

/* ---------- activity feed ---------- */
export function ActivityList({ feed }: { feed: ActivityFeed }) {
  if (!feed.items.length) return <p className="muted small-empty">No activity in the last 30 days.</p>;
  const n = (id: string) => feed.names[id] ?? 'someone';
  const say = (a: ActivityFeed['items'][number]) => {
    const m = a.meta ?? {};
    switch (a.action) {
      case 'created': return ['created', 'blue'];
      case 'assigned': return [`assigned ${(m.userIds ?? []).map(n).join(', ')} to`, 'pink'];
      case 'status': return [m.to === 'done' ? 'finished' : `moved ${m.userId === a.actorId ? 'their status' : `${n(m.userId)}`} to ${STATUS[m.to as Status]?.toLowerCase()} on`, m.to === 'done' ? 'green' : 'blue'];
      case 'submitted': return [`submitted version ${m.version} of`, 'violet'];
      case 'approved': return [`approved ${n(m.userId)}'s work on`, 'green'];
      case 'changes_requested': return [`asked ${n(m.userId)} for changes on`, 'coral'];
      default: return ['updated', 'plain'];
    }
  };
  return (
    <ol className="feed">
      {feed.items.map((a) => {
        const [text, t] = say(a);
        return (
          <li key={a.id} className={`tone-${t}`}>
            <span className="feed-dot" aria-hidden="true" />
            <p><b>{a.actorName ?? 'Someone'}</b> {text} <Link to={`/tasks/${a.taskId}`}>{a.taskTitle}</Link></p>
            <time dateTime={a.createdAt}>{ago(a.createdAt)}</time>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- select used in filter bars ---------- */
export function FilterSelect({ label, value, onChange, options, icon }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; icon?: ReactNode }) {
  return (
    <label className={`fsel ${value ? 'on' : ''}`}>
      {icon}<span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{label}: All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
