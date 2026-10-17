// Resets the e2e database before the server starts. Never point this at a real database.
import postgres from 'postgres';
const url = process.env.DATABASE_URL;
if (!url || !/e2e|test/.test(url)) { console.error('Refusing to reset a database whose name has no "e2e" or "test" in it.'); process.exit(1); }
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql.unsafe('drop schema public cascade; create schema public;');
await sql.end();
