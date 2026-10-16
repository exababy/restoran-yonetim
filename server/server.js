import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { build, sendRaw, pad, CMD } from './printer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'restoran.db');
const db = openDb(DB_FILE);

// ---------- yardımcılar ----------
const now = () => Date.now();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const q = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function settings() {
  const o = {};
  for (const r of q('SELECT key,value FROM settings')) o[r.key] = r.value;
  return o;
}

function log(user, action, detail = '') {
  run('INSERT INTO logs(at,user_id,action,detail) VALUES(?,?,?,?)', now(), user?.id ?? null, action, String(detail));
}

const ROLE_LEVEL = { garson: 1, kasiyer: 2, admin: 3 };
function need(user, role) {
  if ((ROLE_LEVEL[user.role] || 0) < ROLE_LEVEL[role]) fail('Bu işlem için yetkiniz yok', 403);
}

// ---------- oturum ----------
const sessions = new Map();

// ---------- gerçek zamanlı (SSE) ----------
const clients = new Set();
function broadcast(type, data = {}) {
  const msg = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

// ---------- adisyon hesaplama ----------
function totalsFor(o, sub, paid) {
  let disc = o.discount_type === 'percent' ? sub * (o.discount_value || 0) / 100
    : o.discount_type === 'amount' ? (o.discount_value || 0) : 0;
  disc = Math.min(r2(disc), r2(sub));
  const total = r2(sub - disc);
  return { subtotal: r2(sub), discount: disc, total, paid: r2(paid), remaining: r2(total - paid) };
}

function orderLabel(o) {
  if (o.type === 'masa' && o.table_id) {
    const t = q1('SELECT t.name, s.name sname FROM tables t LEFT JOIN sections s ON s.id=t.section_id WHERE t.id=?', o.table_id);
    return t ? `${t.sname} (${t.name})` : 'Masa';
  }
  if (o.type === 'paket') return 'Paket' + (o.customer_name ? ' / ' + o.customer_name : o.name ? ' / ' + o.name : ' #' + o.id);
  return 'Bekleyen / ' + (o.name || '#' + o.id);
}

function getOrder(id) {
  const o = q1(`SELECT o.*, c.name customer_name, c.phone customer_phone, c.address customer_address, u.name user_name
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.user_id WHERE o.id=?`, id);
  if (!o) fail('Adisyon bulunamadı', 404);
  o.items = q(`SELECT i.*, u.name user_name FROM order_items i LEFT JOIN users u ON u.id=i.user_id
    WHERE i.order_id=? ORDER BY i.id`, id);
  o.payments = q(`SELECT p.*, u.name user_name FROM payments p LEFT JOIN users u ON u.id=p.user_id
    WHERE p.order_id=? ORDER BY p.id`, id);
  const sub = o.items.filter((i) => i.status === 'active' && !i.free).reduce((s, i) => s + i.qty * i.unit_price, 0);
  const paid = o.payments.filter((p) => !p.cancelled).reduce((s, p) => s + p.amount, 0);
  Object.assign(o, totalsFor(o, sub, paid));
  o.label = orderLabel(o);
  if (o.split_count > 0) o.seats = seatShares(o);
  return o;
}

// Hesap bölme: her kişinin (0 = ortak) payı, indirim oransal dağıtılır, kuruş farkı en büyük paya eklenir
function seatShares(o) {
  const ratio = o.subtotal > 0 ? o.total / o.subtotal : 1;
  const groups = [];
  for (let seat = 0; seat <= o.split_count; seat++) {
    const items = o.items.filter((i) => i.status === 'active' && (i.seat || 0) === seat);
    const sub = items.filter((i) => !i.free).reduce((s, i) => s + i.qty * i.unit_price, 0);
    const paid = o.payments.filter((p) => !p.cancelled && (p.seat || 0) === seat).reduce((s, p) => s + p.amount, 0);
    groups.push({ seat, count: items.length, subtotal: r2(sub), share: r2(sub * ratio), paid: r2(paid) });
  }
  const diff = r2(o.total - groups.reduce((s, g) => s + g.share, 0));
  if (diff) { const big = groups.reduce((a, b) => (b.share > a.share ? b : a)); big.share = r2(big.share + diff); }
  for (const g of groups) g.remaining = r2(g.share - g.paid);
  return groups;
}
const seatName = (n) => (n ? `${n}. KİŞİ` : 'ORTAK');

function openOrders() {
  const rows = q(`SELECT o.*, c.name customer_name, c.phone customer_phone, c.address customer_address, u.name user_name,
    (SELECT COALESCE(SUM(qty*unit_price),0) FROM order_items WHERE order_id=o.id AND status='active' AND free=0) sub,
    (SELECT COALESCE(SUM(amount),0) FROM payments WHERE order_id=o.id AND cancelled=0) paid,
    (SELECT COUNT(*) FROM order_items WHERE order_id=o.id AND status='active' AND kitchen_status IN ('new','preparing')) k_wait,
    (SELECT COUNT(*) FROM order_items WHERE order_id=o.id AND status='active' AND kitchen_status='ready') k_ready
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.user_id
    WHERE o.status='open' ORDER BY o.id`);
  return rows.map((o) => ({ ...o, ...totalsFor(o, o.sub, o.paid) }));
}

function closeIfEmpty(orderId, user) {
  const n = q1("SELECT COUNT(*) n FROM order_items WHERE order_id=? AND status='active'", orderId).n;
  const p = q1('SELECT COUNT(*) n FROM payments WHERE order_id=? AND cancelled=0', orderId).n;
  if (!n && !p) {
    run("UPDATE orders SET status='cancelled', closed_at=?, cancel_reason=? WHERE id=? AND status='open'", now(), 'Tüm ürünler iptal', orderId);
    log(user, 'adisyon_bos_kapandi', '#' + orderId);
  }
}

function tryClose(orderId, user) {
  const o = getOrder(orderId);
  const hasItems = o.items.some((i) => i.status === 'active');
  if (o.status === 'open' && hasItems && o.remaining <= 0.009) {
    run("UPDATE orders SET status='paid', closed_at=?, total=? WHERE id=?", now(), o.total, orderId);
    run("UPDATE order_items SET kitchen_status='served' WHERE order_id=? AND kitchen_status='ready'", orderId);
    log(user, 'adisyon_kapandi', `${o.label} ${o.total.toFixed(2)} TL`);
    return true;
  }
  return false;
}

// ---------- yazdırma ----------
const fmt = (n) => r2(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const qtyStr = (n) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));
const METHOD_NAMES = { nakit: 'Nakit', kart: 'Kredi Kartı', yemek: 'Yemek Kartı', cari: 'Cari (Veresiye)' };

