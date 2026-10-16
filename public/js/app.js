import {
  $, $$, esc, money, qty, dateTime, duration, hm, api, ensureSession, connectEvents, toast, beep, modal, confirmBox,
  textPrompt, numberPrompt, numpad, printHtml, receiptHtml, kitchenHtml, logout, loginScreen, METHODS,
} from './common.js';
import { openOptions } from './options.js';

const S = {
  boot: null,
  orders: [],
  view: 'masa',            // masa | satis
  leftMode: 'section',     // section | paket | bekleyen | cagri | kasa
  sectionId: null,
  categoryId: null,
  cur: null,               // {tableId, orderId, type, name, customerId, customerName}
  order: null,             // seçili adisyonun detayı
  pending: [],
  pendingSel: -1,
  mult: 1,
  detailSel: new Set(),
  pendingNote: '',
  alarmsFired: new Set(),
};
const isAdmin = () => S.boot.me.role === 'admin';
const canCash = () => S.boot.me.role !== 'garson';
const setting = (k) => S.boot.settings[k];
const listSetting = (k) => (setting(k) || '').split(',').map((s) => s.trim()).filter(Boolean);
const tableById = (id) => S.boot.tables.find((t) => t.id === id);
const sectionById = (id) => S.boot.sections.find((s) => s.id === id);
const productById = (id) => S.boot.products.find((p) => p.id === id);
const orderForTable = (tid) => S.orders.find((o) => o.type === 'masa' && o.table_id === tid);
const err = (e) => toast(e.message || String(e), 'error', 4000);

// ---------------- başlangıç ----------------
async function start() {
  S.boot = await ensureSession('Restoran POS');
  document.title = (setting('restaurant_name') || 'Restoran') + ' - POS';
  S.sectionId = S.boot.sections[0]?.id ?? null;
  S.categoryId = S.boot.categories[0]?.id ?? null;
  $('#app').hidden = false;
  bindUi();
  await refreshState();
  connectEvents(onEvent, (ok) => $('#conn').classList.toggle('off', !ok));
  setInterval(tick, 15000);
  setInterval(() => { $('#clock').textContent = hm(Date.now()); }, 1000);
  $('#clock').textContent = hm(Date.now());
  renderAll();
}

async function reloadBoot() {
  const me = S.boot.me;
  S.boot = await api('/api/bootstrap');
  S.boot.me = me;
  if (!sectionById(S.sectionId)) S.sectionId = S.boot.sections[0]?.id ?? null;
  if (!S.boot.categories.find((c) => c.id === S.categoryId)) S.categoryId = S.boot.categories[0]?.id ?? null;
  renderAll();
}

let refreshTimer;
function onEvent(ev) {
  if (ev.type === 'changed') { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshState, 120); }
  else if (ev.type === 'config') reloadBoot().catch(() => {});
  else if (ev.type === 'kitchen_ready') { toast(`🔔 Mutfak hazır: ${ev.label}`, 'ok', 5000); beep(2, 1100); }
  else if (ev.type === 'print_error') toast(ev.message, 'error', 6000);
  else if (ev.type === 'expenses' && S.leftMode === 'kasa') renderGrid();
}

async function refreshState() {
  try {
    const st = await api('/api/state');
    S.orders = st.orders;
    // seçili masanın adisyonu değişmiş olabilir
    if (S.cur) {
      if (S.cur.tableId) S.cur.orderId = orderForTable(S.cur.tableId)?.id ?? null;
      else if (S.cur.orderId && !S.orders.find((o) => o.id === S.cur.orderId)) { S.cur.orderId = null; if (!S.pending.length) S.cur = null; }
    }
    await loadOrder();
    renderAll();
  } catch (e) { err(e); }
}

async function loadOrder() {
  if (S.cur?.orderId) {
    try { S.order = await api('/api/orders/' + S.cur.orderId); } catch { S.order = null; }
    if (S.order && S.order.status !== 'open') S.order = null;
  } else S.order = null;
  const ids = new Set((S.order?.items || []).map((i) => i.id));
  for (const id of [...S.detailSel]) if (!ids.has(id)) S.detailSel.delete(id);
}

function tick() {
  const now = Date.now();
  for (const o of S.orders) {
    if (o.alarm_at && o.alarm_at <= now && !S.alarmsFired.has(o.id + ':' + o.alarm_at)) {
      S.alarmsFired.add(o.id + ':' + o.alarm_at);
      beep(4, 990);
      toast(`⏰ ALARM: ${labelOf(o)}`, 'warn', 8000);
    }
  }
  renderGrid(); renderInfo();
}

function labelOf(o) {
  if (o.type === 'masa') {
    const t = tableById(o.table_id);
    return t ? `${sectionById(t.section_id)?.name || ''} (${t.name})` : 'Masa';
  }
  if (o.type === 'paket') return 'Paket / ' + (o.customer_name || o.name || '#' + o.id);
  return 'Bekleyen / ' + (o.name || '#' + o.id);
}

// ---------------- seçim ----------------
async function selectTable(tid) {
  if (S.pending.length && S.cur?.tableId !== tid) {
    if (!(await confirmBox('Kaydedilmemiş ürünler var. Vazgeçilsin mi?'))) return;
    clearPending();
  }
  const o = orderForTable(tid);
  S.cur = { tableId: tid, orderId: o?.id ?? null, type: 'masa' };
  S.detailSel.clear();
  await loadOrder();
  if (setting('table_click_to_sales') === '1') S.view = 'satis';
  renderAll();
}

async function selectOrder(o) {
  if (S.pending.length && S.cur?.orderId !== o.id) {
    if (!(await confirmBox('Kaydedilmemiş ürünler var. Vazgeçilsin mi?'))) return;
    clearPending();
  }
  S.cur = { tableId: null, orderId: o.id, type: o.type, name: o.name, customerId: o.customer_id, customerName: o.customer_name };
  S.detailSel.clear();
  await loadOrder();
  renderAll();
}

function startNew(type, extra = {}) {
  clearPending();
  S.cur = { tableId: null, orderId: null, type, ...extra };
  S.order = null;
  S.detailSel.clear();
  S.view = 'satis';
  renderAll();
}

function clearPending() {
  S.pending = []; S.pendingSel = -1; S.pendingNote = '';
  $('#freeChk').checked = false;
  $('#noPrintChk').checked = false;
}

// ---------------- render ----------------
function renderAll() { renderLeft(); renderGrid(); renderDetails(); renderPending(); renderInfo(); renderButtons(); }

