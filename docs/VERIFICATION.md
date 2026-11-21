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
