import type { Priority, Status } from './types';

export const STATUS: Record<Status, string> = {
  todo: 'To Do', in_progress: 'In Progress', review: 'Ready for Review', changes: 'Changes Requested', done: 'Done',
};
export const STATUS_ORDER: Status[] = ['todo', 'in_progress', 'review', 'changes', 'done'];
export const PRIORITY: Record<Priority, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
export const PROJECT_STATUS: Record<string, [string, string]> = {
  on_track: ['On track', 'green'], at_risk: ['At risk', 'amber'], off_track: ['Off track', 'red'], completed: ['Completed', 'lime'],
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dayDiff(iso: string, now = new Date()) {
  const [y, m, d] = iso.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 864e5);
}
export function dueLabel(iso: string | null, now = new Date()) {
  if (!iso) return 'No date';
  const n = dayDiff(iso, now);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MON[m - 1]} ${d}${y !== now.getFullYear() ? `, ${y}` : ''}`;
}
export function dueClass(iso: string | null, done: boolean, now = new Date()) {
  if (!iso || done) return '';
  const n = dayDiff(iso, now);
  return n < 0 ? 'over' : n === 0 ? 'today' : '';
}
export function ago(ts: string | number | Date, now = Date.now()) {
  const t = new Date(ts).getTime();
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  const dt = new Date(t);
  return `${MON[dt.getMonth()]} ${dt.getDate()}${dt.getFullYear() !== new Date(now).getFullYear() ? `, ${dt.getFullYear()}` : ''}`;
}
export function stamp(ts: string) {
  const d = new Date(ts);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${MON[d.getMonth()]} ${d.getDate()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}
export const fileSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
export const firstName = (n: string) => n.split(' ')[0];
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('');
export function hue(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
export const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
export function greeting(d = new Date()) { const h = d.getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
export function linkKind(url: string): 'figma' | 'drive' | 'github' | 'web' {
  const u = url.toLowerCase();
  if (u.includes('figma.com')) return 'figma';
  if (u.includes('drive.google') || u.includes('docs.google')) return 'drive';
  if (u.includes('github.com')) return 'github';
  return 'web';
}