function renderLeft() {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  const el = $('#leftList');
  if (S.view === 'satis') {
    el.innerHTML = S.boot.categories.map((c) => `<button class="left-item cat ${c.id === S.categoryId ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('');
    return;
  }
  const count = (fn) => S.orders.filter(fn).length;
  const badge = (n) => (n ? `<span class="badge">${n}</span>` : '');
  el.innerHTML = S.boot.sections.map((s) => {
    const n = count((o) => o.type === 'masa' && tableById(o.table_id)?.section_id === s.id);
    return `<button class="left-item ${S.leftMode === 'section' && s.id === S.sectionId ? 'active' : ''}" data-section="${s.id}">${esc(s.name)}${badge(n)}</button>`;
  }).join('') + `<div class="left-sep"></div>
    <button class="left-item ${S.leftMode === 'paket' ? 'active' : ''}" data-mode="paket">Paket Servis${badge(count((o) => o.type === 'paket'))}</button>
    <button class="left-item ${S.leftMode === 'bekleyen' ? 'active' : ''}" data-mode="bekleyen">Bekleyen${badge(count((o) => o.type === 'bekleyen'))}</button>
    <button class="left-item ${S.leftMode === 'cagri' ? 'active' : ''}" data-mode="cagri">Çağrı Merkezi</button>
    <button class="left-item ${S.leftMode === 'kasa' ? 'active' : ''}" data-mode="kasa">Kasa Çıkış</button>`;
}

function fitGrid(grid, n, cols, minRow) {
  grid.style.setProperty('--cols', cols);
  grid.style.setProperty('--row-min', minRow + 'px');
  const rows = Math.max(1, Math.ceil(n / cols));
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(${minRow}px, 1fr))`;
}

function renderGrid() {
  const grid = $('#grid');
  grid.className = 'grid';
  grid.style.gridTemplateRows = '';
  if (S.view === 'satis') return renderProducts(grid);
  if (S.leftMode === 'section') return renderTables(grid);
  if (S.leftMode === 'paket' || S.leftMode === 'bekleyen') return renderCards(grid, S.leftMode);
  if (S.leftMode === 'cagri') return renderCallCenter(grid);
  if (S.leftMode === 'kasa') return renderExpenses(grid);
}

function renderTables(grid) {
  const tables = S.boot.tables.filter((t) => t.section_id === S.sectionId);
  const longWait = Number(setting('long_wait_minutes')) || 0;
  const now = Date.now();
  fitGrid(grid, tables.length, Number(setting('table_cols')) || 9, 64);
  grid.innerHTML = tables.map((t) => {
    const o = orderForTable(t.id);
    const cls = ['cell'];
    let inner = `<div class="t-name">${esc(t.name)}</div>`;
    if (o) {
      cls.push('busy');
      if (o.paid > 0) cls.push('partial');
      if (longWait && now - (o.last_order_at || o.opened_at) > longWait * 60000) cls.push('longwait');
      if (o.alarm_at && o.alarm_at <= now) cls.push('alarm');
      inner += `<div class="t-total">${money(o.remaining)} TL</div>
        <div class="t-meta">${duration(now - o.opened_at)}${o.guests ? ' · ' + o.guests + '👤' : ''}</div>
        <div class="t-icons">${o.k_ready ? '🔔' : o.k_wait ? '🍳' : ''}${o.alarm_at && o.alarm_at > now ? '⏰' : ''}</div>`;
    }
    if (S.cur?.tableId === t.id) cls.push('selected');
    return `<button class="${cls.join(' ')}" data-table="${t.id}">${inner}</button>`;
  }).join('');
}

const DELIVERY = { hazirlaniyor: 'Hazırlanıyor', yolda: 'Yolda', teslim: 'Teslim Edildi' };
const NEXT_DELIVERY = { hazirlaniyor: 'yolda', yolda: 'teslim', teslim: 'hazirlaniyor' };

function renderCards(grid, type) {
  const list = S.orders.filter((o) => o.type === type);
  const now = Date.now();
  fitGrid(grid, list.length + 1, 5, 110);
  grid.innerHTML = `<button class="cell add" data-new="${type}">＋<br>${type === 'paket' ? 'Yeni Paket Sipariş' : 'Yeni Adisyon'}</button>` +
    list.map((o) => {
      const sel = S.cur?.orderId === o.id ? ' selected' : '';
      const ds = o.delivery_status || 'hazirlaniyor';
      return `<button class="cell busy card${sel}" data-order="${o.id}">
        <div class="c-title">${type === 'paket' ? esc(o.customer_name || 'Paket #' + o.id) : esc(o.name || 'Adisyon #' + o.id)}</div>
        ${o.customer_phone ? `<div class="c-sub">📞 ${esc(o.customer_phone)}</div>` : ''}
        ${o.customer_address ? `<div class="c-sub">📍 ${esc(o.customer_address)}</div>` : ''}
        <div class="c-sub"><b>${money(o.remaining)} TL</b> · ${duration(now - o.opened_at)} ${o.k_ready ? '🔔' : o.k_wait ? '🍳' : ''}</div>
        ${type === 'paket' ? `<span class="c-status st-${ds === 'teslim' ? 'teslim' : ds}" data-delivery="${o.id}" data-next="${NEXT_DELIVERY[ds]}">${DELIVERY[ds]} ›</span>` : ''}
      </button>`;
    }).join('');
}

function renderProducts(grid) {
  const prods = S.boot.products.filter((p) => p.category_id === S.categoryId);
  fitGrid(grid, prods.length, Number(setting('product_cols')) || 5, 58);
  grid.innerHTML = prods.map((p) => `<button class="cell prod ${p.ask_price ? 'ask' : ''}" data-product="${p.id}">
    <span class="p-price">${p.ask_price ? 'Fiyat?' : money(p.price)}</span><span class="p-name">${esc(p.name)}</span></button>`).join('');
}

// --- Çağrı merkezi ---
let callQuery = '';
let callSelected = null;
async function renderCallCenter(grid) {
  grid.className = 'panel';
  grid.innerHTML = `<h3>📞 Çağrı Merkezi</h3>
    <div class="row"><input id="callQ" class="inp" style="flex:1" placeholder="Telefon, ad veya adres ile ara" value="${esc(callQuery)}">
    <button class="btn btn-blue" id="callSearch">Ara</button><button class="btn btn-green" id="callNew">+ Yeni Müşteri</button></div>
    <div class="cols2" style="margin-top:12px"><div id="callList"></div><div id="callDetail"></div></div>`;
  const q = $('#callQ');
  const search = async () => {
    callQuery = q.value.trim();
    const list = await api('/api/customers?q=' + encodeURIComponent(callQuery));
    $('#callList').innerHTML = list.length ? `<table class="tbl"><tr><th>Ad</th><th>Telefon</th><th class="r">Bakiye</th></tr>${list.map((c) =>
      `<tr class="click ${callSelected === c.id ? 'sel' : ''}" data-cid="${c.id}"><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td class="r">${money(c.balance)}</td></tr>`).join('')}</table>`
      : '<div class="muted">Kayıt bulunamadı.</div>';
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  $('#callSearch').onclick = search;
  $('#callNew').onclick = async () => {
    const c = await customerForm({ phone: /^\d+$/.test(q.value) ? q.value : '', name: /^\d+$/.test(q.value) ? '' : q.value });
    if (c) { callSelected = c.id; callQuery = c.phone || c.name; renderCallCenter(grid); }
  };
  $('#callList').onclick = (e) => { const tr = e.target.closest('[data-cid]'); if (tr) { callSelected = Number(tr.dataset.cid); showCallDetail(); search(); } };
  await search();
  if (callSelected) showCallDetail();
  q.focus();
}

async function showCallDetail() {
  const c = await api('/api/customers/' + callSelected);
  $('#callDetail').innerHTML = `<div class="kpi"><div class="v">${esc(c.name)}</div>
    <div>📞 ${esc(c.phone)}</div><div>📍 ${esc(c.address)}</div>${c.note ? `<div>📝 ${esc(c.note)}</div>` : ''}
    <div>Bakiye: <b>${money(c.balance)} TL</b></div>
    <div class="row" style="margin-top:8px"><button class="btn btn-green" id="callOrder">Paket Sipariş Aç</button><button class="btn" id="callEdit">Düzenle</button></div></div>
    <div class="section-title">Son Siparişler</div>
    <table class="tbl">${c.orders.map((o) => `<tr><td>${dateTime(o.opened_at)}</td><td>${esc(o.items.map((i) => qty(i.qty) + 'x ' + i.name).join(', '))}</td><td class="r">${money(o.total)}</td></tr>`).join('') || '<tr><td class="muted">Sipariş yok</td></tr>'}</table>`;
  $('#callOrder').onclick = () => startNew('paket', { customerId: c.id, customerName: c.name });
  $('#callEdit').onclick = async () => { if (await customerForm(c)) showCallDetail(); };
}

// --- Kasa çıkış ---
async function renderExpenses(grid) {
  grid.className = 'panel';
  let list = [];
  try { list = await api('/api/expenses'); } catch (e) { err(e); }
  const total = list.reduce((s, e) => s + e.amount, 0);
  grid.innerHTML = `<h3>💸 Kasa Çıkış (Gider)</h3>
    <div class="chips">${listSetting('expense_presets').map((p) => `<button class="chip" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <div class="row"><input id="expDesc" class="inp" style="flex:2" placeholder="Açıklama">
    <input id="expAmt" class="inp" style="flex:1" placeholder="Tutar" inputmode="decimal">
    <button class="btn btn-green" id="expSave">Kaydet</button></div>
    <div class="section-title">Bu dönemki çıkışlar — Toplam: <b>${money(total)} TL</b></div>
    <table class="tbl"><tr><th>Saat</th><th>Açıklama</th><th>Kullanıcı</th><th class="r">Tutar</th><th></th></tr>
    ${list.map((e) => `<tr><td>${dateTime(e.created_at)}</td><td>${esc(e.description)}</td><td>${esc(e.user_name || '')}</td><td class="r">${money(e.amount)}</td>
      <td class="r">${isAdmin() ? `<button class="btn btn-sm btn-red" data-del-exp="${e.id}">Sil</button>` : ''}</td></tr>`).join('')}</table>`;
  grid.onclick = async (ev) => {
    const p = ev.target.closest('[data-preset]'); if (p) { $('#expDesc').value = p.dataset.preset; $('#expAmt').focus(); return; }
    const d = ev.target.closest('[data-del-exp]');
    if (d && await confirmBox('Gider kaydı silinsin mi?')) { try { await api('/api/expenses/delete', { id: Number(d.dataset.delExp) }); } catch (e) { err(e); } }
  };
  $('#expAmt').onclick = async () => {
    const v = await numberPrompt('Tutar', { value: $('#expAmt').value });
    if (v !== undefined) $('#expAmt').value = String(v).replace('.', ',');
  };
  $('#expSave').onclick = async () => {
    try {
      await api('/api/expenses/save', { description: $('#expDesc').value, amount: Number($('#expAmt').value.replace(',', '.')) });
      toast('Kasa çıkış kaydedildi', 'ok');
    } catch (e) { err(e); }
  };
}

function curTitle() {
  if (!S.cur) return 'Adisyon Detayları';
  if (S.cur.tableId) { const t = tableById(S.cur.tableId); return `Adisyon Detayları / ${esc(sectionById(t?.section_id)?.name || '')} (${esc(t?.name || '')})`; }
  if (S.cur.type === 'paket') return `Adisyon Detayları / Paket${S.cur.customerName || S.order?.customer_name ? ' / ' + esc(S.cur.customerName || S.order.customer_name) : ''}`;
  return `Adisyon Detayları / Bekleyen${S.cur.name || S.order?.name ? ' / ' + esc(S.cur.name || S.order.name) : ''}`;
}

const KS_ICON = { new: '🕐', preparing: '🍳', ready: '🔔', served: '✔' };
function renderDetails() {
  $('#detailsTitle').innerHTML = curTitle();
  const o = S.order;
  const tb = $('#detailsRows');
  $('#servedBtn').hidden = !o?.items.some((i) => i.status === 'active' && i.kitchen_status === 'ready');
  if (!o) { tb.innerHTML = ''; return; }
  let html = o.items.map((i) => `<tr class="${i.status === 'cancelled' ? 'cancelled' : ''} ${S.detailSel.has(i.id) ? 'sel' : ''}" data-item="${i.id}">
    <td class="user">${esc(i.user_name || '')}</td>
    <td>${qty(i.qty)} x ${esc(i.name)}${i.free ? '<span class="free-tag">İKRAM</span>' : ''}<span class="ks">${KS_ICON[i.kitchen_status] || ''}</span>
      ${i.note ? `<span class="note">» ${esc(i.note)}</span>` : ''}${i.status === 'cancelled' ? `<span class="note">İptal: ${esc(i.cancel_reason)}</span>` : ''}</td>
    <td class="c-copy">${i.status === 'active' ? `<button class="copy-btn" data-copy="${i.id}">Kopyala</button>` : ''}</td>
    <td class="c-price">${money(i.unit_price)}</td><td class="c-total">${i.free ? '0,00' : money(i.qty * i.unit_price)}</td></tr>`).join('');
  if (o.discount > 0) html += `<tr class="sum"><td></td><td>İndirim ${o.discount_type === 'percent' ? '%' + o.discount_value : ''}</td><td></td><td></td><td class="c-total">-${money(o.discount)}</td></tr>`;
  for (const p of o.payments.filter((x) => !x.cancelled)) html += `<tr class="sum"><td></td><td>Ödeme: ${METHODS[p.method]} (${hm(p.created_at)})</td><td></td><td></td><td class="c-total">-${money(p.amount)}</td></tr>`;
  if (o.note) html += `<tr class="sum"><td></td><td colspan="4">📝 ${esc(o.note)}</td></tr>`;
  tb.innerHTML = html;
}

function renderPending() {
  $('#pendingRows').innerHTML = S.pending.map((p, i) => `<div class="prow ${i === S.pendingSel ? 'sel' : ''} ${p.free ? 'free' : ''}" data-p="${i}">
    <span>${esc(p.name)}${p.note ? `<span class="note">» ${esc(p.note)}</span>` : ''}</span><span>${qty(p.qty)}</span>
    <span>${p.free ? 'İkram' : money(p.qty * p.price)}</span></div>`).join('');
  const total = S.pending.reduce((s, p) => s + (p.free ? 0 : p.qty * p.price), 0);
  $('#pendingTotal').textContent = money(total) + ' TL';
  $('#cashierName').textContent = S.boot.me.name;
  const cname = S.cur?.customerName || S.order?.customer_name;
  const cb = $('#customerBtn');
  cb.textContent = cname ? '👤 ' + cname : 'Müşteri Seç';
  cb.classList.toggle('has', !!cname);
  $('#noteBtn').classList.toggle('has', !!(S.pendingNote || S.order?.note));
  $$('#mults button').forEach((b) => b.classList.toggle('active', Number(b.dataset.m) === S.mult));
  $('#alarmBtn').classList.toggle('on', !!S.order?.alarm_at);
  $('#alarmBtn').textContent = S.order?.alarm_at ? '⏰ ' + hm(S.order.alarm_at) : 'ALARM';
}

function renderInfo() {
  const o = S.order;
  const now = Date.now();
  const set = (id, v, on) => { const el = $('#' + id); el.textContent = v; el.classList.toggle('on', !!on); };
  set('infoOpen', dateTime(o?.opened_at), o);
  set('infoOpenDur', o ? duration(now - o.opened_at) : '00:00', o);
  set('infoLast', dateTime(o?.last_order_at), o);
  set('infoLastDur', o ? duration(now - o.last_order_at) : '00:00', o);
  set('infoTotal', money(o?.remaining) + ' TL', o);
  set('infoPaid', money(o?.paid) + ' TL', o?.paid);
  $('#guestCount').textContent = o?.guests ?? S.cur?.guests ?? 0;
}

function renderButtons() {
  const has = !!S.order;
  $('#payBtn').disabled = !has || !canCash();
  $('#printBtn').disabled = !has;
  $('#editBtn').disabled = !has;
  $('#moveBtn').disabled = !has;
  $('#discountBtn').disabled = !has || !canCash();
  $('#voidBtn').disabled = !has || !canCash();
  $('#drawerBtn').disabled = !canCash();
}

// ---------------- satış işlemleri ----------------
async function addProduct(pid, cellEl) {
  if (!S.cur) { toast('Önce masa seçin', 'warn'); S.view = 'masa'; renderAll(); return; }
  const p = productById(pid);
  let price = p.price;
  let name = p.name;
  if (p.ask_price) {
    const v = await numberPrompt(p.name + ' - Fiyat girin');
    if (v === undefined || v <= 0) return;
    price = v;
    const n = await textPrompt('Ürün açıklaması (isteğe bağlı)', { value: p.name });
    if (n) name = n;
  }
  const free = $('#freeChk').checked;
  const q = S.mult;
  const ex = S.pending.findIndex((x) => x.product_id === pid && x.free === free && !x.note && x.price === price && x.name === name);
  if (ex >= 0) { S.pending[ex].qty = Math.round((S.pending[ex].qty + q) * 100) / 100; S.pendingSel = ex; }
  else { S.pending.push({ product_id: pid, name, price, qty: q, free, note: '', ask: !!p.ask_price }); S.pendingSel = S.pending.length - 1; }
  S.mult = 1;
  cellEl?.classList.remove('flash'); void cellEl?.offsetWidth; cellEl?.classList.add('flash');
  renderPending();
  $('#pendingRows .prow.sel')?.scrollIntoView({ block: 'nearest' });
}

async function save() {
  if (!S.cur) return;
  if (!S.pending.length) {
    if (S.view === 'satis') { S.view = 'masa'; renderAll(); }
    return;
  }
  const btn = $('#saveBtn'); btn.disabled = true;
  try {
    const noPrint = $('#noPrintChk').checked;
    const r = await api('/api/orders/add-items', {
      order_id: S.cur.orderId, table_id: S.cur.tableId, type: S.cur.type, name: S.cur.name, customer_id: S.cur.customerId,
      guests: S.cur.guests, note: S.pendingNote, no_print: noPrint,
      items: S.pending.map((p) => ({ product_id: p.product_id, qty: p.qty, free: p.free, note: p.note, name: p.name, price: p.price })),
    });
    S.cur.orderId = r.order.id;
    S.order = r.order;
    if (!noPrint && r.kitchen_items.length && setting('kitchen_ticket') === '1' && !r.kitchen_printed) {
      printHtml(kitchenHtml(r.order, r.kitchen_items, S.boot.me.name));
    }
    clearPending();
    toast('Kaydedildi: ' + r.order.label, 'ok', 1800);
    if (setting('go_tables_after_save') === '1') S.view = 'masa';
    await refreshState();
  } catch (e) { err(e); } finally { btn.disabled = false; }
}

async function cancelPending() {
  if (S.pending.length && !(await confirmBox('Kaydedilmemiş ürünler silinsin mi?'))) return;
  clearPending();
  if (!S.order && S.cur && !S.cur.tableId) S.cur = null;
  S.view = 'masa';
  renderAll();
}

async function editPendingNote(i) {
  const p = S.pending[i];
  const n = await textPrompt(p.name + ' - Not', { value: p.note, presets: listSetting('quick_notes'), multi: true });
  if (n === undefined) return;
  p.note = n;
  renderPending();
}

// ---------------- adisyon işlemleri ----------------
async function chooseCustomer() {
  const c = await customerPicker();
  if (!c) return;
  if (!S.cur) { startNew('paket', { customerId: c.id, customerName: c.name }); return; }
  S.cur.customerId = c.id; S.cur.customerName = c.name;
  if (S.order) { try { S.order = await api(`/api/orders/${S.order.id}/update`, { customer_id: c.id }); } catch (e) { err(e); } }
  renderAll();
}

async function customerPicker() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="row"><input class="inp" style="flex:1" placeholder="Ad / telefon ara" id="cpQ"><button class="btn btn-green" id="cpNew">+ Yeni</button></div>
    <div id="cpList" style="margin-top:10px;max-height:50vh;overflow:auto"></div>`;
  let resolveFn;
  const search = async () => {
    const list = await api('/api/customers?q=' + encodeURIComponent($('#cpQ', body).value));
    $('#cpList', body).innerHTML = `<table class="tbl"><tr><th>Ad</th><th>Telefon</th><th>Adres</th><th class="r">Bakiye</th></tr>${list.map((c) =>
      `<tr class="click" data-cid="${c.id}"><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.address)}</td><td class="r">${money(c.balance)}</td></tr>`).join('')}</table>`;
    $('#cpList', body).onclick = (e) => { const tr = e.target.closest('[data-cid]'); if (tr) resolveFn(list.find((c) => c.id === Number(tr.dataset.cid))); };
  };
  return modal({
    title: 'Müşteri Seç', body, cls: 'modal-lg',
    onOpen: (w, close) => {
      resolveFn = close;
      $('#cpQ', body).addEventListener('input', () => search().catch(err));
      $('#cpNew', body).onclick = async () => { const c = await customerForm({}); if (c) close(c); };
      $('#cpQ', body).focus();
      search().catch(err);
    },
  });
}

export async function customerForm(c = {}) {
  const body = document.createElement('div');
  body.innerHTML = `<div class="form">
    <label>Ad Soyad</label><input class="inp" name="name" value="${esc(c.name || '')}">
    <label>Telefon</label><input class="inp" name="phone" inputmode="tel" value="${esc(c.phone || '')}">
    <label>Adres</label><textarea class="inp" name="address" rows="3">${esc(c.address || '')}</textarea>
    <label>Not</label><input class="inp" name="note" value="${esc(c.note || '')}"></div>`;
  return modal({
    title: c.id ? 'Müşteri Düzenle' : 'Yeni Müşteri', body,
    onOpen: () => $('[name=name]', body).focus(),
    buttons: [{ label: 'Vazgeç', cls: 'btn-red' }, {
      label: 'Kaydet', cls: 'btn-green', onClick: async () => {
        const d = Object.fromEntries($$('[name]', body).map((i) => [i.name, i.value]));
        try { return await api('/api/customers/save', { id: c.id, ...d }); } catch (e) { err(e); return false; }
      },
    }],
  });
}

async function setGuests(n) {
  n = Math.max(0, n);
  if (S.order) {
    try { S.order = await api(`/api/orders/${S.order.id}/update`, { guests: n }); } catch (e) { return err(e); }
  } else if (S.cur) S.cur.guests = n;
  renderInfo();
}

async function setAlarm() {
  if (!S.order) return toast('Alarm için önce sipariş kaydedin', 'warn');
  const body = document.createElement('div');
  body.innerHTML = `<div class="msg">${esc(S.order.label)} için hatırlatma süresi:</div>
    <div class="chips">${[5, 10, 15, 20, 30, 45, 60, 90].map((m) => `<button class="chip" data-min="${m}">${m} dk</button>`).join('')}</div>`;
  const r = await modal({
    title: 'Alarm', body,
    onOpen: (w, close) => body.addEventListener('click', (e) => { const c = e.target.closest('[data-min]'); if (c) close(Number(c.dataset.min)); }),
    buttons: [{ label: 'Alarmı Kaldır', cls: 'btn-red', value: 0 }, { label: 'Özel...', cls: 'btn-blue', onClick: async () => (await numberPrompt('Dakika', { decimals: false })) ?? false }],
  });
  if (r === undefined) return;
  try {
    S.order = await api(`/api/orders/${S.order.id}/update`, { alarm_at: r ? Date.now() + r * 60000 : null });
    toast(r ? `Alarm ${r} dk sonraya kuruldu` : 'Alarm kaldırıldı', 'ok');
    refreshState();
  } catch (e) { err(e); }
}

async function editOrderNote() {
  const cur = S.order?.note || S.pendingNote;
  const n = await textPrompt('Adisyon Notu', { value: cur, presets: listSetting('quick_notes'), multi: true });
  if (n === undefined) return;
  if (S.order) { try { S.order = await api(`/api/orders/${S.order.id}/update`, { note: n }); } catch (e) { return err(e); } }
  else S.pendingNote = n;
  renderAll();
}

async function printOrder(kind = 'adisyon', o = S.order) {
  if (!o) return;
  try {
    const r = await api('/api/print', { order_id: o.id, kind });
    if (!r.printed) printHtml(receiptHtml(r.order || o, S.boot.settings, kind));
    else toast('Yazıcıya gönderildi', 'ok', 1500);
  } catch (e) { err(e); }
}

async function editItem() {
  const ids = [...S.detailSel];
  if (ids.length !== 1) return toast('Düzenlemek için adisyondan bir satır seçin', 'warn');
  const it = S.order.items.find((i) => i.id === ids[0]);
  if (!it || it.status !== 'active') return;
  const body = document.createElement('div');
  body.innerHTML = `<div class="form">
    <label>Ürün</label><b>${esc(it.name)}</b>
    <label>Adet</label><input class="inp" name="qty" inputmode="decimal" value="${qty(it.qty)}">
    <label>Birim Fiyat</label><input class="inp" name="unit_price" inputmode="decimal" value="${String(it.unit_price).replace('.', ',')}" ${canCash() ? '' : 'disabled'}>
    <label>İkram (Bedelsiz)</label><input type="checkbox" class="chk" name="free" ${it.free ? 'checked' : ''} ${canCash() ? '' : 'disabled'}>
    <label>Not</label><input class="inp" name="note" value="${esc(it.note || '')}"></div>
    <div class="chips" style="margin-top:10px">${listSetting('quick_notes').map((n) => `<button class="chip">${esc(n)}</button>`).join('')}</div>`;
  body.addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { const n = $('[name=note]', body); n.value = n.value ? n.value + ', ' + c.textContent : c.textContent; } });
  const num = (s) => Number(String(s).replace(',', '.'));
  await modal({
    title: 'Satır Düzenle', body,
    buttons: [{ label: 'Vazgeç', cls: 'btn-red' }, {
      label: 'Kaydet', cls: 'btn-green', onClick: async () => {
        try {
          const d = { qty: num($('[name=qty]', body).value), note: $('[name=note]', body).value };
          if (canCash()) { d.unit_price = num($('[name=unit_price]', body).value); d.free = $('[name=free]', body).checked; }
          S.order = await api(`/api/items/${it.id}/edit`, d);
          renderAll(); return true;
        } catch (e) { err(e); return false; }
      },
    }],
  });
}

