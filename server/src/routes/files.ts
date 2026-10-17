import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { taskAccess } from '../lib/access.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { logActivity } from '../lib/events.js';
import { parse, requireUser, uuid } from '../lib/http.js';

// Types a browser may render inline. Everything else (including SVG and HTML) downloads, so uploads can't run scripts.
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'text/plain']);

export default async function fileRoutes(app: FastifyInstance) {
  const { sql, cfg } = app;

  app.post('/tasks/:id/files', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { purpose } = parse(z.object({ purpose: z.enum(['resource', 'submission']).default('resource') }), req.query);
    const acc = await taskAccess(sql, u, id);
    if (purpose === 'submission' ? !acc.isAssignee : !acc.perms.edit) throw forbidden();
    if (!req.isMultipart()) throw badRequest('Send the file as multipart form data.');
    const saved: Record<string, unknown>[] = [];
    try {
      for await (const part of req.files()) {
        const key = crypto.randomUUID();
        const dest = path.join(cfg.UPLOAD_DIR, key);
        await pipeline(part.file, fs.createWriteStream(dest, { flags: 'wx' }));
        if (part.file.truncated) {
          fs.rmSync(dest, { force: true });
          throw Object.assign(new Error('too large'), { statusCode: 413 });
        }
        const size = fs.statSync(dest).size;
        const name = (part.filename || 'file').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);
        const mime = (part.mimetype || 'application/octet-stream').slice(0, 100);
        const [row] = await sql`
          insert into files (task_id, uploader_id, name, mime, size, storage_key, purpose)
          values (${id}, ${u.id}, ${name}, ${mime}, ${size}, ${key}, ${purpose})
          returning id, name, mime, size, created_at`;
        saved.push(row);
        if (purpose === 'resource') await logActivity(sql, id, u.id, 'file_added', { name });
      }
    } catch (err) {
      // Roll back anything stored from this request.
      for (const f of saved) {
        const [r] = await sql`delete from files where id = ${f.id as string} returning storage_key`;
        if (r) fs.rmSync(path.join(cfg.UPLOAD_DIR, r.storageKey), { force: true });
      }
      throw err;
    }
    if (!saved.length) throw badRequest('Choose a file to upload.');
    return reply.status(201).send(saved);
  });

  app.get('/files/:id', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { download } = parse(z.object({ download: z.enum(['1', '0']).optional() }), req.query);
    const [f] = await sql`select task_id, name, mime, size, storage_key from files where id = ${id}`;
    if (!f) throw notFound('File not found.');
    await taskAccess(sql, u, f.taskId);
    const file = path.join(cfg.UPLOAD_DIR, f.storageKey);
    if (!fs.existsSync(file)) throw notFound('This file is missing from storage.');
    const inline = INLINE.has(f.mime) && download !== '1';
    reply
      .header('Content-Type', inline ? f.mime : 'application/octet-stream')
      .header('Content-Length', String(f.size))
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('Cache-Control', 'private, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    return reply.send(fs.createReadStream(file));
  });

  app.delete('/files/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const [f] = await sql`select task_id, uploader_id, storage_key from files where id = ${id}`;
    if (!f) throw notFound('File not found.');
    const acc = await taskAccess(sql, u, f.taskId);
    if (f.uploaderId !== u.id && !acc.perms.manage) throw forbidden('Only the uploader or a team lead can remove this file.');
    const [used] = await sql`select 1 from submission_items where file_id = ${id}`;
    if (used) throw badRequest('This file is part of a submitted version and is kept for the record.');
    await sql`delete from files where id = ${id}`;
    fs.rmSync(path.join(cfg.UPLOAD_DIR, f.storageKey), { force: true });
    return { ok: true };
  });
}