function receiptDoc(o, kind) {
  const s = settings();
  const w = Number(s.printer_width) || 42;
  const line = '-'.repeat(w);
  const doc = [{ t: 'text', v: s.restaurant_name, align: 'center', bold: true, size: 'tall' }];
  if (s.address) doc.push({ t: 'text', v: s.address, align: 'center' });
  if (s.phone) doc.push({ t: 'text', v: 'Tel: ' + s.phone, align: 'center' });
  doc.push({ t: 'text', v: kind === 'receipt' ? 'HESAP FİŞİ' : 'ADİSYON (Bilgi Fişidir)', align: 'center', bold: true });
  doc.push({ t: 'line', v: line });
  doc.push({ t: 'line', v: pad(o.label, '#' + o.id, w) });
  doc.push({ t: 'line', v: pad(dt(now()), o.guests ? o.guests + ' kişi' : '', w) });
  if (o.customer_name) {
    doc.push({ t: 'line', v: 'Müşteri: ' + o.customer_name + (o.customer_phone ? ' ' + o.customer_phone : '') });
    if (o.customer_address) doc.push({ t: 'line', v: o.customer_address });
  }
  doc.push({ t: 'line', v: line });
  const itemLines = (list) => {
    const merged = new Map();
    for (const i of list) {
      const k = `${i.name}|${i.unit_price}|${i.free}`;
      const m = merged.get(k) || { ...i, qty: 0 };
      m.qty = r2(m.qty + i.qty); merged.set(k, m);
    }
    for (const i of merged.values()) {
      doc.push({ t: 'line', v: pad(`${qtyStr(i.qty)} x ${i.name}`, i.free ? 'İKRAM' : fmt(i.qty * i.unit_price), w) });
    }
  };
  const active = o.items.filter((x) => x.status === 'active');
  if (o.seats) {
    // tek fiş, kişi kişi ayrılmış bölümler
    for (const g of o.seats.filter((x) => x.count)) {
      doc.push({ t: 'text', v: `--- ${seatName(g.seat)} ---`, align: 'center', bold: true });
      itemLines(active.filter((i) => (i.seat || 0) === g.seat));
      doc.push({ t: 'text', v: pad(`${seatName(g.seat)} TOPLAM`, fmt(g.share), w), bold: true });
      if (g.paid > 0) doc.push({ t: 'line', v: pad(g.remaining <= 0.009 ? '  ÖDENDİ' : '  Ödenen', fmt(g.paid), w) });
    }
  } else itemLines(active);
  doc.push({ t: 'line', v: line });
  if (o.discount > 0) {
    doc.push({ t: 'line', v: pad('Ara Toplam', fmt(o.subtotal), w) });
    doc.push({ t: 'line', v: pad('İndirim', '-' + fmt(o.discount), w) });
  }
  doc.push({ t: 'text', v: pad('TOPLAM', fmt(o.total) + ' TL', Math.floor(w / 2)), bold: true, size: 'big' });
  const pays = o.payments.filter((p) => !p.cancelled);
  if (pays.length) {
    for (const p of pays) doc.push({ t: 'line', v: pad(METHOD_NAMES[p.method] || p.method, fmt(p.amount), w) });
    if (o.remaining > 0.009) doc.push({ t: 'line', v: pad('KALAN', fmt(o.remaining), w) });
  }
  doc.push({ t: 'line', v: line });
  if (s.receipt_footer) doc.push({ t: 'text', v: s.receipt_footer, align: 'center' });
  doc.push({ t: 'text', v: 'Mali değeri yoktur', align: 'center' });
  return doc;
}

function kitchenDoc(o, items, user, title = 'MUTFAK') {
  const s = settings();
  const w = Number(s.printer_width) || 42;
  const doc = [
    { t: 'text', v: title.toLocaleUpperCase('tr'), align: 'center', bold: true },
    { t: 'text', v: o.label, align: 'center', bold: true, size: 'big' },
    { t: 'line', v: pad(dt(now()), user?.name || '', w) },
    { t: 'line', v: '-'.repeat(w) },
  ];
  for (const i of items) {
    doc.push({ t: 'text', v: `${qtyStr(i.qty)} x ${i.name}`, bold: true, size: 'tall' });
    if (i.note) doc.push({ t: 'text', v: '   >> ' + i.note, bold: true });
  }
  if (o.note) { doc.push({ t: 'line', v: '-'.repeat(w) }); doc.push({ t: 'text', v: 'NOT: ' + o.note, bold: true }); }
  return doc;
}

async function printDoc(address, doc, extra) {
  const parts = [build(doc)];
  if (extra) parts.push(extra);
  await sendRaw(address, Buffer.concat(parts));
}

