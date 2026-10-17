import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MailCheck, MoreHorizontal, Search, UserPlus } from 'lucide-react';
import { ApiError, api } from '../../lib/api';
import { useAuth, useMe } from '../../lib/auth';
import { ago } from '../../lib/format';
import type { Person, Team, TeamRef } from '../../lib/types';
import { Avatar, Confirm, Empty, ErrorState, Menu, Modal, PageLoading, useAnchor, useToast } from '../../components/ui';

type Tab = 'pending' | 'active' | 'off';

export default function Users() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'active';
  const [q, setQ] = useState(params.get('q') ?? '');
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<Person[]>('/users') });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api.get<Team[]>('/teams') });
  const [access, setAccess] = useState<{ user: Person; approve: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [linkFor, setLinkFor] = useState<{ name: string; url: string; emailed: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ user: Person; action: 'rejected' | 'disabled' } | null>(null);
  const menu = useAnchor();
  const [menuUser, setMenuUser] = useState<Person | null>(null);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['people'] }); };
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/users/${id}`, { status }),
    onSuccess: refresh, onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  const resetLink = useMutation({
    mutationFn: (u: Person) => api.post<{ url: string; emailed: boolean }>(`/users/${u.id}/reset-link`).then((r) => ({ ...r, name: u.name })),
    onSuccess: setLinkFor, onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });

  const counts = useMemo(() => {
    const l = users.data ?? [];
    return { pending: l.filter((u) => u.status === 'pending').length, active: l.filter((u) => u.status === 'active').length, off: l.filter((u) => ['disabled', 'rejected'].includes(u.status)).length };
  }, [users.data]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users.data ?? []).filter((u) => (tab === 'pending' ? u.status === 'pending' : tab === 'active' ? u.status === 'active' : ['disabled', 'rejected'].includes(u.status)))
      .filter((u) => !s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s));
  }, [users.data, tab, q]);

  if (users.isLoading) return <PageLoading />;
  if (users.error) return <ErrorState error={users.error} retry={() => users.refetch()} />;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Users</h1><p>Approve sign-ups, choose which teams people belong to, and turn accounts off when someone leaves.</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}><UserPlus size={16} />Add person</button>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="subtabs">
          <button className={tab === 'pending' ? 'active' : ''} onClick={() => setParams({ tab: 'pending' })}>Waiting for approval {counts.pending > 0 && `(${counts.pending})`}</button>
          <button className={tab === 'active' ? 'active' : ''} onClick={() => setParams({})}>Active ({counts.active})</button>
          <button className={tab === 'off' ? 'active' : ''} onClick={() => setParams({ tab: 'off' })}>Turned off ({counts.off})</button>
        </div>
        <label className="search-pill" style={{ width: 260 }}><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search users" style={{ border: 0, outline: 0, background: 'transparent', flex: 1, minWidth: 0 }} /></label>
      </div>

      {list.length === 0 ? (
        <Empty title={tab === 'pending' ? 'No one is waiting' : 'No one here'}>{tab === 'pending' ? 'New sign-ups appear here for you to approve.' : ''}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th>{tab === 'pending' ? <th>Requested</th> : <><th>Role</th><th>Teams</th><th>Last sign-in</th></>}<th style={{ width: tab === 'pending' ? 210 : 60 }} /></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td><div className="who-cell"><Avatar name={u.name} size={34} /><div><b>{u.name}{u.id === me.id && <span className="muted" style={{ fontWeight: 400 }}> (you)</span>}</b><small>{u.email}{u.title ? ` · ${u.title}` : ''}</small></div></div></td>
                  {tab === 'pending' ? <td className="muted">{ago(u.createdAt)}</td> : (
                    <>
                      <td>{u.role === 'admin' ? <span className="pill lime">Admin</span> : <span className="pill">Member</span>}{u.status === 'rejected' && <span className="pill red" style={{ marginLeft: 6 }}>Not approved</span>}</td>
                      <td><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{u.teams.length ? u.teams.map((t) => <span key={t.teamId} className="pill">{t.name}{t.role === 'lead' ? ' · Lead' : ''}</span>) : <span className="muted">No team</span>}</div></td>
                      <td className="muted">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                    </>
                  )}
                  <td>
                    {tab === 'pending' ? (
                      <div className="row end">
                        <button className="btn sm" onClick={() => setConfirm({ user: u, action: 'rejected' })}>Decline</button>
                        <button className="btn primary sm" onClick={() => setAccess({ user: u, approve: true })}>Approve</button>
                      </div>
                    ) : tab === 'off' ? (
                      <button className="btn sm" onClick={() => setStatus.mutate({ id: u.id, status: 'active' }, { onSuccess: () => toast(`${u.name} can sign in again`) })}>Turn on</button>
                    ) : (
                      <button className="icon-btn" aria-label={`Options for ${u.name}`} onClick={(e) => { setMenuUser(u); menu.open(e); }}><MoreHorizontal size={17} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {menu.anchor && menuUser && (
        <Menu anchor={menu.anchor} onClose={menu.close} onPick={(k) => {
          if (k === 'access') setAccess({ user: menuUser, approve: false });
          if (k === 'link') resetLink.mutate(menuUser);
          if (k === 'off') setConfirm({ user: menuUser, action: 'disabled' });
        }} items={[
          { key: 'access', label: 'Edit role and teams' },
          { key: 'link', label: 'Send password link' },
          { key: 's', sep: true },
          { key: 'off', label: 'Turn off account', disabled: menuUser.id === me.id },
        ]} />
      )}
      {access && teams.data && <AccessModal user={access.user} approve={access.approve} teams={teams.data} onClose={() => setAccess(null)} onDone={refresh} />}
      {adding && teams.data && <AddPersonModal teams={teams.data} onClose={() => setAdding(false)} onDone={(r) => { refresh(); setAdding(false); setLinkFor(r); }} />}
      {linkFor && (
        <Modal title="Password link" onClose={() => setLinkFor(null)} footer={<button className="btn primary" onClick={() => setLinkFor(null)}>Done</button>}>
          {linkFor.emailed
            ? <div className="notice ok"><MailCheck size={16} />We emailed this link to {linkFor.name}. You can also share it yourself.</div>
            : <div className="notice info">Email isn't set up yet, so send this link to {linkFor.name} yourself. It works once.</div>}
          <CopyField value={linkFor.url} />
        </Modal>
      )}
      {confirm && (
        <Confirm title={confirm.action === 'rejected' ? `Decline ${confirm.user.name}?` : `Turn off ${confirm.user.name}'s account?`} danger
          confirm={confirm.action === 'rejected' ? 'Decline' : 'Turn off'} onClose={() => setConfirm(null)}
          body={confirm.action === 'rejected' ? 'They won’t be able to sign in. You can approve them later from Turned off.' : 'They are signed out everywhere right away. Their tasks and comments stay. You can turn the account back on later.'}
          onConfirm={() => setStatus.mutateAsync({ id: confirm.user.id, status: confirm.action })} />
      )}
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const toast = useToast();
  return (
    <div className="row">
      <input className="input" readOnly value={value} onFocus={(e) => e.target.select()} aria-label="Link" />
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(value); toast('Copied'); } catch { toast('Select the link and copy it', { kind: 'error' }); } }}><Copy size={15} />Copy</button>
    </div>
  );
}

