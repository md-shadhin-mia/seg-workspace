import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError, api } from '../../lib/api';
import type { Team } from '../../lib/types';
import { Confirm, ErrorState, Modal, PageLoading, useToast } from '../../components/ui';

export default function Teams() {
  const qc = useQueryClient();
  const toast = useToast();
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api.get<Team[]>('/teams') });
  const [edit, setEdit] = useState<Team | 'new' | null>(null);
  const [del, setDel] = useState<Team | null>(null);
  if (teams.isLoading) return <PageLoading />;
  if (teams.error) return <ErrorState error={teams.error} />;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Teams & access</h1><p>Teams are separate workspaces. People only see projects, tasks and files of teams they belong to, plus tasks they're assigned to.</p></div>
        <button className="btn primary" onClick={() => setEdit('new')}><Plus size={16} />New team</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Team</th><th>Department</th><th>People</th><th>Projects</th><th style={{ width: 230 }} /></tr></thead>
          <tbody>
            {teams.data!.map((t) => (
              <tr key={t.id}>
                <td><b style={{ fontWeight: 500 }}>{t.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{t.description || 'No description'}</div></td>
                <td>{t.department ? <span className="pill pink">{t.department}</span> : <span className="muted">–</span>}</td>
                <td className="num">{t.memberCount}</td>
                <td className="num">{t.projectCount}</td>
                <td><div className="row end">
                  <Link to={`/teams/${t.id}`} className="btn sm">Members</Link>
                  <button className="btn sm" onClick={() => setEdit(t)}>Edit</button>
                  <button className="btn ghost sm danger" onClick={() => setDel(t)} disabled={t.projectCount > 0} title={t.projectCount ? 'Archive or move its projects first' : undefined}>Delete</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <TeamModal team={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {del && <Confirm title={`Delete ${del.name}?`} danger confirm="Delete team" onClose={() => setDel(null)} body="Members lose access to this team. People's accounts are not affected."
        onConfirm={async () => { try { await api.del(`/teams/${del.id}`); qc.invalidateQueries({ queryKey: ['teams'] }); toast('Team deleted'); } catch (e) { toast((e as ApiError).message, { kind: 'error' }); } }} />}
    </div>
  );
}

function TeamModal({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [department, setDepartment] = useState(team?.department ?? '');
  const departments = [...new Set((qc.getQueryData<Team[]>(['teams']) ?? []).map((t) => t.department).filter(Boolean))].sort();
  const save = useMutation({
    mutationFn: () => (team ? api.patch(`/teams/${team.id}`, { name, description, department }) : api.post('/teams', { name, description, department })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); qc.invalidateQueries({ queryKey: ['me'] }); toast(team ? 'Team saved' : `${name} created`); onClose(); },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  return (
    <Modal title={team ? 'Edit team' : 'New team'} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" form="team-form" disabled={!name.trim() || save.isPending}>{team ? 'Save' : 'Create team'}</button>
    </>}>
      <form id="team-form" className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="field"><label htmlFor="tm-name">Name</label><input id="tm-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} /></div>
        <div className="field">
          <label htmlFor="tm-dept">Department <span className="muted">(optional)</span></label>
          <input id="tm-dept" className="input" list="tm-depts" value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={60} placeholder="e.g. Technology" />
          <datalist id="tm-depts">{departments.map((d) => <option key={d} value={d} />)}</datalist>
          <span className="hint">Groups teams in Analytics, so you can compare departments.</span>
        </div>
        <div className="field"><label htmlFor="tm-desc">Description</label><textarea id="tm-desc" className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></div>
      </form>
    </Modal>
  );
}