// ---------- rapor ----------
function report(from, to) {
  const pays = q(`SELECT p.*, u.name user_name FROM payments p LEFT JOIN users u ON u.id=p.user_id
    WHERE p.cancelled=0 AND p.created_at>=? AND p.created_at<?`, from, to);
  const byMethod = {};
  const byHour = Array(24).fill(0);
  for (const p of pays) {
    byMethod[p.method] = r2((byMethod[p.method] || 0) + p.amount);
    byHour[new Date(p.created_at).getHours()] = r2(byHour[new Date(p.created_at).getHours()] + p.amount);
  }
  const revenue = r2(pays.reduce((s, p) => s + p.amount, 0));
  const closed = q("SELECT * FROM orders WHERE status='paid' AND closed_at>=? AND closed_at<?", from, to);
  const ids = closed.map((o) => o.id);
  const discounts = r2(closed.reduce((s, o) => {
    const sub = q1("SELECT COALESCE(SUM(qty*unit_price),0) s FROM order_items WHERE order_id=? AND status='active' AND free=0", o.id).s;
    return s + totalsFor(o, sub, 0).discount;
  }, 0));
  const idList = ids.length ? ids.join(',') : '0';
  const products = q(`SELECT i.name, c.name category, SUM(i.qty) qty, SUM(CASE WHEN i.free=0 THEN i.qty*i.unit_price ELSE 0 END) amount,
    SUM(CASE WHEN i.free=1 THEN i.qty ELSE 0 END) free_qty
    FROM order_items i LEFT JOIN categories c ON c.id=i.category_id
    WHERE i.status='active' AND i.order_id IN (${idList}) GROUP BY i.name, c.name ORDER BY amount DESC, qty DESC`);
  const catMap = {};
  for (const p of products) {
    const k = p.category || 'Diğer';
    catMap[k] = catMap[k] || { name: k, qty: 0, amount: 0 };
    catMap[k].qty += p.qty; catMap[k].amount = r2(catMap[k].amount + p.amount);
  }
  const byUser = q(`SELECT COALESCE(u.name,'?') name, SUM(i.qty) qty, SUM(CASE WHEN i.free=0 THEN i.qty*i.unit_price ELSE 0 END) amount
    FROM order_items i LEFT JOIN users u ON u.id=i.user_id WHERE i.status='active' AND i.order_id IN (${idList})
    GROUP BY i.user_id ORDER BY amount DESC`);
  const cancelledItems = q(`SELECT i.*, u.name user_name FROM order_items i LEFT JOIN users u ON u.id=i.user_id
    WHERE i.status='cancelled' AND i.created_at>=? AND i.created_at<? ORDER BY i.id DESC`, from, to);
  const cancelledOrders = q("SELECT * FROM orders WHERE status='cancelled' AND closed_at>=? AND closed_at<?", from, to);
  const expenses = q(`SELECT e.*, u.name user_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id
    WHERE e.created_at>=? AND e.created_at<? ORDER BY e.id DESC`, from, to);
  const expenseTotal = r2(expenses.reduce((s, e) => s + e.amount, 0));
  const collections = q(`SELECT t.*, c.name customer_name FROM customer_tx t LEFT JOIN customers c ON c.id=t.customer_id
    WHERE t.amount<0 AND t.created_at>=? AND t.created_at<?`, from, to);
  const collectionCash = r2(-collections.filter((t) => t.method === 'nakit').reduce((s, t) => s + t.amount, 0));
  const collectionCard = r2(-collections.filter((t) => t.method === 'kart').reduce((s, t) => s + t.amount, 0));
  const open = openOrders();
  const byType = {};
  for (const o of closed) {
    byType[o.type] = byType[o.type] || { count: 0, amount: 0 };
    byType[o.type].count++; byType[o.type].amount = r2(byType[o.type].amount + o.total);
  }
  return {
    from, to, revenue, byMethod, byHour, byType,
    orderCount: closed.length,
    guestCount: closed.reduce((s, o) => s + (o.guests || 0), 0),
    average: closed.length ? r2(closed.reduce((s, o) => s + o.total, 0) / closed.length) : 0,
    discounts, products, categories: Object.values(catMap).sort((a, b) => b.amount - a.amount), byUser,
    cancelledItems, cancelledOrders, cancelledTotal: r2(cancelledItems.reduce((s, i) => s + i.qty * i.unit_price, 0)),
    expenses, expenseTotal, collectionCash, collectionCard,
    cashInDrawer: r2((byMethod.nakit || 0) + collectionCash - expenseTotal),
    openCount: open.length, openTotal: r2(open.reduce((s, o) => s + o.remaining, 0)),
  };
}

function periodStart() {
  return q1('SELECT MAX(closed_at) m FROM day_closings').m || 0;
}

// ---------- rotalar ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

route('POST', '/api/login', ({ body }) => {
  const u = q1('SELECT id,name,role FROM users WHERE pin=? AND active=1', String(body.pin || ''));
  if (!u) fail('Hatalı şifre', 401);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, u);
  log(u, 'giris', u.name);
  return { token, user: u };
}, { public: true });

route('POST', '/api/logout', ({ token }) => { sessions.delete(token); return { ok: true }; });

route('GET', '/api/bootstrap', ({ user }) => ({
  me: user,
  settings: settings(),
  sections: q('SELECT * FROM sections ORDER BY sort, id'),
  tables: q('SELECT * FROM tables ORDER BY section_id, sort, id'),
  categories: q('SELECT * FROM categories ORDER BY sort, id'),
  products: q('SELECT * FROM products WHERE active=1 ORDER BY sort, id'),
  users: q('SELECT id,name,role FROM users WHERE active=1 ORDER BY id'),
  printers: q('SELECT * FROM printers ORDER BY id'),
  server: { host: os.hostname(), port: PORT, db: DB_FILE },
}));

route('GET', '/api/state', () => ({ orders: openOrders(), time: now() }));

route('GET', /^\/api\/orders\/(\d+)$/, ({ params }) => getOrder(Number(params[0])));

