import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { createDb, type Sql } from './db.js';
import { migrate } from './migrate.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { createOpenRouter, type AiClient } from './lib/ai.js';
import { HttpError } from './lib/errors.js';
import { SESSION_COOKIE, loadSessionUser } from './lib/http.js';
import { hashPassword } from './lib/crypto.js';
import type { SessionUser } from './lib/types.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import teamRoutes from './routes/teams.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import fileRoutes from './routes/files.js';
import notificationRoutes from './routes/notifications.js';
import miscRoutes from './routes/misc.js';
import aiRoutes from './routes/ai.js';
import analyticsRoutes from './routes/analytics.js';

declare module 'fastify' {
  interface FastifyInstance { sql: Sql; cfg: Config; mail: Mailer; ai: AiClient }
  interface FastifyRequest { user: SessionUser | null; sid: string | null }
}

export interface AppOptions { mailer?: Mailer; sql?: Sql; ai?: AiClient }

export async function buildApp(cfg: Config, opts: AppOptions = {}): Promise<FastifyInstance> {
  const sql = opts.sql ?? createDb(cfg.DATABASE_URL, 10, cfg.APP_TIMEZONE);
  await migrate(sql);
  await bootstrapAdmin(sql, cfg);
  fs.mkdirSync(cfg.UPLOAD_DIR, { recursive: true });

  const app = Fastify({
    logger: cfg.NODE_ENV === 'test' ? false : {
      level: 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  const mail = opts.mailer ?? createMailer(cfg, (m) => app.log.info(m));
  app.decorate('sql', sql);
  app.decorate('cfg', cfg);
  app.decorate('mail', mail);
  app.decorate('ai', opts.ai ?? createOpenRouter(cfg));
  app.decorateRequest('user', null);
  app.decorateRequest('sid', null);

  const https = cfg.APP_URL.startsWith('https://');
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: https ? [] : null,
      },
    },
    hsts: https ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 10 } });

  // CSRF: every state-changing API call must carry a custom header, which cross-site forms
  // cannot send and cross-origin scripts cannot add without a CORS preflight (we allow none).
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'seg-web') {
      throw new HttpError(403, 'csrf', 'Request blocked. Reload the page and try again.');
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const s = await loadSessionUser(sql, cfg, token);
      if (s) { req.user = s.user; req.sid = s.sid; }
    }
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    const status = err.statusCode ?? 500;
    if (status === 429) return reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' } });
    if (status === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'too_large', message: `Files can be up to ${cfg.MAX_UPLOAD_MB} MB.` } });
    }
    if (status < 500) return reply.status(status).send({ error: { code: err.code ?? 'bad_request', message: err.message } });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'server_error', message: 'Something went wrong on our side. Try again in a moment.' } });
  });

  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(userRoutes);
    await api.register(teamRoutes);
    await api.register(projectRoutes);
    await api.register(taskRoutes);
    await api.register(fileRoutes);
    await api.register(notificationRoutes);
    await api.register(miscRoutes);
    await api.register(aiRoutes);
    await api.register(analyticsRoutes);
  }, { prefix: '/api' });

  // Web app: hashed assets cached for a year, index.html never cached, SPA fallback for client routes.
  const hasWeb = fs.existsSync(path.join(cfg.WEB_DIST, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: cfg.WEB_DIST,
      wildcard: false,
      cacheControl: false,
      setHeaders(res, file) {
        res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !hasWeb || req.method !== 'GET') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  app.addHook('onClose', async () => { if (!opts.sql) await sql.end({ timeout: 5 }); });
  return app;
}

/** Creates (or promotes) the admin from ADMIN_EMAIL / ADMIN_PASSWORD on boot. */
async function bootstrapAdmin(sql: Sql, cfg: Config) {
  if (!cfg.ADMIN_EMAIL || !cfg.ADMIN_PASSWORD) return;
  const [existing] = await sql`select id from users where lower(email) = lower(${cfg.ADMIN_EMAIL})`;
  if (existing) {
    await sql`update users set role = 'admin', status = 'active' where id = ${existing.id}`;
    return;
  }
  await sql`
    insert into users (email, name, title, password_hash, role, status, approved_at)
    values (${cfg.ADMIN_EMAIL.toLowerCase()}, ${cfg.ADMIN_NAME}, 'Administrator', ${await hashPassword(cfg.ADMIN_PASSWORD)}, 'admin', 'active', now())`;
}
