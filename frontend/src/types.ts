export type ID = string;
export type Amount = number | string;
export type Permission = 'DASHBOARD' | 'ORDER' | 'DISCOUNT' | 'TRANSFER' | 'KITCHEN' | 'BILL' | 'CANCEL' | 'REPORT' | 'SETTINGS' | 'USERS' | 'PRINT';
export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN' | 'ACCOUNTANT';
export interface Tenant { id: ID; name: string; slug: string; receipt_address?: string; tax_number?: string; phone?: string; receipt_footer?: string }
export interface User { id: ID; name: string; email: string; role: Role; permissions: Permission[]; outlet_ids?: ID[]; active?: boolean }
export interface Branch { id: ID; name: string; address?: string }
export interface Outlet { id: ID; branch_id: ID; name: string; service_modes: string[]; payment_methods: string[]; currency: string; timezone: string }
export interface Session { user: User; tenant: Tenant; outlets: Outlet[]; csrfToken: string }
export interface Category { id: ID; outlet_id: ID; name: string; department: string; sort_order: number }
export interface PriceOption { name: string; price: Amount }
export interface MenuItem { id: ID; outlet_id: ID; category_id: ID; name: string; description: string; price: Amount; tax_rate: Amount; available: boolean; vegetarian: boolean; variants: PriceOption[]; modifiers: PriceOption[] }
export interface RestaurantTable { id: ID; outlet_id: ID; name: string; section: string; seats: number; active_order_id?: ID | null; order_status?: string }
export interface Printer { id: ID; outlet_id: ID; name: string; device_key: string; document_type: string; paper_width: number; copies: number; enabled: boolean; is_fallback: boolean; is_receipt: boolean; template: string; last_seen?: string }
export interface PrintRoute { id?: ID; outlet_id?: ID; category_id: ID; printer_id: ID }
export interface Catalog { categories: Category[]; items: MenuItem[]; tables: RestaurantTable[]; printers: Printer[]; routes: PrintRoute[]; outlet: Outlet }
export interface Settings { tenant: Tenant; branches: Branch[]; outlets: Outlet[]; users: User[]; categories: Category[]; items: MenuItem[]; tables: RestaurantTable[]; printers: Printer[]; routes: PrintRoute[] }
export interface OrderItem { id: ID; menu_item_id: ID; name?: string; item_name?: string; quantity: number; sent_quantity: number; unit_price: Amount; price?: Amount; tax_rate?: Amount; total?: Amount; line_total?: Amount; variant?: string; modifiers?: (string | PriceOption)[]; notes?: string; status?: string; cancelled?: boolean; cancelled_quantity?: number }
export interface Order { id: ID; outlet_id: ID; order_number: string; service_mode: string; table_id?: ID; table_name?: string; covers: number; customer_name?: string; notes?: string; status: string; version: number; items: OrderItem[]; kots?: Kot[]; bills?: Bill[]; subtotal: Amount; discount: Amount; tax: Amount; total: Amount; created_at: string }
export interface Kot { id: ID; kot_number?: string; order_id: ID; order_number: string; table_name?: string; service_mode: string; status: string; printer_name?: string; created_at: string; items: OrderItem[] }
export interface Payment { method: string; amount: Amount; reference?: string }
export interface Bill { id: ID; bill_number: string; order_id: ID; order_number?: string; status: string; version: number; subtotal: Amount; discount: Amount; tax: Amount; total: Amount; change?: Amount; created_at: string; items?: OrderItem[]; payments?: Payment[]; tenant?: Tenant; outlet?: Outlet; order?: Order; receipt_address?: string; tax_number?: string; receipt_footer?: string }
export interface PrintJob { id: ID; printer_name?: string; device_key?: string; status: string; document_type?: string; job_type?: string; reference?: string; attempts: number; created_at: string; error?: string; last_error?: string }
export interface RoutingPreview { groups: { printer: Printer | string; items: { name?: string; menuItemId?: ID; menu_item_id?: ID; quantity: number }[] }[]; unmapped: (MenuItem | string)[] }
export interface Dashboard { sales: Amount; billCount: number; averageBill: Amount; activeTables: number; activeOrders: number; payments: { method: string; total: Amount }[]; topItems: { name: string; quantity: number; total: Amount }[]; topCategories: { name: string; total: Amount }[]; outlets: { name: string; total: Amount }[]; daily: { date: string; total: Amount }[] }
export const reportTypes = ['daily-sales', 'item-sales', 'category-sales', 'outlet-sales', 'payments', 'kot-register', 'kot-cancellations', 'bill-reprints', 'bill-cancellations', 'bill-modifications', 'table-activity', 'tax-settlement'] as const;
export type ReportType = typeof reportTypes[number];
export interface Report { rows: Record<string, unknown>[]; totalElements: number; page: number; size: number; totals: Record<string, Amount> }
export interface DateRange { from: string; to: string }
export interface CreateOrder { outletId: ID; serviceMode: string; tableId?: ID; covers: number; notes: string; customerName: string }
export interface AddItem { version: number; menuItemId: ID; quantity: number; variant: string; modifiers: string[]; notes: string }
export interface BillGroup { items: { itemId: ID; quantity: number }[] }
export interface BranchInput { name: string; address: string }
export interface OutletInput { branchId: ID; name: string; serviceModes: string[]; paymentMethods: string[]; currency: string; timezone: string }
export interface UserInput { name: string; email: string; password?: string; role: Role; outletIds: ID[]; active?: boolean }
export interface CategoryInput { outletId: ID; name: string; department: string; sortOrder: number }
export interface ItemInput { outletId: ID; categoryId: ID; name: string; description: string; price: number; taxRate: number; available: boolean; vegetarian: boolean; variants: PriceOption[]; modifiers: PriceOption[] }
export interface TableInput { outletId: ID; name: string; section: string; seats: number }
export interface PrinterInput { outletId: ID; name: string; deviceKey: string; documentType: string; paperWidth: number; copies: number; enabled: boolean; isFallback: boolean; isReceipt: boolean; template: string }
export interface SetupInputs { branches: BranchInput; outlets: OutletInput; users: UserInput; categories: CategoryInput; items: ItemInput; tables: TableInput; printers: PrinterInput }
export type SetupKind = keyof SetupInputs;
export type SetupEntity = Branch | Outlet | User | Category | MenuItem | RestaurantTable | Printer;
