#include "boson_app.h"
#include <android/log.h>
#include <jni.h>
#include <chrono>

namespace {
struct RenderContext { JNIEnv *env; jobject activity; jmethodID upsert; };

void OnFrame(void *value, int id, const char *tag, const char *text,
             int x, int y, int width, int height) {
  auto *ctx = static_cast<RenderContext *>(value);
  jstring java_tag = ctx->env->NewStringUTF(tag);
  jstring java_text = ctx->env->NewStringUTF(text);
  ctx->env->CallVoidMethod(ctx->activity, ctx->upsert, id, java_tag, java_text,
                           x, y, width, height);
  ctx->env->DeleteLocalRef(java_tag);
  ctx->env->DeleteLocalRef(java_text);
}

int Render(JNIEnv *env, jobject activity, void *runtime, int width, int height) {
  jclass cls = env->GetObjectClass(activity);
  auto begin = env->GetMethodID(cls, "beginFrame", "()V");
  auto upsert = env->GetMethodID(cls, "upsertNode", "(ILjava/lang/String;Ljava/lang/String;IIII)V");
  auto end = env->GetMethodID(cls, "endFrame", "()V");
  env->CallVoidMethod(activity, begin);
  RenderContext ctx{env, activity, upsert};
  int result = boson_app_layout(runtime, width, height, OnFrame, &ctx);
  env->CallVoidMethod(activity, end);
  env->DeleteLocalRef(cls);
  return result;
}
}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_dev_boson_tree_TreeActivity_nativeCreate(JNIEnv *env, jobject activity,
                                               jstring source, jint width, jint height) {
  if (!source) return 0;
  const char *code = env->GetStringUTFChars(source, nullptr);
  void *runtime = boson_app_new(code);
  env->ReleaseStringUTFChars(source, code);
  if (!runtime) return 0;
  if (Render(env, activity, runtime, width, height) != 0) { boson_app_free(runtime); return 0; }
  return reinterpret_cast<jlong>(runtime);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_boson_tree_TreeActivity_nativeTap(JNIEnv *env, jobject activity,
                                            jlong handle, jint id, jint width, jint height) {
  auto *runtime = reinterpret_cast<void *>(handle);
  auto start = std::chrono::steady_clock::now();
  int result = boson_app_dispatch(runtime, id);
  auto dispatched = std::chrono::steady_clock::now();
  if (result == 0) result = Render(env, activity, runtime, width, height);
  auto rendered = std::chrono::steady_clock::now();
  auto dispatch_us = std::chrono::duration_cast<std::chrono::microseconds>(dispatched - start).count();
  auto render_us = std::chrono::duration_cast<std::chrono::microseconds>(rendered - dispatched).count();
  __android_log_print(ANDROID_LOG_INFO, "BosonTree", "BOSON_METRIC dispatch_us=%lld render_us=%lld",
                      static_cast<long long>(dispatch_us), static_cast<long long>(render_us));
  if (result != 0)
    __android_log_print(ANDROID_LOG_ERROR, "BosonTree", "BOSON_JS_ERROR=%s", boson_app_last_error(runtime));
  return result;
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_boson_tree_TreeActivity_nativeRelayout(JNIEnv *env, jobject activity,
                                                 jlong handle, jint width, jint height) {
  auto *runtime = reinterpret_cast<void *>(handle);
  return runtime ? Render(env, activity, runtime, width, height) : -1;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_boson_tree_TreeActivity_nativeDestroy(JNIEnv *, jobject, jlong handle) {
  boson_app_free(reinterpret_cast<void *>(handle));
}
