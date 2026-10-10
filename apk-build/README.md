# BMS — APK build & pengembangan

App Android (WebView) untuk "Brigade Muda Soropati — Karang Taruna".
Web UI (HTML/CSS/JS) dibungkus APK via WebView + login Google (Chrome Custom Tab + PKCE).

## Struktur
```
app-baru/                 <- SATU sumber web (edit di sini)
  index.html, app.js, style.css, auth-cb.html, bendahara.html,
  file.html, footage.html, anggota.html, manifest.webmanifest, IMG_6411.png
  worker.js               <- BACKEND Cloudflare Worker (deploy terpisah)

apk-build/
  src/AndroidManifest.xml
  src/java/id/karangtaruna/bms/MainActivity.java   (WebView + OAuth native)
  src/res/mipmap-*/ic_launcher.png
  toolchain/android.jar   (Android SDK platform 35; JANGAN hapus)
  keystore/bms.keystore   (KUNCI tanda tangan aktif)
  keystore/LEGACY-v10-12-keystore.jks  (lama, tidak dipakai)
  assets/                 AUTO-GENERATE oleh build.sh (jangan edit manual)
  out/                    AUTO-GENERATE; hasil akhir bms.apk
  build.sh                SATU perintah build
  README.md               (file ini)
```

## Build / patch tampilan / tambah fungsi
Edit file di `../` (web) atau `src/` (native), lalu:
```
bash apk-build/build.sh
```
Hasil: `~/storage/shared/Download/bms.apk` (install timpa; TIDAK perlu uninstall
karena keystore sama). Naikkan versi: edit `src/AndroidManifest.xml`
(versionCode / versionName).

## Login Google (alur)
1. Tap login -> MainActivity buka Chrome (Custom Tab) URL OAuth (response_type=code + PKCE).
2. Pilih akun -> Google redirect ke skema:
   `com.googleusercontent.apps.358445361659-0in11rvmojoo00s4b0c92juegv8ra6iq:/oauth2redirect?code=...`
3. intent-filter menangkap skema -> MainActivity tukar code->id_token (native, tanpa CORS).
4. id_token dikirim ke backend `POST /auth/google`.

### Prinsip penting
- Client ID (PUBLIK, bukan rahasia):
  - Web     : `358445361659-e0a67dcf6dakkf6ak74a0kuu9v49a07v.apps.googleusercontent.com` (versi browser)
  - Android : `358445361659-0in11rvmojoo00s4b0c92juegv8ra6iq.apps.googleusercontent.com` (APK, ada di MainActivity.java)
- Google Console -> OAuth client Android WAJIB mengaktifkan **"Enable Custom URI Scheme"**
  (Advanced Settings). Kalau mati -> error "Custom URI scheme is not enabled".
- Authorized JavaScript origins (Web client): `https://appassets.androidplatform.net`
- Keystore aktif: `keystore/bms.keystore` alias=`bms` password=`android` (CN=BMS Karang Taruna).
- Backend `worker.js`: env `GOOGLE_LOGIN_CLIENT_ID` harus memuat KEDUA Client ID
  (dipisah koma) agar versi browser + APK dua-duanya bisa login.

## Backend (worker.js)
Deploy manual ke Cloudflare (Workers & Pages -> kegiatan-api -> Edit code -> paste worker.js -> Deploy).
Rahasia (set sebagai Secret): `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `TOKEN_SECRET`,
`GOOGLE_FOLDER_FILES`, `GOOGLE_FOLDER_FOOTAGE`. `GOOGLE_LOGIN_CLIENT_ID` boleh teks biasa.

## Tool (Termux)
aapt2, d8, apksigner, javac (openjdk-17), keytool, zip — sudah terpasang.
`toolchain/android.jar` sudah ada (jangan unduh ulang).
