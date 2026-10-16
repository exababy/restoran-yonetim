import { $, $$, esc, money, qty, dateTime, hm, api, modal, confirmBox, toast, numberPrompt, textPrompt, printHtml, METHODS, ROLES } from './common.js';

const err = (e) => toast(e.message || String(e), 'error', 4000);
const num = (s) => Number(String(s).replace(',', '.')) || 0;

const PANELS = [
  ['genel', 'Genel Ayarlar', 'admin'],
  ['yazicilar', 'Yazıcılar', 'admin'],
  ['kullanicilar', 'Kullanıcılar', 'admin'],
  ['urunler', 'Ürünler', 'admin'],
  ['musteriler', 'Müşteriler', 'kasiyer'],
  ['bolumler', 'Bölümler', 'admin'],
  ['raporlar', 'Raporlar', 'kasiyer'],
  ['terminal', 'El Terminali', 'kasiyer'],
  ['sms', 'Sms', 'admin'],
  ['gunsonu', 'Gün Sonu', 'kasiyer'],
  ['tahsilat', 'Tahsilat İptal', 'admin'],
  ['gecmis', 'İşlem Geçmişi', 'admin'],
  ['yedek', 'Yedekleme', 'admin'],
];
const LEVEL = { garson: 1, kasiyer: 2, admin: 3 };

export function openOptions(ctx) {
  const { boot } = ctx;
  const allowed = PANELS.filter((p) => LEVEL[boot.me.role] >= LEVEL[p[2]]);
  const body = document.createElement('div');
  body.className = 'opts';
  body.innerHTML = `<div class="opts-menu">${allowed.map(([k, l]) => `<button data-panel="${k}">${l}</button>`).join('')}</div>
    <div class="opts-body"><div class="opts-tab" id="optTab"></div><div class="opts-content" id="optContent"></div></div>`;
  const show = (k) => {
    $$('.opts-menu button', body).forEach((b) => b.classList.toggle('active', b.dataset.panel === k));
    $('#optTab', body).textContent = PANELS.find((p) => p[0] === k)[1];
    const c = $('#optContent', body);
    c.innerHTML = '<div class="muted">Yükleniyor...</div>';
    c.onclick = null;
    Promise.resolve(RENDER[k](c, ctx)).catch((e) => { c.innerHTML = `<div class="msg">${esc(e.message)}</div>`; });
  };
  body.querySelector('.opts-menu').onclick = (e) => { const b = e.target.closest('[data-panel]'); if (b) show(b.dataset.panel); };
  modal({ title: `${boot.settings.restaurant_name} - Seçenekler`, body, cls: 'modal-lg', onOpen: () => show(allowed[0][0]) })
    .then(() => ctx.reload());
}

// ---------- Genel Ayarlar ----------
function field(label, key, s, type = 'text', hint = '') {
  if (type === 'check') return `<label>${label}</label><input type="checkbox" class="chk" data-key="${key}" ${s[key] === '1' ? 'checked' : ''}>${hint ? `<div class="hint">${hint}</div>` : ''}`;
  return `<label>${label}</label><input class="inp" data-key="${key}" value="${esc(s[key] ?? '')}" ${type === 'ro' ? 'readonly' : ''}>${hint ? `<div class="hint">${hint}</div>` : ''}`;
}
async function collectAndSave(c) {
  const data = {};
  for (const el of $$('[data-key]', c)) data[el.dataset.key] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
  await api('/api/settings', data);
  toast('Ayarlar kaydedildi', 'ok');
}

