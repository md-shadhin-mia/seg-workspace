import type { Sql } from '../db.js';
import { notFound } from './errors.js';
import type { SessionUser, Status } from './types.js';

export const isAdmin = (u: SessionUser) => u.role === 'admin';
export const teamRole = (u: SessionUser, teamId: string) => u.teams.find((t) => t.teamId === teamId)?.role ?? null;
export const canSeeTeam = (u: SessionUser, teamId: string) => isAdmin(u) || !!teamRole(u, teamId);
export const canManageTeam = (u: SessionUser, teamId: string) => isAdmin(u) || teamRole(u, teamId) === 'lead';
export const teamIds = (u: SessionUser) => u.teams.map((t) => t.teamId);

/**
 * SQL condition: the task row aliased `t` (joined to project `p`) is visible to the user.
 * Visible = admin, member of the project's team, or assigned to the task.
 */
export function visibleTaskCond(sql: Sql, u: SessionUser) {
  if (isAdmin(u)) return sql`true`;
  const ids = teamIds(u);
  return sql`(p.team_id = any(${sql.array(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}::uuid[])
    or exists (select 1 from task_assignees va where va.task_id = t.id and va.user_id = ${u.id}))`;
}

export function visibleProjectCond(sql: Sql, u: SessionUser) {
  if (isAdmin(u)) return sql`true`;
  const ids = teamIds(u);
  return sql`p.team_id = any(${sql.array(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}::uuid[])`;
}

export interface TaskAccess {
  task: Record<string, any> & { id: string; teamId: string; projectId: string; reviewerId: string | null; createdBy: string | null; status: Status };
  assignees: { userId: string; status: Status }[];
  isAssignee: boolean;
  perms: {
    edit: boolean;          // change title, description, due date, checklist, resources
    manage: boolean;        // change assignees, reviewer, delete task
    review: boolean;        // approve or request changes on submissions
    openProject: boolean;   // can open the parent project page
    setStatusFor: string[]; // assignee ids whose status this user can change
  };
}

/** Loads a task and the caller's permissions. Returns 404 (not 403) when invisible so ids don't leak. */
export async function taskAccess(sql: Sql, u: SessionUser, taskId: string): Promise<TaskAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw notFound('Task not found.');
  const [task] = await sql`
    select t.*, p.team_id, p.name as project_name, tm.name as team_name
    from tasks t join projects p on p.id = t.project_id join teams tm on tm.id = p.team_id
    where t.id = ${taskId}`;
  if (!task) throw notFound('Task not found.');
  const assignees = (await sql`select user_id, status from task_assignees where task_id = ${taskId}`) as unknown as TaskAccess['assignees'];
  const isAssignee = assignees.some((a) => a.userId === u.id);
  const inTeam = canSeeTeam(u, task.teamId);
  if (!inTeam && !isAssignee) throw notFound('Task not found.');
  const lead = canManageTeam(u, task.teamId);
  const creator = task.createdBy === u.id;
  return {
    task: task as TaskAccess['task'],
    assignees,
    isAssignee,
    perms: {
      edit: lead || isAssignee || creator,
      manage: lead || creator,
      review: lead || task.reviewerId === u.id,
      openProject: inTeam,
      setStatusFor: lead ? assignees.map((a) => a.userId) : isAssignee ? [u.id] : [],
    },
  };
}

/** Overall task status from each assignee's own status. */
export function deriveStatus(statuses: Status[], current: Status): Status {
  if (!statuses.length) return current;
  if (statuses.every((s) => s === 'done')) return 'done';
  if (statuses.some((s) => s === 'changes')) return 'changes';
  const open = statuses.filter((s) => s !== 'done');
  if (open.every((s) => s === 'review')) return 'review';
  if (statuses.some((s) => s !== 'todo')) return 'in_progress';
  return 'todo';
}
