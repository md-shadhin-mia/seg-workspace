import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlarmClock, CircleCheckBig, ClipboardCheck, History, Hourglass, Info, ListTodo } from 'lucide-react';
import { api } from '../lib/api';
import { useMe, isAnyLead } from '../lib/auth';
import { dueLabel } from '../lib/format';
import { rangeLabel, useRange, type PersonAnalytics } from '../lib/analytics';
import { Avatar, ErrorState } from '../components/ui';
import { Crumbs, DeadlineList, Delta, KpiCard, RangePicker, ScoreChip, Widget } from '../components/kpi';
import { ContributionsWidget, Definitions, GoalsWidget, InsightsSkeleton, ScoreWidget, TrendWidget, weeksIn } from '../components/insights';

export default function PersonPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const range = useRange();
  const self = id === me.id;
  const q = useQuery({
    queryKey: ['analytics', 'person', id, range.from, range.to],
    queryFn: () => api.get<PersonAnalytics>(`/analytics/people/${id}?from=${range.from}&to=${range.to}`),
    placeholderData: keepPreviousData,
  });
  if (q.isLoading) return <div className="page"><InsightsSkeleton /></div>;
  if (q.error && !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const s = d.summary, p = d.previous;
  const first = d.person.name.split(' ')[0];
  const rq = range.preset === 'custom' ? `?range=custom&from=${range.from}&to=${range.to}` : `?range=${range.preset}`;

  return (
    <div className="page">
      <Crumbs items={self ? [{ label: 'Dashboard', to: '/' }, { label: 'My performance' }]
        : [{ label: 'Dashboard', to: '/' }, ...(isAnyLead(me) ? [{ label: 'Analytics', to: `/analytics${rq}` }] : []), { label: d.person.name }]} />
      <div className="hero">
        <div className="ht row" style={{ gap: 18, alignItems: 'center' }}>
          <Avatar name={d.person.name} size={64} />
          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">{d.person.title || 'No job title'}{d.person.teams.length > 0 && <> · {d.person.teams.map((t) => `${t.name}${t.role === 'lead' ? ' (lead)' : ''}`).join(', ')}</>}</span>
            <h1 className="row" style={{ gap: 12 }}>{self ? 'My performance' : d.person.name}<ScoreChip score={s.score} /></h1>
            <p>{rangeLabel(d.range)}{d.scopeTeams && <> · counting work in {d.scopeTeams.join(', ') || 'your teams'} only</>}{!d.person.active && ' · account turned off'}</p>
          </div>
        </div>
        <div className="hact"><RangePicker preset={range.preset} from={range.from} to={range.to} onChange={range.set} /></div>
      </div>

      <div className="dash" style={{ opacity: q.isPlaceholderData ? 0.6 : 1, transition: 'opacity 0.2s' }}>
        <div className="kpis">
          <KpiCard tone="green" icon={<CircleCheckBig size={17} />} label="Completed" value={s.completed} delta={<Delta now={s.completed} prev={p.completed} />}
            spark={d.trend.map((b) => b.completed)} sparkColor="var(--green)" sub={`of ${s.active} tasks on ${self ? 'your' : 'their'} plate`} />
          <KpiCard tone="blue" icon={<AlarmClock size={17} />} label="On-time delivery" value={s.onTimeRate} suffix="%" empty="No data"
            delta={<Delta now={s.onTimeRate} prev={p.onTimeRate} unit=" pts" />} sub={s.completedWithDue ? `${s.onTime} of ${s.completedWithDue} dated tasks` : 'No dated tasks finished'} />
          <KpiCard tone="violet" icon={<ClipboardCheck size={17} />} label="Approved on review" value={s.approvalRate} suffix="%" empty="No reviews"
            delta={<Delta now={s.approvalRate} prev={p.approvalRate} unit=" pts" />} sub={`${s.approved} of ${s.reviewed} submissions`} />
          <KpiCard tone="coral" icon={<Hourglass size={17} />} label="Overdue" value={s.overdue} delta={<Delta now={s.overdue} prev={p.overdue} invert />}
            sub={`${s.open} open · ${s.workload.changes} need changes`} to={self ? '/my-tasks' : undefined} />
        </div>
        <TrendWidget trend={d.trend} range={d.range} title={self ? 'Your productivity' : `${first}'s productivity`} />
        <ScoreWidget m={s} prev={p} settings={d.settings} />
        <GoalsWidget m={s} settings={d.settings} weeks={weeksIn(d.range)} personal span="span-4" />
        <ContributionsWidget items={d.contributions} span="span-4" />
        <Widget className="span-4" title="Upcoming deadlines" sub="Overdue and next two weeks" icon={<ListTodo size={16} />} tone="coral">
          <DeadlineList items={d.deadlines} personal />
        </Widget>
        <Widget className="span-12" title="Recently completed" sub="In this period, newest first" icon={<History size={16} />} tone="green">
          {d.recent.length ? (
            <div className="table-wrap stack" style={{ boxShadow: 'none' }}>
              <table>
                <thead><tr><th>Task</th><th>Project</th><th>Finished</th><th>Due</th><th>Delivery</th></tr></thead>
                <tbody>
                  {d.recent.map((t) => {
                    const late = t.dueDate && t.doneOn > t.dueDate;
                    return (
                      <tr key={t.id}>
                        <td><Link to={`/tasks/${t.id}`} className="text-link" style={{ fontWeight: 500 }}>{t.title}</Link> <span className="muted">#{t.seq}</span></td>
                        <td data-label="Project">{t.projectName}</td>
                        <td data-label="Finished">{dueLabel(t.doneOn)}</td>
                        <td data-label="Due">{t.dueDate ? dueLabel(t.dueDate) : <span className="na">No date</span>}</td>
                        <td data-label="Delivery">{!t.dueDate ? <span className="pill">No due date</span> : late ? <span className="pill red">Late</span> : <span className="pill green">On time</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small-empty">Nothing finished in this period.</p>}
        </Widget>
        <Widget className="span-12" title="How these numbers work" icon={<Info size={16} />} tone="plain">
          <Definitions settings={d.settings} />
        </Widget>
      </div>
    </div>
  );
}
