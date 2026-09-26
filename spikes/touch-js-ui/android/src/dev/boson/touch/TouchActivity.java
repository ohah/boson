package dev.boson.touch;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public final class TouchActivity extends Activity {
    static { System.loadLibrary("boson_touch"); }

    private TextView counter;
    private long runtime;

    private native long nativeCreate(String source);
    private native int nativeTap(long runtime);
    private native void nativeDestroy(long runtime);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        int width = (int) (260 * getResources().getDisplayMetrics().density);
        int labelHeight = (int) (72 * getResources().getDisplayMetrics().density);
        int buttonHeight = (int) (72 * getResources().getDisplayMetrics().density);

        counter = new TextView(this);
        counter.setText("Starting...");
        counter.setTextSize(32);
        counter.setGravity(Gravity.CENTER);
        counter.setContentDescription("boson-counter:Starting...");
        content.addView(counter, new LinearLayout.LayoutParams(width, labelHeight));

        Button button = new Button(this);
        button.setText("Tap");
        button.setAllCaps(false);
        button.setTextSize(24);
        button.setContentDescription("boson-touch-button");
        content.addView(button, new LinearLayout.LayoutParams(width, buttonHeight));
        setContentView(content);

        try {
            runtime = nativeCreate(readTouchSource());
        } catch (IOException error) {
            Log.e("BosonTouch", "BOSON_JS_LOAD_ERROR", error);
        }
        if (runtime == 0) counter.setText("V8 init failed");

        button.setOnClickListener(view -> {
            if (runtime == 0) return;
            int result = nativeTap(runtime);
            Log.i("BosonTouch", "BOSON_TOUCH_RESULT=" + result + " text=" + counter.getText());
        });
    }

    private String readTouchSource() throws IOException {
        try (InputStream input = getAssets().open("touch.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    public void applyText(String text) {
        counter.setText(text);
        counter.setContentDescription("boson-counter:" + text);
        Log.i("BosonTouch", "BOSON_JS_TEXT=" + text);
    }

    @Override
    protected void onDestroy() {
        if (runtime != 0) {
            nativeDestroy(runtime);
            runtime = 0;
        }
        super.onDestroy();
    }
}
