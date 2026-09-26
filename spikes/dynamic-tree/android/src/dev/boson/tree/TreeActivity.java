package dev.boson.tree;

import android.app.Activity;
import android.os.Bundle;
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
    private native void nativeDestroy(long runtime);

    private final SparseArray<View> views = new SparseArray<>();
    private final HashSet<Integer> seen = new HashSet<>();
    private FrameLayout root;
    private float density;
    private long runtime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        density = getResources().getDisplayMetrics().density;
        root = new FrameLayout(this);
        root.setBackgroundColor(0xfff7f9fc);
        getWindow().setStatusBarColor(0xfff7f9fc);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        setContentView(root);
        root.post(() -> {
            try {
                runtime = nativeCreate(readSource(), screenWidthDp(), screenHeightDp());
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

    private String readSource() throws IOException {
        try (InputStream input = getAssets().open("tree.js");
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
                    if (runtime == 0) return;
                    int result = nativeTap(runtime, id, screenWidthDp(), screenHeightDp());
                    Log.i("BosonTree", "BOSON_TOUCH_RESULT=" + result + " node=" + id);
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
            Log.i("BosonTree", "BOSON_NODE_CREATE id=" + id + " tag=" + tag);
        }
        ((TextView) view).setText(text);
        view.setContentDescription("boson-node:" + id + ":" + text);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(px(width), px(height));
        params.leftMargin = px(x);
        params.topMargin = px(y);
        view.setLayoutParams(params);
        Log.i("BosonTree", "BOSON_LAYOUT id=" + id + " x=" + x + " y=" + y +
                " width=" + width + " height=" + height);
    }

    public void endFrame() {
        for (int index = views.size() - 1; index >= 0; index--) {
            int id = views.keyAt(index);
            if (seen.contains(id)) continue;
            View view = views.valueAt(index);
            root.removeView(view);
            views.removeAt(index);
            Log.i("BosonTree", "BOSON_NODE_REMOVE id=" + id);
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
