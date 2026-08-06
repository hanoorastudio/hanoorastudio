# hanoorastudio.com

Landing page Hanoora Studio — satu halaman statis, tanpa proses build.

Repo: https://github.com/rifkimuh84-code/hanoora-website
Live: https://hanoorastudio.com

## Struktur

```
index.html          seluruh halaman (HTML + CSS + JS jadi satu file)
web/logo/           logo, versi putih, favicon
web/img/            18 foto portofolio (sudah dikompres)
web/video/          8 video portofolio + poster masing-masing
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

## Cara mengubah isi

Semua yang sering diganti ada di satu tempat, di bagian `KONFIGURASI`
dekat awal blok `<script>` dalam `index.html`:

- `WA_NUMBER` — nomor WhatsApp
- `IG_URL`, `TIKTOK_URL`, `LINKEDIN_URL` — tautan sosial media
- `EMAIL` — alamat email
- `PRICES` — harga tiap paket (Rupiah & USD)
- `WORKS` — daftar karya portofolio beserta warna aksennya
- `I18N` — seluruh teks dalam Bahasa Indonesia & Inggris

Setelah diubah, commit dan push. Cloudflare Pages otomatis menerbitkan ulang.
