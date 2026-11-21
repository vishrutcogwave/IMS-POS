# Hearth Table — restaurant billing

A clean restaurant-only React/Vite/TypeScript + Java/Spring Boot + PostgreSQL application. This is a separate project; the legacy source in `D:/clone/POSsystemWeb` is unchanged. No ASP.NET, retail inventory modules, copied private keys or in-memory database are used.

## Prerequisites

- Java 21 and Maven 3.9+.
- Node 22+ recommended (Node 20.19+ minimum for the frontend toolchain).
- PostgreSQL 17; Docker Compose is the normal local setup.
- A compatible thermal printer and local agent are required for unattended physical printing; no hardware is simulated.

## Local setup (from this folder)

```sh
node scripts/init-env.mjs
```

This creates a private, ignored `.env` with unique generated local credentials. It refuses to overwrite an existing file. Alternatively copy `.env.example` to `.env` and replace every placeholder. Never commit it. The sample tenants' local password is the `DEMO_PASSWORD` value in this file; keep that value private.

```sh
docker compose up -d postgres
```

The database is bound only to `127.0.0.1:5432`. A separate non-superuser, non-BYPASSRLS runtime role is created by the initialization script. Initialization only runs on an empty volume; changing credentials in `.env` does not change an existing database. Do not delete a database volume to fix configuration problems.

Build and run the backend:

```sh
mvn -f backend/pom.xml clean package
node scripts/start-backend.mjs
```

On this prepared workstation, project-local Maven is also available through `bash backend/mvnw clean package` (Git Bash) or `backend\mvnw.cmd clean package` (Command Prompt). These are lightweight launchers, not a downloading Maven wrapper; if `.tools` is absent, install Maven normally. The backend starter reads the root `.env` and does not print secrets.

In a second terminal:

```sh
npm --prefix frontend install
npm --prefix frontend run dev -- --host 127.0.0.1
```

Open `http://localhost:5173`. Vite proxies `/api` to port 8080. The browser and backend must use one consistent hostname; do not alternate `localhost` and `127.0.0.1` for a session. Local API documentation is at `http://localhost:8080/swagger-ui/index.html` when enabled.

Demo login (only with `APP_SEED_DEMO=true`):

| Restaurant slug | Owner email | Password |
| --- | --- | --- |
| saffron | owner@saffron.test | Your local `DEMO_PASSWORD` |
| coastal | owner@coastal.test | Your local `DEMO_PASSWORD` |

These are distinct restaurants with isolated data in the same database. Production should have demo seeding disabled. Dashboard/report values come from actual saved transactions, not canned sales figures.

### This workstation: optional portable PostgreSQL

Docker was not available during preparation. A real PostgreSQL 17 binary package was placed under ignored `.tools/package/native`; this is an ordinary disk-backed PostgreSQL server, not an in-memory substitute. With this optional local tooling:

```sh
npm install
node scripts/local-postgres.mjs
```

It creates `.local/postgres`, binds loopback, uses SCRAM passwords and starts no Windows service. It creates a separate runtime role. Do not run it alongside Docker on the same port. The portable binary distribution is a development convenience, not the production deployment package. On a fresh machine, prefer Docker or a supported PostgreSQL installation.

### Existing corporate/system certificate trust

The system's older Node/Java trust bundles may not include the Windows root used on this network. Do not disable SSL verification. The prepared `.tools/node-v24.11.1-win-x64` runtime can use existing Windows trusted roots:

```sh
node scripts/npm-local.mjs install
node scripts/npm-local.mjs run build
node scripts/npm-local.mjs run dev -- --host 127.0.0.1
```

For Maven on Windows, set `MAVEN_OPTS=-Djavax.net.ssl.trustStoreType=Windows-ROOT -Djavax.net.ssl.trustStore=NONE` in that terminal if your existing Windows trust policy requires it. This selects an existing trust store; it does not turn certificate verification off. Keep such machine-specific trust settings out of production configuration.

## Operations

