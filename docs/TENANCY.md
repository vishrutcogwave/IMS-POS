# Tenant onboarding and isolation

## Shared database design

All restaurants use one Spring Boot application and one PostgreSQL database. Every tenant-owned table carries `tenant_id`; outlets reference branches, and order/table/menu/printer relations use tenant-qualified composite foreign keys. Critical outlet relationships use `(tenant_id,outlet_id,id)`. Scoped unique constraints prevent names/document numbers and active table occupancy from conflicting across tenants. A branch is an organizational grouping of authorized outlets, not another database.

An opaque 256-bit session cookie authenticates the user. The database stores only its SHA-256 hash. The server resolves the tenant and current active user from that session on every request. A tenant selector exists only at login/onboarding; protected endpoints do not accept arbitrary browser tenant IDs. Tenant, role and accessible outlets are server-owned. Password/privilege changes revoke affected sessions. Browser storage does not hold authentication tokens.

Repository operations run in a PostgreSQL transaction with `set_config('app.tenant_id', tenantUuid, true)`. The setting is transaction-local and cannot leak when a pooled connection is reused. Queries also bind explicit tenant predicates and validate outlet authorization. Row-level-security policies are ENABLED and FORCED on tenant-owned operational/configuration tables. Without tenant context they return no rows and reject writes. Use a separate application database role that is neither superuser nor BYPASSRLS and owns no schema objects. Migration credentials must never be used as the runtime connection.

The tenant registry and hashed-session lookup are narrowly scoped authentication tables: the server must resolve a session's tenant before it can establish RLS context. They are not exposed as general browsing APIs. The runtime database credential is an application secret, not a user-access mechanism; database RLS assumes SQL execution remains within trusted backend code. RLS does not replace parameterized queries, session validation, role checks or outlet checks.

## Authorization

- OWNER: restaurant administration and all outlets within their tenant.
- MANAGER: operations/settings within assigned outlets; cannot promote to or manage OWNER.
- CASHIER: dashboard, ordering, billing and printing in assigned outlets; no discretionary discount/cancellation administration.
- WAITER: ordering, table transfer and printing in assigned outlets.
- KITCHEN: kitchen state and print operations in assigned outlets.
- ACCOUNTANT: dashboard, reporting and printing in assigned outlets.

The frontend hides inaccessible routes, but the backend independently enforces permissions on every endpoint. IDs in paths and request children must belong to the current restaurant and permitted outlet. Reports, CSV exports, search, print jobs, test printing and route configuration follow the same boundaries. An outlet selection in the browser never grants access.

## Onboarding

Configure `APP_ONBOARDING_KEY` with a strong secret supplied only to your controlled onboarding operator. Keep public registration disabled when no key is configured. The onboarding screen/API accepts a restaurant name and unique slug, owner name/email/password and the onboarding key. Creation of tenant, owner, initial branch/outlet and access is transactional. Slugs identify the restaurant at login; they are not authentication secrets.

After onboarding, the owner completes receipt details (address, tax registration, phone/footer), branches/outlets and timezone/currency, service modes, payment methods, tables, menu taxes/variants/modifiers, kitchen departments and category printer routes. Add users with explicit outlet assignments. Do not share accounts between restaurant clients. Use a one-outlet kitchen account for the local print agent.

## Development seed

Only `APP_SEED_DEMO=true` enables seed data, and `DEMO_PASSWORD` must be supplied at runtime. The two demo tenants are `saffron` (`owner@saffron.test`) and `coastal` (`owner@coastal.test`), each with separate IDs and restaurant data. Seed data is not production dashboard data. The local environment initializer generates a random demo password into the ignored `.env`; it does not print or commit it. Do not enable demo seeding in production.

## Verification

`npm run test:integration` exercises actual PostgreSQL, not an in-memory substitute. The test uses a non-superuser application connection to verify missing-context denial and one-tenant row visibility, then tests endpoint/outlet/role tampering, print claims, transactional workflow and report/export isolation. It creates distinctly labeled local verification data and preserves the resulting audit history. It refuses non-local API hosts. See the final verification report for executed results rather than assuming the suite passed.

Production requires HTTPS, secure cookies, restricted DB connectivity, secrets management, backups and restore drills, monitored audit/print failures and a security review of the actual deployment. Do not expose the PostgreSQL service, migration user or onboarding key to browsers.
