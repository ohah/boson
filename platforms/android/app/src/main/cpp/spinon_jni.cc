#include <android/log.h>
#include <jni.h>

#include "spinon_ffi.h"

#include <array>
#include <cstring>
#include <string>
#include <vector>

namespace {
constexpr char kTag[] = "SpinonBootstrap";
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
