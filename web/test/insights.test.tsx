import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { niceTicks, smoothPath } from '../src/components/charts';
import { Delta, KpiCard, ScoreBreakdown, ScoreChip } from '../src/components/kpi';
import { Showcase } from '../src/components/Showcase';
import { presetRange, tone } from '../src/lib/analytics';
import type { Metrics } from '../src/lib/analytics';

afterEach(cleanup);

describe('chart helpers', () => {
  it('uses whole-number ticks for counts', () => {
    expect(niceTicks(5)).toEqual({ max: 6, ticks: [0, 2, 4, 6] });
    expect(niceTicks(0).ticks).toEqual([0, 1]);
    expect(niceTicks(37).max).toBeGreaterThanOrEqual(37);
    expect(niceTicks(84.2, false).ticks.at(-1)).toBe(100);
  });
  it('never curves past neighbouring points', () => {
    const d = smoothPath([[0, 10], [10, 0], [20, 0], [30, 10]]);
    const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  });
});

describe('date presets', () => {
  const now = new Date(2026, 9, 19);
  it('counts today as the last day of the range', () => {
    expect(presetRange('7d', now)).toEqual({ from: '2026-10-13', to: '2026-10-19' });
    expect(presetRange('30d', now)).toEqual({ from: '2026-09-20', to: '2026-10-19' });
    expect(presetRange('qtd', now)).toEqual({ from: '2026-10-01', to: '2026-10-19' });
    expect(presetRange('ytd', now).from).toBe('2026-01-01');
  });
  it('grades values against a target', () => {
    expect(tone(90, 80)).toBe('green');
    expect(tone(65, 80)).toBe('amber');
    expect(tone(30, 80)).toBe('red');
    expect(tone(null)).toBe('grey');
  });
});

describe('KPI pieces', () => {
  it('colours a change by whether it is good, and says what it compares with', () => {
    const { container, rerender } = render(<Delta now={12} prev={9} />);
    expect(container.querySelector('.delta.up')).toHaveTextContent('+3');
    expect(screen.getByText(/vs previous period/)).toBeInTheDocument();
    rerender(<Delta now={4} prev={2} invert />);
    expect(container.querySelector('.delta.down')).toHaveTextContent('+2');
    rerender(<Delta now={null} prev={2} />);
    expect(container.querySelector('.delta')).toBeNull();
  });
  it('links a KPI card to its detail page', () => {
    render(<MemoryRouter><KpiCard icon={null} label="Overdue" value={3} to="/my-tasks" /></MemoryRouter>);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/my-tasks');
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });
  it('shows a dash instead of a score without enough data', () => {
    render(<ScoreChip score={null} />);
    expect(screen.getByText('–')).toHaveAttribute('title', expect.stringMatching(/Not enough work/));
  });
  it('explains how the score is built', () => {
    const m = { scoreParts: [{ key: 'completion', label: 'Completion', value: 60, weight: 30 }, { key: 'onTime', label: 'On time', value: 90, weight: 10 }], enoughData: true, score: 68 } as Metrics;
    render(<ScoreBreakdown m={m} settings={{ weights: { completion: 30, onTime: 10, approval: 0, backlog: 0 }, targets: { completion: 80, onTime: 70, approval: 80, weeklyCompleted: 5 }, minSample: 3 }} />);
    // 60×0.75 + 90×0.25 = 45 + 22.5: the points shown add up to the score.
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText(/Weight 75%/)).toBeInTheDocument();
    expect(screen.getByText(/Weight 25%/)).toBeInTheDocument();
    expect(screen.getByText('Target 80%')).toBeInTheDocument();
  });
});

describe('sign-in showcase', () => {
  it('is hidden from screen readers and can be paused', () => {
    const { container } = render(<Showcase />);
    expect(container.querySelector('.showcase')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Pause the product preview' }));
    expect(container.querySelector('.showcase')).toHaveClass('paused');
    expect(screen.getByRole('button', { name: 'Play the product preview' })).toBeInTheDocument();
  });
});
