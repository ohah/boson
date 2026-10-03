#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>
#include <jni.h>

#include "spinon_ffi.h"
#include "spinon_wgpu_r08.h"

#include <array>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace {
constexpr char kTag[] = "SpinonBootstrap";

struct WgpuRendererContext {
  ANativeWindow *window;
  void *renderer;
};

jbyteArray ToByteArray(JNIEnv *env, const std::string &value) {
  const auto length = static_cast<jsize>(value.size());
  jbyteArray output = env->NewByteArray(length);
  if (output == nullptr) return nullptr;
  env->SetByteArrayRegion(output, 0, length,
                          reinterpret_cast<const jbyte *>(value.data()));
  return env->ExceptionCheck() ? nullptr : output;
}

SpinonRuntimeSession *SessionFromHandle(jlong handle) {
  return reinterpret_cast<SpinonRuntimeSession *>(static_cast<uintptr_t>(handle));
}
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_spinon_bootstrap_MainActivity_nativeRun(JNIEnv *env, jclass,
                                                  jbyteArray source, jfloat width,
                                                  jfloat height, jfloat density,
                                                  jboolean run_r10) {
  if (source == nullptr) return nullptr;
  const jsize source_length = env->GetArrayLength(source);
  std::vector<char> source_utf8(static_cast<size_t>(source_length) + 1);
  env->GetByteArrayRegion(source, 0, source_length,
                          reinterpret_cast<jbyte *>(source_utf8.data()));
  if (env->ExceptionCheck()) return nullptr;
  source_utf8[static_cast<size_t>(source_length)] = '\0';

  std::array<char, 512> output{};
  const int32_t result = spinon_app_run(source_utf8.data(), output.data(), output.size());
  std::string result_text(output.data());

  if (result != 0) {
    __android_log_print(ANDROID_LOG_ERROR, kTag,
                        "SPINON_BOOTSTRAP_ERROR code=%d detail=%s", result,
                        output.data());
  }
  if (run_r10 == JNI_TRUE) {
    std::array<char, 2048> layout_output{};
    const int32_t layout_result = spinon_taffy_r10_run(
        width, height, density, layout_output.data(), layout_output.size());
    if (layout_result == 0) {
      __android_log_print(ANDROID_LOG_INFO, kTag,
                          "SPINON_TAFFY_R10_RESULT=%s", layout_output.data());
      result_text += "\n\nSPINON_TAFFY_R10_RESULT=";
      result_text += layout_output.data();
    } else {
      __android_log_print(ANDROID_LOG_ERROR, kTag,
                          "SPINON_TAFFY_R10_ERROR code=%d detail=%s",
                          layout_result, layout_output.data());
      result_text += "\n\nSPINON_TAFFY_R10_ERROR=";
      result_text += layout_output.data();
    }
  }
  const auto output_length = static_cast<jsize>(result_text.size());
  jbyteArray result_array = env->NewByteArray(output_length);
  if (result_array == nullptr) return nullptr;
  env->SetByteArrayRegion(result_array, 0, output_length,
                          reinterpret_cast<const jbyte *>(result_text.data()));
  if (env->ExceptionCheck()) return nullptr;
  return result_array;
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeCreate(JNIEnv *env, jclass,
                                                       jobject surface,
                                                       jint width, jint height,
                                                       jint backend) {
  ANativeWindow *window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kTag,
                        "SPINON_R08_WGPU_ERROR=ANativeWindow unavailable");
    return 0;
  }
  char output[512] = {};
  void *renderer = spinon_wgpu_create_android(
      window, static_cast<uint32_t>(width), static_cast<uint32_t>(height),
      static_cast<uint32_t>(backend), output, sizeof(output));
  if (renderer == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kTag,
                        "SPINON_R08_WGPU_ERROR=%s", output);
    ANativeWindow_release(window);
    return 0;
  }
  __android_log_print(ANDROID_LOG_INFO, kTag,
                      "SPINON_R08_WGPU=ready %s", output);
  auto *context = new WgpuRendererContext{window, renderer};
  return reinterpret_cast<jlong>(context);
}

