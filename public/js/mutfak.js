// Mutfak ekranı (KDS)
import { $, esc, qty, hm, duration, api, ensureSession, connectEvents, toast, beep } from './common.js';

let data = { orders: [], recent: [] };
let sound = true;
const err = (e) => toast(e.message || String(e), 'error', 4000);
const STATUS = { new: 'Yeni', preparing: 'Hazırlanıyor' };

async function start() {
  await ensureSession('Mutfak Ekranı');
  $('#k').hidden = false;
  $('#kSound').onclick = () => { sound = !sound; $('#kSound').textContent = sound ? '🔔 Ses Açık' : '🔕 Ses Kapalı'; if (sound) beep(1); };
  connectEvents((ev) => {
    if (ev.type === 'kitchen_new') { if (sound) beep(3, 760); toast('Yeni sipariş: ' + ev.label, 'warn', 4000); }
    if (ev.type === 'changed' || ev.type === 'kitchen_new') load();
  }, (ok) => $('#conn').classList.toggle('off', !ok));
  setInterval(render, 20000);
  setInterval(() => { $('#kClock').textContent = hm(Date.now()); }, 1000);
  $('#kGrid').onclick = onClick;
  await load();
}

async function load() {
  try { data = await api('/api/kitchen'); render(); } catch (e) { err(e); }
}

function render() {
  const now = Date.now();
  $('#kCount').textContent = `(${data.orders.length} sipariş)`;
  $('#kGrid').innerHTML = data.orders.map((o) => {
    const oldest = Math.min(...o.items.map((i) => i.created_at));
    const age = (now - oldest) / 60000;
    const cls = age > 25 ? 'late' : age > 12 ? 'warn' : '';
    return `<div class="k-card ${cls}"><div class="h"><span>${esc(o.label)}</span><span>${duration(now - oldest)}</span></div>
      ${o.items.map((i) => `<div class="it ${i.kitchen_status}" data-item="${i.id}" data-st="${i.kitchen_status}"><span>${qty(i.qty)} x</span>
        <span>${esc(i.name)}${i.note ? `<span class="n">» ${esc(i.note)}</span>` : ''}</span>
        <span class="st">${STATUS[i.kitchen_status]}<br>${hm(i.created_at)} ${esc(i.user_name || '')}</span></div>`).join('')}
      ${o.note ? `<div class="note">NOT: ${esc(o.note)}</div>` : ''}
      <div class="f"><button class="btn btn-orange" data-prep="${o.id}">Hazırlanıyor</button><button class="btn btn-green" data-ready="${o.id}">✔ Hazır</button></div></div>`;
  }).join('') || '<div class="k-empty" style="grid-column:1/-1">Bekleyen sipariş yok 👍</div>';
  $('#kRecent').innerHTML = data.recent.length ? 'Son hazırlananlar: ' + data.recent.map((r) => `${hm(r.kitchen_at)} ${qty(r.qty)}x ${esc(r.name)}`).join(' · ') : '';
}

async function setStatus(ids, status) {
  try { await api('/api/kitchen/status', { ids, status }); await load(); } catch (e) { err(e); }
}

function onClick(e) {
  const it = e.target.closest('[data-item]');
  if (it) return setStatus([Number(it.dataset.item)], it.dataset.st === 'new' ? 'preparing' : 'ready');
  const p = e.target.closest('[data-prep]');
  const r = e.target.closest('[data-ready]');
  if (p || r) {
    const o = data.orders.find((x) => x.id === Number((p || r).dataset.prep || (p || r).dataset.ready));
    setStatus(o.items.map((i) => i.id), p ? 'preparing' : 'ready');
  }
}

start().catch(err);
