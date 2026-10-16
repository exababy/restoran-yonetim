// Ortak yardımcılar: API, oturum, gerçek zamanlı olaylar, modal, sayı tuş takımı, yazdırma
const TOKEN_KEY = 'pos_token';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

// Tema: 'classic' (orijinal görünüm, varsayılan) veya premium 'dark' | 'light'. Cihazda hatırlanır, sunucu ayarı gelince güncellenir.
export function applyTheme(t) {
  t = ['dark', 'light', 'classic'].includes(t) ? t : 'classic';
  document.body.classList.toggle('premium', t !== 'classic');
  document.body.dataset.theme = t;
  store.set('pos_theme', t);
}
if (document.body) applyTheme(store.get('pos_theme'));
else document.addEventListener('DOMContentLoaded', () => applyTheme(store.get('pos_theme')));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => nf.format(Math.round((Number(n) || 0) * 100) / 100);
// Kısa para gösterimi: 2.090 ₺ / 462,50 ₺ (dar kutular için)
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
export const moneyShort = (n, unit = true) => { const v = Math.round((Number(n) || 0) * 100) / 100; return (Number.isInteger(v) ? nf0.format(v) : money(v)) + (unit ? ' ₺' : ''); };
export const qty = (n) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));
export const pad2 = (n) => String(n).padStart(2, '0');
export const dateTime = (ms) => {
  if (!ms) return '00.00.0000 - 00:00';
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} - ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
export const hm = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
export const duration = (ms) => {
  if (!ms || ms < 0) return '00:00';
  const m = Math.floor(ms / 60000);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};
export const parseNum = (s) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
export const METHODS = { nakit: 'Nakit', kart: 'Kredi Kartı', yemek: 'Yemek Kartı', cari: 'Cari (Veresiye)' };
export const ROLES = { admin: 'Yönetici', kasiyer: 'Kasiyer', garson: 'Garson' };

export let token = store.get(TOKEN_KEY);
let onUnauthorized = () => location.reload();

export async function api(path, body, method) {
  const opts = { method: method || (body !== undefined ? 'POST' : 'GET'), headers: { 'X-Token': token || '' } };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); } catch { throw new Error('Sunucuya bağlanılamadı'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith('/login')) { store.set(TOKEN_KEY, null); token = null; onUnauthorized(); }
  if (!res.ok) throw new Error(data.error || 'Hata: ' + res.status);
  return data;
}

export async function logout() {
  try { await api('/api/logout', {}); } catch {}
  store.set(TOKEN_KEY, null); token = null;
}

// PIN giriş ekranı. Başarılı olunca kullanıcıyı döndürür.
export function loginScreen(title = 'Restoran POS') {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'login';
    el.innerHTML = `<div class="login-box">
      <div class="login-title">${esc(title)}</div>
      <div class="login-sub">Kullanıcı şifrenizi girin</div>
      <div class="login-pin"></div>
      <div class="login-err"></div>
      <div class="numpad login-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⌫'].map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>
      <button class="btn btn-green login-ok">GİRİŞ</button>
    </div>`;
    document.body.appendChild(el);
    api('/api/info').then((i) => { if (i.name) $('.login-title', el).textContent = i.name; applyTheme(i.theme); }).catch(() => {});
    let pin = '';
    const show = () => { $('.login-pin', el).textContent = '●'.repeat(pin.length) || ' '; };
    const submit = async () => {
      try {
        const r = await api('/api/login', { pin });
        token = r.token; store.set(TOKEN_KEY, token);
        el.remove(); document.removeEventListener('keydown', onKey);
        resolve(r.user);
      } catch (e) { $('.login-err', el).textContent = e.message; pin = ''; show(); }
    };
    const press = (k) => {
      $('.login-err', el).textContent = '';
      if (k === 'C') pin = ''; else if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 8) pin += k;
      show();
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') submit();
    };
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('login-ok')) submit(); else press(b.dataset.k);
    });
    show();
  });
}

// Oturum aç veya mevcut token ile devam et; bootstrap verisini döndürür
export async function ensureSession(title) {
  onUnauthorized = () => location.reload();
  if (token) { try { return await api('/api/bootstrap'); } catch {} }
  await loginScreen(title);
  return api('/api/bootstrap');
}

// Sunucu olayları (SSE). Bağlantı koparsa tarayıcı otomatik yeniden bağlanır.
export function connectEvents(handler, onStatus) {
  let es;
  const open = () => {
    es = new EventSource('/api/events?token=' + encodeURIComponent(token));
    es.onopen = () => onStatus?.(true);
    es.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    es.onerror = () => { onStatus?.(false); if (es.readyState === 2) setTimeout(open, 3000); };
  };
  open();
}

