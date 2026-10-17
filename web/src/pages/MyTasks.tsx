import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { dayDiff } from '../lib/format';
import type { TaskItem } from '../lib/types';
import { Empty, ErrorState, PageLoading } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { useShell } from '../components/Shell';

const TABS = [['active', 'Active'], ['review', 'Waiting for review'], ['done', 'Done']] as const;

export default function MyTasks() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as (typeof TABS)[number][0]) || 'active';
  const [q, setQ] = useState('');
  const shell = useShell();
  const tasks = useQuery({ queryKey: ['tasks', 'mine'], queryFn: () => api.get<TaskItem[]>('/tasks?view=mine') });

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (tasks.data ?? []).filter((t) => !s || t.title.toLowerCase().includes(s) || t.projectName.toLowerCase().includes(s));
    const mine = (t: TaskItem) => t.myStatus ?? t.status;
    if (tab === 'review') return [['', list.filter((t) => mine(t) === 'review')]] as const;
    if (tab === 'done') return [['', list.filter((t) => mine(t) === 'done')]] as const;
    const active = list.filter((t) => !['done', 'review'].includes(mine(t)));
    const b = (fn: (t: TaskItem) => boolean) => active.filter(fn);
    return [
      ['Needs changes', b((t) => mine(t) === 'changes')],
      ['Overdue', b((t) => mine(t) !== 'changes' && !!t.dueDate && dayDiff(t.dueDate) < 0)],
      ['Today', b((t) => mine(t) !== 'changes' && !!t.dueDate && dayDiff(t.dueDate) === 0)],
      ['This week', b((t) => mine(t) !== 'changes' && !!t.dueDate && dayDiff(t.dueDate) > 0 && dayDiff(t.dueDate) <= 7)],
      ['Later', b((t) => mine(t) !== 'changes' && !!t.dueDate && dayDiff(t.dueDate) > 7)],
      ['No due date', b((t) => mine(t) !== 'changes' && !t.dueDate)],
    ] as const;
  }, [tasks.data, tab, q]);

  if (tasks.isLoading) return <PageLoading />;
  if (tasks.error) return <ErrorState error={tasks.error} retry={() => tasks.refetch()} />;
  const total = groups.reduce((n, [, l]) => n + l.length, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>My Tasks</h1><p>Everything you're assigned to. Status shown is your own.</p></div>
        <button className="btn primary" onClick={() => shell.newTask()}>New task</button>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="subtabs" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams(k === 'active' ? {} : { tab: k })}>{l}</button>)}
        </div>
        <label className="search-pill" style={{ width: 260 }}><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter my tasks" aria-label="Filter my tasks" style={{ border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0 }} /></label>
      </div>
      {total === 0 ? (
        <Empty title={tab === 'active' ? 'Nothing on your plate' : tab === 'review' ? 'Nothing waiting for review' : 'No finished tasks yet'}>
          {tab === 'active' ? 'When someone assigns you a task, it appears here.' : ''}
        </Empty>
      ) : groups.map(([title, list]) => list.length > 0 && (
        <section key={title || 'all'} style={{ marginBottom: 22 }}>
          {title && <div className="section-h" style={{ marginBottom: 8 }}><h2 style={title === 'Overdue' || title === 'Needs changes' ? { color: 'var(--red)' } : undefined}>{title}</h2><span className="badge plain">{list.length}</span></div>}
          <div className="list">{list.map((t) => <TaskRow key={t.id} t={t} useMyStatus />)}</div>
        </section>
      ))}
    </div>
  );
}