#if defined(SPINON_ENABLE_S04_ANDROID_FIXTURE)
extern "C" JNIEXPORT jlong JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeCreateS04(
    JNIEnv *env, jclass, jobject surface, jint width, jint height, jint backend,
    jfloat density, jlong surface_generation) {
  ANativeWindow *window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kTag,
                        "SPINON_S04_RENDERER_ERROR=ANativeWindow unavailable");
    return 0;
  }
  char output[1024] = {};
  void *renderer = spinon_wgpu_create_android_s04(
      window, static_cast<uint32_t>(width), static_cast<uint32_t>(height),
      static_cast<uint32_t>(backend), density,
      static_cast<uint64_t>(surface_generation), output, sizeof(output));
  if (renderer == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kTag,
                        "SPINON_S04_RENDERER_ERROR=%s", output);
    ANativeWindow_release(window);
    return 0;
  }
  __android_log_print(ANDROID_LOG_INFO, kTag,
                      "SPINON_S04_RENDERER=ready surface_generation=%lld size=%dx%d density=%.4f %s",
                      static_cast<long long>(surface_generation), width, height,
                      static_cast<double>(density), output);
  auto *context = new WgpuRendererContext{window, renderer};
  return reinterpret_cast<jlong>(context);
}
#else
extern "C" JNIEXPORT jlong JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeCreateS04(JNIEnv *, jclass,
                                                          jobject, jint, jint,
                                                          jint, jfloat, jlong) {
  __android_log_print(ANDROID_LOG_ERROR, kTag,
                      "SPINON_S04_FIXTURE=disabled rebuild with SPINON_ENABLE_S04_ANDROID_FIXTURE=1");
  return 0;
}
#endif

extern "C" JNIEXPORT jint JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeDraw(JNIEnv *, jclass,
                                                     jlong handle,
                                                     jint activation_count) {
  auto *context = reinterpret_cast<WgpuRendererContext *>(handle);
  if (context == nullptr) return -1;
  char output[512] = {};
  const int32_t result = spinon_wgpu_draw(
      context->renderer, static_cast<uint32_t>(activation_count), output,
      sizeof(output));
  if (result != 0) {
    __android_log_print(ANDROID_LOG_ERROR, kTag,
                        "SPINON_R08_WGPU_DRAW_ERROR code=%d detail=%s",
                        result, output);
  }
  return result;
}

