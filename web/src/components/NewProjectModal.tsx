import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Sparkles } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/auth';
import { PRIORITY, dueLabel, plural } from '../lib/format';
import type { AiPlan, AiPlanTask } from '../lib/types';
import { Modal, PriorityTag, useToast } from './ui';
import { AiSkeleton, useAiEnabled } from './Ai';

type Draft = AiPlanTask & { on: boolean };

/** Objectives, milestones and risks have no fields of their own, so they go into the project description. */
export function planDescription(p: Pick<AiPlan, 'description' | 'objectives' | 'milestones' | 'risks'>) {
  const list = (title: string, xs: string[]) => (xs.length ? `\n\n${title}\n${xs.map((x) => `- ${x}`).join('\n')}` : '');
  return (p.description
    + list('Objectives', p.objectives)
    + list('Milestones', p.milestones.map((m) => (m.dueDate ? `${m.title} (by ${m.dueDate})` : m.title)))
    + list('Risks', p.risks)).trim().slice(0, 6000);
}

export function NewProjectModal({ teamId, onClose }: { teamId?: string; onClose: () => void }) {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const aiEnabled = useAiEnabled();
  const manageable = me.role === 'admin' ? null : me.teams.filter((t) => t.role === 'lead');
  const [teams] = useState(() => manageable);
  const [team, setTeam] = useState(teamId ?? manageable?.[0]?.teamId ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [mode, setMode] = useState<'blank' | 'ai'>('blank');
  const [brief, setBrief] = useState('');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [tasks, setTasks] = useState<Draft[]>([]);
  const allTeams = qc.getQueryData<{ id: string; name: string }[]>(['teams']) ?? [];
  const options = teams ? teams.map((t) => ({ id: t.teamId, name: t.name })) : allTeams;
  const effectiveTeam = team || options[0]?.id || '';
  const picked = tasks.filter((t) => t.on);
  const err = (e: unknown) => toast((e as ApiError).message, { kind: 'error' });

  const generate = useMutation({
    mutationFn: () => api.post<AiPlan>('/ai/plan', { teamId: effectiveTeam, name, brief, dueDate: due || null }),
    onSuccess: (p) => { setPlan(p); setDescription(p.description); setTasks(p.tasks.map((t) => ({ ...t, on: true }))); },
    onError: err,
  });

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/projects', {
      teamId: effectiveTeam, name, description: plan ? planDescription({ ...plan, description }) : description, dueDate: due || null,
      tasks: plan ? picked.map((t) => ({ title: t.title, description: t.description, priority: t.priority, dueDate: t.dueDate, assigneeIds: t.assigneeId ? [t.assigneeId] : [] })) : [],
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
      toast(plan && picked.length ? `${name} created with ${plural(picked.length, 'task')}` : `${name} created`);
      nav(`/projects/${r.id}`);
    },
    onError: err,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !effectiveTeam) return;
    if (mode === 'ai' && !plan) { if (brief.trim()) generate.mutate(); } else create.mutate();
  };
  const edit = (i: number, patch: Partial<Draft>) => setTasks((xs) => xs.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const previewing = mode === 'ai' && (plan || generate.isPending);

  const footer = previewing ? (
    <>
      <span className="note">Nothing is created until you confirm.</span>
      <button className="btn ghost" onClick={() => { setPlan(null); generate.reset(); }} disabled={generate.isPending}>Back</button>
      <button className="btn" onClick={() => generate.mutate()} disabled={generate.isPending || create.isPending}>Regenerate</button>
      <button className="btn primary" form="new-project" disabled={!plan || create.isPending}>
        {create.isPending ? 'Creating…' : `Create project with ${plural(picked.length, 'task')}`}
      </button>
    </>
  ) : (
    <>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      {mode === 'ai'
        ? <button className="btn primary" form="new-project" disabled={!name.trim() || !effectiveTeam || !brief.trim()}><Sparkles size={15} />Generate plan</button>
        : <button className="btn primary" form="new-project" disabled={!name.trim() || !effectiveTeam || create.isPending}>{create.isPending ? 'Creating…' : 'Create project'}</button>}
    </>
  );

  return (
    <Modal title={previewing ? `Plan for ${name}` : 'New project'} onClose={onClose} wide={mode === 'ai'} footer={footer}>
      <form id="new-project" className="form" onSubmit={submit}>
        {!previewing && (
          <>
            {aiEnabled && (
              <div className="subtabs" role="tablist" aria-label="How to start">
                <button type="button" role="tab" aria-selected={mode === 'blank'} className={mode === 'blank' ? 'active' : ''} onClick={() => setMode('blank')}>Start blank</button>
                <button type="button" role="tab" aria-selected={mode === 'ai'} className={mode === 'ai' ? 'active' : ''} onClick={() => setMode('ai')}>Draft a plan with AI</button>
              </div>
            )}
            <div className="field"><label htmlFor="np-name">Project name</label><input id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} /></div>
            <div className="field"><label htmlFor="np-team">Team</label>
              <select id="np-team" className="input" value={effectiveTeam} onChange={(e) => setTeam(e.target.value)}>
                {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <span className="hint">Everyone in this team can see the project. Nobody else can.</span>
            </div>
            {mode === 'ai' ? (
              <div className="field"><label htmlFor="np-brief">Brief</label>
                <textarea id="np-brief" className="input" rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000}
                  placeholder="What is the project for, what needs to be delivered, and any deadlines or constraints." />
                <span className="hint">AI drafts tasks for this team's members. You review everything before it's created. The brief and team names are sent to OpenRouter.</span>
              </div>
            ) : (
              <div className="field"><label htmlFor="np-desc">Short description <span className="muted">(optional)</span></label><textarea id="np-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={6000} /></div>
            )}
            <div className="field"><label htmlFor="np-due">Due date <span className="muted">(optional)</span></label><input id="np-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          </>
        )}

        {previewing && generate.isPending && (
          <div className="form" aria-live="polite">
            <p className="muted" style={{ fontSize: 13.5 }}>Drafting a plan. This can take up to a minute…</p>
            <AiSkeleton lines={3} />
            {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 40 }} />)}
          </div>
        )}

        {previewing && plan && !generate.isPending && (
          <>
            <div className="field"><label htmlFor="np-plan-desc">Project description</label>
              <textarea id="np-plan-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} style={{ height: 'auto', padding: '10px 12px', lineHeight: 1.5 }} />
              <span className="hint">The objectives, milestones and risks below are added to the description when the project is created.</span>
            </div>
            <div className="grid-2">
              {plan.objectives.length > 0 && <div><span className="label">Objectives</span><ul className="ai-list">{plan.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
              {plan.milestones.length > 0 && <div><span className="label">Milestones</span><ul className="ai-list">{plan.milestones.map((m, i) => <li key={i}>{m.title}{m.dueDate && <span className="muted"> · {dueLabel(m.dueDate)}</span>}</li>)}</ul></div>}
            </div>
            <div>
              <div className="blk-h" style={{ marginBottom: 0 }}><span className="label">Tasks</span><span className="muted num" style={{ fontSize: 13 }}>{picked.length} of {tasks.length} selected</span></div>
              {tasks.length === 0 && <p className="muted" style={{ fontSize: 13.5, marginTop: 8 }}>The plan has no tasks. Try regenerating with a more detailed brief.</p>}
              {tasks.map((t, i) => (
                <div key={i} className={`ai-plan-task ${t.on ? '' : 'off'}`}>
                  <button type="button" className={`cbox ${t.on ? 'on' : ''}`} role="checkbox" aria-checked={t.on} aria-label={`Include ${t.title}`} onClick={() => edit(i, { on: !t.on })} style={{ marginTop: 2 }}>
                    {t.on && <Check size={12} strokeWidth={3} />}
                  </button>
                  <div className="t">
                    <span className="row" style={{ gap: 8, alignItems: 'baseline' }}><span>{t.title}</span><PriorityTag p={t.priority} compact /><span className="sr-only">{PRIORITY[t.priority]} priority</span></span>
                    {t.description && <small>{t.description}</small>}
                  </div>
                  <div className="meta">
                    <select className="input sm" value={t.assigneeId ?? ''} onChange={(e) => edit(i, { assigneeId: e.target.value || null })} aria-label={`Assignee for ${t.title}`} disabled={!t.on}>
                      <option value="">Unassigned</option>
                      {plan.members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.title ? ` · ${m.title}` : ''}</option>)}
                    </select>
                    <input type="date" className="input sm" value={t.dueDate ?? ''} onChange={(e) => edit(i, { dueDate: e.target.value || null })} aria-label={`Due date for ${t.title}`} disabled={!t.on} />
                  </div>
                </div>
              ))}
            </div>
            {plan.risks.length > 0 && <div><span className="label">Risks</span><ul className="ai-list">{plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
          </>
        )}
      </form>
    </Modal>
  );
}
