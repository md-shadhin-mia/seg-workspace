import { useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChartNoAxesCombined, ListChecks, Pencil, Plus } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/auth';
import { PROJECT_STATUS, STATUS, STATUS_ORDER, dueLabel } from '../lib/format';
import type { ProjectDetail, Status, TaskItem } from '../lib/types';
import { Avatar, Confirm, Empty, ErrorState, Modal, PageLoading, useToast } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { useShell } from '../components/Shell';
import { Crumbs } from '../components/kpi';
import { ProjectInsights } from '../components/ProjectInsights';

const GROUP_ORDER: Status[] = ['changes', 'in_progress', 'review', 'todo', 'done'];

export default function ProjectPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const shell = useShell();
  const nav = useNavigate();
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [closed, setClosed] = useState<Record<string, boolean>>({ done: true });
  const [editing, setEditing] = useState(false);
  const [quick, setQuick] = useState('');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'insights' ? 'insights' : 'tasks';
  const setTab = (t: 'tasks' | 'insights') => setParams((x) => { const n = new URLSearchParams(x); if (t === 'tasks') n.delete('tab'); else n.set('tab', t); return n; }, { replace: true });
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) });
  const tasks = useQuery({ queryKey: ['tasks', 'project', id], queryFn: () => api.get<TaskItem[]>(`/tasks?projectId=${id}`) });

  const quickAdd = useMutation({
    mutationFn: (title: string) => api.post<{ id: string }>('/tasks', { projectId: id, title }),
    onSuccess: (r) => {
      setQuick('');
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['project', id] });
      toast('Task added', { action: ['Open', () => nav(`/tasks/${r.id}`)] });
    },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });

  if (project.isLoading) return <PageLoading />;
  if (project.error) return <ErrorState error={project.error} />;
  const p = project.data!;
  const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
  const [stLabel, stColor] = PROJECT_STATUS[p.status] ?? ['On track', 'green'];
  const list = (tasks.data ?? []).filter((t) => filter === 'all' || t.assignees.some((a) => a.userId === me.id));

  return (
    <div className="page">
      <Crumbs items={[{ label: p.teamName, to: `/teams/${p.teamId}` }, { label: p.name }]} />
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 12 }}><h1>{p.name}</h1><span className={`pill ${stColor}`}><span className="d" />{stLabel}</span></div>
          {p.description && <p>{p.description}</p>}
        </div>
        {p.canManage && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} />Edit</button>}
        <button className="btn primary" onClick={() => shell.newTask(id)}><Plus size={16} />Add task</button>
      </div>

      <div className="subtabs" role="tablist" aria-label="Project view" style={{ marginTop: 4 }}>
        <button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><ListChecks size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Tasks</button>
        <button role="tab" aria-selected={tab === 'insights'} className={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}><ChartNoAxesCombined size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Insights</button>
      </div>

      {tab === 'insights' ? <div style={{ marginTop: 18 }}><ProjectInsights projectId={id} /></div> : <>
      <div className="stats" style={{ ['--n' as any]: 4, marginTop: 18 }}>
        <div className="stat"><span className="v">{pct}%</span><span className="k"><span className="progress lime" style={{ display: 'block', marginTop: 4 }}><i style={{ width: `${pct}%` }} /></span></span></div>
        <div className="stat"><span className="v">{p.taskCount - p.doneCount}</span><span className="k">Open tasks</span></div>
        <div className="stat"><span className="v">{p.reviewCount}</span><span className="k">Ready for review</span></div>
        <div className="stat"><span className={`v ${p.overdueCount ? 'red' : ''}`}>{p.overdueCount}</span><span className="k">Overdue</span></div>
      </div>

      <div className="row" style={{ marginTop: 18, gap: 18, flexWrap: 'wrap', fontSize: 13.5, color: 'var(--fg-2)' }}>
        <span className="row" style={{ gap: 6 }}><CalendarDays size={15} />Due {p.dueDate ? dueLabel(p.dueDate) : 'not set'}</span>
        {p.leadName && <span className="row" style={{ gap: 8 }}><Avatar name={p.leadName} size={22} />Lead: {p.leadName}</span>}
        <span>{p.members.length} people in {p.teamName}</span>
      </div>

      <section className="section">
        <div className="section-h">
          <h2>Tasks</h2><span className="sp" />
          <div className="subtabs">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>Assigned to me</button>
          </div>
        </div>
        <div className="list">
          <form className="quick-add" onSubmit={(e: FormEvent) => { e.preventDefault(); if (quick.trim()) quickAdd.mutate(quick.trim()); }}>
            <Plus size={16} />
            <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={`Add a task to ${p.name} and press Enter`} aria-label="Quick add task" disabled={quickAdd.isPending} />
          </form>
          {tasks.isLoading && <div style={{ padding: 16 }}><div className="skel" /></div>}
          {GROUP_ORDER.map((s) => {
            const g = list.filter((t) => t.status === s);
            if (!g.length) return null;
            const c = closed[s];
            return (
              <div key={s}>
                <button className="group-h" onClick={() => setClosed((x) => ({ ...x, [s]: !c }))} aria-expanded={!c}>
                  <span className={`pill st-${s}`} style={{ height: 20 }}><span className="d" />{STATUS[s]}</span>
                  <span className="muted num">{g.length}</span>
                  <span style={{ flex: 1 }} /><span className="muted" style={{ fontWeight: 400 }}>{c ? 'Show' : 'Hide'}</span>
                </button>
                {!c && g.map((t) => <TaskRow key={t.id} t={t} showProject={false} />)}
              </div>
            );
          })}
        </div>
        {tasks.data && list.length === 0 && <div style={{ marginTop: 12 }}><Empty title={filter === 'mine' ? 'Nothing here is assigned to you' : 'No tasks yet'}>Add the first one above.</Empty></div>}
      </section>
      </>}
      {editing && <EditProject p={p} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditProject({ p, onClose }: { p: ProjectDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ name: p.name, description: p.description, status: p.status, dueDate: p.dueDate ?? '', leadId: p.leadId ?? '' });
  const [archive, setArchive] = useState(false);
  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${p.id}`, { ...f, dueDate: f.dueDate || null, leadId: f.leadId || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', p.id] }); qc.invalidateQueries({ queryKey: ['teams'] }); toast('Project saved'); onClose(); },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  return (
    <Modal title="Edit project" onClose={onClose} footer={<>
      <button className="btn ghost danger" style={{ marginRight: 'auto' }} onClick={() => setArchive(true)}>Archive project</button>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => save.mutate()} disabled={!f.name.trim() || save.isPending}>Save</button>
    </>}>
      <div className="field"><label htmlFor="ep-name">Name</label><input id="ep-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="ep-desc">Description</label><textarea id="ep-desc" className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="grid-2">
        <div className="field"><label htmlFor="ep-st">Status</label><select id="ep-st" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {Object.entries(PROJECT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="ep-due">Due date</label><input id="ep-due" type="date" className="input" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor="ep-lead">Project lead</label><select id="ep-lead" className="input" value={f.leadId} onChange={(e) => setF({ ...f, leadId: e.target.value })}>
        <option value="">Nobody</option>{p.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      {archive && <Confirm title="Archive this project?" confirm="Archive" danger body="It disappears from the sidebar and task lists. Its tasks stay in the database." onClose={() => setArchive(false)}
        onConfirm={async () => { await api.del(`/projects/${p.id}`); qc.invalidateQueries({ queryKey: ['teams'] }); toast('Project archived'); nav(`/teams/${p.teamId}`); }} />}
    </Modal>
  );
}
