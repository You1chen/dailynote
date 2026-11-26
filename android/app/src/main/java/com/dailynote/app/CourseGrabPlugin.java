package com.dailynote.app;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 打开应用内浏览器让用户登录课程网站，再把当前页 HTML 交回网页层解析。
 * 网页层调用 CourseGrab.grab({ url })；Activity 返回 { html }。
 */
@CapacitorPlugin(name = "CourseGrab")
public class CourseGrabPlugin extends Plugin {

    @PluginMethod
    public void grab(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null) url = "";
        url = url.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            call.reject("请填写 http(s) 开头的课程表网址");
            return;
        }
        Intent intent = new Intent(getContext(), CourseGrabActivity.class);
        intent.putExtra(CourseGrabActivity.EXTRA_URL, url);
        startActivityForResult(call, intent, "onGrabResult");
    }

    @ActivityCallback
    private void onGrabResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            String html = result.getData().getStringExtra(CourseGrabActivity.EXTRA_HTML);
            if (html != null && !html.isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("html", html);
                call.resolve(ret);
                return;
            }
        }
        call.reject("没有读取到页面内容，请等课表加载完再试一次");
    }
}
