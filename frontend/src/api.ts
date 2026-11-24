import { pcPrinting, type ClaimedJob, type PrintResult } from './pcPrinting';
import type { AddItem, Bill, BillGroup, Catalog, CreateOrder, Dashboard, DateRange, ID, Kot, MenuImportPreview, MenuImportRow, Order, Payment, PrintJob, Report, ReportType, RoutingPreview, Session, Settings, SetupInputs, SetupKind, Steward, Tenant } from './types';

export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = 'NETWORK_ERROR', public requestId?: string, public fieldErrors: Record<string, string> = {}) { super(message); this.name = 'ApiError'; }
  get uncertain() { return this.status === 0 || this.status >= 500; }
}
let csrfToken = '';
let expired: (() => void) | undefined;
// Memory only. An identical mutation retains its key until a definitive response.
const pendingKeys = new Map<string, string>();
export function configureSession(token: string, onExpired?: () => void) { csrfToken = token; expired = onExpired; }
export function clearSession() { csrfToken = ''; pendingKeys.clear(); }
function query(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') q.set(key, String(value)); });
  return `?${q.toString()}`;
}
async function request<T>(path: string, method = 'GET', body?: unknown, extraHeaders?: Record<string, string>, download = false): Promise<T> {
  const write = method !== 'GET';
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const localPc = pcPrinting()?.pcId;
  const signature = `${method}:${path}:${localPc ?? ''}:${serialized ?? ''}`;
  const headers: Record<string, string> = { Accept: download ? 'text/csv' : 'application/json', ...extraHeaders };

  if (localPc) headers['X-Local-Print-PC'] = localPc;
  if (serialized !== undefined) headers['Content-Type'] = 'application/json';
  if (write) {
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    if (!pendingKeys.has(signature)) pendingKeys.set(signature, crypto.randomUUID());
    headers['Idempotency-Key'] = pendingKeys.get(signature)!;
  }
  let response: Response;
  try { response = await fetch(`/api${path}`, { method, body: serialized, headers, credentials: 'include' }); }
  catch { throw new ApiError('The server could not be reached. A submitted action may have been accepted. Retry the same request before starting another.'); }
  if (!response.ok) {
    if (response.status < 500) pendingKeys.delete(signature);
    const problem = await response.json().catch(() => ({})) as { message?: string; code?: string; requestId?: string; fieldErrors?: Record<string, string> };
    if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/onboard')) expired?.();
    throw new ApiError(problem.message || `Request failed (${response.status}).`, response.status, problem.code, problem.requestId, problem.fieldErrors);
  }
  try {
    const value = download ? await response.blob() : response.status === 204 ? undefined : await response.json();
    pendingKeys.delete(signature);
    return value as T;
  } catch { throw new ApiError('The response was interrupted. Retry the same request to recover its result.'); }
}
const versionReason = (version: number, reason: string) => ({ version, reason });
export type BranchPrintState = {
  paired: boolean;
  online: boolean;
  jobs: Array<{ id: ID; reference_id?: ID; document_type: string; status: 'QUEUED' | 'SENT_TO_PRINTER' | 'FAILED' | 'NEEDS_REVIEW'; error?: string }>;
};
export const api = {
  printPcStatus: (outlet: ID, orderId?: ID) =>
    request<BranchPrintState>(`/print-device/outlets/${outlet}/status${query({ orderId })}`),
  createPrintPairing: (branch: ID) => request<{ code: string }>(`/print-device/branches/${branch}/pairing`, 'POST', {}),
  login: (body: { tenantSlug: string; email: string; password: string }) => request<Session>('/auth/login', 'POST', body),
  me: () => request<Session>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', 'POST', {}),
  onboard: (body: { businessName: string; slug: string; name: string; email: string; password: string }, key: string) => request<{ slug: string }>('/auth/onboard', 'POST', body, { 'X-Onboarding-Key': key }),
  profile: (name: string) => request<unknown>('/auth/profile', 'PATCH', { name }),
  password: (currentPassword: string, newPassword: string) => request<unknown>('/auth/password', 'POST', { currentPassword, newPassword }),
  catalog: (outletId: ID) => request<Catalog>(`/catalog${query({ outletId })}`),
  settings: () => request<Settings>('/settings'),
  saveNamedMaster: (kind: 'stewards' | 'nc-departments', body: { outletId: ID; name: string; active: boolean }, id?: ID) =>
    request<Steward>('/settings/' + kind + (id ? '/' + id : ''), id ? 'PUT' : 'POST', body),
  business: (body: { name: string; receiptAddress: string; taxNumber: string; phone: string; receiptFooter: string }) => request<Tenant>('/settings/business', 'PATCH', body),
  saveMenuMaster: (kind: 'units' | 'taxes', body: { outletId: ID; name: string; rate?: number }, id?: ID) =>
    request<{ id: ID }>('/settings/menu-masters/' + kind + (id ? '/' + id : ''), id ? 'PUT' : 'POST', body),
  previewMenuImport: (outletId: ID, rows: MenuImportRow[]) =>
    request<MenuImportPreview>('/settings/items/import/preview', 'POST', { outletId, rows }),
  confirmMenuImport: (outletId: ID, rows: MenuImportRow[]) =>
    request<{ imported: number }>('/settings/items/import/confirm', 'POST', { outletId, rows }),
  outletPrices: (body: { outletId: ID; changes: { itemId: ID; expectedPrice?: number; price?: number; expectedAvailable?: boolean; available?: boolean }[] }) =>
    request<{ updated: number }>('/settings/items/prices', 'PUT', body),
  saveSetup: <K extends SetupKind>(kind: K, body: SetupInputs[K], id?: ID) => request<{ id?: ID; ok?: boolean }>(`/settings/${kind}${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', body),
  routes: (outletId: ID, routes: { categoryId: ID; printerId: ID }[]) => request<{ ok: boolean }>('/settings/routes', 'PUT', { outletId, routes }),
  orders: (outletId: ID) => request<Order[]>(`/orders${query({ outletId, status: 'active' })}`),
  order: (id: ID) => request<Order>(`/orders/${id}`),
  createOrder: (body: CreateOrder) => request<Order>('/orders', 'POST', body),
  addItem: (id: ID, body: AddItem) => request<Order>(`/orders/${id}/items`, 'POST', body),
  editOrder: (id: ID, body: { version: number; notes?: string; customerName?: string; discount?: number }) => request<Order>(`/orders/${id}`, 'PATCH', body),
  editItem: (id: ID, itemId: ID, body: { version: number; quantity: number; notes?: string }) => request<Order>(`/orders/${id}/items/${itemId}`, 'PATCH', body),
  cancelItem: (id: ID, itemId: ID, version: number, reason?: string, quantity?: number) => request<Order>(`/orders/${id}/items/${itemId}/cancel`, 'POST', { version, reason, quantity }),
  transfer: (id: ID, version: number, tableId: ID, reason: string) => request<Order>(`/orders/${id}/transfer`, 'POST', { version, tableId, reason }),
  cancelOrder: (id: ID, version: number, reason: string) => request<Order>(`/orders/${id}/cancel`, 'POST', versionReason(version, reason)),
  send: (id: ID, version: number, nc?: { ncDepartmentId: ID; ncReason: string }) =>
    request<Order>(`/orders/${id}/send`, 'POST', { version, ...nc }),
  createBills: (id: ID, version: number, groups?: BillGroup[], ncBill = false) => request<Order>(`/orders/${id}/bills`, 'POST', { version, groups, ncBill }),
  kots: (outletId: ID) => request<Kot[]>(`/kots${query({ outletId })}`),
  kotStatus: (id: ID, status: string) => request<Kot>(`/kots/${id}/status`, 'POST', { status }),
  voidKotItems: (id: ID, body: { version: number; orderItemIds: ID[]; quantity: number; reason: string }) =>
    request<Order>(`/kots/${id}/void-items`, 'POST', body),
  cancelKot: (id: ID, reason: string) => request<Kot>(`/kots/${id}/cancel`, 'POST', { reason }),
  reprintKot: (id: ID, reason: string) => request<PrintJob>(`/kots/${id}/reprint`, 'POST', { reason }),
  bills: (outletId: ID) => request<Bill[]>(`/bills${query({ outletId })}`),
  bill: (id: ID) => request<Bill>(`/bills/${id}`),
  settle: (id: ID, version: number, payments: Payment[], cashTendered?: number) => request<Bill>(`/bills/${id}/settle`, 'POST', { version, payments, ...(cashTendered !== undefined ? { cashTendered } : {}) }),
  correctBillPayment: (id: ID, version: number, payments: Payment[], reason: string, cashTendered?: number) =>
    request<Bill>(`/bills/${id}/correct-payment`, 'POST', { payment: { version, payments, cashTendered }, reason }),
  reverseBill: (id: ID, version: number, reason: string, refundReference: string, reopen: boolean) =>
    request<Bill>(`/bills/${id}/reverse`, 'POST', { version, reason, refundReference, reopen }),
  cancelBill: (id: ID, version: number, reason: string) => request<Bill>(`/bills/${id}/cancel`, 'POST', versionReason(version, reason)),
  modifyBill: (id: ID, version: number, reason: string, discount: number) => request<Bill>(`/bills/${id}/modify`, 'POST', { version, reason, discount }),
  reprintBill: (id: ID, reason: string) => request<PrintJob>(`/bills/${id}/reprint`, 'POST', { reason }),
  claimLocalPrint: (outletId: ID) => request<{ jobs: ClaimedJob[] }>(`/printing/local/claim${query({ outletId })}`, 'POST', {}),
  acknowledgeLocalPrint: (id: ID, claimToken: string, result: PrintResult) =>
    request<unknown>(`/printing/jobs/${id}/ack`, 'POST', { claimToken, status: result.status, error: result.status === 'PRINTED' ? '' : result.message }),
  jobs: (outletId: ID) => request<PrintJob[]>(`/printing/jobs${query({ outletId })}`),
  testPrinter: (id: ID) => request<PrintJob>(`/printing/printers/${id}/test`, 'POST', {}),
  retryJob: (id: ID, reason: string) => request<PrintJob>(`/printing/jobs/${id}/retry`, 'POST', { reason }),
  preview: (outletId: ID, items: { menuItemId: ID; quantity: number }[]) => request<RoutingPreview>('/printing/preview', 'POST', { outletId, items }),
  dashboard: (branchId: ID | 'ALL', range: DateRange) => request<Dashboard>(`/dashboard${query({ branchId, ...range })}`),
  report: (type: ReportType, branchId: ID | 'ALL', outletId: ID | undefined, range: DateRange, page: number, size = 25) => request<Report>(`/reports/${type}${query({ branchId, outletId, ...range, page, size })}`),
};
