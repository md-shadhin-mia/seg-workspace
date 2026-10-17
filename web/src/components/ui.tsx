import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Eye, EyeOff, Search, X } from 'lucide-react';
import { PRIORITY, STATUS, hue, initials } from '../lib/format';
import type { Priority, Status } from '../lib/types';

/* ---------- avatar ---------- */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const h = hue(name);
  return (
    <span className="avatar" title={name} aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `hsl(${h} 30% 90%)`, color: `hsl(${h} 35% 28%)` }}>
      {initials(name)}
    </span>
  );
}
export function AvatarStack({ names, size = 24, max = 4 }: { names: string[]; size?: number; max?: number }) {
  const shown = names.slice(0, max);
  return (
    <span className="avatars" aria-label={names.join(', ')}>
      {shown.map((n, i) => <Avatar key={i} name={n} size={size} />)}
      {names.length > max && <span className="avatar" style={{ width: size, height: size, fontSize: 11, background: 'var(--muted)', color: 'var(--fg-2)' }}>+{names.length - max}</span>}
    </span>
  );
}

/* ---------- status & priority ---------- */
export function StatusPill({ status, onClick, label }: { status: Status; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; label?: string }) {
  const body = <><span className="d" />{label ?? STATUS[status]}</>;
  return onClick
    ? <button type="button" className={`pill st-${status}`} onClick={onClick} aria-label={`Status: ${STATUS[status]}. Change`}>{body}</button>
    : <span className={`pill st-${status}`}>{body}</span>;
}
export function PriorityTag({ p, compact }: { p: Priority; compact?: boolean }) {
  const bars = { urgent: 3, high: 3, medium: 2, low: 1 }[p];
  return (
    <span className={`pr-${p}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }} title={`${PRIORITY[p]} priority`}>
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
        {[[2, 9, 5], [6.5, 6, 8], [11, 3, 11]].map(([x, y, h], i) => (
          <rect key={i} x={x} y={y} width="3" height={h} rx="1" fill="currentColor" opacity={i < bars ? 1 : 0.22} />
        ))}
      </svg>
      {!compact && <span style={{ color: p === 'urgent' || p === 'high' ? undefined : 'var(--fg-2)' }}>{PRIORITY[p]}</span>}
    </span>
  );
}

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; kind?: 'error'; action?: [string, () => void] };
const ToastCtx = createContext<(text: string, opts?: { kind?: 'error'; action?: [string, () => void] }) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, opts: { kind?: 'error'; action?: [string, () => void] } = {}) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, ...opts }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), opts.kind === 'error' ? 5000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind ?? ''}`}>
            {t.kind !== 'error' && <Check size={15} />}
            <span>{t.text}</span>
            {t.action && <button onClick={() => { t.action![1](); setItems((x) => x.filter((y) => y.id !== t.id)); }}>{t.action[0]}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button.primary');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-h"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ title, body, confirm, danger, onConfirm, onClose }: { title: string; body: ReactNode; confirm: string; danger?: boolean; onConfirm: () => Promise<unknown> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'primary' : 'primary'}`} disabled={busy} style={danger ? { background: 'var(--red)', borderColor: 'var(--red)' } : undefined}
        onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirm}</button>
    </>}>
      <div className="muted-2">{body}</div>
    </Modal>
  );
}

/* ---------- popover menu ---------- */
export interface MenuItem { key: string; label?: ReactNode; icon?: ReactNode; hint?: ReactNode; active?: boolean; disabled?: boolean; sep?: boolean; heading?: string }

export function Popover({ anchor, onClose, children, width }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current!;
    const w = el.offsetWidth, h = el.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ left: Math.max(8, Math.min(r.left, innerWidth - w - 8)), top });
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); anchor.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('.pop-item:not(:disabled)') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);
  return createPortal(
    <div className="popover" ref={ref} role="menu" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }}>{children}</div>,
    document.body,
  );
}

