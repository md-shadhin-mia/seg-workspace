import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Flag, UserPlus } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/auth';
import { PRIORITY } from '../lib/format';
import type { Person, Priority, Project } from '../lib/types';
import { AvatarStack, Modal, PeoplePicker, useAnchor, useToast } from './ui';

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => api.get<Person[]>('/people'), staleTime: 60_000 });
}

/** Team members first, then everyone else (assigning someone outside the team gives them access to this task only). */
export function peopleFor(people: Person[] | undefined, teamId: string | undefined, teamName?: string) {
  if (!people) return [];
  const inTeam = people.filter((p) => teamId && p.teams.some((t) => t.teamId === teamId));
  const others = people.filter((p) => !inTeam.includes(p));
  return [
    ...inTeam.map((p) => ({ id: p.id, name: p.name, title: p.title, group: teamName ?? 'Team' })),
    ...others.map((p) => ({ id: p.id, name: p.name, title: p.title, group: 'Other people · task access only' })),
  ];
}

export function NewTaskModal({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const people = usePeople();
  const [title, setTitle] = useState('');
  const [pid, setPid] = useState(projectId ?? '');
  const [assignees, setAssignees] = useState<string[]>([me.id]);
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [description, setDescription] = useState('');
  const [showDesc, setShowDesc] = useState(false);
  const picker = useAnchor();
  const project = projects.data?.find((p) => p.id === (pid || projects.data?.[0]?.id));
  const effectivePid = pid || project?.id || '';
  const pickList = useMemo(() => peopleFor(people.data, project?.teamId, project?.teamName), [people.data, project]);
  const names = assignees.map((id) => people.data?.find((p) => p.id === id)?.name ?? '').filter(Boolean);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/tasks', { projectId: effectivePid, title, description, priority, dueDate: due || null, assigneeIds: assignees }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['project', effectivePid] });
      onClose();
      toast(`Task created in ${project?.name}`, { action: ['Open', () => nav(`/tasks/${r.id}`)] });
    },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); if (title.trim() && effectivePid) create.mutate(); };
  const noProjects = projects.data && projects.data.length === 0;

  return (
    <Modal title="New task" onClose={onClose} footer={<>
      <span className="note">Only the title is required. You can add details after.</span>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" form="new-task" disabled={!title.trim() || !effectivePid || create.isPending}>{create.isPending ? 'Creating…' : 'Create task'}</button>
    </>}>
      {noProjects ? (
        <div className="notice info">There are no projects you can add tasks to yet. A team lead or admin needs to create one first.</div>
      ) : (
        <form id="new-task" className="form" onSubmit={submit}>
          <input className="input" style={{ height: 46, fontSize: 16, fontWeight: 500 }} placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-label="Task title" maxLength={200} />
          {showDesc
            ? <textarea className="input" rows={4} placeholder="Add details, links or acceptance criteria" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
            : <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowDesc(true)}>+ Add a description</button>}
          <div className="grid-2">
            <div className="field">
              <label htmlFor="nt-project">Project</label>
              <select id="nt-project" className="input" value={effectivePid} onChange={(e) => setPid(e.target.value)}>
                {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.teamName} · {p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="lbl">Assignees</span>
              <button type="button" className="input" style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }} onClick={picker.open} aria-label="Choose assignees">
                {names.length ? <><AvatarStack names={names} size={22} /><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names.length === 1 ? names[0] : `${names.length} people`}</span></> : <><UserPlus size={16} className="muted" /><span className="muted">Nobody yet</span></>}
              </button>
            </div>
            <div className="field">
              <label htmlFor="nt-due"><CalendarDays size={13} style={{ verticalAlign: -2 }} /> Due date</label>
              <input id="nt-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="nt-pr"><Flag size={13} style={{ verticalAlign: -2 }} /> Priority</label>
              <select id="nt-pr" className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p]}</option>)}
              </select>
            </div>
          </div>
        </form>
      )}
      {picker.anchor && <PeoplePicker anchor={picker.anchor} people={pickList} selected={assignees} onChange={setAssignees} onClose={picker.close} />}
    </Modal>
  );
}