route('POST', '/api/orders/add-items', ({ body, user }) => {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) fail('Eklenecek ürün yok');
  const result = tx(() => {
    let orderId = Number(body.order_id) || null;
    if (orderId) {
      const o = q1('SELECT status FROM orders WHERE id=?', orderId);
      if (!o || o.status !== 'open') orderId = null;
    }
    if (!orderId && body.table_id) {
      orderId = q1("SELECT id FROM orders WHERE table_id=? AND status='open' AND type='masa'", body.table_id)?.id || null;
    }
    if (!orderId) {
      const type = body.table_id ? 'masa' : body.type === 'paket' ? 'paket' : 'bekleyen';
      orderId = Number(run(`INSERT INTO orders(type,table_id,name,opened_at,last_order_at,guests,customer_id,user_id,note,delivery_status)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, type, body.table_id || null, body.name || '', now(), now(), Number(body.guests) || 0,
        body.customer_id || null, user.id, body.note || '', type === 'paket' ? 'hazirlaniyor' : '').lastInsertRowid);
      log(user, 'adisyon_acildi', '#' + orderId);
    } else {
      run('UPDATE orders SET last_order_at=? WHERE id=?', now(), orderId);
      if (body.note) run('UPDATE orders SET note=? WHERE id=?', body.note, orderId);
      if (body.customer_id) run('UPDATE orders SET customer_id=? WHERE id=?', body.customer_id, orderId);
    }
    const added = [];
    const ins = db.prepare(`INSERT INTO order_items(order_id,product_id,category_id,name,qty,unit_price,free,note,user_id,created_at,kitchen_status,kitchen_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const it of items) {
      const p = q1('SELECT * FROM products WHERE id=?', it.product_id);
      if (!p) fail('Ürün bulunamadı');
      const qty = r2(it.qty);
      if (!(qty > 0)) fail('Geçersiz miktar');
      const price = p.ask_price || it.price_override !== undefined && ROLE_LEVEL[user.role] >= 2 ? r2(it.price ?? p.price) : p.price;
      const ks = p.kitchen ? 'new' : 'none';
      const id = ins.run(orderId, p.id, p.category_id, it.name || p.name, qty, price, it.free ? 1 : 0, it.note || '', user.id, now(), ks, now()).lastInsertRowid;
      const printerId = p.printer_id ?? q1('SELECT printer_id FROM categories WHERE id=?', p.category_id)?.printer_id ?? null;
      added.push({ id: Number(id), name: it.name || p.name, qty, note: it.note || '', kitchen: !!p.kitchen, printer_id: printerId || null });
    }
    log(user, 'urun_eklendi', `#${orderId}: ` + added.map((a) => `${a.qty}x ${a.name}`).join(', '));
    return { orderId, added };
  });
  const o = getOrder(result.orderId);
  const kitchenItems = result.added.filter((a) => a.kitchen);
  const s = settings();
  // Her ürün kendi yazıcısına: ürün yazıcısı > kategori yazıcısı. Adresi boş yazıcılar tarayıcıdan basılır.
  const browserTickets = [];
  if (s.kitchen_ticket === '1' && !body.no_print) {
    const groups = new Map();
    for (const a of result.added) {
      if (!a.printer_id) continue;
      if (!groups.has(a.printer_id)) groups.set(a.printer_id, []);
      groups.get(a.printer_id).push(a);
    }
    for (const [pid, items] of groups) {
      const pr = q1('SELECT * FROM printers WHERE id=? AND active=1', pid);
      if (!pr) continue;
      if (pr.address) {
        printDoc(pr.address, kitchenDoc(o, items, user, pr.name))
          .catch((e) => broadcast('print_error', { message: `${pr.name}: ${e.message}` }));
      } else browserTickets.push({ title: pr.name, items });
    }
  }
  broadcast('changed', { order_id: o.id });
  if (kitchenItems.length) broadcast('kitchen_new', { order_id: o.id, label: o.label });
  return { order: o, kitchen_items: kitchenItems, browser_tickets: browserTickets };
});

route('POST', /^\/api\/orders\/(\d+)\/update$/, ({ params, body, user }) => {
  const id = Number(params[0]);
  const o = q1('SELECT * FROM orders WHERE id=?', id);
  if (!o) fail('Adisyon bulunamadı', 404);
  const fields = {};
  if ('guests' in body) fields.guests = Math.max(0, Math.floor(Number(body.guests) || 0));
  if ('note' in body) fields.note = String(body.note || '');
  if ('name' in body) fields.name = String(body.name || '');
  if ('customer_id' in body) fields.customer_id = body.customer_id || null;
  if ('alarm_at' in body) fields.alarm_at = body.alarm_at || null;
  if ('delivery_status' in body) fields.delivery_status = String(body.delivery_status || '');
  if ('discount_type' in body) {
    need(user, 'kasiyer');
    fields.discount_type = ['percent', 'amount'].includes(body.discount_type) ? body.discount_type : '';
    fields.discount_value = Math.max(0, Number(body.discount_value) || 0);
    log(user, 'indirim', `#${id} ${fields.discount_type} ${fields.discount_value}`);
  }
  const keys = Object.keys(fields);
  if (keys.length) run(`UPDATE orders SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...keys.map((k) => fields[k]), id);
  if (fields.delivery_status === 'yolda' && o.customer_id) maybeSms(o.customer_id).catch(() => {});
  broadcast('changed', { order_id: id });
  return getOrder(id);
});

route('POST', /^\/api\/orders\/(\d+)\/pay$/, ({ params, body, user }) => {
  need(user, 'kasiyer');
  const id = Number(params[0]);
  const res = tx(() => {
    const o = getOrder(id);
    if (o.status !== 'open') fail('Adisyon açık değil');
    const amount = r2(body.amount);
    const method = String(body.method || 'nakit');
    if (!METHOD_NAMES[method]) fail('Geçersiz ödeme tipi');
    const seat = o.seats ? Math.max(0, Number(body.seat) || 0) : 0;
    if (amount > 0) {
      if (amount > o.remaining + 0.009) fail('Tutar kalan tutardan büyük olamaz');
      if (o.seats && body.seat !== undefined && body.seat !== null) {
        const g = o.seats.find((x) => x.seat === seat);
        if (!g) fail('Geçersiz kişi');
        if (amount > g.remaining + 0.009) fail(`${seatName(seat)} için kalan tutar ${fmt(g.remaining)} TL`);
      }
      const pid = run('INSERT INTO payments(order_id,method,amount,created_at,user_id,seat) VALUES(?,?,?,?,?,?)', id, method, amount, now(), user.id, seat).lastInsertRowid;
      if (method === 'cari') {
        const cid = body.customer_id || o.customer_id;
        if (!cid) fail('Cari ödeme için müşteri seçilmelidir');
        if (!o.customer_id) run('UPDATE orders SET customer_id=? WHERE id=?', cid, id);
        run('INSERT INTO customer_tx(customer_id,amount,method,note,order_id,payment_id,created_at,user_id) VALUES(?,?,?,?,?,?,?,?)',
          cid, amount, 'cari', 'Adisyon #' + id, id, pid, now(), user.id);
      }
      log(user, 'odeme', `#${id} ${METHOD_NAMES[method]} ${amount}`);
    }
    const closed = tryClose(id, user);
    return { closed };
  });
  broadcast('changed', { order_id: id });
  return { ...res, order: getOrder(id) };
});

route('POST', /^\/api\/orders\/(\d+)\/close-zero$/, ({ params, user }) => {
  need(user, 'kasiyer');
  const id = Number(params[0]);
  const closed = tx(() => tryClose(id, user));
  if (!closed) fail('Adisyonda ödenmemiş tutar var');
  broadcast('changed', { order_id: id });
  return { closed };
});

route('POST', /^\/api\/orders\/(\d+)\/cancel$/, ({ params, body, user }) => {
  need(user, 'kasiyer');
  const id = Number(params[0]);
  tx(() => {
    const o = getOrder(id);
    if (o.status !== 'open') fail('Adisyon açık değil');
    if (o.paid > 0) fail('Ödeme alınmış adisyon iptal edilemez. Önce Tahsilat İptal yapın.');
    const reason = String(body.reason || '');
    run("UPDATE order_items SET status='cancelled', cancel_reason=? WHERE order_id=? AND status='active'", reason, id);
    run("UPDATE orders SET status='cancelled', closed_at=?, cancel_reason=? WHERE id=?", now(), reason, id);
    log(user, 'adisyon_iptal', `${o.label} ${o.total} TL - ${reason}`);
  });
  broadcast('changed', { order_id: id });
  return { ok: true };
});

// ---------- hesap bölme ----------
route('POST', /^\/api\/orders\/(\d+)\/split$/, ({ params, body, user }) => {
  const id = Number(params[0]);
  const count = Math.floor(Number(body.count) || 0);
  if (count < 0 || count > 20) fail('Kişi sayısı 0-20 arası olmalı');
  tx(() => {
    const o = q1("SELECT * FROM orders WHERE id=? AND status='open'", id);
    if (!o) fail('Adisyon açık değil');
    run('UPDATE order_items SET seat=0 WHERE order_id=? AND seat>?', id, count);
    run('UPDATE payments SET seat=0 WHERE order_id=? AND seat>?', id, count);
    run('UPDATE orders SET split_count=? WHERE id=?', count, id);
    log(user, 'hesap_bol', `#${id} ${count} kişi`);
  });
  broadcast('changed', { order_id: id });
  return getOrder(id);
});

