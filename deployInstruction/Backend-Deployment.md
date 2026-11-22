# Deploy the IMS-POS backend

Use the existing `compose.production.yaml` with a separately provisioned PostgreSQL service. All restaurants share one database, with tenant-scoped access. Deploy the backend and frontend from the same release revision.

## 0. Keep POS separate from IMS

Run these commands from the POS checkout, for example `/opt/ims-pos`. Reserve the Compose project name `ims-pos-production`, a dedicated database named `ims_pos`, the two POS-only database roles below, and a free loopback port such as `8181`. Check your server before assigning the port.

```bash
docker compose ls
sudo ss -ltn 'sport = :8181'
```

If the port has a listener, pick another free port and use it in `POS_HTTP_PORT` and the POS Nginx config. Keep using the existing HTTPS reverse proxy with a separate virtual host for `pos.hiremathwebstudio.in`. Leave the IMS checkout, Compose project, database, port, and virtual host in place. [Compose project names](https://docs.docker.com/compose/how-tos/project-name/)

## 1. Prepare production PostgreSQL

The commands below target a **new** database on a self-managed Ubuntu or Debian PostgreSQL server. For managed PostgreSQL, create the database and roles with the provider's admin account, then apply the same schema grants. Use a supported PostgreSQL release. IMS-POS has been tested with PostgreSQL 17.

On the database server, open `psql` as an administrator. If PostgreSQL is already running for IMS, use the existing service only if it already provides a private, TLS-verified endpoint reachable from the POS network. The setup below adds a separate database and roles to that instance. If it requires changing IMS database networking or restarting its service, provision a separate PostgreSQL instance for POS.

Run only the final command below on a server with PostgreSQL already provisioned. The preceding commands install and start PostgreSQL on a fresh database server.

```bash
sudo apt update
sudo apt install postgresql
sudo systemctl enable --now postgresql
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres
```

Paste this into `psql`. The two `\password` commands prompt for separate passwords. Save each one in your password manager.

```sql
SET password_encryption = 'scram-sha-256';

CREATE ROLE ims_pos_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE ims_pos_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
\password ims_pos_migrator
\password ims_pos_runtime

CREATE DATABASE ims_pos OWNER ims_pos_migrator;
\connect ims_pos
REVOKE ALL ON DATABASE ims_pos FROM PUBLIC;
GRANT CONNECT ON DATABASE ims_pos TO ims_pos_runtime;

ALTER SCHEMA public OWNER TO ims_pos_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ims_pos_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE ims_pos_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ims_pos_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE ims_pos_migrator IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ims_pos_runtime;
\quit
```

Flyway runs as `ims_pos_migrator` and the POS serves requests as `ims_pos_runtime`. Step 3 creates the application tables before the web application starts. For an existing production database, take a verified backup first and review role ownership before applying changes. These default grants apply to future objects created by the migration role.

### Allow the backend to connect

Use a private hostname covered by the PostgreSQL server's TLS certificate, such as `db.internal.example.com`. For managed PostgreSQL, use the provider's endpoint, CA bundle, and private-network access controls.

On a self-managed server, use `SHOW config_file;` and `SHOW hba_file;` in `psql` to locate the files. Configure `listen_addresses` for the private database interface, enable TLS with the server certificate and private key, and add the following records to `pg_hba.conf` before any broader matching rules. Replace `<backend-source-CIDR>` with the actual private address or subnet PostgreSQL sees from the backend.

```text
hostssl ims_pos ims_pos_migrator <backend-source-CIDR> scram-sha-256
hostssl ims_pos ims_pos_runtime  <backend-source-CIDR> scram-sha-256
```

Allow TCP 5432 only from that private source in the database firewall. Restart PostgreSQL if you changed its listening addresses. Reload it for an authentication-rule-only change. If PostgreSQL and Docker run on the same server, use a private host address reachable from the container and allow the Compose subnet as needed. Inside the backend container, `localhost` refers to the backend container itself.

From a machine with allowed database access, check the runtime credentials and TLS hostname verification. The command prompts for the runtime password.

```bash
psql 'host=<database-host> port=5432 dbname=ims_pos user=ims_pos_runtime sslmode=verify-full sslrootcert=/path/to/postgres-ca.pem' \
  -W -c "SELECT current_user, rolsuper, rolbypassrls, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create FROM pg_roles WHERE rolname=current_user;"
```

Expect `ims_pos_runtime` and `f` for `rolsuper`, `rolbypassrls`, and `can_create`. See [PostgreSQL connection authentication](https://www.postgresql.org/docs/17/auth-pg-hba-conf.html) and [default privileges](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).


## 2. Enter production settings

Keep the environment file outside the checkout. On Linux, create it once with permissions restricted to the deployment account. Replace every placeholder with your production values.

```bash
sudo install -d -m 0750 -o "$(id -un)" /etc/ims-pos
(umask 077; touch /etc/ims-pos/production.env)
nano /etc/ims-pos/production.env
chmod 600 /etc/ims-pos/production.env
```

Ensure the account running Docker Compose can read that file. Use the server's secret manager if available.

```dotenv
DB_URL='jdbc:postgresql://<database-host>:5432/ims_pos?sslmode=verify-full&sslrootcert=/run/ims-pos/postgres-ca.pem'
DB_USERNAME='ims_pos_runtime'
DB_PASSWORD='<runtime-database-password>'
DB_MIGRATION_USERNAME='ims_pos_migrator'
DB_MIGRATION_PASSWORD='<migration-database-password>'
APP_ORIGIN='https://pos.hiremathwebstudio.in'
POS_HTTP_PORT=8181
APP_PLATFORM_ADMIN_EMAIL='<your-administrator-email>'
APP_PLATFORM_ADMIN_PASSWORD='<unique-generated-password>'
```

If the URL uses `sslrootcert`, mount the actual CA bundle into the backend at the same container path. The following optional Compose override can be saved as `/etc/ims-pos/compose.tls.yaml`. Make the mounted CA readable by the backend container user, UID `10001`.

```yaml
services:
  backend:
    volumes:
      - /etc/ims-pos/postgres-ca.pem:/run/ims-pos/postgres-ca.pem:ro
```

Use `-f /etc/ims-pos/compose.tls.yaml` after `-f compose.production.yaml` in the Compose commands in both guides when using this override. The production Compose file already enables secure cookies and disables demo seeding and public API docs. Leave `APP_ONBOARDING_KEY` unset when provisioning restaurants from Platform Administration.

## 3. Manually run the migrations before starting POS

From the POS checkout, run the following with the production variables and CA mount from step 2. This one-off command applies the checked-in [SQL migrations](../backend/src/main/resources/db/migration), checks that the connected database is `ims_pos`, and exits without starting the web server.

```bash
docker compose -p ims-pos-production --env-file /etc/ims-pos/production.env \
  -f compose.production.yaml -f /etc/ims-pos/compose.tls.yaml \
  run --rm --no-deps --build backend --migrate-only=ims_pos
```

If your deployment provides the CA mount another way, use the correct override for your environment. The migrations create all POS tables, indexes, constraints, and row-level security policies, plus `flyway_schema_history`. Use this command to apply the migration files in order and record their checksums. Running individual `CREATE TABLE` statements in `psql` would leave Flyway without migration history.

Connect to `ims_pos` as the migration login with the same TLS settings from step 1, then run:

```sql
SELECT current_database(), current_user;
SELECT version, description, success
FROM public.flyway_schema_history
ORDER BY installed_rank;
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

The first query should show `ims_pos` and `ims_pos_migrator`. On this release expect migrations 1 through 16 to be successful. The last query lists the actual tables, including `tenants`, `users`, `orders`, `bills`, and `print_jobs`. Resolve any failed migration before starting POS.

## 4. Start and check the backend

From the repository root, run the following. Spring Boot validates the recorded migrations at startup using the migration login. Keep port `8080` private inside Compose.

```bash
docker compose -p ims-pos-production --env-file /etc/ims-pos/production.env -f compose.production.yaml -f /etc/ims-pos/compose.tls.yaml up -d --build backend
docker compose -p ims-pos-production --env-file /etc/ims-pos/production.env -f compose.production.yaml -f /etc/ims-pos/compose.tls.yaml logs --tail=100 backend
```

Check the logs for successful Flyway validation or migration and a successful Spring Boot startup. Finish the [frontend deployment](Frontend-Deployment.md) to verify public HTTPS access.

## Platform administrator login

Sign in at [pos.hiremathwebstudio.in](https://pos.hiremathwebstudio.in) using the same login screen as staff.

| Login field | Value to enter |
| --- | --- |
| Property ID | `@platform` |
| Username | Your production `APP_PLATFORM_ADMIN_EMAIL` |
| Password | Your production `APP_PLATFORM_ADMIN_PASSWORD` |

Choose an email you control. Generate a unique password on the deployment host with `openssl rand -hex 32`, then store it in the production environment file or secret manager and your password manager. The backend requires at least 32 characters. After changing these settings, recreate the backend with the new environment, then restart the frontend container so Nginx resolves the replacement backend address. Rotating the administrator password invalidates existing platform sessions.

After signing in, go to **Stores → Platform contact** and enter the support phone number and email that staff should see when their restaurant licence expires.

## Back up and verify the release

Use the database provider's backup and point-in-time restore features, or schedule encrypted PostgreSQL backups with an account that can read all tenant rows despite row-level security. Verify a restore into a separate database. A backup taken with the restricted runtime account is unsuitable for disaster recovery.

Once the frontend is live, sign in as the platform administrator, save the support contact, and test a disposable restaurant and staff login over HTTPS. Confirm that the database is reachable only over the approved private network. Commission the designated Windows print PC and verify KOT and bill output before opening the site to staff. [POS Print Bridge deployment](POS-Print-Bridge.md)
