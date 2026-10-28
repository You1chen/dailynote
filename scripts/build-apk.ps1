# DailyNote APK Build Script (PowerShell)
# Usage: .\scripts\build-apk.ps1            -> Full build (web + sync + APK)
#        .\scripts\build-apk.ps1 -SyncOnly  -> Web build + sync only (no APK)
#        npm run build:apk
#        npm run build:android

param (
    [switch] $SyncOnly
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AndroidDir = Join-Path $ProjectRoot "android"

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
Write-Host "[3/4] Capacitor sync..." -ForegroundColor Yellow
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
        & .\gradlew.bat --no-daemon assembleDebug
        if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }
    }
    finally {
        Pop-Location
    }
    Write-Host "      DONE" -ForegroundColor Green
    Write-Host ""

    $apkPath = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
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
