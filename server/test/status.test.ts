import { describe, expect, it } from 'vitest';
import { deriveStatus } from '../src/lib/access.js';

describe('deriveStatus', () => {
  it.each([
    [[], 'todo', 'todo'],
    [[], 'review', 'review'],
    [['todo', 'todo'], 'todo', 'todo'],
    [['todo', 'in_progress'], 'todo', 'in_progress'],
    [['done', 'todo'], 'todo', 'in_progress'],
    [['review', 'done'], 'todo', 'review'],
    [['review', 'in_progress'], 'todo', 'in_progress'],
    [['changes', 'review'], 'todo', 'changes'],
    [['done', 'done'], 'in_progress', 'done'],
  ] as const)('%j (was %s) → %s', (list, current, expected) => {
    expect(deriveStatus([...list], current)).toBe(expected);
  });
});
