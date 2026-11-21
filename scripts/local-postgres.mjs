import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
for (const line of (await fs.readFile(path.join(root, '.env'), 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && env[match[1]] === undefined) env[match[1]] = match[2];
}
for (const name of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'APP_DB_USER', 'APP_DB_PASSWORD']) {
  if (!env[name]) throw new Error(`${name} must be configured in .env.`);
}
const bin = path.join(root, '.tools/package/native/bin');
const local = path.join(root, '.local');
const data = path.join(local, 'postgres');
await fs.mkdir(local, { recursive: true });
const exists = async file => !!(await fs.stat(file).catch(() => null));
const run = (name, args) => {
  const result = spawnSync(path.join(bin, name + (process.platform === 'win32' ? '.exe' : '')), args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || result.error?.message || `${name} failed.`);
  if (result.stdout) console.log(result.stdout.trim());
};
if (!(await exists(path.join(bin, 'initdb.exe')))) throw new Error('Portable PostgreSQL is not installed. Prefer docker compose up -d postgres, or obtain the optional binary package described in README.');
if (!(await exists(path.join(data, 'PG_VERSION')))) {
  const passwordFile = path.join(local, 'init-password');
  await fs.writeFile(passwordFile, env.POSTGRES_PASSWORD, { flag: 'wx', mode: 0o600 });
  try {
    run('initdb', ['-D', data, '--username=' + env.POSTGRES_USER, '--pwfile=' + passwordFile, '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C']);
  } finally { await fs.unlink(passwordFile); }
}
const port = Number(new URL(env.DB_URL.replace(/^jdbc:/, '')).port || 5432);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local DB port.');
const status = spawnSync(path.join(bin, 'pg_ctl.exe'), ['-D', data, 'status'], { encoding: 'utf8', windowsHide: true });
if (status.status !== 0) run('pg_ctl', ['-D', data, '-l', path.join(local, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start']);
const options = { host: '127.0.0.1', port, user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD };
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
let client = new pg.Client({ ...options, database: 'postgres' });
await client.connect();
try {
  if (!(await client.query('select 1 from pg_database where datname=$1', [env.POSTGRES_DB])).rowCount) await client.query(`CREATE DATABASE ${identifier(env.POSTGRES_DB)}`);
  if (!(await client.query('select 1 from pg_roles where rolname=$1', [env.APP_DB_USER])).rowCount) {
    await client.query(`CREATE ROLE ${identifier(env.APP_DB_USER)} LOGIN PASSWORD ${literal(env.APP_DB_PASSWORD)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  }
} finally { await client.end(); }
client = new pg.Client({ ...options, database: env.POSTGRES_DB });
await client.connect();
try {
  await client.query(`GRANT USAGE ON SCHEMA public TO ${identifier(env.APP_DB_USER)}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${identifier(env.APP_DB_USER)}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${identifier(env.APP_DB_USER)}`);
} finally { await client.end(); }
console.log(`Local PostgreSQL is ready on 127.0.0.1:${port}. No Windows service or system settings were changed.`);