route('POST', '/api/items/assign', ({ body }) => {
  const ids = (body.ids || []).map(Number);
  const seat = Math.max(0, Number(body.seat) || 0);
  let orderId;
  for (const iid of ids) {
    const it = q1('SELECT order_id FROM order_items WHERE id=?', iid);
    if (!it) continue;
    orderId = it.order_id;
    run('UPDATE order_items SET seat=? WHERE id=?', seat, iid);
  }
  if (!orderId) fail('Satır bulunamadı');
  broadcast('changed', { order_id: orderId });
  return getOrder(orderId);
});

// Bir satırı parçalara ayırır: parts=[{qty, seat}] toplamı satır adedine eşit olmalı
route('POST', /^\/api\/items\/(\d+)\/split$/, ({ params, body, user }) => {
  const it = q1('SELECT * FROM order_items WHERE id=?', Number(params[0]));
  if (!it || it.status !== 'active') fail('Satır bulunamadı');
  const parts = (body.parts || []).map((p) => ({ qty: r2(p.qty), seat: Math.max(0, Number(p.seat) || 0) })).filter((p) => p.qty > 0);
  if (parts.length < 2) fail('En az iki parça gerekli');
  if (Math.abs(parts.reduce((s, p) => s + p.qty, 0) - it.qty) > 0.001) fail('Parçaların toplamı satır adedine eşit olmalı');
  tx(() => {
    run('UPDATE order_items SET qty=?, seat=? WHERE id=?', parts[0].qty, parts[0].seat, it.id);
    const ins = db.prepare(`INSERT INTO order_items(order_id,product_id,category_id,name,qty,unit_price,free,note,user_id,created_at,status,kitchen_status,kitchen_at,seat)
      VALUES(?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`);
    for (const p of parts.slice(1)) {
      ins.run(it.order_id, it.product_id, it.category_id, it.name, p.qty, it.unit_price, it.free, it.note, it.user_id, it.created_at, it.kitchen_status, it.kitchen_at, p.seat);
    }
    log(user, 'satir_bol', `#${it.order_id} ${it.name} → ${parts.map((p) => p.qty).join(' + ')}`);
  });
  broadcast('changed', { order_id: it.order_id });
  return getOrder(it.order_id);
});

route('POST', '/api/items/cancel', ({ body, user }) => {
  need(user, 'kasiyer');
  const ids = (body.ids || []).map(Number);
  const reason = String(body.reason || '');
  let orderId;
  tx(() => {
    for (const iid of ids) {
      const it = q1('SELECT * FROM order_items WHERE id=?', iid);
      if (!it || it.status !== 'active') continue;
      orderId = it.order_id;
      const cq = body.qty && ids.length === 1 ? r2(body.qty) : it.qty;
      if (cq < it.qty) {
        run('UPDATE order_items SET qty=? WHERE id=?', r2(it.qty - cq), iid);
        run(`INSERT INTO order_items(order_id,product_id,category_id,name,qty,unit_price,free,note,user_id,created_at,status,cancel_reason,kitchen_status)
          VALUES(?,?,?,?,?,?,?,?,?,?,'cancelled',?,'none')`, it.order_id, it.product_id, it.category_id, it.name, cq, it.unit_price, it.free, it.note, it.user_id, it.created_at, reason);
      } else {
        run("UPDATE order_items SET status='cancelled', cancel_reason=? WHERE id=?", reason, iid);
      }
      log(user, 'urun_iptal', `#${it.order_id} ${cq}x ${it.name} - ${reason}`);
    }
    if (orderId) closeIfEmpty(orderId, user);
  });
  broadcast('changed', { order_id: orderId });
  return orderId ? getOrder(orderId) : {};
});

route('POST', /^\/api\/items\/(\d+)\/edit$/, ({ params, body, user }) => {
  const id = Number(params[0]);
  const it = q1('SELECT * FROM order_items WHERE id=?', id);
  if (!it || it.status !== 'active') fail('Satır bulunamadı');
  const qty = 'qty' in body ? r2(body.qty) : it.qty;
  if (!(qty > 0)) fail('Geçersiz miktar');
  if (qty < it.qty || ('unit_price' in body && r2(body.unit_price) !== it.unit_price) || ('free' in body && !!body.free !== !!it.free)) need(user, 'kasiyer');
  const price = 'unit_price' in body ? r2(body.unit_price) : it.unit_price;
  const free = 'free' in body ? (body.free ? 1 : 0) : it.free;
  const note = 'note' in body ? String(body.note || '') : it.note;
  run('UPDATE order_items SET qty=?, unit_price=?, free=?, note=? WHERE id=?', qty, price, free, note, id);
  log(user, 'satir_duzenle', `#${it.order_id} ${it.name}: ${it.qty}→${qty}, ${it.unit_price}→${price}${free ? ' ikram' : ''}`);
  broadcast('changed', { order_id: it.order_id });
  return getOrder(it.order_id);
});

route('POST', /^\/api\/orders\/(\d+)\/move$/, ({ params, body, user }) => {
  const id = Number(params[0]);
  const targetTable = Number(body.target_table_id);
  const itemIds = (body.item_ids || []).map(Number);
  const res = tx(() => {
    const o = getOrder(id);
    if (o.status !== 'open') fail('Adisyon açık değil');
    const tgt = q1("SELECT id FROM orders WHERE table_id=? AND status='open' AND type='masa'", targetTable);
    if (tgt && tgt.id === id) fail('Aynı masa seçildi');
    const activeIds = o.items.filter((i) => i.status === 'active').map((i) => i.id);
    const moveAll = !itemIds.length || activeIds.every((i) => itemIds.includes(i));
    if (moveAll && !tgt) {
      run("UPDATE orders SET table_id=?, type='masa' WHERE id=?", targetTable, id);
      log(user, 'masa_tasi', `${o.label} → masa ${targetTable}`);
      return id;
    }
    let targetId = tgt?.id;
    if (!targetId) {
      targetId = Number(run("INSERT INTO orders(type,table_id,opened_at,last_order_at,guests,user_id) VALUES('masa',?,?,?,0,?)",
        targetTable, now(), now(), user.id).lastInsertRowid);
    }
    const toMove = moveAll ? activeIds : itemIds;
    for (const iid of toMove) run('UPDATE order_items SET order_id=? WHERE id=? AND order_id=?', targetId, iid, id);
    if (moveAll) {
      run('UPDATE payments SET order_id=? WHERE order_id=?', targetId, id);
      run('UPDATE order_items SET order_id=? WHERE order_id=?', targetId, id);
      run('UPDATE orders SET guests=guests+? WHERE id=?', o.guests || 0, targetId);
      run("UPDATE orders SET status='merged', closed_at=? WHERE id=?", now(), id);
      log(user, 'masa_birlestir', `${o.label} → #${targetId}`);
    } else {
      run('UPDATE orders SET last_order_at=? WHERE id=?', now(), targetId);
      log(user, 'urun_tasi', `${o.label}: ${toMove.length} satır → #${targetId}`);
    }
    return targetId;
  });
  broadcast('changed', {});
  return getOrder(res);
});

