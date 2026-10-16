import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'garson', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sections(id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tables(id INTEGER PRIMARY KEY, section_id INTEGER NOT NULL, name TEXT NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, category_id INTEGER, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0,
  sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1, kitchen INTEGER DEFAULT 1, ask_price INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', address TEXT DEFAULT '',
  note TEXT DEFAULT '', created_at INTEGER);
CREATE TABLE IF NOT EXISTS customer_tx(id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL, method TEXT DEFAULT '', note TEXT DEFAULT '',
  order_id INTEGER, payment_id INTEGER, created_at INTEGER, user_id INTEGER);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, type TEXT NOT NULL DEFAULT 'masa', table_id INTEGER, name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', opened_at INTEGER, closed_at INTEGER, last_order_at INTEGER, guests INTEGER DEFAULT 0,
  customer_id INTEGER, user_id INTEGER, discount_type TEXT DEFAULT '', discount_value REAL DEFAULT 0, note TEXT DEFAULT '',
  delivery_status TEXT DEFAULT '', alarm_at INTEGER, cancel_reason TEXT DEFAULT '', total REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER, category_id INTEGER,
  name TEXT, qty REAL, unit_price REAL, free INTEGER DEFAULT 0, note TEXT DEFAULT '', user_id INTEGER, created_at INTEGER,
  status TEXT DEFAULT 'active', cancel_reason TEXT DEFAULT '', kitchen_status TEXT DEFAULT 'none', kitchen_at INTEGER);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, order_id INTEGER, method TEXT, amount REAL, created_at INTEGER,
  user_id INTEGER, cancelled INTEGER DEFAULT 0, cancelled_at INTEGER, cancel_user_id INTEGER);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY, description TEXT, amount REAL, created_at INTEGER, user_id INTEGER);