async function moveOrder() {
  if (!S.order) return;
  const items = [...S.detailSel];
  const body = document.createElement('div');
  const busy = new Set(S.orders.filter((o) => o.type === 'masa').map((o) => o.table_id));
  body.innerHTML = `<div class="msg">${items.length ? `<b>${items.length} seçili satır</b> taşınacak.` : 'Adisyonun <b>tamamı</b> taşınacak.'}
    Dolu masa seçilirse adisyonlar birleştirilir.</div>` + S.boot.sections.map((s) => `<div class="section-title">${esc(s.name)}</div>
    <div class="picker">${S.boot.tables.filter((t) => t.section_id === s.id).map((t) =>
      `<button data-t="${t.id}" class="${busy.has(t.id) ? 'busy' : ''} ${S.cur?.tableId === t.id ? 'cur' : ''}">${esc(t.name)}</button>`).join('')}</div>`).join('');
  const target = await modal({
    title: 'Taşı / Birleştir', body, cls: 'modal-lg',
    onOpen: (w, close) => body.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) close(Number(b.dataset.t)); }),
  });
  if (!target || target === S.cur?.tableId) return;
  try {
    await api(`/api/orders/${S.order.id}/move`, { target_table_id: target, item_ids: items });
    toast('Taşındı', 'ok');
    S.cur = { tableId: target, orderId: null, type: 'masa' };
    S.detailSel.clear();
    S.view = 'masa'; S.leftMode = 'section'; S.sectionId = tableById(target)?.section_id ?? S.sectionId;
    await refreshState();
  } catch (e) { err(e); }
}