function TeamPicker({ teams, value, onChange }: { teams: Team[]; value: TeamRef[]; onChange: (v: TeamRef[]) => void }) {
  return (
    <div className="list">
      {teams.map((t) => {
        const cur = value.find((v) => v.teamId === t.id);
        return (
          <div key={t.id} className="task-row" style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}>
            <input type="checkbox" id={`tp-${t.id}`} aria-label={t.name} checked={!!cur} style={{ width: 17, height: 17, accentColor: '#141414' }}
              onChange={(e) => onChange(e.target.checked ? [...value, { teamId: t.id, name: t.name, role: 'member' }] : value.filter((v) => v.teamId !== t.id))} />
            <label htmlFor={`tp-${t.id}`} style={{ cursor: 'pointer' }}><b style={{ fontWeight: 500 }}>{t.name}</b><div className="t-sub">{t.memberCount} people · {t.projectCount} projects</div></label>
            <select className="input sm" style={{ width: 120 }} disabled={!cur} value={cur?.role ?? 'member'} aria-label={`Role in ${t.name}`}
              onChange={(e) => onChange(value.map((v) => (v.teamId === t.id ? { ...v, role: e.target.value as 'lead' | 'member' } : v)))}>
              <option value="member">Member</option><option value="lead">Team lead</option>
            </select>
          </div>
        );
      })}
    </div>
  );
}

