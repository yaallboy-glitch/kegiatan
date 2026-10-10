# CLINE-WORKFLOW

Panduan kerja repo `kegiatan`. Tidak menggantikan system/developer rules.

## Sebelum perubahan
1. Baca permintaan, status Git, file target, dan aturan lokal.
2. Jangan membaca atau mengubah secret.
3. Tetapkan scope; jangan menyentuh file lain tanpa alasan yang terverifikasi.
4. Untuk patch: baca file dulu, buat satu backup `.bak`, lalu patch presisi.
5. Untuk perubahan besar: pecah menjadi langkah kecil dan jangan menimpa perubahan repo secara buta.

## UI dan navigasi
1. `ensureNav()` membuat satu `.bottomNav` seawal mungkin.
2. `renderShell()` tidak membuat nav kedua.
3. `initGlassNav()` mengatur bubble dan lekukan; pertahankan `prefers-reduced-motion`.
4. Perubahan visual tidak boleh merusak kontras teks, keyboard focus, atau label ARIA.
5. Uji halaman `index`, `bendahara`, `file`, `footage`, dan `anggota`; pastikan satu `.bottomNav`.

## Verifikasi
- JavaScript: `node --check app.js`.
- Patch: `git diff --check`.
- Audit: `git diff --stat`, `git status --short`, dan cari duplikasi `.bottomNav`.
- Browser test bila tersedia: nav tanpa kedip, animasi sekitar 0,9 detik, menu Lainnya terbaca.
- Jika browser test tidak tersedia, laporkan sebagai belum diuji.

## Git
1. Review diff sebelum commit.
2. Commit atomik dengan pesan yang menjelaskan perubahan.
3. Push hanya setelah verifikasi lulus.
4. Laporkan path, bukti perintah, commit, dan keterbatasan test.

## Batasan
Jangan menambah dependency, mengubah HTML, atau menghapus backup sebelum verifikasi akhir kecuali diminta dan terbukti perlu.