// ---------- bildirim ----------
export function toast(msg, type = 'info', ms = 3000) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

let audioCtx;
export function beep(times = 1, freq = 880) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.3;
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.26);
    }
  } catch {}
}

// ---------- modal ----------
// buttons: [{label, cls, value, onClick(close) }]. Sonuç değeri promise ile döner.
export function modal({ title, body, buttons = [], cls = '', onOpen, closable = true }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${cls}">
      <div class="modal-head"><span>${esc(title)}</span>${closable ? '<button class="modal-x">✕</button>' : ''}</div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div></div>`;
    const bodyEl = $('.modal-body', wrap);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && closable) close(undefined); };
    document.addEventListener('keydown', onKey);
    const foot = $('.modal-foot', wrap);
    if (!buttons.length) foot.remove();
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.innerHTML = b.label;
      el.onclick = async () => {
        if (b.onClick) { const r = await b.onClick(close, wrap); if (r === false) return; if (r !== undefined) close(r); } else close(b.value);
      };
      foot.appendChild(el);
    }
    $('.modal-x', wrap)?.addEventListener('click', () => close(undefined));
    document.body.appendChild(wrap);
    onOpen?.(wrap, close);
  });
}

export const confirmBox = (msg, title = 'Onay') => modal({
  title, body: `<div class="msg">${esc(msg)}</div>`,
  buttons: [{ label: 'Vazgeç', cls: 'btn-red', value: false }, { label: 'Evet', cls: 'btn-green', value: true }],
});
export const alertBox = (msg, title = 'Bilgi') => modal({ title, body: `<div class="msg">${esc(msg)}</div>`, buttons: [{ label: 'Tamam', cls: 'btn-green', value: true }] });

// Seçenekli giriş (hızlı seçimler + serbest metin)
export function textPrompt(title, { value = '', presets = [], placeholder = '', multi = false } = {}) {
  const body = document.createElement('div');
  body.innerHTML = `<div class="chips">${presets.map((p) => `<button class="chip">${esc(p)}</button>`).join('')}</div>
    <input class="inp big" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
  const inp = $('input', body);
  body.addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    if (multi && inp.value) inp.value = inp.value + ', ' + c.textContent; else inp.value = c.textContent;
    inp.focus();
  });
  return modal({
    title, body,
    onOpen: () => { inp.focus(); inp.select(); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.modal-foot .btn-green')?.click(); }); },
    buttons: [{ label: 'Vazgeç', cls: 'btn-red', value: undefined }, { label: 'Tamam', cls: 'btn-green', onClick: () => inp.value.trim() }],
  });
}

// Sayı tuş takımı bileşeni
export function numpad({ value = '', decimals = true, onChange } = {}) {
  const el = document.createElement('div');
  el.className = 'numpad-wrap';
  el.innerHTML = `<div class="numpad-display"></div><div class="numpad">${
    [7, 8, 9, 4, 5, 6, 1, 2, 3, decimals ? ',' : 'C', 0, '⌫'].map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>`;
  let v = String(value).replace('.', ',');
  let fresh = true;
  const show = () => { $('.numpad-display', el).textContent = v || '0'; onChange?.(parseNum(v), v); };
  const press = (k) => {
    if (fresh && k !== '⌫') { v = ''; fresh = false; }
    if (k === 'C') v = '';
    else if (k === '⌫') { v = v.slice(0, -1); fresh = false; }
    else if (k === ',') { if (!v.includes(',')) v = (v || '0') + ','; }
    else if (v.length < 10) {
      if (v.includes(',') && v.split(',')[1].length >= 2) return;
      v = v === '0' ? String(k) : v + k;
    }
    show();
  };
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) press(b.dataset.k); });
  el.press = press;
  el.set = (nv) => { v = String(nv).replace('.', ','); fresh = true; show(); };
  el.get = () => parseNum(v);
  el.keyHandler = (e) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === ',' || e.key === '.') decimals && press(',');
    else if (e.key === 'Backspace') press('⌫');
    else return false;
    return true;
  };
  show();
  return el;
}

export function numberPrompt(title, { value = '', decimals = true, info = '' } = {}) {
  const body = document.createElement('div');
  if (info) body.innerHTML = `<div class="msg">${esc(info)}</div>`;
  const pad = numpad({ value, decimals });
  body.appendChild(pad);
  const onKey = (e) => { if (e.key === 'Enter') { $('.modal-foot .btn-green')?.click(); } else pad.keyHandler(e); };
  document.addEventListener('keydown', onKey);
  return modal({
    title, body, cls: 'modal-sm',
    buttons: [{ label: 'Vazgeç', cls: 'btn-red', value: undefined }, { label: 'Tamam', cls: 'btn-green', onClick: () => pad.get() }],
  }).finally(() => document.removeEventListener('keydown', onKey));
}