route('POST', '/api/print', async ({ body, user }) => {
  const s = settings();
  const o = getOrder(Number(body.order_id));
  const kind = body.kind === 'receipt' ? 'receipt' : 'adisyon';
  log(user, kind === 'receipt' ? 'fis_yazdir' : 'adisyon_yazdir', o.label);
  if (!s.receipt_printer) return { printed: false, order: o };
  await printDoc(s.receipt_printer, receiptDoc(o, kind));
  return { printed: true };
});

route('POST', '/api/print-test', async ({ body }) => {
  const addr = String(body.address || '');
  if (!addr) fail('Yazıcı adresi girin');
  await printDoc(addr, [{ t: 'text', v: 'TEST YAZDIRMA', align: 'center', bold: true, size: 'big' },
    { t: 'text', v: 'Türkçe karakter: ÇçĞğİıÖöŞşÜü', align: 'center' }, { t: 'text', v: dt(now()), align: 'center' }]);
  return { ok: true };
});

route('POST', '/api/drawer', async ({ user }) => {
  need(user, 'kasiyer');
  const s = settings();
  log(user, 'cekmece_ac', '');
  if (!s.receipt_printer) return { opened: false };
  await sendRaw(s.receipt_printer, Buffer.concat([CMD.init, CMD.drawer]));
  return { opened: true };
});

// mutfak
route('GET', '/api/kitchen', () => {
  const items = q(`SELECT i.id, i.order_id, i.name, i.qty, i.note, i.kitchen_status, i.kitchen_at, i.created_at, u.name user_name
    FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN users u ON u.id=i.user_id
    WHERE i.status='active' AND o.status='open' AND i.kitchen_status IN ('new','preparing') ORDER BY i.id`);
  const orders = {};
  for (const it of items) {
    if (!orders[it.order_id]) {
      const o = q1('SELECT o.*, c.name customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?', it.order_id);
      orders[it.order_id] = { id: o.id, type: o.type, label: orderLabel(o), note: o.note, items: [] };
    }
    orders[it.order_id].items.push(it);
  }
  const recent = q(`SELECT i.id, i.order_id, i.name, i.qty, i.kitchen_at FROM order_items i
    WHERE i.kitchen_status='ready' AND i.kitchen_at>? ORDER BY i.kitchen_at DESC LIMIT 20`, now() - 30 * 60000);
  return { orders: Object.values(orders), recent };
});

route('POST', '/api/kitchen/status', ({ body, user }) => {
  const ids = (body.ids || []).map(Number);
  const status = String(body.status);
  if (!['new', 'preparing', 'ready', 'served'].includes(status)) fail('Geçersiz durum');
  const orderIds = new Set();
  for (const iid of ids) {
    const it = q1('SELECT order_id FROM order_items WHERE id=?', iid);
    if (!it) continue;
    orderIds.add(it.order_id);
    run('UPDATE order_items SET kitchen_status=?, kitchen_at=? WHERE id=?', status, now(), iid);
  }
  broadcast('changed', {});
  if (status === 'ready') {
    for (const oid of orderIds) {
      const o = q1('SELECT o.*, c.name customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?', oid);
      broadcast('kitchen_ready', { order_id: oid, label: orderLabel(o) });
    }
    log(user, 'mutfak_hazir', [...orderIds].join(','));
  }
  return { ok: true };
});

// müşteriler
route('GET', '/api/customers', ({ query }) => {
  const s = `%${(query.q || '').trim()}%`;
  return q(`SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM customer_tx WHERE customer_id=c.id) balance,
    (SELECT COUNT(*) FROM orders WHERE customer_id=c.id AND status='paid') order_count
    FROM customers c WHERE c.name LIKE ? OR c.phone LIKE ? OR c.address LIKE ? ORDER BY c.name LIMIT 200`, s, s, s);
});

route('GET', /^\/api\/customers\/(\d+)$/, ({ params }) => {
  const id = Number(params[0]);
  const c = q1('SELECT c.*, (SELECT COALESCE(SUM(amount),0) FROM customer_tx WHERE customer_id=c.id) balance FROM customers c WHERE id=?', id);
  if (!c) fail('Müşteri bulunamadı', 404);
  c.orders = q("SELECT id, type, status, opened_at, closed_at, total FROM orders WHERE customer_id=? AND status IN ('paid','open') ORDER BY id DESC LIMIT 20", id);
  for (const o of c.orders) o.items = q("SELECT name, qty FROM order_items WHERE order_id=? AND status='active'", o.id);
  c.tx = q('SELECT * FROM customer_tx WHERE customer_id=? ORDER BY id DESC LIMIT 50', id);
  return c;
});

route('POST', '/api/customers/save', ({ body, user }) => {
  const name = String(body.name || '').trim();
  if (!name) fail('Müşteri adı gerekli');
  const phone = String(body.phone || '').replace(/[^\d+]/g, '');
  if (body.id) {
    run('UPDATE customers SET name=?, phone=?, address=?, note=? WHERE id=?', name, phone, body.address || '', body.note || '', body.id);
    return q1('SELECT * FROM customers WHERE id=?', body.id);
  }
  const id = run('INSERT INTO customers(name,phone,address,note,created_at) VALUES(?,?,?,?,?)', name, phone, body.address || '', body.note || '', now()).lastInsertRowid;
  log(user, 'musteri_eklendi', name);
  return q1('SELECT * FROM customers WHERE id=?', id);
});

route('POST', '/api/customers/delete', ({ body, user }) => {
  need(user, 'admin');
  run('DELETE FROM customers WHERE id=?', body.id);
  return { ok: true };
});