function AccessModal({ user, approve, teams, onClose, onDone }: { user: Person; approve: boolean; teams: Team[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const [role, setRole] = useState(user.role as 'admin' | 'member');
  const [value, setValue] = useState<TeamRef[]>(user.teams);
  const save = useMutation({
    mutationFn: async () => {
      await api.put(`/users/${user.id}/teams`, { teams: value.map(({ teamId, role: r }) => ({ teamId, role: r })) });
      await api.patch(`/users/${user.id}`, { role, ...(approve ? { status: 'active' } : {}) });
    },
    onSuccess: () => { onDone(); refresh(); toast(approve ? `${user.name} is approved and can sign in` : 'Access updated'); onClose(); },
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  return (
    <Modal wide title={approve ? `Approve ${user.name}` : `${user.name}: role and teams`} onClose={onClose} footer={<>
      <span className="note">{value.length === 0 ? 'Without a team they only see tasks assigned to them.' : `They will see everything in ${value.map((v) => v.name).join(' and ')}.`}</span>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>{approve ? 'Approve' : 'Save'}</button>
    </>}>
      <div className="field"><span className="lbl">Teams</span><TeamPicker teams={teams} value={value} onChange={setValue} /></div>
      <div className="field"><label htmlFor="am-role">Workspace role</label>
        <select id="am-role" className="input" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
          <option value="member">Member: sees their teams' work</option><option value="admin">Admin: sees everything and manages people</option>
        </select></div>
    </Modal>
  );
}

function AddPersonModal({ teams, onClose, onDone }: { teams: Team[]; onClose: () => void; onDone: (r: { name: string; url: string; emailed: boolean }) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', title: '', role: 'member' });
  const [value, setValue] = useState<TeamRef[]>([]);
  const create = useMutation({
    mutationFn: () => api.post<{ inviteUrl: string; emailed: boolean }>('/users', { ...f, teams: value.map(({ teamId, role }) => ({ teamId, role })) }),
    onSuccess: (r) => onDone({ name: f.name, url: r.inviteUrl, emailed: r.emailed }),
    onError: (e) => toast((e as ApiError).message, { kind: 'error' }),
  });
  return (
    <Modal wide title="Add a person" onClose={onClose} footer={<>
      <span className="note">They get a link to set their own password.</span>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" form="add-person" disabled={!f.name.trim() || !f.email.trim() || create.isPending}>Create and invite</button>
    </>}>
      <form id="add-person" className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate(); }}>
        <div className="grid-2">
          <div className="field"><label htmlFor="ap-name">Full name</label><input id="ap-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></div>
          <div className="field"><label htmlFor="ap-email">Work email</label><input id="ap-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="ap-title">Job title</label><input id="ap-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="field"><label htmlFor="ap-role">Workspace role</label><select id="ap-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="member">Member</option><option value="admin">Admin</option></select></div>
        </div>
        <div className="field"><span className="lbl">Teams</span><TeamPicker teams={teams} value={value} onChange={setValue} /></div>
      </form>
    </Modal>
  );
}
