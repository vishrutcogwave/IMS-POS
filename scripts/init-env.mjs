import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const secret = () => randomBytes(32).toString('hex');
const database = secret();
const runtime = secret();
const content = `POSTGRES_DB=hearth_local
POSTGRES_USER=hearth_migrator
POSTGRES_PASSWORD=${database}
APP_DB_USER=hearth_app
APP_DB_PASSWORD=${runtime}
DB_URL=jdbc:postgresql://localhost:5432/hearth_local
DB_USERNAME=hearth_app
DB_PASSWORD=${runtime}
DB_MIGRATION_USERNAME=hearth_migrator
DB_MIGRATION_PASSWORD=${database}
APP_SEED_DEMO=true
DEMO_PASSWORD=${secret()}
APP_ONBOARDING_KEY=${secret()}
APP_ORIGIN=http://localhost:5173
APP_COOKIE_SECURE=false
APP_DOCS_ENABLED=true
MAIL_HOST=
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_FROM=
MAIL_SMTP_AUTH=true
MAIL_SMTP_STARTTLS=true
`;
const target = fileURLToPath(new URL('../.env', import.meta.url));
await writeFile(target, content, { flag: 'wx', mode: 0o600 });
console.log('Created local .env with generated credentials. Keep it private; never use these development settings in production.');
