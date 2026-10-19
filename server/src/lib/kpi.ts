/**
 * KPI calculations. Pure functions over assignment and review rows, so the rules are easy to read
 * and test. Dates are YYYY-MM-DD strings in the app's time zone (compared as strings).
 *
 * One "assignment" is one person on one task. Definitions, for a period [from, to]:
 * - active:          assigned on or before `to`, and not finished before `from` (it was on their plate)
 * - completed:       finished (their status became Done) within the period
 * - completion rate: completed / active
 * - on-time rate:    of completed assignments that had a due date, the share finished on or before it
 * - approval rate:   of their submissions reviewed in the period, the share approved
 * - open / overdue:  still unfinished at the end of the period / of those, past their due date
 */

export interface KpiSettings {
  weights: { completion: number; onTime: number; approval: number; backlog: number };
  targets: { completion: number; onTime: number; approval: number; weeklyCompleted: number };
  /** Minimum active assignments before a score is shown. */
  minSample: number;
}

export const DEFAULT_KPI_SETTINGS: KpiSettings = {
  weights: { completion: 35, onTime: 35, approval: 20, backlog: 10 },
  targets: { completion: 80, onTime: 85, approval: 75, weeklyCompleted: 5 },
  minSample: 3,
};

export type Status = 'todo' | 'in_progress' | 'review' | 'changes' | 'done';

export interface AssignmentRow {
  taskId: string;
  userId: string;
  teamId: string;
  projectId: string;
  status: Status;
  assignedOn: string;
  doneOn: string | null;
  dueDate: string | null;
}
export interface ReviewRow { userId: string; teamId: string; projectId: string; approved: boolean; reviewedOn: string }

export interface ScorePart { key: keyof KpiSettings['weights']; label: string; value: number; weight: number }
export interface Metrics {
  active: number;
  assigned: number;
  completed: number;
  completedWithDue: number;
  onTime: number;
  late: number;
  reviewed: number;
  approved: number;
  open: number;
  overdue: number;
  completionRate: number | null;
  onTimeRate: number | null;
  approvalRate: number | null;
  /** Open work that is not overdue, as a percentage. */
  backlogHealth: number | null;
  score: number | null;
  scoreParts: ScorePart[];
  enoughData: boolean;
  workload: Record<Exclude<Status, 'done'>, number>;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 864e5);
}

