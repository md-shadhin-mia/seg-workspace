import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ArrowUpDown, CalendarDays, ChartNoAxesCombined, ChartPie, FolderKanban, Gauge, Layers, Target, Trophy, UsersRound,
} from 'lucide-react';
import {
  WORKLOAD_KEYS, bucketLabel, bucketTitle, pctText, type Bucket, type Contribution, type DeadlineTask, type KpiSettings,
  type Metrics, type Overview, type Range,
} from '../lib/analytics';
import { PROJECT_STATUS, dueLabel, plural } from '../lib/format';
import { BarChart, Donut, Legend, LineChart, Ring, Sparkline, StackBar } from './charts';
import { DeadlineList, Delta, DueCalendar, GoalBar, ScoreBreakdown, ScoreChip, Widget } from './kpi';
import { Avatar } from './ui';

/* Analytics widgets shared by the dashboard, the Analytics page and the person page. */

export function TrendWidget({ trend, range, title = 'Productivity trend', sub, span = 'span-8' }: { trend: Bucket[]; range: Range; title?: string; sub?: string; span?: string }) {
  const [mode, setMode] = useState<'flow' | 'deadline'>('flow');
  const labels = trend.map((b) => bucketLabel(b, range.bucket));
  const tip = (i: number) => bucketTitle(trend[i], range.bucket);
  const per = range.bucket === 'day' ? 'day' : range.bucket;
  return (
    <Widget className={`${span} grow-body`} title={title} sub={sub ?? `Tasks per ${per}`} icon={<ChartNoAxesCombined size={16} />} tone="blue"
      actions={
        <div className="subtabs" role="group" aria-label="Chart">
          <button className={mode === 'flow' ? 'active' : ''} aria-pressed={mode === 'flow'} onClick={() => setMode('flow')}>Throughput</button>
          <button className={mode === 'deadline' ? 'active' : ''} aria-pressed={mode === 'deadline'} onClick={() => setMode('deadline')}>Deadlines</button>
        </div>
      }
      details={<TrendTable trend={trend} range={range} />}>
      {mode === 'flow' ? (
        <>
          <Legend items={[{ label: 'Completed', color: 'var(--green-solid)' }, { label: 'Newly assigned', color: 'var(--blue-solid)', dashed: true }]} />
          <LineChart fill labels={labels} title={tip} ariaLabel={`Completed and assigned tasks per ${per}. Use the arrow keys to read each ${per}.`}
            series={[
              { key: 'completed', label: 'Completed', color: 'var(--green-solid)', values: trend.map((b) => b.completed), area: true },
              { key: 'assigned', label: 'Newly assigned', color: 'var(--blue-solid)', values: trend.map((b) => b.assigned), dashed: true },
            ]} />
        </>
      ) : (
        <>
          <Legend items={[{ label: 'Finished on time', color: 'var(--green-solid)' }, { label: 'Finished late', color: 'var(--red-solid)' }]} />
          <BarChart fill labels={labels} title={tip} stacked ariaLabel={`Tasks finished on time and late per ${per}`}
            series={[
              { key: 'onTime', label: 'On time', color: 'var(--green-solid)', values: trend.map((b) => b.onTime) },
              { key: 'late', label: 'Late', color: 'var(--red-solid)', values: trend.map((b) => b.late) },
            ]} />
        </>
      )}
    </Widget>
  );
}

