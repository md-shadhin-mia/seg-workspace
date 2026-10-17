import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies pending SQL migrations in order. Safe to run from several instances at once. */
export async function migrate(sql: Sql): Promise<string[]> {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274)`;
    await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx`select name from schema_migrations`).map((r) => r.name as string));
    for (const f of files) {
      if (done.has(f)) continue;
      await tx.unsafe(await fs.readFile(path.join(dir, f), 'utf8'));
      await tx`insert into schema_migrations (name) values (${f})`;
      applied.push(f);
    }
  });
  return applied;
}

// `node dist/migrate.js` runs migrations without starting the server.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { loadConfig } = await import('./config.js');
  const { createDb } = await import('./db.js');
  const sql = createDb(loadConfig().DATABASE_URL, 1);
  const applied = await migrate(sql);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  await sql.end();
}
