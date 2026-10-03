package dev.spinon.bootstrap;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
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

    static R08WgpuSurface show(Activity activity, boolean useWgpu, int backend,
                               boolean r13, boolean s04, int failureInjection,
                               int recoveryFailureInjection) {
        float density = activity.getResources().getDisplayMetrics().density;
        FrameLayout root = new FrameLayout(activity);
        root.setBackgroundColor(Color.rgb(14, 19, 31));

        final View surfaceView;
        final R08GpuSurfaceControl surface;
        if (useWgpu) {
            R08WgpuSurface wgpuSurface = new R08WgpuSurface(
                    activity, backend, r13, s04, failureInjection, recoveryFailureInjection);
            surfaceView = wgpuSurface;
            surface = wgpuSurface;
        } else {
            R08GpuSurface glesSurface = new R08GpuSurface(activity);
            surfaceView = glesSurface;
            surface = glesSurface;
        }
        FrameLayout.LayoutParams surfaceParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        root.addView(surfaceView, surfaceParams);

        TextView title = new TextView(activity);
        String backendName = !useWgpu ? "OpenGL ES 2.0"
                : backend == 1 ? "wgpu · Vulkan" : "wgpu · OpenGL ES 3.0+";
        String titleText = s04 ? "SPINON · S04 CSS→GPU 픽스처"
                : r13 ? "SPINON · R13 GPU 복구" : "SPINON · R08 GPU 표면";
        title.setText(titleText
                + "\nAndroid · " + backendName);
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
        instruction.setText(s04 ? "고정 301×40 CSS 픽스처의 GPU 출력을 확인합니다."
                : "중앙의 GPU 도형을 탭하면 색이 바뀝니다.");
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
        status.setText(s04 ? "화면은 GPU surface · RGBA readback은 비동기 검증"
                : "GPU 도형을 탭해 색을 바꾸세요 · 입력은 네이티브 IME 실험");
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
        input.setVisibility(s04 ? View.GONE : View.VISIBLE);
        input.setSingleLine(true);
        input.setTextSize(16);
        input.setHint("텍스트 입력 · IME 경계 실험");
        input.setTextColor(Color.rgb(18, 24, 37));
        input.setHintTextColor(Color.rgb(91, 103, 122));
        GradientDrawable inputBackground = new GradientDrawable();
        inputBackground.setColor(Color.WHITE);
        inputBackground.setCornerRadius(dp(8, density));
        input.setBackground(inputBackground);
        input.setContentDescription((r13 ? "R13" : "R08") + " 텍스트 입력 실험");
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

        if (!s04) {
            final int[] tapCount = {0};
            surfaceView.setOnClickListener(view -> {
                tapCount[0] += 1;
                surface.setActivationCount(tapCount[0]);
                surfaceView.setContentDescription((r13 ? "R13" : "R08")
                        + " GPU 도형, 활성화 " + tapCount[0] + "회");
                status.setText("GPU 도형 활성화 " + tapCount[0] + "회 · 텍스트 입력은 네이티브 오버레이");
                Log.i(TAG, "SPINON_" + (r13 ? "R13" : "R08")
                        + "_TOUCH count=" + tapCount[0]);
            });
        }

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
        return useWgpu ? (R08WgpuSurface) surfaceView : null;
    }

    private static int dp(int value, float density) {
        return Math.round(value * density);
    }
}

interface R08GpuSurfaceControl {
    void setActivationCount(int count);
}

final class R08GpuSurface extends GLSurfaceView implements GLSurfaceView.Renderer, R08GpuSurfaceControl {
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