export function Menu({ anchor, items, onPick, onClose }: { anchor: HTMLElement; items: MenuItem[]; onPick: (key: string) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { first.current?.focus(); }, []);
  let assigned = false;
  return (
    <Popover anchor={anchor} onClose={onClose}>
      {items.map((it, i) => {
        if (it.sep) return <div key={i} className="pop-sep" />;
        if (it.heading) return <div key={i} className="pop-label">{it.heading}</div>;
        const refProp = !assigned && !it.disabled ? (assigned = true, { ref: first }) : {};
        return (
          <button key={it.key} {...refProp} className="pop-item" role="menuitem" disabled={it.disabled} onClick={() => { onClose(); onPick(it.key); }}>
            {it.icon}<span className="grow">{it.label}</span>{it.hint && <small>{it.hint}</small>}{it.active && <Check size={15} />}
          </button>
        );
      })}
    </Popover>
  );
}

/** Small hook for "click a button, show a menu next to it". */
export function useAnchor() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return { anchor, open: (e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget), close: useCallback(() => setAnchor(null), []) };
}

export function StatusMenu({ anchor, current, onPick, onClose, allowChanges = true }: { anchor: HTMLElement; current: Status; onPick: (s: Status) => void; onClose: () => void; allowChanges?: boolean }) {
  const items: MenuItem[] = (['todo', 'in_progress', 'review', 'changes', 'done'] as Status[]).map((s) => ({
    key: s, label: STATUS[s], active: s === current, disabled: s === 'changes' && !allowChanges,
    icon: <span className={`pill st-${s}`} style={{ width: 10, height: 10, padding: 0, borderRadius: 3 }} />,
  }));
  return <Menu anchor={anchor} items={items} onPick={(k) => onPick(k as Status)} onClose={onClose} />;
}

/* ---------- people picker (multi-select) ---------- */
export interface PickPerson { id: string; name: string; title?: string; group?: string }
export function PeoplePicker({ anchor, people, selected, onChange, onClose, single }: {
  anchor: HTMLElement; people: PickPerson[]; selected: string[]; onChange: (ids: string[]) => void; onClose: () => void; single?: boolean;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people.filter((p) => !s || p.name.toLowerCase().includes(s) || (p.title ?? '').toLowerCase().includes(s));
  }, [people, q]);
  let lastGroup: string | undefined;
  return (
    <Popover anchor={anchor} onClose={onClose} width={280}>
      <div style={{ position: 'relative' }}>
        <input className="pop-search" autoFocus placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <Search size={14} style={{ position: 'absolute', right: 10, top: 10, color: 'var(--fg-3)' }} />
      </div>
      {list.length === 0 && <div className="pop-item muted">No one matches</div>}
      {list.map((p) => {
        const on = selected.includes(p.id);
        const head = p.group && p.group !== lastGroup ? <div className="pop-label" key={`g-${p.group}`}>{p.group}</div> : null;
        lastGroup = p.group;
        return [head,
          <button key={p.id} className="pop-item" role="menuitemcheckbox" aria-checked={on}
            onClick={() => { if (single) { onChange(on ? [] : [p.id]); onClose(); } else onChange(on ? selected.filter((x) => x !== p.id) : [...selected, p.id]); }}>
            <Avatar name={p.name} size={24} />
            <span className="grow">{p.name}{p.title && <small style={{ display: 'block' }}>{p.title}</small>}</span>
            {on && <Check size={15} />}
          </button>];
      })}
    </Popover>
  );
}

/* ---------- misc ---------- */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}
export function PageLoading() {
  return (
    <div className="page" aria-busy="true">
      <div className="skel" style={{ width: 220, height: 26 }} />
      <div className="skel" style={{ width: 360, marginTop: 12 }} />
      <div className="skel" style={{ height: 88, marginTop: 28, borderRadius: 12 }} />
      {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 44, marginTop: 10 }} />)}
    </div>
  );
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <span>{children}</span>}{action}</div>;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="page">
      <div className="notice err">{(error as Error)?.message ?? 'Something went wrong.'}{retry && <button className="text-link" onClick={retry}>Try again</button>}</div>
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, invalid, placeholder }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} aria-invalid={invalid} placeholder={placeholder} required />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
  );
}
export function strength(pw: string) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
export function Meter({ pw }: { pw: string }) {
  const s = strength(pw);
  return <div className="meter" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} className={i < s ? 'on' : ''} />)}</div>;
}
