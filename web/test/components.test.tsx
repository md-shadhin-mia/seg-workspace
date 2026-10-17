import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusPill, ToastProvider, strength } from '../src/components/ui';
import { TaskRow } from '../src/components/TaskRow';
import { Login, Register } from '../src/pages/Auth';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ToastProvider><MemoryRouter>{ui}</MemoryRouter></ToastProvider></QueryClientProvider>);
}
function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

describe('StatusPill', () => {
  it('shows a readable label and is a button only when changeable', () => {
    const { rerender } = render(<StatusPill status="in_progress" />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    const fn = vi.fn();
    rerender(<StatusPill status="review" onClick={fn} />);
    fireEvent.click(screen.getByRole('button', { name: /Ready for Review/ }));
    expect(fn).toHaveBeenCalled();
  });
});

describe('TaskRow', () => {
  it('summarises people progress and links to the task', () => {
    wrap(<TaskRow t={{ id: 't1', seq: 7, title: 'Study Abroad page', status: 'in_progress', priority: 'high', dueDate: null, projectName: 'Main Website',
      assignees: [{ userId: 'a', name: 'Tanvir Ahmed', status: 'done' }, { userId: 'b', name: 'Imran Kabir', status: 'review' }], checklistTotal: 4, checklistDone: 1 }} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tasks/t1');
    expect(screen.getByText('1/2 people done')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('No date')).toBeInTheDocument();
  });
});

describe('Login', () => {
  it('sends the CSRF header and explains a pending account', async () => {
    const f = mockFetch(403, { error: { code: 'pending', message: 'Your account is waiting for an admin to approve it.' } });
    wrap(<Login />);
    await userEvent.type(screen.getByLabelText('Email'), 'walid@seg.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('waiting for an admin');
    const [, init] = f.mock.calls[0];
    expect((init!.headers as Record<string, string>)['x-requested-with']).toBe('seg-web');
  });
});

describe('Register', () => {
  it('keeps the button disabled until the password is long enough, then confirms the request', async () => {
    mockFetch(201, { status: 'pending' });
    wrap(<Register />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Walid Hasan');
    await userEvent.type(screen.getByLabelText('Work email'), 'walid@seg.test');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    const btn = screen.getByRole('button', { name: 'Request account' });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Password'), '-but-longer');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/Request sent/)).toBeInTheDocument());
  });
  it('scores password strength', () => {
    expect(strength('short')).toBe(0);
    expect(strength('longer-password')).toBeGreaterThanOrEqual(2);
  });
});
