import { describe, expect, it } from 'vitest';
import { DEFAULT_KPI_SETTINGS, buckets, computeMetrics, normalizeSettings, previousPeriod, trend, type AssignmentRow } from '../src/lib/kpi.js';

const row = (o: Partial<AssignmentRow>): AssignmentRow => ({
  taskId: 't', userId: 'u', teamId: 'team', projectId: 'p', status: 'todo', assignedOn: '2026-10-01', doneOn: null, dueDate: null, ...o,
});
const S = DEFAULT_KPI_SETTINGS;

describe('computeMetrics', () => {
  const rows = [
    row({ status: 'done', doneOn: '2026-10-05', dueDate: '2026-10-06' }),  // on time
    row({ status: 'done', doneOn: '2026-10-10', dueDate: '2026-10-08' }),  // late
    row({ status: 'done', doneOn: '2026-10-12' }),                        // no due date
    row({ status: 'in_progress', dueDate: '2026-10-09' }),                // overdue at period end
    row({ status: 'review', assignedOn: '2026-10-14', dueDate: '2026-11-01' }),
    row({ status: 'done', assignedOn: '2026-09-01', doneOn: '2026-09-20' }), // finished before the period
    row({ status: 'todo', assignedOn: '2026-10-20' }),                    // assigned after the period
  ];
  const m = computeMetrics(rows, [
    { userId: 'u', teamId: 'team', projectId: 'p', approved: true, reviewedOn: '2026-10-05' },
    { userId: 'u', teamId: 'team', projectId: 'p', approved: false, reviewedOn: '2026-10-07' },
    { userId: 'u', teamId: 'team', projectId: 'p', approved: true, reviewedOn: '2026-09-07' },
  ], '2026-10-01', '2026-10-15', S);

  it('counts what was on someone’s plate and what they finished', () => {
    expect(m.active).toBe(5);
    expect(m.assigned).toBe(5);
    expect(m.completed).toBe(3);
    expect(m.completionRate).toBe(60);
  });
  it('measures on-time delivery only where there was a due date', () => {
    expect(m.completedWithDue).toBe(2);
    expect(m.onTime).toBe(1);
    expect(m.late).toBe(1);
    expect(m.onTimeRate).toBe(50);
  });
  it('uses reviews inside the period for the approval rate', () => {
    expect(m.reviewed).toBe(2);
    expect(m.approvalRate).toBe(50);
  });
  it('reports open and overdue work at the end of the period', () => {
    expect(m.open).toBe(2);
    expect(m.overdue).toBe(1);
    expect(m.backlogHealth).toBe(50);
    expect(m.workload).toEqual({ todo: 0, in_progress: 1, review: 1, changes: 0 });
  });
  it('weights the score from its parts and shows how', () => {
    // (60*35 + 50*35 + 50*20 + 50*10) / 100
    expect(m.score).toBe(54);
    expect(m.scoreParts.map((p) => p.key)).toEqual(['completion', 'onTime', 'approval', 'backlog']);
  });
  it('holds back a score until there is enough work to judge', () => {
    const small = computeMetrics([row({ status: 'done', doneOn: '2026-10-02' })], [], '2026-10-01', '2026-10-15', S);
    expect(small.enoughData).toBe(false);
    expect(small.score).toBeNull();
    expect(small.completionRate).toBe(100);
  });
  it('leaves out parts with no data instead of counting them as zero', () => {
    const r = [1, 2, 3].map((i) => row({ status: 'done', doneOn: `2026-10-0${i}` }));
    const x = computeMetrics(r, [], '2026-10-01', '2026-10-15', S);
    expect(x.onTimeRate).toBeNull();
    expect(x.approvalRate).toBeNull();
    expect(x.scoreParts.map((p) => p.key)).toEqual(['completion', 'backlog']);
    expect(x.score).toBe(100);
  });
});

describe('periods and buckets', () => {
  it('compares with the same number of days just before', () => {
    expect(previousPeriod('2026-10-01', '2026-10-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
  it('uses days, weeks ending on the last day, or months depending on the span', () => {
    expect(buckets('2026-10-01', '2026-10-07')).toHaveLength(7);
    const w = buckets('2026-10-01', '2026-11-30'); // 61 days: a 5-day start, then full weeks
    expect(w[0]).toEqual({ start: '2026-10-01', end: '2026-10-05' });
    expect(w[1]).toEqual({ start: '2026-10-06', end: '2026-10-12' });
    expect(w.at(-1)).toEqual({ start: '2026-11-24', end: '2026-11-30' });
    // 30 days: the 2 leftover days join the first week instead of standing alone.
    const m = buckets('2026-09-20', '2026-10-19');
    expect(m[0]).toEqual({ start: '2026-09-20', end: '2026-09-28' });
    expect(m).toHaveLength(4);
    const months = buckets('2026-01-15', '2026-10-19');
    expect(months[0]).toEqual({ start: '2026-01-15', end: '2026-01-31' });
    expect(months).toHaveLength(10);
  });
  it('places completions in their bucket', () => {
    const t = trend([row({ status: 'done', doneOn: '2026-10-03', dueDate: '2026-10-02' }), row({ assignedOn: '2026-10-03' })], '2026-10-01', '2026-10-05');
    expect(t[2]).toMatchObject({ start: '2026-10-03', completed: 1, assigned: 1, late: 1 });
    expect(t[0].assigned).toBe(1);
  });
});

describe('normalizeSettings', () => {
  it('clamps values and fills gaps from the defaults', () => {
    const s = normalizeSettings({ weights: { completion: 150, onTime: -4 }, minSample: 0 });
    expect(s.weights).toEqual({ completion: 100, onTime: 0, approval: 20, backlog: 10 });
    expect(s.minSample).toBe(1);
    expect(s.targets).toEqual(DEFAULT_KPI_SETTINGS.targets);
  });
});
