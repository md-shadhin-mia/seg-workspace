import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Clock, MailCheck } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { Avatar, Meter, PasswordInput, StatusPill } from '../components/ui';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side" aria-hidden="true">
        <div className="brand"><span className="logo">S</span><span className="name">SEG Workspace</span></div>
        <div className="auth-quote">
          <h2>Every task, every person, <mark>one clear status.</mark></h2>
          <p>Assign work to several people, see where each of them stands, and review what they deliver, all in one place.</p>
          <div className="auth-mock">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b style={{ fontWeight: 600 }}>Study Abroad Service Page</b><StatusPill status="in_progress" />
            </div>
            {[['Tanvir Ahmed', 'done'], ['Imran Kabir', 'review'], ['Walid Hasan', 'in_progress']].map(([n, s]) => (
              <div className="row" key={n} style={{ fontSize: 13 }}>
                <Avatar name={n} size={24} /><span style={{ flex: 1 }}>{n}</span><StatusPill status={s as any} />
              </div>
            ))}
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>SEG Digital · Internal workspace</p>
      </aside>
      <main className="auth-main"><div className="auth-card">{children}</div></main>
    </div>
  );
}

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export function Login() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      const next = params.get('next');
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      setError({ code: err instanceof ApiError ? err.code : 'error', message: errMsg(err) });
    } finally { setBusy(false); }
  }

  return (
    <AuthLayout>
      <h1>Sign in</h1>
      <p className="sub">Welcome back. Use your work email.</p>
      {params.get('reset') === '1' && <div className="notice ok" style={{ marginBottom: 16 }}><CheckCircle2 size={16} />Password updated. Sign in with your new password.</div>}
      {error && (
        <div className={`notice ${error.code === 'pending' ? 'info' : 'err'}`} style={{ marginBottom: 16 }} role="alert">
          {error.code === 'pending' ? <Clock size={16} /> : <AlertCircle size={16} />}<span>{error.message}</span>
        </div>
      )}
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label htmlFor="password" style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-2)' }}>Password</label>
            <Link to="/forgot-password" className="text-link" style={{ fontSize: 13 }}>Forgot password?</Link>
          </div>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" invalid={error?.code === 'unauthorized'} />
        </div>
        <button className="btn primary block" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="alt">New to SEG Workspace? <Link to="/register">Request an account</Link></p>
    </AuthLayout>
  );
}

export function Register() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', email: '', title: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const short = f.password.length > 0 && f.password.length < 10;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ status: string }>('/auth/register', f);
      if (r.status === 'active') { await qc.invalidateQueries({ queryKey: ['me'] }); nav('/', { replace: true }); return; }
      setDone(true);
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <AuthLayout>
        <div className="notice lime" style={{ marginBottom: 20 }}><MailCheck size={18} /><span><b>Request sent.</b> An admin will review your account. We'll email {f.email} as soon as it's approved.</span></div>
        <h1>Almost there</h1>
        <p className="sub">You can close this page. Once approved, sign in with the email and password you just chose.</p>
        <Link to="/login" className="btn block">Back to sign in</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Request an account</h1>
      <p className="sub">An admin approves new accounts and adds you to your team.</p>
      {error && <div className="notice err" role="alert" style={{ marginBottom: 16 }}><AlertCircle size={16} />{error}</div>}
      <form className="form" onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="name">Full name</label><input id="name" className="input" autoComplete="name" value={f.name} onChange={set('name')} required autoFocus /></div>
        <div className="field"><label htmlFor="email">Work email</label><input id="email" className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} required /></div>
        <div className="field"><label htmlFor="title">Job title <span className="muted">(optional)</span></label><input id="title" className="input" placeholder="e.g. Graphic Designer" value={f.title} onChange={set('title')} /></div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <PasswordInput id="password" value={f.password} onChange={(v) => setF((x) => ({ ...x, password: v }))} autoComplete="new-password" invalid={short} />
          <Meter pw={f.password} />
          <span className={short ? 'err' : 'hint'}>At least 10 characters. A short phrase is easiest to remember.</span>
        </div>
        <button className="btn primary block" disabled={busy || !f.name || !f.email || f.password.length < 10}>{busy ? 'Sending…' : 'Request account'}</button>
      </form>
      <p className="alt">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthLayout>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.post('/auth/forgot', { email }); setSent(true); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <AuthLayout>
      <h1>Reset your password</h1>
      <p className="sub">Enter your email and we'll send you a link to choose a new password.</p>
      {sent ? (
        <div className="notice ok"><MailCheck size={16} /><span>If an active account uses <b>{email}</b>, a reset link is on its way. It expires in 1 hour. Check your spam folder if you don't see it.</span></div>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          {error && <div className="notice err" role="alert"><AlertCircle size={16} />{error}</div>}
          <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
          <button className="btn primary block" disabled={busy || !email}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <p className="alt"><Link to="/login">Back to sign in</Link></p>
    </AuthLayout>
  );
}

export function Reset({ mode }: { mode: 'reset' | 'invite' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const qc = useQueryClient();
  const [info, setInfo] = useState<{ email: string; name: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setInvalid('This link is incomplete. Open it again from your email.'); return; }
    api.get<{ email: string; name: string }>(`/auth/token?token=${encodeURIComponent(token)}`).then(setInfo, (e) => setInvalid(errMsg(e)));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setError('The two passwords don’t match.'); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/auth/reset', { token, password: pw });
      await qc.invalidateQueries({ queryKey: ['me'] });
      nav('/', { replace: true });
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }

  return (
    <AuthLayout>
      <h1>{mode === 'invite' ? 'Set up your account' : 'Choose a new password'}</h1>
      <p className="sub">{info ? <>For <b>{info.email}</b></> : ' '}</p>
      {invalid ? (
        <>
          <div className="notice err" role="alert"><AlertCircle size={16} />{invalid}</div>
          <p className="alt"><Link to="/forgot-password">Get a new link</Link></p>
        </>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          {error && <div className="notice err" role="alert"><AlertCircle size={16} />{error}</div>}
          <div className="field">
            <label htmlFor="pw">New password</label>
            <PasswordInput id="pw" value={pw} onChange={setPw} autoComplete="new-password" />
            <Meter pw={pw} />
            <span className="hint">At least 10 characters.</span>
          </div>
          <div className="field">
            <label htmlFor="pw2">Repeat password</label>
            <PasswordInput id="pw2" value={pw2} onChange={setPw2} autoComplete="new-password" invalid={!!pw2 && pw !== pw2} />
          </div>
          <button className="btn primary block" disabled={busy || !info || pw.length < 10 || !pw2}>{busy ? 'Saving…' : mode === 'invite' ? 'Create password and sign in' : 'Save and sign in'}</button>
        </form>
      )}
    </AuthLayout>
  );
}