CREATE TABLE IF NOT EXISTS day_closings(id INTEGER PRIMARY KEY, period_start INTEGER, closed_at INTEGER, user_id INTEGER, summary TEXT);
CREATE TABLE IF NOT EXISTS printers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT DEFAULT '', active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY, at INTEGER, user_id INTEGER, action TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS ix_orders_closed ON orders(closed_at);
CREATE INDEX IF NOT EXISTS ix_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_items_kitchen ON order_items(kitchen_status);
CREATE INDEX IF NOT EXISTS ix_pay_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS ix_pay_created ON payments(created_at);
`;

export const DEFAULT_SETTINGS = {
  restaurant_name: 'KEBAPÇI YALÇIN',
  theme: 'dark',
  address: '',
  phone: '',
  receipt_footer: 'Afiyet olsun, yine bekleriz!',
  table_cols: '9',
  product_cols: '5',
  go_tables_after_save: '1',
  table_click_to_sales: '1',
  long_wait_minutes: '45',
  print_receipt_after_payment: '0',
  kitchen_ticket: '1',
  receipt_printer: '',
  kitchen_printer: '',
  printer_width: '42',
  sms_enabled: '0',
  sms_url: '',
  sms_template_paket: 'Sayın {ad}, siparişiniz yola çıktı. Afiyet olsun! - {restoran}',
  quick_notes: 'Acılı,Acısız,Soğansız,Az pişmiş,Çok pişmiş,Paket,Yanına ayran,Lavaş ayrı',
  cancel_reasons: 'Müşteri vazgeçti,Yanlış sipariş,Ürün bitti,Gecikme,İkram,Diğer',
  expense_presets: 'Market,Ekmek,Tüp,Personel avansı,Fatura,Kurye',
};

const SEED_CATEGORIES = {
  'Dürümler': [['Adana Dürüm', 450], ['Urfa Dürüm', 450], ['Kuşbaşı Dürüm', 520], ['Ciğer Dürüm', 450], ['Beyti Dürüm', 480],
    ['Tavuk Dürüm', 350], ['Lahmacun Dürüm', 200], ['Kavurma Dürüm', 520]],
  'Porsiyon': [['Adana pors.', 690], ['Urfa pors.', 690], ['Haşhaş pors.', 690], ['Soğan Kebabı', 710], ['Beyti Kebap', 710],
    ['Altıezmeli Kuşbaşı', 775], ['Altıezmeli Kıyma', 710], ['Altıezmeli Karışık', 720], ['Ali Nazik Kuşbaşı', 760], ['Ali Nazik Kıyma', 710],
    ['İçli Köfte', 95], ['Fındık Lahmacun', 85], ['Löp pors.', 790], ['Bülbül pors.', 730], ['Tava Küşleme', 750],
    ['Çıtır Lahmacun', 180], ['Kuşbaşı pors.', 740], ['Küşleme pors.', 740], ['Et Pirzola', 710], ['Maraş pors.', 690],
    ['Ciğer pors.', 670], ['Yaprak Alinazik', 765], ['Yürek pors.', 670], ['Kavurma pors.', 320], ['Tavuk Sarma pors.', 450],
    ['Kanat pors.', 500], ['Patlıcan Kebap', 690], ['Domatesli Kebap', 710], ['Kara Kavurma', 740], ['Gurme Tava', 760],
    ['Beyaz Et', 790], ['Tandır', 740], ['PAKET OLACAK !!!', 0], ['AYNI TABAK !!!', 0], ['Külbastı', 750],
    ['Alinazik Karışık', 730], ['Kesik Kavurma', 80], ['1 KİŞİLİK KARIŞIK', 750], ['2+1 KARIŞIK', 1850], ['Tike Ciğer Pors.', 670],
    ['Yağlı Kara Pors.', 770], ['2 TABAK !!', 0], ['İkram kavurma', 0], ['fix menu 2', 0]],
  'Ara Sıcak': [['Mercimek Çorbası', 120], ['Ezogelin Çorbası', 120], ['İçli Köfte (Adet)', 95], ['Humus', 150], ['Çiğ Köfte', 100],
    ['Acılı Ezme', 90], ['Haydari', 120], ['Babagannuş', 150], ['Sigara Böreği', 150], ['Çoban Salata', 120]],
  'İçecekler': [['Ayran', 50], ['Yayık Ayran', 70], ['Şalgam', 60], ['Kola', 70], ['Fanta', 70], ['Sprite', 70], ['Su', 25],
    ['Soda', 40], ['Çay', 25], ['Türk Kahvesi', 80], ['Limonata', 90], ['Meyve Suyu', 70]],
  'Fırın': [['Lahmacun', 120], ['Kıymalı Pide', 350], ['Kuşbaşılı Pide', 420], ['Kaşarlı Pide', 300], ['Karışık Pide', 400], ['Lavaş', 0]],
  'Tatlılar': [['Künefe', 220], ['Katmer', 250], ['Baklava (Porsiyon)', 250], ['Sütlaç', 120], ['Kadayıf', 200], ['Dondurma', 100]],
  'Special': [['Special Karışık Tabak', 1200], ['Karışık Izgara (2 Kişilik)', 1500], ['Kebap Tabağı (4 Kişilik)', 2800]],
  'Joker': [['Joker Ürün', 0, 1], ['Joker İçecek', 0, 1]],
};
const NON_KITCHEN = new Set(['İçecekler']);

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  migrate(db);
  if (!db.prepare('SELECT COUNT(*) n FROM users').get().n) seed(db);
  seedPrinters(db);
  return db;
}

function migrate(db) {
  const addCol = (table, col, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addCol('categories', 'printer_id', 'INTEGER');  // kategorinin varsayılan yazıcısı (NULL = yazdırma)
  addCol('products', 'printer_id', 'INTEGER');    // NULL = kategori yazıcısı, 0 = yazdırma
  addCol('order_items', 'seat', 'INTEGER DEFAULT 0'); // hesap bölmede kişi no (0 = ortak)
  addCol('payments', 'seat', 'INTEGER DEFAULT 0');
  addCol('orders', 'split_count', 'INTEGER DEFAULT 0');
}

// İlk çalıştırmada Mutfak ve İçecek yazıcılarını oluşturur, kategorileri bunlara bağlar
function seedPrinters(db) {
  if (db.prepare('SELECT COUNT(*) n FROM printers').get().n) return;
  const old = db.prepare("SELECT value FROM settings WHERE key='kitchen_printer'").get()?.value || '';
  const ins = db.prepare('INSERT INTO printers(name,address) VALUES(?,?)');
  const mutfak = ins.run('Mutfak', old).lastInsertRowid;
  const icecek = ins.run('İçecek', '').lastInsertRowid;
  db.prepare("UPDATE categories SET printer_id=CASE WHEN name='İçecekler' THEN ? ELSE ? END WHERE printer_id IS NULL").run(icecek, mutfak);
}

function seed(db) {
  db.exec('BEGIN');
  const u = db.prepare('INSERT INTO users(name,pin,role) VALUES(?,?,?)');
  u.run('Yönetici', '1234', 'admin');
  u.run('Kasiyer', '1111', 'kasiyer');
  u.run('Garson 1', '2222', 'garson');

  const s = db.prepare('INSERT INTO sections(name,sort) VALUES(?,?)');
  const t = db.prepare('INSERT INTO tables(section_id,name,sort) VALUES(?,?,?)');
  const salon = s.run('Salon', 1).lastInsertRowid;
  for (let i = 1; i <= 72; i++) t.run(salon, String(i), i);
  const bahce = s.run('Bahçe', 2).lastInsertRowid;
  for (let i = 1; i <= 18; i++) t.run(bahce, 'B' + i, i);

  const c = db.prepare('INSERT INTO categories(name,sort) VALUES(?,?)');
  const p = db.prepare('INSERT INTO products(category_id,name,price,sort,kitchen,ask_price) VALUES(?,?,?,?,?,?)');
  let ci = 0;
  for (const [cat, items] of Object.entries(SEED_CATEGORIES)) {
    const cid = c.run(cat, ++ci).lastInsertRowid;
    items.forEach(([name, price, ask], i) => p.run(cid, name, price, i + 1, NON_KITCHEN.has(cat) ? 0 : 1, ask ? 1 : 0));
  }
  db.exec('COMMIT');
}
