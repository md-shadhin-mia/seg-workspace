import { useSearchParams } from 'react-router-dom';
import type { Priority, Status } from './types';
import { todayISO } from './format';

export type View = 'personal' | 'team' | 'org';

export interface KpiSettings {
  weights: { completion: number; onTime: number; approval: number; backlog: number };
  targets: { completion: number; onTime: number; approval: number; weeklyCompleted: number };
  minSample: number;
}
export interface Metrics {
  active: number; assigned: number; completed: number; completedWithDue: number; onTime: number; late: number;
  reviewed: number; approved: number; open: number; overdue: number;
  completionRate: number | null; onTimeRate: number | null; approvalRate: number | null; backlogHealth: number | null;
  score: number | null; scoreParts: { key: keyof KpiSettings['weights']; label: string; value: number; weight: number }[];
  enoughData: boolean;
  workload: Record<'todo' | 'in_progress' | 'review' | 'changes', number>;
}
export interface Range { today: string; from: string; to: string; prevFrom: string; prevTo: string; bucket: 'day' | 'week' | 'month' }
export interface Bucket { start: string; end: string; completed: number; assigned: number; onTime: number; late: number }
export interface DeadlineTask {
  id: string; seq: number; title: string; priority: Priority; dueDate: string; status: Status; myStatus: Status;
  projectId: string; projectName: string; assignees: { userId: string; name: string; status: Status }[];
}
export interface Contribution { id: string; name: string; teamName: string; active: number; completed: number; open: number; overdue: number; onTimeRate: number | null }
export interface ActivityFeed { items: { id: number; action: string; meta: any; createdAt: string; actorId: string | null; actorName: string | null; taskId: string; taskTitle: string }[]; names: Record<string, string> }

export interface Overview {
  view: View; views: View[]; range: Range; settings: KpiSettings;
  summary: Metrics; previous: Metrics; trend: Bucket[];
  deadlines: DeadlineTask[]; calendar: { date: string; count: number }[]; activity: ActivityFeed;
  filters: { teams: { id: string; name: string; department: string }[]; departments: string[]; projects: { id: string; name: string; teamId: string }[]; people: { id: string; name: string; title: string }[] };
  contributions: Contribution[];
  people: { id: string; name: string; title: string; teamNames: string[]; metrics: Metrics; previousScore: number | null; spark: number[] }[];
  teams: { id: string; name: string; department: string; members: number; metrics: Metrics; previousScore: number | null; trend: number[] }[];
  projects: { id: string; name: string; status: string; dueDate: string | null; teamId: string; teamName: string; total: number; done: number; inProgress: number; review: number; changes: number; todo: number; overdue: number; doneInPeriod: number }[];
}

export interface PersonAnalytics {
  person: { id: string; name: string; title: string; active: boolean; teams: { teamId: string; name: string; role: 'lead' | 'member' }[] };
  scopeTeams: string[] | null; range: Range; settings: KpiSettings;
  summary: Metrics; previous: Metrics; trend: Bucket[]; contributions: Contribution[]; deadlines: DeadlineTask[];
  recent: { id: string; seq: number; title: string; dueDate: string | null; doneAt: string; doneOn: string; projectName: string }[];
}

export interface ProjectAnalytics {
  project: { id: string; name: string; dueDate: string | null; status: string; createdOn: string };
  canManage: boolean; range: Range;
  totals: { total: number; done: number; inProgress: number; review: number; changes: number; todo: number; overdue: number; late: number; noDueDate: number; pct: number };
  progress: { start: string; end: string; total: number; done: number }[];
  members: { id: string; name: string; title: string; assigned: number; done: number; open: number; overdue: number; onTimeRate: number | null }[];
  timeline: { id: string; seq: number; title: string; status: Status; priority: Priority; dueDate: string; completedOn: string | null; assignees: { userId: string; name: string; status: Status }[] }[];
  delayed: { id: string; seq: number; title: string; status: Status; dueDate: string; completedOn: string | null; assignees: { userId: string; name: string; status: Status }[] }[];
}

/* ---------- date ranges, kept in the URL so views can be shared ---------- */
export const PRESETS = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['qtd', 'Quarter'], ['ytd', 'Year']] as const;
export type Preset = (typeof PRESETS)[number][0] | 'custom';

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + n));
}
export function presetRange(p: Preset, now = new Date()): { from: string; to: string } {
  const to = todayISO(now);
  if (p === '7d') return { from: addDays(to, -6), to };
  if (p === '90d') return { from: addDays(to, -89), to };
  if (p === 'qtd') return { from: todayISO(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to };
  if (p === 'ytd') return { from: todayISO(new Date(now.getFullYear(), 0, 1)), to };
  return { from: addDays(to, -29), to };
}

export function useRange() {
  const [params, setParams] = useSearchParams();
  const preset = (params.get('range') as Preset) || '30d';
  const r = preset === 'custom' && params.get('from') && params.get('to')
    ? { from: params.get('from')!, to: params.get('to')! }
    : presetRange(preset === 'custom' ? '30d' : preset);
  const set = (p: Preset, custom?: { from: string; to: string }) => {
    setParams((x) => {
      const n = new URLSearchParams(x);
      n.set('range', p);
      if (p === 'custom' && custom) { n.set('from', custom.from); n.set('to', custom.to); } else { n.delete('from'); n.delete('to'); }
      return n;
    }, { replace: true });
  };
  return { preset, ...r, set };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso: string) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MON[m - 1]} ${d}`;
}
export function bucketLabel(b: { start: string; end: string }, size: Range['bucket']) {
  if (size === 'month') return MON[Number(b.start.slice(5, 7)) - 1];
  return shortDate(b.start);
}
export function bucketTitle(b: { start: string; end: string }, size: Range['bucket']) {
  if (size === 'day') return shortDate(b.start);
  return `${shortDate(b.start)} – ${shortDate(b.end)}`;
}
export function rangeLabel(r: { from: string; to: string }) {
  return `${shortDate(r.from)} – ${shortDate(r.to)}${r.from.slice(0, 4) !== r.to.slice(0, 4) ? `, ${r.to.slice(0, 4)}` : ''}`;
}

export const pctText = (v: number | null) => (v === null ? '–' : `${Math.round(v)}%`);

/** Score tone: what colour a 0–100 value earns against its target. */
export function tone(v: number | null, target = 75): 'green' | 'amber' | 'red' | 'grey' {
  if (v === null) return 'grey';
  if (v >= target) return 'green';
  if (v >= target * 0.75) return 'amber';
  return 'red';
}

export const WORKLOAD_KEYS = [
  { key: 'todo', label: 'To do', color: 'var(--grey-solid)' },
  { key: 'in_progress', label: 'In progress', color: 'var(--blue-solid)' },
  { key: 'review', label: 'In review', color: 'var(--violet-solid)' },
  { key: 'changes', label: 'Changes requested', color: 'var(--red-solid)' },
] as const;
