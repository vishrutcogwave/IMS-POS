import type { AddItem, Bill, BillGroup, Catalog, CreateOrder, Dashboard, DateRange, ID, Kot, Order, Payment, PrintJob, Report, ReportType, RoutingPreview, Session, Settings, SetupInputs, SetupKind, Tenant } from './types';

export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = 'NETWORK_ERROR', public requestId?: string) { super(message); this.name = 'ApiError'; }
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
  const signature = `${method}:${path}:${serialized ?? ''}`;
  const headers: Record<string, string> = { Accept: download ? 'text/csv' : 'application/json', ...extraHeaders };
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
    const problem = await response.json().catch(() => ({})) as { message?: string; code?: string; requestId?: string };
    if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/onboard')) expired?.();
    throw new ApiError(problem.message || `Request failed (${response.status}).`, response.status, problem.code, problem.requestId);
  }
  try {
    const value = download ? await response.blob() : response.status === 204 ? undefined : await response.json();
    pendingKeys.delete(signature);
    return value as T;
  } catch { throw new ApiError('The response was interrupted. Retry the same request to recover its result.'); }
}
const versionReason = (version: number, reason: string) => ({ version, reason });
export const api = {
  login: (body: { tenantSlug: string; email: string; password: string }) => request<Session>('/auth/login', 'POST', body),
  me: () => request<Session>('/auth/me'),
  logout: () => request<{ ok: boolean }>('/auth/logout', 'POST', {}),
  onboard: (body: { businessName: string; slug: string; name: string; email: string; password: string }, key: string) => request<{ slug: string }>('/auth/onboard', 'POST', body, { 'X-Onboarding-Key': key }),
  profile: (name: string) => request<unknown>('/auth/profile', 'PATCH', { name }),
  password: (currentPassword: string, newPassword: string) => request<unknown>('/auth/password', 'POST', { currentPassword, newPassword }),
  catalog: (outletId: ID) => request<Catalog>(`/catalog${query({ outletId })}`),
  settings: () => request<Settings>('/settings'),
  business: (body: { name: string; receiptAddress: string; taxNumber: string; phone: string; receiptFooter: string }) => request<Tenant>('/settings/business', 'PATCH', body),
  saveSetup: <K extends SetupKind>(kind: K, body: SetupInputs[K], id?: ID) => request<{ id?: ID; ok?: boolean }>(`/settings/${kind}${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', body),
  routes: (outletId: ID, routes: { categoryId: ID; printerId: ID }[]) => request<{ ok: boolean }>('/settings/routes', 'PUT', { outletId, routes }),
  orders: (outletId: ID) => request<Order[]>(`/orders${query({ outletId, status: 'active' })}`),
  order: (id: ID) => request<Order>(`/orders/${id}`),
  createOrder: (body: CreateOrder) => request<Order>('/orders', 'POST', body),
  addItem: (id: ID, body: AddItem) => request<Order>(`/orders/${id}/items`, 'POST', body),
  editOrder: (id: ID, body: { version: number; notes?: string; customerName?: string; discount?: number }) => request<Order>(`/orders/${id}`, 'PATCH', body),
  editItem: (id: ID, itemId: ID, body: { version: number; quantity: number; notes: string }) => request<Order>(`/orders/${id}/items/${itemId}`, 'PATCH', body),
  cancelItem: (id: ID, itemId: ID, version: number, reason: string) => request<Order>(`/orders/${id}/items/${itemId}/cancel`, 'POST', versionReason(version, reason)),
  transfer: (id: ID, version: number, tableId: ID, reason: string) => request<Order>(`/orders/${id}/transfer`, 'POST', { version, tableId, reason }),
  cancelOrder: (id: ID, version: number, reason: string) => request<Order>(`/orders/${id}/cancel`, 'POST', versionReason(version, reason)),
  send: (id: ID, version: number) => request<Order>(`/orders/${id}/send`, 'POST', { version }),
  createBills: (id: ID, version: number, groups?: BillGroup[]) => request<Order>(`/orders/${id}/bills`, 'POST', { version, ...(groups ? { groups } : {}) }),
  kots: (outletId: ID) => request<Kot[]>(`/kots${query({ outletId })}`),
  kotStatus: (id: ID, status: string) => request<Kot>(`/kots/${id}/status`, 'POST', { status }),
  cancelKot: (id: ID, reason: string) => request<Kot>(`/kots/${id}/cancel`, 'POST', { reason }),
  reprintKot: (id: ID, reason: string) => request<PrintJob>(`/kots/${id}/reprint`, 'POST', { reason }),
  bills: (outletId: ID) => request<Bill[]>(`/bills${query({ outletId })}`),
  bill: (id: ID) => request<Bill>(`/bills/${id}`),
  settle: (id: ID, version: number, payments: Payment[], cashTendered?: number) => request<Bill>(`/bills/${id}/settle`, 'POST', { version, payments, ...(cashTendered !== undefined ? { cashTendered } : {}) }),
  cancelBill: (id: ID, version: number, reason: string) => request<Bill>(`/bills/${id}/cancel`, 'POST', versionReason(version, reason)),
  modifyBill: (id: ID, version: number, reason: string, discount: number) => request<Bill>(`/bills/${id}/modify`, 'POST', { version, reason, discount }),
  reprintBill: (id: ID, reason: string) => request<PrintJob>(`/bills/${id}/reprint`, 'POST', { reason }),
  jobs: (outletId: ID) => request<PrintJob[]>(`/printing/jobs${query({ outletId })}`),
  testPrinter: (id: ID) => request<PrintJob>(`/printing/printers/${id}/test`, 'POST', {}),
  retryJob: (id: ID, reason: string) => request<PrintJob>(`/printing/jobs/${id}/retry`, 'POST', { reason }),
  preview: (outletId: ID, items: { menuItemId: ID; quantity: number }[]) => request<RoutingPreview>('/printing/preview', 'POST', { outletId, items }),
  dashboard: (outletId: ID, range: DateRange) => request<Dashboard>(`/dashboard${query({ outletId, ...range })}`),
  report: (type: ReportType, outletId: ID, range: DateRange, page: number) => request<Report>(`/reports/${type}${query({ outletId, ...range, page, size: 25 })}`),
  exportReport: (type: ReportType, outletId: ID, range: DateRange) => request<Blob>(`/reports/${type}/export${query({ outletId, ...range })}`, 'GET', undefined, undefined, true),
};
