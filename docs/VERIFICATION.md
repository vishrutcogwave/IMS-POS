# Build progress and verification

The application in this Git repository starts from the independently developed Hearth Table rewrite. The legacy React checkout and the earlier Hearth Table directory were preserved. No legacy credentials, runtime data or proprietary print components were imported. The IMS tray bridge is separately installed hardware middleware.

| Area | Implementation and verification |
| --- | --- |
| Legacy review | Source and API caller inspection is recorded in LEGACY-ANALYSIS.md. Legacy server, business rules and database were unavailable for live verification. |
| Authentication and tenancy | Spring Security session cookies, CSRF, roles, outlet assignments, PostgreSQL row-level security and two sample tenants. Integration tests exercised session lifecycle, tenant and outlet isolation, and server-side permissions. |
| Restaurant operations | Business setup, branches, outlets, tables, staff, menu, variants and modifiers, four service modes, order lifecycle, table transfer, and persisted kitchen tickets. The integration suite exercised representative dine-in operations and cancellation. |
| Billing | Server-side tax and discount totals, item-quantity split bills, multi-tender settlement, cancellations and modifications for eligible unpaid bills, and reprints. Card and UPI are manually confirmed external payments. Paid refunds and reversals are outstanding. |
| Reports | API-backed dashboard, date filters, paginated reports and CSV export. Integration tests verified real totals and outlet scope. |
| Printing | Durable PostgreSQL queue, category-based KOT routing, outlet receipts, test and reprint jobs, 58/80 mm layouts, copies and job recovery. Windows and mobile browser actions can use the same outlet agent. Network and Windows spooling still require on-site commissioning. Direct mobile Bluetooth/USB printing and larger invoice formats are outstanding. |
| Deployment | Local PostgreSQL Compose, production frontend/backend containers, environment example and migration/backup instructions. Docker was unavailable on the workstation. The container images, HTTPS proxy and database restore have yet to be exercised. |

## Checks run on November 21, 2026

- Java 21 backend package succeeded. All 58 Java tests passed.
- React, TypeScript, Vite and Tailwind production build succeeded. Vite served the application on localhost.
- A fresh PostgreSQL 17 instance applied Flyway migrations V1 and V2. All 15 integration scenarios passed through the Vite API proxy, including restricted-role row-level security, ordering, KOT routing, settlement, reports and exports.
- Six Node print tests passed, including two mocked bridge contract and failure tests. These checks do not attest to physical output.

## Remaining acceptance

Complete Windows default, installed and LAN printer tests on real hardware. Verify receipt output from a Windows browser and a mobile browser, including 58/80 mm sizing, routing and copies. Exercise production containers and restore procedures in staging. Perform interactive browser acceptance across devices. Procurement and stock ledgers remain outside the restaurant billing build.

## Platform administration check

The frontend build and all 58 Java tests and six printing tests passed. Flyway
applied and validated the platform subscription migration on embedded PostgreSQL 17.
The 15 lifecycle scenarios and the new platform scenario passed. The new scenario
covers authenticated provisioning, tenant/admin separation, invalid credentials,
trial validation, suspensions, expiry, reactivation, branch limits and audit history.
Chromium checks passed at desktop and mobile widths for login, restaurant creation,
subscription editing, history and sign-out.

### IMS-style POS screen check

The production frontend build, 58 Java tests, 16 PostgreSQL integration
scenarios and six print tests passed. The platform scenario also verifies
profile updates, username changes, password reset, last-owner protection,
cross-property rejection, session invalidation and credential audit history.
Chromium verified the three platform pages on mobile and all nine restaurant
workspaces on desktop and mobile, including navigation and mobile overflow.

### November 21 manual checkout

Browsed the Udupi property read-only and found it signed into a different
tenant from the Saffron demo. Used a separate loopback browser session for
all writes. In a Saffron test outlet, verified invalid and valid sign-in,
dine-in with covers, two menu categories, item variants and kitchen notes,
station-specific KOT jobs, a split bill of INR 84.00 and INR 178.50, INR 16.00
cash change, release of table T1, sales report updates, kitchen progression,
profile, platform navigation, and the print queue's pending and test statuses.

Fixed missing order, bill and KOT references in API responses and added the
table name to the receipt view. Verified these against the saved order, bills
and tickets in the browser and added PostgreSQL regression checks. The clean
Java build passed all 58 tests, the PostgreSQL suite passed all 19 scenarios,
and six print tests passed. CSV export was checked through the API. The manual
browser download step was interrupted. Physical output and spooler behavior
remain unverified. The manual test order and print jobs remain in the local
test outlet for inspection.