- Complete business receipt details and create branch/outlet access in Settings.
- Configure the outlet's service modes, payment methods, tables, category departments, menu pricing/taxes, variants/modifiers and availability.
- Create kitchen/receipt printers and category routes; run routing preview and a hardware test.
- Start or resume a table/takeaway/delivery/room-service order (only enabled modes appear), add lines and notes, then send to kitchen.
- Sending commits KOTs and queued jobs; physical printing is an independent visible state.
- Generate a bill or explicitly allocate item quantities across split bills; settle with one or multiple configured payment methods. Card/UPI payments are manually recorded confirmations, not a gateway or QR settlement integration.
- Authorized cancellation/modification/reprint actions require reasons and preserve history. Already paid bills cannot be cancelled through an unpaid-bill cancellation shortcut.

See [API contract](docs/API-CONTRACT.md), [legacy analysis](docs/LEGACY-ANALYSIS.md), [tenant isolation](docs/TENANCY.md), and [printing setup/recovery](docs/PRINTING.md).

## Verification

With the backend and local PostgreSQL running:

```sh
npm install
npm run test:integration
npm --prefix frontend run build
mvn -f backend/pom.xml test
```

Integration tests create clearly named local test outlets/users/orders and retain audit history; they do not erase data afterward. They refuse non-local API hosts. They use PostgreSQL through the restricted application user to test actual row-level security. Consult `docs/VERIFICATION.md` for the checks actually executed and outstanding limitations.

## Production PostgreSQL and hosting

Use the same schema and a supported PostgreSQL 17 server, not a separate database per restaurant. Provision two roles:

1. A schema migration owner with DDL permissions (not a browser/app user).
2. A runtime login with `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, schema USAGE, table SELECT/INSERT/UPDATE/DELETE, sequence USAGE/SELECT and no schema ownership. Configure the migration owner's default privileges so future migrations grant required runtime DML. Do not grant membership in the migration owner to the runtime user.

Supply process/container secrets and environment variables:

```text
DB_URL=jdbc:postgresql://<db-host>:5432/<shared-database>?sslmode=verify-full&sslrootcert=<trusted-ca-file>
DB_USERNAME=<restricted-runtime-user>
DB_PASSWORD=<runtime-secret>
DB_MIGRATION_USERNAME=<migration-owner>
DB_MIGRATION_PASSWORD=<migration-secret>
APP_ORIGIN=https://<your-pos-host>
APP_COOKIE_SECURE=true
APP_SEED_DEMO=false
APP_DOCS_ENABLED=false
APP_ONBOARDING_KEY=<strong-controlled-onboarding-secret>
```

Use your platform's secret manager; `.env.example` contains placeholders only. Validate the PostgreSQL server certificate and hostname; do not use `sslmode=disable` for a remote database. Restrict network access to backend/migration hosts. Back up before applying migrations and test restoring backups. Flyway migrations apply at startup using the dedicated migration connection; coordinate startup/migration authorization for each production release.

Build `frontend/dist` with `npm --prefix frontend run build`. Serve it from an HTTPS reverse proxy that forwards `/api` to the backend and falls back to `index.html` for frontend routes. Keep API and UI same-origin; do not add wildcard credentialed CORS. Pass trusted host/protocol headers only from your controlled proxy, and configure the backend's permitted external origin if required by the deployed session filter. Keep the backend/database off the public network. Set secure cookies before enabling real logins.

Provision each restaurant using the controlled onboarding flow and follow `docs/TENANCY.md`. Commission actual printer hardware per outlet before live service. This repository does not deploy itself, configure a payment gateway, or establish accounting/tax certification.

### Container deployment

Use a separately provisioned PostgreSQL service and provide the production settings through an operator-controlled environment or secret manager. With a separate production environment file, run:

    docker compose --env-file <production-env-file> -f compose.production.yaml up -d --build

Terminate HTTPS at a trusted reverse proxy and route it to 127.0.0.1:8081. Set APP_ORIGIN to the exact HTTPS browser origin. The frontend container proxies /api to Spring Boot on the internal Compose network. Ensure PostgreSQL trusts the configured TLS CA. For a private CA referenced by DB_URL, mount the CA into the backend container at that path.

Before release, take a PostgreSQL backup and verify a restore in staging. Run migrations against the restored copy first. Spring Boot applies Flyway migrations using the migration role at startup. Keep a separate tested backup/restore procedure for printer-agent configuration and secrets, since they are outlet-local.
