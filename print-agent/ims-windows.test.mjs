import assert from 'node:assert/strict';
import test from 'node:test';
import { imsWindowsPrint } from './ims-windows.mjs';

const device = { port: 17777, key: 'test-only' };
const job = {
  id: 'sample-uuid',
  document_type: 'KOT',
  paper_width: 58,
  template: 'STANDARD',
  payload: { reference: 'K-1', table: 'T2', lines: [{ name: 'Thali', quantity: 2, notes: 'Less spicy' }] },
};

test('Windows bridge uses loopback, authenticated receipt payloads and stable per-copy keys', async () => {
  const keys = [];
  async function bridge(url, options) {
    assert.equal(url, 'http://127.0.0.1:17777/api/bridge/print');
    assert.equal(options.headers['X-Bridge-Key'], device.key);
    const payload = JSON.parse(options.body);
    assert.equal(payload.paperWidth, 'MM58');
    assert.equal(payload.platform, 'WINDOWS');
    assert.equal(payload.document.type, 'SALE_RECEIPT');
    assert.ok(payload.document.lines.some(line => line.text === '2 x Thali'));
    assert.ok(payload.document.lines.some(line => line.text.includes('Less spicy')));
    keys.push(payload.jobKey);
    return Response.json({ success: true });
  }
  for (const copy of [1, 2, 1]) {
    assert.equal((await imsWindowsPrint(device, job, copy, bridge)).status, 'PRINTED');
  }
  assert.notEqual(keys[0], keys[1]);
  assert.equal(keys[0], keys[2]);
});

test('Windows bridge distinguishes rejected requests from uncertain output', async () => {
  const rejected = async () => new Response(null, { status: 401 });
  const uncertain = async () => Response.json({ success: false });
  assert.equal((await imsWindowsPrint(device, job, 1, rejected)).status, 'FAILED');
  assert.equal((await imsWindowsPrint(device, job, 1, uncertain)).status, 'UNCERTAIN');
});
