import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Bell, CheckCircle2, Eye, MessageSquare, RotateCcw, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import type { Notification } from '../lib/types';
import { Empty, ErrorState, PageLoading } from '../components/ui';

const ICON: Record<string, [React.ReactNode, string]> = {
  assigned: [<UserPlus size={16} />, 'var(--muted)'],
  mention: [<AtSign size={16} />, 'var(--lime-soft)'],
  review_requested: [<Eye size={16} />, 'var(--blue-bg)'],
  changes_requested: [<RotateCcw size={16} />, 'var(--red-bg)'],
  approved: [<CheckCircle2 size={16} />, 'var(--green-bg)'],
  comment: [<MessageSquare size={16} />, 'var(--muted)'],
  signup: [<UserPlus size={16} />, 'var(--lime-soft)'],
};

export default function Inbox() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/notifications') });
  const read = useMutation({
    mutationFn: (body: { ids?: number[] }) => api.post('/notifications/read', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  if (q.isLoading) return <PageLoading />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const items = q.data!;
  const unread = items.filter((n) => !n.readAt).length;

  function open(n: Notification) {
    if (!n.readAt) read.mutate({ ids: [n.id] });
    if (n.type === 'signup') nav('/admin/users?tab=pending');
    else if (n.taskId) nav(`/tasks/${n.taskId}${n.type === 'review_requested' ? '?tab=submissions' : n.type === 'mention' || n.type === 'comment' ? '?tab=comments' : ''}`);
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div><h1>Inbox</h1><p>Assignments, mentions, reviews and replies. {unread ? `${unread} unread.` : 'All caught up.'}</p></div>
        {unread > 0 && <button className="btn" onClick={() => read.mutate({})}>Mark all as read</button>}
      </div>
      {items.length === 0 ? <Empty title="Nothing here yet">When someone assigns you work, mentions you or reviews your submission, it shows up here.</Empty> : (
        <div className="list">
          {items.map((n) => {
            const [icon, bg] = ICON[n.type] ?? [<Bell size={16} />, 'var(--muted)'];
            return (
              <button key={n.id} className="task-row" onClick={() => open(n)} style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'flex-start' }}>
                <span className="avatar" style={{ width: 34, height: 34, borderRadius: 9, background: bg, color: 'var(--fg)' }}>{icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: n.readAt ? 400 : 500, lineHeight: 1.45 }}>{n.body}</span>
                  <span className="t-sub">{ago(n.createdAt)}</span>
                </span>
                {!n.readAt ? <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--fg)', marginTop: 8 }} /> : <span />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
