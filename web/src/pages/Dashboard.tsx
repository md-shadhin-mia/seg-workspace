import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Activity, AlarmClock, ArrowRight, Building2, ChartNoAxesCombined, CircleCheckBig, ClipboardCheck, Crosshair, Hourglass, ListTodo, Percent, UserRound, UsersRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { ago, firstName, greeting, plural } from '../lib/format';
import { rangeLabel, useRange, type Overview, type View } from '../lib/analytics';
import type { Dashboard as D } from '../lib/types';
import { Avatar, Empty } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { useShell } from '../components/Shell';
import { ActivityList, Delta, KpiCard, RangePicker, Widget } from '../components/kpi';
import {
  ContributionsWidget, DeadlinesWidget, GoalsWidget, InsightsSkeleton, PeopleWidget, ProjectsWidget, ScoreWidget, StatusWidget, TeamsWidget,
  TrendWidget, WorkloadWidget, weeksIn,
} from '../components/insights';

const VIEW_LABEL: Record<View, [string, typeof UsersRound]> = { org: ['Organisation', Building2], team: ['My teams', UsersRound], personal: ['My work', UserRound] };

export default function Dashboard() {
  const me = useMe();
  const shell = useShell();
  const nav = useNavigate();
  const range = useRange();
  const [params, setParams] = useSearchParams();
  const viewParam = params.get('view') as View | null;
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<D>('/dashboard') });
  const ov = useQuery({
    queryKey: ['analytics', 'overview', viewParam ?? 'default', range.from, range.to],
    queryFn: () => api.get<Overview>(`/analytics/overview?${new URLSearchParams({ ...(viewParam ? { view: viewParam } : {}), from: range.from, to: range.to })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const d = dash.data;
  const c = d?.counts;
  const parts = c ? [
    c.dueToday && `${plural(c.dueToday, 'task')} due today`,
    c.overdue && `${c.overdue} overdue`,
    c.changes && `${c.changes} to revise after feedback`,
    d!.reviewQueue.length && `${plural(d!.reviewQueue.length, 'submission')} waiting for your review`,
  ].filter(Boolean) as string[] : [];
  const sentence = !c ? ' ' : parts.length ? `You have ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : 'Nothing urgent right now. A good moment to plan ahead.';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const o = ov.data;
  const view = o?.view ?? viewParam;
  const setView = (v: View) => setParams((x) => { const n = new URLSearchParams(x); n.set('view', v); return n; }, { replace: true });
  const rq = range.preset === 'custom' ? `?range=custom&from=${range.from}&to=${range.to}` : `?range=${range.preset}`;

  return (
    <div className="page">
      <div className="hero">
        <div className="ht">
          <span className="eyebrow"><span className="live" aria-hidden="true" />{today}{o && <> · {rangeLabel(o.range)}</>}</span>
          <h1>{greeting()}, {firstName(me.name)}</h1>
          <p>{sentence}</p>
        </div>
        <div className="hact">
          {o && o.views.length > 1 && (
            <div className="subtabs viewtabs" role="group" aria-label="Dashboard view">
              {o.views.map((v) => {
                const [l, Icon] = VIEW_LABEL[v];
                return <button key={v} className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => setView(v)}><Icon size={14} />{l}</button>;
              })}
            </div>
          )}
          <RangePicker preset={range.preset} from={range.from} to={range.to} onChange={range.set} />
        </div>
      </div>

      {ov.isLoading ? <InsightsSkeleton /> : ov.error ? (
        <div className="notice err" role="alert">Couldn’t load your numbers: {(ov.error as Error).message} <button className="text-link" onClick={() => ov.refetch()}>Try again</button></div>
      ) : o && (
        <div className="dash" style={{ opacity: ov.isPlaceholderData ? 0.6 : 1, transition: 'opacity 0.2s' }}>
          {o.view === 'personal' ? <Personal o={o} d={d} rq={rq} /> : <Team o={o} rq={rq} onStatus={(s) => nav(`/analytics${rq}&status=${s}`)} />}

          {d && d.reviewQueue.length > 0 && (
            <Widget className="span-12" id="reviews" title="Needs your review" sub="Oldest first" icon={<ClipboardCheck size={16} />} tone="violet"
              actions={<span className="badge">{d.reviewQueue.length}</span>}>
              <div className="rq">
                {d.reviewQueue.slice(0, 6).map((r) => (
                  <Link key={r.submissionId} to={`/tasks/${r.taskId}?tab=submissions`}>
                    <Avatar name={r.userName} size={32} />
                    <span className="rq-m"><b>{r.title}</b><small>{r.userName} submitted version {r.version} · {r.projectName}</small></span>
                    <small className="muted">{ago(r.createdAt)}</small>
                    <span className="btn sm">Review</span>
                  </Link>
                ))}
              </div>
            </Widget>
          )}

          <Widget className={o.view === 'personal' ? 'span-8' : 'span-7'} title="Your focus" sub="Assigned to you, most urgent first" icon={<Crosshair size={16} />} tone="yellow"
            actions={<Link to="/my-tasks" className="link-btn">All my tasks <ArrowRight size={14} /></Link>}>
            {!d ? <div className="skel" style={{ height: 120 }} /> : d.focus.length ? (
              <div className="list" style={{ boxShadow: 'none' }}>{d.focus.slice(0, o.view === 'personal' ? 8 : 5).map((t) => <TaskRow key={t.id} t={t as any} useMyStatus />)}</div>
            ) : (
              <Empty title="You're all caught up" action={<button className="btn" onClick={() => shell.newTask()}>Create a task</button>}>
                Tasks assigned to you show up here, most urgent first.
              </Empty>
            )}
          </Widget>
          <Widget className={o.view === 'personal' ? 'span-4' : 'span-5'} title="Recent activity" sub="Last 30 days · updates every minute" icon={<Activity size={16} />} tone="plain">
            <ActivityList feed={o.activity} />
          </Widget>
        </div>
      )}
    </div>
  );
}

function Personal({ o, d, rq }: { o: Overview; d?: D; rq: string }) {
  const me = useMe();
  const s = o.summary, p = o.previous;
  return (
    <>
      <div className="kpis">
        <KpiCard tone="yellow" icon={<ListTodo size={17} />} label="Open tasks" value={s.open} to="/my-tasks" delay={0}
          sub={d ? `${d.counts.dueToday} due today · ${d.counts.changes} need changes` : 'Assigned to you'} />
        <KpiCard tone="green" icon={<CircleCheckBig size={17} />} label="Completed" value={s.completed} to={`/people/${me.id}${rq}`} delay={60}
          delta={<Delta now={s.completed} prev={p.completed} />} spark={o.trend.map((b) => b.completed)} sparkColor="var(--green)" sub={`of ${s.active} on your plate`} />
        <KpiCard tone="blue" icon={<AlarmClock size={17} />} label="On-time delivery" value={s.onTimeRate} suffix="%" empty="No data" delay={120}
          delta={<Delta now={s.onTimeRate} prev={p.onTimeRate} unit=" pts" />}
          sub={s.completedWithDue ? `${s.onTime} of ${s.completedWithDue} dated tasks · target ${o.settings.targets.onTime}%` : 'No dated tasks finished in this period'}>
          {s.onTimeRate !== null && <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${s.onTimeRate}%`, background: 'var(--blue-solid)' }} /></div>}
        </KpiCard>
        <KpiCard tone="coral" icon={<Hourglass size={17} />} label="Overdue" value={s.overdue} to="/my-tasks" delay={180}
          delta={<Delta now={s.overdue} prev={p.overdue} invert />} sub={s.overdue ? 'Past the due date and still open' : 'Nothing past its due date'} />
      </div>
      <TrendWidget trend={o.trend} range={o.range} title="Your productivity" />
      <ScoreWidget m={s} prev={p} settings={o.settings} title="Your KPI score" to={`/people/${me.id}${rq}`} />
      <GoalsWidget m={s} settings={o.settings} weeks={weeksIn(o.range)} personal span="span-4" />
      <ContributionsWidget items={o.contributions} span="span-4" />
      <DeadlinesWidget deadlines={o.deadlines} calendar={o.calendar} personal span="span-4" />
    </>
  );
}

function Team({ o, rq, onStatus }: { o: Overview; rq: string; onStatus: (s: string) => void }) {
  const s = o.summary, p = o.previous;
  const org = o.view === 'org';
  return (
    <>
      <div className="kpis">
        <KpiCard tone="green" icon={<CircleCheckBig size={17} />} label="Tasks completed" value={s.completed} to={`/analytics${rq}`} delay={0}
          delta={<Delta now={s.completed} prev={p.completed} />} spark={o.trend.map((b) => b.completed)} sparkColor="var(--green)"
          sub={`${s.assigned} newly assigned · ${o.people.length} people`} />
        <KpiCard tone="blue" icon={<Percent size={17} />} label="Completion rate" value={s.completionRate} suffix="%" empty="No data" to={`/analytics${rq}`} delay={60}
          delta={<Delta now={s.completionRate} prev={p.completionRate} unit=" pts" />} sub={`${s.completed} of ${s.active} tasks · target ${o.settings.targets.completion}%`}>
          {s.completionRate !== null && <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${s.completionRate}%`, background: 'var(--blue-solid)' }} /></div>}
        </KpiCard>
        <KpiCard tone="violet" icon={<AlarmClock size={17} />} label="On-time delivery" value={s.onTimeRate} suffix="%" empty="No data" to={`/analytics${rq}`} delay={120}
          delta={<Delta now={s.onTimeRate} prev={p.onTimeRate} unit=" pts" />} sub={`${s.late} finished late · target ${o.settings.targets.onTime}%`}>
          {s.onTimeRate !== null && <div className="progress" style={{ marginTop: 6 }}><i style={{ width: `${s.onTimeRate}%`, background: 'var(--violet-solid)' }} /></div>}
        </KpiCard>
        <KpiCard tone="coral" icon={<Hourglass size={17} />} label="Overdue now" value={s.overdue} to={`/analytics${rq}`} delay={180}
          delta={<Delta now={s.overdue} prev={p.overdue} invert />} sub={`${s.open} open in total`} />
      </div>
      <TrendWidget trend={o.trend} range={o.range} title={org ? 'Organisation productivity' : 'Team productivity'} />
      <ScoreWidget m={s} prev={p} settings={o.settings} title={org ? 'Organisation KPI score' : 'Team KPI score'} />
      <PeopleWidget people={o.people} settings={o.settings} query={rq} />
      <WorkloadWidget people={o.people} query={rq} />
      {(org || o.teams.length > 1) && <TeamsWidget teams={o.teams} settings={o.settings} />}
      <ProjectsWidget projects={o.projects} />
      <StatusWidget projects={o.projects} onPick={onStatus} />
      <DeadlinesWidget deadlines={o.deadlines} calendar={o.calendar} span="span-6" />
      <Widget className="span-6" title="Go deeper" sub="Filter by team, project, person or status" icon={<ChartNoAxesCombined size={16} />} tone="blue">
        <div className="rates">
          <Link to={`/analytics${rq}`} className="rate" style={{ textDecoration: 'none' }}><span className="rate-l">Full analytics</span><span className="rate-v" style={{ fontSize: 16 }}>Open <ArrowRight size={14} /></span><span className="rate-t">Every person, team and project</span></Link>
          <div className="rate"><span className="rate-l">Approved on review</span><span className="rate-v num">{s.approvalRate === null ? '–' : `${Math.round(s.approvalRate)}%`}</span><Delta now={s.approvalRate} prev={p.approvalRate} unit=" pts" /></div>
          <div className="rate"><span className="rate-l">Reviews in period</span><span className="rate-v num">{s.reviewed}</span><span className="rate-t">{s.approved} approved · {s.reviewed - s.approved} sent back</span></div>
        </div>
      </Widget>
    </>
  );
}
