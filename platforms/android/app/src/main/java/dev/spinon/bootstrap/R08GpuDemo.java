package dev.spinon.bootstrap;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

final class R08GpuDemo {
    private static final String TAG = "SpinonBootstrap";

    private R08GpuDemo() {}

    static void show(Activity activity) {
        float density = activity.getResources().getDisplayMetrics().density;
        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(Color.rgb(14, 19, 31));

        R08GpuSurface surface = new R08GpuSurface(activity);
        FrameLayout.LayoutParams surfaceParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(surface, surfaceParams);

        TextView title = new TextView(activity);
        title.setText("SPINON · R08 GPU 표면\nAndroid · OpenGL ES 2.0");
        title.setTextColor(Color.rgb(235, 241, 250));
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setPadding(dp(22, density), dp(18, density), dp(22, density), dp(12, density));
        FrameLayout.LayoutParams titleParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP);
        titleParams.topMargin = dp(44, density);
        root.addView(title, titleParams);

        TextView instruction = new TextView(activity);
        instruction.setText("중앙의 GPU 도형을 탭하면 색이 바뀝니다.");
        instruction.setTextColor(Color.rgb(235, 241, 250));
        instruction.setTextSize(14);
        instruction.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams instructionParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        instructionParams.leftMargin = dp(24, density);
        instructionParams.rightMargin = dp(24, density);
        instructionParams.topMargin = dp(142, density);
        root.addView(instruction, instructionParams);

        TextView status = new TextView(activity);
        status.setText("GPU 도형을 탭해 색을 바꾸세요 · 입력은 네이티브 IME 실험");
        status.setTextColor(Color.rgb(200, 211, 228));
        status.setTextSize(13);
        status.setGravity(Gravity.CENTER_VERTICAL);
        status.setPadding(dp(22, density), 0, dp(22, density), dp(8, density));
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM);
        statusParams.bottomMargin = dp(78, density);
        root.addView(status, statusParams);

        EditText input = new EditText(activity);
        input.setSingleLine(true);
        input.setTextSize(16);
        input.setHint("텍스트 입력 · IME 경계 실험");
        input.setTextColor(Color.rgb(18, 24, 37));
        input.setHintTextColor(Color.rgb(91, 103, 122));
        GradientDrawable inputBackground = new GradientDrawable();
        inputBackground.setColor(Color.WHITE);
        inputBackground.setCornerRadius(dp(8, density));
        input.setBackground(inputBackground);
        input.setContentDescription("R08 텍스트 입력 실험");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        input.setPadding(dp(14, density), 0, dp(14, density), 0);
        FrameLayout.LayoutParams inputParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                dp(54, density),
                Gravity.BOTTOM);
        inputParams.leftMargin = dp(22, density);
        inputParams.rightMargin = dp(22, density);
        inputParams.bottomMargin = dp(14, density);
        root.addView(input, inputParams);

        final int[] tapCount = {0};
        surface.setOnClickListener(view -> {
            tapCount[0] += 1;
            surface.setActivationCount(tapCount[0]);
            surface.setContentDescription("R08 GPU 도형, 활성화 " + tapCount[0] + "회");
            status.setText("GPU 도형 활성화 " + tapCount[0] + "회 · 텍스트 입력은 네이티브 오버레이");
            Log.i(TAG, "SPINON_R08_TOUCH count=" + tapCount[0]);
        });

        input.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence text, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence text, int start, int before, int count) {
                boolean composing = text instanceof android.text.Spannable
                        && android.view.inputmethod.BaseInputConnection
                        .getComposingSpanStart((android.text.Spannable) text) >= 0;
                status.setText("IME 입력 길이 " + text.length() + " · 조합 중 " + (composing ? "예" : "아니요"));
                Log.i(TAG, "SPINON_R08_TEXT_INPUT length=" + text.length() + " composing=" + composing);
            }

            @Override
            public void afterTextChanged(Editable text) {}
        });
        input.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                Log.i(TAG, "SPINON_R08_IME_ACTION=done");
                return false;
            }
            return false;
        });

        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int topInset = insets.getSystemWindowInsetTop();
            int bottomInset = insets.getSystemWindowInsetBottom();
            titleParams.topMargin = topInset + dp(10, density);
            title.setLayoutParams(titleParams);
            instructionParams.topMargin = topInset + dp(112, density);
            instruction.setLayoutParams(instructionParams);
            statusParams.bottomMargin = bottomInset + dp(78, density);
            status.setLayoutParams(statusParams);
            inputParams.bottomMargin = bottomInset + dp(14, density);
            input.setLayoutParams(inputParams);
            return insets;
        });

        activity.setContentView(root);
        Log.i(TAG, "SPINON_R08_UI=ready text-input=EditText accessibility=button+EditText");
    }

    private static int dp(int value, float density) {
        return Math.round(value * density);
    }
}

final class R08GpuSurface extends GLSurfaceView implements GLSurfaceView.Renderer {
    private static final String TAG = "SpinonBootstrap";
    private static final float[] CARD_VERTICES = {
            -0.78f, -0.20f,
             0.78f, -0.20f,
            -0.78f,  0.20f,
             0.78f,  0.20f
    };