async function discount() {
  if (!S.order) return;
  const body = document.createElement('div');
  let type = S.order.discount_type || 'percent';
  body.innerHTML = `<div class="msg">Ara toplam: <b>${money(S.order.subtotal)} TL</b></div>
    <div class="chips"><button class="chip" data-type="percent">Yüzde (%)</button><button class="chip" data-type="amount">Tutar (TL)</button></div>
    <div class="chips">${[5, 10, 15, 20, 25, 50].map((p) => `<button class="chip" data-quick="${p}">%${p}</button>`).join('')}</div>`;
  const pad = numpad({ value: S.order.discount_value || '' });
  body.appendChild(pad);
  const markType = () => $$('[data-type]', body).forEach((c) => c.classList.toggle('active', c.dataset.type === type));
  markType();
  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-type]'); if (t) { type = t.dataset.type; markType(); }
    const qk = e.target.closest('[data-quick]'); if (qk) { type = 'percent'; markType(); pad.set(qk.dataset.quick); }
  });
  const r = await modal({
    title: 'İndirim', body, cls: 'modal-sm',
    buttons: [{ label: 'Kaldır', cls: 'btn-red', value: { type: '', value: 0 } }, { label: 'Uygula', cls: 'btn-green', onClick: () => ({ type, value: pad.get() }) }],
  });
  if (!r) return;
  try { S.order = await api(`/api/orders/${S.order.id}/update`, { discount_type: r.type, discount_value: r.value }); refreshState(); } catch (e) { err(e); }
}

