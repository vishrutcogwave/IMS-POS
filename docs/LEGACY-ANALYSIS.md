# Legacy restaurant POS findings

Read-only inspection of `D:/clone/POSsystemWeb/my-react-app` on 2026-11-18. No legacy files were modified. The available repository contains a React/TypeScript/Vite frontend and static build archives, not the application backend or database migrations. It calls a runtime-configured API. The implementation language, schema, transactional guarantees and server permissions of that absent service cannot be verified. No legacy credentials or private keys were copied.

## Observed workflows

- Login selects a branch and stores a bearer token in browser storage; AppContext loads branch/user/menu rights. `src/api/services/auth.service.ts:3-15`, `src/screens/LandingPage.tsx:73-109`, `src/context/AppContext.tsx:86-147`.
- Branch/outlet setup controls restaurant service modes including parcel, fast food and room service, direct billing, pax/steward and taxes. `src/screens/OutletMaster.tsx:16-35,150-175`.
- Table sessions collect covers/steward, subtables separate bills, and table transfer accepts selected tickets/items. `src/components/TableSessionModal.tsx:169-176`, `src/screens/NewOrder.tsx:290-338`.
- Ordering filters items by outlet/category/availability and carries add-ons, instruction codes and notes. `src/context/ItemContext.tsx:49-123`, `src/screens/OrderingBoard.tsx:611-829`.
- KOT creation validates day status then posts ADD; cancellation posts VOID; NC conversions exist. Kitchen-ticket reprint was not found in active callers. `src/screens/OrderingBoard.tsx:831-933,1304-1383,1823-1870`.
- Bills are calculated by the absent service. Split tender, room/company transfer, bill modification, cancellation reasons and bill reprint are exposed. Separate subtables are not equivalent to a verified item/equal bill splitter. `src/components/PaymentModal.tsx:331-397,476-516`, `src/screens/BillModification.tsx:429-617`, `src/components/BillCancellationPopup.tsx:163-223`.
- Sales, category/item, KOT/void, cancellation and reconciliation reports call APIs and offer PDF/XLSX/browser printing. `src/api/services/products.service.ts:239-346,3005-3179`, `src/components/ReportDataTable.tsx:120-275`.

## Problems informing the replacement

| Observed issue | Source evidence | Replacement design |
| --- | --- | --- |
| Different modifiers share an item ID, so quantity edits affect multiple lines | OrderingBoard.tsx:720-762 | Distinct immutable order-line IDs and server snapshots |
| New bill clears visible items but retains old cart used in bill payload | OrderingBoard.tsx:1568-1605,2127-2133 | Server-owned order lifecycle, explicit resume, no cross-order cart reuse |
| VOID filtering drops zero-remaining rows | CartPanel.tsx:271-310; OrderingBoard.tsx:1323-1344 | Explicit persisted cancellation state and original ticket reference |
| Partial category printer mapping drops unmatched items; duplicate names overwrite groups | OrderingBoard.tsx:937-1028 | Validate all lines before sending; route by immutable printer IDs |
| Failed print followed by cart clearing and a successful-print toast | OrderingBoard.tsx:1023-1078 | Transactional outbox, visible job state, failure/uncertainty and recovery |
| Fast-food ADD printed as CANCEL KOT; success text claims bill printing | OrderingBoard.tsx:1087-1303 | Typed immutable document types and accurate queue acknowledgments |
| QR request uses full bill rather than split payment allocation | PaymentModal.tsx:155-165,597,662,780-825 | Exact split allocation server-side; external Card/UPI recording clearly manual |
| Sensitive routes have no matching route permission guard | LandingPage.tsx:118-198 | Role-filtered routes plus mandatory server checks; legacy server security unknown |
| API response values inserted into print HTML without escaping | ReportDataTable.tsx:95-167 | React text rendering and CSV formula escaping |
| Private-key file in public assets; API URL editable using client-side password | public/keys/private-key.txt:1; AuthPage.tsx:38-50 | No copied key; fixed same-origin API, environment configuration, investigate/rotate legacy key if active |

## Legacy printing

JSPrintManager establishes a local WebSocket bridge (`src/App.tsx:139-215,385-440`) with reconnect/skip and a license endpoint. Mobile user agents choose raw network printer port 9100; desktop chooses an installed printer by name, otherwise the OS default and ignores the IP (`src/api/services/printer.ts:3-25`). KOT supports ESC/POS or HTML. Normal sends force thermal output; cancellation uses printer-name heuristics. Receipt printing uses ESC/POS; regular copies are configurable, while some reprint/direct paths issue one job. No physical paper acknowledgment was established.

Settings associate branch/outlet/category group and KOT/BILL document type (`src/screens/PrinterSettings.tsx:83-205`). The browser currently groups API-provided category mappings and dispatches print jobs itself. The replacement stores routing on the server, derives the tenant from authentication, validates outlet ownership, and sends only local device aliases to a separately configured agent. It does not reuse JSPrintManager, its licenses, private keys or proprietary assets.

Workflow reference: https://www.petpooja.com/poss/restaurant-billing-software and https://www.petpooja.com/my/poss (ordering, KOT, quick settlement and table/split workflows only). Hearth Table branding and interface are original.

## Legacy purchasing and inventory

The legacy routing table includes purchase orders, approvals, item purchases and goods received. The API service calls supplier and inventory category masters and the purchase screens save to the external service. References include LandingPage.tsx near lines 220–250 and products.service.ts from line 4890 onward. These are observed client workflows. Live stock movements, costing, purchase approval rules and stock-to-menu deductions could not be verified without the server and database. The replacement supports menu availability and sales reporting. Procurement and stock ledgers were outside its restaurant billing build.