    private final FloatBuffer vertices;
    private volatile int activationCount;
    private int program;
    private int colorLocation;
    private int positionLocation;
    private boolean firstFrameLogged;

    R08GpuSurface(Activity activity) {
        super(activity);
        vertices = ByteBuffer.allocateDirect(CARD_VERTICES.length * Float.BYTES)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer();
        vertices.put(CARD_VERTICES).position(0);
        setEGLContextClientVersion(2);
        setRenderer(this);
        setRenderMode(GLSurfaceView.RENDERMODE_WHEN_DIRTY);
        setClickable(true);
        setContentDescription("R08 GPU 도형, 활성화 0회");
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override
            public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                info.setClassName("android.widget.Button");
                info.setClickable(true);
                Rect visibleBounds = new Rect(
                        Math.round(host.getWidth() * 0.11f),
                        Math.round(host.getHeight() * 0.40f),
                        Math.round(host.getWidth() * 0.89f),
                        Math.round(host.getHeight() * 0.60f));
                info.setBoundsInParent(visibleBounds);
                int[] screenLocation = new int[2];
                host.getLocationOnScreen(screenLocation);
                visibleBounds.offset(screenLocation[0], screenLocation[1]);
                info.setBoundsInScreen(visibleBounds);
            }
        });
    }

    void setActivationCount(int count) {
        activationCount = count;
        requestRender();
    }

    @Override
    public void onSurfaceCreated(javax.microedition.khronos.opengles.GL10 gl,
                                 javax.microedition.khronos.egl.EGLConfig config) {
        GLES20.glClearColor(0.055f, 0.075f, 0.12f, 1.0f);
        String renderer = GLES20.glGetString(GLES20.GL_RENDERER);
        String version = GLES20.glGetString(GLES20.GL_VERSION);
        Log.i(TAG, "SPINON_R08_SURFACE=created api=OpenGL_ES_2 renderer=" + renderer + " version=" + version);
        program = createProgram();
        positionLocation = GLES20.glGetAttribLocation(program, "aPosition");
        colorLocation = GLES20.glGetUniformLocation(program, "uColor");
        if (!firstFrameLogged) {
            Log.i(TAG, "SPINON_R08_SHADER=ready");
        }
    }

    @Override
    public void onSurfaceChanged(javax.microedition.khronos.opengles.GL10 gl, int width, int height) {
        GLES20.glViewport(0, 0, width, height);
        Log.i(TAG, "SPINON_R08_SURFACE=size " + width + "x" + height);
    }

    @Override
    public void onDrawFrame(javax.microedition.khronos.opengles.GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        GLES20.glUseProgram(program);
        GLES20.glEnableVertexAttribArray(positionLocation);
        vertices.position(0);
        GLES20.glVertexAttribPointer(positionLocation, 2, GLES20.GL_FLOAT, false, 0, vertices);
        if ((activationCount & 1) == 0) {
            GLES20.glUniform4f(colorLocation, 0.20f, 0.49f, 0.96f, 1.0f);
        } else {
            GLES20.glUniform4f(colorLocation, 0.98f, 0.39f, 0.28f, 1.0f);
        }
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
        GLES20.glDisableVertexAttribArray(positionLocation);
        if (!firstFrameLogged) {
            firstFrameLogged = true;
            Log.i(TAG, "SPINON_R08_FRAME=first_draw_submitted");
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (event.getAction() == MotionEvent.ACTION_UP) {
            float x = event.getX() / Math.max(1, getWidth());
            float y = event.getY() / Math.max(1, getHeight());
            if (x >= 0.11f && x <= 0.89f && y >= 0.40f && y <= 0.60f) {
                performClick();
            }
            return true;
        }
        return event.getAction() == MotionEvent.ACTION_DOWN
                || event.getAction() == MotionEvent.ACTION_MOVE
                || event.getAction() == MotionEvent.ACTION_CANCEL;
    }

    @Override
    public boolean performClick() {
        super.performClick();
        return true;
    }

    private int createProgram() {
        String vertexSource = "attribute vec2 aPosition;\n"
                + "void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }\n";
        String fragmentSource = "precision mediump float;\n"
                + "uniform vec4 uColor;\n"
                + "void main() { gl_FragColor = uColor; }\n";
        int vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, vertexSource);
        int fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource);
        int result = GLES20.glCreateProgram();
        GLES20.glAttachShader(result, vertexShader);
        GLES20.glAttachShader(result, fragmentShader);
        GLES20.glLinkProgram(result);
        int[] linkStatus = new int[1];
        GLES20.glGetProgramiv(result, GLES20.GL_LINK_STATUS, linkStatus, 0);
        if (linkStatus[0] == 0) {
            String message = GLES20.glGetProgramInfoLog(result);
            GLES20.glDeleteProgram(result);
            throw new IllegalStateException("OpenGL ES program link failed: " + message);
        }
        GLES20.glDeleteShader(vertexShader);
        GLES20.glDeleteShader(fragmentShader);
        return result;
    }

    private int compileShader(int type, String source) {
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);
        int[] compileStatus = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compileStatus, 0);
        if (compileStatus[0] == 0) {
            String message = GLES20.glGetShaderInfoLog(shader);
            GLES20.glDeleteShader(shader);
            throw new IllegalStateException("OpenGL ES shader compile failed: " + message);
        }
        return shader;
    }
}
