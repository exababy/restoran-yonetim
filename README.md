# Restoran Yönetim – Adisyon & Kasa (POS)

NetCHIEF Smart ekran düzeniyle aynı görünüme sahip, ancak daha gelişmiş bir restoran adisyon programı.
Kasa ekranı (Masa / Satış sekmeleri, masa ızgarası, 0,5–4 çarpanları, Kasiyer / Bedelsiz / ALARM, Müşteri Seç,
Yazdırma!, Vazgeç / Kaydet, Ödeme / Yazdır / Düzenle / Taşı / İndirim / İptal, Masa Açılış / Son Sipariş / Toplam / Ön Ödeme)
birebir aynı yerleşimdedir.

## Kurulum (Windows kasa bilgisayarı)

1. [Node.js](https://nodejs.org) **22 LTS** (22.13 veya üzeri) kurun. Başka hiçbir paket gerekmez (`npm install` gerekmez).
2. Bu klasörü bilgisayara kopyalayın (örn. `C:\RestoranPOS`).
3. `kurulum.bat` dosyasına sağ tıklayıp **Yönetici olarak çalıştır** – güvenlik duvarı izni ekler ve Windows açılışında otomatik başlatır.
4. `baslat.bat` ile programı açın. Chrome/Edge tam ekran (kiosk) ve **sessiz yazdırma** modunda açılır.

Varsayılan şifreler: **Yönetici 1234**, **Kasiyer 1111**, **Garson 2222** (Seçenekler › Kullanıcılar'dan değiştirin).

Veriler `data/restoran.db` dosyasında (SQLite) tutulur.

## Ekranlar

| Adres | Kullanım |
|---|---|
| `http://localhost:3000` | Kasa ekranı (dokunmatik) |
| `http://KASA-IP:3000/garson` | Garson el terminali (telefon / tablet) |
| `http://KASA-IP:3000/mutfak` | Mutfak ekranı (KDS) |

Tüm ekranlar **anlık senkronize** çalışır: garsonun girdiği sipariş kasada ve mutfakta anında görünür.

## Orijinal programa göre gelişmiş özellikler

- **Garson el terminali**: telefondan masa seç, ürün ekle, not yaz, gönder. Mutfak "hazır" deyince titreşim + ses.
- **Mutfak ekranı**: yeni siparişte sesli uyarı, gecikmeye göre renk (12 dk turuncu, 25 dk kırmızı), Hazırlanıyor / Hazır.
- **Bölünmüş ödeme**: Nakit, Kredi Kartı, Yemek Kartı, Cari/Veresiye; ürün seçerek ödeme, kişi başı, n'e böl, para üstü hesabı.
- **Cari hesap**: veresiye satış, müşteri bakiyesi, tahsilat alma, hesap hareketleri.
- **Paket servis**: müşteri adres/telefon, durum takibi (Hazırlanıyor › Yolda › Teslim), yolda olunca SMS (isteğe bağlı).
- **Çağrı Merkezi**: telefonla müşteri bul, geçmiş siparişleri gör, tek tuşla paket sipariş aç.
- **Masa durumları**: dolu (yeşil), kısmi ödeme, uzun bekleyen (sarı), alarmı çalan (yanıp söner), mutfakta 🍳 / hazır 🔔.
- **ALARM**: masa için X dakika sonra sesli hatırlatma. **SAAT**: tüm açık masaların süre özeti.
- **Taşı / Birleştir**: masanın tamamını veya sadece seçili ürünleri başka masaya taşıma, dolu masayla birleştirme.
- **İndirim** (% veya TL), **İkram (Bedelsiz)**, satır düzenleme, **kısmi iptal** (neden zorunlu, kayıt altında).
- **Ürün notları** (Acılı, Soğansız, …), adisyon notu, **Joker / fiyat sorulan ürün**.
- **Raporlar**: ciro, ödeme tipleri, saatlik ciro, kategori/ürün/personel satışları, iptaller, indirimler, kasa çıkışları,
  kasadaki nakit; Excel (CSV) ve fiş yazıcıdan çıktı.
- **Gün Sonu (Z raporu)**, **Kasa Çıkış** (gider), **Tahsilat İptal** (adisyonu yeniden açar), **İşlem Geçmişi** (log).
- **Toplu fiyat güncelleme** (% artış + 5/10 TL yuvarlama) – enflasyon dönemi için.
- **Yetki seviyeleri**: Yönetici / Kasiyer / Garson. PIN ile hızlı kullanıcı değiştirme (🔒).
- **Yazıcı**: ağ (Ethernet) termal yazıcılara doğrudan ESC/POS (Türkçe karakter destekli) + para çekmecesi açma;
  USB yazıcılarda Windows varsayılan yazıcısına sessiz yazdırma. Ayrı mutfak yazıcısı desteği.
- **Yedekleme**: tek tuşla veritabanı yedeği indirme.
- Klavye kısayolları: F2 Masa, F3 Satış, F9 Kaydet, F10 Ödeme, Esc Vazgeç.

## Geliştirme

```bash
npm start   # http://localhost:3000
npm test    # API testleri
```

Ortam değişkenleri: `PORT` (varsayılan 3000), `DB_FILE` (varsayılan `data/restoran.db`).
