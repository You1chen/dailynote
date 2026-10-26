package com.dailynote.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

/**
 * 中文文字识别（ML Kit，模型随包分发，离线可用）。
 * 入参 base64 可以是 data URL（自动去掉前缀），返回整段文本 + 逐行文本与 top 坐标。
 */
@CapacitorPlugin(name = "MlkitOcr")
public class MlkitOcrPlugin extends Plugin {

    private static final int MAX_DIM = 1600;

    @PluginMethod
    public void recognize(PluginCall call) {
        String raw = call.getString("base64", "");
        if (raw == null || raw.isEmpty()) {
            call.reject("缺少图片数据");
            return;
        }

        Bitmap bitmap;
        try {
            String payload = raw;
            int comma = payload.indexOf(',');
            if (payload.startsWith("data:") && comma > 0) payload = payload.substring(comma + 1);
            byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) {
            call.reject("图片解码失败");
            return;
        }
        if (bitmap == null) {
            call.reject("图片解码失败");
            return;
        }

        // 大图先缩到 1600px 内，识别更快也更稳
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        int max = Math.max(w, h);
        if (max > MAX_DIM) {
            float scale = MAX_DIM / (float) max;
            bitmap = Bitmap.createScaledBitmap(bitmap, Math.round(w * scale), Math.round(h * scale), true);
        }

        TextRecognizer recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        InputImage image = InputImage.fromBitmap(bitmap, 0);

        recognizer.process(image)
            .addOnSuccessListener(visionText -> {
                JSObject ret = new JSObject();
                ret.put("text", visionText.getText());

                JSArray lines = new JSArray();
                for (Text.TextBlock block : visionText.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        JSObject item = new JSObject();
                        item.put("text", line.getText());
                        item.put("top", line.getBoundingBox() != null ? line.getBoundingBox().top : 0);
                        lines.put(item);
                    }
                }
                ret.put("lines", lines);
                call.resolve(ret);
            })
            .addOnFailureListener(e -> call.reject(e.getMessage() == null ? "识别失败" : e.getMessage()))
            .addOnCompleteListener(task -> recognizer.close());
    }
}
