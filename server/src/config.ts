import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://seg:seg@localhost:5432/seg'),
  APP_URL: z.string().url().default('http://localhost:5173'),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  UPLOAD_DIR: z.string().default(path.resolve(here, '../data/uploads')),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  WEB_DIST: z.string().default(path.resolve(here, '../../web/dist')),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('SEG Workspace <no-reply@example.com>'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(10).optional(),
  ADMIN_NAME: z.string().default('Administrator'),
  ALLOWED_EMAIL_DOMAIN: z.string().optional(),
  APP_TIMEZONE: z.string().default('Asia/Dhaka'),
  RATE_LIMIT_AUTH: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  return parsed.data;
}
