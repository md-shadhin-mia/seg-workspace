import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, requireUser } from '../lib/http.js';

export default async function notificationRoutes(app: FastifyInstance) {
  const { sql } = app;

  app.get('/notifications', async (req) => {
    const u = requireUser(req);
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(60) }), req.query);
    return sql`
      select n.id, n.type, n.body, n.task_id, n.read_at, n.created_at, n.actor_id, a.name as actor_name, t.title as task_title
      from notifications n left join users a on a.id = n.actor_id left join tasks t on t.id = n.task_id
      where n.user_id = ${u.id} order by n.created_at desc limit ${limit}`;
  });

  app.post('/notifications/read', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ ids: z.array(z.coerce.number().int()).max(500).optional(), taskId: z.string().uuid().optional() }), req.body);
    if (body.ids?.length) {
      await sql`update notifications set read_at = now() where user_id = ${u.id} and read_at is null and id = any(${sql.array(body.ids)}::bigint[])`;
    } else if (body.taskId) {
      await sql`update notifications set read_at = now() where user_id = ${u.id} and read_at is null and task_id = ${body.taskId}`;
    } else {
      await sql`update notifications set read_at = now() where user_id = ${u.id} and read_at is null`;
    }
    return { ok: true };
  });
}
