import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, GuestOnly, RequireAuth, useAuth } from '../src/lib/auth';
import { Login } from '../src/pages/Auth';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ME = { user: { id: 'u1', name: 'Ada Admin', email: 'ada@example.com', role: 'admin', teams: [] }, unread: 0, pendingUsers: 0, mailEnabled: true, aiEnabled: false };

/** Fake server with a session cookie: /auth/me answers 401 until /auth/login, and again after /auth/logout. */
function fakeServer() {
  let signedIn = false;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) { signedIn = true; return json(200, { ok: true }); }
    if (url.endsWith('/auth/logout')) { signedIn = false; return new Response(null, { status: 204 }); }
    if (url.endsWith('/auth/me')) return signedIn ? json(200, ME) : json(401, { error: { code: 'unauthorized', message: 'Sign in' } });
    return json(404, { error: { code: 'not_found', message: 'Not found' } });
  });
}

function Home() {
  const { signOut } = useAuth();
  const nav = useNavigate();
  return <><h1>Dashboard</h1><button onClick={async () => { await signOut(); nav('/login'); }}>Sign out</button></>;
}

function app() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}><AuthProvider><MemoryRouter initialEntries={['/']}><Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
    </Routes></MemoryRouter></AuthProvider></QueryClientProvider>,
  );
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in and out', () => {
  it('moves between the login page and the app without a reload', async () => {
    fakeServer();
    const user = userEvent.setup();
    app();

    await signIn(user);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();

    await signIn(user);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
