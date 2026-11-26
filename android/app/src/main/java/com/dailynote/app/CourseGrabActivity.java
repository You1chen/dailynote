package com.dailynote.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONArray;

/**
 * 应用内课程网站浏览器。登录并打开课表页后，用户点「读取本页」，
 * 当前文档的 outerHTML 会随 Intent 返回给 CourseGrabPlugin。
 */
public class CourseGrabActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "course_url";
    public static final String EXTRA_HTML = "course_html";

    private static final String DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

    private WebView webView;
    private TextView hint;
    private Button readButton;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setStatusBarColor(Color.parseColor("#111113"));
        getWindow().setNavigationBarColor(Color.WHITE);

        String url = getIntent().getStringExtra(EXTRA_URL);
        if (url == null || url.isEmpty()) {
            finish();
            return;
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(10), dp(10), dp(10));
        bar.setBackgroundColor(Color.parseColor("#111113"));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView title = new TextView(this);
        title.setText("读取课程表");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        hint = new TextView(this);
        hint.setText("登录后打开课表页，再点右侧按钮");
        hint.setTextColor(Color.parseColor("#A1A1A6"));
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        hint.setMaxLines(1);
        hint.setEllipsize(TextUtils.TruncateAt.END);
        titles.addView(title);
        titles.addView(hint);
        bar.addView(titles);

        Button close = new Button(this);
        close.setText("关闭");
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        close.setAllCaps(false);
        close.setTextColor(Color.parseColor("#A1A1A6"));
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setOnClickListener(v -> finish());
        bar.addView(close);

        readButton = new Button(this);
        readButton.setText("读取本页");
        readButton.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        readButton.setAllCaps(false);
        readButton.setTextColor(Color.WHITE);
        readButton.setPadding(dp(14), dp(6), dp(14), dp(6));
        readButton.setBackground(rounded(Color.parseColor("#0A84FF"), dp(18)));
        readButton.setOnClickListener(v -> capturePage());
        LinearLayout.LayoutParams readParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        readParams.leftMargin = dp(6);
        bar.addView(readButton, readParams);

        webView = new WebView(this);
        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        webView.setLayoutParams(webParams);
        configureWebView();

        root.addView(bar);
        root.addView(webView);
        setContentView(root);

        // Android 15+ draws edge-to-edge; keep the toolbar and WebView inside
        // the system bars just like MainActivity does for the main WebView.
        if (Build.VERSION.SDK_INT >= 35) {
            ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return windowInsets;
            });
            ViewCompat.requestApplyInsets(root);
        }

        webView.loadUrl(url);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(DESKTOP_UA);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                hint.setText("页面已加载。登录并打开课表后，点「读取本页」");
            }
        });
    }

    private void capturePage() {
        if (webView == null) return;
        readButton.setEnabled(false);
        readButton.setText("读取中…");
        webView.evaluateJavascript(
            "(function(){try{return document.documentElement.outerHTML;}catch(e){return '';}})()",
            value -> {
                String html = null;
                try {
                    html = new JSONArray("[" + value + "]").optString(0);
                } catch (Exception ignored) {
                    // value may already be a plain string on some WebView builds
                    html = value;
                }
                if (html == null || html.length() < 120) {
                    readButton.setEnabled(true);
                    readButton.setText("读取本页");
                    Toast.makeText(this, "没有读到页面内容，请等课表加载完再试", Toast.LENGTH_SHORT).show();
                    return;
                }
                Intent data = new Intent();
                data.putExtra(EXTRA_HTML, html);
                setResult(RESULT_OK, data);
                finish();
            }
        );
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        CookieManager.getInstance().flush();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(radius);
        return shape;
    }
}