#if defined(SPINON_ENABLE_S04_ANDROID_FIXTURE)
extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeDrawS04(JNIEnv *env, jclass,
                                                        jlong handle) {
  auto *context = reinterpret_cast<WgpuRendererContext *>(handle);
  if (context == nullptr) return ToByteArray(env, "status=-1 null renderer");
  std::array<char, 1024> output{};
  const int32_t result = spinon_wgpu_s04_draw(
      context->renderer, output.data(), output.size());
  const std::string report =
      "status=" + std::to_string(result) + " " + output.data();
  __android_log_print(result == 0 ? ANDROID_LOG_INFO : ANDROID_LOG_ERROR, kTag,
                      "SPINON_S04_FRAME %s", report.c_str());
  return ToByteArray(env, report);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativePollS04Readback(JNIEnv *env,
                                                                jclass,
                                                                jlong handle) {
  auto *context = reinterpret_cast<WgpuRendererContext *>(handle);
  if (context == nullptr) return ToByteArray(env, "status=-1 null renderer");
  std::array<char, 1024> output{};
  const int32_t result = spinon_wgpu_s04_poll_readback(
      context->renderer, output.data(), output.size());
  const std::string report =
      "status=" + std::to_string(result) + " " + output.data();
  if (result != 0) {
    __android_log_print(result > 0 ? ANDROID_LOG_INFO : ANDROID_LOG_ERROR, kTag,
                        "SPINON_S04_READBACK %s", report.c_str());
  }
  return ToByteArray(env, report);
}
#else
extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeDrawS04(JNIEnv *env, jclass,
                                                        jlong) {
  return ToByteArray(env, "status=-90 S04 Android fixture is disabled");
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativePollS04Readback(JNIEnv *env,
                                                                jclass,
                                                                jlong) {
  return ToByteArray(env, "status=-90 S04 Android fixture is disabled");
}
#endif

extern "C" JNIEXPORT jint JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeResize(JNIEnv *, jclass,
                                                       jlong handle,
                                                       jint width, jint height) {
  auto *context = reinterpret_cast<WgpuRendererContext *>(handle);
  if (context == nullptr) return -1;
  return spinon_wgpu_resize(context->renderer, static_cast<uint32_t>(width),
                            static_cast<uint32_t>(height));
}

#if defined(SPINON_ENABLE_S04_ANDROID_FIXTURE)
extern "C" JNIEXPORT jint JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeResizeS04(
    JNIEnv *, jclass, jlong handle, jint width, jint height, jfloat density,
    jlong surface_generation) {
  auto *context = reinterpret_cast<WgpuRendererContext *>(handle);
  if (context == nullptr) return -1;
  return spinon_wgpu_s04_resize(context->renderer,
                                static_cast<uint32_t>(width),
                                static_cast<uint32_t>(height), density,
                                static_cast<uint64_t>(surface_generation));
}
#else
extern "C" JNIEXPORT jint JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeResizeS04(JNIEnv *, jclass,
                                                          jlong, jint, jint,
                                                          jfloat, jlong) {
  return -90;
}
#endif

extern "C" JNIEXPORT jint JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeInjectFailure(JNIEnv *, jclass,
                                                              jlong handle,
                                                              jint failure_kind) {
  auto *context = reinterpret_cast<WgpuRendererContext *>(handle);
  if (context == nullptr) return -1;
  return spinon_wgpu_r13_inject_failure(context->renderer,
                                         static_cast<uint32_t>(failure_kind));
}

extern "C" JNIEXPORT void JNICALL
Java_dev_spinon_bootstrap_R08WgpuSurface_nativeDestroy(JNIEnv *, jclass,
                                                        jlong handle) {
  auto *context = reinterpret_cast<WgpuRendererContext *>(handle);
  if (context == nullptr) return;
  spinon_wgpu_destroy(context->renderer);
  ANativeWindow_release(context->window);
  delete context;
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_spinon_bootstrap_MainActivity_nativeSessionCreate(JNIEnv *, jclass) {
  std::array<char, 512> output{};
  SpinonRuntimeSession *session =
      spinon_runtime_session_new(output.data(), output.size());
  if (session == nullptr) {
    __android_log_print(ANDROID_LOG_ERROR, kTag,
                        "SPINON_RUNTIME_SESSION_CREATE_ERROR=%s", output.data());
    return 0;
  }
  __android_log_print(ANDROID_LOG_INFO, kTag, "SPINON_RUNTIME_SESSION=%s",
                      output.data());
  return static_cast<jlong>(reinterpret_cast<uintptr_t>(session));
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_spinon_bootstrap_MainActivity_nativeSessionEval(JNIEnv *env, jclass,
                                                          jlong handle,
                                                          jbyteArray source) {
  if (handle == 0 || source == nullptr) return nullptr;
  const jsize source_length = env->GetArrayLength(source);
  std::vector<char> source_utf8(static_cast<size_t>(source_length) + 1);
  env->GetByteArrayRegion(source, 0, source_length,
                          reinterpret_cast<jbyte *>(source_utf8.data()));
  if (env->ExceptionCheck()) return nullptr;
  source_utf8[static_cast<size_t>(source_length)] = '\0';
  std::array<char, 2048> output{};
  const int32_t status = spinon_runtime_session_eval(
      SessionFromHandle(handle), source_utf8.data(), output.data(), output.size());
  const std::string report = "status=" + std::to_string(status) + " " + output.data();
  __android_log_print(status == 0 ? ANDROID_LOG_INFO : ANDROID_LOG_WARN, kTag,
                      "SPINON_RUNTIME_EVAL=%s", report.c_str());
  return ToByteArray(env, report);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_spinon_bootstrap_MainActivity_nativeSessionPriorityProbe(JNIEnv *env, jclass) {
  std::array<char, 4096> output{};
  const int32_t status =
      spinon_runtime_priority_probe(output.data(), output.size());
  const std::string report =
      "status=" + std::to_string(status) + " " + output.data();
  __android_log_print(status == 0 ? ANDROID_LOG_INFO : ANDROID_LOG_ERROR, kTag,
                      "SPINON_PRIORITY_PROBE %s", report.c_str());
  return ToByteArray(env, report);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_spinon_bootstrap_MainActivity_nativeSessionDispatch(JNIEnv *env, jclass,
                                                              jlong handle,
                                                              jint node_id) {
  if (handle == 0) return nullptr;
  std::array<char, 2048> output{};
  const int32_t status = spinon_runtime_session_dispatch(
      SessionFromHandle(handle), node_id, output.data(), output.size());
  const std::string report = "status=" + std::to_string(status) + " " + output.data();
  __android_log_print(status == 0 ? ANDROID_LOG_INFO : ANDROID_LOG_WARN, kTag,
                      "SPINON_RUNTIME_DISPATCH=%s", report.c_str());
  return ToByteArray(env, report);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_spinon_bootstrap_MainActivity_nativeSessionCancel(JNIEnv *, jclass,
                                                            jlong handle) {
  if (handle == 0) return -1;
  const int32_t status = spinon_runtime_session_cancel(SessionFromHandle(handle));
  __android_log_print(ANDROID_LOG_INFO, kTag, "SPINON_RUNTIME_CANCEL status=%d",
                      status);
  return status;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_spinon_bootstrap_MainActivity_nativeSessionFree(JNIEnv *, jclass,
                                                          jlong handle) {
  if (handle == 0) return;
  __android_log_print(ANDROID_LOG_INFO, kTag, "SPINON_RUNTIME_SESSION_FREE start");
  spinon_runtime_session_free(SessionFromHandle(handle));
  __android_log_print(ANDROID_LOG_INFO, kTag, "SPINON_RUNTIME_SESSION_FREE done");
}
