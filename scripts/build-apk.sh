#!/usr/bin/env bash
# 记 Android build for macOS/Linux.
# Usage: bash scripts/build-apk.sh [--release]
# Requires JAVA_HOME (JDK 17) and an Android SDK (compileSdk 36).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TYPE=debug
TASK=assembleDebug
if [ "${1:-}" = "--release" ]; then
  if [[ ! -f android/keystore.properties ]]; then
    echo 'A release build requires android/keystore.properties with your signing configuration.' >&2
    exit 1
  fi
  TYPE=release
  TASK=assembleRelease
fi

export CAPACITOR=true
npx tsc --noEmit
npx vite build
npx cap sync android
./android/gradlew -p android --no-daemon "$TASK"

APK="android/app/build/outputs/apk/$TYPE/记.apk"
if [ ! -f "$APK" ]; then
  echo "APK not found: $APK" >&2
  exit 1
fi
echo "APK: $APK"
