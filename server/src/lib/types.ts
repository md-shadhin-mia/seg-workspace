export type Role = 'admin' | 'member';
export type TeamRole = 'lead' | 'member';
export type Status = 'todo' | 'in_progress' | 'review' | 'changes' | 'done';
export const STATUSES: Status[] = ['todo', 'in_progress', 'review', 'changes', 'done'];
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  title: string;
  role: Role;
  status: string;
  teams: { teamId: string; name: string; role: TeamRole }[];
}
