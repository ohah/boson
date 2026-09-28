package dev.spinon.bootstrap;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.Log;
import android.util.DisplayMetrics;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String TAG = "SpinonBootstrap";

    static {
        System.loadLibrary("spinon_bootstrap");
    }

    private static native byte[] nativeRun(byte[] sourceUtf8, float width, float height,
                                           float density, boolean runR10);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            String source = readAsset("app.js");
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            boolean runR10 = getIntent().getBooleanExtra("spinon_r10", false);
            byte[] outputUtf8 = nativeRun(
                    source.getBytes(StandardCharsets.UTF_8),
                    metrics.widthPixels / metrics.density,
                    metrics.heightPixels / metrics.density,
                    metrics.density,
                    runR10);
            String output = outputUtf8 == null
                    ? "native bridge returned no result"
                    : new String(outputUtf8, StandardCharsets.UTF_8);
            Log.i(TAG, "SPINON_BOOTSTRAP_RESULT=" + output);
            if (runR10) {
                showR10Report(output, metrics.density);
            }
        } catch (IOException error) {
            Log.e(TAG, "SPINON_BOOTSTRAP_ASSET_ERROR", error);
        } catch (RuntimeException error) {
            Log.e(TAG, "SPINON_BOOTSTRAP_RUNTIME_ERROR", error);
        }
    }

    private String readAsset(String name) throws IOException {
        try (InputStream input = getAssets().open(name);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void showR10Report(String report, float density) {
        TextView text = new TextView(this);
        text.setText("SPINON · R10 TAFFY 실험\n\nAndroid 에뮬레이터 · 개발 전용\n\n" + report);
        text.setTextColor(Color.rgb(230, 237, 248));
        text.setTextSize(12);
        text.setTypeface(Typeface.MONOSPACE);
        text.setTextIsSelectable(true);
        int inset = Math.round(18 * density);
        text.setPadding(inset, Math.round(24 * density), inset, Math.round(24 * density));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(14, 19, 31));
        scroll.addView(text);
        setContentView(scroll);
    }
}
