import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CalendarDays, Check, CircleUser, Clock, ExternalLink, FileText, Flag, FolderKanban, Github, Globe, Image as ImageIcon,
  Link2, ListChecks, MessageSquare, MoreHorizontal, Paperclip, Pencil, Send, Sparkles, Trash2, Upload, UserPlus, Users, Wand2, X,
} from 'lucide-react';
import { ApiError, api, upload } from '../lib/api';
import { useMe } from '../lib/auth';
import { PRIORITY, STATUS, ago, dueClass, dueLabel, fileSize, firstName, host, linkKind, plural, stamp } from '../lib/format';
import type { Activity, Comment, FileRef, Priority, Status, Submission, TaskDetail } from '../lib/types';
import { Avatar, Confirm, Empty, ErrorState, Menu, PageLoading, PeoplePicker, StatusMenu, StatusPill, useAnchor, useToast } from '../components/ui';
import { peopleFor, usePeople } from '../components/NewTaskModal';
import { AiPanel, useAiEnabled } from '../components/Ai';
import { Crumbs } from '../components/kpi';

type Tab = 'overview' | 'checklist' | 'files' | 'submissions' | 'comments' | 'activity';

export default function TaskPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: ['task', id], queryFn: () => api.get<TaskDetail>(`/tasks/${id}`) });
  const comments = useQuery({ queryKey: ['task', id, 'comments'], queryFn: () => api.get<Comment[]>(`/tasks/${id}/comments`), enabled: !!q.data });

  // Opening a task clears its notifications.
  useEffect(() => {
    if (!q.data) return;
    api.post('/notifications/read', { taskId: id }).then(() => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); }).catch(() => {});
  }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <PageLoading />;
  if (q.error) {
    return (q.error as ApiError).status === 404
      ? <div className="page"><Empty title="This task isn't available">It may have been deleted, or you may not have access to it. <Link className="text-link" to="/my-tasks">Go to My Tasks</Link></Empty></div>
      : <ErrorState error={q.error} retry={() => q.refetch()} />;
  }
  const t = q.data!;
  const pendingCount = t.submissions.filter((s) => s.state === 'pending').length;
  const tabs: [Tab, string, number?][] = [
    ['overview', 'Overview'],
    ['checklist', 'Checklist', t.checklist.length],
    ['files', 'Files & links', t.resources.files.length + t.resources.links.length],
    ['submissions', 'Submissions', t.submissions.length],
    ['comments', 'Comments', comments.data?.length ?? t.commentCount],
    ['activity', 'Activity'],
  ];
  const isAssignee = t.assignees.some((a) => a.id === me.id);

  return (
    <div className="detail">
      <LeftPanel t={t} onTab={setTab} />
      <div className="detail-right">
        <nav className="tabs" role="tablist" aria-label="Task sections">
          {tabs.map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {l}{!!n && <span className={k === 'submissions' && pendingCount ? 'badge' : 'badge plain'}>{n}</span>}
            </button>
          ))}
        </nav>
        <div className="tab-body" role="tabpanel">
          {tab === 'overview' && <Overview t={t} onTab={setTab} />}
          {tab === 'checklist' && <Checklist t={t} />}
          {tab === 'files' && <Files t={t} />}
          {tab === 'submissions' && <Submissions t={t} focusSubmit={isAssignee} />}
          {tab === 'comments' && <Comments t={t} comments={comments.data ?? []} loading={comments.isLoading} />}
          {tab === 'activity' && <ActivityFeed id={t.id} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- shared mutation helpers ---------- */
function useTaskMutations(t: TaskDetail) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['task', t.id] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const onError = (e: unknown) => { toast((e as ApiError).message, { kind: 'error' }); refresh(); };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/tasks/${t.id}`, body),
    onMutate: (body) => { qc.setQueryData<TaskDetail>(['task', t.id], (old) => (old ? { ...old, ...(body as any) } : old)); },
    onSuccess: refresh, onError,
  });
  const setStatus = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: Status }) => api.patch<{ taskStatus: Status }>(`/tasks/${t.id}/assignees/${userId}`, { status }),
    onMutate: ({ userId, status }) => {
      qc.setQueryData<TaskDetail>(['task', t.id], (old) => old && ({ ...old, assignees: old.assignees.map((a) => (a.id === userId ? { ...a, status } : a)) }));
    },
    onSuccess: (r, v) => {
      refresh();
      if (r.taskStatus === 'done') toast('Everyone is done. Task complete.');
      else if (v.status === 'review') toast('Marked ready for review. The reviewer has been notified.');
    },
    onError,
  });
  const setAssignees = useMutation({
    mutationFn: (userIds: string[]) => api.put(`/tasks/${t.id}/assignees`, { userIds }),
    onSuccess: () => { refresh(); toast('Assignees updated'); }, onError,
  });
  return { patch, setStatus, setAssignees, refresh, toast };
}

/* ---------- left column ---------- */
function LeftPanel({ t, onTab }: { t: TaskDetail; onTab: (t: Tab) => void }) {
  const me = useMe();
  const nav = useNavigate();
  const [side, setSide] = useState<'people' | 'details'>('people');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { patch, setStatus, setAssignees, toast } = useTaskMutations(t);
  const people = usePeople();
  const statusMenu = useAnchor();
  const assignPicker = useAnchor();
  const reviewerPicker = useAnchor();
  const more = useAnchor();
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const done = t.assignees.filter((a) => a.status === 'done').length;
  const isAssignee = t.assignees.some((a) => a.id === me.id);
  const pickList = useMemo(() => peopleFor(people.data, t.team.id, t.team.name), [people.data, t.team]);
  const lastUpdate = [t.updatedAt, ...t.assignees.map((a) => a.updatedAt)].sort().pop()!;
  const isLeadLike = t.perms.manage;

  return (
    <aside className="detail-left">
      <div className="detail-head">
        <div style={{ textAlign: 'left', marginTop: -8, marginBottom: 6 }}>
          <Crumbs items={t.perms.openProject
            ? [{ label: t.team.name, to: `/teams/${t.team.id}` }, { label: t.project.name, to: `/projects/${t.project.id}` }, { label: `#${t.seq}` }]
            : [{ label: 'My Tasks', to: '/my-tasks' }, { label: `#${t.seq}` }]} />
        </div>
        <div className="ico"><FileText size={24} /></div>
        <h2>{t.title}</h2>
        <div className="sub">#{t.seq} · {t.perms.openProject ? <Link to={`/projects/${t.project.id}`} className="text-link" style={{ fontWeight: 500 }}>{t.project.name}</Link> : t.project.name}</div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12, gap: 8 }}>
          <StatusPill status={t.status} />
          {t.assignees.length > 1 && <span className="pill">{done}/{t.assignees.length} done</span>}
        </div>
        <div className="quick-actions">
          {isAssignee && <button className="qa blue" onClick={() => onTab('submissions')}><span className="box"><Upload size={17} /></span>Submit</button>}
          <button className="qa green" onClick={() => onTab('comments')}><span className="box"><MessageSquare size={17} /></span>Comment</button>
          <button className="qa" onClick={more.open} aria-label="More actions"><span className="box"><MoreHorizontal size={17} /></span>More</button>
        </div>
        <div className="last-act">Last update: <b>{stamp(lastUpdate)}</b></div>
      </div>

      <div className="left-tabs" role="tablist">
        <button role="tab" aria-selected={side === 'people'} className={side === 'people' ? 'active' : ''} onClick={() => setSide('people')}>People</button>
        <button role="tab" aria-selected={side === 'details'} className={side === 'details' ? 'active' : ''} onClick={() => setSide('details')}>Details</button>
      </div>

      <div className="left-body">
        {side === 'people' ? (
          <>
            <div>
              <div className="blk-h">
                <span className="label">Assignees</span>
                <span className="row" style={{ gap: 6 }}>
                  <span className="badge">{t.assignees.length}</span>
                  {t.perms.manage && <button className="btn ghost sm" onClick={assignPicker.open}><UserPlus size={14} />Manage</button>}
                </span>
              </div>
              {t.assignees.length === 0 && <p className="muted" style={{ fontSize: 13.5 }}>Nobody is assigned yet.</p>}
              {t.assignees.map((a) => {
                const canSet = t.perms.setStatusFor.includes(a.id);
                return (
                  <div className="assignee" key={a.id}>
                    <Avatar name={a.name} size={34} />
                    <div className="who"><b>{a.name}{a.id === me.id && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}</b><small>{a.title || a.email}</small></div>
                    <StatusPill status={a.status} onClick={canSet ? (e) => { setStatusFor(a.id); statusMenu.open(e); } : undefined} />
                  </div>
                );
              })}
              {t.assignees.length > 0 && t.perms.setStatusFor.length > 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{isLeadLike ? 'Click a status to change it for that person.' : 'Click your status to update it. Everyone updates their own.'}</p>
              )}
            </div>
            <div>
              <div className="blk-h"><span className="label">Reviewer</span>{t.perms.manage && <button className="btn ghost sm" onClick={reviewerPicker.open}><Pencil size={13} />Change</button>}</div>
              {t.reviewer
                ? <div className="assignee"><Avatar name={t.reviewer.name} size={34} /><div className="who"><b>{t.reviewer.name}</b><small>Approves submissions</small></div></div>
                : <div className="assignee"><span className="avatar" style={{ width: 34, height: 34, background: 'var(--muted)', color: 'var(--fg-3)' }}><Users size={16} /></span><div className="who"><b>{t.team.name} leads</b><small>Any team lead can approve</small></div></div>}
            </div>
          </>
        ) : (
          <div>
            <div className="kv"><span className="ico"><Flag size={16} /></span><div className="t"><small>Priority</small>
              {t.perms.edit ? <select className="input" value={t.priority} onChange={(e) => patch.mutate({ priority: e.target.value as Priority })} aria-label="Priority">
                {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}</select> : <b>{PRIORITY[t.priority]}</b>}
            </div></div>
            <div className="kv"><span className="ico"><CalendarDays size={16} /></span><div className="t"><small>Due date</small>
              {t.perms.edit ? <input type="date" className="input" value={t.dueDate ?? ''} onChange={(e) => patch.mutate({ dueDate: e.target.value || null })} aria-label="Due date" />
                : <b className={`due ${dueClass(t.dueDate, t.status === 'done')}`}>{dueLabel(t.dueDate)}</b>}
            </div></div>
            <div className="kv"><span className="ico"><FolderKanban size={16} /></span><div className="t"><small>Project</small><b>{t.project.name}</b> <span className="muted">· {t.team.name}</span></div></div>
            <div className="kv"><span className="ico"><CircleUser size={16} /></span><div className="t"><small>Created by</small><b>{t.createdBy?.name ?? 'Unknown'}</b> <span className="muted">· {ago(t.createdAt)}</span></div></div>
            {t.completedAt && <div className="kv"><span className="ico"><Check size={16} /></span><div className="t"><small>Completed</small><b>{stamp(t.completedAt)}</b></div></div>}
            {t.assignees.length === 0 && t.perms.edit && (
              <div className="kv"><span className="ico"><Clock size={16} /></span><div className="t"><small>Status</small>
                <select className="input" value={t.status} onChange={(e) => patch.mutate({ status: e.target.value })} aria-label="Task status">
                  {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</select></div></div>
            )}
          </div>
        )}
      </div>

      {statusMenu.anchor && statusFor && (
        <StatusMenu anchor={statusMenu.anchor} current={t.assignees.find((a) => a.id === statusFor)!.status} allowChanges={isLeadLike || t.perms.review}
          onClose={() => { statusMenu.close(); setStatusFor(null); }} onPick={(s) => setStatus.mutate({ userId: statusFor, status: s })} />
      )}
      {assignPicker.anchor && (
        <PeoplePicker anchor={assignPicker.anchor} people={pickList} selected={t.assignees.map((a) => a.id)}
          onChange={(ids) => setAssignees.mutate(ids)} onClose={assignPicker.close} />
      )}
      {reviewerPicker.anchor && (
        <PeoplePicker anchor={reviewerPicker.anchor} single people={pickList} selected={t.reviewer ? [t.reviewer.id] : []}
          onChange={(ids) => patch.mutate({ reviewerId: ids[0] ?? null }, { onSuccess: () => toast(ids[0] ? 'Reviewer updated' : 'Team leads will review') })} onClose={reviewerPicker.close} />
      )}
      {more.anchor && (
        <Menu anchor={more.anchor} onClose={more.close} onPick={async (k) => {
          if (k === 'copy') {
            try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { toast('Copy the address from your browser bar', { kind: 'error' }); }
          }
          if (k === 'delete') setConfirmDelete(true);
          if (k === 'project') nav(`/projects/${t.project.id}`);
        }} items={[
          { key: 'copy', label: 'Copy link', icon: <Link2 size={15} /> },
          ...(t.perms.openProject ? [{ key: 'project', label: 'Open project', icon: <FolderKanban size={15} /> }] : []),
          ...(t.perms.manage ? [{ key: 's', sep: true }, { key: 'delete', label: 'Delete task', icon: <Trash2 size={15} /> }] : []),
        ]} />
      )}
      {confirmDelete && <Confirm title="Delete this task?" danger confirm="Delete task" onClose={() => setConfirmDelete(false)}
        body="Its checklist, files, submissions and comments are deleted too. This can't be undone."
        onConfirm={async () => { await api.del(`/tasks/${t.id}`); toast('Task deleted'); nav(t.perms.openProject ? `/projects/${t.project.id}` : '/my-tasks'); }} />}
    </aside>
  );
}

