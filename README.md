# POS powered by Hiremath Web Studio

A clean restaurant-only React/Vite/TypeScript + Java/Spring Boot + PostgreSQL application. This is a separate project; the legacy source in `D:/clone/POSsystemWeb` is unchanged. No ASP.NET, retail inventory modules, copied private keys or in-memory database are used.

## Prerequisites

- Java 21 and Maven 3.9+.
- Node 22+ recommended (Node 20.19+ minimum for the frontend toolchain).
- PostgreSQL 17; use the embedded (portable) PostgreSQL for local Windows checks. Production uses a separately provisioned PostgreSQL server.
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

Set JAVA_HOME to Java 21 and put its bin directory first on PATH before invoking Maven or the backend starter. On this workstation the verified Java 21 distribution is under .tools. Maven 3.9 is required on PATH for a normal checkout. Local Maven launchers also support an optional .tools/apache-maven-3.9.9 installation.

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

### Local Windows checks with embedded PostgreSQL

Docker was not available during preparation. A real PostgreSQL 17 binary package was placed under ignored `.tools/package/native`; this is an ordinary disk-backed PostgreSQL server, not an in-memory substitute. With this optional local tooling:

```sh
npm install
node scripts/local-postgres.mjs
```

It creates `.local/postgres` on the loopback port specified by DB_URL (55432 in this workstation setup), binds loopback, uses SCRAM passwords and starts no Windows service. It creates a separate runtime role. Do not run it alongside Docker on the same port. The portable binary distribution is a development convenience, not the production deployment package. On a fresh Windows machine, place the portable PostgreSQL 17 distribution under .tools/package/native, or use Docker Compose for local development.

### Existing corporate/system certificate trust

If the network uses a managed root certificate, configure npm and Maven to use that trusted certificate. The optional Windows Node launcher below requires a Node installation in .tools/node-v24.11.1-win-x64.

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

See [API contract](docs/API-CONTRACT.md), [legacy analysis](docs/LEGACY-ANALYSIS.md), [tenant isolation](docs/TENANCY.md), and [printing setup/recovery](docs/PRINTING.md). For workstation installation and phone printing, see the [POS Print Bridge deployment guide](deployInstruction/POS-Print-Bridge.md).

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

## Platform administrator and subscriptions

Open / to sign in with Property ID, Username and Password. Staff enter their restaurant slug and their account email. Platform administrators enter @platform and their administrator email. All restaurants use the same PostgreSQL database and retain
tenant-scoped data and permissions. The administrator can provision restaurants and
their first owner accounts, manage plans and access, configure UTC start and expiry
dates, set branch limits, and review an audit trail. Suspended, expired and scheduled
restaurants cannot sign in or use existing sessions while access is unavailable.

For the local instance on this workstation, use the administrator email and generated
password in the ignored .env file. For a fresh installation, set
APP_PLATFORM_ADMIN_EMAIL and APP_PLATFORM_ADMIN_PASSWORD in the server environment.
Use a unique random password of at least 32 characters, stored as a deployment secret.
Leaving both values unset disables administrator login. Use HTTPS in production.
Changing the configured password invalidates existing administrator sessions.
Administrator access is separate from tenant operations and does not grant access
to restaurant bills or payment records. Subscription billing is handled manually.

### Platform workspaces

Stores provides property search, status filtering, pagination, profile and
subscription settings, and platform support contact settings. Store Accounts
supports account lookup, username changes, access changes, a generated temporary
password, and credential history. Account changes revoke active sessions. Audit
Log lists up to 200 recent administrator and subscription events, with property
filtering and filtered CSV export. The POS retains historical records through
subscription suspension. Permanent tenant deletion is not provided.

### Outlet masters and Excel items

In Masters, start in Branches & outlets and create or select an outlet.
The Tables tab manages only the selected outlet's floor. Create a category
in Categories, then add or edit items in Items with that category selected.
Units and Taxes are outlet masters. An item can use a named tax or a custom rate.

Use Items → Import items to download the XLSX template. Validate and preview
before confirming. The preview lists missing categories, units and named taxes
and shows row-level issues. Import adds items to the selected outlet and creates
their missing menu records in one database transaction. Existing item names
are rejected. Outlets and tables are configured in Masters. Use Export items
to download the selected outlet's menu in the same workbook format.
