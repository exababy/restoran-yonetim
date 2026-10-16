import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pos-')), 'test.db');
let proc, admin, garson;

async function call(tok, p, body) {
  const r = await fetch(`http://localhost:${PORT}${p}`, {
    method: body ? 'POST' : 'GET', headers: { 'X-Token': tok || '', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) { const e = new Error(d.error); e.status = r.status; throw e; }
  return d;
}

before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', 'server/server.js'], { env: { ...process.env, PORT, DB_FILE: DB }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { admin = (await call(null, '/api/login', { pin: '1234' })).token; break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  garson = (await call(null, '/api/login', { pin: '2222' })).token;
});
after(() => proc.kill());

test('hatalı şifre reddedilir', async () => {
  await assert.rejects(call(null, '/api/login', { pin: '0000' }), { status: 401 });
});

test('masa siparişi, indirim, bölünmüş ödeme ve kapanış', async () => {
  const boot = await call(admin, '/api/bootstrap');
  const table = boot.tables[0];
  const adana = boot.products.find((p) => p.name === 'Adana pors.');
  const ayran = boot.products.find((p) => p.name === 'Ayran');
  let r = await call(garson, '/api/orders/add-items', { table_id: table.id, guests: 2, items: [{ product_id: adana.id, qty: 2 }, { product_id: ayran.id, qty: 2 }] });
  assert.equal(r.order.total, 2 * 690 + 2 * 50);
  assert.equal(r.kitchen_items.length, 1, 'ayran mutfağa gitmez');
  // aynı masaya ekleme aynı adisyona gider
  r = await call(garson, '/api/orders/add-items', { table_id: table.id, items: [{ product_id: ayran.id, qty: 1, free: true }] });
  const id = r.order.id;
  assert.equal(r.order.total, 1480);
  // garson ödeme alamaz
  await assert.rejects(call(garson, `/api/orders/${id}/pay`, { method: 'nakit', amount: 10 }), { status: 403 });
  let o = await call(admin, `/api/orders/${id}/update`, { discount_type: 'percent', discount_value: 10 });
  assert.equal(o.total, 1332);
  r = await call(admin, `/api/orders/${id}/pay`, { method: 'kart', amount: 1000 });
  assert.equal(r.closed, false);
  assert.equal(r.order.remaining, 332);
  await assert.rejects(call(admin, `/api/orders/${id}/pay`, { method: 'nakit', amount: 500 }));
  r = await call(admin, `/api/orders/${id}/pay`, { method: 'nakit', amount: 332 });
  assert.equal(r.closed, true);
  const st = await call(admin, '/api/state');
  assert.ok(!st.orders.find((x) => x.id === id), 'masa boşaldı');
  const rep = await call(admin, `/api/reports?from=0&to=${Date.now() + 1000}`);
  assert.equal(rep.revenue, 1332);
  assert.equal(rep.byMethod.kart, 1000);
  assert.equal(rep.discounts, 148);
});

test('taşıma, birleştirme ve satır iptali', async () => {
  const boot = await call(admin, '/api/bootstrap');
  const [t1, t2, t3] = boot.tables.slice(1, 4);
  const p = boot.products.find((x) => x.name === 'Urfa pors.');
  const a = (await call(admin, '/api/orders/add-items', { table_id: t1.id, items: [{ product_id: p.id, qty: 1 }, { product_id: p.id, qty: 3, note: 'acılı' }] })).order;
  const b = (await call(admin, '/api/orders/add-items', { table_id: t2.id, items: [{ product_id: p.id, qty: 1 }] })).order;
  // seçili satırı boş masaya taşı
  let m = await call(admin, `/api/orders/${a.id}/move`, { target_table_id: t3.id, item_ids: [a.items[1].id] });
  assert.equal(m.table_id, t3.id);
  assert.equal(m.total, 3 * 690);
  // t1'i t2 ile birleştir
  m = await call(admin, `/api/orders/${a.id}/move`, { target_table_id: t2.id });
  assert.equal(m.id, b.id);
  assert.equal(m.total, 2 * 690);
  // kısmi iptal
  const t3order = (await call(admin, '/api/state')).orders.find((o) => o.table_id === t3.id);
  const full = await call(admin, '/api/orders/' + t3order.id);
  const after = await call(admin, '/api/items/cancel', { ids: [full.items[0].id], qty: 1, reason: 'Test' });
  assert.equal(after.total, 2 * 690);
  // tüm adisyon iptali
  await call(admin, `/api/orders/${t3order.id}/cancel`, { reason: 'Test' });
  assert.ok(!(await call(admin, '/api/state')).orders.find((o) => o.id === t3order.id));
});

test('paket sipariş, cari ödeme ve tahsilat', async () => {
  const boot = await call(admin, '/api/bootstrap');
  const c = await call(admin, '/api/customers/save', { name: 'Test Müşteri', phone: '0555 111 22 33', address: 'Merkez' });
  assert.equal(c.phone, '05551112233');
  const p = boot.products.find((x) => x.name === 'Adana Dürüm');
  const o = (await call(admin, '/api/orders/add-items', { type: 'paket', customer_id: c.id, items: [{ product_id: p.id, qty: 2 }] })).order;
  assert.equal(o.type, 'paket');
  assert.equal(o.delivery_status, 'hazirlaniyor');
  const r = await call(admin, `/api/orders/${o.id}/pay`, { method: 'cari', amount: o.total });
  assert.ok(r.closed);
  let cust = await call(admin, '/api/customers/' + c.id);
  assert.equal(cust.balance, 900);
  await call(admin, '/api/customers/collect', { customer_id: c.id, amount: 400, method: 'nakit' });
  cust = await call(admin, '/api/customers/' + c.id);
  assert.equal(cust.balance, 500);
});

test('mutfak akışı ve gün sonu', async () => {
  const boot = await call(admin, '/api/bootstrap');
  const p = boot.products.find((x) => x.name === 'Beyti Kebap');
  await call(garson, '/api/orders/add-items', { table_id: boot.tables[10].id, items: [{ product_id: p.id, qty: 1 }] });
  const k = await call(garson, '/api/kitchen');
  assert.ok(k.orders.length >= 1);
  const ids = k.orders.flatMap((o) => o.items.map((i) => i.id));
  await call(garson, '/api/kitchen/status', { ids, status: 'ready' });
  assert.equal((await call(garson, '/api/kitchen')).orders.length, 0);
  await call(admin, '/api/expenses/save', { description: 'Ekmek', amount: 120 });
  const d = await call(admin, '/api/dayend');
  assert.equal(d.current.expenseTotal, 120);
  await call(admin, '/api/dayend/close', {});
  const d2 = await call(admin, '/api/dayend');
  assert.equal(d2.current.revenue, 0);
  assert.equal(d2.closings.length, 1);
});

test('toplu fiyat güncelleme yuvarlar', async () => {
  const boot = await call(admin, '/api/bootstrap');
  const cat = boot.categories.find((c) => c.name === 'Tatlılar');
  await call(admin, '/api/admin/products/bulk-price', { category_id: cat.id, percent: 10, round: 5 });
  const prods = await call(admin, '/api/admin/products');
  assert.equal(prods.find((p) => p.name === 'Künefe').price, 240); // 220*1.1=242 → 240
  await assert.rejects(call(garson, '/api/admin/products/bulk-price', { percent: 10 }), { status: 403 });
});