async function voidAction() {
  if (!S.order) return;
  const ids = [...S.detailSel].filter((id) => S.order.items.find((i) => i.id === id && i.status === 'active'));
  const what = ids.length ? `${ids.length} satır iptal edilecek` : `${S.order.label} adisyonunun TAMAMI iptal edilecek`;
  const reason = await textPrompt('İptal Nedeni — ' + what, { presets: listSetting('cancel_reasons'), placeholder: 'İptal nedeni' });
  if (reason === undefined) return;
  try {
    if (ids.length === 1) {
      const it = S.order.items.find((i) => i.id === ids[0]);
      let q = it.qty;
      if (it.qty > 1) {
        const v = await numberPrompt(`Kaç adet iptal edilsin? (en fazla ${qty(it.qty)})`, { value: qty(it.qty) });
        if (v === undefined) return;
        q = Math.min(v, it.qty);
      }
      await api('/api/items/cancel', { ids, reason, qty: q });
    } else if (ids.length) await api('/api/items/cancel', { ids, reason });
    else await api(`/api/orders/${S.order.id}/cancel`, { reason });
    S.detailSel.clear();
    toast('İptal edildi', 'ok');
    await refreshState();
  } catch (e) { err(e); }
}

// ---------------- ödeme ----------------
async function payment() {
  if (!S.order) return;
  let o = S.order;
  const body = document.createElement('div');
  body.className = 'pay';
  let given = 0;
  const pad = numpad({ value: '', onChange: () => {} });
  body.innerHTML = `<div><div class="pay-sum" id="paySum"></div>
      <div class="row" style="margin-top:8px"><button class="btn btn-sm" id="payAll">Tamamı</button><button class="btn btn-sm" id="payPerson">Kişi Başı</button>
      <button class="btn btn-sm" id="paySplit">Böl (n)</button></div>
      <div class="pay-items" id="payItems"></div></div>
    <div><div id="padHost"></div><div class="pay-quick">${[20, 50, 100, 200, 500, 1000].map((v) => `<button data-cash="${v}">${v} ₺</button>`).join('')}</div>
      <div id="payChange"></div></div>
    <div class="pay-methods">
      <button class="btn btn-green" data-method="nakit">💵 Nakit</button>
      <button class="btn btn-blue" data-method="kart">💳 Kredi Kartı</button>
      <button class="btn btn-purple" data-method="yemek">🍽 Yemek Kartı</button>
      <button class="btn btn-orange" data-method="cari">📒 Cari / Veresiye</button>
      <label class="row" style="margin-top:6px"><input type="checkbox" id="payPrint" ${setting('print_receipt_after_payment') === '1' ? 'checked' : ''}> Kapanınca fiş yazdır</label>
      <button class="btn" id="payPrintNow">🖨 Hesap Fişi</button>
      <div class="pay-list" id="payList"></div>
    </div>`;
  $('#padHost', body).appendChild(pad);
  const renderSum = () => {
    $('#paySum', body).innerHTML = `<span>Ara Toplam</span><b class="r">${money(o.subtotal)}</b>
      ${o.discount ? `<span>İndirim</span><b class="r">-${money(o.discount)}</b>` : ''}
      <span>Toplam</span><b class="r">${money(o.total)}</b><span>Ödenen</span><b class="r ok">${money(o.paid)}</b>
      <span>KALAN</span><span class="r big">${money(o.remaining)}</span>`;
    $('#payItems', body).innerHTML = o.items.filter((i) => i.status === 'active' && !i.free).map((i) =>
      `<label><input type="checkbox" data-amt="${i.qty * i.unit_price}"><span>${qty(i.qty)} x ${esc(i.name)}</span><b>${money(i.qty * i.unit_price)}</b></label>`).join('');
    $('#payList', body).innerHTML = o.payments.filter((p) => !p.cancelled).map((p) => `${METHODS[p.method]}: <b>${money(p.amount)}</b> (${hm(p.created_at)})`).join('<br>');
    pad.set(o.remaining > 0 ? String(o.remaining) : '');
  };
  renderSum();
  body.addEventListener('change', (e) => {
    if (!e.target.dataset.amt) return;
    const sum = $$('[data-amt]', body).filter((c) => c.checked).reduce((s, c) => s + Number(c.dataset.amt), 0);
    pad.set(sum ? String(Math.round(Math.min(sum, o.remaining) * 100) / 100) : String(o.remaining));
  });
  $('#payAll', body).onclick = () => pad.set(String(o.remaining));
  $('#payPerson', body).onclick = () => {
    const n = o.guests || 1;
    pad.set(String(Math.ceil((o.remaining / n) * 100) / 100));
    toast(`${n} kişiye bölündü`, 'info', 1500);
  };
  $('#paySplit', body).onclick = async () => {
    const n = await numberPrompt('Kaç parçaya bölünsün?', { decimals: false, value: o.guests || 2 });
    if (n > 0) pad.set(String(Math.ceil((o.remaining / n) * 100) / 100));
  };
  $('#payPrintNow', body).onclick = () => printOrder('receipt', o);
  body.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cash]');
    if (c) { given = Number(c.dataset.cash); pad.set(String(given)); }
  });
  const onKey = (e) => { if (e.key === 'Enter') body.querySelector('[data-method=nakit]').click(); else pad.keyHandler(e); };
  document.addEventListener('keydown', onKey);

  await modal({
    title: `Ödeme — ${o.label}`, body, cls: '',
    onOpen: (w, close) => {
      body.querySelector('.pay-methods').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-method]'); if (!b) return;
        const method = b.dataset.method;
        let amount = pad.get();
        if (o.remaining <= 0.009) {
          try { await api(`/api/orders/${o.id}/close-zero`, {}); close(true); } catch (er) { err(er); }
          return;
        }
        if (!(amount > 0)) return toast('Tutar girin', 'warn');
        let change = 0;
        if (amount > o.remaining + 0.009) {
          if (method !== 'nakit') return toast('Kart/cari ödemesi kalan tutardan büyük olamaz', 'warn');
          change = Math.round((amount - o.remaining) * 100) / 100;
          amount = o.remaining;
        }
        let customer_id;
        if (method === 'cari' && !o.customer_id) {
          const c = await customerPicker();
          if (!c) return;
          customer_id = c.id;
        }
        b.disabled = true;
        try {
          const r = await api(`/api/orders/${o.id}/pay`, { method, amount, customer_id });
          o = r.order;
          if (change > 0) $('#payChange', body).innerHTML = `<div class="pay-change">PARA ÜSTÜ: ${money(change)} TL</div>`;
          if (r.closed) {
            toast(`Adisyon kapandı${change > 0 ? ' — Para üstü: ' + money(change) + ' TL' : ''}`, 'ok', 5000);
            if ($('#payPrint', body).checked) printOrder('receipt', o);
            close(true);
          } else renderSum();
        } catch (er) { err(er); } finally { b.disabled = false; }
      });
    },
  });
  document.removeEventListener('keydown', onKey);
  S.detailSel.clear();
  await refreshState();
}

