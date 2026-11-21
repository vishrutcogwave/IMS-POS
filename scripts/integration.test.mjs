import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
const root = new URL('../', import.meta.url);
const env = { ...process.env };
for (const line of (await fs.readFile(new URL('.env', root), 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && env[match[1]] === undefined) env[match[1]] = match[2];
}
const base = env.TEST_API_URL || 'http://localhost:8080/api';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Integration tests only run against a local server.');
const suffix = crypto.randomBytes(4).toString('hex');
const password = crypto.randomBytes(20).toString('hex');
async function request(session, endpoint, body, method, headers = {}) {
  const response = await fetch(base + endpoint, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}), 'Idempotency-Key': crypto.randomUUID(), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}
async function ok(session, endpoint, body, method, headers) {
  const r = await request(session, endpoint, body, method, headers);
  assert.ok(r.status >= 200 && r.status < 300, `${method || (body ? 'POST' : 'GET')} ${endpoint}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function login(tenantSlug, email, pw = env.DEMO_PASSWORD) {
  const result = await request(null, '/auth/login', { tenantSlug, email, password: pw });
  assert.equal(result.status, 200, `Login failed for ${tenantSlug}: ${JSON.stringify(result.data)}`);
  const cookieHeader = result.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Strict/i);
  return { cookie: result.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), csrf: result.data.csrfToken, data: result.data };
}
function denied(result, statuses = [403, 404]) { assert.ok(statuses.includes(result.status), `Expected denial, got ${result.status}: ${JSON.stringify(result.data)}`); }

test('Real PostgreSQL tenant isolation and restaurant lifecycle', async t => {
  const a = await login('saffron', 'owner@saffron.test');
  const b = await login('coastal', 'owner@coastal.test');
  let outlet, secondOutlet, categoryA, categoryB, itemA, itemB, kitchen, drinks, receipt, table, order, cashier, printUser;
  await t.test('sessions require authentication, CSRF and correct origin', async () => {
    assert.equal((await request(null, '/auth/me')).status, 401);
    denied(await request(a, '/auth/profile', { name: 'Must not change' }, 'PATCH', { 'X-CSRF-Token': '' }), [403]);
    denied(await request(a, '/auth/profile', { name: 'Must not change' }, 'PATCH', { Origin: 'https://untrusted.invalid' }), [403]);
    assert.notEqual(a.data.tenant.id, b.data.tenant.id);
    assert.ok(a.data.outlets.every(x => !b.data.outlets.some(y => y.id === x.id)));
  });
  await t.test('controlled onboarding, profile and password rotation revoke old sessions', async () => {
    const body = { businessName: `Onboarding ${suffix}`, slug: `verify-${suffix}`, name: 'New owner', email: `owner-${suffix}@example.test`, password };
    denied(await request(null, '/auth/onboard', body, 'POST', { 'X-Onboarding-Key': 'wrong-key' }), [403]);
    await ok(null, '/auth/onboard', body, 'POST', { 'X-Onboarding-Key': env.APP_ONBOARDING_KEY });
    const fresh = await login(body.slug, body.email, password);
    assert.equal(fresh.data.outlets.length, 1);
    await ok(fresh, '/auth/profile', { name: 'Updated owner' }, 'PATCH');
    assert.equal((await ok(fresh, '/auth/me')).user.name, 'Updated owner');
    const newPassword = crypto.randomBytes(20).toString('hex');
    await ok(fresh, '/auth/password', { currentPassword: password, newPassword });
    assert.equal((await request(fresh, '/auth/me')).status, 401);
    const changed = await login(body.slug, body.email, newPassword);
    assert.equal(changed.data.user.name, 'Updated owner');
    await ok(changed, '/auth/logout', {});
  });
  await t.test('RLS hides other tenant rows even when SQL omits tenant filter', async () => {
    const url = new URL(env.DB_URL.replace(/^jdbc:/, ''));
    const db = new pg.Client({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), user: env.DB_USERNAME, password: env.DB_PASSWORD });
    await db.connect();
    try {
      const role = (await db.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
      assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
      assert.equal(Number((await db.query('select count(*) as n from menu_items')).rows[0].n), 0);
      await db.query('begin');
      await db.query("select set_config('app.tenant_id',$1,true)", [a.data.tenant.id]);
      const rows = (await db.query('select distinct tenant_id from menu_items')).rows;
      assert.deepEqual(rows.map(x => x.tenant_id), [a.data.tenant.id]);
      assert.equal((await db.query('select id from outlets where id=$1', [b.data.outlets[0].id])).rowCount, 0);
      await db.query('rollback');
    } finally { await db.end(); }
  });
  await t.test('create isolated restaurant setup with per-outlet menu and printers', async () => {
    const branch = await ok(a, '/settings/branches', { name: `Verification ${suffix}`, address: 'Local automated verification' });
    const config = { branchId: branch.id, name: `Dining ${suffix}`, serviceModes: ['DINE_IN','TAKEAWAY'], paymentMethods: ['CASH','CARD','UPI'], currency: 'INR', timezone: 'Asia/Kolkata' };
    outlet = await ok(a, '/settings/outlets', config);
    secondOutlet = await ok(a, '/settings/outlets', { ...config, name: `Restricted ${suffix}` });
    categoryA = await ok(a, '/settings/categories', { outletId: outlet.id, name: 'Main kitchen', department: 'Hot kitchen', sortOrder: 1 });
    categoryB = await ok(a, '/settings/categories', { outletId: outlet.id, name: 'Beverages', department: 'Drinks', sortOrder: 2 });
    const item = { outletId: outlet.id, categoryId: categoryA.id, name: 'Test thali', description: '', price: 100, taxRate: 5, available: true, vegetarian: true, variants: [{ name: 'Large', price: 150 }], modifiers: [{ name: 'Extra rice', price: 20 }] };
    itemA = await ok(a, '/settings/items', item);
    itemB = await ok(a, '/settings/items', { ...item, categoryId: categoryB.id, name: 'Test lassi', price: 80, variants: [], modifiers: [] });
    table = await ok(a, '/settings/tables', { outletId: outlet.id, name: 'T1', section: 'Dining', seats: 4 });
    const printer = { outletId: outlet.id, name: 'Kitchen', deviceKey: 'test-kitchen', documentType: 'KOT', paperWidth: 80, copies: 1, enabled: true, isFallback: false, isReceipt: false, template: 'STANDARD' };
    kitchen = await ok(a, '/settings/printers', printer);
    drinks = await ok(a, '/settings/printers', { ...printer, name: 'Drinks', deviceKey: 'test-drinks' });
    receipt = await ok(a, '/settings/printers', { ...printer, name: 'Receipt', deviceKey: 'test-receipt', documentType: 'BILL', isReceipt: true });
    await ok(a, '/settings/users', { name: 'Verification cashier', email: `cashier-${suffix}@saffron.test`, password, role: 'CASHIER', outletIds: [outlet.id] });
    cashier = await login('saffron', `cashier-${suffix}@saffron.test`, password);
    await ok(a, '/settings/users', { name: 'Verification print agent', email: `printer-${suffix}@saffron.test`, password, role: 'KITCHEN', outletIds: [outlet.id] });
    printUser = await login('saffron', `printer-${suffix}@saffron.test`, password);
  });
  await t.test('reject tenant, outlet, role and parent-ID tampering', async () => {
    denied(await request(b, `/catalog?outletId=${outlet.id}`));
    denied(await request(cashier, `/catalog?outletId=${secondOutlet.id}`));
    denied(await request(cashier, '/settings/branches', { name: 'Unauthorized', address: '' }), [403]);
    denied(await request(cashier, '/settings/users', { name: 'Escalation', email: 'nobody@example.test', password, role: 'OWNER', outletIds: [outlet.id] }), [403]);
    denied(await request(b, `/settings/printers/${kitchen.id}`, { outletId: b.data.outlets[0].id, name: 'Tampered', deviceKey: 'x', documentType: 'KOT', paperWidth: 80, copies: 1, enabled: true, isFallback: false, isReceipt: false, template: 'STANDARD' }, 'PUT'));
    denied(await request(a, '/settings/items', { outletId: outlet.id, categoryId: b.data.outlets[0].id, name: 'Bad parent', price: 100, taxRate: 5, available: true, vegetarian: true, variants: [], modifiers: [] }), [400,403,404,422]);
  });
  await t.test('table session uniqueness and exact immutable item variants', async () => {
    order = await ok(a, '/orders', { outletId: outlet.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 2, notes: 'Verification only', customerName: '' });
    denied(await request(a, '/orders', { outletId: outlet.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 2, notes: '', customerName: '' }), [409]);
    denied(await request(a, '/orders', { outletId: outlet.id, serviceMode: 'DELIVERY', covers: 1, notes: '', customerName: '' }), [400,422]);
    order = await ok(a, `/orders/${order.id}/items`, { version: order.version, menuItemId: itemA.id, quantity: 2, variant: '', modifiers: [], notes: 'Less spicy' });
    const oldVersion = order.version;
    order = await ok(a, `/orders/${order.id}/items`, { version: order.version, menuItemId: itemB.id, quantity: 1, variant: '', modifiers: [], notes: '' });
    denied(await request(a, `/orders/${order.id}/items`, { version: oldVersion, menuItemId: itemA.id, quantity: 1, variant: '', modifiers: [], notes: '' }), [409]);
    denied(await request(cashier, `/orders/${order.id}`, { version: order.version, notes: '', customerName: '', discount: 20 }, 'PATCH'), [403]);
    assert.equal(Number(order.subtotal), 280); assert.equal(Number(order.total), 294);
    denied(await request(b, `/orders/${order.id}`));
    denied(await request(b, `/orders/${order.id}/items`, { version: order.version, menuItemId: itemB.id, quantity: 1, variant: '', modifiers: [], notes: '' }));
  });
  await t.test('unmapped routing fails atomically without losing any items', async () => {
    const preview = await ok(a, '/printing/preview', { outletId: outlet.id, items: [{ menuItemId: itemA.id, quantity: 2 }, { menuItemId: itemB.id, quantity: 1 }] });
    assert.ok(preview.unmapped.length > 0);
    denied(await request(a, `/orders/${order.id}/send`, { version: order.version }), [422]);
    const unchanged = await ok(a, `/orders/${order.id}`);
    assert.equal(unchanged.version, order.version);
    assert.ok(unchanged.items.every(i => Number(i.sent_quantity) === 0));
    assert.equal(unchanged.kots.length, 0);
    await ok(a, '/settings/routes', { outletId: outlet.id, routes: [{ categoryId: categoryA.id, printerId: kitchen.id }, { categoryId: categoryB.id, printerId: drinks.id }] }, 'PUT');
  });
  await t.test('category split KOT is idempotent and snapshots both printer groups', async () => {
    const key = crypto.randomUUID();
    const version = order.version;
    order = await ok(a, `/orders/${order.id}/send`, { version }, 'POST', { 'Idempotency-Key': key });
    const again = await ok(a, `/orders/${order.id}/send`, { version }, 'POST', { 'Idempotency-Key': key });
    assert.equal(again.version, order.version); assert.equal(order.kots.length, 2);
    assert.ok(order.items.every(i => Number(i.sent_quantity) === Number(i.quantity)));
    const jobs = await ok(a, `/printing/jobs?outletId=${outlet.id}`);
    assert.equal(jobs.filter(j => j.document_type === 'KOT').length, 2);
    assert.ok(jobs.every(j => j.status === 'PENDING'));
    denied(await request(a, `/orders/${order.id}/send`, { version: order.version }, 'POST', { 'Idempotency-Key': key }), [409]);
    denied(await request(a, `/orders/${order.id}/items/${order.items[0].id}`, { version: order.version, quantity: 5, notes: '' }, 'PATCH'), [400,409,422]);
  });
  await t.test('printer claims enforce tenant, outlet, claimant and retry rules', async () => {
    const claimed = await ok(printUser, '/printing/claim', { outletId: outlet.id, deviceKeys: ['test-kitchen'] });
    assert.equal(claimed.jobs.length, 1);
    const job = claimed.jobs[0];
    denied(await request(b, `/printing/jobs/${job.id}/ack`, { claimToken: job.claim_token, status: 'PRINTED', error: '' }));
    denied(await request(cashier, `/printing/jobs/${job.id}/ack`, { claimToken: job.claim_token, status: 'PRINTED', error: '' }), [403,404,409]);
    denied(await request(printUser, `/printing/jobs/${job.id}/ack`, { claimToken: crypto.randomUUID(), status: 'PRINTED', error: '' }), [403,409]);
    await ok(printUser, `/printing/jobs/${job.id}/ack`, { claimToken: job.claim_token, status: 'FAILED', error: 'Automated test: no hardware connected' });
    const retried = await ok(a, `/printing/jobs/${job.id}/retry`, { reason: 'Automated test verified no physical output; possible duplicate output acknowledged.' });
    assert.equal(retried.status, 'PENDING');
    assert.equal(retried.original_job_id, job.id);
  });
  await t.test('item-quantity split bills conserve tax, discount and allocations', async () => {
    order = await ok(a, `/orders/${order.id}`, { version: order.version, notes: 'Verification only', customerName: '', discount: 10 }, 'PATCH');
    const ai = order.items.find(i => i.menu_item_id === itemA.id);
    const bi = order.items.find(i => i.menu_item_id === itemB.id);
    order = await ok(a, `/orders/${order.id}/bills`, { version: order.version, groups: [{ items: [{ itemId: ai.id, quantity: 1 }] }, { items: [{ itemId: ai.id, quantity: 1 }, { itemId: bi.id, quantity: 1 }] }] });
    assert.equal(order.bills.length, 2);
    assert.equal(Math.round(order.bills.reduce((sum, x) => sum + Number(x.total), 0) * 100), 28350);
    assert.equal(order.status, 'BILL_PENDING');
  });
  await t.test('settlement rejects imbalance, is exactly once, and releases table only after all splits', async () => {
    const first = await ok(a, `/bills/${order.bills[0].id}`);
    denied(await request(a, `/bills/${first.id}/settle`, { version: first.version, payments: [{ method: 'CASH', amount: 1, reference: '' }] }), [400,422]);
    denied(await request(b, `/bills/${first.id}`));
    const total = Number(first.total);
    const cash = Math.min(50, total);
    const payments = [{ method: 'CASH', amount: cash, reference: '' }, ...(total > cash ? [{ method: 'UPI', amount: Number((total-cash).toFixed(2)), reference: `confirmed-${suffix}` }] : [])];
    const body = { version: first.version, payments, cashTendered: cash + 20 };
    const key = crypto.randomUUID();
    const paid = await ok(a, `/bills/${first.id}/settle`, body, 'POST', { 'Idempotency-Key': key });
    assert.equal(paid.status, 'PAID'); assert.equal(Number(paid.change), 20);
    const duplicate = await ok(a, `/bills/${first.id}/settle`, body, 'POST', { 'Idempotency-Key': key });
    assert.equal(duplicate.payments.length, paid.payments.length);
    assert.equal((await ok(a, `/orders/${order.id}`)).status, 'BILL_PENDING');
    const second = await ok(a, `/bills/${order.bills[1].id}`);
    denied(await request(a, `/bills/${second.id}/cancel`, { version: second.version, reason: 'Must not cancel partly settled split' }), [409,422]);
    await ok(a, `/bills/${second.id}/settle`, { version: second.version, payments: [{ method: 'CASH', amount: Number(second.total), reference: '' }], cashTendered: Number(second.total) });
    order = await ok(a, `/orders/${order.id}`);
    assert.equal(order.status, 'SETTLED');
    const catalog = await ok(a, `/catalog?outletId=${outlet.id}`);
    assert.ok(!catalog.tables.find(x => x.id === table.id).active_order_id);
    await ok(a, `/bills/${first.id}/reprint`, { reason: 'Verification receipt copy' });
    denied(await request(b, `/bills/${first.id}/reprint`, { reason: 'Cross-tenant copy' }));
  });
  await t.test('transfer, kitchen cancellation and unpaid bill modification preserve history', async () => {
    const target = await ok(a, '/settings/tables', { outletId: outlet.id, name: 'T2', section: 'Dining', seats: 4 });
    let other = await ok(a, '/orders', { outletId: outlet.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 2, notes: '', customerName: '' });
    other = await ok(a, `/orders/${other.id}/transfer`, { version: other.version, tableId: target.id, reason: 'Guest requested a different table' });
    assert.equal(other.table_id, target.id);
    other = await ok(a, `/orders/${other.id}/items`, { version: other.version, menuItemId: itemA.id, quantity: 1, variant: 'Large', modifiers: ['Extra rice'], notes: 'Separate preparation' });
    assert.equal(Number(other.subtotal), 170);
    other = await ok(a, `/orders/${other.id}/send`, { version: other.version });
    const kot = other.kots[0];
    await ok(a, `/kots/${kot.id}/status`, { status: 'PREPARING' });
    await ok(a, `/kots/${kot.id}/status`, { status: 'READY' });
    await ok(a, `/kots/${kot.id}/reprint`, { reason: 'Kitchen needs an additional copy' });
    denied(await request(cashier, `/kots/${kot.id}/cancel`, { reason: 'Unauthorized cancellation' }), [403]);
    await ok(a, `/kots/${kot.id}/cancel`, { reason: 'Guest changed this selection' });
    const cancelledJobs = await ok(a, `/printing/jobs?outletId=${outlet.id}`);
    const staleTicket = cancelledJobs.find(j => j.reference_id === kot.id && j.document_type === 'KOT' && !j.original_job_id);
    assert.equal(staleTicket.status, 'FAILED');
    denied(await request(a, `/printing/jobs/${staleTicket.id}/retry`, { reason: 'I acknowledge duplicate output' }), [409]);
    other = await ok(a, `/orders/${other.id}`);
    assert.equal(Number(other.subtotal), 0);
    other = await ok(a, `/orders/${other.id}/items`, { version: other.version, menuItemId: itemA.id, quantity: 1, variant: '', modifiers: [], notes: '' });
    other = await ok(a, `/orders/${other.id}/send`, { version: other.version });
    other = await ok(a, `/orders/${other.id}/bills`, { version: other.version });
    let invoice = await ok(a, `/bills/${other.bills.find(x => x.status !== 'CANCELLED').id}`);
    invoice = await ok(a, `/bills/${invoice.id}/modify`, { version: invoice.version, reason: 'Manager approved guest discount', discount: 10 });
    assert.equal(Number(invoice.total), 94.5);
    await ok(a, `/bills/${invoice.id}/cancel`, { version: invoice.version, reason: 'Guest cancelled before payment' });
    other = await ok(a, `/orders/${other.id}`);
    assert.equal(other.status, 'OPEN');
    await ok(a, `/orders/${other.id}/cancel`, { version: other.version, reason: 'Close unpaid cancelled test session' });
    const history = await ok(a, `/orders/${other.id}`);
    assert.equal(history.status, 'CANCELLED');
    assert.ok(history.bills.some(x => x.status === 'CANCELLED'));
  });
  await t.test('simultaneous table creation permits exactly one open order', async () => {
    const fresh = await ok(a, '/settings/tables', { outletId: outlet.id, name: 'Concurrent', section: 'Dining', seats: 2 });
    const body = { outletId: outlet.id, serviceMode: 'DINE_IN', tableId: fresh.id, covers: 1, notes: '', customerName: '' };
    const results = await Promise.all([request(a, '/orders', body), request(a, '/orders', body)]);
    assert.equal(results.filter(r => r.status >= 200 && r.status < 300).length, 1);
    assert.equal(results.filter(r => r.status === 409).length, 1);
    const created = results.find(r => r.status >= 200 && r.status < 300).data;
    await ok(a, `/orders/${created.id}/cancel`, { version: created.version, reason: 'Concurrency verification finished' });
  });
  await t.test('reports/export are real, tenant scoped and restricted to assigned outlets', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const query = `outletId=${outlet.id}&from=${today}&to=${today}`;
    const dashboard = await ok(a, `/dashboard?${query}`);
    assert.equal(Number(dashboard.sales), 283.5);
    assert.equal(Number(dashboard.billCount), 2);
    for (const type of ['daily-sales','item-sales','category-sales','outlet-sales','payments','kot-register','kot-cancellations','bill-reprints','bill-cancellations','bill-modifications','table-activity','tax-settlement']) {
      const report = await ok(a, `/reports/${type}?${query}&page=0&size=10`);
      assert.ok(Array.isArray(report.rows), `${type} rows`);
      assert.ok(Number.isFinite(Number(report.totalElements)), `${type} pagination`);
      denied(await request(b, `/reports/${type}?${query}`));
    }
    const csv = await request(a, `/reports/daily-sales/export?${query}`);
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /csv/);
    denied(await request(b, `/reports/daily-sales/export?${query}`));
    denied(await request(cashier, `/reports/daily-sales?${query}`), [403]);
  });
  await t.test('logout revokes server session', async () => {
    await ok(cashier, '/auth/logout', {});
    assert.equal((await request(cashier, '/auth/me')).status, 401);
  });
});
