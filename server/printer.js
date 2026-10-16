// ESC/POS ağ yazıcısı desteği (TCP 9100). Türkçe karakterler için CP857 kod sayfası kullanılır.
import net from 'node:net';

const CP857 = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a,
  'ï': 0x8b, 'î': 0x8c, 'ı': 0x8d, 'Ä': 0x8e, 'É': 0x90, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'İ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'Ş': 0x9e, 'ş': 0x9f, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4,
  'Ñ': 0xa5, 'Ğ': 0xa6, 'ğ': 0xa7, 'Â': 0xb6, 'Î': 0xd7, 'Û': 0xea,
};

function encode(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else if (CP857[ch] !== undefined) out.push(CP857[ch]);
    else out.push(0x3f);
  }
  return Buffer.from(out);
}

const ESC = 0x1b, GS = 0x1d;
export const CMD = {
  init: Buffer.from([ESC, 0x40, ESC, 0x74, 13]), // init + PC857
  boldOn: Buffer.from([ESC, 0x45, 1]),
  boldOff: Buffer.from([ESC, 0x45, 0]),
  center: Buffer.from([ESC, 0x61, 1]),
  left: Buffer.from([ESC, 0x61, 0]),
  big: Buffer.from([GS, 0x21, 0x11]),
  tall: Buffer.from([GS, 0x21, 0x01]),
  normal: Buffer.from([GS, 0x21, 0x00]),
  cut: Buffer.from([0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00]),
  drawer: Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]),
};

// Basit belge modeli: [{t:'text', v, align, bold, size}] veya {t:'line'} ya da {t:'cmd', v:Buffer}
export function build(doc) {
  const parts = [CMD.init];
  for (const d of doc) {
    if (d.t === 'cmd') { parts.push(d.v); continue; }
    if (d.t === 'line') { parts.push(encode(d.v + '\n')); continue; }
    parts.push(d.align === 'center' ? CMD.center : CMD.left);
    parts.push(d.size === 'big' ? CMD.big : d.size === 'tall' ? CMD.tall : CMD.normal);
    if (d.bold) parts.push(CMD.boldOn);
    parts.push(encode(d.v + '\n'));
    if (d.bold) parts.push(CMD.boldOff);
  }
  parts.push(CMD.normal, CMD.left, CMD.cut);
  return Buffer.concat(parts);
}

export function sendRaw(address, buffer) {
  return new Promise((resolve, reject) => {
    const [host, port] = String(address).trim().split(':');
    const sock = net.createConnection({ host, port: Number(port) || 9100 });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('Yazıcı zaman aşımı: ' + address)); }, 5000);
    sock.on('connect', () => sock.end(buffer));
    sock.on('close', () => { clearTimeout(timer); resolve(); });
    sock.on('error', (e) => { clearTimeout(timer); reject(new Error('Yazıcıya bağlanılamadı (' + address + '): ' + e.message)); });
  });
}

export const pad = (l, r, w) => {
  l = String(l); r = String(r);
  const space = w - l.length - r.length;
  if (space >= 1) return l + ' '.repeat(space) + r;
  return l.slice(0, Math.max(0, w - r.length - 1)) + ' ' + r;
};
