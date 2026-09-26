#include "boson_touch.h"

#include <android/log.h>
#include <jni.h>
#include <stdlib.h>

namespace {
struct TouchHandle {
  JavaVM *vm;
  jobject activity;
  jmethodID apply_text;
  void *runtime;
};

void OnText(void *user_data, const char *text) {
  auto *handle = static_cast<TouchHandle *>(user_data);
  JNIEnv *env = nullptr;
  bool attached = false;
  if (handle->vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) {
    if (handle->vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
    attached = true;
  }
  jstring value = env->NewStringUTF(text);
  if (value) {
    env->CallVoidMethod(handle->activity, handle->apply_text, value);
    env->DeleteLocalRef(value);
  }
  if (attached) handle->vm->DetachCurrentThread();
}
}

extern "C" JNIEXPORT jlong JNICALL
Java_dev_boson_touch_TouchActivity_nativeCreate(JNIEnv *env, jobject activity,
                                                 jstring source) {
  if (!source) return 0;
  auto *handle = static_cast<TouchHandle *>(calloc(1, sizeof(TouchHandle)));
  if (!handle) return 0;
  env->GetJavaVM(&handle->vm);
  handle->activity = env->NewGlobalRef(activity);
  jclass activity_class = env->GetObjectClass(activity);
  handle->apply_text = env->GetMethodID(activity_class, "applyText",
                                       "(Ljava/lang/String;)V");
  env->DeleteLocalRef(activity_class);
  if (!handle->activity || !handle->apply_text) {
    if (handle->activity) env->DeleteGlobalRef(handle->activity);
    free(handle);
    return 0;
  }

  const char *code = env->GetStringUTFChars(source, nullptr);
  if (code) {
    handle->runtime = boson_touch_new(code, OnText, handle);
    env->ReleaseStringUTFChars(source, code);
  }
  if (!handle->runtime) {
    env->DeleteGlobalRef(handle->activity);
    free(handle);
    return 0;
  }
  return reinterpret_cast<jlong>(handle);
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_boson_touch_TouchActivity_nativeTap(JNIEnv *, jobject, jlong value) {
  auto *handle = reinterpret_cast<TouchHandle *>(value);
  if (!handle || !handle->runtime) return -1;
  int result = boson_touch_dispatch(handle->runtime, 1);
  if (result != 0) {
    __android_log_print(ANDROID_LOG_ERROR, "BosonTouch", "BOSON_TOUCH_ERROR=%s",
                        boson_touch_last_error(handle->runtime));
  }
  return result;
}

extern "C" JNIEXPORT void JNICALL
Java_dev_boson_touch_TouchActivity_nativeDestroy(JNIEnv *env, jobject,
                                                  jlong value) {
  auto *handle = reinterpret_cast<TouchHandle *>(value);
  if (!handle) return;
  boson_touch_free(handle->runtime);
  env->DeleteGlobalRef(handle->activity);
  free(handle);
}