route('POST', '/api/customers/collect', ({ body, user }) => {
  need(user, 'kasiyer');
  const amount = r2(body.amount);
  if (!(amount > 0)) fail('Geçersiz tutar');
  const method = body.method === 'kart' ? 'kart' : 'nakit';
  run('INSERT INTO customer_tx(customer_id,amount,method,note,created_at,user_id) VALUES(?,?,?,?,?,?)',
    body.customer_id, -amount, method, 'Tahsilat', now(), user.id);
  log(user, 'cari_tahsilat', `${body.customer_id} ${amount} ${method}`);
  return { ok: true };
});

// kasa çıkış
route('GET', '/api/expenses', ({ query }) => {
  const from = Number(query.from) || periodStart();
  const to = Number(query.to) || now() + 1;
  return q('SELECT e.*, u.name user_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id WHERE created_at>=? AND created_at<? ORDER BY id DESC', from, to);
});
route('POST', '/api/expenses/save', ({ body, user }) => {
  need(user, 'kasiyer');
  const amount = r2(body.amount);
  if (!(amount > 0)) fail('Geçersiz tutar');
  const d = String(body.description || '').trim() || 'Kasa çıkış';
  run('INSERT INTO expenses(description,amount,created_at,user_id) VALUES(?,?,?,?)', d, amount, now(), user.id);
  log(user, 'kasa_cikis', `${d} ${amount}`);
  broadcast('expenses', {});
  return { ok: true };
});
route('POST', '/api/expenses/delete', ({ body, user }) => {
  need(user, 'admin');
  const e = q1('SELECT * FROM expenses WHERE id=?', body.id);
  run('DELETE FROM expenses WHERE id=?', body.id);
  if (e) log(user, 'kasa_cikis_sil', `${e.description} ${e.amount}`);
  broadcast('expenses', {});
  return { ok: true };
});

// raporlar ve gün sonu
route('GET', '/api/reports', ({ query, user }) => {
  need(user, 'kasiyer');
  return report(Number(query.from) || 0, Number(query.to) || now() + 1);
});
route('GET', '/api/dayend', ({ user }) => {
  need(user, 'kasiyer');
  const start = periodStart();
  return {
    current: report(start, now() + 1),
    closings: q('SELECT d.id, d.period_start, d.closed_at, u.name user_name FROM day_closings d LEFT JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 60'),
  };
});
route('GET', /^\/api\/dayend\/(\d+)$/, ({ params, user }) => {
  need(user, 'kasiyer');
  const d = q1('SELECT * FROM day_closings WHERE id=?', Number(params[0]));
  if (!d) fail('Kayıt bulunamadı', 404);
  return { ...d, summary: JSON.parse(d.summary) };
});
route('POST', '/api/dayend/close', ({ user }) => {
  need(user, 'kasiyer');
  const start = periodStart();
  const t = now();
  const summary = report(start, t);
  run('INSERT INTO day_closings(period_start,closed_at,user_id,summary) VALUES(?,?,?,?)', start, t, user.id, JSON.stringify(summary));
  log(user, 'gun_sonu', `${summary.revenue} TL`);
  broadcast('changed', {});
  return { ok: true, summary };
});

route('GET', '/api/payments', ({ query, user }) => {
  need(user, 'kasiyer');
  const from = Number(query.from) || periodStart();
  return q(`SELECT p.*, u.name user_name, o.type, o.table_id, o.name order_name FROM payments p
    LEFT JOIN users u ON u.id=p.user_id LEFT JOIN orders o ON o.id=p.order_id
    WHERE p.created_at>=? ORDER BY p.id DESC LIMIT 300`, from).map((p) => ({ ...p, label: orderLabel({ ...p, id: p.order_id, name: p.order_name }) }));
});
route('POST', '/api/payments/cancel', ({ body, user }) => {
  need(user, 'admin');
  const p = q1('SELECT * FROM payments WHERE id=?', body.id);
  if (!p || p.cancelled) fail('Ödeme bulunamadı');
  tx(() => {
    run('UPDATE payments SET cancelled=1, cancelled_at=?, cancel_user_id=? WHERE id=?', now(), user.id, p.id);
    run('DELETE FROM customer_tx WHERE payment_id=?', p.id);
    const o = q1('SELECT * FROM orders WHERE id=?', p.order_id);
    if (o && o.status === 'paid') {
      const busy = o.table_id && q1("SELECT id FROM orders WHERE table_id=? AND status='open' AND type='masa'", o.table_id);
      if (busy) run("UPDATE orders SET status='open', closed_at=NULL, type='bekleyen', table_id=NULL, name=? WHERE id=?", 'İade #' + o.id, o.id);
      else run("UPDATE orders SET status='open', closed_at=NULL WHERE id=?", o.id);
    }
    log(user, 'tahsilat_iptal', `#${p.order_id} ${p.method} ${p.amount}`);
  });
  broadcast('changed', {});
  return { ok: true };
});

route('GET', '/api/logs', ({ query, user }) => {
  need(user, 'admin');
  return q('SELECT l.*, u.name user_name FROM logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT ?', Number(query.limit) || 300);
});

route('GET', '/api/network', () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
  return { ips, port: PORT };
});

// yönetim (ayarlar, kullanıcılar, ürünler, bölümler)
route('POST', '/api/settings', ({ body, user }) => {
  need(user, 'admin');
  const st = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(() => { for (const [k, v] of Object.entries(body)) st.run(k, String(v ?? '')); });
  log(user, 'ayarlar', Object.keys(body).join(','));
  broadcast('config', {});
  return settings();
});

const ENTITIES = {
  users: { cols: ['name', 'pin', 'role', 'active'], order: 'id' },
  sections: { cols: ['name', 'sort'], order: 'sort, id' },
  tables: { cols: ['section_id', 'name', 'sort'], order: 'section_id, sort, id' },
  categories: { cols: ['name', 'sort', 'printer_id'], order: 'sort, id' },
  products: { cols: ['category_id', 'name', 'price', 'sort', 'active', 'kitchen', 'ask_price', 'printer_id'], order: 'category_id, sort, id' },
  printers: { cols: ['name', 'address', 'active'], order: 'id' },
};

route('GET', /^\/api\/admin\/(\w+)$/, ({ params, user }) => {
  need(user, 'admin');
  const e = ENTITIES[params[0]];
  if (!e) fail('Bilinmeyen kayıt türü', 404);
  return q(`SELECT * FROM ${params[0]} ORDER BY ${e.order}`);
});