/* ---------- overview ---------- */
function Overview({ t, onTab }: { t: TaskDetail; onTab: (t: Tab) => void }) {
  const { patch } = useTaskMutations(t);
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description);
  useEffect(() => { setTitle(t.title); }, [t.title]);
  useEffect(() => { setDesc(t.description); }, [t.description]);
  const dirty = desc !== t.description;
  const cl = t.checklist.filter((c) => c.done).length;
  const done = t.assignees.filter((a) => a.status === 'done').length;
  const latest = Object.values(t.submissions.reduce<Record<string, Submission>>((m, s) => (m[s.userId] && m[s.userId].version > s.version ? m : { ...m, [s.userId]: s }), {}));

  return (
    <>
      {t.perms.edit ? (
        <input className="title-edit" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" maxLength={200}
          onBlur={() => { if (title.trim() && title !== t.title) patch.mutate({ title: title.trim() }); else setTitle(t.title); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      ) : <h2 style={{ fontSize: 20 }}>{t.title}</h2>}

      <div>
        <div className="blk-h"><span className="label">Description</span></div>
        {t.perms.edit ? (
          <>
            <textarea className="desc-edit" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What needs to be done, why, and what “done” looks like." aria-label="Description" />
            {dirty && <div className="row end" style={{ marginTop: 8 }}><button className="btn ghost sm" onClick={() => setDesc(t.description)}>Discard</button><button className="btn primary sm" onClick={() => patch.mutate({ description: desc })}>Save description</button></div>}
          </>
        ) : <p className="desc-read">{t.description || <span className="muted">No description.</span>}</p>}
        <TaskAi t={t} desc={desc} onUseDescription={setDesc} />
      </div>

      <div className="stats" style={{ ['--n' as any]: 3 }}>
        <button className="stat" onClick={() => onTab('submissions')}><span className="v">{t.assignees.length ? `${done}/${t.assignees.length}` : '—'}</span><span className="k">People done</span></button>
        <button className="stat" onClick={() => onTab('checklist')}><span className="v">{t.checklist.length ? `${cl}/${t.checklist.length}` : '—'}</span><span className="k">Checklist</span></button>
        <button className="stat" onClick={() => onTab('files')}><span className="v">{t.resources.files.length + t.resources.links.length}</span><span className="k">Files & links</span></button>
      </div>

      {latest.length > 0 && (
        <div>
          <div className="blk-h"><span className="label">Latest submissions</span><button className="link-btn" onClick={() => onTab('submissions')}>See all</button></div>
          <div className="list">
            {latest.map((s) => {
              const who = t.assignees.find((a) => a.id === s.userId);
              return (
                <button key={s.id} className="task-row" onClick={() => onTab('submissions')}>
                  <div className="row" style={{ minWidth: 0 }}><Avatar name={who?.name ?? '?'} size={28} /><div style={{ minWidth: 0 }}><div className="t-title">{who?.name ?? 'Former assignee'}</div><div className="t-sub">Version {s.version} · {ago(s.createdAt)}</div></div></div>
                  <div className="meta"><SubState s={s} /></div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- AI helpers on the overview ---------- */
type AiAction = 'improve' | 'summarize' | 'checklist';
const AI_TITLE: Record<AiAction, string> = { improve: 'Improved description', summarize: 'Summary', checklist: 'Suggested checklist' };

function TaskAi({ t, desc, onUseDescription }: { t: TaskDetail; desc: string; onUseDescription: (text: string) => void }) {
  const enabled = useAiEnabled();
  const qc = useQueryClient();
  const toast = useToast();
  const [result, setResult] = useState<{ action: AiAction; text?: string; items?: string[] } | null>(null);
  const run = useMutation({
    // Improve and checklist work from what's in the editor, including unsaved edits.
    mutationFn: (action: AiAction) => api.post<{ text?: string; items?: string[] }>(`/tasks/${t.id}/ai`, { action, draft: action === 'summarize' ? undefined : desc }),
    onMutate: (action) => setResult({ action }),
    onSuccess: (r, action) => setResult({ action, ...r }),
    onError: (e) => { setResult(null); toast((e as ApiError).message, { kind: 'error' }); },
  });
  const addItems = useMutation({
    mutationFn: async (items: string[]) => { for (const text of items) await api.post(`/tasks/${t.id}/checklist`, { text }); return items.length; },
    onSuccess: (n) => { setResult(null); toast(`Added ${plural(n, 'checklist item')}`); },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['task', t.id] }),
  });
  if (!enabled) return null;
  const btn = (action: AiAction, label: string, icon: React.ReactNode, disabled = false, title?: string) => (
    <button className="btn ghost sm" onClick={() => run.mutate(action)} disabled={run.isPending || disabled} title={title}>{icon}{label}</button>
  );
  return (
    <>
      <div className="ai-row" role="group" aria-label="AI">
        {t.perms.edit && btn('improve', 'Improve', <Wand2 size={14} />, !desc.trim(), desc.trim() ? 'Rewrite the description as Goal / What’s needed / Done when' : 'Write a few notes first')}
        {btn('summarize', 'Summarize', <Sparkles size={14} />)}
        {t.perms.edit && btn('checklist', 'Create checklist', <ListChecks size={14} />)}
      </div>
      {result && (
        <AiPanel title={AI_TITLE[result.action]} loading={run.isPending} text={result.text} items={result.items} busy={addItems.isPending}
          onClose={() => setResult(null)}
          onUseText={result.action === 'improve' ? (text) => { onUseDescription(text); setResult(null); toast('Description updated. Check it, then Save.'); } : undefined}
          onUseItems={result.action === 'checklist' ? (items) => addItems.mutate(items) : undefined} />
      )}
    </>
  );
}

/* ---------- checklist ---------- */
function Checklist({ t }: { t: TaskDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const key = ['task', t.id];
  const add = useMutation({
    mutationFn: (txt: string) => api.post(`/tasks/${t.id}/checklist`, { text: txt }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.patch(`/checklist/${id}`, { done }),
    onMutate: ({ id, done }) => qc.setQueryData<TaskDetail>(key, (o) => o && ({ ...o, checklist: o.checklist.map((c) => (c.id === id ? { ...c, done } : c)) })),
    onError: (e) => { toast((e as ApiError).message, { kind: 'error' }); qc.invalidateQueries({ queryKey: key }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/checklist/${id}`),
    onMutate: (id) => qc.setQueryData<TaskDetail>(key, (o) => o && ({ ...o, checklist: o.checklist.filter((c) => c.id !== id) })),
    onError: () => qc.invalidateQueries({ queryKey: key }),
  });
  const done = t.checklist.filter((c) => c.done).length;
  return (
    <div>
      <div className="blk-h"><span className="label">Checklist</span>{t.checklist.length > 0 && <span className="muted num" style={{ fontSize: 13 }}>{done} of {t.checklist.length} done</span>}</div>
      {t.checklist.length > 0 && <div className="progress lime" style={{ marginBottom: 12 }}><i style={{ width: `${(done / t.checklist.length) * 100}%` }} /></div>}
      <div>
        {t.checklist.map((c) => (
          <div key={c.id} className={`check-row ${c.done ? 'done' : ''}`}>
            <button className={`cbox ${c.done ? 'on' : ''}`} role="checkbox" aria-checked={c.done} aria-label={c.text} disabled={!t.perms.edit}
              onClick={() => toggle.mutate({ id: c.id, done: !c.done })}>{c.done && <Check size={12} strokeWidth={3} />}</button>
            <span className="txt">{c.text}</span>
            {t.perms.edit && <button className="icon-btn del" style={{ width: 28, height: 28 }} onClick={() => remove.mutate(c.id)} aria-label={`Delete ${c.text}`}><X size={14} /></button>}
          </div>
        ))}
      </div>
      {t.perms.edit ? (
        <form className="row" style={{ marginTop: 10 }} onSubmit={(e: FormEvent) => { e.preventDefault(); if (text.trim()) add.mutate(text.trim()); }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item and press Enter" aria-label="New checklist item" maxLength={300} />
          <button className="btn" disabled={!text.trim() || add.isPending}>Add</button>
        </form>
      ) : t.checklist.length === 0 && <Empty title="No checklist" />}
    </div>
  );
}

/* ---------- files & links ---------- */
function LinkIcon({ url }: { url: string }) {
  const k = linkKind(url);
  return k === 'github' ? <Github size={15} /> : k === 'web' ? <Globe size={15} /> : <Link2 size={15} />;
}
function FileIcon({ f }: { f: { mime?: string | null; id?: string | null } }) {
  if (f.mime?.startsWith('image/') && f.id) return <img src={`/api/files/${f.id}`} alt="" loading="lazy" />;
  return f.mime?.startsWith('image/') ? <ImageIcon size={15} /> : <Paperclip size={15} />;
}

function Dropzone({ onFiles, label = 'Upload files' }: { onFiles: (f: File[]) => void; label?: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0}
      onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); }}>
      <Upload size={18} />
      <span style={{ flex: 1 }}><b>{label}</b> or drag them here<br /><small>Images, PDF, documents, video, ZIP</small></span>
      <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) onFiles([...e.target.files]); e.target.value = ''; }} />
    </div>
  );
}

function Files({ t }: { t: TaskDetail }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'all' | 'files' | 'links'>('all');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['task', t.id] });
  const addLink = useMutation({
    mutationFn: () => api.post(`/tasks/${t.id}/links`, { url, title: title || undefined }),
    onSuccess: () => { setUrl(''); setTitle(''); refresh(); }, onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  async function send(files: File[]) {
    setProgress(0);
    try { await upload(`/tasks/${t.id}/files?purpose=resource`, files, setProgress); toast(`${plural(files.length, 'file')} uploaded`); refresh(); }
    catch (e) { toast((e as ApiError).message, { kind: 'error' }); }
    finally { setProgress(null); }
  }
  const del = async (path: string) => { try { await api.del(path); refresh(); } catch (e) { toast((e as ApiError).message, { kind: 'error' }); } };
  const { files, links } = t.resources;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="subtabs">
          {([['all', `All (${files.length + links.length})`], ['files', `Files (${files.length})`], ['links', `Links (${links.length})`]] as const).map(([k, l]) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>Briefs, references and working files. Final work goes in Submissions.</span>
      </div>
      {t.perms.edit && (
        <div className="grid-2">
          <div>
            <Dropzone onFiles={send} />
            {progress !== null && <div className="upload-bar"><i style={{ width: `${progress}%` }} /></div>}
          </div>
          <form className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (url.trim()) addLink.mutate(); }}>
            <input className="input sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link: Figma, Drive, GitHub…" aria-label="Link URL" />
            <div className="row"><input className="input sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Link title" /><button className="btn sm" disabled={!url.trim() || addLink.isPending}>Add link</button></div>
          </form>
        </div>
      )}
      <div className="items">
        {kind !== 'links' && files.map((f: FileRef) => (
          <div className="item" key={f.id}>
            <span className="ic"><FileIcon f={f} /></span>
            <a className="t" href={`/api/files/${f.id}`} target="_blank" rel="noopener"><b>{f.name}</b><small>{fileSize(f.size)} · {f.uploaderName ?? 'Someone'} · {ago(f.createdAt)}</small></a>
            <a className="icon-btn" href={`/api/files/${f.id}?download=1`} aria-label={`Download ${f.name}`}><ExternalLink size={15} /></a>
            {(f.uploaderId === me.id || t.perms.manage) && <button className="icon-btn" onClick={() => del(`/files/${f.id}`)} aria-label={`Delete ${f.name}`}><Trash2 size={15} /></button>}
          </div>
        ))}
        {kind !== 'files' && links.map((l) => (
          <div className="item" key={l.id}>
            <span className="ic"><LinkIcon url={l.url} /></span>
            <a className="t" href={l.url} target="_blank" rel="noopener noreferrer"><b>{l.title}</b><small>{host(l.url)} · {l.addedByName ?? 'Someone'}</small></a>
            <a className="icon-btn" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${l.title}`}><ExternalLink size={15} /></a>
            {t.perms.edit && <button className="icon-btn" onClick={() => del(`/links/${l.id}`)} aria-label={`Remove ${l.title}`}><Trash2 size={15} /></button>}
          </div>
        ))}
        {files.length + links.length === 0 && <Empty title="Nothing attached yet">{t.perms.edit ? 'Add the brief, a Figma file or a Drive folder people need.' : ''}</Empty>}
      </div>
    </>
  );
}

/* ---------- submissions & review ---------- */
function SubState({ s }: { s: Submission }) {
  return s.state === 'pending' ? <span className="pill st-review">Waiting for review</span> : s.state === 'changes' ? <span className="pill st-changes">Changes requested</span> : <span className="pill st-done">Approved</span>;
}

function FeedbackSummary({ t }: { t: TaskDetail }) {
  const enabled = useAiEnabled();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: () => api.post<{ text: string }>(`/tasks/${t.id}/ai`, { action: 'feedback' }),
    onMutate: () => setOpen(true),
    onError: (e) => { setOpen(false); toast((e as ApiError).message, { kind: 'error' }); },
  });
  if (!enabled || !t.submissions.some((s) => s.feedback?.trim())) return null;
  return (
    <div>
      <button className="btn ghost sm" onClick={() => run.mutate()} disabled={run.isPending}><Sparkles size={14} />Summarize feedback</button>
      {open && <AiPanel title="Feedback across versions" loading={run.isPending} text={run.data?.text} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Submissions({ t, focusSubmit }: { t: TaskDetail; focusSubmit: boolean }) {
  const me = useMe();
  const [who, setWho] = useState<string>('all');
  const people = t.assignees;
  const shown = who === 'all' ? people : people.filter((p) => p.id === who);
  if (people.length === 0) return <Empty title="Nobody is assigned">Assign people to this task so they can submit their work.</Empty>;
  return (
    <>
      <div className="subtabs" role="tablist" aria-label="Filter by person">
        <button className={who === 'all' ? 'active' : ''} onClick={() => setWho('all')}>Everyone</button>
        {people.map((p) => <button key={p.id} className={who === p.id ? 'active' : ''} onClick={() => setWho(p.id)}>{p.id === me.id ? 'You' : firstName(p.name)}</button>)}
      </div>
      <FeedbackSummary t={t} />
      {focusSubmit && (who === 'all' || who === me.id) && <MySubmitBox t={t} />}
      {shown.map((p) => {
        const subs = t.submissions.filter((s) => s.userId === p.id);
        return (
          <div key={p.id} className="person-card">
            <div className="ph">
              <Avatar name={p.name} size={36} />
              <div className="who"><b>{p.name}</b><small>{p.email}</small></div>
              <StatusPill status={p.status} />
            </div>
            {subs.length === 0
              ? <p className="muted" style={{ fontSize: 13.5 }}>{p.id === me.id ? 'You haven’t submitted anything yet.' : `${firstName(p.name)} hasn’t submitted anything yet.`}</p>
              : <div className="sub-grid">{subs.map((s, i) => <SubmissionCard key={s.id} s={s} t={t} current={i === 0} />)}</div>}
          </div>
        );
      })}
    </>
  );
}

function SubmissionCard({ s, t, current }: { s: Submission; t: TaskDetail; current: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<null | 'changes'>(null);
  const [feedback, setFeedback] = useState('');
  const canReview = s.state === 'pending' && (t.perms.review || t.reviewerIds.includes(me.id)) && (s.userId !== me.id || me.role === 'admin');
  const review = useMutation({
    mutationFn: (decision: 'approve' | 'changes') => api.post<{ taskStatus: Status }>(`/submissions/${s.id}/review`, { decision, feedback: feedback || undefined }),
    onSuccess: (r, d) => {
      qc.invalidateQueries({ queryKey: ['task', t.id] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['tasks'] });
      toast(d === 'approve' ? (r.taskStatus === 'done' ? 'Approved. The task is complete.' : 'Approved') : 'Feedback sent');
      setMode(null); setFeedback('');
    },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  return (
    <div className="sub-card">
      <div className="sh">
        <span className={`vt ${current ? 'cur' : ''}`}>V{s.version}</span>
        <div style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Version {s.version}</b><div className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stamp(s.createdAt)}</div></div>
        <SubState s={s} />
      </div>
      <div className="items">
        {s.items.map((i) => i.kind === 'link' ? (
          <a key={i.id} className="item" href={i.url!} target="_blank" rel="noopener noreferrer"><span className="ic"><LinkIcon url={i.url!} /></span><span className="t"><b>{i.title}</b><small>{host(i.url!)}</small></span><ExternalLink size={14} className="muted" /></a>
        ) : (
          <a key={i.id} className="item" href={i.fileId ? `/api/files/${i.fileId}` : undefined} target="_blank" rel="noopener"><span className="ic"><FileIcon f={{ mime: i.mime, id: i.fileId }} /></span><span className="t"><b>{i.title}</b><small>{i.size ? fileSize(i.size) : 'File removed'}</small></span></a>
        ))}
      </div>
      {s.note && <p style={{ fontSize: 13.5, color: 'var(--fg-2)', borderLeft: '2px solid var(--line-2)', paddingLeft: 10 }}>{s.note}</p>}
      {s.state === 'changes' && s.feedback && <div className="feedback"><b>{s.reviewedByName ?? 'Reviewer'}:</b> {s.feedback}</div>}
      {s.state === 'approved' && <span className="muted" style={{ fontSize: 12.5 }}>Approved by {s.reviewedByName} · {ago(s.reviewedAt!)}</span>}
      {canReview && (
        <>
          <hr />
          {mode === 'changes' ? (
            <div className="form" style={{ gap: 8 }}>
              <textarea className="input" rows={3} autoFocus value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What needs to change? Be specific so it can be fixed in one pass." aria-label="Feedback" />
              <div className="row end"><button className="btn ghost sm" onClick={() => setMode(null)}>Cancel</button><button className="btn primary sm" disabled={!feedback.trim() || review.isPending} onClick={() => review.mutate('changes')}>Send feedback</button></div>
            </div>
          ) : (
            <div className="row end">
              <button className="btn sm" onClick={() => setMode('changes')}>Request changes</button>
              <button className="btn primary sm" disabled={review.isPending} onClick={() => review.mutate('approve')}><Check size={14} />Approve</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface Draft { kind: 'link' | 'file'; key: string; title: string; url?: string; fileId?: string; progress?: number; size?: number }

function MySubmitBox({ t }: { t: TaskDetail }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const mine = t.submissions.filter((s) => s.userId === me.id);
  const pending = mine.some((s) => s.state === 'pending');
  const lastChanges = mine[0]?.state === 'changes' ? mine[0] : null;
  const [items, setItems] = useState<Draft[]>([]);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const uploading = items.some((i) => i.kind === 'file' && !i.fileId);

  async function addFiles(files: File[]) {
    const key = Math.random().toString(36).slice(2);
    setItems((x) => [...x, ...files.map((f, n) => ({ kind: 'file' as const, key: key + n, title: f.name, size: f.size, progress: 0 }))]);
    try {
      const saved = await upload<{ id: string; name: string }[]>(`/tasks/${t.id}/files?purpose=submission`, files,
        (p) => setItems((x) => x.map((i) => (i.key.startsWith(key) ? { ...i, progress: p } : i))));
      setItems((x) => x.map((i) => { const n = i.key.startsWith(key) ? Number(i.key.slice(key.length)) : -1; return n >= 0 ? { ...i, fileId: saved[n]?.id, progress: 100 } : i; }));
    } catch (e) {
      setItems((x) => x.filter((i) => !i.key.startsWith(key)));
      toast((e as ApiError).message, { kind: 'error' });
    }
  }
  function addLink(e?: FormEvent) {
    e?.preventDefault();
    const v = url.trim();
    if (!v) return;
    setItems((x) => [...x, { kind: 'link', key: Math.random().toString(36), title: host(/^https?:/.test(v) ? v : `https://${v}`), url: v }]);
    setUrl('');
  }
  const submit = useMutation({
    mutationFn: () => api.post<{ version: number }>(`/tasks/${t.id}/submissions`, {
      note, links: items.filter((i) => i.kind === 'link').map((i) => ({ url: i.url })), fileIds: items.filter((i) => i.fileId).map((i) => i.fileId),
    }),
    onSuccess: (r) => {
      setItems([]); setNote('');
      qc.invalidateQueries({ queryKey: ['task', t.id] }); qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(`Version ${r.version} submitted. ${t.reviewer ? firstName(t.reviewer.name) : 'The team lead'} has been notified.`);
    },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });

  if (pending) return <div className="review-bar"><div className="t"><b>Your version {mine[0].version} is waiting for review.</b> You can submit again after the reviewer responds.</div></div>;
  return (
    <div className="submit-box">
      <div>
        <h3>{mine.length ? `Submit version ${mine[0].version + 1}` : 'Submit your work'}</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{lastChanges ? 'Fix what the reviewer asked for, then submit a new version. Earlier versions are kept.' : 'Add the files or links you want reviewed. Your status moves to Ready for Review.'}</p>
      </div>
      {lastChanges?.feedback && <div className="feedback"><b>{lastChanges.reviewedByName}:</b> {lastChanges.feedback}</div>}
      {items.length > 0 && (
        <div className="items">
          {items.map((i) => (
            <div className="item" key={i.key}>
              <span className="ic">{i.kind === 'link' ? <LinkIcon url={i.url!} /> : <Paperclip size={15} />}</span>
              <span className="t"><b>{i.title}</b><small>{i.kind === 'link' ? i.url : i.fileId ? fileSize(i.size ?? 0) : `Uploading… ${i.progress ?? 0}%`}</small>
                {i.kind === 'file' && !i.fileId && <div className="upload-bar"><i style={{ width: `${i.progress ?? 0}%` }} /></div>}</span>
              <button className="icon-btn" onClick={() => setItems((x) => x.filter((y) => y.key !== i.key))} aria-label={`Remove ${i.title}`}><X size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <form className="row" onSubmit={addLink}>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link: staging URL, Figma, Drive, GitHub PR…" aria-label="Submission link" />
        <button className="btn" disabled={!url.trim()}>Add link</button>
      </form>
      <Dropzone onFiles={addFiles} label="Attach files" />
      <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the reviewer (optional)" aria-label="Note for the reviewer" />
      <div className="row end">
        <button className="btn primary" disabled={!items.length || uploading || submit.isPending} onClick={() => submit.mutate()}><Send size={15} />Submit for review</button>
      </div>
    </div>
  );
}

/* ---------- comments with @mentions ---------- */
function Comments({ t, comments, loading }: { t: TaskDetail; comments: Comment[]; loading: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const people = usePeople();
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [mentionQ, setMentionQ] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // People who can see this task: its team and its assignees.
  const candidates = useMemo(() => (people.data ?? []).filter((p) => p.id !== me.id && (p.role === 'admin' || p.teams.some((x) => x.teamId === t.team.id) || t.assignees.some((a) => a.id === p.id))), [people.data, t, me.id]);
  const matches = mentionQ === null ? [] : candidates.filter((p) => p.name.toLowerCase().includes(mentionQ.toLowerCase())).slice(0, 6);

  const post = useMutation({
    mutationFn: () => api.post<Comment>(`/tasks/${t.id}/comments`, { body, mentions: mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id) }),
    onSuccess: (c) => {
      qc.setQueryData<Comment[]>(['task', t.id, 'comments'], (o) => [...(o ?? []), c]);
      setBody(''); setMentions([]);
      setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 30);
    },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/comments/${id}`),
    onMutate: (id) => qc.setQueryData<Comment[]>(['task', t.id, 'comments'], (o) => o?.filter((c) => c.id !== id)),
  });

  function onChange(v: string) {
    setBody(v);
    const caret = ta.current?.selectionStart ?? v.length;
    const m = /(^|\s)@([\w.-]{0,30})$/.exec(v.slice(0, caret));
    setMentionQ(m ? m[2] : null);
    setSel(0);
  }
  function pick(p: { id: string; name: string }) {
    const el = ta.current!;
    const caret = el.selectionStart;
    const before = body.slice(0, caret).replace(/@([\w.-]{0,30})$/, `@${p.name} `);
    const next = before + body.slice(caret);
    setBody(next);
    setMentions((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]));
    setMentionQ(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  }
  function onKey(e: React.KeyboardEvent) {
    if (matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[sel]); return; }
      if (e.key === 'Escape') { e.stopPropagation(); setMentionQ(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) { e.preventDefault(); post.mutate(); }
  }
  const render = (txt: string) => txt.split(/(@[A-Z][\w.-]*(?: [A-Z][\w.-]*)?)/g).map((part, i) =>
    part.startsWith('@') && candidates.concat(people.data?.filter((p) => p.id === me.id) ?? []).some((p) => `@${p.name}` === part || `@${firstName(p.name)}` === part)
      ? <span key={i} className="mention">{part}</span> : part);

  return (
    <div>
      {loading && <div className="skel" />}
      {!loading && comments.length === 0 && <p className="muted" style={{ marginBottom: 12 }}>No comments yet. Start the conversation where the work is.</p>}
      {comments.map((c) => (
        <div key={c.id} className="comment">
          <Avatar name={c.authorName ?? '?'} size={32} />
          <div className="bd">
            <div className="h"><b>{c.authorName ?? 'Former user'}</b><span>{ago(c.createdAt)}</span>
              {(c.authorId === me.id || me.role === 'admin') && <button className="link-btn" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => remove.mutate(c.id)}>Delete</button>}</div>
            <p>{render(c.body)}</p>
          </div>
        </div>
      ))}
      <div ref={end} />
      <div className="composer" style={{ marginTop: 14 }}>
        <textarea ref={ta} value={body} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder="Write a comment. Type @ to mention someone." aria-label="Comment" maxLength={5000} rows={2} />
        {matches.length > 0 && (
          <div className="popover" style={{ position: 'absolute', left: 10, bottom: '100%', marginBottom: 6 }} role="listbox">
            {matches.map((p, i) => (
              <button key={p.id} className={`pop-item ${i === sel ? 'kb' : ''}`} role="option" aria-selected={i === sel} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                <Avatar name={p.name} size={22} /><span className="grow">{p.name}</span><small>{p.title}</small>
              </button>
            ))}
          </div>
        )}
        <div className="bar"><span>⌘ Enter to send</span><button className="btn primary sm" disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}>Comment</button></div>
      </div>
    </div>
  );
}

/* ---------- activity ---------- */
function ActivityFeed({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['task', id, 'activity'], queryFn: () => api.get<Activity>(`/tasks/${id}/activity`) });
  if (q.isLoading) return <div className="skel" />;
  const { items = [], names = {} } = q.data ?? {};
  const n = (uid: string) => names[uid] ?? 'someone';
  const list = (ids: string[] = []) => ids.map(n).join(', ');
  const describe = (a: Activity['items'][number]) => {
    const m = a.meta ?? {};
    switch (a.action) {
      case 'created': return 'created this task';
      case 'assigned': return `assigned ${list(m.userIds)}`;
      case 'unassigned': return `removed ${list(m.userIds)}`;
      case 'status': return m.userId === a.actorId ? `moved their status to ${STATUS[m.to as Status]}` : `set ${n(m.userId)}'s status to ${STATUS[m.to as Status]}`;
      case 'submitted': return `submitted version ${m.version}`;
      case 'approved': return `approved ${n(m.userId)}'s version ${m.version}`;
      case 'changes_requested': return `requested changes on ${n(m.userId)}'s version ${m.version}`;
      case 'updated': return `updated ${(m.fields ?? []).map((f: string) => ({ dueDate: 'the due date', reviewerId: 'the reviewer' } as Record<string, string>)[f] ?? f).join(', ')}`;
      case 'file_added': return `attached ${m.name}`;
      case 'link_added': return `added a link: ${m.title}`;
      case 'checked': return `checked off “${m.text}”`;
      case 'unchecked': return `unchecked “${m.text}”`;
      default: return a.action;
    }
  };
  return (
    <div className="timeline">
      {[...items].reverse().map((a) => (
        <div className="tl" key={a.id}>
          <Avatar name={a.actorName ?? '?'} size={26} />
          <div className="tx"><b>{a.actorName ?? 'Someone'}</b> {describe(a)}</div>
          <time dateTime={a.createdAt} title={stamp(a.createdAt)}>{ago(a.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}
