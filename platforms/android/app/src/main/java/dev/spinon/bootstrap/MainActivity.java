package dev.spinon.bootstrap;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String TAG = "SpinonBootstrap";

    static {
        System.loadLibrary("spinon_bootstrap");
    }

    private static native byte[] nativeRun(byte[] sourceUtf8);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            String source = readAsset("app.js");
            byte[] outputUtf8 = nativeRun(source.getBytes(StandardCharsets.UTF_8));
            String output = outputUtf8 == null
                    ? "native bridge returned no result"
                    : new String(outputUtf8, StandardCharsets.UTF_8);
            Log.i(TAG, "SPINON_BOOTSTRAP_RESULT=" + output);
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
}