route('POST', /^\/api\/admin\/(\w+)\/save$/, ({ params, body, user }) => {
  need(user, 'admin');
  const name = params[0];
  const e = ENTITIES[name];
  if (!e) fail('Bilinmeyen kayıt türü', 404);
  if ('name' in body && !String(body.name).trim()) fail('Ad boş olamaz');
  if (name === 'users') {
    if (!/^\d{3,8}$/.test(String(body.pin || ''))) fail('Şifre 3-8 haneli rakam olmalı');
    const dup = q1('SELECT id FROM users WHERE pin=? AND id<>?', String(body.pin), body.id || 0);
    if (dup) fail('Bu şifre başka kullanıcıda kayıtlı');
  }
  const cols = e.cols.filter((c) => c in body);
  const vals = cols.map((c) => (typeof body[c] === 'boolean' ? (body[c] ? 1 : 0) : body[c]));
  let id = body.id;
  if (id) run(`UPDATE ${name} SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`, ...vals, id);
  else id = Number(run(`INSERT INTO ${name}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...vals).lastInsertRowid);
  log(user, name + '_kaydet', JSON.stringify(body));
  broadcast('config', {});
  return q1(`SELECT * FROM ${name} WHERE id=?`, id);
});

route('POST', /^\/api\/admin\/(\w+)\/delete$/, ({ params, body, user }) => {
  need(user, 'admin');
  const name = params[0];
  if (!ENTITIES[name]) fail('Bilinmeyen kayıt türü', 404);
  if (name === 'tables' && q1("SELECT id FROM orders WHERE table_id=? AND status='open'", body.id)) fail('Masada açık adisyon var');
  if (name === 'sections') {
    if (q1("SELECT o.id FROM orders o JOIN tables t ON t.id=o.table_id WHERE t.section_id=? AND o.status='open'", body.id)) fail('Bölümde açık adisyon var');
    run('DELETE FROM tables WHERE section_id=?', body.id);
  }
  if (name === 'printers') {
    run('UPDATE categories SET printer_id=NULL WHERE printer_id=?', body.id);
    run('UPDATE products SET printer_id=NULL WHERE printer_id=?', body.id);
  }
  if (name === 'categories') run('UPDATE products SET active=0, category_id=NULL WHERE category_id=?', body.id);
  if (name === 'users' && Number(body.id) === user.id) fail('Kendi kullanıcınızı silemezsiniz');
  if (name === 'products' || name === 'users') run(`UPDATE ${name} SET active=0 WHERE id=?`, body.id);
  else run(`DELETE FROM ${name} WHERE id=?`, body.id);
  log(user, name + '_sil', String(body.id));
  broadcast('config', {});
  return { ok: true };
});

route('POST', '/api/admin/tables/generate', ({ body, user }) => {
  need(user, 'admin');
  const from = Number(body.from), to = Number(body.to);
  if (!(from >= 0 && to >= from && to - from < 500)) fail('Geçersiz aralık');
  const prefix = String(body.prefix || '');
  const ins = db.prepare('INSERT INTO tables(section_id,name,sort) VALUES(?,?,?)');
  tx(() => { for (let i = from; i <= to; i++) ins.run(body.section_id, prefix + i, i); });
  broadcast('config', {});
  return { ok: true };
});

route('POST', '/api/admin/products/bulk-price', ({ body, user }) => {
  need(user, 'admin');
  const pct = Number(body.percent);
  const step = Number(body.round) || 0;
  if (!pct) fail('Yüzde girin');
  const rows = body.category_id ? q('SELECT id, price FROM products WHERE category_id=?', body.category_id) : q('SELECT id, price FROM products');
  tx(() => {
    for (const p of rows) {
      if (!p.price) continue;
      let np = p.price * (1 + pct / 100);
      np = step ? Math.round(np / step) * step : r2(np);
      run('UPDATE products SET price=? WHERE id=?', np, p.id);
    }
  });
  log(user, 'toplu_fiyat', `%${pct} kategori:${body.category_id || 'tümü'} yuvarlama:${step}`);
  broadcast('config', {});
  return { updated: rows.length };
});

route('POST', '/api/admin/products/reorder', ({ body, user }) => {
  need(user, 'admin');
  tx(() => (body.ids || []).forEach((id, i) => run('UPDATE products SET sort=? WHERE id=?', i + 1, id)));
  broadcast('config', {});
  return { ok: true };
});

// SMS (HTTP GET tabanlı sağlayıcılar: {telefon} ve {mesaj} yer tutucuları)
async function sendSms(phone, message) {
  const s = settings();
  if (!s.sms_url) throw new Error('SMS adresi tanımlı değil');
  const url = s.sms_url.replace('{telefon}', encodeURIComponent(phone)).replace('{mesaj}', encodeURIComponent(message));
  const r = await fetch(url);
  return (await r.text()).slice(0, 300);
}
async function maybeSms(customerId) {
  const s = settings();
  if (s.sms_enabled !== '1') return;
  const c = q1('SELECT * FROM customers WHERE id=?', customerId);
  if (!c?.phone) return;
  await sendSms(c.phone, s.sms_template_paket.replace('{ad}', c.name).replace('{restoran}', s.restaurant_name));
}
route('POST', '/api/sms/test', async ({ body, user }) => {
  need(user, 'admin');
  return { response: await sendSms(String(body.phone || ''), String(body.message || 'Test mesajı')) };
});

route('GET', '/api/backup', ({ res, user }) => {
  need(user, 'admin');
  const tmp = path.join(os.tmpdir(), `yedek-${now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const name = `restoran-yedek-${new Date().toISOString().slice(0, 10)}.db`;
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"` });
  fs.createReadStream(tmp).on('close', () => fs.unlink(tmp, () => {})).pipe(res);
  log(user, 'yedek_alindi', name);
  return undefined;
});

// ---------- HTTP sunucusu ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/garson') pathname = '/garson.html';
  if (pathname === '/mutfak') pathname = '/mutfak.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Bulunamadı'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 5e6) { reject(new HttpError(413, 'İstek çok büyük')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Geçersiz JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  const query = Object.fromEntries(url.searchParams);
  const token = req.headers['x-token'] || query.token;
  const user = sessions.get(token);

  if (pathname === '/api/events') {
    if (!user) { res.writeHead(401).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = typeof r.pattern === 'string' ? (r.pattern === pathname ? [] : null) : pathname.match(r.pattern)?.slice(1);
    if (!m) continue;
    try {
      if (!r.public && !user) throw new HttpError(401, 'Oturum süresi doldu, tekrar giriş yapın');
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await r.handler({ req, res, body, query, params: m, user, token });
      if (out !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out));
      }
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) res.writeHead(e.status || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message || 'Sunucu hatası' }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Bulunamadı' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Restoran POS çalışıyor:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) {
      console.log(`  Garson el terminali:     http://${i.address}:${PORT}/garson`);
      console.log(`  Mutfak ekranı:           http://${i.address}:${PORT}/mutfak`);
    }
  }
  console.log(`  Veritabanı: ${DB_FILE}\n`);
});
