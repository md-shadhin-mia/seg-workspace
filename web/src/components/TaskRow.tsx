import { memo } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, MessageSquare } from 'lucide-react';
import { dueClass, dueLabel } from '../lib/format';
import type { Priority, Status } from '../lib/types';
import { AvatarStack, PriorityTag, StatusPill } from './ui';

export interface RowTask {
  id: string; seq: number; title: string; status: Status; priority: Priority; dueDate: string | null; projectName?: string;
  assignees: { userId: string; name: string; status: Status }[]; myStatus?: Status | null;
  checklistTotal?: number; checklistDone?: number; commentCount?: number;
}

/** Compact row: title + project on the left; people, status, due date and priority on the right. */
export const TaskRow = memo(function TaskRow({ t, showProject = true, useMyStatus = false }: { t: RowTask; showProject?: boolean; useMyStatus?: boolean }) {
  const status = useMyStatus && t.myStatus ? t.myStatus : t.status;
  const doneCount = t.assignees.filter((a) => a.status === 'done').length;
  return (
    <Link to={`/tasks/${t.id}`} className="task-row">
      <div style={{ minWidth: 0 }}>
        <div className="t-title">{t.title}</div>
        <div className="t-sub">
          <span>#{t.seq}</span>
          {showProject && t.projectName && <span>{t.projectName}</span>}
          {t.assignees.length > 1 && <span>{doneCount}/{t.assignees.length} people done</span>}
          {!!t.checklistTotal && <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}><CheckSquare size={12} />{t.checklistDone}/{t.checklistTotal}</span>}
          {!!t.commentCount && <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}><MessageSquare size={12} />{t.commentCount}</span>}
        </div>
      </div>
      <div className="meta">
        {t.assignees.length > 0 && <AvatarStack names={t.assignees.map((a) => a.name)} size={24} max={3} />}
        <StatusPill status={status} />
        <span className={`due ${dueClass(t.dueDate, status === 'done')}`}>{dueLabel(t.dueDate)}</span>
        <PriorityTag p={t.priority} compact />
      </div>
    </Link>
  );
});
