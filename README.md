# hanoorastudio.com

Landing page Hanoora Studio — satu halaman statis, tanpa proses build.

Live: https://hanoorastudio.com

Versi berjalan: **v8 "Paper Emerald"** — base terang dengan aksen hijau brand.
Versi sebelumnya, v7 "Emerald Glass" (base gelap), tersimpan di riwayat git
pada commit `4ea0e7e` kalau sewaktu-waktu perlu dilihat lagi.

## Struktur

```
index.html          seluruh halaman (HTML + CSS + JS jadi satu file)
data/works.js       daftar portofolio & galeri foto
web/logo/           logo, versi putih, favicon
web/img/            18 foto portofolio (sudah dikompres)
web/video/          12 video portofolio + poster masing-masing
web/og-image.jpg    gambar pratinjau saat link dibagikan
_redirects          aturan fallback halaman
```

## Pengaturan Cloudflare Pages

| Kolom | Isi |
|---|---|
| Framework preset | None |
| Build command | *(kosongkan)* |
| Build output directory | `/` |
| Root directory | *(kosongkan)* |

Setiap push ke `main` langsung diterbitkan ulang. Tidak ada tahap staging.

## Cara mengubah isi

Semua yang sering diganti ada di satu tempat, di bagian `KONFIGURASI`
dekat awal blok `<script>` dalam `index.html`:

- `WA_NUMBER` — nomor WhatsApp
- `IG_URL`, `TIKTOK_URL`, `LINKEDIN_URL` — tautan sosial media
- `EMAIL` — alamat email
- `BRANDS` — nama brand yang berjalan di baris "Trusted by"
- `TIERS` — harga dan isi tiap paket
- `INCLUDED` — daftar "Included in every tier"
- `SERVICES`, `PROCESS`, `TESTI`, `FAQ` — isi tiap bagian halaman
- `WA_MSG` — pesan WhatsApp yang terisi otomatis per tombol

Portofolio tidak diedit di `index.html`. Buka `admin.html` di browser (file
lokal, tidak ikut di-commit), isi formnya, tekan "Download works.js", lalu
timpa `data/works.js`.

Setelah diubah, commit dan push. Cloudflare Pages otomatis menerbitkan ulang.

## Palet

Diambil langsung dari logo. Kalau warnanya diubah, logonya ikut diganti juga.

| Peran | Warna |
|---|---|
| Hijau utama | `#1E5E58` |
| Hijau tua | `#123B37` |
| Sage | `#9DBEB6` |
| Kertas | `#FBFAF7` |
| Kertas hangat | `#F4F1EA` |
| Tinta | `#0E2A27` |

Tipografi: **Instrument Serif** untuk judul, **Inter** untuk sisanya.

## Catatan teknis ###

- Situs berbahasa Inggris saja. `data/works.js` masih menyimpan teks `{en,id}`;
  halaman hanya membaca `.en` lewat helper `tr()`. Format `works.js` jangan
  diubah supaya `admin.html` tetap bisa dipakai.
- Scroll halus memakai Lenis dari unpkg. Jangan menambahkan
  `scroll-behavior:smooth` ke `html`/`body` — keduanya akan bertabrakan.
- Video portofolio memakai `preload="none"` dan baru diputar saat kursor
  menyentuh kartunya. Di layar sentuh pratinjau ini dimatikan supaya tidak
  menghabiskan kuota pengunjung.
- `MAX_WORKS = 12`. Karya ke-13 dan seterusnya di `works.js` diabaikan diam-diam
  oleh halaman.
- Meta Pixel aktif. Semua CTA WhatsApp/email menembakkan `Contact`; CTA hero,
  CTA penutup, dan tombol pilih paket juga menembakkan `Lead`.
