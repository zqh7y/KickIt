#!/usr/bin/env bash
# Collects the shippable files into release/: APK, AAB, source, upload key, store assets.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
rm -rf release && mkdir -p release
cp android/app/build/outputs/apk/release/app-release.apk "release/KickIt-$V.apk"
cp android/app/build/outputs/bundle/release/app-release.aab "release/KickIt-$V.aab"
zip -qr "release/KickIt-store-assets.zip" store
(cd android && zip -qr "../release/KickIt-upload-key.zip" keys keystore.properties)
zip -qr "release/KickIt-source.zip" . \
  -x 'node_modules/*' 'dist/*' 'dist-preview/*' 'preview/*' 'release/*' \
     'android/.gradle/*' 'android/build/*' 'android/app/build/*' 'android/capacitor-cordova-android-plugins/build/*' \
     'android/keys/*' 'android/keystore.properties' 'android/local.properties' \
     'android/app/src/main/assets/public/*' '*.DS_Store' '.gen-cache.json'
ls -la release
