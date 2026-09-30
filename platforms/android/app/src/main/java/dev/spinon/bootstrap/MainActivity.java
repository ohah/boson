package dev.spinon.bootstrap;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public final class MainActivity extends Activity {
    private static final String TAG = "SpinonBootstrap";
    private static final int RUNTIME_QUEUE_CAPACITY = 64;

    static {
        System.loadLibrary("spinon_bootstrap");
    }

    private static native byte[] nativeRun(byte[] sourceUtf8, float width, float height,
                                           float density, boolean runR10);
    private static native long nativeSessionCreate();
    private static native byte[] nativeSessionEval(long session, byte[] sourceUtf8);
    private static native byte[] nativeSessionDispatch(long session, int nodeId);
    private static native int nativeSessionCancel(long session);
    private static native void nativeSessionFree(long session);

    private final ThreadPoolExecutor runtimeCalls = new ThreadPoolExecutor(
            4, 4, 0L, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(RUNTIME_QUEUE_CAPACITY),
            runnable -> new Thread(runnable, "spinon-platform-call"),
            new ThreadPoolExecutor.AbortPolicy());
    private final ExecutorService runtimeControl = Executors.newSingleThreadExecutor(
            runnable -> new Thread(runnable, "spinon-runtime-control"));
    private final ExecutorService bootstrapExecutor = Executors.newSingleThreadExecutor(
            runnable -> new Thread(runnable, "spinon-bootstrap"));
    private final ScheduledExecutorService delayedHost = Executors.newSingleThreadScheduledExecutor(
            runnable -> new Thread(runnable, "spinon-delayed-host"));

    private R08WgpuSurface r13Surface;
    private boolean r13WasPaused;
    private volatile long runtimeSession;
    private volatile boolean activityClosing;
    private TextView runtimeLog;
    private TextView runtimeStatus;
    private Button dispatchButton;
    private Button loopButton;
    private Button delayedButton;
    private int tapCount;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean runR13 = getIntent().getBooleanExtra("spinon_r13", false);
        if (runR13 || getIntent().getBooleanExtra("spinon_r08", false)) {
            int backend = getIntent().getIntExtra("spinon_r08_backend", 1);
            boolean useWgpu = runR13 || !getIntent().getBooleanExtra("spinon_r08_native", false);
            int failureInjection = getIntent().getIntExtra("spinon_r13_failure", 0);
            int recoveryFailureInjection = getIntent().getIntExtra("spinon_r13_recovery_failure", 0);
            R08WgpuSurface surface = R08GpuDemo.show(
                    this, useWgpu, backend, runR13, failureInjection,
                    recoveryFailureInjection);
            r13Surface = runR13 ? surface : null;
            return;
        }

        try {
            String source = readAsset("app.js");
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            if (getIntent().getBooleanExtra("spinon_runtime_threads", false)) {
                showRuntimeThreadExperiment(source);
                return;
            }
            boolean runR10 = getIntent().getBooleanExtra("spinon_r10", false);
            float width = metrics.widthPixels / metrics.density;
            float height = metrics.heightPixels / metrics.density;
            float density = metrics.density;
            bootstrapExecutor.execute(() -> {
                boolean isMainThread = Thread.currentThread() == Looper.getMainLooper().getThread();
                Log.i(TAG, "SPINON_BOOTSTRAP_EXECUTION is_main_thread=" + isMainThread);
                byte[] outputUtf8 = nativeRun(source.getBytes(StandardCharsets.UTF_8),
                        width, height, density, runR10);
                String output = outputUtf8 == null
                        ? "native bridge returned no result"
                        : new String(outputUtf8, StandardCharsets.UTF_8);
                Log.i(TAG, "SPINON_BOOTSTRAP_RESULT=" + output);
                if (runR10 && !activityClosing) {
                    runOnUiThread(() -> {
                        if (!activityClosing) showR10Report(r10Report(output), density);
                    });
                }
            });
        } catch (IOException error) {
            Log.e(TAG, "SPINON_BOOTSTRAP_ASSET_ERROR", error);
        } catch (RuntimeException error) {
            Log.e(TAG, "SPINON_BOOTSTRAP_RUNTIME_ERROR", error);
        }
    }

    private void showRuntimeThreadExperiment(String source) {
        float density = getResources().getDisplayMetrics().density;
        int inset = Math.round(18 * density);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(inset, Math.round(20 * density), inset, inset);
        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            view.setPadding(
                    inset + windowInsets.getSystemWindowInsetLeft(),
                    Math.round(20 * density) + windowInsets.getSystemWindowInsetTop(),
                    inset + windowInsets.getSystemWindowInsetRight(),
                    inset + windowInsets.getSystemWindowInsetBottom());
            return windowInsets;
        });
        root.setBackgroundColor(Color.rgb(14, 19, 31));

        TextView title = new TextView(this);
        title.setText("SPINON · V8 실행 스레드 실험");
        title.setTextColor(Color.rgb(230, 237, 248));
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title);

        TextView description = new TextView(this);
        description.setText("개발용 실험 · 호출 스레드와 V8 소유 스레드, 큐 대기·실행 시간 확인");
        description.setTextColor(Color.rgb(170, 184, 207));
        description.setTextSize(13);
        description.setPadding(0, Math.round(8 * density), 0, Math.round(12 * density));
        root.addView(description);

        runtimeStatus = new TextView(this);
        runtimeStatus.setText("V8 세션 초기화 중…");
        runtimeStatus.setTextColor(Color.rgb(97, 185, 255));
        runtimeStatus.setTextSize(14);
        root.addView(runtimeStatus);

        dispatchButton = runtimeButton("터치 이벤트 보내기");
        loopButton = runtimeButton("긴 JavaScript 실행 시작");
        Button cancelButton = runtimeButton("실행 취소");
        delayedButton = runtimeButton("지연 호스트 응답 모의 (0.5초)");
        dispatchButton.setEnabled(false);
        loopButton.setEnabled(false);
        cancelButton.setEnabled(false);
        delayedButton.setEnabled(false);
        root.addView(dispatchButton);
        root.addView(loopButton);
        root.addView(cancelButton);
        root.addView(delayedButton);

        ScrollView scroll = new ScrollView(this);
        runtimeLog = new TextView(this);
        runtimeLog.setTextColor(Color.rgb(218, 226, 240));
        runtimeLog.setTextSize(12);
        runtimeLog.setTypeface(Typeface.MONOSPACE);
        runtimeLog.setPadding(0, Math.round(12 * density), 0, Math.round(20 * density));
        scroll.addView(runtimeLog);
        root.addView(scroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);

        dispatchButton.setOnClickListener(view -> {
            int nodeId = ++tapCount;
            runtimeStatus.setText("UI 탭 " + nodeId + "회 · UI는 계속 입력을 받습니다");
            submitRuntimeCall(() -> nativeSessionDispatch(runtimeSession, nodeId), "dispatch");
        });
        loopButton.setOnClickListener(view -> {
            loopButton.setEnabled(false);
            appendRuntimeLog("무한 JS 평가를 시작했습니다. 화면은 계속 탭할 수 있어야 합니다.");
            submitRuntimeCall(() -> nativeSessionEval(runtimeSession,
                    "while (true) { /* 취소 경로 검증 */ }".getBytes(StandardCharsets.UTF_8)),
                    "long-eval", () -> loopButton.setEnabled(!activityClosing));
        });
        cancelButton.setOnClickListener(view -> {
            long handle = runtimeSession;
            if (activityClosing || handle == 0) return;
            try {
                runtimeControl.execute(() -> {
                    int result = nativeSessionCancel(handle);
                    appendRuntimeLog("취소 요청 status=" + result
                            + " (0=실행 중 취소 요청, 1=실행 중인 JS 없음)");
                });
            } catch (RejectedExecutionException error) {
                appendRuntimeLog("취소 요청이 거부되었습니다: " + error.getMessage());
            }
        });
        delayedButton.setOnClickListener(view -> {
            delayedButton.setEnabled(false);
            appendRuntimeLog("호스트가 0.5초 뒤 JS 콜백을 큐에 넣도록 예약했습니다.");
            delayedHost.schedule(() -> {
                submitRuntimeCall(() -> nativeSessionEval(runtimeSession,
                        "spinon.setText('delayed-host-response')".getBytes(StandardCharsets.UTF_8)),
                        "delayed-host-response", () -> delayedButton.setEnabled(!activityClosing));
            }, 500, TimeUnit.MILLISECONDS);
        });

        submitRuntimeCall(() -> {
            long handle = nativeSessionCreate();
            runtimeSession = handle;
            if (handle == 0) throw new IllegalStateException("V8 세션 생성 실패");
            return nativeSessionEval(handle, source.getBytes(StandardCharsets.UTF_8));
        }, "session-create", () -> {
            if (runtimeSession == 0) {
                runtimeStatus.setText("세션 생성 실패 · logcat 확인");
                return;
            }
            runtimeStatus.setText("준비됨 · Android 실행기 스레드에서 V8을 소유합니다");
            dispatchButton.setEnabled(true);
            loopButton.setEnabled(true);
            cancelButton.setEnabled(true);
            delayedButton.setEnabled(true);
        });
    }

    private Button runtimeButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setGravity(Gravity.CENTER);
        return button;
    }

    private void submitRuntimeCall(java.util.concurrent.Callable<byte[]> call, String label) {
        submitRuntimeCall(call, label, null);
    }

    private void submitRuntimeCall(java.util.concurrent.Callable<byte[]> call, String label,
                                   Runnable onComplete) {
        if (activityClosing) return;
        try {
            runtimeCalls.execute(() -> {
                try {
                    byte[] result = call.call();
                    appendRuntimeLog(label + " " + decode(result));
                } catch (Exception error) {
                    appendRuntimeLog(label + " 오류: " + error.getMessage());
                } finally {
                    if (onComplete != null && !activityClosing) runOnUiThread(onComplete);
                }
            });
        } catch (RejectedExecutionException error) {
            appendRuntimeLog("호출 대기열이 가득 차거나 닫혀 작업을 거부했습니다 · " + label);
        }
    }

    private String decode(byte[] value) {
        return value == null ? "native result missing" : new String(value, StandardCharsets.UTF_8);
    }

    private void appendRuntimeLog(String line) {
        Log.i(TAG, "SPINON_RUNTIME_UI " + line);
        runOnUiThread(() -> {
            if (activityClosing || runtimeLog == null) return;
            runtimeLog.append(line);
            runtimeLog.append("\n\n");
        });
    }

    @Override
    protected void onPause() {
        if (r13Surface != null) {
            r13Surface.onHostPaused();
            r13WasPaused = true;
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (r13Surface != null && r13WasPaused) {
            r13WasPaused = false;
            r13Surface.onHostResumed();
        }
    }

    @Override
    protected void onDestroy() {
        activityClosing = true;
        bootstrapExecutor.shutdownNow();
        delayedHost.shutdownNow();
        runtimeCalls.shutdown();
        try {
            runtimeControl.execute(() -> {
                long handle = runtimeSession;
                if (handle != 0) nativeSessionCancel(handle);
                boolean interrupted = false;
                while (!runtimeCalls.isTerminated()) {
                    try {
                        runtimeCalls.awaitTermination(Long.MAX_VALUE, TimeUnit.NANOSECONDS);
                    } catch (InterruptedException error) {
                        interrupted = true;
                    }
                }
                handle = runtimeSession;
                if (handle != 0) {
                    nativeSessionFree(handle);
                    runtimeSession = 0;
                }
                if (interrupted) Thread.currentThread().interrupt();
            });
        } catch (RejectedExecutionException error) {
            Log.w(TAG, "R06 종료 정리 작업을 큐에 넣지 못했습니다", error);
        }
        runtimeControl.shutdown();
        super.onDestroy();
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
        int inset = Math.round(18 * density);
        text.setPadding(inset, Math.round(24 * density), inset, Math.round(24 * density));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(14, 19, 31));
        scroll.addView(text);
        setContentView(scroll);
        scroll.post(() -> scroll.scrollTo(0, 0));
    }

    private String r10Report(String output) {
        String[] markers = {"SPINON_TAFFY_R10_RESULT=", "SPINON_TAFFY_R10_ERROR="};
        for (String marker : markers) {
            int start = output.indexOf(marker);
            if (start >= 0) {
                return formatR10Report(output.substring(start + marker.length()).trim());
            }
        }
        return formatR10Report(output);
    }

    private String formatR10Report(String report) {
        return report
                .replace(" nodes=", "\nnodes=")
                .replace(" text-id=", "\ntext-id=")
                .replace(" measured=", "\nmeasured=")
                .replace(" rtl=", "\nrtl=")
                .replace(" ltr-button-offset=", "\nltr-button-offset=")
                .replace(" rtl-text-offset=", "\nrtl-text-offset=")
                .replace(" update=equivalent", "\nupdate=equivalent")
                .replace(" rounding=[", "\nrounding:\n  ")
                .replace(",physical-pixel=", "\n  physical-pixel=")
                .replace(",float=", "\n  float=")
                .replace("] update-us-p50=", "\nupdate-us: p50=")
                .replace(" update-us-p95=", " p95=")
                .replace(" rebuild-us-p50=", "\nrebuild-us: p50=")
                .replace(" rebuild-us-p95=", " p95=")
                .replace(" iterations=", "\niterations=");
    }
}
