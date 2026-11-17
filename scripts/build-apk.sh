#!/usr/bin/env bash
# DailyNote Android build for macOS/Linux.
# Windows: npm run build:apk
# Requires JAVA_HOME (JDK 17) and an Android SDK (compileSdk 36).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export CAPACITOR=true
npx tsc --noEmit
npx vite build
npx cap sync android
./android/gradlew -p android --no-daemon assembleDebug

APK="android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "APK not found: $APK" >&2
  exit 1
fi
echo "APK: $APK"
