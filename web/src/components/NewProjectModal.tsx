import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/auth';
import { Modal, useToast } from './ui';

export function NewProjectModal({ teamId, onClose }: { teamId?: string; onClose: () => void }) {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const manageable = me.role === 'admin' ? null : me.teams.filter((t) => t.role === 'lead');
  const [teams] = useState(() => manageable);
  const [team, setTeam] = useState(teamId ?? manageable?.[0]?.teamId ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const allTeams = qc.getQueryData<{ id: string; name: string }[]>(['teams']) ?? [];
  const options = teams ? teams.map((t) => ({ id: t.teamId, name: t.name })) : allTeams;
  const effectiveTeam = team || options[0]?.id || '';

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/projects', { teamId: effectiveTeam, name, description, dueDate: due || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      toast(`${name} created`);
      nav(`/projects/${r.id}`);
    },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim() && effectiveTeam) create.mutate(); };

  return (
    <Modal title="New project" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" form="new-project" disabled={!name.trim() || !effectiveTeam || create.isPending}>{create.isPending ? 'Creating…' : 'Create project'}</button>
    </>}>
      <form id="new-project" className="form" onSubmit={submit}>
        <div className="field"><label htmlFor="np-name">Project name</label><input id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} /></div>
        <div className="field"><label htmlFor="np-team">Team</label>
          <select id="np-team" className="input" value={effectiveTeam} onChange={(e) => setTeam(e.target.value)}>
            {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span className="hint">Everyone in this team can see the project. Nobody else can.</span>
        </div>
        <div className="field"><label htmlFor="np-desc">Short description <span className="muted">(optional)</span></label><textarea id="np-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="field"><label htmlFor="np-due">Due date <span className="muted">(optional)</span></label><input id="np-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </form>
    </Modal>
  );
}
