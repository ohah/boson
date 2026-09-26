package dev.boson.tree;

import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.SparseArray;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;

public final class TreeActivity extends Activity {
    static { System.loadLibrary("boson_tree"); }

    private native long nativeCreate(String source, int widthDp, int heightDp);
    private native int nativeTap(long runtime, int nodeId, int widthDp, int heightDp);
    private native int nativeRelayout(long runtime, int widthDp, int heightDp);
    private native void nativeDestroy(long runtime);

    private final SparseArray<View> views = new SparseArray<>();
    private final HashSet<Integer> seen = new HashSet<>();
    private FrameLayout root;
    private float density;
    private long runtime;
    private boolean detailedLogs = true;
    private boolean eventFailed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        density = getResources().getDisplayMetrics().density;
        root = new FrameLayout(this);
        root.setBackgroundColor(0xfff7f9fc);
        getWindow().setStatusBarColor(0xfff7f9fc);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        setContentView(root);
        root.addOnLayoutChangeListener((view, left, top, right, bottom,
                                        oldLeft, oldTop, oldRight, oldBottom) -> {
            if (runtime == 0 || right - left == oldRight - oldLeft && bottom - top == oldBottom - oldTop) return;
            int width = screenWidthDp();
            int height = screenHeightDp();
            int result = nativeRelayout(runtime, width, height);
            Log.i("BosonTree", "BOSON_RESIZE_RESULT=" + result +
                    " width=" + width + " height=" + height +
                    " root_px=" + root.getWidth() + "x" + root.getHeight());
        });
        root.post(() -> {
            try {
                String scenario = getIntent().getStringExtra("boson_scenario");
                String asset = "tree.js";
                String prefix = "";
                if ("stress".equals(scenario)) {
                    int count = Math.max(0, Math.min(1000, getIntent().getIntExtra("boson_count", 100)));
                    asset = "stress.js";
                    prefix = "const BOSON_COUNT = " + count + ";\n";
                    detailedLogs = false;
                } else if ("long_text".equals(scenario)) {
                    asset = "long_text.js";
                } else if ("error".equals(scenario)) {
                    asset = "error.js";
                }
                long started = SystemClock.elapsedRealtimeNanos();
                runtime = nativeCreate(prefix + readSource(asset), screenWidthDp(), screenHeightDp());
                long elapsedUs = (SystemClock.elapsedRealtimeNanos() - started) / 1000;
                Log.i("BosonTree", "BOSON_METRIC init_total_us=" + elapsedUs +
                        " scenario=" + (scenario == null ? "default" : scenario));
                if (runtime == 0) showError("V8 or tree init failed");
            } catch (IOException error) {
                Log.e("BosonTree", "BOSON_JS_LOAD_ERROR", error);
                showError("JS load failed");
            }
        });
    }

    private int screenWidthDp() { return Math.round(root.getWidth() / density); }
    private int screenHeightDp() { return Math.round(root.getHeight() / density); }
    private int px(int dp) { return Math.round(dp * density); }

    private String readSource(String name) throws IOException {
        try (InputStream input = getAssets().open(name);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void showError(String text) {
        TextView error = new TextView(this);
        error.setText(text);
        error.setTextSize(24);
        root.addView(error);
    }

    public void beginFrame() { seen.clear(); }

    public void upsertNode(int id, String tag, String text, int x, int y, int width, int height) {
        if (tag.equals("column") || tag.equals("row")) return;
        seen.add(id);
        View view = views.get(id);
        if (view == null) {
            if (tag.equals("button")) {
                Button button = new Button(this);
                button.setAllCaps(false);
                button.setTextSize(20);
                button.setOnClickListener(clicked -> {
                    if (runtime == 0 || eventFailed) return;
                    int result = nativeTap(runtime, id, screenWidthDp(), screenHeightDp());
                    Log.i("BosonTree", "BOSON_TOUCH_RESULT=" + result + " node=" + id);
                    if (result != 0) {
                        eventFailed = true;
                        showError("JS event failed; reopen the app");
                    }
                });
                view = button;
            } else {
                TextView label = new TextView(this);
                label.setGravity(Gravity.CENTER_VERTICAL);
                label.setTextSize(id == 2 ? 30 : 17);
                label.setTextColor(0xff17233b);
                view = label;
            }
            views.put(id, view);
            root.addView(view);
            if (detailedLogs) Log.i("BosonTree", "BOSON_NODE_CREATE id=" + id + " tag=" + tag);
        }
        ((TextView) view).setText(text);
        view.setContentDescription("boson-node:" + id + ":" + text);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(px(width), px(height));
        params.leftMargin = px(x);
        params.topMargin = px(y);
        view.setLayoutParams(params);
        if (detailedLogs) Log.i("BosonTree", "BOSON_LAYOUT id=" + id + " x=" + x + " y=" + y +
                " width=" + width + " height=" + height);
    }

    public void endFrame() {
        for (int index = views.size() - 1; index >= 0; index--) {
            int id = views.keyAt(index);
            if (seen.contains(id)) continue;
            View view = views.valueAt(index);
            root.removeView(view);
            views.removeAt(index);
            if (detailedLogs) Log.i("BosonTree", "BOSON_NODE_REMOVE id=" + id);
        }
        Log.i("BosonTree", "BOSON_FRAME nodes=" + views.size());
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
