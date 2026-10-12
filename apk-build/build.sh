#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  BMS — build APK sekali perintah.  Edit source lalu: bash build.sh
#  Web source: ../  (index.html, app.js, style.css, *.html, IMG_6411.png)
#  Native:      src/ (AndroidManifest.xml, java/, res/)
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

SDK="toolchain/android.jar"
KS="keystore/bms.keystore"
KSALIAS="bms"
KSPASS="android"
MIN=29
TARGET=35
OUT="out"

echo "== 1/7 sync aset web (dari ../) =="
rm -rf assets && mkdir -p assets
cp ../index.html ../app.js ../style.css ../auth-cb.html \
   ../bendahara.html ../file.html ../footage.html ../anggota.html \
   ../manifest.webmanifest ../IMG_6411.png ../logo-800.webp assets/

echo "== 2/7 bersihkan out =="
rm -rf "$OUT" && mkdir -p "$OUT/classes"

echo "== 3/7 aapt2 compile+link =="
aapt2 compile --dir src/res -o "$OUT/res.zip"
aapt2 link -o "$OUT/base.apk" -I "$SDK" \
  --manifest src/AndroidManifest.xml -A assets \
  --min-sdk-version "$MIN" --target-sdk-version "$TARGET" "$OUT/res.zip"

echo "== 4/7 javac =="
javac -nowarn -source 8 -target 8 -bootclasspath "$SDK" -d "$OUT/classes" \
  src/java/id/karangtaruna/bms/MainActivity.java

echo "== 5/7 d8 =="
d8 --release --min-api "$MIN" --lib "$SDK" --output "$OUT/" $(find "$OUT/classes" -name '*.class')

echo "== 6/7 paket + sign =="
(cd "$OUT" && zip -q base.apk classes.dex)
apksigner sign --ks "$KS" --ks-key-alias "$KSALIAS" \
  --ks-pass pass:"$KSPASS" --key-pass pass:"$KSPASS" \
  --out "$OUT/bms.apk" "$OUT/base.apk"
apksigner verify "$OUT/bms.apk"

echo "== 7/7 deploy =="
cp "$OUT/bms.apk" "$HOME/storage/shared/Download/bms.apk"
echo "OK -> $HOME/storage/shared/Download/bms.apk"
aapt2 dump badging "$OUT/bms.apk" | grep -E "package:|versionName|launchable-activity"
