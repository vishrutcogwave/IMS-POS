import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { render } from './renderer.mjs';
import { imsWindowsPrint } from './ims-windows.mjs';

const base = process.env.PRINT_API_URL || 'http://localhost:8080/api';
const address = new URL(base);
if (address.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) {
  throw new Error('Remote backend connections require HTTPS.');
}
const outletId = process.env.PRINT_OUTLET_ID;
const credentials = { tenantSlug: process.env.PRINT_TENANT, email: process.env.PRINT_EMAIL, password: process.env.PRINT_PASSWORD };
if (!outletId || Object.values(credentials).some(v => !v)) throw new Error('Set PRINT_OUTLET_ID, PRINT_TENANT, PRINT_EMAIL and PRINT_PASSWORD.');
const deviceFile = process.env.PRINT_DEVICES_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'devices.json');
const devices = JSON.parse(await fs.readFile(deviceFile, 'utf8'));
for (const [key, d] of Object.entries(devices)) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(key)) throw new Error('Invalid device alias.');
  if (d.type === 'tcp') {
    if (!net.isIP(d.host) || !Number.isInteger(d.port) || d.port < 1 || d.port > 65535) throw new Error(`Invalid TCP configuration for ${key}`);
  } else if (d.type === 'ims-windows') {
    d.port ??= 17777;
    d.key = process.env.PRINT_WINDOWS_BRIDGE_KEY?.trim();
    if (process.platform !== 'win32' || !d.key || !Number.isInteger(d.port) || d.port < 1 || d.port > 65535) {
      throw new Error('IMS Windows bridge requires Windows, a valid port and PRINT_WINDOWS_BRIDGE_KEY.');
    }
  } else if (d.type === 'windows') {
    if (process.platform !== 'win32' || typeof d.name !== 'string' || !d.name.trim() || /[\x00-\x1f]/.test(d.name)) throw new Error(`Invalid Windows printer for ${key}`);
  } else throw new Error(`Unsupported printer type for ${key}`);
}
let cookie = '';
let csrf = '';
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function api(endpoint, data) {
  const response = await fetch(base + endpoint, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), 'Idempotency-Key': crypto.randomUUID() },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (endpoint === '/auth/login' && response.ok) {
    const sessionCookies = response.headers.getSetCookie();
    cookie = sessionCookies.map(c => c.split(';')[0]).join('; ');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}


function tcpPrint(device, bytes) {
  return new Promise(resolve => {
    let wrote = false;
    let done = false;
    const socket = net.createConnection({ host: device.host, port: device.port });
    const finish = (status, error = '') => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ status, error });
    };
    socket.setTimeout(8000, () => finish(wrote ? 'UNCERTAIN' : 'FAILED', 'Printer transport timed out; verify physical output before retrying.'));
    socket.on('error', () => finish(wrote ? 'UNCERTAIN' : 'FAILED', 'Printer connection failed; check device and network.'));
    socket.on('connect', () => {
      wrote = true;
      socket.end(bytes, () => finish('PRINTED'));
    });
  });
}
async function windowsPrint(device, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hearth-print-'));
  const input = path.join(directory, 'ticket.bin');
  await fs.writeFile(input, bytes);
  try {
    return await new Promise(resolve => {
      const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'windows-raw.ps1');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper, '-PrinterName', device.name, '-InputFile', input], { windowsHide: true, stdio: 'ignore', timeout: 15000 });
      child.once('error', () => resolve({ status: 'UNCERTAIN', error: 'Windows spooler invocation failed. Check local output before retrying.' }));
      child.once('exit', code => resolve(code === 0 ? { status: 'PRINTED', error: '' } : { status: 'UNCERTAIN', error: 'Windows spooler did not confirm completion. Check local output before retrying.' }));
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

console.log('Hearth print agent starting. Transport acceptance does not guarantee paper output.');
while (!stopping) {
  try {
    if (!cookie) {
      const session = await api('/auth/login', credentials);
      csrf = session.csrfToken;
      if (!session.outlets.some(o => o.id === outletId)) throw new Error('Configured outlet is not assigned to this account.');
    }
    const { jobs } = await api('/printing/claim', { outletId, deviceKeys: Object.keys(devices) });
    for (const job of jobs) {
      const device = devices[job.device_key];
      let result = { status: 'FAILED', error: 'No local device mapping for this alias.' };
      if (device) {
        const bytes = device.type === 'ims-windows' ? null : render(job);
        const copies = Math.min(5, Math.max(1, Number(job.copies) || 1));
        result = { status: 'PRINTED', error: '' };
        for (let i = 0; i < copies; i++) {
          let copyResult;
          if (device.type === 'ims-windows') copyResult = await imsWindowsPrint(device, job, i + 1);
          else if (device.type === 'tcp') copyResult = await tcpPrint(device, bytes);
          else copyResult = await windowsPrint(device, bytes);
          if (copyResult.status !== 'PRINTED') {
            result = i > 0 ? { status: 'UNCERTAIN', error: 'Some copies may have printed. Verify output before retrying.' } : copyResult;
            break;
          }
        }
      }
      try {
        await api(`/printing/jobs/${job.id}/ack`, { claimToken: job.claim_token, ...result });
        console.log(`Job ${job.id}: ${result.status}`);
      } catch {
        console.error(`Job ${job.id}: acknowledgment lost. Do not resend; server will mark UNCERTAIN.`);
      }
      if (stopping) break;
    }
  } catch (error) {
    if (error.status === 401) { cookie = ''; csrf = ''; }
    console.error(`Agent: ${error.message}`);
  }
  if (!stopping) await new Promise(resolve => setTimeout(resolve, 4000));
}
if (cookie) await api('/auth/logout', {}).catch(() => {});
