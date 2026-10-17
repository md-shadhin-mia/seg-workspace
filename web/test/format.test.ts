import { describe, expect, it } from 'vitest';
import { ago, dayDiff, dueClass, dueLabel, fileSize, initials, linkKind } from '../src/lib/format';

const now = new Date(2026, 9, 17, 14, 0);

describe('format helpers', () => {
  it('labels due dates relative to today', () => {
    expect(dueLabel('2026-10-17', now)).toBe('Today');
    expect(dueLabel('2026-10-18', now)).toBe('Tomorrow');
    expect(dueLabel('2026-10-16', now)).toBe('Yesterday');
    expect(dueLabel('2026-10-24', now)).toBe('Oct 24');
    expect(dueLabel('2027-01-05', now)).toBe('Jan 5, 2027');
    expect(dueLabel(null, now)).toBe('No date');
  });
  it('compares calendar days, not timestamps', () => {
    expect(dayDiff('2026-10-17', new Date(2026, 9, 17, 23, 59))).toBe(0);
    expect(dayDiff('2026-10-18', new Date(2026, 9, 17, 0, 1))).toBe(1);
  });
  it('flags overdue and due-today only while work is open', () => {
    expect(dueClass('2026-10-10', false, now)).toBe('over');
    expect(dueClass('2026-10-17', false, now)).toBe('today');
    expect(dueClass('2026-10-10', true, now)).toBe('');
  });
  it('formats relative times', () => {
    expect(ago(now.getTime() - 30_000, now.getTime())).toBe('just now');
    expect(ago(now.getTime() - 5 * 60_000, now.getTime())).toBe('5m ago');
    expect(ago(now.getTime() - 26 * 3600_000, now.getTime())).toBe('yesterday');
  });
  it('formats sizes, initials and link kinds', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(3 * 1048576)).toBe('3.0 MB');
    expect(initials('Walid Hasan')).toBe('WH');
    expect(linkKind('https://www.figma.com/file/x')).toBe('figma');
    expect(linkKind('https://github.com/a/b/pull/1')).toBe('github');
  });
});
