export type Status = 'todo' | 'in_progress' | 'review' | 'changes' | 'done';
export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export interface TeamRef { teamId: string; name: string; role: 'lead' | 'member' }
export interface Me { id: string; email: string; name: string; title: string; role: 'admin' | 'member'; status: string; teams: TeamRef[] }
export interface MeResponse { user: Me; unread: number; pendingUsers: number; mailEnabled: boolean }

export interface Person { id: string; name: string; title: string; email: string; role: string; status: string; teams: TeamRef[]; createdAt: string; lastLoginAt: string | null }

export interface Team {
  id: string; name: string; description: string; memberCount: number; projectCount: number; myRole: 'lead' | 'member' | null;
  projects: { id: string; name: string; status: string }[];
}
export interface TeamDetail { id: string; name: string; description: string; canManage: boolean;
  members: { id: string; name: string; title: string; email: string; role: 'lead' | 'member'; openTasks: number; overdueTasks: number }[] }

export interface Project {
  id: string; name: string; description: string; status: string; dueDate: string | null; teamId: string; teamName: string;
  leadId: string | null; leadName: string | null; taskCount: number; doneCount: number; reviewCount: number; overdueCount: number;
}
export interface ProjectDetail extends Project { canManage: boolean; members: { id: string; name: string; title: string; role: string }[] }

export interface AssigneeLite { userId: string; name: string; status: Status }
export interface TaskItem {
  id: string; seq: number; title: string; status: Status; priority: Priority; dueDate: string | null;
  projectId: string; projectName: string; teamId: string; teamName: string; assignees: AssigneeLite[]; myStatus: Status | null;
  checklistTotal: number; checklistDone: number; commentCount: number; updatedAt: string;
}

export interface FileRef { id: string; name: string; mime: string; size: number; createdAt: string; uploaderId?: string; uploaderName?: string }
export interface LinkRef { id: string; title: string; url: string; createdAt: string; addedBy?: string; addedByName?: string }
export interface SubmissionItem { id: string; kind: 'link' | 'file'; title: string; url: string | null; fileId: string | null; mime: string | null; size: number | null }
export interface Submission {
  id: string; userId: string; version: number; note: string; state: 'pending' | 'approved' | 'changes'; feedback: string | null;
  createdAt: string; reviewedAt: string | null; reviewedBy: string | null; reviewedByName: string | null; items: SubmissionItem[];
}
export interface TaskDetail {
  id: string; seq: number; title: string; description: string; priority: Priority; status: Status; dueDate: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
  project: { id: string; name: string }; team: { id: string; name: string };
  reviewer: { id: string; name: string } | null; reviewerIds: string[]; createdBy: { id: string; name: string } | null;
  assignees: { id: string; name: string; title: string; email: string; status: Status; updatedAt: string; assignedAt: string }[];
  checklist: { id: string; text: string; done: boolean; position: number }[];
  resources: { links: LinkRef[]; files: FileRef[] };
  submissions: Submission[];
  commentCount: number;
  perms: { edit: boolean; manage: boolean; review: boolean; openProject: boolean; setStatusFor: string[] };
}
export interface Comment { id: string; body: string; createdAt: string; editedAt: string | null; authorId: string; authorName: string }
export interface Activity { items: { id: string; action: string; meta: any; createdAt: string; actorId: string; actorName: string }[]; names: Record<string, string> }
export interface Notification { id: number; type: string; body: string; taskId: string | null; readAt: string | null; createdAt: string; actorId: string | null; actorName: string | null; taskTitle: string | null }
export interface Dashboard {
  counts: { dueToday: number; overdue: number; changes: number; inReview: number; open: number };
  focus: (Omit<TaskItem, 'projectId' | 'teamId' | 'teamName' | 'checklistTotal' | 'checklistDone' | 'commentCount' | 'updatedAt'> & { myStatus: Status })[];
  reviewQueue: { submissionId: string; version: number; createdAt: string; userId: string; userName: string; taskId: string; title: string; projectName: string }[];
  teams: { id: string; name: string; open: number; overdue: number; review: number; done: number; total: number }[];
  isLead: boolean;
}
