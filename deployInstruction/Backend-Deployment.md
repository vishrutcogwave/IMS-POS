# Deploy the IMS-POS backend

Use the existing `compose.production.yaml` with a separately provisioned PostgreSQL service. All restaurants share one database, with tenant-scoped access. Deploy the backend and frontend from the same release revision.

## 1. Prepare production PostgreSQL

1. Create a dedicated database, such as `ims_pos`, and a migration login that owns the application schema and can run Flyway DDL.
2. Create a separate runtime login with `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`. Give it database connection and schema usage, table `SELECT, INSERT, UPDATE, DELETE`, and sequence `USAGE, SELECT`. Grant these on existing application objects if any, and configure the migration role's default privileges for new tables and sequences. Keep the runtime login out of the migration role.
3. Allow PostgreSQL connections only from the deployment network. Use the database provider's TLS hostname and trusted CA. Take a backup and test its restore before deploying against an existing database.

## 2. Enter production settings

Keep the environment file outside the checkout. On Linux, create it with permissions restricted to the deployment account. Replace every placeholder with your production values.

```bash
sudo install -d -m 0750 /etc/ims-pos
sudoedit /etc/ims-pos/production.env
sudo chmod 600 /etc/ims-pos/production.env
```

Ensure the account running Docker Compose can read that file. Use the server's secret manager if available.

```dotenv
DB_URL='jdbc:postgresql://<database-host>:5432/ims_pos?sslmode=verify-full&sslrootcert=/run/ims-pos/postgres-ca.pem'
DB_USERNAME='<restricted-runtime-user>'
DB_PASSWORD='<runtime-database-password>'
DB_MIGRATION_USERNAME='<migration-user>'
DB_MIGRATION_PASSWORD='<migration-database-password>'
APP_ORIGIN='https://pos.hiremathwebstudio.in'
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

## 3. Start and check the backend

From the repository root, run the following. Flyway applies migrations at startup using the migration login. Keep port `8080` private inside Compose.

```bash
docker compose --env-file /etc/ims-pos/production.env -f compose.production.yaml up -d --build backend
docker compose --env-file /etc/ims-pos/production.env -f compose.production.yaml logs --tail=100 backend
```

Check the logs for successful Flyway validation or migration and a successful Spring Boot startup. Finish the [frontend deployment](Frontend-Deployment.md) to verify public HTTPS access.

## Platform administrator login

Sign in at [pos.hiremathwebstudio.in](https://pos.hiremathwebstudio.in) using the same login screen as staff.

| Login field | Value to enter |
| --- | --- |
| Property ID | `@platform` |
| Username | Your production `APP_PLATFORM_ADMIN_EMAIL` |
| Password | Your production `APP_PLATFORM_ADMIN_PASSWORD` |

Choose an email you control. Generate a unique password on the deployment host with `openssl rand -hex 32`, then store it in the production environment file or secret manager and your password manager. The backend requires at least 32 characters. After changing these settings, rerun the Compose deployment command to recreate the backend with the new environment. Rotating the administrator password invalidates existing platform sessions.

After signing in, go to **Stores → Platform contact** and enter the support phone number and email that staff should see when their restaurant licence expires.
