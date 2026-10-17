import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { ago, firstName, greeting, plural } from '../lib/format';
import type { Dashboard as D } from '../lib/types';
import { Avatar, Empty, ErrorState, PageLoading } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { useShell } from '../components/Shell';

export default function Dashboard() {
  const me = useMe();
  const shell = useShell();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<D>('/dashboard') });
  if (q.isLoading) return <PageLoading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const c = d.counts;
  const parts = [
    c.dueToday && `${plural(c.dueToday, 'task')} due today`,
    c.overdue && `${c.overdue} overdue`,
    c.changes && `${c.changes} to revise after feedback`,
    d.reviewQueue.length && `${plural(d.reviewQueue.length, 'submission')} waiting for your review`,
  ].filter(Boolean) as string[];
  const sentence = parts.length ? `You have ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : 'Nothing urgent right now.';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="page">
      <div className="page-head">
        <div><p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>{today}</p><h1>{greeting()}, {firstName(me.name)}</h1><p>{sentence}</p></div>
      </div>

      <div className="stats" style={{ ['--n' as any]: d.isLead ? 5 : 4 }}>
        <Link to="/my-tasks" className="stat"><span className="v">{c.dueToday}</span><span className="k">Due today</span></Link>
        <Link to="/my-tasks" className="stat"><span className={`v ${c.overdue ? 'red' : ''}`}>{c.overdue}</span><span className="k">Overdue</span></Link>
        <Link to="/my-tasks" className="stat"><span className="v">{c.changes}</span><span className="k">Needs changes</span></Link>
        <Link to="/my-tasks?tab=review" className="stat"><span className="v">{c.inReview}</span><span className="k">Waiting for review</span></Link>
        {d.isLead && <a href="#reviews" className="stat"><span className="v">{d.reviewQueue.length}</span><span className="k">Reviews for you</span></a>}
      </div>

      {d.isLead && d.reviewQueue.length > 0 && (
        <section className="section" id="reviews">
          <div className="section-h"><h2>Needs your review</h2><span className="badge">{d.reviewQueue.length}</span></div>
          <div className="list">
            {d.reviewQueue.map((r) => (
              <Link key={r.submissionId} to={`/tasks/${r.taskId}?tab=submissions`} className="task-row">
                <div style={{ minWidth: 0, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Avatar name={r.userName} size={32} />
                  <div style={{ minWidth: 0 }}>
                    <div className="t-title">{r.title}</div>
                    <div className="t-sub"><span>{r.userName} submitted version {r.version}</span><span>{r.projectName}</span></div>
                  </div>
                </div>
                <div className="meta"><span className="muted">{ago(r.createdAt)}</span><span className="btn sm">Review</span></div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-h"><h2>Your focus</h2><span className="sp" /><Link to="/my-tasks" className="link-btn">All my tasks <ArrowRight size={14} /></Link></div>
        {d.focus.length ? (
          <div className="list">{d.focus.map((t) => <TaskRow key={t.id} t={t as any} useMyStatus />)}</div>
        ) : (
          <Empty title="You're all caught up" action={<button className="btn" onClick={() => shell.newTask()}>Create a task</button>}>
            Tasks assigned to you show up here, most urgent first.
          </Empty>
        )}
      </section>

      {d.teams.length > 0 && (
        <section className="section">
          <div className="section-h"><h2>{me.role === 'admin' ? 'Teams' : 'Your teams'}</h2></div>
          <div className="cards">
            {d.teams.map((t) => {
              const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
              return (
                <Link key={t.id} to={`/teams/${t.id}`} className="pcard">
                  <div className="top"><h3>{t.name}</h3>{t.overdue > 0 ? <span className="pill red">{t.overdue} overdue</span> : <span className="pill green">On track</span>}</div>
                  <div className="foot"><div className="progress lime"><i style={{ width: `${pct}%` }} /></div><span className="num">{pct}%</span></div>
                  <div className="foot" style={{ justifyContent: 'space-between' }}><span><b className="num" style={{ color: 'var(--fg)' }}>{t.open}</b> open</span><span><b className="num" style={{ color: 'var(--fg)' }}>{t.review}</b> in review</span><span><b className="num" style={{ color: 'var(--fg)' }}>{t.done}</b> done</span></div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
