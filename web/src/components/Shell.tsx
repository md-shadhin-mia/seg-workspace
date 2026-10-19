import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, Building2, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Gauge, Inbox, LayoutDashboard, ListChecks, LogOut,
  Menu as MenuIcon, Plus, Search, Settings, ShieldCheck, Sparkles, UserRound, UsersRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { isAnyLead, useAuth, useMe } from '../lib/auth';
import type { Team } from '../lib/types';
import { Avatar, Menu, Modal, useAnchor } from './ui';
import { CommandPalette, type PaletteMode } from './CommandPalette';
import { useAiEnabled } from './Ai';
import { NewTaskModal } from './NewTaskModal';
import { NewProjectModal } from './NewProjectModal';

interface ShellApi { newTask: (projectId?: string) => void; newProject: (teamId?: string) => void; openSearch: () => void }
const ShellCtx = createContext<ShellApi>({ newTask: () => {}, newProject: () => {}, openSearch: () => {} });
export const useShell = () => useContext(ShellCtx);

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const { data, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('seg.nav') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState<PaletteMode | null>(null);
  const aiEnabled = useAiEnabled();
  const [newTask, setNewTask] = useState<{ projectId?: string } | null>(null);
  const [newProject, setNewProject] = useState<{ teamId?: string } | null>(null);
  const [help, setHelp] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const meMenu = useAnchor();
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => api.get<Team[]>('/teams') });

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);
  useEffect(() => {
    try { localStorage.setItem('seg.nav', collapsed ? 'collapsed' : 'open'); } catch {}
  }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'f') && !e.shiftKey) { e.preventDefault(); setSearch((s) => (s ? null : 'search')); }
      else if (!typing && e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector('.overlay')) { e.preventDefault(); setNewTask({}); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const api_: ShellApi = {
    newTask: useCallback((projectId?: string) => setNewTask({ projectId }), []),
    newProject: useCallback((teamId?: string) => setNewProject({ teamId }), []),
    openSearch: useCallback(() => setSearch('search'), []),
  };
  const lead = isAnyLead(me);
  const item = (to: string, icon: ReactNode, label: string, badge?: number, end?: boolean) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={label}>
      {icon}<span className="lbl">{label}</span>{!!badge && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
    </NavLink>
  );

  return (
    <ShellCtx.Provider value={api_}>
      <div className={`app ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'nav-open' : ''}`}>
        <aside className="sidebar" aria-label="Main navigation">
          <Link to="/" className="brand"><span className="logo">S</span><span className="name">SEG Workspace</span></Link>
          <button className="collapse-btn" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
          </button>
          <nav className="nav-scroll">
            <div className="nav-group-h first"><span className="label">Workspace</span></div>
            {item('/', <LayoutDashboard size={18} />, 'Dashboard', 0, true)}
            {item('/my-tasks', <ListChecks size={18} />, 'My Tasks')}
            {item('/inbox', <Inbox size={18} />, 'Inbox', data?.unread)}
            <div className="nav-group">
              <div className="nav-group-h"><span className="label">Insights</span></div>
              {lead && item('/analytics', <ChartNoAxesCombined size={18} />, 'Analytics')}
              {item(`/people/${me.id}`, <Gauge size={18} />, 'My performance')}
            </div>
            <div className="nav-group">
              <div className="nav-group-h">
                <span className="label">Teams</span>
                {lead && <button onClick={() => setNewProject({ teamId: /^\/teams\/([\w-]+)/.exec(loc.pathname)?.[1] })} aria-label="Create a project" title="Create a project"><Plus size={14} /></button>}
              </div>
              {teams.data?.map((t) => {
                const expanded = open[t.id] ?? true;
                return (
                  <div key={t.id}>
                    <div style={{ position: 'relative' }}>
                      {item(`/teams/${t.id}`, <UsersRound size={18} />, t.name)}
                      {!collapsed && t.projects.length > 0 && (
                        <button className="icon-btn" style={{ position: 'absolute', right: 2, top: 2, width: 32, height: 32 }} aria-label={expanded ? `Collapse ${t.name}` : `Expand ${t.name}`}
                          onClick={() => setOpen((o) => ({ ...o, [t.id]: !expanded }))}>
                          <ChevronDown size={15} style={{ transform: expanded ? undefined : 'rotate(-90deg)', transition: 'transform .15s' }} />
                        </button>
                      )}
                    </div>
                    {expanded && t.projects.map((p) => (
                      <NavLink key={p.id} to={`/projects/${p.id}`} className={({ isActive }) => `nav-item nav-sub ${isActive ? 'active' : ''}`}>
                        <span className="lbl">{p.name}</span>
                      </NavLink>
                    ))}
                  </div>
                );
              })}
              {teams.data?.length === 0 && !collapsed && <p className="muted" style={{ fontSize: 12.5, padding: '4px 10px' }}>You haven't been added to a team yet. Ask an admin.</p>}
            </div>
            {me.role === 'admin' && (
              <div className="nav-group">
                <div className="nav-group-h"><span className="label">Admin</span></div>
                {item('/admin/users', <ShieldCheck size={18} />, 'Users', data?.pendingUsers)}
                {item('/admin/teams', <Building2 size={18} />, 'Teams & access')}
              </div>
            )}
          </nav>
          <div className="sidebar-foot">
            {item('/settings', <Settings size={18} />, 'Settings')}
            <button className="nav-item" onClick={() => setHelp(true)} title="Help & Support"><CircleHelp size={18} /><span className="lbl">Help & Support</span></button>
          </div>
        </aside>
        <div className="scrim" onClick={() => setMobileOpen(false)} />

        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-toggle" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><MenuIcon size={20} /></button>
            <button className="search-pill" onClick={() => setSearch('search')}><Search size={16} /><span>Search or type a command</span><kbd>⌘ K</kbd></button>
            {aiEnabled && <button className="icon-btn" onClick={() => setSearch('ai')} aria-label="Ask AI" title="Ask AI about your work"><Sparkles size={18} /></button>}
            <span className="spacer" />
            <button className="btn primary hide-sm" onClick={() => setNewTask({})} title="New task (C)"><Plus size={16} />New task</button>
            <button className="icon-btn" onClick={() => nav('/inbox')} aria-label={`Inbox${data?.unread ? `, ${data.unread} unread` : ''}`}>
              <Bell size={19} />{!!data?.unread && <span className="dot" />}
            </button>
            <span className="top-divider hide-sm" />
            <button className="me-btn" onClick={meMenu.open} aria-label="Account menu"><Avatar name={me.name} size={34} /><ChevronDown size={15} className="hide-sm" /></button>
          </header>
          <div className="content" id="content">{children}</div>
        </div>

        <nav className="bottom-nav" aria-label="Quick navigation">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}><LayoutDashboard size={20} />Home</NavLink>
          <NavLink to="/my-tasks" className={({ isActive }) => (isActive ? 'active' : '')}><ListChecks size={20} />My Tasks</NavLink>
          <button onClick={() => setNewTask({})}><Plus size={20} />New</button>
          <NavLink to="/inbox" className={({ isActive }) => (isActive ? 'active' : '')}><Inbox size={20} />Inbox{!!data?.unread && <span className="badge">{data.unread}</span>}</NavLink>
        </nav>
      </div>

      {meMenu.anchor && (
        <Menu anchor={meMenu.anchor} onClose={meMenu.close} onPick={async (k) => {
          if (k === 'settings') nav('/settings');
          if (k === 'out') { await signOut(); nav('/login'); }
        }} items={[
          { key: 'who', heading: me.email },
          { key: 'settings', label: 'Profile & security', icon: <UserRound size={16} /> },
          { key: 'sep', sep: true, label: '' },
          { key: 'out', label: 'Sign out', icon: <LogOut size={16} /> },
        ]} />
      )}
      {search && <CommandPalette initialMode={search} onClose={() => setSearch(null)} onNewTask={() => { setSearch(null); setNewTask({}); }} />}
      {newTask && <NewTaskModal projectId={newTask.projectId} onClose={() => setNewTask(null)} />}
      {newProject && <NewProjectModal teamId={newProject.teamId} onClose={() => setNewProject(null)} />}
      {help && (
        <Modal title="Help & Support" onClose={() => setHelp(false)}>
          <div className="form" style={{ gap: 10 }}>
            {[['⌘ K', 'Search tasks, projects and people, or run a command'], ['C', 'Create a task'], ['Esc', 'Close a dialog or menu']].map(([k, v]) => (
              <div className="row" key={k}><kbd style={{ minWidth: 46, textAlign: 'center' }}>{k}</kbd><span>{v}</span></div>
            ))}
            <div className="notice info" style={{ marginTop: 6 }}>Need access to a team or project? Ask your team lead or an admin. Admins manage people under Admin → Users.</div>
          </div>
        </Modal>
      )}
    </ShellCtx.Provider>
  );
}
