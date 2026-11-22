package com.dailynote.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 应用内更新桥：扫描存储目录里的 APK，校验包名与签名后交给系统安装器覆盖安装。
 *
 * 只有与当前应用同包名、同签名的 APK 才会被放行；不同签名无法覆盖安装（Android 限制）。
 * 覆盖安装由系统 PackageInstaller 完成，保留应用数据与公共 Documents 目录。
 */
@CapacitorPlugin(name = "ApkUpdate")
public class ApkUpdatePlugin extends Plugin {

    private static final String PACKAGE_NAME = "com.dailynote.app";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final int MAX_FILES_PER_DIR = 20;

    /** 当前安装版本与签名。 */
    @PluginMethod
    public void installedInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(PACKAGE_NAME, signFlags());
            JSObject ret = new JSObject();
            ret.put("packageName", PACKAGE_NAME);
            ret.put("versionCode", longVersionCode(info));
            ret.put("versionName", info.versionName == null ? "" : info.versionName);
            ret.put("signerSha256", signerSha256(info));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取当前版本失败: " + e.getMessage());
        }
    }

    /** 是否已允许本应用安装未知来源应用。 */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", installAllowed());
        call.resolve(ret);
    }

    /**
     * 扫描目录里的 APK（不递归），返回包名、版本与签名摘要。
     * dirs 用逻辑路径：Documents/DailyNote、Documents、Download。
     */
    @PluginMethod
    public void scan(PluginCall call) {
        JSArray dirs = call.getArray("dirs");
        final List<String> logicalDirs = new ArrayList<>();
        if (dirs != null) {
            for (int i = 0; i < dirs.length(); i++) {
                String value = dirs.isNull(i) ? null : dirs.optString(i);
                if (value != null && !value.isEmpty()) logicalDirs.add(value);
            }
        }
        if (logicalDirs.isEmpty()) logicalDirs.add("Documents/DailyNote");

        new Thread(() -> {
            try {
                PackageInfo installed = getContext().getPackageManager().getPackageInfo(PACKAGE_NAME, signFlags());
                String installedSha = signerSha256(installed);
                Set<String> seen = new HashSet<>();
                List<JSObject> found = new ArrayList<>();

                for (String logical : logicalDirs) {
                    File dir = resolvePath(logical);
                    File[] files = dir.isDirectory() ? dir.listFiles() : null;
                    if (files == null) continue;
                    Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
                    int count = 0;
                    for (File file : files) {
                        if (count >= MAX_FILES_PER_DIR || found.size() >= MAX_FILES_PER_DIR * 2) break;
                        if (file == null || !file.isFile()) continue;
                        if (!file.getName().toLowerCase(Locale.US).endsWith(".apk")) continue;
                        if (!seen.add(file.getAbsolutePath())) continue;
                        PackageInfo archive;
                        try {
                            archive = getContext().getPackageManager()
                                .getPackageArchiveInfo(file.getAbsolutePath(), signFlags());
                        } catch (Exception e) {
                            archive = null;
                        }
                        if (archive == null) continue;
                        count++;
                        String sha = signerSha256(archive);
                        JSObject item = new JSObject();
                        item.put("path", file.getAbsolutePath());
                        item.put("name", file.getName());
                        item.put("size", file.length());
                        item.put("modified", file.lastModified());
                        item.put("packageName", archive.packageName == null ? "" : archive.packageName);
                        item.put("versionCode", longVersionCode(archive));
                        item.put("versionName", archive.versionName == null ? "" : archive.versionName);
                        item.put("signerSha256", sha);
                        item.put("samePackage", PACKAGE_NAME.equals(archive.packageName));
                        item.put("sameSignature", !sha.isEmpty() && sha.equals(installedSha));
                        found.add(item);
                    }
                }

                JSArray arr = new JSArray();
                for (JSObject item : found) arr.put(item);
                JSObject ret = new JSObject();
                ret.put("files", arr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("扫描安装包失败: " + e.getMessage());
            }
        }).start();
    }

    /**
     * 把 APK 复制到应用缓存，通过 FileProvider 交给系统安装器。
     * 覆盖安装是否成功由系统决定：同包名同签名会原地更新并保留数据。
     */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("缺少安装包路径");
            return;
        }
        if (!installAllowed()) {
            call.reject("请先允许 DailyNote 安装未知应用");
            return;
        }
        File source = resolvePath(path);
        if (!source.isFile() || !source.getName().toLowerCase(Locale.US).endsWith(".apk")) {
            call.reject("找不到安装包");
            return;
        }
        try {
            PackageInfo archive = getContext().getPackageManager()
                .getPackageArchiveInfo(source.getAbsolutePath(), signFlags());
            PackageInfo installed = getContext().getPackageManager().getPackageInfo(PACKAGE_NAME, signFlags());
            if (archive == null
                || !PACKAGE_NAME.equals(archive.packageName)
                || signerSha256(archive).isEmpty()
                || !signerSha256(archive).equals(signerSha256(installed))) {
                call.reject("包名或签名与当前应用不一致，无法覆盖安装");
                return;
            }

            File cacheDir = new File(getContext().getCacheDir(), "updates");
            if (!cacheDir.exists() && !cacheDir.mkdirs()) {
                call.reject("无法准备安装缓存");
                return;
            }
            File[] oldFiles = cacheDir.listFiles();
            if (oldFiles != null) {
                for (File old : oldFiles) old.delete();
            }
            File target = new File(cacheDir, "dailynote-update.apk");
            copy(source, target);

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                target
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            if (getActivity() == null) {
                call.reject("应用不在前台，无法打开安装器");
                return;
            }
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(intent);
                    JSObject ret = new JSObject();
                    ret.put("started", true);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("无法打开系统安装器: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            call.reject("准备安装失败: " + e.getMessage());
        }
    }

    /** 跳到系统「安装未知应用」权限页。 */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= 26) {
                intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + PACKAGE_NAME)
                );
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + PACKAGE_NAME)
                );
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception ignored) {
                call.reject("无法打开安装设置: " + e.getMessage());
            }
        }
    }

    // ============ 工具 ============

    private boolean installAllowed() {
        return Build.VERSION.SDK_INT < 26
            || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private int signFlags() {
        return Build.VERSION.SDK_INT >= 28
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
    }

    private long longVersionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    /** 取 APK 当前签名证书的 SHA-256（多个签名按字典序拼接）。 */
    private String signerSha256(PackageInfo info) {
        if (info == null) return "";
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            SigningInfo signingInfo = info.signingInfo;
            signatures = signingInfo == null ? null : signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length == 0) return "";
        List<String> hashes = new ArrayList<>();
        for (Signature signature : signatures) hashes.add(sha256(signature.toByteArray()));
        Collections.sort(hashes);
        StringBuilder builder = new StringBuilder();
        for (String hash : hashes) {
            if (builder.length() > 0) builder.append(',');
            builder.append(hash);
        }
        return builder.toString();
    }

    private String sha256(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] result = digest.digest(data);
            StringBuilder builder = new StringBuilder();
            for (byte value : result) builder.append(String.format(Locale.US, "%02x", value));
            return builder.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private File resolvePath(String logical) {
        String value = logical == null ? "" : logical.trim();
        if (value.startsWith("/")) return new File(value);

        File base = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
        String sub = value;
        if (value.startsWith("Documents/")) {
            sub = value.substring("Documents/".length());
        } else if (value.equals("Documents")) {
            sub = "";
        } else if (value.startsWith("Download/")) {
            base = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            sub = value.substring("Download/".length());
        } else if (value.equals("Download") || value.equals("Downloads")) {
            base = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            sub = "";
        }
        return sub.isEmpty() ? base : new File(base, sub);
    }

    private void copy(File source, File target) throws Exception {
        try (InputStream in = new FileInputStream(source);
             OutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }
}
