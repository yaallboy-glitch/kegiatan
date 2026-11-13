#!/usr/bin/env bash
# publish.sh — taruh APK hasil build di repo root supaya ikut tampil di web (GitHub Pages).
# Pakai: bash publish.sh   (APK diambil dari dist/bms.apk milik folder build)
set -euo pipefail
cd "$(dirname "$0")"

APK_SRC="D:/hermes/projects/bms-kegiatan/dist/bms.apk"
MANIFEST="D:/hermes/projects/bms-kegiatan/native/AndroidManifest.xml"

[ -f "$APK_SRC" ] || { echo "APK belum ada: $APK_SRC"; exit 1; }

VC=$(grep -o 'versionCode="[0-9]*"' "$MANIFEST" | grep -o '[0-9]*')
VN=$(grep -o 'versionName="[0-9.]*"' "$MANIFEST" | grep -o '[0-9.]*')
SIZE=$(stat -c %s "$APK_SRC")
SHA=$(sha256sum "$APK_SRC" | cut -c1-16)

cp -f "$APK_SRC" bms.apk

cat > apk.json <<EOF
{
  "versionCode": $VC,
  "versionName": "$VN",
  "file": "bms.apk",
  "size": $SIZE,
  "sha256": "$SHA",
  "buildDate": "$(date +%Y-%m-%d)"
}
EOF

echo "bms.apk v$VN ($(numfmt --to=iec $SIZE 2>/dev/null || echo $SIZE bytes))"
cat apk.json
