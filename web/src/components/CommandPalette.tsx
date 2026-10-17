import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Inbox, LayoutGrid, ListChecks, Plus, Search, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { STATUS } from '../lib/format';
import type { Status } from '../lib/types';
import { Avatar } from './ui';

interface Item { group: string; label: string; sub?: string; icon: React.ReactNode; run: () => void }
interface SearchRes { tasks: { id: string; seq: number; title: string; status: Status; projectName: string }[]; projects: { id: string; name: string; teamName: string }[]; people: { id: string; name: string; title: string }[] }

export function CommandPalette({ onClose, onNewTask }: { onClose: () => void; onNewTask: () => void }) {
  const me = useMe();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 140); return () => clearTimeout(t); }, [q]);
  const res = useQuery({ queryKey: ['search', debounced], queryFn: () => api.get<SearchRes>(`/search?q=${encodeURIComponent(debounced)}`), enabled: debounced.length > 0 });

  const go = (to: string) => () => { onClose(); nav(to); };
  const items = useMemo<Item[]>(() => {
    const cmds: Item[] = [
      { group: 'Commands', label: 'Create a task', icon: <Plus size={16} />, run: onNewTask },
      { group: 'Commands', label: 'Go to Dashboard', icon: <LayoutGrid size={16} />, run: go('/') },
      { group: 'Commands', label: 'Go to My Tasks', icon: <ListChecks size={16} />, run: go('/my-tasks') },
      { group: 'Commands', label: 'Open Inbox', icon: <Inbox size={16} />, run: go('/inbox') },
      { group: 'Commands', label: 'Profile & security', icon: <Settings size={16} />, run: go('/settings') },
      ...(me.role === 'admin' ? [
        { group: 'Commands', label: 'Manage users', icon: <ShieldCheck size={16} />, run: go('/admin/users') },
        { group: 'Commands', label: 'Manage teams', icon: <FolderKanban size={16} />, run: go('/admin/teams') },
      ] : []),
    ];
    const s = q.trim().toLowerCase();
    const out = cmds.filter((c) => !s || c.label.toLowerCase().includes(s));
    if (s && res.data && debounced) {
      res.data.tasks.forEach((t) => out.push({ group: 'Tasks', label: t.title, sub: `${t.projectName} · ${STATUS[t.status]}`, icon: <ListChecks size={16} />, run: go(`/tasks/${t.id}`) }));
      res.data.projects.forEach((p) => out.push({ group: 'Projects', label: p.name, sub: p.teamName, icon: <FolderKanban size={16} />, run: go(`/projects/${p.id}`) }));
      res.data.people.forEach((p) => out.push({ group: 'People', label: p.name, sub: p.title, icon: <Avatar name={p.name} size={22} />, run: go(me.role === 'admin' ? `/admin/users?q=${encodeURIComponent(p.name)}` : '/my-tasks') }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, res.data, debounced, me.role]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { body.current?.querySelector('.kb')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
  }

  let group = '';
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-label="Search">
        <div className="cmdk-in"><Search size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search tasks, projects, people…" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="cmdk-list" />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk-body" ref={body} id="cmdk-list" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== group ? <div className="pop-label" key={`h${i}`}>{it.group}</div> : null;
            group = it.group;
            return [head,
              <button key={i} className={`pop-item ${i === sel ? 'kb' : ''}`} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={it.run}>
                <span style={{ width: 26, display: 'grid', placeItems: 'center', color: 'var(--fg-2)' }}>{it.icon}</span>
                <span className="grow">{it.label}</span>{it.sub && <small>{it.sub}</small>}
              </button>];
          })}
          {q && debounced && res.data && items.filter((i) => i.group !== 'Commands').length === 0 && (
            <div className="pop-item muted" style={{ justifyContent: 'center' }}><UserRound size={15} /> Nothing found for “{q}”</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
