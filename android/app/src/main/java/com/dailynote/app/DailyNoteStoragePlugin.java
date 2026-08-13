package com.dailynote.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 存储访问权限桥。
 *
 * DailyNote 的数据文件存放在公共 Documents 目录（卸载不丢数据）。
 * Android 11+ 的沙盒存储会拒绝应用对公共目录的直接读写，必须由用户
 * 在系统设置中授予「所有文件访问」（MANAGE_EXTERNAL_STORAGE）。
 * JS 侧在 initStore 前先查 storageAccessBlocked()，被阻塞时引导用户授权。
 */
@CapacitorPlugin(name = "DailyNoteStorage")
public class DailyNoteStoragePlugin extends Plugin {

    /** 返回 { apiLevel, manager }：manager = 是否已授予「所有文件访问」 */
    @PluginMethod
    public void getStorageStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("apiLevel", Build.VERSION.SDK_INT);
        ret.put("manager", hasAllFilesAccess());
        call.resolve(ret);
    }

    /**
     * 请求「所有文件访问」：已授予直接返回 true；否则跳转系统设置页
     * （优先 App 专属页，部分 ROM 缺失时回退到总开关页）。
     * 用户返回后由 JS 侧重新调用 getStorageStatus 检测。
     */
    @PluginMethod
    public void requestAllFilesAccess(PluginCall call) {
        JSObject ret = new JSObject();
        if (hasAllFilesAccess()) {
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                getContext().startActivity(intent);
            } catch (Exception e) {
                try {
                    getContext().startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                } catch (Exception ignored) {
                    // 无可用设置页，保持未授权状态
                }
            }
        }
        ret.put("granted", false);
        call.resolve(ret);
    }

    private boolean hasAllFilesAccess() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager();
    }
}