const RENDER = {
  async genel(c, { boot }) {
    const s = (await api('/api/bootstrap')).settings;
    c.innerHTML = `<div class="form">
      ${field('Restoran Adı', 'restaurant_name', s)}
      ${field('Adres', 'address', s)}
      ${field('Telefon', 'phone', s)}
      ${field('Fiş Alt Yazısı', 'receipt_footer', s)}
      <label>Sunucu</label><input class="inp" readonly value="${esc(boot.server.host)} (localhost)">
      <label>Port</label><input class="inp" readonly value="${boot.server.port}">
      <label>Veritabanı</label><input class="inp" readonly value="${esc(boot.server.db)}">
      <h4>Ekran</h4>
      ${field('Masa sütun sayısı', 'table_cols', s)}
      ${field('Ürün sütun sayısı', 'product_cols', s)}
      ${field('Masaya basınca satışa geç', 'table_click_to_sales', s, 'check')}
      ${field('Kaydet sonrası masalara dön', 'go_tables_after_save', s, 'check')}
      ${field('Uzun bekleme uyarısı (dk)', 'long_wait_minutes', s, 'text', 'Son siparişten bu kadar dakika geçen masa sarı görünür. 0 = kapalı')}
      ${field('Hızlı notlar', 'quick_notes', s, 'text', 'Virgülle ayırın')}
      ${field('İptal nedenleri', 'cancel_reasons', s, 'text', 'Virgülle ayırın')}
      ${field('Kasa çıkış açıklamaları', 'expense_presets', s, 'text', 'Virgülle ayırın')}
      <h4>Yazıcılar</h4>
      ${field('Hesap / adisyon fiş yazıcısı (IP:port)', 'receipt_printer', s, 'text', 'Örn: 192.168.1.50:9100 — boş bırakılırsa Windows varsayılan yazıcısına tarayıcıdan yazdırılır')}
      <label></label><div><button class="btn btn-sm" data-test="receipt_printer">Test Yazdır</button></div>
      ${field('Sipariş fişlerini yazdır', 'kitchen_ticket', s, 'check', 'Mutfak / içecek / ızgara gibi sipariş yazıcıları "Yazıcılar" bölümünden tanımlanır')}
      ${field('Ödeme sonrası fiş yazdır', 'print_receipt_after_payment', s, 'check')}
      ${field('Fiş karakter genişliği', 'printer_width', s, 'text', '80mm için 42 veya 48, 58mm için 32')}
    </div><div style="text-align:right;margin-top:14px"><button class="btn btn-green" id="saveGen" style="font-size:26px;padding:6px 30px">✔</button></div>`;
    c.onclick = async (e) => {
      const t = e.target.closest('[data-test]');
      if (t) {
        const addr = $(`[data-key=${t.dataset.test}]`, c).value;
        if (!addr) return printHtml('<div class="c b big">TEST YAZDIRMA</div><div class="c">ÇçĞğİıÖöŞşÜü</div>');
        try { await api('/api/print-test', { address: addr }); toast('Test gönderildi', 'ok'); } catch (er) { err(er); }
      }
      if (e.target.closest('#saveGen')) { try { await collectAndSave(c); } catch (er) { err(er); } }
    };
  },

  // ---------- Yazıcılar (ürün / kategori bazlı sipariş fişi yönlendirme) ----------
  async yazicilar(c) {
    const [printers, cats, prods] = await Promise.all([api('/api/admin/printers'), api('/api/admin/categories'), api('/api/admin/products')]);
    const pname = (id) => printers.find((p) => p.id === id)?.name;
    const overrides = prods.filter((p) => p.active && p.printer_id !== null && p.printer_id !== undefined);
    const opt = (sel, none) => `<option value="">${none}</option>` + printers.map((p) => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    c.innerHTML = `<p class="muted" style="margin-top:0">Siparişler kaydedilince her ürün kendi yazıcısından çıkar. Örn: Kola → <b>İçecek</b> yazıcısı, Adana → <b>Mutfak</b> yazıcısı.
      Yazıcı önce ürüne, ürüne atanmamışsa kategorisine göre seçilir.</p>
      <div class="row" style="margin-bottom:8px"><b style="flex:1">Sipariş Yazıcıları</b><button class="btn btn-green btn-sm" id="prNew">+ Yazıcı Ekle</button></div>
      <table class="tbl"><tr><th>Ad</th><th>Adres (IP:port)</th><th>Durum</th><th></th></tr>
      ${printers.map((p) => `<tr class="${p.active ? '' : 'off'}"><td><b>${esc(p.name)}</b></td><td class="mono">${esc(p.address) || '<span class="muted">Varsayılan Windows yazıcısı</span>'}</td>
        <td>${p.active ? 'Aktif' : 'Kapalı'}</td><td class="r"><button class="btn btn-sm" data-ptest="${p.id}">Test</button>
        <button class="btn btn-sm" data-pedit="${p.id}">Düzenle</button><button class="btn btn-sm btn-red" data-pdel="${p.id}">Sil</button></td></tr>`).join('')}</table>
      <div class="section-title">Kategori → Yazıcı</div>
      <table class="tbl"><tr><th>Kategori</th><th>Yazıcı</th></tr>
      ${cats.map((k) => `<tr><td>${esc(k.name)}</td><td><select class="inp" data-catp="${k.id}">${opt(k.printer_id, '— Yazdırma —')}</select></td></tr>`).join('')}</table>
      <div class="section-title">Ürüne Özel Yazıcı ${overrides.length ? '' : '<span class="muted" style="font-size:13px">(yok — Ürünler › Düzenle ekranından atanabilir)</span>'}</div>
      ${overrides.length ? `<table class="tbl"><tr><th>Ürün</th><th>Yazıcı</th></tr>${overrides.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.printer_id ? esc(pname(p.printer_id) || '?') : 'Yazdırma'}</td></tr>`).join('')}</table>` : ''}`;
    const editPrinter = async (p = { name: '', address: '', active: 1 }) => {
      const b = document.createElement('div');
      b.innerHTML = `<div class="form"><label>Yazıcı Adı</label><input class="inp" name="name" value="${esc(p.name)}" placeholder="Örn: İçecek, Izgara, Bar">
        <label>Adres (IP:port)</label><input class="inp" name="address" value="${esc(p.address)}" placeholder="192.168.1.51:9100">
        <div class="hint">Ağ (Ethernet) termal yazıcının IP adresi. Boş bırakılırsa fiş kasadaki varsayılan Windows yazıcısından çıkar.</div>
        <label>Aktif</label><input type="checkbox" class="chk" name="active" ${p.active ? 'checked' : ''}></div>`;
      return modal({ title: p.id ? 'Yazıcı Düzenle' : 'Yeni Yazıcı', body: b, buttons: [{ label: 'Vazgeç', cls: 'btn-red' }, {
        label: 'Kaydet', cls: 'btn-green', onClick: async () => {
          try { await api('/api/admin/printers/save', { id: p.id, name: $('[name=name]', b).value.trim(), address: $('[name=address]', b).value.trim(), active: $('[name=active]', b).checked }); return true; } catch (e) { err(e); return false; }
        },
      }] });
    };
    c.onchange = async (e) => {
      const sel = e.target.closest('[data-catp]');
      if (sel) { try { await api('/api/admin/categories/save', { id: Number(sel.dataset.catp), printer_id: Number(sel.value) || null }); toast('Kaydedildi', 'ok', 1000); } catch (er) { err(er); } }
    };
    c.onclick = async (e) => {
      try {
        if (e.target.closest('#prNew')) { if (await editPrinter()) RENDER.yazicilar(c); return; }
        const ed = e.target.closest('[data-pedit]'); if (ed) { if (await editPrinter(printers.find((p) => p.id === Number(ed.dataset.pedit)))) RENDER.yazicilar(c); return; }
        const d = e.target.closest('[data-pdel]');
        if (d && await confirmBox('Yazıcı silinsin mi? Bağlı kategoriler yazdırmaz hale gelir.')) { await api('/api/admin/printers/delete', { id: Number(d.dataset.pdel) }); RENDER.yazicilar(c); return; }
        const t = e.target.closest('[data-ptest]');
        if (t) {
          const p = printers.find((x) => x.id === Number(t.dataset.ptest));
          if (!p.address) printHtml(`<div class="c b big">${esc(p.name.toLocaleUpperCase('tr'))}</div><div class="c">TEST YAZDIRMA</div><div class="c">ÇçĞğİıÖöŞşÜü</div>`);
          else { await api('/api/print-test', { address: p.address }); toast('Test gönderildi', 'ok'); }
        }
      } catch (er) { err(er); }
    };
  },

  // ---------- Kullanıcılar ----------
  async kullanicilar(c) {
    const users = await api('/api/admin/users');
    c.innerHTML = `<div class="row" style="margin-bottom:10px"><button class="btn btn-green" id="uNew">+ Yeni Kullanıcı</button></div>
      <table class="tbl"><tr><th>Ad</th><th>Yetki</th><th>Şifre</th><th>Durum</th><th></th></tr>
      ${users.map((u) => `<tr class="${u.active ? '' : 'off'}"><td>${esc(u.name)}</td><td>${ROLES[u.role]}</td><td class="mono">${'●'.repeat(u.pin.length)}</td>
        <td>${u.active ? 'Aktif' : 'Pasif'}</td><td class="r"><button class="btn btn-sm" data-edit="${u.id}">Düzenle</button>
        ${u.active ? `<button class="btn btn-sm btn-red" data-del="${u.id}">Sil</button>` : ''}</td></tr>`).join('')}</table>
      <div class="hint" style="margin-top:10px;color:#777">Yönetici: tüm yetkiler · Kasiyer: ödeme, iptal, indirim, rapor, gün sonu · Garson: sadece sipariş</div>`;
    const edit = async (u = { role: 'garson', active: 1 }) => {
      const b = document.createElement('div');
      b.innerHTML = `<div class="form"><label>Ad</label><input class="inp" name="name" value="${esc(u.name || '')}">
        <label>Şifre (PIN)</label><input class="inp" name="pin" inputmode="numeric" value="${esc(u.pin || '')}">
        <label>Yetki</label><select class="inp" name="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label>Aktif</label><input type="checkbox" class="chk" name="active" ${u.active ? 'checked' : ''}></div>`;
      const ok = await modal({ title: u.id ? 'Kullanıcı Düzenle' : 'Yeni Kullanıcı', body: b, buttons: [{ label: 'Vazgeç', cls: 'btn-red' }, {
        label: 'Kaydet', cls: 'btn-green', onClick: async () => {
          try {
            await api('/api/admin/users/save', { id: u.id, name: $('[name=name]', b).value, pin: $('[name=pin]', b).value, role: $('[name=role]', b).value, active: $('[name=active]', b).checked });
            return true;
          } catch (e) { err(e); return false; }
        },
      }] });
      if (ok) RENDER.kullanicilar(c);
    };
    c.onclick = async (e) => {
      if (e.target.closest('#uNew')) return edit();
      const ed = e.target.closest('[data-edit]'); if (ed) return edit(users.find((u) => u.id === Number(ed.dataset.edit)));
      const d = e.target.closest('[data-del]');
      if (d && await confirmBox('Kullanıcı pasif yapılsın mı?')) { try { await api('/api/admin/users/delete', { id: Number(d.dataset.del) }); RENDER.kullanicilar(c); } catch (er) { err(er); } }
    };
  },

  // ---------- Ürünler ----------
  async urunler(c, ctx, state = {}) {
    const [cats, prods, printers] = await Promise.all([api('/api/admin/categories'), api('/api/admin/products'), api('/api/admin/printers')]);
    let catId = state.catId ?? cats[0]?.id;
    const showInactive = !!state.inactive;
    const list = prods.filter((p) => p.category_id === catId && (showInactive || p.active));
    c.innerHTML = `<div class="split"><div>
        <div class="list">${cats.map((k) => `<button data-cat="${k.id}" class="${k.id === catId ? 'active' : ''}">${esc(k.name)} <span class="muted">(${prods.filter((p) => p.category_id === k.id && p.active).length})</span></button>`).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn btn-sm btn-green" id="catNew">+ Kategori</button>
        <button class="btn btn-sm" id="catRen">Düzenle</button><button class="btn btn-sm btn-red" id="catDel">Sil</button></div>
        <div class="row"><button class="btn btn-sm" id="catUp">▲ Yukarı</button><button class="btn btn-sm" id="catDown">▼ Aşağı</button></div>
      </div><div>
        <div class="row" style="margin-bottom:10px"><button class="btn btn-green" id="pNew">+ Yeni Ürün</button>
          <button class="btn btn-orange" id="bulk">% Toplu Fiyat Güncelle</button>
          <label class="row"><input type="checkbox" id="inact" ${showInactive ? 'checked' : ''}> Pasifleri göster</label></div>
        <table class="tbl"><tr><th>Sıra</th><th>Ürün</th><th class="r">Fiyat</th><th>Mutfak</th><th>Fiyat Sor</th><th></th></tr>
        ${list.map((p, i) => `<tr class="${p.active ? '' : 'off'}"><td><button class="btn btn-sm" data-up="${i}">▲</button><button class="btn btn-sm" data-down="${i}">▼</button></td>
          <td>${esc(p.name)}</td><td class="r">${money(p.price)}</td><td>${p.kitchen ? '✔' : ''}</td><td>${p.ask_price ? '✔' : ''}</td>
          <td class="r"><button class="btn btn-sm" data-edit="${p.id}">Düzenle</button>${p.active ? `<button class="btn btn-sm btn-red" data-del="${p.id}">Sil</button>` : `<button class="btn btn-sm" data-act="${p.id}">Aktif Et</button>`}</td></tr>`).join('')}
        </table></div></div>`;
    const again = (st = {}) => RENDER.urunler(c, ctx, { catId, inactive: showInactive, ...st });
    const editProduct = async (p = { category_id: catId, price: 0, kitchen: 1, ask_price: 0, active: 1, sort: list.length + 1 }) => {
      const b = document.createElement('div');
      b.innerHTML = `<div class="form"><label>Ürün Adı</label><input class="inp" name="name" value="${esc(p.name || '')}">
        <label>Fiyat (TL)</label><input class="inp" name="price" inputmode="decimal" value="${String(p.price).replace('.', ',')}">
        <label>Kategori</label><select class="inp" name="category_id">${cats.map((k) => `<option value="${k.id}" ${k.id === p.category_id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
        <label>Mutfak ekranına düşsün</label><input type="checkbox" class="chk" name="kitchen" ${p.kitchen ? 'checked' : ''}>
        <label>Sipariş yazıcısı</label><select class="inp" name="printer_id">
          <option value="" ${p.printer_id == null ? 'selected' : ''}>Kategori yazıcısı (varsayılan)</option>
          <option value="0" ${p.printer_id === 0 ? 'selected' : ''}>— Yazdırma —</option>
          ${printers.map((x) => `<option value="${x.id}" ${p.printer_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <label>Satışta fiyat sor</label><input type="checkbox" class="chk" name="ask_price" ${p.ask_price ? 'checked' : ''}>
        <div class="hint">Joker / açık fiyatlı ürünler için</div></div>`;
      const ok = await modal({ title: p.id ? 'Ürün Düzenle' : 'Yeni Ürün', body: b, onOpen: () => $('[name=name]', b).focus(), buttons: [{ label: 'Vazgeç', cls: 'btn-red' }, {
        label: 'Kaydet', cls: 'btn-green', onClick: async () => {
          try {
            await api('/api/admin/products/save', { id: p.id, name: $('[name=name]', b).value.trim(), price: num($('[name=price]', b).value),
              category_id: Number($('[name=category_id]', b).value), printer_id: $('[name=printer_id]', b).value === '' ? null : Number($('[name=printer_id]', b).value), kitchen: $('[name=kitchen]', b).checked, ask_price: $('[name=ask_price]', b).checked, sort: p.sort, active: 1 });
            return true;
          } catch (e) { err(e); return false; }
        },
      }] });
      if (ok) again();
    };
    c.onclick = async (e) => {
      const t = e.target;
      const cat = t.closest('[data-cat]'); if (cat) return again({ catId: Number(cat.dataset.cat) });
      if (t.closest('#inact')) return again({ inactive: t.checked });
      try {
        if (t.closest('#catNew')) { const n = await textPrompt('Kategori adı'); if (n) { const r = await api('/api/admin/categories/save', { name: n, sort: cats.length + 1 }); again({ catId: r.id }); } return; }
        const curCat = cats.find((k) => k.id === catId);
        if (t.closest('#catRen') && curCat) { const n = await textPrompt('Kategori adı', { value: curCat.name }); if (n) { await api('/api/admin/categories/save', { id: catId, name: n }); again(); } return; }
        if (t.closest('#catDel') && curCat) { if (await confirmBox(`"${curCat.name}" kategorisi silinsin mi? Ürünleri pasif olur.`)) { await api('/api/admin/categories/delete', { id: catId }); again({ catId: undefined }); } return; }
        const mv = t.closest('#catUp') ? -1 : t.closest('#catDown') ? 1 : 0;
        if (mv && curCat) {
          const i = cats.indexOf(curCat), j = i + mv;
          if (j < 0 || j >= cats.length) return;
          [cats[i], cats[j]] = [cats[j], cats[i]];
          for (let k = 0; k < cats.length; k++) await api('/api/admin/categories/save', { id: cats[k].id, sort: k + 1 });
          return again();
        }
        if (t.closest('#pNew')) return editProduct();
        if (t.closest('#bulk')) return bulkPrice(cats, catId, again);
        const ed = t.closest('[data-edit]'); if (ed) return editProduct(prods.find((p) => p.id === Number(ed.dataset.edit)));
        const d = t.closest('[data-del]'); if (d && await confirmBox('Ürün satıştan kaldırılsın mı?')) { await api('/api/admin/products/delete', { id: Number(d.dataset.del) }); return again(); }
        const a = t.closest('[data-act]'); if (a) { await api('/api/admin/products/save', { id: Number(a.dataset.act), active: 1 }); return again(); }
        const up = t.closest('[data-up]'), dn = t.closest('[data-down]');
        if (up || dn) {
          const i = Number((up || dn).dataset.up ?? (up || dn).dataset.down), j = up ? i - 1 : i + 1;
          if (j < 0 || j >= list.length) return;
          const ids = list.map((p) => p.id);
          [ids[i], ids[j]] = [ids[j], ids[i]];
          await api('/api/admin/products/reorder', { ids });
          return again();
        }
      } catch (er) { err(er); }
    };
  },

  // ---------- Müşteriler ----------
  async musteriler(c, ctx, q = '') {
    const list = await api('/api/customers?q=' + encodeURIComponent(q));
    c.innerHTML = `<div class="row" style="margin-bottom:10px"><input class="inp" id="mq" style="flex:1" placeholder="Ara..." value="${esc(q)}">
      <button class="btn btn-green" id="mNew">+ Yeni Müşteri</button></div>
      <table class="tbl"><tr><th>Ad</th><th>Telefon</th><th>Adres</th><th>Sipariş</th><th class="r">Bakiye</th><th></th></tr>
      ${list.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.phone)}</td><td>${esc(m.address)}</td><td>${m.order_count}</td>
        <td class="r" style="color:${m.balance > 0 ? '#c62828' : 'inherit'}">${money(m.balance)}</td>
        <td class="r"><button class="btn btn-sm" data-detail="${m.id}">Detay</button><button class="btn btn-sm" data-edit="${m.id}">Düzenle</button></td></tr>`).join('')}</table>`;
    $('#mq', c).onkeydown = (e) => { if (e.key === 'Enter') RENDER.musteriler(c, ctx, e.target.value); };
    c.onclick = async (e) => {
      if (e.target.closest('#mNew')) { if (await ctx.customerForm({})) RENDER.musteriler(c, ctx, q); return; }
      const ed = e.target.closest('[data-edit]'); if (ed) { if (await ctx.customerForm(list.find((m) => m.id === Number(ed.dataset.edit)))) RENDER.musteriler(c, ctx, q); return; }
      const dt = e.target.closest('[data-detail]'); if (dt) { await customerDetail(Number(dt.dataset.detail)); RENDER.musteriler(c, ctx, q); }
    };
  },

  // ---------- Bölümler ----------
  async bolumler(c, ctx, state = {}) {
    const [secs, tables] = await Promise.all([api('/api/admin/sections'), api('/api/admin/tables')]);
    const secId = state.secId ?? secs[0]?.id;
    const tl = tables.filter((t) => t.section_id === secId);
    c.innerHTML = `<div class="split"><div>
        <div class="list">${secs.map((s) => `<button data-sec="${s.id}" class="${s.id === secId ? 'active' : ''}">${esc(s.name)} <span class="muted">(${tables.filter((t) => t.section_id === s.id).length} masa)</span></button>`).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn btn-sm btn-green" id="sNew">+ Bölüm</button><button class="btn btn-sm" id="sRen">Düzenle</button><button class="btn btn-sm btn-red" id="sDel">Sil</button></div>
      </div><div>
        <div class="row" style="margin-bottom:10px"><button class="btn btn-green" id="tNew">+ Masa Ekle</button><button class="btn btn-blue" id="tGen">Toplu Masa Oluştur</button></div>
        <div class="picker">${tl.map((t) => `<button data-t="${t.id}">${esc(t.name)}</button>`).join('')}</div>
        <div class="hint" style="margin-top:8px;color:#777">Masaya dokunarak adını değiştirin veya silin.</div>
      </div></div>`;
    const again = (st = {}) => RENDER.bolumler(c, ctx, { secId, ...st });
    c.onclick = async (e) => {
      const t = e.target;
      try {
        const s = t.closest('[data-sec]'); if (s) return again({ secId: Number(s.dataset.sec) });
        const cur = secs.find((x) => x.id === secId);
        if (t.closest('#sNew')) { const n = await textPrompt('Bölüm adı', { presets: ['Bahçe', 'Teras', 'Üst Kat', 'Aile Salonu'] }); if (n) { const r = await api('/api/admin/sections/save', { name: n, sort: secs.length + 1 }); again({ secId: r.id }); } return; }
        if (t.closest('#sRen') && cur) { const n = await textPrompt('Bölüm adı', { value: cur.name }); if (n) { await api('/api/admin/sections/save', { id: cur.id, name: n }); again(); } return; }
        if (t.closest('#sDel') && cur) { if (await confirmBox(`"${cur.name}" bölümü ve tüm masaları silinsin mi?`)) { await api('/api/admin/sections/delete', { id: cur.id }); again({ secId: undefined }); } return; }
        if (t.closest('#tNew') && cur) { const n = await textPrompt('Masa adı / numarası', { value: String(tl.length + 1) }); if (n) { await api('/api/admin/tables/save', { section_id: secId, name: n, sort: tl.length + 1 }); again(); } return; }
        if (t.closest('#tGen') && cur) {
          const from = await numberPrompt('Başlangıç numarası', { decimals: false, value: tl.length + 1 }); if (from === undefined) return;
          const to = await numberPrompt('Bitiş numarası', { decimals: false, value: from + 9 }); if (to === undefined) return;
          const prefix = await textPrompt('Ön ek (isteğe bağlı, örn: B)', { value: '' });
          await api('/api/admin/tables/generate', { section_id: secId, from, to, prefix: prefix || '' }); return again();
        }
        const tb = t.closest('[data-t]');
        if (tb) {
          const table = tl.find((x) => x.id === Number(tb.dataset.t));
          const r = await modal({ title: 'Masa: ' + table.name, body: `<input class="inp big" id="tn" value="${esc(table.name)}">`,
            buttons: [{ label: 'Sil', cls: 'btn-red', value: 'del' }, { label: 'Kaydet', cls: 'btn-green', onClick: (cl, w) => ({ name: $('#tn', w).value }) }] });
          if (r === 'del') { if (await confirmBox('Masa silinsin mi?')) { await api('/api/admin/tables/delete', { id: table.id }); again(); } }
          else if (r?.name) { await api('/api/admin/tables/save', { id: table.id, name: r.name }); again(); }
        }
      } catch (er) { err(er); }
    };
  },

  // ---------- Raporlar ----------
  async raporlar(c, ctx, range) {
    const day = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
    const today = day(Date.now());
    const presets = {
      'Bugün': [today, today + 864e5], 'Dün': [today - 864e5, today],
      'Bu Hafta': [today - ((new Date().getDay() + 6) % 7) * 864e5, today + 864e5],
      'Bu Ay': [new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(), today + 864e5],
      'Geçen Ay': [new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime(), new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()],
    };
    range = range || { name: 'Bugün', from: presets['Bugün'][0], to: presets['Bugün'][1] };
    const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    c.innerHTML = `<div class="row">${Object.keys(presets).map((k) => `<button class="chip ${range.name === k ? 'active' : ''}" data-pre="${k}">${k}</button>`).join('')}
      <input type="date" class="inp" id="rf" value="${iso(range.from)}"> — <input type="date" class="inp" id="rt" value="${iso(range.to - 864e5)}">
      <button class="btn btn-blue btn-sm" id="rGo">Göster</button><button class="btn btn-sm" id="rCsv">Excel (CSV)</button><button class="btn btn-sm" id="rPrint">Yazdır</button></div>
      <div id="rOut" style="margin-top:12px">Yükleniyor...</div>`;
    const r = await api(`/api/reports?from=${range.from}&to=${range.to}`);
    $('#rOut', c).innerHTML = reportHtml(r);
    c.onclick = (e) => {
      const p = e.target.closest('[data-pre]');
      if (p) return RENDER.raporlar(c, ctx, { name: p.dataset.pre, from: presets[p.dataset.pre][0], to: presets[p.dataset.pre][1] });
      if (e.target.closest('#rGo')) {
        const f = new Date($('#rf', c).value + 'T00:00').getTime(), t = new Date($('#rt', c).value + 'T00:00').getTime() + 864e5;
        return RENDER.raporlar(c, ctx, { name: 'Özel', from: f, to: t });
      }
      if (e.target.closest('#rCsv')) downloadCsv(r);
      if (e.target.closest('#rPrint')) printHtml(reportPrint(r, ctx.boot.settings));
    };
  },

  // ---------- El Terminali ----------
  async terminal(c) {
    const n = await api('/api/network');
    const urls = (path) => (n.ips.length ? n.ips : ['BILGISAYAR-IP']).map((ip) => `<div class="mono" style="font-size:20px;margin:4px 0">http://${ip}:${n.port}${path}</div>`).join('');
    c.innerHTML = `<h3>📱 Garson El Terminali</h3>
      <p>Garsonlar aynı Wi-Fi ağına bağlı telefon veya tabletten aşağıdaki adresi açarak sipariş alabilir.
      Tarayıcıda "Ana ekrana ekle" ile uygulama gibi kullanılabilir.</p>${urls('/garson')}
      <h3 style="margin-top:24px">🍳 Mutfak Ekranı</h3>
      <p>Mutfaktaki tablet / ekranda açın. Yeni siparişler sesli uyarı ile anında düşer, hazır olunca kasaya bildirim gider.</p>${urls('/mutfak')}
      <h3 style="margin-top:24px">🖥 Ek Kasa</h3><p>Başka bir bilgisayardan kasa ekranı için:</p>${urls('/')}
      <p class="muted">Not: Windows Güvenlik Duvarı ${n.port} numaralı porta izin vermelidir (kurulum betiği bunu otomatik ekler).</p>`;
  },

  // ---------- SMS ----------
  async sms(c) {
    const s = (await api('/api/bootstrap')).settings;
    c.innerHTML = `<div class="form">
      ${field('SMS gönderimi aktif', 'sms_enabled', s, 'check', 'Paket sipariş "Yolda" durumuna geçince müşteriye SMS gönderilir')}
      ${field('SMS API adresi', 'sms_url', s, 'text', 'HTTP GET adresi. {telefon} ve {mesaj} yer tutucularını kullanın. Örn: https://api.saglayici.com/send?user=X&pass=Y&gsm={telefon}&text={mesaj}')}
      ${field('Paket yolda mesajı', 'sms_template_paket', s, 'text', '{ad} ve {restoran} kullanılabilir')}
      <h4>Test</h4><label>Telefon</label><input class="inp" id="smsTel" placeholder="05xx...">
      <label></label><div><button class="btn btn-blue btn-sm" id="smsTest">Test SMS Gönder</button></div>
    </div><div style="text-align:right;margin-top:14px"><button class="btn btn-green" id="smsSave" style="font-size:26px;padding:6px 30px">✔</button></div>`;
    c.onclick = async (e) => {
      try {
        if (e.target.closest('#smsSave')) await collectAndSave(c);
        if (e.target.closest('#smsTest')) { await collectAndSave(c); const r = await api('/api/sms/test', { phone: $('#smsTel', c).value }); toast('Yanıt: ' + r.response, 'ok', 6000); }
      } catch (er) { err(er); }
    };
  },

  // ---------- Gün Sonu ----------
  async gunsonu(c, ctx) {
    const d = await api('/api/dayend');
    const r = d.current;
    c.innerHTML = `<div class="row" style="margin-bottom:10px"><b>Dönem başlangıcı:</b> ${r.from ? dateTime(r.from) : 'İlk kayıt'}
      <span style="flex:1"></span><button class="btn btn-sm" id="zPrint">Yazdır</button><button class="btn btn-red" id="zClose">GÜN SONU AL</button></div>
      ${r.openCount ? `<div class="msg" style="color:#c62828">⚠ ${r.openCount} açık adisyon var (${money(r.openTotal)} TL). Gün sonu öncesi kapatmanız önerilir.</div>` : ''}
      ${reportHtml(r, true)}
      <div class="section-title">Önceki Gün Sonları</div>
      <table class="tbl"><tr><th>Başlangıç</th><th>Bitiş</th><th>Kullanıcı</th><th></th></tr>
      ${d.closings.map((z) => `<tr><td>${z.period_start ? dateTime(z.period_start) : '-'}</td><td>${dateTime(z.closed_at)}</td><td>${esc(z.user_name || '')}</td>
        <td class="r"><button class="btn btn-sm" data-z="${z.id}">Görüntüle / Yazdır</button></td></tr>`).join('')}</table>`;
    c.onclick = async (e) => {
      try {
        if (e.target.closest('#zPrint')) printHtml(reportPrint(r, ctx.boot.settings, 'GÜN SONU (ARA RAPOR)'));
        if (e.target.closest('#zClose')) {
          if (!(await confirmBox(`Gün sonu alınacak. Ciro: ${money(r.revenue)} TL. Onaylıyor musunuz?`))) return;
          const res = await api('/api/dayend/close', {});
          printHtml(reportPrint(res.summary, ctx.boot.settings, 'GÜN SONU RAPORU'));
          toast('Gün sonu alındı', 'ok');
          RENDER.gunsonu(c, ctx);
        }
        const z = e.target.closest('[data-z]');
        if (z) {
          const rec = await api('/api/dayend/' + z.dataset.z);
          const ok = await modal({ title: 'Gün Sonu ' + dateTime(rec.closed_at), cls: 'modal-lg', body: reportHtml(rec.summary, true),
            buttons: [{ label: 'Yazdır', cls: 'btn-blue', value: true }] });
          if (ok) printHtml(reportPrint(rec.summary, ctx.boot.settings, 'GÜN SONU RAPORU'));
        }
      } catch (er) { err(er); }
    };
  },

  // ---------- Tahsilat İptal ----------
  async tahsilat(c) {
    const list = await api('/api/payments');
    c.innerHTML = `<p class="muted">Bu dönemde (son gün sonundan beri) alınan tahsilatlar. İptal edilen tahsilatın adisyonu tekrar açılır.</p>
      <table class="tbl"><tr><th>Saat</th><th>Adisyon</th><th>Tip</th><th>Kullanıcı</th><th class="r">Tutar</th><th></th></tr>
      ${list.map((p) => `<tr class="${p.cancelled ? 'off' : ''}"><td>${dateTime(p.created_at)}</td><td>${esc(p.label)} #${p.order_id}</td><td>${METHODS[p.method]}</td>
        <td>${esc(p.user_name || '')}</td><td class="r">${money(p.amount)}</td>
        <td class="r">${p.cancelled ? 'İptal' : `<button class="btn btn-sm btn-red" data-cancel="${p.id}">İptal Et</button>`}</td></tr>`).join('')}</table>`;
    c.onclick = async (e) => {
      const b = e.target.closest('[data-cancel]');
      if (b && await confirmBox('Tahsilat iptal edilsin mi? Adisyon tekrar açılacak.')) {
        try { await api('/api/payments/cancel', { id: Number(b.dataset.cancel) }); toast('Tahsilat iptal edildi', 'ok'); RENDER.tahsilat(c); } catch (er) { err(er); }
      }
    };
  },

  async gecmis(c) {
    const logs = await api('/api/logs?limit=500');
    c.innerHTML = `<table class="tbl"><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Detay</th></tr>
      ${logs.map((l) => `<tr><td>${dateTime(l.at)}</td><td>${esc(l.user_name || '')}</td><td><span class="tag">${esc(l.action.replace(/_/g, ' '))}</span></td><td>${esc(l.detail)}</td></tr>`).join('')}</table>`;
  },

  async yedek(c) {
    c.innerHTML = `<h3>💾 Veritabanı Yedeği</h3>
      <p>Tüm satış, ürün, müşteri ve ayar bilgileri tek bir dosyada saklanır. Düzenli olarak yedek alıp USB belleğe veya buluta kopyalayın.</p>
      <button class="btn btn-green" id="bk">Yedeği İndir</button>
      <p class="muted" style="margin-top:16px">Geri yüklemek için: programı kapatın, indirilen dosyayı <span class="mono">data\\restoran.db</span> olarak kopyalayın ve programı yeniden başlatın.</p>`;
    $('#bk', c).onclick = async () => {
      try {
        const res = await fetch('/api/backup', { headers: { 'X-Token': (await import('./common.js')).token } });
        if (!res.ok) throw new Error('Yedek alınamadı');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `restoran-yedek-${new Date().toISOString().slice(0, 10)}.db`;
        a.click();
      } catch (e) { err(e); }
    };
  },
};

async function bulkPrice(cats, catId, again) {
  const b = document.createElement('div');
  b.innerHTML = `<div class="form"><label>Kapsam</label><select class="inp" name="cat"><option value="">Tüm ürünler</option>
    ${cats.map((k) => `<option value="${k.id}" ${k.id === catId ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
    <label>Değişim (%)</label><input class="inp" name="pct" inputmode="decimal" placeholder="Örn: 10 veya -5">
    <label>Yuvarlama</label><select class="inp" name="round"><option value="0">Yok (kuruşlu)</option><option value="1">1 TL</option><option value="5" selected>5 TL</option><option value="10">10 TL</option></select></div>`;
  const ok = await modal({ title: 'Toplu Fiyat Güncelleme', body: b, buttons: [{ label: 'Vazgeç', cls: 'btn-red' }, {
    label: 'Uygula', cls: 'btn-green', onClick: async () => {
      try {
        const r = await api('/api/admin/products/bulk-price', { category_id: Number($('[name=cat]', b).value) || null, percent: num($('[name=pct]', b).value), round: Number($('[name=round]', b).value) });
        toast(`${r.updated} ürün güncellendi`, 'ok'); return true;
      } catch (e) { err(e); return false; }
    },
  }] });
  if (ok) again();
}

async function customerDetail(id) {
  const m = await api('/api/customers/' + id);
  const ok = await modal({
    title: m.name, cls: 'modal-lg',
    body: `<div class="cards"><div class="kpi"><div class="k">Telefon</div><div class="v" style="font-size:16px">${esc(m.phone)}</div></div>
      <div class="kpi ${m.balance > 0 ? 'red' : 'green'}"><div class="k">Cari Bakiye (borç)</div><div class="v">${money(m.balance)} TL</div></div>
      <div class="kpi"><div class="k">Adres</div><div style="margin-top:4px">${esc(m.address)}</div></div></div>
      <div class="section-title">Cari Hareketler</div>
      <table class="tbl"><tr><th>Tarih</th><th>Açıklama</th><th class="r">Tutar</th></tr>${m.tx.map((t) => `<tr><td>${dateTime(t.created_at)}</td><td>${esc(t.note)} ${t.method && t.amount < 0 ? '(' + METHODS[t.method] + ')' : ''}</td><td class="r">${money(t.amount)}</td></tr>`).join('')}</table>
      <div class="section-title">Siparişler</div>
      <table class="tbl">${m.orders.map((o) => `<tr><td>${dateTime(o.opened_at)}</td><td>${esc(o.items.map((i) => qty(i.qty) + 'x ' + i.name).join(', '))}</td><td class="r">${money(o.total)}</td></tr>`).join('')}</table>`,
    buttons: m.balance > 0 ? [{ label: '💵 Tahsilat Al', cls: 'btn-green', value: true }] : [],
  });
  if (ok) {
    const amount = await numberPrompt('Tahsilat Tutarı', { value: m.balance });
    if (!amount) return;
    const method = await modal({ title: 'Ödeme Tipi', body: '', buttons: [{ label: 'Nakit', cls: 'btn-green', value: 'nakit' }, { label: 'Kredi Kartı', cls: 'btn-blue', value: 'kart' }] });
    if (!method) return;
    try { await api('/api/customers/collect', { customer_id: id, amount, method }); toast('Tahsilat alındı', 'ok'); } catch (e) { err(e); }
  }
}

// ---------- rapor görünümü ----------
function bars(rows, key = 'amount') {
  const max = Math.max(1, ...rows.map((r) => r[key]));
  return rows.map((r) => `<div class="bar" style="width:${(r[key] / max) * 100}%"></div>`);
}
const TYPE_NAMES = { masa: 'Masa', paket: 'Paket Servis', bekleyen: 'Bekleyen / Hızlı' };

function reportHtml(r, compact) {
  const mth = Object.entries(r.byMethod);
  const maxH = Math.max(1, ...r.byHour);
  const prodBars = bars(r.products);
  const catBars = bars(r.categories);
  return `<div class="cards">
      <div class="kpi green"><div class="k">Toplam Ciro</div><div class="v">${money(r.revenue)} TL</div></div>
      ${mth.map(([k, v]) => `<div class="kpi"><div class="k">${METHODS[k] || k}</div><div class="v">${money(v)} TL</div></div>`).join('')}
      <div class="kpi"><div class="k">Kapanan Adisyon</div><div class="v">${r.orderCount}</div></div>
      <div class="kpi"><div class="k">Ortalama Adisyon</div><div class="v">${money(r.average)} TL</div></div>
      <div class="kpi"><div class="k">Misafir</div><div class="v">${r.guestCount}</div></div>
      <div class="kpi red"><div class="k">İndirimler</div><div class="v">${money(r.discounts)} TL</div></div>
      <div class="kpi red"><div class="k">İptaller</div><div class="v">${money(r.cancelledTotal)} TL</div></div>
      <div class="kpi red"><div class="k">Kasa Çıkış</div><div class="v">${money(r.expenseTotal)} TL</div></div>
      ${r.collectionCash || r.collectionCard ? `<div class="kpi"><div class="k">Cari Tahsilat</div><div class="v">${money(r.collectionCash + r.collectionCard)} TL</div></div>` : ''}
      <div class="kpi blue"><div class="k">Kasadaki Nakit</div><div class="v">${money(r.cashInDrawer)} TL</div></div>
      <div class="kpi"><div class="k">Açık Adisyonlar</div><div class="v">${r.openCount} / ${money(r.openTotal)}</div></div>
    </div>
    ${Object.keys(r.byType).length ? `<div class="section-title">Satış Türleri</div><table class="tbl"><tr><th>Tür</th><th>Adet</th><th class="r">Tutar</th></tr>
      ${Object.entries(r.byType).map(([k, v]) => `<tr><td>${TYPE_NAMES[k] || k}</td><td>${v.count}</td><td class="r">${money(v.amount)}</td></tr>`).join('')}</table>` : ''}
    <div class="section-title">Saatlik Ciro</div>
    <div class="hours">${r.byHour.map((v, h) => `<div style="height:${(v / maxH) * 100}%" title="${h}:00 — ${money(v)} TL"><span>${h}</span></div>`).join('')}</div>
    <div class="section-title" style="margin-top:26px">Kategori Satışları</div>
    <table class="tbl"><tr><th>Kategori</th><th>Adet</th><th class="r">Tutar</th><th style="width:35%"></th></tr>
      ${r.categories.map((k, i) => `<tr><td>${esc(k.name)}</td><td>${qty(k.qty)}</td><td class="r">${money(k.amount)}</td><td>${catBars[i]}</td></tr>`).join('')}</table>
    <div class="section-title">Ürün Satışları</div>
    <table class="tbl"><tr><th>Ürün</th><th>Kategori</th><th>Adet</th><th>İkram</th><th class="r">Tutar</th><th style="width:30%"></th></tr>
      ${r.products.map((p, i) => `<tr><td>${esc(p.name)}</td><td class="muted">${esc(p.category || '')}</td><td>${qty(p.qty)}</td><td>${p.free_qty ? qty(p.free_qty) : ''}</td><td class="r">${money(p.amount)}</td><td>${prodBars[i]}</td></tr>`).join('')}</table>
    <div class="section-title">Personel Satışları</div>
    <table class="tbl"><tr><th>Personel</th><th>Ürün Adedi</th><th class="r">Tutar</th></tr>
      ${r.byUser.map((u) => `<tr><td>${esc(u.name)}</td><td>${qty(u.qty)}</td><td class="r">${money(u.amount)}</td></tr>`).join('')}</table>
    ${r.cancelledItems.length ? `<div class="section-title">İptal Edilen Ürünler</div><table class="tbl"><tr><th>Saat</th><th>Ürün</th><th>Neden</th><th>Ekleyen</th><th class="r">Tutar</th></tr>
      ${r.cancelledItems.map((i) => `<tr><td>${hm(i.created_at)}</td><td>${qty(i.qty)} x ${esc(i.name)}</td><td>${esc(i.cancel_reason)}</td><td>${esc(i.user_name || '')}</td><td class="r">${money(i.qty * i.unit_price)}</td></tr>`).join('')}</table>` : ''}
    ${r.expenses.length && !compact ? '' : ''}
    ${r.expenses.length ? `<div class="section-title">Kasa Çıkışları</div><table class="tbl">${r.expenses.map((e) => `<tr><td>${dateTime(e.created_at)}</td><td>${esc(e.description)}</td><td class="r">${money(e.amount)}</td></tr>`).join('')}</table>` : ''}`;
}

function reportPrint(r, s, title = 'SATIŞ RAPORU') {
  const row = (l, v) => `<tr><td>${l}</td><td class="r">${v}</td></tr>`;
  return `<div class="c b big">${esc(s.restaurant_name)}</div><div class="c b">${title}</div>
    <div class="c">${r.from ? dateTime(r.from) : 'Başlangıç'} →<br>${dateTime(Math.min(r.to, Date.now()))}</div><hr>
    <table>${row('<b>TOPLAM CİRO</b>', '<b>' + money(r.revenue) + '</b>')}
    ${Object.entries(r.byMethod).map(([k, v]) => row(METHODS[k] || k, money(v))).join('')}
    ${row('Adisyon sayısı', r.orderCount)}${row('Misafir', r.guestCount)}${row('Ortalama', money(r.average))}
    ${row('İndirim', money(r.discounts))}${row('İptal', money(r.cancelledTotal))}${row('Kasa çıkış', money(r.expenseTotal))}
    ${row('Cari tahsilat (nakit)', money(r.collectionCash))}${row('<b>KASADAKİ NAKİT</b>', '<b>' + money(r.cashInDrawer) + '</b>')}
    ${r.openCount ? row('Açık adisyon', r.openCount + ' / ' + money(r.openTotal)) : ''}</table><hr>
    <div class="b">KATEGORİLER</div><table>${r.categories.map((k) => row(`${esc(k.name)} (${qty(k.qty)})`, money(k.amount))).join('')}</table><hr>
    <div class="b">ÜRÜNLER</div><table>${r.products.map((p) => row(`${qty(p.qty)} x ${esc(p.name)}`, money(p.amount))).join('')}</table><hr>
    <div class="b">PERSONEL</div><table>${r.byUser.map((u) => row(esc(u.name), money(u.amount))).join('')}</table>
    ${r.expenses.length ? `<hr><div class="b">KASA ÇIKIŞLARI</div><table>${r.expenses.map((e) => row(esc(e.description), money(e.amount))).join('')}</table>` : ''}
    <hr><div class="c">${dateTime(Date.now())}</div>`;
}

function downloadCsv(r) {
  const lines = [['Ürün', 'Kategori', 'Adet', 'İkram Adet', 'Tutar']];
  for (const p of r.products) lines.push([p.name, p.category || '', p.qty, p.free_qty, p.amount.toFixed(2).replace('.', ',')]);
  lines.push([], ['Ödeme Tipi', 'Tutar']);
  for (const [k, v] of Object.entries(r.byMethod)) lines.push([METHODS[k] || k, v.toFixed(2).replace('.', ',')]);
  lines.push(['Toplam Ciro', r.revenue.toFixed(2).replace('.', ',')]);
  const csv = '﻿' + lines.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `rapor-${new Date(r.from || Date.now()).toISOString().slice(0, 10)}.csv`;
  a.click();
}
