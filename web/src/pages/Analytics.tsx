import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock, Building2, CircleCheckBig, ClipboardCheck, FolderKanban, Hourglass, Info, ListFilter, Percent, RotateCcw, SlidersHorizontal, Table2, UserRound, UsersRound,
} from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useMe, isAnyLead } from '../lib/auth';
import { STATUS, STATUS_ORDER, dueLabel } from '../lib/format';
import { rangeLabel, useRange, type KpiSettings, type Overview } from '../lib/analytics';
import { Modal, useToast } from '../components/ui';
import { ActivityList, Crumbs, Delta, FilterSelect, KpiCard, RangePicker, Widget } from '../components/kpi';
import { StackBar } from '../components/charts';
import { Definitions, DeadlinesWidget, InsightsSkeleton, PeopleTable, ScoreWidget, StatusWidget, TeamsWidget, TrendWidget, WorkloadWidget } from '../components/insights';

const FILTERS = ['department', 'teamId', 'projectId', 'userId', 'status'] as const;

export default function Analytics() {
  const me = useMe();
  const range = useRange();
  const [params, setParams] = useSearchParams();
  const [rules, setRules] = useState(false);
  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTERS)[number], string>;
  const setF = (k: (typeof FILTERS)[number], v: string) => setParams((x) => {
    const n = new URLSearchParams(x);
    if (v) n.set(k, v); else n.delete(k);
    if (k === 'teamId' || k === 'department') n.delete('projectId');
    return n;
  }, { replace: true });
  const clear = () => setParams((x) => { const n = new URLSearchParams(x); FILTERS.forEach((k) => n.delete(k)); return n; }, { replace: true });
  const qs = new URLSearchParams({ from: range.from, to: range.to, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const ov = useQuery({
    queryKey: ['analytics', 'overview', 'page', qs.toString()],
    queryFn: () => api.get<Overview>(`/analytics/overview?${qs}`),
    placeholderData: keepPreviousData,
    enabled: isAnyLead(me),
  });

  // Analytics across people is for leads and admins; everyone else has their own performance page.
  if (!isAnyLead(me)) return <Navigate to={`/people/${me.id}`} replace />;
  if (ov.isLoading) return <div className="page"><InsightsSkeleton /></div>;
  if (ov.error && !ov.data) {
    return (
      <div className="page">
        <div className="notice err" role="alert">{(ov.error as ApiError).message} <button className="text-link" onClick={clear}>Clear filters</button></div>
      </div>
    );
  }
  const o = ov.data!;
  const s = o.summary, p = o.previous;
  const org = o.view === 'org';
  const active = FILTERS.filter((k) => f[k]).length;
  const projects = o.filters.projects.filter((x) => !f.teamId || x.teamId === f.teamId);
  const rq = `?${new URLSearchParams({ range: range.preset, ...(range.preset === 'custom' ? { from: range.from, to: range.to } : {}) })}`;
  const scope = org ? 'Every team in the organisation' : `Teams you lead: ${o.filters.teams.map((t) => t.name).join(', ')}`;

  return (
    <div className="page">
      <Crumbs items={[{ label: 'Dashboard', to: '/' }, { label: 'Analytics' }]} />
      <div className="hero">
        <div className="ht">
          <span className="eyebrow">{org ? <Building2 size={14} /> : <UsersRound size={14} />}{scope}</span>
          <h1>Performance analytics</h1>
          <p>Who is working on what, how projects are moving and where attention is needed, for {rangeLabel(o.range)}, compared with the period just before it.</p>
        </div>
        <div className="hact">
          <button className="btn" onClick={() => setRules(true)}><SlidersHorizontal size={15} />Scoring rules</button>
          <RangePicker preset={range.preset} from={range.from} to={range.to} onChange={range.set} />
        </div>
      </div>

      <div className="toolbar">
        <span className="row" style={{ gap: 6, color: 'var(--fg-3)', fontSize: 13 }}><ListFilter size={15} />Filter</span>
        <div className="filters">
          {org && o.filters.departments.length > 0 && (
            <FilterSelect label="Department" value={f.department} onChange={(v) => setF('department', v)} options={o.filters.departments.map((d) => ({ value: d, label: d }))} />
          )}
          {o.filters.teams.length > 1 && <FilterSelect label="Team" value={f.teamId} onChange={(v) => setF('teamId', v)} options={o.filters.teams.map((t) => ({ value: t.id, label: t.name }))} />}
          <FilterSelect label="Project" value={f.projectId} onChange={(v) => setF('projectId', v)} options={projects.map((x) => ({ value: x.id, label: x.name }))} />
          <FilterSelect label="Person" value={f.userId} onChange={(v) => setF('userId', v)} options={o.filters.people.map((x) => ({ value: x.id, label: x.name }))} />
          <FilterSelect label="Status" value={f.status} onChange={(v) => setF('status', v)} options={STATUS_ORDER.map((x) => ({ value: x, label: STATUS[x] }))} />
          {active > 0 && <button className="btn ghost sm" onClick={clear}><RotateCcw size={14} />Clear {active > 1 ? `${active} filters` : 'filter'}</button>}
        </div>
        <span className="sp" />
        {ov.isFetching && <span className="spinner" style={{ color: 'var(--fg-3)' }} aria-label="Updating" />}
      </div>
      {f.status && <div className="notice-inline" style={{ marginBottom: 16 }}><Info size={14} />Status filters use where each task stands today, so rates only count work that is currently {STATUS[f.status as keyof typeof STATUS].toLowerCase()}.</div>}

      <div className="dash" style={{ opacity: ov.isPlaceholderData ? 0.6 : 1, transition: 'opacity 0.2s' }}>
        <div className="kpis" style={{ ['--n' as any]: 5 }}>
          <KpiCard tone="green" icon={<CircleCheckBig size={17} />} label="Completed" value={s.completed} delta={<Delta now={s.completed} prev={p.completed} />}
            spark={o.trend.map((b) => b.completed)} sparkColor="var(--green)" sub={`${s.assigned} newly assigned`} />
          <KpiCard tone="blue" icon={<Percent size={17} />} label="Completion" value={s.completionRate} suffix="%" empty="No data"
            delta={<Delta now={s.completionRate} prev={p.completionRate} unit=" pts" />} sub={`${s.completed} of ${s.active} · target ${o.settings.targets.completion}%`} />
          <KpiCard tone="violet" icon={<AlarmClock size={17} />} label="On time" value={s.onTimeRate} suffix="%" empty="No data"
            delta={<Delta now={s.onTimeRate} prev={p.onTimeRate} unit=" pts" />} sub={`${s.onTime} of ${s.completedWithDue} dated · ${s.late} late`} />
          <KpiCard tone="yellow" icon={<ClipboardCheck size={17} />} label="Approved on review" value={s.approvalRate} suffix="%" empty="No reviews"
            delta={<Delta now={s.approvalRate} prev={p.approvalRate} unit=" pts" />} sub={`${s.approved} of ${s.reviewed} reviews`} />
          <KpiCard tone="coral" icon={<Hourglass size={17} />} label="Overdue" value={s.overdue} delta={<Delta now={s.overdue} prev={p.overdue} invert />} sub={`${s.open} open in total`} />
        </div>

        <TrendWidget trend={o.trend} range={o.range} />
        <ScoreWidget m={s} prev={p} settings={o.settings} title={f.userId ? 'Score' : 'Overall KPI score'} />

        {o.teams.length > 1 && !f.userId && <TeamsWidget teams={o.teams} settings={o.settings} />}

        <Widget className="span-12" title="People" sub="Click a person for their full performance view. Click a column to sort." icon={<Table2 size={16} />} tone="pink">
          {o.people.length ? <PeopleTable people={o.people} settings={o.settings} query={rq} /> : <p className="muted small-empty">Nobody matches these filters.</p>}
        </Widget>

        <WorkloadWidget people={o.people} query={rq} span="span-7" />
        <StatusWidget projects={o.projects} span="span-5" onPick={(st) => setF('status', f.status === st ? '' : st)} />

        <Widget className="span-12" title="Projects" sub="Progress, delays and what moved in this period" icon={<FolderKanban size={16} />} tone="green">
          {o.projects.length ? (
            <div className="table-wrap stack" style={{ boxShadow: 'none' }}>
              <table>
                <thead><tr><th>Project</th><th>Progress</th><th>Done</th><th>In review</th><th>Overdue</th><th>Done this period</th><th>Due</th></tr></thead>
                <tbody>
                  {o.projects.map((x) => {
                    const pct = x.total ? Math.round((x.done / x.total) * 100) : 0;
                    return (
                      <tr key={x.id}>
                        <td><Link to={`/projects/${x.id}?tab=insights`} className="who-cell"><div><b>{x.name}</b><small>{x.teamName}</small></div></Link></td>
                        <td className="wide" data-label="Progress"><div className="bar-cell"><StackBar max={Math.max(1, x.total)} height={8} parts={[
                          { key: 'd', label: 'Done', value: x.done, color: 'var(--green-solid)' },
                          { key: 'r', label: 'In review', value: x.review, color: 'var(--violet-solid)' },
                          { key: 'p', label: 'In progress', value: x.inProgress, color: 'var(--blue-solid)' },
                          { key: 'c', label: 'Changes requested', value: x.changes, color: 'var(--red-solid)' },
                          { key: 't', label: 'To do', value: x.todo, color: 'var(--grey-solid)' },
                        ]} /><b className="num" style={{ minWidth: 38, textAlign: 'right' }}>{pct}%</b></div></td>
                        <td className="num" data-label="Done">{x.done}/{x.total}</td>
                        <td className="num" data-label="In review">{x.review}</td>
                        <td className="num" data-label="Overdue" style={x.overdue ? { color: 'var(--red)', fontWeight: 600 } : undefined}>{x.overdue}</td>
                        <td className="num" data-label="Done this period">{x.doneInPeriod}</td>
                        <td data-label="Due">{x.dueDate ? dueLabel(x.dueDate) : <span className="na">–</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="muted small-empty">No projects match these filters.</p>}
        </Widget>

        <DeadlinesWidget deadlines={o.deadlines} calendar={o.calendar} span="span-7" />
        <Widget className="span-5" title="Recent activity" sub="Last 30 days in this view" icon={<UserRound size={16} />} tone="plain">
          <ActivityList feed={o.activity} />
        </Widget>

        <Widget className="span-12" title="How these numbers work" icon={<Info size={16} />} tone="plain">
          <Definitions settings={o.settings} />
        </Widget>
      </div>
      {rules && <ScoringRules settings={o.settings} canEdit={me.role === 'admin'} onClose={() => setRules(false)} />}
    </div>
  );
}

function ScoringRules({ settings, canEdit, onClose }: { settings: KpiSettings; canEdit: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState(settings);
  const total = Object.values(s.weights).reduce((a, b) => a + b, 0);
  const save = useMutation({
    mutationFn: () => api.put<KpiSettings>('/analytics/settings', s),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['analytics'] }); toast('Scoring rules saved'); onClose(); },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  const num = (v: number, set: (n: number) => void, id: string, max = 100) => (
    <input id={id} type="number" className="input sm" min={0} max={max} value={v} disabled={!canEdit} onChange={(e) => set(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} style={{ width: 84 }} />
  );
  const W = [['completion', 'Completion rate'], ['onTime', 'On-time delivery'], ['approval', 'Approved on review'], ['backlog', 'Nothing overdue']] as const;
  const T = [['completion', 'Completion rate', '%'], ['onTime', 'On-time delivery', '%'], ['approval', 'Approved on review', '%'], ['weeklyCompleted', 'Tasks finished per person per week', '']] as const;
  return (
    <Modal title="Scoring rules" onClose={onClose} wide footer={canEdit ? <>
      <span className="note">Applies to every view straight away, including past periods.</span>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || total === 0}>Save rules</button>
    </> : undefined}>
      {!canEdit && <div className="notice info"><Info size={16} />Only admins can change these. They are shown so everyone can see how scores are made.</div>}
      <div>
        <h3 style={{ marginBottom: 10 }}>Weights in the KPI score</h3>
        {W.map(([k, l]) => (
          <div key={k} className="row" style={{ padding: '6px 0', justifyContent: 'space-between' }}>
            <label htmlFor={`w-${k}`} style={{ flex: 1 }}>{l}</label>
            <span className="muted num" style={{ width: 70, textAlign: 'right', fontSize: 12.5 }}>{total ? Math.round((s.weights[k] / total) * 100) : 0}% of score</span>
            {num(s.weights[k], (n) => setS({ ...s, weights: { ...s.weights, [k]: n } }), `w-${k}`)}
          </div>
        ))}
        {total === 0 && <p className="field"><span className="err">Give at least one part a weight.</span></p>}
      </div>
      <div>
        <h3 style={{ marginBottom: 10 }}>Targets</h3>
        {T.map(([k, l, u]) => (
          <div key={k} className="row" style={{ padding: '6px 0', justifyContent: 'space-between' }}>
            <label htmlFor={`t-${k}`} style={{ flex: 1 }}>{l}</label>
            <span className="row" style={{ gap: 6 }}>{num(s.targets[k], (n) => setS({ ...s, targets: { ...s.targets, [k]: Math.max(1, n) } }), `t-${k}`, k === 'weeklyCompleted' ? 200 : 100)}<span className="muted" style={{ width: 14 }}>{u}</span></span>
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label htmlFor="min-sample" style={{ flex: 1 }}>Minimum tasks in a period before a score is shown<br /><small className="muted">Avoids judging someone on one or two tasks.</small></label>
        {num(s.minSample, (n) => setS({ ...s, minSample: Math.max(1, n) }), 'min-sample')}
      </div>
    </Modal>
  );
}

