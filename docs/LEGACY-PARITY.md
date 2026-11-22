# Legacy POS parity audit

Reviewed the legacy route table and API callers again on November 21, 2026.
The legacy checkout contains client code only. The API and its database were
unavailable for execution. Statements about legacy behavior below describe
observable client calls, not live backend verification.

| Legacy workflow | Evidence | New POS |
| --- | --- | --- |
| Property, branch, outlet masters | PropertyMasterCreation, BranchMaster, OutletMaster; outlet list and writes use branch codes | Property and outlet create/edit exist. Branch edit added. Legacy deletion and the rest of the outlet settings still need review. |
| Outlet item detail, bulk increments, spreadsheet upload | OutletItemsDetails calls GetOutletItemList and /api/Master/bulkincrement; ItemMasterImport uploads to the selected outlet | Per-outlet CRUD for creating and editing items was present. Added category-based preview and bulk base pricing. Shared item master, group-based outlet assignment and Excel import remain open. |
| Tax and tax description | TaxMaster and TaxDescriptionMaster use separate branch CRUD calls | Item-level tax percentage exists. Named tax master, descriptions and outlet tax assignment remain open. |
| Departments, groups, categories, subcategories and units | DepartmentMaster, GroupMaster, CategoryMaster, SubCategoryMaster, UnitMaster use distinct CRUD | Categories exist with a kitchen department label. Independent departments, groups, subcategories and units remain open. |
| Steward, NC department and company | StewardMaster, NCDepartmentMaster and CompanyCreation use separate branch CRUD | Staff accounts exist. Steward assignment, NC departments, company billing and company settlement remain open. |
| Printing, tables, utility settings | PrintingMaster, PrinterSettings, TableMaster and UtilitySettings | Printer routing, floor tables and receipt templates exist. Legacy print definitions, bill/KOT settings, happy hours, timers, SMS, discount modes and financial settings remain open. |
| Users, permissions and menu rights | UserMaster, UserRightsMaster, UserMenuOrSubmenuCreation | Fixed roles and assigned outlets exist. Per-user menu/action rights and legacy menu construction remain open. |
| Outlet sales and operational reports | DailySales, ItemSales, category sales, change sheet, KOT/NC and bill reports | Outlet-wise totals now span authorized outlets with outlet-local date windows. Change sheet, NC KOT and legacy reconciliation reports remain open. |
| Bill and settlement adjustment | BillAdjustment, SettlementBillModify, companybillsettlement | Open bill modifications and settlement exist. Post-settlement correction and company settlement remain open. |
| Suppliers, stock stores, purchasing, receiving | Inventory and purchase routes in LandingPage | Supplier and inventory masters, stock ledgers, import, purchase approvals and GRN remain open. |

The independent POS remains a partial replacement for the legacy application.
