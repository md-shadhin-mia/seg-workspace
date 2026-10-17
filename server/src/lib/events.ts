import type { Sql } from '../db.js';
import type { Config } from '../config.js';
import type { Mailer } from './mailer.js';

export async function logActivity(sql: Sql, taskId: string, actorId: string | null, action: string, meta: Record<string, unknown> = {}) {
  await sql`insert into activity (task_id, actor_id, action, meta) values (${taskId}, ${actorId}, ${action}, ${sql.json(meta as any)})`;
}

const EMAIL_TYPES = new Set(['assigned', 'review_requested', 'changes_requested', 'approved', 'mention']);

export interface NotifyCtx { sql: Sql; cfg: Config; mail: Mailer; log: (o: unknown, m?: string) => void }

/** In-app notification for each recipient (never the actor), plus an email for actionable types. */
export async function notify(
  ctx: NotifyCtx,
  o: { userIds: string[]; type: string; taskId?: string | null; actorId?: string | null; body: string; subject?: string },
) {
  const ids = [...new Set(o.userIds)].filter((id) => id && id !== o.actorId);
  if (!ids.length) return;
  await ctx.sql`
    insert into notifications (user_id, type, task_id, actor_id, body)
    select u, ${o.type}, ${o.taskId ?? null}, ${o.actorId ?? null}, ${o.body} from unnest(${ctx.sql.array(ids)}::uuid[]) as u`;
  if (!EMAIL_TYPES.has(o.type)) return;
  const users = await ctx.sql`select email, name from users where id = any(${ctx.sql.array(ids)}::uuid[]) and status = 'active'`;
  const link = o.taskId ? `${ctx.cfg.APP_URL}/tasks/${o.taskId}` : ctx.cfg.APP_URL;
  for (const u of users) {
    ctx.mail
      .send({ to: u.email, subject: o.subject ?? o.body, text: `Hi ${u.name.split(' ')[0]},\n\n${o.body}\n\nOpen it here: ${link}` })
      .catch((err) => ctx.log({ err }, 'notification email failed'));
  }
}