    public void setActivationCount(int count) {
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

final class R08WgpuSurface extends SurfaceView
        implements SurfaceHolder.Callback, R08GpuSurfaceControl {
    private static final String TAG = "SpinonBootstrap";
    private static long lastS04SurfaceGeneration;

    private final int backend;
    private final boolean r13;
    private final boolean s04;
    private final Handler s04PollHandler = new Handler(Looper.getMainLooper());
    private final Runnable s04PollTask = this::pollS04Readback;
    private volatile long rendererHandle;
    private volatile int activationCount;
    private int configuredWidth;
    private int configuredHeight;
    private int rendererGeneration;
    private int rendererWidth;
    private int rendererHeight;
    private float rendererDensity;
    private long s04SurfaceGeneration;
    private boolean s04ReadbackPending;
    private boolean s04ReadbackFinished;
    private long s04ReadbackStartedAt;
    private int pendingFailureInjection;
    private int pendingRecoveryFailureInjection;
    private int recoveryFailureForNextRenderer;
    private boolean surfaceAvailable;
    private boolean hostActive = true;
    private boolean resumeRedrawPending;

    private static native long nativeCreate(Surface surface, int width, int height, int backend);
    private static native long nativeCreateS04(Surface surface, int width, int height,
                                                int backend, float density,
                                                long surfaceGeneration);
    private static native int nativeDraw(long renderer, int activationCount);
    private static native byte[] nativeDrawS04(long renderer);
    private static native byte[] nativePollS04Readback(long renderer);
    private static native int nativeResize(long renderer, int width, int height);
    private static native int nativeResizeS04(long renderer, int width, int height,
                                                float density, long surfaceGeneration);
    private static native int nativeInjectFailure(long renderer, int failureKind);
    private static native void nativeDestroy(long renderer);

    R08WgpuSurface(Activity activity, int backend, boolean r13, boolean s04, int failureInjection,
                   int recoveryFailureInjection) {
        super(activity);
        this.backend = backend;
        this.r13 = r13;
        this.s04 = s04;
        this.pendingFailureInjection = failureInjection;
        this.pendingRecoveryFailureInjection = recoveryFailureInjection;
        getHolder().addCallback(this);
        setClickable(!s04);
        setContentDescription(s04 ? "S04 고정 CSS 픽스처 GPU 출력"
                : (r13 ? "R13" : "R08") + " GPU 도형, 활성화 0회");
        setImportantForAccessibility(s04 ? View.IMPORTANT_FOR_ACCESSIBILITY_NO
                : View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        if (!s04) {
            setAccessibilityDelegate(new View.AccessibilityDelegate() {
                @Override
                public void onInitializeAccessibilityNodeInfo(View host,
                                                              AccessibilityNodeInfo info) {
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
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        surfaceAvailable = true;
        if (r13) Log.i(TAG, "SPINON_R13_SURFACE=created");
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        if (width <= 0 || height <= 0) return;
        configuredWidth = width;
        configuredHeight = height;
        surfaceAvailable = holder.getSurface().isValid();
        if (!ensureRenderer("surface_changed")) return;
        Log.i(TAG, "SPINON_R08_WGPU_SURFACE=size " + width + "x" + height);
        drawCurrentFrame();
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceAvailable = false;
        s04ReadbackPending = false;
        s04ReadbackFinished = false;
        s04PollHandler.removeCallbacks(s04PollTask);
        destroyRenderer();
        configuredWidth = 0;
        configuredHeight = 0;
        Log.i(TAG, "SPINON_R08_WGPU_SURFACE=destroyed");
        if (r13) Log.i(TAG, "SPINON_R13_SURFACE=destroyed");
    }

    @Override
    public void setActivationCount(int count) {
        activationCount = count;
        if (!s04) drawCurrentFrame();
    }

    void onHostPaused() {
        hostActive = false;
        s04PollHandler.removeCallbacks(s04PollTask);
        if (r13) Log.i(TAG, "SPINON_R13_HOST=paused");
    }

    void onHostResumed() {
        hostActive = true;
        resumeRedrawPending = r13;
        if (r13) Log.i(TAG, "SPINON_R13_HOST=resumed");
        if (surfaceAvailable && configuredWidth > 0 && configuredHeight > 0) {
            ensureRenderer("host_resumed");
            drawCurrentFrame();
            if (s04ReadbackPending) s04PollHandler.postDelayed(s04PollTask, 16);
        } else if (r13) {
            Log.i(TAG, "SPINON_R13_RESUME=waiting_for_surface");
        }
    }

    private boolean ensureRenderer(String reason) {
        Surface surface = getHolder().getSurface();
        if (!surfaceAvailable || !surface.isValid()
                || configuredWidth <= 0 || configuredHeight <= 0) {
            if (r13) Log.i(TAG, "SPINON_R13_RENDERER=waiting reason=" + reason);
            return false;
        }
        if (rendererHandle == 0) {
            float density = getResources().getDisplayMetrics().density;
            if (s04) {
                long nextGeneration = nextS04SurfaceGeneration();
                rendererHandle = nativeCreateS04(surface, configuredWidth, configuredHeight,
                        backend, density, nextGeneration);
                if (rendererHandle != 0) s04SurfaceGeneration = nextGeneration;
            } else {
                rendererHandle = nativeCreate(surface, configuredWidth, configuredHeight, backend);
            }
            if (rendererHandle == 0) {
                Log.e(TAG, "SPINON_" + (s04 ? "S04" : "R08")
                        + "_WGPU_ERROR=renderer creation failed");
                if (r13) Log.e(TAG, "SPINON_R13_RECOVERY=renderer_create_failed reason=" + reason);
                return false;
            }
            rendererGeneration++;
            rendererWidth = configuredWidth;
            rendererHeight = configuredHeight;
            rendererDensity = density;
            if (r13) {
                Log.i(TAG, "SPINON_R13_RENDERER=created generation=" + rendererGeneration
                        + " reason=" + reason);
            }
            int failureInjection = pendingFailureInjection;
            String injectionStage = "initial";
            if (failureInjection != 0) {
                pendingFailureInjection = 0;
            } else if (recoveryFailureForNextRenderer != 0) {
                failureInjection = recoveryFailureForNextRenderer;
                recoveryFailureForNextRenderer = 0;
                injectionStage = "recovery_redraw";
            }
            if (failureInjection != 0) {
                int injected = nativeInjectFailure(rendererHandle, failureInjection);
                if (injected == 0) {
                    Log.i(TAG, "SPINON_R13_FAULT=injected stage=" + injectionStage
                            + " kind=" + failureInjection);
                } else {
                    Log.e(TAG, "SPINON_R13_FAULT=injection_failed code=" + injected);
                }
            }
            return true;
        }
        if (s04) {
            float density = getResources().getDisplayMetrics().density;
            if (configuredWidth != rendererWidth || configuredHeight != rendererHeight
                    || Float.compare(density, rendererDensity) != 0) {
                long nextGeneration = nextS04SurfaceGeneration();
                int result = nativeResizeS04(rendererHandle, configuredWidth, configuredHeight,
                        density, nextGeneration);
                if (result != 0) {
                    Log.e(TAG, "SPINON_S04_RESIZE=failed code=" + result);
                    return false;
                }
                s04SurfaceGeneration = nextGeneration;
                rendererWidth = configuredWidth;
                rendererHeight = configuredHeight;
                rendererDensity = density;
                Log.i(TAG, "SPINON_S04_SURFACE=generation=" + s04SurfaceGeneration
                        + " size=" + configuredWidth + "x" + configuredHeight
                        + " density=" + density);
            }
            return true;
        }
        int result = nativeResize(rendererHandle, configuredWidth, configuredHeight);
        if (result != 0) {
            Log.e(TAG, "SPINON_R08_WGPU_RESIZE_ERROR code=" + result);
            if (r13) Log.e(TAG, "SPINON_R13_RESIZE=failed code=" + result);
            if (!r13) return false;
            destroyRenderer();
            return ensureRenderer("resize_recreate");
        }
        if (r13) Log.i(TAG, "SPINON_R13_SURFACE=resized " + configuredWidth + "x" + configuredHeight);
        return true;
    }

    private boolean drawCurrentFrame() {
        if (!hostActive) return false;
        if (rendererHandle == 0 && !ensureRenderer("draw")) return false;
        long renderer = rendererHandle;
        if (renderer == 0) return false;
        if (s04) {
            byte[] reportBytes = nativeDrawS04(renderer);
            String report = reportBytes == null ? "native bridge returned no result"
                    : new String(reportBytes, java.nio.charset.StandardCharsets.UTF_8);
            if (!report.startsWith("status=0 ")) {
                Log.e(TAG, "SPINON_S04_FRAME " + report);
                return false;
            }
            Log.i(TAG, "SPINON_S04_FRAME " + report);
            if (!s04ReadbackPending && !s04ReadbackFinished) {
                s04ReadbackPending = true;
                s04ReadbackStartedAt = SystemClock.uptimeMillis();
                s04PollHandler.postDelayed(s04PollTask, 16);
            }
            return true;
        }
        int result = nativeDraw(renderer, activationCount);
        if (result == 0) {
            logResumeRedrawSuccess();
            return true;
        }
        if (r13 && isRecoverable(result)) return recoverRenderer(result);
        if (r13) Log.e(TAG, "SPINON_R13_DRAW=failed code=" + result);
        Log.e(TAG, "SPINON_R08_WGPU_DRAW_ERROR code=" + result);
        return false;
    }

    private void pollS04Readback() {
        if (!s04 || !hostActive || rendererHandle == 0 || !s04ReadbackPending) return;
        if (SystemClock.uptimeMillis() - s04ReadbackStartedAt > 5_000) {
            s04ReadbackPending = false;
            s04ReadbackFinished = true;
            Log.e(TAG, "SPINON_S04_READBACK=failed reason=timeout limit_ms=5000");
            return;
        }
        byte[] reportBytes = nativePollS04Readback(rendererHandle);
        String report = reportBytes == null ? "native bridge returned no result"
                : new String(reportBytes, java.nio.charset.StandardCharsets.UTF_8);
        if (report.startsWith("status=0 pending")) {
            s04PollHandler.postDelayed(s04PollTask, 16);
        } else if (report.startsWith("status=1 ")) {
            s04ReadbackPending = false;
            s04ReadbackFinished = true;
            Log.i(TAG, "SPINON_S04_READBACK=passed " + report);
        } else {
            s04ReadbackPending = false;
            s04ReadbackFinished = true;
            Log.e(TAG, "SPINON_S04_READBACK=failed " + report);
        }
    }

    private static synchronized long nextS04SurfaceGeneration() {
        if (lastS04SurfaceGeneration == Long.MAX_VALUE) {
            throw new IllegalStateException("S04 surface generation exhausted");
        }
        lastS04SurfaceGeneration += 1;
        return lastS04SurfaceGeneration;
    }

    private boolean isRecoverable(int result) {
        return result == -3 || result == -4 || result == -5;
    }

    private boolean recoverRenderer(int failureCode) {
        String reason = failureName(failureCode);
        Log.i(TAG, "SPINON_R13_RECOVERY=started reason=" + reason
                + " generation=" + rendererGeneration);
        recoveryFailureForNextRenderer = pendingRecoveryFailureInjection;
        pendingRecoveryFailureInjection = 0;
        destroyRenderer();
        if (!ensureRenderer("recover_" + reason)) {
            recoveryFailureForNextRenderer = 0;
            Log.e(TAG, "SPINON_R13_RECOVERY=failed reason=" + reason + " stage=create");
            return false;
        }
        int retry = nativeDraw(rendererHandle, activationCount);
        if (retry == 0) {
            Log.i(TAG, "SPINON_R13_RECOVERY=complete reason=" + reason
                    + " generation=" + rendererGeneration + " redraw=success");
            logResumeRedrawSuccess();
            return true;
        } else {
            Log.e(TAG, "SPINON_R13_RECOVERY=failed reason=" + reason
                    + " stage=redraw code=" + retry);
            return false;
        }
    }

    private void logResumeRedrawSuccess() {
        if (r13 && resumeRedrawPending) {
            resumeRedrawPending = false;
            Log.i(TAG, "SPINON_R13_RESUME=redraw_success");
        }
    }

    private String failureName(int result) {
        if (result == -3) return "surface_lost";
        if (result == -4) return "surface_outdated";
        return "device_lost";
    }

    private void destroyRenderer() {
        long renderer = rendererHandle;
        rendererHandle = 0;
        if (renderer != 0) nativeDestroy(renderer);
    }
}
