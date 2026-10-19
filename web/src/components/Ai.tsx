import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Sparkles, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { plural } from '../lib/format';

/** AI controls are hidden everywhere unless the server has an OpenRouter key. */
export const useAiEnabled = () => useAuth().data?.aiEnabled ?? false;

export function AiSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-busy="true" aria-label="Waiting for AI" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skel" style={{ width: `${92 - i * 14}%` }} />)}
    </div>
  );
}

/**
 * Result of an AI action, shown in a light panel. Text results can be put into an editor with
 * `onUseText`; checklist-style results are ticked and added with `onUseItems`. Without either it is read-only.
 */
export function AiPanel({ title, loading, text, items, onUseText, onUseItems, useLabel = 'Use this', busy, onClose, children }: {
  title: string;
  loading?: boolean;
  text?: string;
  items?: string[];
  onUseText?: (text: string) => void;
  onUseItems?: (items: string[]) => void;
  useLabel?: string;
  busy?: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [off, setOff] = useState<Set<number>>(new Set());
  const picked = items?.filter((_, i) => !off.has(i)) ?? [];
  const canUse = !loading && (onUseText ? !!text : onUseItems ? picked.length > 0 : false);
  return (
    <section className="ai-panel" aria-label={title} aria-live="polite">
      <div className="ai-panel-h">
        <Sparkles size={14} aria-hidden="true" /><span className="grow">{title}</span>
        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={onClose} aria-label="Close AI result"><X size={14} /></button>
      </div>
      {loading ? <AiSkeleton /> : (
        <>
          {text !== undefined && (children ?? <div className="ai-text">{text}</div>)}
          {items && (items.length === 0
            ? <p className="muted" style={{ fontSize: 13.5 }}>Nothing new to add. The checklist already covers it.</p>
            : <div>{items.map((it, i) => {
              const on = !off.has(i);
              return (
                <label key={i} className="check-row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => setOff((s) => { const n = new Set(s); if (on) n.add(i); else n.delete(i); return n; })} />
                  <span className={`cbox ${on ? 'on' : ''}`} aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
                  <span className="txt">{it}</span>
                </label>
              );
            })}</div>)}
          {(onUseText || onUseItems) && (
            <div className="row end" style={{ marginTop: 10 }}>
              <button className="btn ghost sm" onClick={onClose}>Discard</button>
              <button className="btn primary sm" disabled={!canUse || busy}
                onClick={() => (onUseText ? onUseText(text ?? '') : onUseItems?.(picked))}>
                {onUseItems ? `Add ${plural(picked.length, 'item')}` : useLabel}
              </button>
            </div>
          )}
          <p className="ai-note">AI can get things wrong. Check it before you use it.</p>
        </>
      )}
    </section>
  );
}

/** Renders an AI answer as plain text, turning "#123" into links to tasks the server says this person can see. */
export function AiAnswer({ text, refs, onNavigate }: { text: string; refs: Record<string, string>; onNavigate?: () => void }) {
  return (
    <div className="ai-text">
      {text.split(/(#\d+)/g).map((part, i) => {
        const id = /^#\d+$/.test(part) ? refs[part.slice(1)] : undefined;
        return id ? <Link key={i} to={`/tasks/${id}`} className="text-link" onClick={onNavigate}>{part}</Link> : part;
      })}
    </div>
  );
}
