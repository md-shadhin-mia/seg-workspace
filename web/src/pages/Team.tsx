import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartNoAxesCombined, Plus, UserPlus } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/auth';
import { PROJECT_STATUS, dueLabel } from '../lib/format';
import type { Project, TeamDetail } from '../lib/types';
import { Avatar, Empty, ErrorState, Menu, PageLoading, PeoplePicker, useAnchor, useToast } from '../components/ui';
import { useShell } from '../components/Shell';
import { usePeople } from '../components/NewTaskModal';

export default function TeamPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const shell = useShell();
  const add = useAnchor();
  const memberMenu = useAnchor();
  const team = useQuery({ queryKey: ['team', id], queryFn: () => api.get<TeamDetail>(`/teams/${id}`) });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const people = usePeople();
  const change = useMutation({
    mutationFn: ({ userId, role, remove }: { userId: string; role?: string; remove?: boolean }) =>
      remove ? api.del(`/teams/${id}/members/${userId}`) : api.put(`/teams/${id}/members/${userId}`, { role: role ?? 'member' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team', id] }); qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['people'] }); },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });

  if (team.isLoading) return <PageLoading />;
  if (team.error) return <ErrorState error={team.error} />;
  const t = team.data!;
  const projs = (projects.data ?? []).filter((p) => p.teamId === id);
  const memberIds = t.members.map((m) => m.id);
  const target = memberMenu.anchor?.dataset.user;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t.name}</h1>{t.description && <p>{t.description}</p>}</div>
        {t.canManage && <Link className="btn" to={`/analytics?teamId=${id}`}><ChartNoAxesCombined size={16} />Team insights</Link>}
        {t.canManage && <button className="btn" onClick={() => shell.newProject(id)}><Plus size={16} />New project</button>}
      </div>

      <section className="section" style={{ marginTop: 8 }}>
        <div className="section-h"><h2>Projects</h2><span className="badge plain">{projs.length}</span></div>
        {projs.length ? (
          <div className="cards">
            {projs.map((p) => {
              const pct = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
              const [l, c] = PROJECT_STATUS[p.status] ?? ['On track', 'green'];
              return (
                <Link key={p.id} to={`/projects/${p.id}`} className="pcard">
                  <div className="top"><h3>{p.name}</h3><span className={`pill ${c}`}>{l}</span></div>
                  <p>{p.description || 'No description yet.'}</p>
                  <div className="foot"><div className="progress lime"><i style={{ width: `${pct}%` }} /></div><span className="num">{pct}%</span></div>
                  <div className="foot" style={{ justifyContent: 'space-between' }}><span>{p.taskCount - p.doneCount} open{p.overdueCount ? ` · ${p.overdueCount} overdue` : ''}</span><span>{p.dueDate ? `Due ${dueLabel(p.dueDate)}` : ''}</span></div>
                </Link>
              );
            })}
          </div>
        ) : <Empty title="No projects yet">{t.canManage ? 'Create the first project for this team.' : 'A team lead will set up projects here.'}</Empty>}
      </section>

      <section className="section">
        <div className="section-h"><h2>People</h2><span className="badge plain">{t.members.length}</span><span className="sp" />
          {t.canManage && <button className="btn sm" onClick={add.open}><UserPlus size={15} />Add people</button>}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Open tasks</th><th>Overdue</th>{t.canManage && <th style={{ width: 60 }} />}</tr></thead>
            <tbody>
              {t.members.map((m) => (
                <tr key={m.id}>
                  <td>{t.canManage || m.id === me.id
                    ? <Link to={`/people/${m.id}`} className="who-cell" title="Open performance"><Avatar name={m.name} size={32} /><div><b>{m.name}</b><small>{m.title || m.email}</small></div></Link>
                    : <div className="who-cell"><Avatar name={m.name} size={32} /><div><b>{m.name}</b><small>{m.title || m.email}</small></div></div>}</td>
                  <td>{m.role === 'lead' ? <span className="pill lime">Lead</span> : <span className="pill">Member</span>}</td>
                  <td className="num">{m.openTasks}</td>
                  <td className="num" style={m.overdueTasks ? { color: 'var(--red)', fontWeight: 500 } : undefined}>{m.overdueTasks}</td>
                  {t.canManage && <td><button className="btn ghost sm" data-user={m.id} onClick={memberMenu.open} aria-label={`Options for ${m.name}`} disabled={m.id === me.id && me.role !== 'admin'}>•••</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {add.anchor && (
        <PeoplePicker anchor={add.anchor} single selected={[]} onClose={add.close}
          people={(people.data ?? []).filter((p) => !memberIds.includes(p.id)).map((p) => ({ id: p.id, name: p.name, title: p.title }))}
          onChange={(ids) => ids[0] && change.mutate({ userId: ids[0] }, { onSuccess: () => toast('Added to the team') })} />
      )}
      {memberMenu.anchor && target && (
        <Menu anchor={memberMenu.anchor} onClose={memberMenu.close} onPick={(k) => {
          if (k === 'lead') change.mutate({ userId: target, role: 'lead' });
          if (k === 'member') change.mutate({ userId: target, role: 'member' });
          if (k === 'remove') change.mutate({ userId: target, remove: true }, { onSuccess: () => toast('Removed from the team') });
        }} items={[
          ...(me.role === 'admin' ? [
            { key: 'lead', label: 'Make team lead', active: t.members.find((m) => m.id === target)?.role === 'lead' },
            { key: 'member', label: 'Make member', active: t.members.find((m) => m.id === target)?.role === 'member' },
            { key: 's', sep: true },
          ] : []),
          { key: 'remove', label: 'Remove from team' },
        ]} />
      )}
    </div>
  );
}