/** The period of the same length that ends the day before `from`. */
export function previousPeriod(from: string, to: string) {
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

export function computeMetrics(rows: AssignmentRow[], reviews: ReviewRow[], from: string, to: string, settings: KpiSettings): Metrics {
  let active = 0, assigned = 0, completed = 0, completedWithDue = 0, onTime = 0, open = 0, overdue = 0;
  const workload = { todo: 0, in_progress: 0, review: 0, changes: 0 };
  for (const r of rows) {
    if (r.assignedOn > to) continue;
    const finishedBy = r.doneOn !== null && r.doneOn <= to;
    if (r.doneOn === null || r.doneOn >= from) active++;
    if (r.assignedOn >= from) assigned++;
    if (r.doneOn !== null && r.doneOn >= from && r.doneOn <= to) {
      completed++;
      if (r.dueDate) { completedWithDue++; if (r.doneOn <= r.dueDate) onTime++; }
    }
    if (!finishedBy) {
      open++;
      if (r.dueDate && r.dueDate < to) overdue++;
      // Current status only describes the end of the period when nothing has finished since.
      if (r.status !== 'done') workload[r.status]++;
    }
  }
  let reviewed = 0, approved = 0;
  for (const v of reviews) {
    if (v.reviewedOn < from || v.reviewedOn > to) continue;
    reviewed++;
    if (v.approved) approved++;
  }
  const completionRate = pct(completed, active);
  const onTimeRate = pct(onTime, completedWithDue);
  const approvalRate = pct(approved, reviewed);
  const backlogHealth = open > 0 ? pct(open - overdue, open) : active > 0 ? 100 : null;
  const enoughData = active >= settings.minSample;
  const candidates: [ScorePart['key'], string, number | null][] = [
    ['completion', 'Completion', completionRate],
    ['onTime', 'On time', onTimeRate],
    ['approval', 'Approved on review', approvalRate],
    ['backlog', 'Nothing overdue', backlogHealth],
  ];
  const scoreParts: ScorePart[] = candidates
    .filter(([k, , v]) => v !== null && settings.weights[k] > 0)
    .map(([key, label, value]) => ({ key, label, value: value!, weight: settings.weights[key] }));
  const totalWeight = scoreParts.reduce((s, p) => s + p.weight, 0);
  const score = enoughData && totalWeight > 0
    ? Math.round(scoreParts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight)
    : null;
  return {
    active, assigned, completed, completedWithDue, onTime, late: completedWithDue - onTime, reviewed, approved, open, overdue,
    completionRate, onTimeRate, approvalRate, backlogHealth, score, scoreParts, enoughData, workload,
  };
}

export type BucketSize = 'day' | 'week' | 'month';
export interface Bucket { start: string; end: string; completed: number; assigned: number; onTime: number; late: number }

export function bucketSize(from: string, to: string): BucketSize {
  const span = daysBetween(from, to) + 1;
  // Daily points get noisy beyond three weeks; weekly is the clearer view up to about half a year.
  return span <= 21 ? 'day' : span <= 190 ? 'week' : 'month';
}

/**
 * Splits [from, to] into days, 7-day windows or calendar months, clipped to the range. Weeks end on `to`,
 * so the latest week is always complete; a leftover of three days or fewer joins the first window rather
 * than showing as a misleadingly small bucket.
 */
export function buckets(from: string, to: string, size = bucketSize(from, to)): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  if (size === 'week') {
    for (let end = to; end >= from; ) {
      const start = addDays(end, -6) < from ? from : addDays(end, -6);
      out.unshift({ start, end });
      end = addDays(start, -1);
    }
    if (out.length > 1 && daysBetween(out[0].start, out[0].end) + 1 <= 3) out.splice(0, 2, { start: out[0].start, end: out[1].end });
    return out;
  }
  let start = from;
  while (start <= to) {
    let end: string;
    if (size === 'day') end = start;
    else {
      const [y, m] = start.split('-').map(Number);
      end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    }
    if (end > to) end = to;
    out.push({ start, end });
    start = addDays(end, 1);
  }
  return out;
}

export function trend(rows: AssignmentRow[], from: string, to: string, size?: BucketSize): Bucket[] {
  const bs = buckets(from, to, size).map((b) => ({ ...b, completed: 0, assigned: 0, onTime: 0, late: 0 }));
  const find = (d: string) => {
    // Buckets are sorted and contiguous; a binary search keeps this fast for long ranges.
    let lo = 0, hi = bs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (d < bs[mid].start) hi = mid - 1; else if (d > bs[mid].end) lo = mid + 1; else return bs[mid];
    }
    return null;
  };
  for (const r of rows) {
    const a = r.assignedOn >= from && r.assignedOn <= to ? find(r.assignedOn) : null;
    if (a) a.assigned++;
    const c = r.doneOn && r.doneOn >= from && r.doneOn <= to ? find(r.doneOn) : null;
    if (c) {
      c.completed++;
      if (r.dueDate) { if (r.doneOn! <= r.dueDate) c.onTime++; else c.late++; }
    }
  }
  return bs;
}

/** Validates admin input and fills gaps from the defaults. */
export function normalizeSettings(input: unknown): KpiSettings {
  const s = (input ?? {}) as Partial<KpiSettings>;
  const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d);
  const w = s.weights ?? ({} as KpiSettings['weights']);
  const t = s.targets ?? ({} as KpiSettings['targets']);
  const D = DEFAULT_KPI_SETTINGS;
  return {
    weights: {
      completion: num(w.completion, D.weights.completion, 0, 100),
      onTime: num(w.onTime, D.weights.onTime, 0, 100),
      approval: num(w.approval, D.weights.approval, 0, 100),
      backlog: num(w.backlog, D.weights.backlog, 0, 100),
    },
    targets: {
      completion: num(t.completion, D.targets.completion, 1, 100),
      onTime: num(t.onTime, D.targets.onTime, 1, 100),
      approval: num(t.approval, D.targets.approval, 1, 100),
      weeklyCompleted: num(t.weeklyCompleted, D.targets.weeklyCompleted, 1, 200),
    },
    minSample: num(s.minSample, D.minSample, 1, 100),
  };
}