// ---------------- SAAT: açık adisyon özeti ----------------
function timeOverview() {
  const now = Date.now();
  const list = [...S.orders].sort((a, b) => a.opened_at - b.opened_at);
  modal({
    title: `Açık Adisyonlar (${list.length}) — Toplam ${money(list.reduce((s, o) => s + o.remaining, 0))} TL`, cls: 'modal-lg',
    body: `<table class="tbl"><tr><th>Adisyon</th><th>Açılış</th><th>Süre</th><th>Son Sipariş</th><th>Garson</th><th>Kişi</th><th class="r">Kalan</th></tr>
      ${list.map((o) => `<tr class="click" data-o="${o.id}"><td>${esc(labelOf(o))}</td><td>${hm(o.opened_at)}</td><td>${duration(now - o.opened_at)}</td>
        <td>${duration(now - o.last_order_at)} önce</td><td>${esc(o.user_name || '')}</td><td>${o.guests || ''}</td><td class="r">${money(o.remaining)}</td></tr>`).join('')}</table>`,
    onOpen: (w, close) => w.addEventListener('click', (e) => {
      const tr = e.target.closest('[data-o]'); if (!tr) return;
      const o = S.orders.find((x) => x.id === Number(tr.dataset.o));
      close();
      if (o.type === 'masa') { S.leftMode = 'section'; S.sectionId = tableById(o.table_id)?.section_id; selectTable(o.table_id); } else { S.leftMode = o.type; S.view = 'masa'; selectOrder(o); }
    }),
  });
}

