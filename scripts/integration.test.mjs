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
const databaseUrl = new URL(env.DB_URL.replace(/^jdbc:/, ''));
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)) {
  throw new Error('Integration tests only run against local PostgreSQL.');
}
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
  const testStore = { businessName: 'Local QA ' + suffix, slug: 'lifecycle-' + suffix, name: 'QA Owner',
    email: 'qa-owner-' + suffix + '@example.test', password };
  await ok(null, '/auth/onboard', testStore, 'POST', { 'X-Onboarding-Key': env.APP_ONBOARDING_KEY });
  const a = await login(testStore.slug, testStore.email, password);
  const b = await login('coastal', 'owner@coastal.test');
  let outlet, secondOutlet, categoryA, categoryB, itemA, itemB, kitchen, drinks, receipt, secondReceipt, table, order, cashier, printUser;
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
    const url = databaseUrl;
    const db = new pg.Client({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1), user: env.DB_USERNAME, password: env.DB_PASSWORD });
    await db.connect();
    try {
      const role = (await db.query('select rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
      assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
      assert.equal(Number((await db.query('select count(*) as n from outlets')).rows[0].n), 0);
      await db.query('begin');
      await db.query("select set_config('app.tenant_id',$1,true)", [a.data.tenant.id]);
      const rows = (await db.query('select distinct tenant_id from outlets')).rows;
      assert.deepEqual(rows.map(x => x.tenant_id), [a.data.tenant.id]);
      assert.equal((await db.query('select id from outlets where id=$1', [b.data.outlets[0].id])).rowCount, 0);
      await db.query('rollback');
    } finally { await db.end(); }
  });
  await t.test('create isolated restaurant setup with per-outlet menu and printers', async () => {
    const branch = await ok(a, '/settings/branches', { name: `Verification ${suffix}`, address: 'Local automated verification' });
    const renamed = await ok(a, '/settings/branches/' + branch.id, { name: 'Updated ' + suffix, address: 'Updated address' }, 'PUT');
    assert.equal(renamed.address, 'Updated address');
    denied(await request(b, '/settings/branches/' + branch.id, { name: 'Wrong property', address: '' }, 'PUT'));
    const config = { branchId: branch.id, name: `Dining ${suffix}`, serviceModes: ['DINE_IN','TAKEAWAY'], paymentMethods: ['CASH','CARD','UPI'], currency: 'INR', timezone: 'Asia/Kolkata' };
    outlet = await ok(a, '/settings/outlets', config);
    secondOutlet = await ok(a, '/settings/outlets', { ...config, name: `Restricted ${suffix}` });
    const group = await ok(a, '/settings/groups', { outletId: outlet.id, name: 'Food' });
    denied(await request(b, '/settings/groups', { outletId: outlet.id, name: 'Wrong property' }));
    denied(await request(a, '/settings/categories', { outletId: secondOutlet.id, groupId: group.id, name:'Wrong outlet', department:'Kitchen', sortOrder:0 }), [404]);
    categoryA = await ok(a, '/settings/categories', { outletId: outlet.id, groupId: group.id, name: 'Main kitchen', department: 'Hot kitchen', sortOrder: 1 });
    assert.equal(categoryA.group_id, group.id);
    categoryB = await ok(a, '/settings/categories', { outletId: outlet.id, name: 'Beverages', department: 'Drinks', sortOrder: 2 });
    const item = { outletId: outlet.id, categoryId: categoryA.id, name: 'Test thali', description: '', price: 100, taxRate: 5, available: true, vegetarian: true, variants: [{ name: 'Large', price: 150 }], modifiers: [{ name: 'Extra rice', price: 20 }] };
    itemA = await ok(a, '/settings/items', item);
    itemB = await ok(a, '/settings/items', { ...item, categoryId: categoryB.id, name: 'Test lassi', price: 80, variants: [], modifiers: [] });
    table = await ok(a, '/settings/tables', { outletId: outlet.id, name: 'T1', section: 'Dining', seats: 4 });
    const printer = { outletId: outlet.id, name: 'Kitchen', deviceKey: 'test-kitchen', documentType: 'KOT', paperWidth: 80, copies: 1, enabled: true, isFallback: false, isReceipt: false, template: 'STANDARD' };
    kitchen = await ok(a, '/settings/printers', printer);
    drinks = await ok(a, '/settings/printers', { ...printer, name: 'Drinks', deviceKey: 'test-drinks' });
    receipt = await ok(a, '/settings/printers', { ...printer, name: 'Receipt', deviceKey: 'test-receipt', documentType: 'BILL', isReceipt: true });
    secondReceipt = await ok(a, '/settings/printers', { ...printer, name: 'Second receipt', deviceKey: 'test-receipt-alt', documentType: 'BILL', isReceipt: true });
    await ok(a, '/settings/users', { name: 'Verification cashier', email: `cashier-${suffix}@saffron.test`, password, role: 'CASHIER', outletIds: [outlet.id] });
    cashier = await login(testStore.slug, `cashier-${suffix}@saffron.test`, password);
    await ok(a, '/settings/users', { name: 'Verification print agent', email: `printer-${suffix}@saffron.test`, password, role: 'KITCHEN', outletIds: [outlet.id] });
    printUser = await login(testStore.slug, `printer-${suffix}@saffron.test`, password);
  });
  await t.test('reject tenant, outlet, role and parent-ID tampering', async () => {
    denied(await request(b, `/catalog?outletId=${outlet.id}`));
    denied(await request(cashier, `/catalog?outletId=${secondOutlet.id}`));
    denied(await request(cashier, '/settings/branches', { name: 'Unauthorized', address: '' }), [403]);
    denied(await request(cashier, '/settings/users', { name: 'Escalation', email: 'nobody@example.test', password, role: 'OWNER', outletIds: [outlet.id] }), [403]);
    denied(await request(b, `/settings/printers/${kitchen.id}`, { outletId: b.data.outlets[0].id, name: 'Tampered', deviceKey: 'x', documentType: 'KOT', paperWidth: 80, copies: 1, enabled: true, isFallback: false, isReceipt: false, template: 'STANDARD' }, 'PUT'));
    denied(await request(a, '/settings/items', { outletId: outlet.id, categoryId: b.data.outlets[0].id, name: 'Bad parent', price: 100, taxRate: 5, available: true, vegetarian: true, variants: [], modifiers: [] }), [400,403,404,422]);
  });
  await t.test('owner provisions branch logins and controls each account capability', async () => {
    const branch = await ok(a, '/settings/branches', { name: 'Separate branch ' + suffix, address: '' });
    const otherBranch = await ok(a, '/settings/outlets', { branchId: branch.id, name: 'Separate outlet ' + suffix,
      serviceModes: ['TAKEAWAY'], paymentMethods: ['CASH'], currency: 'INR', timezone: 'Asia/Kolkata' });
    const email = 'branch-manager-' + suffix + '@saffron.test';
    const profile = { name: 'Branch manager test', email, role: 'MANAGER', outletIds: [outlet.id] };
    const create = { ...profile, password, permissions: ['DASHBOARD', 'ORDER'] };
    assert.equal((await request(a, '/settings/users', { ...create, outletIds: [outlet.id, otherBranch.id] })).status, 422);
    assert.equal((await request(a, '/settings/users', { ...create, role: 'WAITER', permissions: ['BILL'] })).status, 422);
    const created = await ok(a, '/settings/users', create);
    const manager = await login(testStore.slug, email, password);
    assert.deepEqual(manager.data.user.permissions, ['DASHBOARD', 'ORDER']);
    assert.deepEqual(manager.data.outlets.map(row => row.id), [outlet.id]);
    assert.equal((await request(manager, '/orders?outletId=' + outlet.id)).status, 200);
    denied(await request(manager, '/orders?outletId=' + otherBranch.id));
    denied(await request(manager, '/settings'), [403]);
    await ok(a, '/settings/users/' + created.id, { ...profile, active: true, permissions: ['USERS', 'SETTINGS'] }, 'PUT');
    assert.equal((await request(manager, '/auth/me')).status, 401);
    const updated = await login(testStore.slug, email, password);
    assert.equal((await request(updated, '/settings')).status, 200);
    assert.equal((await request(updated, '/orders?outletId=' + outlet.id)).status, 403);
    assert.equal((await request(updated, '/settings/users', { ...create, email: 'forbidden-' + email })).status, 403);
    assert.equal((await request(updated, '/settings/branches', { name: 'Forbidden', address: '' })).status, 403);
  });
  await t.test('bulk prices are atomic, outlet scoped and safe to retry', async () => {
    const updates = { outletId: outlet.id, changes: [{ itemId: itemA.id, expectedPrice: 100, price: 105 }] };
    const url = '/settings/items/prices';
    denied(await request(cashier, url, updates, 'PUT'), [403]);
    denied(await request(a, url, { ...updates, outletId: secondOutlet.id }, 'PUT'), [404]);
    denied(await request(b, url, updates, 'PUT'));
    const conflict = await request(a, url, { ...updates, changes: [...updates.changes,
      { itemId: itemB.id, expectedPrice: 1, price: 90 }] }, 'PUT');
    assert.equal(conflict.status, 409);
    assert.equal((await ok(a, url, updates, 'PUT')).updated, 1);
    assert.equal((await ok(a, url, updates, 'PUT')).updated, 0);
    assert.equal((await ok(a, url, { ...updates, changes: [{ itemId: itemA.id, expectedPrice: 105, price: 100 }] }, 'PUT')).updated, 1);
  });
  await t.test('outlet item imports preview and create only dependent menu masters', async () => {
    const row = { row: 2, name: 'Excel test ' + suffix, category: 'Import category', group: 'Import group', department: 'Pantry', description: '',
      price: 45.5, unit: 'Test portion', tax: 'Test GST', taxRate: 5, available: true, vegetarian: true, variants: [], modifiers: [] };
    const data = { outletId: secondOutlet.id, rows: [row] };
    const previewPath = '/settings/items/import/preview';
    const confirmPath = '/settings/items/import/confirm';
    denied(await request(cashier, previewPath, data), [403]);
    denied(await request(b, confirmPath, data));
    const invalid = { ...data, rows: [row, { ...row, row: 3, price: null, name: 'Invalid import' }] };
    const issues = await ok(a, previewPath, invalid);
    assert.ok(issues.issues.some(issue => issue.row === 3 && issue.field === 'price'));
    assert.equal((await request(a, confirmPath, invalid)).status, 422);
    const before = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    assert.equal(before.items.length, 0);
    assert.equal(before.categories.length, 0);
    assert.equal(before.units.length, 0);
    const checked = await ok(a, previewPath, data);
    assert.deepEqual(checked.groups, ['Import group']);
    assert.deepEqual(checked.categories, ['Import category']);
    assert.deepEqual(checked.units, ['Test portion']);
    assert.deepEqual(checked.taxes, ['Test GST']);
    assert.deepEqual(checked.issues, []);
    assert.equal((await ok(a, confirmPath, data)).imported, 1);
    const result = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    const imported = result.items.find(item => item.name === row.name);
    assert.equal(imported.category_id, result.categories[0].id);
    assert.equal(result.categories[0].group_id, result.groups.find(group => group.name === 'Import group').id);
    assert.equal(imported.unit_id, result.units[0].id);
    assert.equal(imported.tax_id, result.taxes[0].id);
    assert.equal(result.tables.length, before.tables.length);
    assert.equal(Number(imported.tax_rate), 5);
    assert.equal((await request(a, confirmPath, data)).status, 422);
    const unit = await ok(a, '/settings/menu-masters/units', { outletId: outlet.id, name: 'Main portion' });
    denied(await request(a, '/settings/menu-masters/units/' + unit.id, { outletId: secondOutlet.id, name: 'Wrong outlet' }, 'PUT'), [404]);
    await ok(a, '/settings/menu-masters/taxes/' + imported.tax_id, { outletId: secondOutlet.id, name: row.tax, rate: 12 }, 'PUT');
    const afterRate = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    assert.equal(Number(afterRate.items[0].tax_rate), 12);
    const otherCatalog = await ok(a, '/catalog?outletId=' + outlet.id);
    assert.ok(!otherCatalog.items.some(item => item.name === row.name));
  });
  await t.test('Windows PCs keep independent routes and can be selected as the default', async () => {
    const catalog = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    const category = catalog.categories[0];
    assert.ok(category);
    const printers = [{ alias: 'win-' + 'a'.repeat(32), name: 'Windows Counter' }, { alias: 'win-' + 'b'.repeat(32), name: 'Windows Copy' }];
    const setup = { outletId: secondOutlet.id, pcId: '1'.repeat(32), makeDefault: true, printers, kot: [{ categoryId: category.id, alias: printers[0].alias }],
      bills: printers.map(row => row.alias) };
    const endpoint = '/settings/windows-printer-routes';
    denied(await request(b, endpoint, setup, 'PUT'));
    denied(await request(a, endpoint, { ...setup, kot: [{ categoryId: categoryA.id, alias: printers[0].alias }] }, 'PUT'), [404]);
    assert.equal((await ok(a, '/catalog?outletId=' + secondOutlet.id)).printers.length, 0);
    await ok(a, endpoint, setup, 'PUT');
    await ok(a, endpoint, setup, 'PUT');
    const saved = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    assert.equal(saved.printers.filter(row => row.is_receipt).length, 2);
    assert.equal(saved.routes.length, 1);
    assert.equal(saved.routes[0].printer_id, saved.printers.find(row => row.device_key === printers[0].alias).id);
    const otherPrinter = { alias: 'win-' + 'c'.repeat(32), name: printers[0].name };
    const other = { ...setup, pcId: '2'.repeat(32), makeDefault: false, printers: [otherPrinter],
      kot: [{ categoryId: category.id, alias: otherPrinter.alias }], bills: [otherPrinter.alias] };
    await ok(a, endpoint, other, 'PUT');
    const two = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    assert.equal(two.routes.length, 2);
    assert.equal(two.printers.filter(row => row.pc_id === setup.pcId && row.is_receipt).length, 2);
    assert.equal(two.outlet.default_print_pc, setup.pcId);
    const routing = { outletId: secondOutlet.id, items: [{ menuItemId: catalog.items[0].id, quantity: 1 }] };
    const phone = await ok(a, '/printing/preview', routing);
    const workstation = await ok(a, '/printing/preview', routing, 'POST', { 'X-Print-PC': other.pcId });
    assert.equal(phone.groups[0].printer.device_key, printers[0].alias);
    assert.equal(workstation.groups[0].printer.device_key, otherPrinter.alias);
    await ok(a, endpoint, { ...other, makeDefault: true }, 'PUT');
    assert.equal((await ok(a, '/catalog?outletId=' + secondOutlet.id)).outlet.default_print_pc, other.pcId);
  });
  await t.test('one PC queues a three-category KOT and a two-category KOT to different printers', async () => {
    const pcId = '1'.repeat(32);
    const choices = ['Hot station', 'Cold station'].map((name, i) => ({ name, alias: 'win-' + String(i + 6).repeat(32) }));
    const groups = [];
    for (let i = 0; i < 5; i++) {
      const category = await ok(a, '/settings/categories', { outletId: secondOutlet.id, name: 'Split category ' + i, department: 'KOT', sortOrder: i });
      const item = await ok(a, '/settings/items', { outletId: secondOutlet.id, categoryId: category.id, name: 'Split item ' + i, description: '',
        price: 50, taxRate: 5, available: true, vegetarian: true, variants: [], modifiers: [] });
      groups.push({ categoryId: category.id, itemId: item.id, alias: choices[i < 3 ? 0 : 1].alias, name: item.name });
    }
    await ok(a, '/settings/windows-printer-routes', { outletId: secondOutlet.id, pcId, makeDefault: false, printers: choices,
      kot: groups.map(({ categoryId, alias }) => ({ categoryId, alias })), bills: [choices[0].alias] }, 'PUT');
    const table = await ok(a, '/settings/tables', { outletId: secondOutlet.id, name: 'Print split', section: 'Dining', seats: 4 });
    let order = await ok(a, '/orders', { outletId: secondOutlet.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 2, notes: '', customerName: '' });
    for (const { itemId } of groups) {
      order = await ok(a, '/orders/' + order.id + '/items', { version: order.version, menuItemId: itemId, quantity: 1, variant: '', modifiers: [], notes: '' });
    }
    order = await ok(a, '/orders/' + order.id + '/send', { version: order.version }, 'POST', { 'X-Print-PC': pcId });
    assert.equal(order.kots.length, 2);
    const kotIds = new Set(order.kots.map(kot => kot.id));
    const jobs = (await ok(a, '/printing/jobs?outletId=' + secondOutlet.id)).filter(job => kotIds.has(job.reference_id));
    assert.equal(jobs.length, 2);
    for (const choice of choices) {
      const job = jobs.find(job => job.device_key === choice.alias);
      const expected = groups.filter(group => group.alias === choice.alias).map(group => group.name).sort();
      assert.equal(job?.status, 'PENDING');
      assert.deepEqual(job.payload.lines.map(item => item.name).sort(), expected);
    }
    const originalOrder = await ok(a, '/orders/' + order.id + '/bills', { version: order.version });
    const originalBill = originalOrder.bills.find(bill => bill.status === 'OPEN');
    const cancelled = await ok(a, '/bills/' + originalBill.id + '/cancel', { version: originalBill.version, reason: 'Correct billed items' });
    assert.equal(cancelled.status, 'CANCELLED');
    order = await ok(a, '/orders/' + order.id);
    const removed = order.items.find(line => line.menu_item_id === groups[0].itemId);
    order = await ok(a, '/orders/' + order.id + '/items/' + removed.id + '/cancel', { version: order.version, reason: 'Guest removed dish' });
    assert.ok(order.items.find(line => line.id === removed.id).cancelled);
    const cancellations = (await ok(a, '/printing/jobs?outletId=' + secondOutlet.id)).filter(job => job.document_type === 'KOT_CANCEL');
    assert.equal(cancellations.length, 1);
    assert.equal(cancellations[0].device_key, choices[0].alias);
    const originalKotJob = jobs.find(job => job.device_key === choices[0].alias);
    assert.equal(cancellations[0].printer_id, originalKotJob.printer_id);
    assert.equal(cancellations[0].original_job_id, originalKotJob.id);
    assert.equal(cancellations[0].payload.title, 'VOID KOT');
    assert.equal(cancellations[0].payload.reason, 'Guest removed dish');
    assert.deepEqual(cancellations[0].payload.lines.map(line => line.name), [groups[0].name]);
    order = await ok(a, '/orders/' + order.id + '/items', { version: order.version, menuItemId: groups[4].itemId, quantity: 2, variant: '', modifiers: [], notes: '' });
    order = await ok(a, '/orders/' + order.id + '/send', { version: order.version }, 'POST', { 'X-Print-PC': pcId });
    order = await ok(a, '/orders/' + order.id + '/bills', { version: order.version });
    const replacement = await ok(a, '/bills/' + order.bills.find(bill => bill.status === 'OPEN').id);
    assert.notEqual(replacement.id, originalBill.id);
    assert.ok(replacement.items.every(line => line.name !== groups[0].name));
    assert.equal(replacement.items.filter(line => line.name === groups[4].name).reduce((sum, line) => sum + line.quantity, 0), 3);
    const target = '/bills/' + replacement.id;
    const printPc = { 'X-Print-PC': pcId };
    const paid = await ok(a, target + '/settle', { version: replacement.version, cashTendered: Number(replacement.total),
      payments: [{ method: 'CASH', amount: Number(replacement.total), reference: '' }] }, 'POST', printPc);
    const correction = { reason: 'Cash selected in error', payment: { version: paid.version,
      payments: [{ method: 'UPI', amount: Number(paid.total), reference: 'QA-UPI-RECEIPT' }] } };
    denied(await request(b, target + '/correct-payment', correction, 'POST', printPc));
    const corrected = await ok(a, target + '/correct-payment', correction, 'POST', printPc);
    assert.equal(corrected.bill_number, paid.bill_number);
    assert.equal(corrected.payments[0].method, 'UPI');
    assert.equal(corrected.receipt.title, 'CORRECTED RECEIPT');
    denied(await request(a, target + '/correct-payment', correction, 'POST', printPc), [409]);
    const refund = { version: corrected.version, reason: 'Guest requested refund', refundReference: 'QA-REFUND-REF', reopen: true };
    const reversed = await ok(a, target + '/reverse', refund);
    assert.equal(reversed.status, 'CANCELLED');
    assert.equal(reversed.payments[0].method, 'UPI');
    assert.equal(reversed.reversal.refund_reference, refund.refundReference);
    const beforeDelete = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    const removedPrinter = beforeDelete.printers.find(printer => printer.device_key === choices[0].alias);
    const removePrinter = '/settings/outlets/' + secondOutlet.id + '/printer-assignments/' + removedPrinter.id;
    denied(await request(b, removePrinter, undefined, 'DELETE'));
    assert.equal((await request(a, removePrinter, undefined, 'DELETE', { 'Content-Type': '' })).status, 415);
    await ok(a, removePrinter, {}, 'DELETE');
    const afterDelete = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    assert.equal(afterDelete.printers.find(printer => printer.id === removedPrinter.id).is_receipt, false);
    assert.ok(afterDelete.routes.every(route => route.printer_id !== removedPrinter.id));
    assert.ok(afterDelete.routes.some(route => route.pc_id === pcId));
    const preserved = await ok(a, '/printing/jobs?outletId=' + secondOutlet.id);
    assert.ok(preserved.some(job => job.id === jobs.find(job => job.device_key === choices[0].alias).id && job.status === 'PENDING'));
    denied(await request(a, target + '/reverse', refund), [409]);
    assert.equal((await ok(a, '/orders/' + order.id)).status, 'OPEN');
  });
  await t.test('NC departments, zero bills, branch sequences and KOT voids', async () => {
    const branch = await ok(a, '/settings/branches', { name: 'NC Verification', address: '' });
    const otherBranch = await ok(a, '/settings/branches', { name: 'Independent NC Verification', address: '' });
    async function prep(branchId, name) {
      const loc = await ok(a, '/settings/outlets', { branchId, name, serviceModes: ['DINE_IN'], paymentMethods: ['CASH'], currency: 'INR', timezone: 'Asia/Kolkata' });
      const category = await ok(a, '/settings/categories', { outletId: loc.id, name: 'Meals', department: 'KOT', sortOrder: 0 });
      const item = await ok(a, '/settings/items', { outletId: loc.id, categoryId: category.id, name: 'Staff Meal', description: '', price: 100, taxRate: 5,
        available: true, vegetarian: true, variants: [], modifiers: [] });
      await ok(a, '/settings/printers', { outletId: loc.id, name: 'Both', deviceKey: 'qa-nc', documentType: 'BOTH', paperWidth: 80, copies: 1,
        enabled: true, isFallback: true, isReceipt: true, template: 'STANDARD' });
      const department = await ok(a, '/settings/nc-departments', { outletId: loc.id, name: 'Staff meals', active: true });
      return { loc, item, department };
    }
    async function sent(setup, name, nc) {
      const table = await ok(a, '/settings/tables', { outletId: setup.loc.id, name, section: 'Dining', seats: 4 });
      let row = await ok(a, '/orders', { outletId: setup.loc.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 1, notes: '', customerName: '' });
      row = await ok(a, '/orders/' + row.id + '/items', { version: row.version, menuItemId: setup.item.id, quantity: 2, variant: '', modifiers: [], notes: '' });
      const send = '/orders/' + row.id + '/send';
      if (nc) {
        denied(await request(a, send, { version: row.version, ncDepartmentId: setup.department.id }), [422]);
        denied(await request(a, send, { version: row.version, ncDepartmentId: crypto.randomUUID(), ncReason: 'Wrong department' }), [422]);
      }
      return ok(a, send, { version: row.version, ...(nc ? { ncDepartmentId: setup.department.id, ncReason: 'Staff lunch' } : {}) });
    }
    async function makeBill(row, ncBill, expected) {
      const result = await ok(a, '/orders/' + row.id + '/bills', { version: row.version, ncBill });
      const bill = result.bills.find(entry => entry.status === 'OPEN');
      assert.equal(bill.bill_number, expected);
      assert.equal(Number(bill.total), ncBill ? 0 : 210);
      assert.equal(bill.non_chargeable, ncBill);
      return bill;
    }
    const first = await prep(branch.id, 'NC Counter One');
    const second = await prep(branch.id, 'NC Counter Two');
    const independent = await prep(otherBranch.id, 'NC Separate Branch');
    assert.ok((await ok(a, '/catalog?outletId=' + first.loc.id)).ncDepartments.some(row => row.id === first.department.id));
    denied(await request(b, '/settings/nc-departments', { outletId: first.loc.id, name: 'Wrong tenant', active: true }));
    const normalFirst = await sent(first, 'Regular', false);
    denied(await request(a, '/orders/' + normalFirst.id + '/bills', { version: normalFirst.version, ncBill: true }), [422]);
    await makeBill(normalFirst, false, 'BILL-1');
    await makeBill(await sent(second, 'Regular', false), false, 'BILL-2');
    await makeBill(await sent(independent, 'Regular', false), false, 'BILL-1');
    const nc = await sent(first, 'NC', true);
    assert.equal(Number(nc.total),0);
    assert.equal(nc.kots[0].nc_department_name,'Staff meals');
    assert.equal(nc.items[0].non_chargeable,true);
    const firstBill = await makeBill(nc, true, 'NC-BILL-1');
    await makeBill(await sent(second, 'NC', true), true, 'NC-BILL-2');
    await makeBill(await sent(independent, 'NC', true), true, 'NC-BILL-1');
    const completed = await ok(a, '/bills/' + firstBill.id + '/settle', { version: firstBill.version, payments: [] });
    assert.equal(completed.status,'PAID');
    assert.equal(completed.receipt.title,'NC BILL');
    assert.deepEqual(completed.payments,[]);
    const voidOrder = await sent(first, 'Void', true);
    const voidKot = voidOrder.kots[0];
    await ok(a, '/kots/' + voidKot.id + '/cancel', { reason: 'Duplicate staff meal' });
    await ok(a, '/settings/nc-departments/' + first.department.id, { outletId:first.loc.id,name:'Renamed department',active:false }, 'PUT');
    const query = '?outletId=' + first.loc.id + '&from=2020-01-01&to=2020-01-02';
    const day = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata' }).format(new Date());
    const dates = query.replace('2020-01-01',day).replace('2020-01-02',day);
    const report = await ok(a, '/reports/nc-kots' + dates);
    assert.equal(report.rows.length, 2);
    assert.ok(report.rows.every(row => row.department === 'Staff meals' && row.nc_reason === 'Staff lunch'));
    assert.equal(report.rows.find(row => row.id === voidKot.id).void_reason,'Duplicate staff meal');
    const printJobs = await ok(a,'/printing/jobs?outletId=' + first.loc.id);
    const originalJob = printJobs.find(job => job.reference_id === voidKot.id && job.document_type === 'KOT');
    const voidJob = printJobs.find(job => job.reference_id === voidKot.id && job.document_type === 'KOT_CANCEL');
    assert.equal(voidJob.printer_id, originalJob.printer_id);
    assert.equal(voidJob.original_job_id, originalJob.id);
    assert.equal(voidJob.payload.title, 'VOID KOT');
    assert.equal(voidJob.payload.originalReference, voidKot.kot_number);
    assert.equal(voidJob.payload.reason, 'Duplicate staff meal');
    assert.deepEqual(voidJob.payload.lines.map(line => line.name), ['Staff Meal']);
    assert.equal(voidJob.payload.lines[0].quantity,2);
    assert.ok(printJobs.some(job => job.reference_id === nc.kots[0].id && job.payload.ncDepartment === 'Staff meals'));
  });
  await t.test('table session uniqueness and exact immutable item variants', async () => {
    const steward = await ok(a, '/settings/stewards', { outletId: outlet.id, name: 'QA Waiter', active: true });
    const inactive = await ok(a, '/settings/stewards', { outletId: outlet.id, name: 'Inactive QA Steward', active: false });
    const other = await ok(a, '/settings/stewards', { outletId: secondOutlet.id, name: 'Other Outlet Steward', active: true });
    denied(await request(b, '/settings/stewards', { outletId: outlet.id, name: 'Cross-tenant steward', active: true }));
    const orderInput = { outletId: outlet.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 2, notes: 'Verification only', customerName: '' };
    denied(await request(a, '/orders', { ...orderInput, stewardId: inactive.id }), [422]);
    denied(await request(a, '/orders', { ...orderInput, stewardId: other.id }), [422]);
    assert.ok((await ok(a, '/catalog?outletId=' + outlet.id)).stewards.some(row => row.id === steward.id && row.active));
    order = await ok(a, '/orders', { ...orderInput, stewardId: steward.id });
    await ok(a, '/settings/stewards/' + steward.id, { outletId: outlet.id, name: 'Renamed QA Steward', active: false }, 'PUT');
    assert.equal((await ok(a, '/orders/' + order.id)).waiter_name, 'QA Waiter');
    assert.match(order.order_number, /^ORD-/);
    assert.equal(order.waiter_name, 'QA Waiter');
    const openOrders = await ok(a, '/orders?outletId=' + outlet.id);
    assert.equal(openOrders.find(row => row.id === order.id).order_number, order.order_number);
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
    assert.match(first.bill_number, /^BILL-/);
    assert.match(first.order_number, /^ORD-/);
    assert.equal(first.order.table_name, 'T1');
    assert.equal(first.change, undefined);
    const billList = await ok(a, '/bills?outletId=' + outlet.id);
    assert.equal(billList.find(bill => bill.id === first.id).bill_number, first.bill_number);
    const tickets = (await ok(a, '/kots?outletId=' + outlet.id)).filter(ticket => ticket.order_id === order.id);
    assert.equal(tickets.length, 2);
    assert.ok(tickets.every(ticket => /^KOT-/.test(ticket.kot_number)));
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
    const receipts = (await ok(a, '/printing/jobs?outletId=' + outlet.id)).filter(job =>
      job.document_type === 'BILL' && job.reference_id === first.id && !job.original_job_id);
    assert.deepEqual(receipts.map(job => job.printer_id).sort(), [receipt.id, secondReceipt.id].sort());
    assert.ok(receipts.every(job => job.payload.waiterName === 'QA Waiter' && job.payload.covers === 2));
    const second = await ok(a, `/bills/${order.bills[1].id}`);
    denied(await request(a, `/bills/${second.id}/cancel`, { version: second.version, reason: 'Must not cancel partly settled split' }), [409,422]);
    await ok(a, `/bills/${second.id}/settle`, { version: second.version, payments: [{ method: 'CARD', amount: Number(second.total), reference: 'receipt-card-' + suffix }] });
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
    assert.equal(other.status, 'CANCELLED');
    const released = await ok(a, '/catalog?outletId=' + outlet.id);
    assert.equal(released.tables.find(entry => entry.id === target.id).active_order_id, null);
    other = await ok(a, '/orders', { outletId: outlet.id, serviceMode: 'DINE_IN', tableId: target.id, covers: 2, notes: '', customerName: '' });
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
    for (const type of ['daily-sales','item-sales','category-sales','outlet-sales','payments','payment-details','kot-register','nc-kots','kot-cancellations','bill-reprints','bill-cancellations','bill-modifications','table-activity','tax-settlement']) {
      const report = await ok(a, `/reports/${type}?${query}&page=0&size=10`);
      assert.ok(Array.isArray(report.rows), `${type} rows`);
      assert.ok(Number.isFinite(Number(report.totalElements)), `${type} pagination`);
      denied(await request(b, `/reports/${type}?${query}`));
    }
    const detail = await ok(a, '/reports/payment-details?' + query + '&size=200');
    assert.equal(detail.rows.length, 3);
    assert.deepEqual(detail.rows.map(row => row.method).sort(), ['CARD','CASH','UPI']);
    assert.equal(Number(detail.totals.amount),283.5);
    assert.equal(Number(detail.paymentModes.find(row => row.method === 'CASH').total),50);
    assert.ok(detail.rows.some(row => row.method === 'CARD' && row.reference === 'receipt-card-' + suffix && row.bill_number));
    assert.ok(detail.rows.every(row => row.settled_at && row.order_number && row.table_name));
    for (const mode of detail.paymentModes) {
      const amounts=detail.rows.filter(row => row.method===mode.method);
      assert.equal(Number(mode.total), amounts.reduce((sum,row)=>sum+Number(row.amount),0));
      assert.equal(Number(mode.payment_count),amounts.length);
    }
    assert.equal(Number(dashboard.subtotal)-Number(dashboard.discount)+Number(dashboard.tax),283.5);
    assert.deepEqual(dashboard.payments, detail.paymentModes);
    const paymentExport = await request(a, '/reports/payment-details/export?' + query);
    assert.equal(paymentExport.status,200);
    assert.ok(paymentExport.data.includes('receipt-card-' + suffix));
    const kotExport = await request(a, '/reports/kot-register/export?' + query);
    assert.equal(kotExport.status,200);
    assert.match(kotExport.data,/name: Test/);
    assert.ok(!kotExport.data.includes('[{'));
    const outletReport = await ok(a, '/reports/outlet-sales?' + query + '&size=200');
    assert.equal(Number(outletReport.rows.find(row => row.outlet_id === outlet.id).total), 283.5);
    assert.equal(Number(outletReport.rows.find(row => row.outlet_id === secondOutlet.id).total), 0);
    assert.ok(!outletReport.rows.some(row => row.outlet_id === b.data.outlets[0].id));
    const accountantEmail = 'accountant-' + suffix + '@saffron.test';
    await ok(a, '/settings/users', { name: 'Verification accountant', email: accountantEmail, password, role: 'ACCOUNTANT', outletIds: [outlet.id] });
    const accountant = await login(testStore.slug, accountantEmail, password);
    const restricted = await ok(accountant, '/reports/outlet-sales?' + query);
    assert.deepEqual(restricted.rows.map(row => row.outlet_id), [outlet.id]);
    const csv = await request(a, `/reports/daily-sales/export?${query}`);
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /csv/);
    denied(await request(b, `/reports/daily-sales/export?${query}`));
    denied(await request(cashier, `/reports/daily-sales?${query}`), [403]);
  });
  await t.test('branch-wide printer settings use Windows default when assignments are empty', async () => {
    const pcId = '5'.repeat(32);
    const catalogBranch = (await ok(a, '/catalog?outletId=' + secondOutlet.id)).outlet.branch_id;
    const fallback = { alias: 'win-' + 'f'.repeat(32), name: 'Windows default printer' };
    const explicit = { alias: 'win-' + 'e'.repeat(32), name: 'Dedicated bill printer' };
    const endpoint = '/settings/branches/' + catalogBranch + '/windows-printer-routes';
    const setup = { pcId, makeDefault: false, defaultPrinter: fallback, printers: [], kot: [], bills: [] };
    await ok(a, endpoint, setup, 'PUT');
    const catalog = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    const routing = { outletId: secondOutlet.id, items: [{ menuItemId: catalog.items[0].id, quantity: 1 }] };
    const headers = { 'X-Print-PC': pcId };
    const preview = await ok(a, '/printing/preview', routing, 'POST', headers);
    assert.equal(preview.groups[0].printer.device_key, fallback.alias);
    const otherCatalog = await ok(a, '/catalog?outletId=' + outlet.id);
    assert.ok(otherCatalog.printers.some(printer => printer.device_key === fallback.alias && printer.is_fallback));

    await ok(a, endpoint, { ...setup, printers: [explicit], bills: [explicit.alias] }, 'PUT');
    const explicitSettings = await ok(a, '/catalog?outletId=' + secondOutlet.id);
    const receipt = explicitSettings.printers.find(printer => printer.device_key === explicit.alias);
    assert.ok(receipt.is_receipt);
    await ok(a, '/settings/branches/' + catalogBranch + '/printer-assignments/' + receipt.id, {}, 'DELETE');

    const table = await ok(a, '/settings/tables', { outletId: secondOutlet.id, name: 'Windows default QA', section: 'Dining', seats: 2 });
    let order = await ok(a, '/orders', { outletId: secondOutlet.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 1, notes: '', customerName: '' });
    order = await ok(a, '/orders/' + order.id + '/items', { version: order.version, menuItemId: catalog.items[0].id, quantity: 1, variant: '', modifiers: [], notes: '' });
    order = await ok(a, '/orders/' + order.id + '/send', { version: order.version }, 'POST', headers);
    const kotId = order.kots[0].id;
    order = await ok(a, '/orders/' + order.id + '/bills', { version: order.version }, 'POST', headers);
    const bill = order.bills.find(row => row.status === 'OPEN');
    const total = Number(bill.total);
    await ok(a, '/bills/' + bill.id + '/settle', { version: bill.version, cashTendered: total,
      payments: [{ method: 'CASH', amount: total, reference: '' }] }, 'POST', headers);
    const jobs = await ok(a, '/printing/jobs?outletId=' + secondOutlet.id);
    assert.equal(jobs.find(job => job.reference_id === bill.id && job.document_type === 'BILL')?.device_key, fallback.alias);
    assert.equal(jobs.find(job => job.reference_id === kotId && job.document_type === 'KOT')?.device_key, fallback.alias);

    const email = 'branch-print-' + suffix + '@local.invalid';
    await ok(a, '/settings/users', { name: 'Branch print QA', email, password,
      role: 'KITCHEN', outletIds: [outlet.id, secondOutlet.id], permissions: ['PRINT'] });
    const bridge = await login(testStore.slug, email, password);
    const keys = [fallback.alias, 'win-' + '9'.repeat(32)];
    assert.equal((await ok(bridge, '/printing/claim', { outletId: outlet.id, deviceKeys: keys })).jobs.length, 0);
    const claim = await ok(bridge, '/printing/claim', { outletId: secondOutlet.id, deviceKeys: keys });
    assert.equal(claim.jobs[0]?.reference_id, kotId);
  });
  await t.test('PC-local normal and NC KOT claims work across authorized outlets without pairing', async () => {
    const headers = { 'X-Local-Print-PC': '3'.repeat(32) };
    const endpoint = outletId => '/printing/local/claim?outletId=' + outletId;
    for (const location of [outlet, secondOutlet]) {
      const catalog = await ok(a, '/catalog?outletId=' + location.id);
      const item = catalog.items.find(row => row.available);
      const table = await ok(a, '/settings/tables', { outletId: location.id, name: 'PC-local QA', section: 'Dining', seats: 2 });
      let order = await ok(a, '/orders', { outletId: location.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 1, notes: '', customerName: '' });
      order = await ok(a, '/orders/' + order.id + '/items', { version: order.version, menuItemId: item.id, quantity: 1, variant: '', modifiers: [], notes: '' });
      const unsentId = order.items.find(line => !line.cancelled).id;
      order = await ok(a, '/orders/' + order.id + '/items/' + unsentId + '/cancel', { version: order.version });
      assert.ok(order.items.every(line => line.id !== unsentId || line.cancelled));
      assert.equal(order.status, 'CANCELLED');
      const emptyCatalog = await ok(a, '/catalog?outletId=' + location.id);
      assert.equal(emptyCatalog.tables.find(entry => entry.id === table.id).active_order_id, null);
      assert.equal((await ok(a, endpoint(location.id), {}, 'POST', headers)).jobs.length, 0);
      order = await ok(a, '/orders', { outletId: location.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 1, notes: '', customerName: '' });
      const itemEntry = '/orders/' + order.id + '/items/';
      order = await ok(a, '/orders/' + order.id + '/items', { version: order.version, menuItemId: item.id, quantity: 2, variant: '', modifiers: [], notes: '' });
      const sentId = order.items.find(line => !line.cancelled).id;
      const nc = location.id === secondOutlet.id;
      const department = nc ? await ok(a, '/settings/nc-departments', {
        outletId: location.id, name: 'PC-local QA department', active: true,
      }) : null;
      order = await ok(a, '/orders/' + order.id + '/send', {
        version: order.version, ...(department ? { ncDepartmentId: department.id, ncReason: 'QA staff meal' } : {}),
      }, 'POST', headers);
      denied(await request(b, endpoint(location.id), {}, 'POST', headers));
      assert.equal((await ok(a, endpoint(location.id), {}, 'POST', { 'X-Local-Print-PC': '4'.repeat(32) })).jobs.length, 0);
      const { jobs: [job] } = await ok(a, endpoint(location.id), {}, 'POST', headers);
      assert.equal(job.reference_id, order.kots[0].id);
      assert.equal(job.payload.lines[0].categoryId, item.category_id);
      assert.equal(job.payload.title, nc ? 'NC KOT' : 'KITCHEN ORDER');
      await ok(a, '/printing/jobs/' + job.id + '/ack', { status: 'PRINTED', claimToken: job.claim_token, error: '' });
      const removeSent = itemEntry + sentId + '/cancel';
      denied(await request(a, removeSent, { version: order.version }), [422]);
      denied(await request(a, removeSent, { version: order.version, reason: 'Guest removed item', quantity: 3 }), [422]);
      const remaining = await ok(a, removeSent, { version: order.version, reason: 'Guest removed one unit', quantity: 1 });
      assert.equal(remaining.status, 'OPEN');
      assert.equal(remaining.items.find(line => line.id === sentId).quantity, 1);
      assert.equal(remaining.items.find(line => line.id === sentId).sent_quantity, 1);
      assert.equal(remaining.kots[0].items[0].quantity, 2);
      const { jobs: [partial] } = await ok(a, endpoint(location.id), {}, 'POST', headers);
      assert.equal(partial.document_type, 'KOT_CANCEL');
      assert.equal(partial.printer_id, job.printer_id);
      assert.equal(partial.payload.lines[0].quantity, 1);
      await ok(a, '/printing/jobs/' + partial.id + '/ack', { status: 'PRINTED', claimToken: partial.claim_token, error: '' });
      const emptied = await ok(a, removeSent, { version: remaining.version, reason: 'Guest removed item', quantity: 1 });
      assert.equal(emptied.status, 'CANCELLED');
      const released = await ok(a, '/catalog?outletId=' + location.id);
      assert.equal(released.tables.find(entry => entry.id === table.id).active_order_id, null);
      const { jobs: [voidJob] } = await ok(a, endpoint(location.id), {}, 'POST', headers);
      assert.equal(voidJob.document_type, 'KOT_CANCEL');
      assert.equal(voidJob.printer_id, job.printer_id);
      assert.equal(voidJob.payload.reason, 'Guest removed item');
      assert.equal(voidJob.payload.lines.length, 1);
      assert.equal(voidJob.payload.lines[0].category_id, item.category_id);
    }
  });
  await t.test('voiding matching KOT entries queues one slip for the chosen quantity', async () => {
    const headers = { 'X-Local-Print-PC': '7'.repeat(32) };
    const endpoint = '/printing/local/claim?outletId=' + outlet.id;
    const table = await ok(a, '/settings/tables', { outletId: outlet.id, name: 'Grouped void QA', section: 'Dining', seats: 2 });
    let groupOrder = await ok(a, '/orders', { outletId: outlet.id, serviceMode: 'DINE_IN', tableId: table.id, covers: 1, notes: '', customerName: '' });
    for (let count = 0; count < 3; count++) {
      groupOrder = await ok(a, '/orders/' + groupOrder.id + '/items', { version: groupOrder.version,
        menuItemId: itemA.id, quantity: 1, variant: '', modifiers: [], notes: '' });
    }
    groupOrder = await ok(a, '/orders/' + groupOrder.id + '/send', { version: groupOrder.version }, 'POST', headers);
    const {jobs:[original]} = await ok(a, endpoint, {}, 'POST', headers);
    await ok(a, '/printing/jobs/' + original.id + '/ack', {status:'PRINTED',claimToken:original.claim_token,error:''});
    const path = '/kots/' + groupOrder.kots[0].id + '/void-items';
    const body = {version:groupOrder.version,orderItemIds:groupOrder.items.map(item => item.id),quantity:2,reason:'Guest removed two portions'};
    denied(await request(cashier, path, body),[403]);
    denied(await request(a, path, {...body,quantity:4}),[422]);
    const remaining = await ok(a, path, body);
    assert.equal(remaining.status,'OPEN');
    assert.equal(remaining.items.filter(item => !item.cancelled).length,1);
    const {jobs:[slip]} = await ok(a, endpoint, {}, 'POST', headers);
    assert.equal(slip.document_type,'KOT_CANCEL');
    assert.equal(slip.original_job_id,original.id);
    assert.equal(slip.payload.lines.reduce((sum,line) => sum + line.quantity,0),2);
    assert.equal((await ok(a, endpoint, {}, 'POST', headers)).jobs.length,0);
  });
  await t.test('mobile printing uses the paired PC with atomic claims, cutover and separate expiry', async () => {
    const branch = await ok(a,'/settings/branches',{name:'Background print QA',address:''});
    const loc = await ok(a,'/settings/outlets',{branchId:branch.id,name:'Background Dining',
      serviceModes:['DINE_IN'],paymentMethods:['CASH'],currency:'INR',timezone:'Asia/Kolkata'});
    const category = await ok(a,'/settings/categories',{outletId:loc.id,name:'Mobile mains',department:'Kitchen',sortOrder:1});
    const item = await ok(a,'/settings/items',{outletId:loc.id,categoryId:category.id,name:'Mobile meal',
      description:'',price:100,taxRate:0,available:true,vegetarian:true,variants:[],modifiers:[]});
    const pairing = '/print-device/branches/'+branch.id+'/pairing';
    denied(await request(cashier,pairing,{}),[403]);
    const {code} = await ok(a,pairing,{});
    denied(await request(null,'/print-device/pair',{code}),[401]);
    const {token,pcId} = await ok(null,'/print-device/pair',{code},'POST',{Authorization:'Bearer '+code});
    denied(await request(null,'/print-device/pair',{code},'POST',{Authorization:'Bearer '+code}),[401]);
    const device = {Authorization:'Bearer '+token};
    const deviceCall = (path,body={}) => ok(null,'/print-device/'+path,body,'POST',device);
    const smokeAndroid = {'User-Agent':'Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile'};
    const smokeIOS = {'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile'};
    const statusPath = '/print-device/outlets/'+loc.id+'/status';
    const catalogPath = '/catalog?outletId='+loc.id;
    const db = new pg.Client({host:databaseUrl.hostname,port:Number(databaseUrl.port || 5432),database:databaseUrl.pathname.slice(1),
      user:env.DB_USERNAME,password:env.DB_PASSWORD});
    async function database(sql,params=[]) {
      await db.query('begin');
      try {
        await db.query("select set_config('app.tenant_id',$1,true)",[a.data.tenant.id]);
        const result = await db.query(sql,params);
        await db.query('commit');
        return result;
      } catch(error) { await db.query('rollback'); throw error; }
    }
    await db.connect();
    try {
      const create = async (name,headers) => {
        const table = await ok(a,'/settings/tables',{outletId:loc.id,name,section:'Dining',seats:2});
        let current = await ok(a,'/orders',{outletId:loc.id,tableId:table.id,serviceMode:'DINE_IN',covers:1,notes:'',customerName:''},'POST',headers);
        current = await ok(a,'/orders/'+current.id+'/items',{version:current.version,menuItemId:item.id,quantity:1,variant:'',modifiers:[],notes:''},'POST',headers);
        return ok(a,'/orders/'+current.id+'/send',{version:current.version},'POST',headers);
      };
      const first = await create('Phone KOT',smokeAndroid);
      let status = await ok(a,statusPath+'?orderId='+first.id);
      assert.ok(status.paired);
      assert.equal(status.jobs[0].status,'QUEUED');
      denied(await request(b,statusPath),[403,404]);
      assert.equal((await ok(a,'/printing/local/claim?outletId='+loc.id,{},'POST',{'X-Local-Print-PC':'1'.repeat(32)})).jobs.length,0);
      const two = await Promise.all([deviceCall('claim'),deviceCall('claim')]);
      const [kot] = two.flatMap(claim => claim.jobs);
      assert.equal(two.flatMap(claim => claim.jobs).length,1);
      assert.equal(kot.target_pc_id,pcId);
      assert.equal((Date.parse(kot.expires_at)-Date.parse(kot.created_at))/60000,20);
      const plan = [{id:'test-delivery',printer:'QA Thermal',copy:1,lines:[0],categories:[category.id]}];
      const control = {jobId:kot.id,claimToken:kot.claim_token};
      denied(await request(null,'/print-device/start',{...control,claimToken:crypto.randomUUID(),plan},'POST',device),[409]);
      await deviceCall('start',{...control,plan});
      await deviceCall('result',{...control,status:'PRINTED',deliveries:{'test-delivery':'PRINTED'}});
      assert.equal((await ok(a,statusPath+'?orderId='+first.id)).jobs[0].status,'SENT_TO_PRINTER');

      const group = await ok(a,'/orders/'+first.id+'/bills',{version:first.version},'POST',smokeIOS);
      const bill = group.bills.find(row => row.status==='OPEN');
      await ok(a,'/bills/'+bill.id+'/settle',{version:bill.version,cashTendered:100,payments:[{method:'CASH',amount:100,reference:''}]},'POST',smokeIOS);
      const {jobs:[billJob]} = await deviceCall('claim');
      assert.equal(billJob.document_type,'BILL');
      assert.equal((Date.parse(billJob.expires_at)-Date.parse(billJob.created_at))/3600000,24);
      await deviceCall('start',{jobId:billJob.id,claimToken:billJob.claim_token,plan});

      const stale = await create('Expired KOT',smokeAndroid);
      const staleStatus = await ok(a,statusPath+'?orderId='+stale.id);
      assert.equal(staleStatus.jobs[0].status,'QUEUED');
      await database("update print_pcs set last_seen_at=now()-interval '1 minute' where id=$1",[pcId]);
      assert.equal((await ok(a,statusPath)).online,false);
      await database("update print_jobs set expires_at=now()-interval '1 second' where id=$1",[staleStatus.jobs[0].id]);
      await database("update print_jobs set claimed_at=now()-interval '121 seconds' where id=$1",[billJob.id]);
      const deadline = Date.now()+24000;
      do {
        status = await ok(a,statusPath);
        if (status.jobs.find(row => row.id===billJob.id)?.status==='NEEDS_REVIEW' &&
            status.jobs.find(row => row.id===staleStatus.jobs[0].id)?.status==='FAILED') break;
        await new Promise(resolve => setTimeout(resolve,1000));
      } while (Date.now()<deadline);
      assert.equal(status.jobs.find(row => row.id===billJob.id).status,'NEEDS_REVIEW');
      assert.equal(status.jobs.find(row => row.id===staleStatus.jobs[0].id).status,'FAILED');
      assert.equal((await deviceCall('claim')).jobs.length,0);
      assert.equal((await ok(a,statusPath)).online,true);
      assert.ok((await ok(a,catalogPath)).outlet);
    } finally { await db.end(); }
  });
  await t.test('logout revokes server session', async () => {
    await ok(cashier, '/auth/logout', {});
    assert.equal((await request(cashier, '/auth/me')).status, 401);
  });
});

