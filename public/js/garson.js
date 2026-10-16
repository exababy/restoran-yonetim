// Garson el terminali (telefon / tablet)
import { $, esc, money, qty, duration, api, ensureSession, connectEvents, toast, textPrompt, numberPrompt, confirmBox, logout, beep, applyTheme } from './common.js';

const S = { boot: null, orders: [], screen: 'tables', sectionId: null, categoryId: null, table: null, order: null, cart: [] };
const err = (e) => toast(e.message || String(e), 'error', 4000);
const quickNotes = () => (S.boot.settings.quick_notes || '').split(',').map((s) => s.trim()).filter(Boolean);

async function start() {
  S.boot = await ensureSession('Garson Terminali');
  applyTheme(S.boot.settings.theme);
  S.sectionId = S.boot.sections[0]?.id;
  S.categoryId = S.boot.categories[0]?.id;
  $('#m').hidden = false;
  $('#mUser').textContent = S.boot.me.name + ' ⏻';
  $('#mUser').onclick = async () => { if (await confirmBox('Çıkış yapılsın mı?')) { await logout(); location.reload(); } };
  $('#mBack').onclick = back;
  connectEvents((ev) => {
    if (ev.type === 'changed') refresh();
    if (ev.type === 'config') api('/api/bootstrap').then((b) => { S.boot = b; render(); });
    if (ev.type === 'kitchen_ready') { toast('🔔 Hazır: ' + ev.label, 'ok', 6000); beep(2, 1100); navigator.vibrate?.([200, 100, 200]); }
  }, (ok) => $('#conn').classList.toggle('off', !ok));
  await refresh();
  history.replaceState({ s: 'tables' }, '');
  window.addEventListener('popstate', () => { if (S.screen !== 'tables') { S.screen = 'tables'; S.cart = []; render(); } });
}

async function refresh() {
  try {
    S.orders = (await api('/api/state')).orders;
    if (S.table) {
      const o = S.orders.find((x) => x.type === 'masa' && x.table_id === S.table.id);
      S.order = o ? await api('/api/orders/' + o.id) : null;
    }
    render();
  } catch (e) { err(e); }
}

function back() {
  if (S.cart.length && !confirm('Gönderilmemiş ürünler silinsin mi?')) return;
  S.screen = 'tables'; S.cart = []; S.table = null; S.order = null;
  render();
}

function render() {
  const main = $('#mMain');
  $('#mBack').hidden = S.screen === 'tables';
  if (S.screen === 'tables') {
    $('#mTitle').textContent = S.boot.settings.restaurant_name;
    $('#mFoot').hidden = true;
    const now = Date.now();
    main.innerHTML = `<div class="m-tabs">${S.boot.sections.map((s) => `<button data-sec="${s.id}" class="${s.id === S.sectionId ? 'active' : ''}">${esc(s.name)}</button>`).join('')}</div>
      <div class="m-tables">${S.boot.tables.filter((t) => t.section_id === S.sectionId).map((t) => {
        const o = S.orders.find((x) => x.type === 'masa' && x.table_id === t.id);
        return `<button data-t="${t.id}" class="${o ? 'busy' : ''}">${esc(t.name)}${o ? `<small>${money(o.remaining)} ₺ · ${duration(now - o.opened_at)}${o.k_ready ? ' 🔔' : ''}</small>` : ''}</button>`;
      }).join('')}</div>`;
    main.onclick = (e) => {
      const s = e.target.closest('[data-sec]'); if (s) { S.sectionId = Number(s.dataset.sec); render(); return; }
      const t = e.target.closest('[data-t]');
      if (t) { S.table = S.boot.tables.find((x) => x.id === Number(t.dataset.t)); S.screen = 'order'; S.cart = []; history.pushState({ s: 'order' }, ''); refresh(); }
    };
    return;
  }
  if (S.screen === 'order') renderOrder(main);
  if (S.screen === 'cart') renderCart(main);
}

