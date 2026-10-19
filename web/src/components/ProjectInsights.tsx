import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ChartLine, ChartPie, CircleCheckBig, ClipboardCheck, Hourglass, Info, UsersRound } from 'lucide-react';
import { api } from '../lib/api';
import { STATUS, dayDiff, dueLabel } from '../lib/format';
import { bucketLabel, bucketTitle, pctText, useRange, type ProjectAnalytics } from '../lib/analytics';
import { Donut, Legend, LineChart, StackBar } from './charts';
import { KpiCard, RangePicker, Widget } from './kpi';
import { InsightsSkeleton } from './insights';
import { Avatar, AvatarStack, ErrorState, StatusPill } from './ui';

/** The project page's Insights tab. Visible to everyone who can open the project. */
export function ProjectInsights({ projectId }: { projectId: string }) {
  const range = useRange();
  const q = useQuery({
    queryKey: ['analytics', 'project', projectId, range.from, range.to],
    queryFn: () => api.get<ProjectAnalytics>(`/analytics/projects/${projectId}?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <InsightsSkeleton />;
  if (q.error && !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const t = d.totals;
  const open = t.total - t.done;
  const maxAssigned = Math.max(1, ...d.members.map((m) => m.assigned));
  const segments = [
    { key: 'done', label: 'Done', value: t.done, color: 'var(--green-solid)' },
    { key: 'review', label: 'In review', value: t.review, color: 'var(--violet-solid)' },
    { key: 'inProgress', label: 'In progress', value: t.inProgress, color: 'var(--blue-solid)' },
    { key: 'changes', label: 'Changes requested', value: t.changes, color: 'var(--red-solid)' },
    { key: 'todo', label: 'To do', value: t.todo, color: 'var(--grey-solid)' },
  ];
  // Group the due-date timeline by month so long projects stay readable.
  const months = new Map<string, ProjectAnalytics['timeline']>();
  for (const x of d.timeline) months.set(x.dueDate.slice(0, 7), [...(months.get(x.dueDate.slice(0, 7)) ?? []), x]);

  return (
    <div className="dash" style={{ opacity: q.isPlaceholderData ? 0.6 : 1, transition: 'opacity 0.2s' }}>
      <div className="toolbar span-12" style={{ marginBottom: 0 }}>
        <span className="muted" style={{ fontSize: 13 }}>Progress chart covers the selected range. Totals are for the whole project.</span>
        <span className="sp" />
        <RangePicker preset={range.preset} from={range.from} to={range.to} onChange={range.set} />
      </div>
      <div className="kpis">
        <KpiCard tone="green" icon={<CircleCheckBig size={17} />} label="Complete" value={t.pct} suffix="%" sub={`${t.done} of ${t.total} tasks done`}>
          <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${t.pct}%`, background: 'var(--green-solid)' }} /></div>
        </KpiCard>
        <KpiCard tone="blue" icon={<ChartLine size={17} />} label="Open" value={open} sub={`${t.inProgress} in progress · ${t.todo} to do${t.noDueDate ? ` · ${t.noDueDate} without a date` : ''}`} />
        <KpiCard tone="violet" icon={<ClipboardCheck size={17} />} label="In review" value={t.review} sub={t.changes ? `${t.changes} sent back for changes` : 'Waiting for a reviewer'} />
        <KpiCard tone="coral" icon={<Hourglass size={17} />} label="Delayed" value={t.overdue + t.late} sub={`${t.overdue} overdue now · ${t.late} finished late`} />
      </div>

      <Widget className="span-8" title="Progress over time" sub="Tasks in the project and tasks done, at the end of each period" icon={<ChartLine size={16} />} tone="blue">
        <Legend items={[{ label: 'Done', color: 'var(--green-solid)' }, { label: 'All tasks', color: 'var(--blue-solid)', dashed: true }]} />
        <LineChart labels={d.progress.map((b) => bucketLabel(b, d.range.bucket))} title={(i) => bucketTitle(d.progress[i], d.range.bucket)}
          ariaLabel="Project tasks and completed tasks over time"
          series={[
            { key: 'done', label: 'Done', color: 'var(--green-solid)', values: d.progress.map((b) => b.done), area: true },
            { key: 'total', label: 'All tasks', color: 'var(--blue-solid)', values: d.progress.map((b) => b.total), dashed: true },
          ]} />
      </Widget>
      <Widget className="span-4" title="Status" sub={`${t.total} tasks`} icon={<ChartPie size={16} />} tone="violet">
        <Donut segments={segments} center={<><b className="num">{t.pct}%</b><small>done</small></>} />
        {d.project.dueDate && (
          <div className="notice-inline" style={{ marginTop: 14 }}><CalendarClock size={14} />
            Project due {dueLabel(d.project.dueDate)}{dayDiff(d.project.dueDate) >= 0 ? ` · ${dayDiff(d.project.dueDate)} days left` : ' · past its due date'}
          </div>
        )}
      </Widget>

      <Widget className="span-7" title="Team contributions" sub="Everyone assigned in this project, all time" icon={<UsersRound size={16} />} tone="pink">
        {d.members.length ? (
          <div className="wl">
            {d.members.map((m) => (
              <div key={m.id} className="wl-row" style={{ gridTemplateColumns: 'minmax(120px, 190px) minmax(0, 1fr) 116px' }}>
                <span className="nm"><Avatar name={m.name} size={26} /><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span></span>
                <StackBar max={maxAssigned} height={12} parts={[
                  { key: 'd', label: 'Done', value: m.done, color: 'var(--green-solid)' },
                  { key: 'o', label: 'Open', value: m.open - m.overdue, color: 'var(--blue-solid)' },
                  { key: 'x', label: 'Overdue', value: m.overdue, color: 'var(--red-solid)' },
                ]} />
                <span className="small" style={{ textAlign: 'right', color: 'var(--fg-2)' }}><b className="num" style={{ color: 'var(--fg)' }}>{m.done}/{m.assigned}</b> · {pctText(m.onTimeRate)} on time</span>
              </div>
            ))}
            <Legend items={[{ label: 'Done', color: 'var(--green-solid)' }, { label: 'Open', color: 'var(--blue-solid)' }, { label: 'Overdue', color: 'var(--red-solid)' }]} />
          </div>
        ) : <p className="muted small-empty">Nobody is assigned yet.</p>}
      </Widget>
      <Widget className="span-5" title="Delayed work" sub="Overdue now, or finished after the due date" icon={<AlertTriangle size={16} />} tone="coral">
        {d.delayed.length ? (
          <ul className="deadlines">
            {d.delayed.slice(0, 8).map((x) => (
              <li key={x.id}>
                <Link to={`/tasks/${x.id}`} className={`dl ${x.completedOn ? 'soon' : 'over'}`}>
                  <span className="dl-main"><span className="dl-t">{x.title}</span>
                    <span className="dl-s">{x.completedOn ? `Due ${dueLabel(x.dueDate)}, finished ${dueLabel(x.completedOn)}` : `Due ${dueLabel(x.dueDate)} · ${-dayDiff(x.dueDate)} days over`}</span></span>
                  {x.assignees.length > 0 && <AvatarStack names={x.assignees.map((a) => a.name)} size={22} max={2} />}
                  <StatusPill status={x.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="muted small-empty">No delays. Everything is on schedule.</p>}
      </Widget>

      <Widget className="span-12" title="Timeline" sub="Tasks by due date. Milestones aren't tracked separately, so due dates mark the schedule." icon={<CalendarClock size={16} />} tone="yellow">
        {d.timeline.length ? (
          <div className="ptl">
            {[...months.entries()].map(([m, items]) => (
              <div key={m} className="ptl-m">
                <div className="ptl-h">{new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}<span className="muted"> · {items.filter((x) => x.status === 'done').length}/{items.length} done</span></div>
                <div className="ptl-items">
                  {items.map((x) => {
                    const late = x.status !== 'done' && dayDiff(x.dueDate) < 0;
                    return (
                      <Link key={x.id} to={`/tasks/${x.id}`} className={`ptl-i st-b-${x.status} ${late ? 'late' : ''}`} title={`${x.title} · ${STATUS[x.status]} · due ${dueLabel(x.dueDate)}`}>
                        <span className="ptl-d">{dueLabel(x.dueDate)}</span>
                        <span className="ptl-t">{x.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="notice-inline"><Info size={14} />No tasks have due dates yet. Add dates to see the schedule here.</div>}
      </Widget>
    </div>
  );
}
