import { imsWindowsPrint } from '../../print-agent/ims-windows.mjs';
import type { PrintJob } from './types';

export const storageKey = 'hearth-pc-printing';
const bridgeUrl = 'http://127.0.0.1:17779';

export type NamedPrinter = { name: string; ip: string };
export type Connection = { key: string; pcId: string; printers: NamedPrinter[]; bills: string[]; categories: Record<string, string>; backgroundPaired?: boolean };
type BridgeStatus = { platform: string; ok: boolean; namedPrinters: boolean; defaultPrinter: string | null; printers: string[] };

export type ClaimedJob = PrintJob & { claim_token: string; paper_width: number; copies: number; payload: { lines?: Array<{ categoryId?: string; category_id?: string }> } };
export type PrintResult = { status: 'PRINTED' | 'FAILED' | 'UNCERTAIN'; message: string };

export function pcPrinting(): Connection | null {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null'); }
  catch { return null; }
}

export async function bridge<T>(path: string, key: string, body?: object): Promise<T> {
  const headers = { 'X-Bridge-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(bridgeUrl + path, { method: body ? 'POST' : 'GET', headers, credentials: 'omit', redirect: 'error',
    signal: AbortSignal.timeout(body ? 45000 : 5000), body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Windows print bridge rejected the request.');
  return result;
}

export async function posBridgeStatus(key: string) {
  const status = await bridge<BridgeStatus>('/api/bridge/status', key);
  if (!status.ok || status.platform !== 'WINDOWS' || !status.namedPrinters || !Array.isArray(status.printers))
    throw new Error('The POS Windows print bridge is unavailable.');
  return status;
}

export async function pcBridgeReady(config: Connection) {
  await posBridgeStatus(config.key);
}

type PrintLine = NonNullable<ClaimedJob['payload']['lines']>[number];

export async function dispatchPcPrint(config: Connection, job: ClaimedJob): Promise<PrintResult> {
  let status: BridgeStatus;
  try { status = await posBridgeStatus(config.key); }
  catch { return { status: 'FAILED', message: 'The POS Windows bridge could not be reached before printing.' }; }

  const installed = new Map(status.printers.map(name => [name.toLowerCase(), name]));
  const linesByPrinter = new Map<string, PrintLine[]>();
  const isKot = job.document_type === 'KOT' || job.document_type === 'KOT_CANCEL';
  const isBill = job.document_type?.startsWith('BILL') ?? false;
  const billPrinters = isBill && config.bills.length ? config.bills : [''];
  const lines = job.payload.lines;
  const routes = isKot && lines?.length
    ? lines.map(line => ({ printer: config.categories[line.categoryId ?? line.category_id ?? ''] ?? '', lines: [line] }))
    : billPrinters.map(printer => ({ printer, lines: lines ?? [] }));
  for (const route of routes) {
    const name = route.printer || status.defaultPrinter;
    const printer = name && installed.get(name.toLowerCase());
    if (!printer) {
      return {
        status: 'FAILED',
        message: name ? 'Windows printer is unavailable: ' + name : 'Set a Windows default printer or assign a printer.',
      };
    }
    const group = linesByPrinter.get(printer);
    if (group) {
      if (isKot) group.push(...route.lines);
    } else linesByPrinter.set(printer, [...route.lines]);
  }

  const request: typeof fetch = (url, options) => fetch(url, { ...options, credentials: 'omit' });
  let completed = 0;
  for (const [printerName, targetLines] of linesByPrinter) {
    const document = { ...job, payload: { ...job.payload, lines: targetLines } };
    for (let copy = 1; copy <= Math.max(1, job.copies); copy++) {

      const result = await imsWindowsPrint({
        key: config.key, port: 17779, printerName, targetKey: printerName.toLowerCase(),
      }, document, copy, request);
      if (result.status !== 'PRINTED') return { status: completed ? 'UNCERTAIN' : result.status, message: result.error };
      completed++;
    }
  }
  return { status: 'PRINTED', message: '' };
}
export async function localBackgroundStatus(key: string) {
  return bridge<{ paired: boolean; pcId?: string; branchId?: string; routes?: Pick<Connection, 'printers' | 'bills' | 'categories'> }>('/api/bridge/background', key);
}

export async function configureBackgroundPrinting(config: Connection, code?: string) {
  const { printers, bills, categories } = config;
  return bridge<{ paired: boolean; pcId?: string; branchId?: string; routes?: Pick<Connection, 'printers' | 'bills' | 'categories'> }>('/api/bridge/background', config.key, {
    code, routes: { printers, bills, categories },
  });
}