function find() {
  const q = $('#findInput').value.trim().toLocaleLowerCase('tr');
  if (!q) return;
  const t = S.boot.tables.find((x) => x.name.toLocaleLowerCase('tr') === q) || S.boot.tables.find((x) => x.name.toLocaleLowerCase('tr').includes(q));
  if (t) { S.leftMode = 'section'; S.sectionId = t.section_id; S.view = 'masa'; selectTable(t.id); return; }
  const o = S.orders.find((x) => [x.customer_name, x.customer_phone, x.name].some((v) => (v || '').toLocaleLowerCase('tr').includes(q)));
  if (o) { S.leftMode = o.type === 'masa' ? 'section' : o.type; S.view = 'masa'; o.type === 'masa' ? selectTable(o.table_id) : selectOrder(o); return; }
  toast('Bulunamadı', 'warn');
}

// ---------------- olay bağlama ----------------
function bindUi() {
  $$('.tab').forEach((b) => b.onclick = () => {
    if (b.dataset.view === 'satis' && !S.cur) { toast('Önce masa seçin', 'warn'); return; }
    S.view = b.dataset.view; renderAll();
  });
  $('#leftList').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cat) { S.categoryId = Number(b.dataset.cat); renderLeft(); renderGrid(); return; }
    if (b.dataset.section) { S.leftMode = 'section'; S.sectionId = Number(b.dataset.section); }
    if (b.dataset.mode) S.leftMode = b.dataset.mode;
    renderLeft(); renderGrid();
  };
  $('#grid').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-delivery]');
    if (d) {
      e.stopPropagation();
      try { await api(`/api/orders/${d.dataset.delivery}/update`, { delivery_status: d.dataset.next }); } catch (er) { err(er); }
      return;
    }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.table) selectTable(Number(b.dataset.table));
    else if (b.dataset.product) addProduct(Number(b.dataset.product), b);
    else if (b.dataset.order) selectOrder(S.orders.find((o) => o.id === Number(b.dataset.order)));
    else if (b.dataset.new === 'paket') { const c = await customerPicker(); if (c) startNew('paket', { customerId: c.id, customerName: c.name }); }
    else if (b.dataset.new === 'bekleyen') { const n = await textPrompt('Adisyon adı', { placeholder: 'Örn: Ahmet Bey, Ayakta 1' }); if (n !== undefined) startNew('bekleyen', { name: n }); }
  });
  $('#grid').addEventListener('dblclick', (e) => {
    const b = e.target.closest('[data-order]');
    if (b) { S.view = 'satis'; renderAll(); }
  });
  $('#mults').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.mult = Number(b.dataset.m); renderPending(); } };
  $('#pendingRows').onclick = (e) => { const r = e.target.closest('[data-p]'); if (r) { S.pendingSel = Number(r.dataset.p); renderPending(); } };
  $('#pendingRows').ondblclick = (e) => { const r = e.target.closest('[data-p]'); if (r) editPendingNote(Number(r.dataset.p)); };
  $('#clearBtn').onclick = async () => { if (S.pending.length && await confirmBox('Tüm eklenen ürünler silinsin mi?')) { S.pending = []; S.pendingSel = -1; renderPending(); } };
  $('#minusBtn').onclick = () => {
    const p = S.pending[S.pendingSel]; if (!p) return;
    p.qty = Math.round((p.qty - 1) * 100) / 100;
    if (p.qty <= 0) { S.pending.splice(S.pendingSel, 1); S.pendingSel = Math.min(S.pendingSel, S.pending.length - 1); }
    renderPending();
  };
  $('#delBtn').onclick = () => { if (S.pendingSel < 0) return; S.pending.splice(S.pendingSel, 1); S.pendingSel = Math.min(S.pendingSel, S.pending.length - 1); renderPending(); };
  $('#upBtn').onclick = () => { if (S.pending.length) { S.pendingSel = Math.max(0, S.pendingSel - 1); renderPending(); } };
  $('#downBtn').onclick = () => { if (S.pending.length) { S.pendingSel = Math.min(S.pending.length - 1, S.pendingSel + 1); renderPending(); } };
  $('#guestsBtn').onclick = async () => {
    if (!S.cur) return toast('Önce masa seçin', 'warn');
    const n = await numberPrompt('Kişi Sayısı', { decimals: false, value: S.order?.guests ?? S.cur.guests ?? '' });
    if (n !== undefined) setGuests(n);
  };
  $('#guestPlus').onclick = () => S.cur && setGuests((S.order?.guests ?? S.cur.guests ?? 0) + 1);
  $('#guestMinus').onclick = () => S.cur && setGuests((S.order?.guests ?? S.cur.guests ?? 0) - 1);
  $('#lockBtn').onclick = async () => {
    await logout();
    $('#app').hidden = true;
    const u = await loginScreen(setting('restaurant_name'));
    S.boot.me = u;
    $('#app').hidden = false;
    connectEventsOnce();
    renderAll();
  };
  $('#timeBtn').onclick = timeOverview;
  $('#alarmBtn').onclick = setAlarm;
  $('#customerBtn').onclick = chooseCustomer;
  $('#noteBtn').onclick = () => { if (!S.cur) return toast('Önce masa seçin', 'warn'); editOrderNote(); };
  $('#saveBtn').onclick = save;
  $('#cancelBtn').onclick = cancelPending;
  $('#detailsRows').onclick = (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      const it = S.order.items.find((i) => i.id === Number(c.dataset.copy));
      if (it && productById(it.product_id)) {
        S.pending.push({ product_id: it.product_id, name: it.name, price: it.unit_price, qty: it.qty, free: !!it.free, note: it.note });
        S.pendingSel = S.pending.length - 1; S.view = 'satis'; renderAll();
      }
      return;
    }
    const tr = e.target.closest('[data-item]'); if (!tr) return;
    const id = Number(tr.dataset.item);
    S.detailSel.has(id) ? S.detailSel.delete(id) : S.detailSel.add(id);
    renderDetails();
  };
  $('#servedBtn').onclick = async () => {
    const ids = S.order.items.filter((i) => i.kitchen_status === 'ready').map((i) => i.id);
    try { await api('/api/kitchen/status', { ids, status: 'served' }); } catch (e) { err(e); }
  };
  $('#payBtn').onclick = payment;
  $('#printBtn').onclick = () => printOrder('adisyon');
  $('#editBtn').onclick = editItem;
  $('#moveBtn').onclick = moveOrder;
  $('#discountBtn').onclick = discount;
  $('#voidBtn').onclick = voidAction;
  $('#findBtn').onclick = find;
  $('#findInput').onkeydown = (e) => { if (e.key === 'Enter') find(); };
  $('#drawerBtn').onclick = async () => {
    try { const r = await api('/api/drawer', {}); toast(r.opened ? 'Çekmece açıldı' : 'Çekmece için ayarlardan ağ fiş yazıcısı tanımlayın', r.opened ? 'ok' : 'warn'); } catch (e) { err(e); }
  };
  $('#optionsBtn').onclick = () => {
    if (!isAdmin() && S.boot.me.role !== 'kasiyer') return toast('Seçenekler için yetkiniz yok', 'warn');
    openOptions({ boot: S.boot, reload: reloadBoot, customerForm });
  };
  // klavye kısayolları (barkod okuyucu / klavye kullanan kasalar için)
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal-wrap, .login') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === 'F2') { e.preventDefault(); S.view = 'masa'; renderAll(); }
    else if (e.key === 'F3' && S.cur) { e.preventDefault(); S.view = 'satis'; renderAll(); }
    else if (e.key === 'F9') { e.preventDefault(); save(); }
    else if (e.key === 'F10' && S.order && canCash()) { e.preventDefault(); payment(); }
    else if (e.key === 'Escape') cancelPending();
    else if (e.key === 'Delete') $('#delBtn').click();
    else if (e.key === 'ArrowUp') $('#upBtn').click();
    else if (e.key === 'ArrowDown') $('#downBtn').click();
  });
}

let eventsConnected = true;
function connectEventsOnce() { if (!eventsConnected) { connectEvents(onEvent); eventsConnected = true; } }

start().catch(err);
