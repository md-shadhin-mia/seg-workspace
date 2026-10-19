import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AiAnswer, AiPanel } from '../src/components/Ai';
import { planDescription } from '../src/components/NewProjectModal';

afterEach(() => { cleanup(); });

describe('AiPanel', () => {
  it('"Use this" hands the improved text to the editor', () => {
    const use = vi.fn();
    const close = vi.fn();
    render(<AiPanel title="Improved description" text={'Goal\nShip the page.'} onUseText={use} onClose={close} />);
    expect(screen.getByRole('region', { name: 'Improved description' })).toHaveTextContent('Ship the page.');
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(use).toHaveBeenCalledWith('Goal\nShip the page.');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(close).toHaveBeenCalled();
  });

  it('shows a skeleton while loading and nothing to use yet', () => {
    render(<AiPanel title="Summary" loading onUseText={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Waiting for AI')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
  });

  it('adds only the checklist items that are still ticked', () => {
    const add = vi.fn();
    render(<AiPanel title="Suggested checklist" items={['Draft copy', 'Export images', 'Test on mobile']} onUseItems={add} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Export images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 items' }));
    expect(add).toHaveBeenCalledWith(['Draft copy', 'Test on mobile']);
  });

  it('is read-only without a use handler', () => {
    render(<AiPanel title="Summary" text="- All good" onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
  });
});

describe('AiAnswer', () => {
  it('links only tasks the server returned and never renders HTML', () => {
    const { container } = render(
      <MemoryRouter><AiAnswer text={'Start with #12 Hero.\n#99 is not yours. <img src=x onerror=alert(1)>'} refs={{ 12: 'task-a' }} /></MemoryRouter>,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/tasks/task-a');
    expect(links[0]).toHaveTextContent('#12');
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
});

describe('planDescription', () => {
  it('folds objectives, milestones and risks into the project description', () => {
    expect(planDescription({ description: 'Landing page.', objectives: ['More leads'], milestones: [{ title: 'Design', dueDate: '2026-11-01' }, { title: 'Launch', dueDate: null }], risks: [] }))
      .toBe('Landing page.\n\nObjectives\n- More leads\n\nMilestones\n- Design (by 2026-11-01)\n- Launch');
  });
});