function renderOrder(main) {
  const sec = S.boot.sections.find((s) => s.id === S.table.section_id);
  $('#mTitle').textContent = `${sec?.name || ''} - Masa ${S.table.name}`;
  const o = S.order;
  const counts = {};
  for (const c of S.cart) counts[c.product_id] = (counts[c.product_id] || 0) + c.qty;
  main.innerHTML = `${o ? `<details class="m-existing"><summary>Adisyon: ${money(o.remaining)} TL · ${o.guests || 0} kişi (${o.items.filter((i) => i.status === 'active').length} satır)</summary>
      ${o.items.filter((i) => i.status === 'active').map((i) => `<div>${qty(i.qty)} x ${esc(i.name)} ${i.kitchen_status === 'ready' ? '🔔' : i.kitchen_status === 'new' || i.kitchen_status === 'preparing' ? '🍳' : ''}<span style="float:right">${money(i.qty * i.unit_price)}</span></div>`).join('')}
      <div class="row" style="margin-top:8px"><button class="btn btn-sm" id="gGuests">👥 Kişi sayısı</button><button class="btn btn-sm btn-yellow" id="gBill">🧾 Hesap fişi</button></div></details>` : ''}
    <div class="m-tabs">${S.boot.categories.map((c) => `<button data-cat="${c.id}" class="${c.id === S.categoryId ? 'active' : ''}">${esc(c.name)}</button>`).join('')}</div>
    <div class="m-prods">${S.boot.products.filter((p) => p.category_id === S.categoryId).map((p) =>
      `<button data-p="${p.id}"><b>${p.ask_price ? 'Fiyat?' : money(p.price)}</b>${esc(p.name)}${counts[p.id] ? `<span class="cnt">${qty(counts[p.id])}</span>` : ''}</button>`).join('')}</div>`;
  main.onclick = async (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { S.categoryId = Number(c.dataset.cat); render(); return; }
    const p = e.target.closest('[data-p]');
    if (p) {
      const prod = S.boot.products.find((x) => x.id === Number(p.dataset.p));
      let price = prod.price;
      if (prod.ask_price) { const v = await numberPrompt(prod.name + ' fiyatı'); if (!v) return; price = v; }
      const ex = S.cart.find((x) => x.product_id === prod.id && !x.note && x.price === price);
      if (ex) ex.qty++; else S.cart.push({ product_id: prod.id, name: prod.name, price, qty: 1, note: '' });
      navigator.vibrate?.(15);
      render();
      return;
    }
    if (e.target.closest('#gGuests')) {
      const n = await numberPrompt('Kişi sayısı', { decimals: false, value: o.guests || '' });
      if (n !== undefined) { await api(`/api/orders/${o.id}/update`, { guests: n }).catch(err); refresh(); }
    }
    if (e.target.closest('#gBill')) { try { const r = await api('/api/print', { order_id: o.id, kind: 'adisyon' }); toast(r.printed ? 'Hesap fişi yazdırıldı' : 'Fiş yazıcısı tanımlı değil, kasadan yazdırın', r.printed ? 'ok' : 'warn'); } catch (er) { err(er); } }
  };
  renderFoot();
}

function renderCart(main) {
  $('#mTitle').textContent = `Sepet - Masa ${S.table.name}`;
  main.innerHTML = `<div class="m-cart">${S.cart.map((c, i) => `<div class="line"><div><b>${esc(c.name)}</b><div class="note">${esc(c.note)}</div>
      <button class="btn btn-sm" data-note="${i}">📝 Not</button></div>
      <div class="qtyctl"><button data-minus="${i}">−</button><b>${qty(c.qty)}</b><button data-plus="${i}">+</button></div></div>`).join('') || '<p>Sepet boş</p>'}</div>
    ${S.cart.length ? '<div class="row" style="margin-top:12px"><button class="btn btn-orange" id="bulkNote">📝 Tüm ürünlere not ekle</button></div>' : ''}`;
  main.onclick = async (e) => {
    const t = e.target;
    const pl = t.closest('[data-plus]'); if (pl) { S.cart[pl.dataset.plus].qty++; render(); return; }
    const mi = t.closest('[data-minus]');
    if (mi) { const c = S.cart[mi.dataset.minus]; c.qty--; if (c.qty <= 0) S.cart.splice(mi.dataset.minus, 1); render(); return; }
    if (t.closest('#bulkNote')) {
      const v = await textPrompt('Tüm ürünlere eklenecek not', { presets: quickNotes(), multi: true });
      if (v) { for (const c of S.cart) c.note = c.note ? c.note + ', ' + v : v; render(); }
      return;
    }
    const n = t.closest('[data-note]');
    if (n) { const c = S.cart[n.dataset.note]; const v = await textPrompt(c.name + ' notu', { value: c.note, presets: quickNotes(), multi: true }); if (v !== undefined) { c.note = v; render(); } }
  };
  renderFoot();
}

function renderFoot() {
  const f = $('#mFoot');
  const n = S.cart.reduce((s, c) => s + c.qty, 0);
  const total = S.cart.reduce((s, c) => s + c.qty * c.price, 0);
  f.hidden = false;
  f.innerHTML = `<div class="sum"><b>${qty(n)} ürün</b><br>${money(total)} TL</div>
    ${S.screen === 'order' ? `<button class="btn btn-blue" id="fCart" ${n ? '' : 'disabled'}>Sepet</button>` : `<button class="btn" id="fMore">+ Ürün</button>`}
    <button class="btn btn-green" id="fSend" ${n ? '' : 'disabled'}>✔ Gönder</button>`;
  f.onclick = async (e) => {
    if (e.target.closest('#fCart')) { S.screen = 'cart'; render(); }
    if (e.target.closest('#fMore')) { S.screen = 'order'; render(); }
    if (e.target.closest('#fSend')) {
      const b = e.target.closest('#fSend'); b.disabled = true;
      try {
        let guests;
        if (!S.order) guests = await numberPrompt('Kaç kişi?', { decimals: false });
        await api('/api/orders/add-items', { table_id: S.table.id, order_id: S.order?.id, guests, items: S.cart.map((c) => ({ product_id: c.product_id, qty: c.qty, note: c.note, price: c.price })) });
        toast('Sipariş gönderildi ✔', 'ok');
        navigator.vibrate?.(60);
        S.cart = []; S.screen = 'tables'; S.table = null; S.order = null;
        await refresh();
      } catch (er) { err(er); b.disabled = false; }
    }
  };
}

start().catch(err);