test('Platform administrator controls access and audits subscriptions without tenant privileges', {
  skip: !env.APP_PLATFORM_ADMIN_EMAIL || !env.APP_PLATFORM_ADMIN_PASSWORD,
}, async () => {
  const platformLogin = { email: env.APP_PLATFORM_ADMIN_EMAIL, password: env.APP_PLATFORM_ADMIN_PASSWORD };
  assert.equal((await request(null, '/platform/tenants')).status, 401);
  assert.equal((await request(null, '/platform/login', { ...platformLogin, password: 'wrong-password' })).status, 401);
  assert.equal((await request(null, '/platform/login', platformLogin, 'POST', { Origin: 'https://untrusted.invalid' })).status, 403);
  const admin = await ok(null, '/platform/login', platformLogin);
  const authorization = { Authorization: 'Bearer ' + admin.token };
  const other = await login('coastal', 'owner@coastal.test');
  assert.equal((await request(other, '/platform/tenants')).status, 401);
  assert.equal((await request(null, '/auth/me', undefined, 'GET', authorization)).status, 401);
  const tenant = { businessName: 'Platform test ' + suffix, slug: 'platform-' + suffix,
    name: 'Test owner', email: 'owner-' + suffix + '@example.test', password, maxBranches: 1, maxUsers: 1,
    startsOn: '2020-01-01', endsOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) };
  const invalid = await request(null, '/platform/tenants', { ...tenant, slug: '-bad', name: ' ', password: 'short' }, 'POST', authorization);
  assert.equal(invalid.status, 400);
  assert.ok(invalid.data.fieldErrors.slug);
  assert.ok(invalid.data.fieldErrors.name);
  assert.ok(invalid.data.fieldErrors.password);
  assert.ok(!JSON.stringify(invalid.data).includes('short'));
  const badDates = await request(null, '/platform/tenants', { ...tenant, endsOn: '2019-12-31' }, 'POST', authorization);
  assert.equal(badDates.status, 422);
  assert.ok(badDates.data.fieldErrors.endsOn);
  await ok(null, '/platform/tenants', tenant, 'POST', authorization);
  const duplicate = await request(null, '/platform/tenants', tenant, 'POST', authorization);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.fieldErrors.slug, 'Choose a different Property ID.');
  const customer = await login(tenant.slug, tenant.email, password);
  const id = customer.data.tenant.id;
  const all = await ok(null, '/platform/tenants', undefined, 'GET', authorization);
  const createdStore = all.find(row => row.id === id);
  assert.equal(createdStore.max_branches, 1);
  assert.equal(createdStore.max_users, 1);
  assert.equal(createdStore.is_demo, false);
  assert.equal(createdStore.starts_on, tenant.startsOn);
  assert.equal(createdStore.expires_at, new Date(Date.parse(tenant.endsOn) + 86400000).toISOString().replace('.000Z', 'Z'));
  assert.ok(all.some(row => row.slug === 'saffron' && row.is_demo));
  assert.equal((await request(customer, '/settings/branches', { name: 'Over quota', address: '' })).status, 422);
  const extraUser = { name: 'Quota check user', email: 'quota-' + suffix + '@example.test', password,
    role: 'CASHIER', outletIds: [customer.data.outlets[0].id] };
  assert.equal((await request(customer, '/settings/users', extraUser)).status, 422);
  assert.ok(all.some(row => row.id === other.data.tenant.id));
  const path = '/platform/tenants/' + id;
  assert.equal((await request(null, path, { plan: 'Starter', status: 'TRIAL', reason: 'Invalid trial' }, 'PUT', authorization)).status, 422);
  await ok(null, path, { plan: 'Starter', status: 'SUSPENDED', reason: 'Test suspension' }, 'PUT', authorization);
  assert.equal((await request(customer, '/auth/me')).status, 403);
  assert.equal((await request(null, '/auth/login', { tenantSlug: tenant.slug, email: tenant.email, password })).status, 403);
  assert.equal((await request(other, '/auth/me')).status, 200);
  await ok(null, path, { plan: 'Starter', status: 'ACTIVE', expiresAt: '2020-01-01T00:00:00Z', reason: 'Test expiry' }, 'PUT', authorization);
  assert.equal((await request(customer, '/auth/me')).status, 403);
  const db = new pg.Client({ host: databaseUrl.hostname, port: Number(databaseUrl.port || 5432), database: databaseUrl.pathname.slice(1), user: env.DB_USERNAME, password: env.DB_PASSWORD });
  await db.connect();
  const contact = await ok(null, '/platform/contact', undefined, 'GET', authorization);
  const testContact = { email: contact.email || 'support@example.test', phone: contact.phone || '+10000000000' };
  try {
    await db.query('update platform_contact set email=$1, phone=$2 where singleton', [testContact.email, testContact.phone]);
    const expired = await request(null, '/auth/login', { tenantSlug: tenant.slug, email: tenant.email, password });
    assert.equal(expired.status, 403);
    assert.match(expired.data.message, /licence expired/i);
    assert.ok(expired.data.message.includes(testContact.email));
    assert.ok(expired.data.message.includes(testContact.phone));
  } finally {
    await db.query('update platform_contact set email=$1, phone=$2 where singleton and email=$3 and phone=$4',
      [contact.email, contact.phone, testContact.email, testContact.phone]);
    await db.end();
  }
  await ok(null, path, { plan: 'Pro', status: 'ACTIVE', maxBranches: 2, maxUsers: 2, reason: 'Test reactivation' }, 'PUT', authorization);
  const reactivated = await login(tenant.slug, tenant.email, password);
  await ok(reactivated, '/settings/branches', { name: 'Extra branch', address: '' });
  assert.equal((await request(reactivated, '/settings/branches', { name: 'Over the new quota', address: '' })).status, 422);
  const history = await ok(null, path + '/history', undefined, 'GET', authorization);
  assert.deepEqual(history.map(event => event.reason), ['Test reactivation', 'Test expiry', 'Test suspension']);
  assert.equal(history[0].operator_email, platformLogin.email);
  const accounts = await ok(null, path + '/accounts', undefined, 'GET', authorization);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].username, tenant.email);
  assert.equal(accounts[0].password_hash, undefined);
  const accountPath = path + '/accounts/' + accounts[0].id;
  assert.equal((await request(null, accountPath, { active: false, reason: 'Last owner' }, 'PUT', authorization)).status, 422);
  assert.equal((await request(null, '/platform/tenants/' + other.data.tenant.id + '/accounts/' + accounts[0].id,
    { resetPassword: true, reason: 'Wrong tenant' }, 'PUT', authorization)).status, 404);
  await ok(null, path + '/profile', { name: tenant.businessName, address: 'Test address', phone: '12345', taxNumber: 'TEST' }, 'PUT', authorization);
  const profile = await ok(null, path + '/profile', undefined, 'GET', authorization);
  assert.equal(profile.address, 'Test address');
  assert.equal(profile.branch_count, 2);
  const newUsername = 'updated-' + suffix + '@example.test';
  await ok(null, accountPath, { username: newUsername, reason: 'Updated username' }, 'PUT', authorization);
  assert.equal((await request(reactivated, '/auth/me')).status, 401);
  const renamed = await login(tenant.slug, newUsername, password);
  const reset = await ok(null, accountPath, { resetPassword: true, reason: 'Reset requested' }, 'PUT', authorization);
  assert.ok(reset.temporaryPassword.length > 30);
  assert.equal((await request(renamed, '/auth/me')).status, 401);
  const resetOwner = await login(tenant.slug, newUsername, reset.temporaryPassword);
  await ok(resetOwner, '/settings/users', extraUser);
  assert.equal((await request(resetOwner, '/settings/users', { ...extraUser, email: 'over-' + extraUser.email })).status, 422);
  const accountAudit = await ok(null, '/platform/audit?tenant=' + id + '&subject=' + accounts[0].id, undefined, 'GET', authorization);
  assert.deepEqual(accountAudit.map(event => event.action), ['ACCOUNT_PASSWORD_RESET', 'ACCOUNT_USERNAME']);
  assert.ok(!JSON.stringify(accountAudit).includes(reset.temporaryPassword));
  const outletId = resetOwner.data.outlets[0].id;
  const category = await ok(resetOwner, '/settings/categories', { outletId, name: 'Test food', department: 'KOT', sortOrder: 0 });
  const item = await ok(resetOwner, '/settings/items', { outletId, categoryId: category.id, name: 'Test snack', description: '',
    price: 50, taxRate: 0, available: true, vegetarian: true, variants: [], modifiers: [] });
  const table = await ok(resetOwner, '/settings/tables', { outletId, name: 'T1', seats: 4 });
  const { code } = await ok(resetOwner, '/print-device/branches/' + resetOwner.data.outlets[0].branch_id + '/pairing', {});
  await ok(null, '/print-device/pair', { code }, 'POST', { Authorization: 'Bearer ' + code });
  let order = await ok(resetOwner, '/orders', { outletId, serviceMode: 'DINE_IN', tableId: table.id, covers: 2 });
  order = await ok(resetOwner, '/orders/' + order.id + '/items', { version: order.version, menuItemId: item.id, quantity: 1 });
  order = await ok(resetOwner, '/orders/' + order.id + '/send', { version: order.version });
  order = await ok(resetOwner, '/orders/' + order.id + '/bills', { version: order.version });
  assert.ok(order.kots.length && order.bills.length);
  assert.equal((await request(resetOwner, path, { confirmSlug: tenant.slug }, 'DELETE')).status, 401);
  assert.equal((await request(null, path, { confirmSlug: 'coastal' }, 'DELETE', authorization)).status, 422);
  assert.equal((await request(resetOwner, '/orders/' + order.id)).status, 200);
  assert.deepEqual(await ok(null, path, { confirmSlug: tenant.slug }, 'DELETE', authorization), { deleted: true });
  assert.equal((await request(null, path, { confirmSlug: tenant.slug }, 'DELETE', authorization)).status, 404);
  assert.equal((await request(resetOwner, '/auth/me')).status, 401);
  assert.equal((await request(null, '/auth/login', { tenantSlug: tenant.slug, email: newUsername, password: reset.temporaryPassword })).status, 401);
  assert.equal((await request(other, '/auth/me')).status, 200);
  assert.ok(!(await ok(null, '/platform/tenants', undefined, 'GET', authorization)).some(row => row.id === id));
  const verificationDb = new pg.Client({ host: databaseUrl.hostname, port: Number(databaseUrl.port || 5432), database: databaseUrl.pathname.slice(1), user: env.DB_USERNAME, password: env.DB_PASSWORD });
  await verificationDb.connect();
  try {
    await verificationDb.query('begin');
    await verificationDb.query("select set_config('app.tenant_id',$1,true)", [id]);
    const { rows } = await verificationDb.query("select quote_ident(table_name) as name from information_schema.columns where table_schema='public' and column_name='tenant_id'");
    assert.ok(rows.length > 20);
    for (const { name } of rows) {
      assert.equal((await verificationDb.query(`select 1 from ${name} where tenant_id=$1 limit 1`, [id])).rowCount, 0, name);
    }
    await verificationDb.query('rollback');
  } finally { await verificationDb.end(); }
  await ok(null, '/platform/logout', {}, 'POST', authorization);
  assert.equal((await request(null, '/platform/tenants', undefined, 'GET', authorization)).status, 401);
});
