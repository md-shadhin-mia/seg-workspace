import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useMe } from '../lib/auth';
import { ago } from '../lib/format';
import { Avatar, Meter, PasswordInput, useToast } from '../components/ui';

interface Sess { id: string; current: boolean; createdAt: string; lastSeenAt: string; userAgent: string; ip: string }

function device(ua: string) {
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${os ? ` on ${os}` : ''}`;
}

export default function Settings() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<Sess[]>('/auth/sessions') });
  const err = (e: unknown) => toast((e as ApiError).message, { kind: 'error' });

  const profile = useMutation({ mutationFn: () => api.patch('/auth/profile', { name, title }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); toast('Profile saved'); }, onError: err });
  const pw = useMutation({ mutationFn: () => api.post('/auth/password', { currentPassword: cur, newPassword: next }), onSuccess: () => { setCur(''); setNext(''); qc.invalidateQueries({ queryKey: ['sessions'] }); toast('Password changed. Other devices were signed out.'); }, onError: err });
  const revoke = useMutation({ mutationFn: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['sessions'] }); toast(`Signed out ${r.revoked} other ${r.revoked === 1 ? 'device' : 'devices'}`); }, onError: err });

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head"><div><h1>Profile & security</h1><p>Your details, password and signed-in devices.</p></div></div>

      <section className="card card-pad">
        <div className="row" style={{ gap: 14, marginBottom: 18 }}>
          <Avatar name={me.name} size={52} />
          <div><b style={{ fontSize: 16 }}>{me.name}</b><div className="muted">{me.email}</div>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {me.role === 'admin' && <span className="pill lime">Admin</span>}
              {me.teams.map((t) => <span key={t.teamId} className="pill">{t.name}{t.role === 'lead' ? ' · Lead' : ''}</span>)}
            </div></div>
        </div>
        <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); profile.mutate(); }}>
          <div className="grid-2">
            <div className="field"><label htmlFor="s-name">Full name</label><input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="s-title">Job title</label><input id="s-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          </div>
          <div className="row end"><button className="btn primary" disabled={!name.trim() || profile.isPending || (name === me.name && title === me.title)}>Save profile</button></div>
        </form>
      </section>

      <section className="section card card-pad">
        <h2 style={{ marginBottom: 14 }}>Change password</h2>
        <form className="form" onSubmit={(e: FormEvent) => { e.preventDefault(); pw.mutate(); }}>
          <div className="grid-2">
            <div className="field"><label htmlFor="s-cur">Current password</label><PasswordInput id="s-cur" value={cur} onChange={setCur} autoComplete="current-password" /></div>
            <div className="field"><label htmlFor="s-new">New password</label><PasswordInput id="s-new" value={next} onChange={setNext} autoComplete="new-password" /><Meter pw={next} /><span className="hint">At least 10 characters.</span></div>
          </div>
          <div className="row end"><button className="btn primary" disabled={!cur || next.length < 10 || pw.isPending}>Change password</button></div>
        </form>
      </section>

      <section className="section card card-pad">
        <div className="section-h" style={{ marginBottom: 6 }}><h2>Signed-in devices</h2><span className="sp" />
          {(sessions.data?.length ?? 0) > 1 && <button className="btn sm" onClick={() => revoke.mutate()}>Sign out other devices</button>}</div>
        {sessions.data?.map((s) => (
          <div key={s.id} className="kv">
            <span className="ico"><Monitor size={16} /></span>
            <div className="t"><b>{device(s.userAgent ?? '')}</b>{s.current && <span className="pill green" style={{ marginLeft: 8, height: 20 }}>This device</span>}<small>{s.ip} · active {ago(s.lastSeenAt)}</small></div>
          </div>
        ))}
      </section>
    </div>
  );
}