// ---------- tarayıcıdan yazdırma (80mm fiş) ----------
// Birden fazla fiş (ör. mutfak + içecek) art arda gönderilince karışmasın diye sıraya alınır
let printChain = Promise.resolve();
export function printHtml(html) {
  printChain = printChain.then(() => new Promise((done) => { printNow(html); setTimeout(done, 1500); }));
}
function printNow(html) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: 80mm auto; margin: 3mm; }
    body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0; color: #000; }
    .c { text-align: center; } .b { font-weight: bold; } .big { font-size: 18px; } .r { text-align: right; }
    table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 0; }
    hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  </style></head><body>${html}</body></html>`);
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); }, 200);
}

export const seatName = (n) => (n ? `${n}. Kişi` : 'Ortak');

export function receiptHtml(o, s, kind) {
  const lines = (list) => {
    const rows = new Map();
    for (const i of list) {
      const k = `${i.name}|${i.unit_price}|${i.free}`;
      const m = rows.get(k) || { ...i, qty: 0 };
      m.qty = Math.round((m.qty + i.qty) * 100) / 100; rows.set(k, m);
    }
    return [...rows.values()].map((i) => `<tr><td>${qty(i.qty)} x ${esc(i.name)}</td><td class="r">${i.free ? 'İKRAM' : money(i.qty * i.unit_price)}</td></tr>`).join('');
  };
  const active = o.items.filter((x) => x.status === 'active');
  const body = o.seats
    ? o.seats.filter((g) => g.count).map((g) => `<tr><td colspan="2" class="c b">--- ${seatName(g.seat).toLocaleUpperCase('tr')} ---</td></tr>
        ${lines(active.filter((i) => (i.seat || 0) === g.seat))}
        <tr class="b"><td>${seatName(g.seat)} toplam</td><td class="r">${money(g.share)}</td></tr>
        ${g.paid > 0 ? `<tr><td>&nbsp;&nbsp;${g.remaining <= 0.009 ? 'ÖDENDİ' : 'Ödenen'}</td><td class="r">${money(g.paid)}</td></tr>` : ''}`).join('')
    : lines(active);
  const pays = (o.payments || []).filter((p) => !p.cancelled);
  return `<div class="c b big">${esc(s.restaurant_name)}</div>
    ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}${s.phone ? `<div class="c">Tel: ${esc(s.phone)}</div>` : ''}
    <div class="c b">${kind === 'receipt' ? 'HESAP FİŞİ' : 'ADİSYON (Bilgi Fişidir)'}</div><hr>
    <table><tr><td>${esc(o.label)}</td><td class="r">#${o.id}</td></tr>
    <tr><td>${dateTime(Date.now())}</td><td class="r">${o.guests ? o.guests + ' kişi' : ''}</td></tr></table>
    ${o.customer_name ? `<div>Müşteri: ${esc(o.customer_name)} ${esc(o.customer_phone || '')}</div><div>${esc(o.customer_address || '')}</div>` : ''}
    <hr><table>${body}</table><hr>
    <table>${o.discount > 0 ? `<tr><td>Ara Toplam</td><td class="r">${money(o.subtotal)}</td></tr><tr><td>İndirim</td><td class="r">-${money(o.discount)}</td></tr>` : ''}
    <tr class="b big"><td>TOPLAM</td><td class="r">${money(o.total)} TL</td></tr>
    ${pays.map((p) => `<tr><td>${METHODS[p.method] || p.method}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}
    ${pays.length && o.remaining > 0.009 ? `<tr class="b"><td>KALAN</td><td class="r">${money(o.remaining)}</td></tr>` : ''}</table><hr>
    ${s.receipt_footer ? `<div class="c">${esc(s.receipt_footer)}</div>` : ''}<div class="c">Mali değeri yoktur</div>`;
}

export function kitchenHtml(o, items, userName, title = 'MUTFAK') {
  return `<div class="c b">${esc(title.toLocaleUpperCase('tr'))}</div><div class="c b big">${esc(o.label)}</div>
    <table><tr><td>${dateTime(Date.now())}</td><td class="r">${esc(userName || '')}</td></tr></table><hr>
    ${items.map((i) => `<div class="b big">${qty(i.qty)} x ${esc(i.name)}</div>${i.note ? `<div class="b">&nbsp;&nbsp;&gt;&gt; ${esc(i.note)}</div>` : ''}`).join('')}
    ${o.note ? `<hr><div class="b">NOT: ${esc(o.note)}</div>` : ''}`;
}