function TrendTable({ trend, range }: { trend: Bucket[]; range: Range }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', boxShadow: 'none' }}>
      <table style={{ minWidth: 0 }}>
        <thead><tr><th>Period</th><th>Assigned</th><th>Completed</th><th>On time</th><th>Late</th></tr></thead>
        <tbody>
          {[...trend].reverse().map((b) => (
            <tr key={b.start}><td>{bucketTitle(b, range.bucket)}</td><td className="num">{b.assigned}</td><td className="num">{b.completed}</td><td className="num">{b.onTime}</td><td className="num">{b.late}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCORE_WORD = (s: number) => (s >= 80 ? 'Strong' : s >= 60 ? 'Steady' : 'Needs attention');

export function ScoreWidget({ m, prev, settings, title = 'KPI score', sub, span = 'span-4', to }: {
  m: Metrics; prev: Metrics; settings: KpiSettings; title?: string; sub?: string; span?: string; to?: string;
}) {
  const t = m.score === null ? 'grey' : m.score >= 80 ? 'green' : m.score >= 60 ? 'amber' : 'red';
  const color = { grey: 'var(--grey-solid)', green: 'var(--green-solid)', amber: 'var(--amber-solid)', red: 'var(--red-solid)' }[t];
  return (
    <Widget className={span} title={title} sub={sub ?? 'How the score is made up'} icon={<Gauge size={16} />} tone="green"
      actions={to && <Link to={to} className="link-btn">Details <ArrowRight size={14} /></Link>}>
      <div className="score-card">
        <div className="score-sum">
          <Ring value={m.score} size={104} stroke={11} color={color} label={m.score === null ? 'No score yet' : `Score ${m.score} of 100`}>
            {m.score === null ? <b style={{ fontSize: 18 }}>–</b> : <><b className="num">{m.score}</b><small>of 100</small></>}
          </Ring>
          <div className="score-txt">
            <span className={`score-word ${t}`}>{m.score === null ? 'Not enough data yet' : SCORE_WORD(m.score)}</span>
            {m.score !== null && prev.score !== null
              ? <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Delta now={m.score} prev={prev.score} unit=" pts" /><small className="muted">vs previous period</small></span>
              : <small className="muted">{m.score === null ? `Needs ${settings.minSample}+ tasks in the period` : 'No score for the previous period'}</small>}
          </div>
        </div>
        <ScoreBreakdown m={m} settings={settings} />
      </div>
    </Widget>
  );
}

export function GoalsWidget({ m, settings, weeks, span = 'span-4', personal }: { m: Metrics; settings: KpiSettings; weeks: number; span?: string; personal?: boolean }) {
  const perWeek = weeks > 0 ? Math.round((m.completed / weeks) * 10) / 10 : null;
  return (
    <Widget className={span} title="Goals" sub="Progress against the targets your admin set" icon={<Target size={16} />} tone="yellow">
      <div className="goals">
        <GoalBar label="Completion rate" value={m.completionRate} target={settings.targets.completion} hint={`${m.completed} of ${m.active} tasks on the plate`} />
        <GoalBar label="On-time delivery" value={m.onTimeRate} target={settings.targets.onTime} hint={m.completedWithDue ? `${m.onTime} of ${m.completedWithDue} with a due date` : 'No dated tasks finished yet'} />
        <GoalBar label="Approved on review" value={m.approvalRate} target={settings.targets.approval} hint={m.reviewed ? `${m.approved} of ${m.reviewed} reviews` : 'No reviews in this period'} />
        {personal && <GoalBar label="Tasks finished per week" value={perWeek} unit="" target={settings.targets.weeklyCompleted} />}
      </div>
    </Widget>
  );
}

type PersonRow = Overview['people'][number];
const sortPeople = (a: PersonRow, b: PersonRow) =>
  (b.metrics.score ?? -1) - (a.metrics.score ?? -1) || b.metrics.completed - a.metrics.completed || a.name.localeCompare(b.name);

export function PeopleWidget({ people, settings, span = 'span-7', limit = 6, query = '' }: { people: PersonRow[]; settings: KpiSettings; span?: string; limit?: number; query?: string }) {
  const sorted = useMemo(() => [...people].sort(sortPeople), [people]);
  return (
    <Widget className={span} title="People performance" sub="Ranked by KPI score, then tasks completed" icon={<Trophy size={16} />} tone="pink"
      details={<PeopleTable people={people} settings={settings} query={query} />}>
      {sorted.length ? (
        <div className="plist">
          {sorted.slice(0, limit).map((p, i) => (
            <Link key={p.id} to={`/people/${p.id}${query}`} className="prow">
              <div className="who-cell">
                <span className={`rank ${i === 0 && p.metrics.score !== null ? 'r1' : ''}`}>{i + 1}</span>
                <Avatar name={p.name} size={32} />
                <div><b>{p.name}</b><small className="muted">{p.title || p.teamNames.join(', ') || 'No team'}</small></div>
              </div>
              <div className="hide-sm"><Sparkline data={p.spark} color="var(--green-solid)" height={28} label={`${p.name}: completed per period`} /></div>
              <div className="nums"><b>{p.metrics.completed}</b> done<br /><span className={p.metrics.overdue ? 'over' : ''} style={p.metrics.overdue ? { color: 'var(--red)' } : undefined}>{p.metrics.overdue} overdue</span></div>
              <ScoreChip score={p.metrics.score} />
            </Link>
          ))}
        </div>
      ) : <p className="muted small-empty">Nobody in this view yet.</p>}
      {sorted.length > limit && <p className="muted small" style={{ marginTop: 8 }}>Expand to see all {sorted.length} people.</p>}
    </Widget>
  );
}

type SortKey = 'name' | 'active' | 'completed' | 'completionRate' | 'onTimeRate' | 'approvalRate' | 'overdue' | 'open' | 'score';
export function PeopleTable({ people, settings, query = '' }: { people: PersonRow[]; settings: KpiSettings; query?: string }) {
  const nav = useNavigate();
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(['score', -1]);
  const rows = useMemo(() => [...people].sort((a, b) => {
    const [k, d] = sort;
    if (k === 'name') return a.name.localeCompare(b.name) * d;
    const va = a.metrics[k] as number | null, vb = b.metrics[k] as number | null;
    return ((va ?? -1) - (vb ?? -1)) * d || a.name.localeCompare(b.name);
  }), [people, sort]);
  const th = (k: SortKey, label: string) => (
    <th className="sortable" aria-sort={sort[0] === k ? (sort[1] === 1 ? 'ascending' : 'descending') : undefined}>
      <button onClick={() => setSort(([s, d]) => [k, s === k ? (d === 1 ? -1 : 1) : k === 'name' ? 1 : -1])}>{label}<ArrowUpDown size={12} aria-hidden="true" /></button>
    </th>
  );
  const pc = (v: number | null, target: number) => <span className={v === null ? 'na' : ''} style={v !== null && v < target * 0.75 ? { color: 'var(--red)' } : undefined}>{pctText(v)}</span>;
  return (
    <>
    <label className="sort-mobile">
      <span>Sort by</span>
      <select className="input sm" value={sort.join(':')} onChange={(e) => { const [k, d] = e.target.value.split(':'); setSort([k as SortKey, Number(d) as 1 | -1]); }}>
        {([['score', 'Score'], ['completed', 'Done'], ['completionRate', 'Completion'], ['onTimeRate', 'On time'], ['overdue', 'Overdue'], ['open', 'Open']] as const).map(([k, l]) => <option key={k} value={`${k}:-1`}>{l}, highest first</option>)}
        <option value="name:1">Name, A to Z</option>
      </select>
    </label>
    <div className="table-wrap stack" style={{ boxShadow: 'none' }}>
      <table>
        <thead><tr>{th('name', 'Person')}{th('active', 'Tasks')}{th('completed', 'Done')}{th('completionRate', 'Completion')}{th('onTimeRate', 'On time')}{th('approvalRate', 'Approved')}{th('open', 'Open')}{th('overdue', 'Overdue')}{th('score', 'Score')}</tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="click" onClick={() => nav(`/people/${p.id}${query}`)}>
              <td><Link to={`/people/${p.id}${query}`} className="who-cell" onClick={(e) => e.stopPropagation()}><Avatar name={p.name} size={28} /><div><b>{p.name}</b><small>{p.teamNames.join(', ') || p.title}</small></div></Link></td>
              <td className="num" data-label="Tasks">{p.metrics.active}</td>
              <td className="num" data-label="Done">{p.metrics.completed}</td>
              <td className="num" data-label="Completion">{pc(p.metrics.completionRate, settings.targets.completion)}</td>
              <td className="num" data-label="On time">{pc(p.metrics.onTimeRate, settings.targets.onTime)}</td>
              <td className="num" data-label="Approved">{pc(p.metrics.approvalRate, settings.targets.approval)}</td>
              <td className="num" data-label="Open">{p.metrics.open}</td>
              <td className="num" data-label="Overdue" style={p.metrics.overdue ? { color: 'var(--red)', fontWeight: 600 } : undefined}>{p.metrics.overdue}</td>
              <td className="act"><span className="row" style={{ gap: 6 }}><ScoreChip score={p.metrics.score} size="sm" /><Delta now={p.metrics.score} prev={p.previousScore} /></span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export function WorkloadWidget({ people, span = 'span-5', query = '' }: { people: PersonRow[]; span?: string; query?: string }) {
  const rows = [...people].filter((p) => p.metrics.open > 0).sort((a, b) => b.metrics.open - a.metrics.open);
  const max = Math.max(1, ...rows.map((p) => p.metrics.open));
  return (
    <Widget className={span} title="Workload distribution" sub="Open tasks per person, by status" icon={<Layers size={16} />} tone="violet">
      <Legend items={WORKLOAD_KEYS.map((k) => ({ label: k.label, color: k.color }))} />
      {rows.length ? (
        <div className="wl" style={{ marginTop: 14 }}>
          {rows.slice(0, 10).map((p) => (
            <div className="wl-row" key={p.id}>
              <span className="nm"><Avatar name={p.name} size={22} /><Link to={`/people/${p.id}${query}`}>{p.name}</Link></span>
              <StackBar max={max} height={12} label={`${p.name}: ${p.metrics.open} open`}
                parts={WORKLOAD_KEYS.map((k) => ({ key: k.key, label: k.label, color: k.color, value: p.metrics.workload[k.key] }))} />
              <span className={`ct ${p.metrics.overdue ? 'over' : ''}`} title={p.metrics.overdue ? `${p.metrics.overdue} overdue` : undefined}>{p.metrics.open}</span>
            </div>
          ))}
          {rows.length > 10 && <p className="muted small">+{rows.length - 10} more people with open work</p>}
        </div>
      ) : <p className="muted small-empty">No open work right now.</p>}
    </Widget>
  );
}

export function TeamsWidget({ teams, settings, span = 'span-12' }: { teams: Overview['teams']; settings: KpiSettings; span?: string }) {
  const labels = teams.map((t) => t.name);
  return (
    <Widget className={span} title="Team comparison" sub="Same period, same rules for every team" icon={<UsersRound size={16} />} tone="pink"
      details={teams.length > 1 ? (
        <>
          <Legend items={[{ label: 'Completion rate', color: 'var(--blue-solid)' }, { label: 'On-time rate', color: 'var(--green-solid)' }, { label: 'Approved on review', color: 'var(--violet-solid)' }]} />
          <BarChart labels={labels} format={(v) => `${v}%`} ariaLabel="Completion, on-time and approval rates per team" height={240}
            series={[
              { key: 'c', label: 'Completion', color: 'var(--blue-solid)', values: teams.map((t) => t.metrics.completionRate) },
              { key: 'o', label: 'On time', color: 'var(--green-solid)', values: teams.map((t) => t.metrics.onTimeRate) },
              { key: 'a', label: 'Approved', color: 'var(--violet-solid)', values: teams.map((t) => t.metrics.approvalRate) },
            ]} />
        </>
      ) : undefined}>
      <div className="tcards">
        {teams.map((t) => (
          <Link key={t.id} to={`/teams/${t.id}`} className="tcard">
            <div className="th"><b>{t.name}</b><ScoreChip score={t.metrics.score} size="sm" /></div>
            {t.department && <span className="pill pink" style={{ alignSelf: 'flex-start', height: 20, fontSize: 11 }}>{t.department}</span>}
            <Sparkline data={t.trend} color="var(--green-solid)" height={34} label={`${t.name}: completed per period`} />
            <div className="tm">
              <span><b className="num">{t.metrics.completed}</b>done</span>
              <span><b className="num">{pctText(t.metrics.onTimeRate)}</b>on time</span>
              <span><b className="num" style={t.metrics.overdue ? { color: 'var(--red)' } : undefined}>{t.metrics.overdue}</b>overdue</span>
              <span><b className="num">{t.members}</b>people</span>
            </div>
            {t.metrics.completionRate !== null && t.metrics.completionRate < settings.targets.completion && t.metrics.enoughData &&
              <small className="muted">Completion {pctText(t.metrics.completionRate)}, below the {settings.targets.completion}% target</small>}
          </Link>
        ))}
      </div>
    </Widget>
  );
}

const PROJECT_PARTS = [
  { key: 'done', label: 'Done', color: 'var(--green-solid)' },
  { key: 'review', label: 'In review', color: 'var(--violet-solid)' },
  { key: 'inProgress', label: 'In progress', color: 'var(--blue-solid)' },
  { key: 'changes', label: 'Changes requested', color: 'var(--red-solid)' },
  { key: 'todo', label: 'To do', color: 'var(--grey-solid)' },
] as const;

export function ProjectsWidget({ projects, span = 'span-7', limit = 6 }: { projects: Overview['projects']; span?: string; limit?: number }) {
  const list = (n: number) => (
    <div className="projlist">
      {projects.slice(0, n).map((p) => {
        const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
        const [st, c] = PROJECT_STATUS[p.status] ?? ['On track', 'green'];
        return (
          <Link key={p.id} to={`/projects/${p.id}?tab=insights`} className="pj">
            <div className="pn"><b>{p.name}</b><small><span>{p.teamName}</span>{p.dueDate && <span>Due {dueLabel(p.dueDate)}</span>}{p.overdue > 0 ? <span className="over">{p.overdue} overdue</span> : <span className={`pill ${c}`} style={{ height: 18, fontSize: 11, padding: '0 7px' }}>{st}</span>}</small></div>
            <StackBar max={Math.max(1, p.total)} height={10} label={`${p.name}: ${PROJECT_PARTS.map((k) => `${p[k.key]} ${k.label}`).join(', ')}`}
              parts={PROJECT_PARTS.map((k) => ({ key: k.key, label: k.label, color: k.color, value: p[k.key] }))} />
            <span className="pct">{pct}%</span>
          </Link>
        );
      })}
    </div>
  );
  return (
    <Widget className={span} title="Project progress" sub="Tasks by status; most overdue first" icon={<FolderKanban size={16} />} tone="green"
      details={projects.length > limit ? list(projects.length) : undefined}>
      <Legend items={PROJECT_PARTS.map((k) => ({ label: k.label, color: k.color }))} />
      <div style={{ marginTop: 10 }}>{projects.length ? list(limit) : <p className="muted small-empty">No projects in this view.</p>}</div>
    </Widget>
  );
}

export function StatusWidget({ projects, span = 'span-5', onPick }: { projects: Overview['projects']; span?: string; onPick?: (status: string) => void }) {
  const sum = (k: (typeof PROJECT_PARTS)[number]['key']) => projects.reduce((s, p) => s + p[k], 0);
  const keyToStatus: Record<string, string> = { done: 'done', review: 'review', inProgress: 'in_progress', changes: 'changes', todo: 'todo' };
  const total = PROJECT_PARTS.reduce((s, k) => s + sum(k.key), 0);
  const overdue = projects.reduce((s, p) => s + p.overdue, 0);
  return (
    <Widget className={span} title="Task status" sub={`${plural(total, 'task')} across ${plural(projects.length, 'project')}`} icon={<ChartPie size={16} />} tone="violet">
      <Donut segments={PROJECT_PARTS.map((k) => ({ key: k.key, label: k.label, value: sum(k.key), color: k.color }))}
        center={<><b className="num">{total ? Math.round((sum('done') / total) * 100) : 0}%</b><small>done</small></>}
        onPick={onPick ? (k) => onPick(keyToStatus[k]) : undefined} />
      {overdue > 0 && <p className="small" style={{ marginTop: 12, color: 'var(--red)' }}>{plural(overdue, 'open task')} past the due date</p>}
    </Widget>
  );
}

export function DeadlinesWidget({ deadlines, calendar, personal, span = 'span-5', title = 'Deadlines' }: {
  deadlines: DeadlineTask[]; calendar: { date: string; count: number }[]; personal?: boolean; span?: string; title?: string;
}) {
  const [day, setDay] = useState<string | null>(null);
  const shown = day ? deadlines.filter((d) => d.dueDate === day) : deadlines;
  return (
    <Widget className={span} title={title} sub={personal ? 'Your open work by due date' : 'Open tasks by due date'} icon={<CalendarDays size={16} />} tone="coral">
      <DueCalendar days={calendar} selected={day} onSelect={setDay} />
      <div style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <b style={{ fontSize: 13, fontWeight: 600 }}>{day ? `Due ${dueLabel(day)}` : 'Overdue and next two weeks'}</b>
          {day && <button className="link-btn" onClick={() => setDay(null)}>Show all</button>}
        </div>
        <DeadlineList items={shown} personal={personal}
          empty={day ? 'This day is outside the list below. Open My Tasks to see everything.' : 'Nothing overdue or due in the next two weeks.'} />
      </div>
    </Widget>
  );
}

export function ContributionsWidget({ items, span = 'span-4', title = 'Project contributions' }: { items: Contribution[]; span?: string; title?: string }) {
  const max = Math.max(1, ...items.map((c) => c.completed + c.open));
  return (
    <Widget className={span} title={title} sub="Finished in this period and still open, per project" icon={<FolderKanban size={16} />} tone="blue">
      <Legend items={[{ label: 'Finished', color: 'var(--green-solid)' }, { label: 'Open', color: 'var(--blue-solid)' }, { label: 'Overdue', color: 'var(--red-solid)' }]} />
      {items.length ? (
        <div className="wl" style={{ marginTop: 14 }}>
          {items.slice(0, 8).map((c) => (
            <div className="wl-row" key={c.id} style={{ gridTemplateColumns: 'minmax(90px, 150px) minmax(0, 1fr) 44px' }}>
              <span className="nm" title={`${c.name} · ${c.teamName}`}>{c.name}</span>
              <StackBar max={max} height={12} parts={[
                { key: 'd', label: 'Finished', value: c.completed, color: 'var(--green-solid)' },
                { key: 'o', label: 'Open', value: c.open - c.overdue, color: 'var(--blue-solid)' },
                { key: 'x', label: 'Overdue', value: c.overdue, color: 'var(--red-solid)' },
              ]} />
              <span className="ct">{c.completed}</span>
            </div>
          ))}
        </div>
      ) : <p className="muted small-empty">No project work in this period.</p>}
    </Widget>
  );
}

export function Definitions({ settings }: { settings: KpiSettings }) {
  return (
    <div className="grid-2" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--fg-2)', gap: '8px 28px' }}>
      <p><b>Completion rate</b>: tasks finished in the period, out of every task someone had on their plate during it (assigned by the end of the period and not finished before it started). Target {settings.targets.completion}%.</p>
      <p><b>On time</b>: of the tasks finished in the period that had a due date, the share finished on or before it. Tasks without a due date are left out. Target {settings.targets.onTime}%.</p>
      <p><b>Approved on review</b>: of the submissions reviewed in the period, the share approved rather than sent back for changes. Target {settings.targets.approval}%.</p>
      <p><b>Overdue</b>: open tasks past their due date at the end of the period. <b>Nothing overdue</b> in the score is the share of open work that is not overdue.</p>
      <p><b>KPI score</b>: a weighted average of the four parts (weights {settings.weights.completion} / {settings.weights.onTime} / {settings.weights.approval} / {settings.weights.backlog}). Parts with no data are left out, and no score is shown until someone has at least {settings.minSample} tasks in the period.</p>
      <p><b>Not measured</b>: time spent, leave and availability are not tracked, so workload shows open tasks rather than hours. Departments come from each team's settings. Every number counts each person on a task separately.</p>
    </div>
  );
}

/** Wraps an analytics view while it loads. */
export function InsightsSkeleton() {
  return (
    <div className="dash" aria-busy="true" aria-label="Loading">
      <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-card" />)}</div>
      <div className="skel skel-wide span-8" /><div className="skel skel-wide span-4" />
    </div>
  );
}

export function weeksIn(range: Range) {
  const [a, b] = [range.from, range.to].map((s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); });
  return (b - a) / 864e5 / 7 + 1 / 7;
}

export function Section({ children }: { children: ReactNode }) {
  return <div className="dash" style={{ marginTop: 16 }}>{children}</div>;
}
