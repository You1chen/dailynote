# DailyNote APK Build Script (PowerShell)
# Usage: .\scripts\build-apk.ps1            -> Full build (web + sync + APK)
#        .\scripts\build-apk.ps1 -SyncOnly  -> Web build + sync only (no APK)
#        .\scripts\build-apk.ps1 -Release   -> Signed release APK
#        npm run build:apk
#        npm run build:release
#        npm run build:android

param (
    [switch] $SyncOnly,
    [switch] $Release
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AndroidDir = Join-Path $ProjectRoot "android"
if ($Release -and -not $SyncOnly -and -not (Test-Path (Join-Path $AndroidDir 'keystore.properties') -PathType Leaf)) {
    throw 'A release build requires android/keystore.properties with your signing configuration.'
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DailyNote APK Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. TypeScript check
Write-Host "[1/4] TypeScript check..." -ForegroundColor Yellow
$env:CAPACITOR = "true"
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed" }
Write-Host "      PASS" -ForegroundColor Green

# 2. Vite build
Write-Host "[2/4] Vite build..." -ForegroundColor Yellow
npx vite build
if ($LASTEXITCODE -ne 0) { throw "Vite build failed" }
Write-Host "      DONE" -ForegroundColor Green

# 3. Capacitor sync
# Native Android uses ML Kit for OCR, so the ~10 MB browser Tesseract payload
# is unnecessary inside the APK. Keep it for the Web/PWA build only.
Write-Host "[3/4] Capacitor sync..." -ForegroundColor Yellow
Remove-Item -Recurse -Force (Join-Path $ProjectRoot 'dist\tesseract'), (Join-Path $ProjectRoot 'dist\tessdata') -ErrorAction SilentlyContinue
npx cap sync
if ($LASTEXITCODE -ne 0) { throw "Capacitor sync failed" }
Write-Host "      DONE" -ForegroundColor Green

# 4. Gradle APK build (skip if -SyncOnly)
if (-not $SyncOnly) {
    Write-Host "[4/4] Gradle APK build..." -ForegroundColor Yellow

    # Respect the caller's toolchain; Gradle also reads android/local.properties.
    if (-not $env:JAVA_HOME -and -not (Get-Command java -ErrorAction SilentlyContinue)) {
        throw "Set JAVA_HOME to a JDK installation or add java to PATH."
    }
    if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) {
        $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    }

    Push-Location $AndroidDir
    try {
        $gradleTask = if ($Release) { "assembleRelease" } else { "assembleDebug" }
        & .\gradlew.bat --no-daemon $gradleTask
        if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }
    }
    finally {
        Pop-Location
    }
    Write-Host "      DONE" -ForegroundColor Green
    Write-Host ""

    $buildType = if ($Release) { "release" } else { "debug" }
    $apkPath = Join-Path $AndroidDir "app\build\outputs\apk\$buildType\dailynote.apk"
    if (Test-Path $apkPath) {
        $size = (Get-Item $apkPath).Length / 1MB
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  BUILD SUCCESSFUL!" -ForegroundColor Green
        Write-Host "  APK: $apkPath" -ForegroundColor Green
        Write-Host "  Size: $([math]::Round($size, 1)) MB" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
    }
    else {
        throw "APK not found, check Gradle output"
    }
}
else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  WEB BUILD + SYNC SUCCESSFUL!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
}
