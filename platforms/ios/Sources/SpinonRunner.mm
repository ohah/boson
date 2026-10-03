#import "SpinonRunner.h"

#include <array>
#include <cstdint>

#include "spinon_ffi.h"
#include "spinon_wgpu_r08.h"

#import <os/log.h>

@implementation SpinonRunner

+ (NSString *)runSource:(NSString *)source {
  const char *source_utf8 = source.UTF8String;
  if (source_utf8 == nullptr) return @"invalid JavaScript source";

  char output[512] = {};
  const int32_t result = spinon_app_run(source_utf8, output, sizeof(output));
  NSString *message = [NSString stringWithUTF8String:output];
  if (result != 0) {
    os_log_error(OS_LOG_DEFAULT, "SPINON_BOOTSTRAP_ERROR code=%{public}d detail=%{public}@",
                 result, message);
  }
  return message ?: @"empty bootstrap result";
}

+ (NSString *)runTaffyR10WithWidth:(float)width height:(float)height scale:(float)scale {
  char output[2048] = {};
  const int32_t result =
      spinon_taffy_r10_run(width, height, scale, output, sizeof(output));
  NSString *message = [NSString stringWithUTF8String:output];
  if (result != 0) {
    os_log_error(OS_LOG_DEFAULT,
                 "SPINON_TAFFY_R10_ERROR code=%{public}d detail=%{public}@",
                 result, message);
  }
  return message ?: @"empty R10 report";
}

+ (void *)createR08WgpuWithUIKitView:(void *)view width:(uint32_t)width height:(uint32_t)height {
  char output[512] = {};
  void *renderer = spinon_wgpu_create_uikit(
      view, width, height, SPINON_WGPU_R08_METAL, output, sizeof(output));
  NSString *message = [NSString stringWithUTF8String:output];
  if (renderer == nullptr) {
    os_log_error(OS_LOG_DEFAULT, "SPINON_R08_WGPU_ERROR=%{public}@", message);
    return nullptr;
  }
  os_log(OS_LOG_DEFAULT, "SPINON_R08_WGPU=ready %{public}@", message);
  return renderer;
}

+ (BOOL)isS04IosFixtureEnabled {
#if defined(SPINON_ENABLE_S04_IOS_FIXTURE) && SPINON_ENABLE_S04_IOS_FIXTURE
  return YES;
#else
  return NO;
#endif
}

+ (void *)createS04WgpuWithUIKitView:(void *)view
                               width:(uint32_t)width
                              height:(uint32_t)height
                             density:(float)density
                   surfaceGeneration:(uint64_t)surfaceGeneration {
#if defined(SPINON_ENABLE_S04_IOS_FIXTURE) && SPINON_ENABLE_S04_IOS_FIXTURE
  std::array<char, 2048> output{};
  void *renderer = spinon_wgpu_create_uikit_s04(
      view, width, height, SPINON_WGPU_R08_METAL, density, surfaceGeneration,
      output.data(), output.size());
  if (renderer == nullptr) {
    os_log_error(OS_LOG_DEFAULT,
                 "SPINON_S04_RENDERER=failed surface_generation=%{public}llu detail=%{public}s",
                 surfaceGeneration, output.data());
    return nullptr;
  }
  os_log(OS_LOG_DEFAULT,
         "SPINON_S04_RENDERER=ready surface_generation=%{public}llu size=%{public}ux%{public}u density=%{public}.4f %{public}s",
         surfaceGeneration, width, height, density, output.data());
  return renderer;
#else
  (void)view;
  (void)width;
  (void)height;
  (void)density;
  (void)surfaceGeneration;
  os_log(OS_LOG_DEFAULT,
         "SPINON_S04_FIXTURE=disabled rebuild with SPINON_ENABLE_S04_IOS_FIXTURE=1");
  return nullptr;
#endif
}

+ (NSString *)drawS04Wgpu:(void *)renderer {
#if defined(SPINON_ENABLE_S04_IOS_FIXTURE) && SPINON_ENABLE_S04_IOS_FIXTURE
  std::array<char, 2048> output{};
  const int32_t status =
      spinon_wgpu_s04_draw(renderer, output.data(), output.size());
  NSString *message = [NSString stringWithUTF8String:output.data()];
  if (status == 0) {
    os_log(OS_LOG_DEFAULT, "SPINON_S04_FRAME status=%{public}d %{public}@",
           status, message ?: @"empty report");
  } else {
    os_log_error(OS_LOG_DEFAULT,
                 "SPINON_S04_FRAME status=%{public}d detail=%{public}@",
                 status, message ?: @"empty report");
  }
  return [NSString stringWithFormat:@"status=%d %@", status,
                                    message ?: @"empty report"];
#else
  (void)renderer;
  return @"status=-1 fixture-disabled";
#endif
}

+ (NSString *)pollS04Readback:(void *)renderer {
#if defined(SPINON_ENABLE_S04_IOS_FIXTURE) && SPINON_ENABLE_S04_IOS_FIXTURE
  std::array<char, 2048> output{};
  const int32_t status = spinon_wgpu_s04_poll_readback(
      renderer, output.data(), output.size());
  NSString *message = [NSString stringWithUTF8String:output.data()];
  if (status == 1) {
    os_log(OS_LOG_DEFAULT, "SPINON_S04_READBACK status=%{public}d %{public}@",
           status, message ?: @"empty report");
  } else if (status < 0) {
    os_log_error(OS_LOG_DEFAULT,
                 "SPINON_S04_READBACK status=%{public}d detail=%{public}@",
                 status, message ?: @"empty report");
  }
  return [NSString stringWithFormat:@"status=%d %@", status,
                                    message ?: @"empty report"];
#else
  (void)renderer;
  return @"status=-1 fixture-disabled";
#endif
}

+ (int32_t)resizeS04Wgpu:(void *)renderer
                   width:(uint32_t)width
                  height:(uint32_t)height
                 density:(float)density
       surfaceGeneration:(uint64_t)surfaceGeneration {
#if defined(SPINON_ENABLE_S04_IOS_FIXTURE) && SPINON_ENABLE_S04_IOS_FIXTURE
  const int32_t status = spinon_wgpu_s04_resize(
      renderer, width, height, density, surfaceGeneration);
  if (status != 0) {
    os_log_error(OS_LOG_DEFAULT,
                 "SPINON_S04_RESIZE status=%{public}d surface_generation=%{public}llu",
                 status, surfaceGeneration);
  }
  return status;
#else
  (void)renderer;
  (void)width;
  (void)height;
  (void)density;
  (void)surfaceGeneration;
  return -1;
#endif
}

+ (int32_t)drawR08Wgpu:(void *)renderer activationCount:(uint32_t)activationCount {
  char output[512] = {};
  const int32_t result = spinon_wgpu_draw(renderer, activationCount, output, sizeof(output));
  if (result != 0) {
    NSString *message = [NSString stringWithUTF8String:output];
    os_log_error(OS_LOG_DEFAULT, "SPINON_R08_WGPU_DRAW_ERROR code=%{public}d detail=%{public}@",
                 result, message);
  }
  return result;
}

+ (int32_t)resizeR08Wgpu:(void *)renderer width:(uint32_t)width height:(uint32_t)height {
  return spinon_wgpu_resize(renderer, width, height);
}

+ (int32_t)injectR13Failure:(void *)renderer kind:(uint32_t)failureKind {
  return spinon_wgpu_r13_inject_failure(renderer, failureKind);
}

+ (void)destroyR08Wgpu:(void *)renderer {
  spinon_wgpu_destroy(renderer);
}

+ (uint64_t)createRuntimeSession {
  std::array<char, 512> output{};
  SpinonRuntimeSession *session =
      spinon_runtime_session_new(output.data(), output.size());
  if (session == nullptr) {
    os_log_error(OS_LOG_DEFAULT, "SPINON_RUNTIME_SESSION_CREATE_ERROR=%{public}s",
                 output.data());
    return 0;
  }
  os_log(OS_LOG_DEFAULT, "SPINON_RUNTIME_SESSION=%{public}s", output.data());
  return static_cast<uint64_t>(reinterpret_cast<uintptr_t>(session));
}

+ (NSString *)runRuntimePriorityProbe {
  std::array<char, 4096> output{};
  const int32_t status =
      spinon_runtime_priority_probe(output.data(), output.size());
  NSString *message = [NSString stringWithUTF8String:output.data()];
  if (status == 0) {
    os_log(OS_LOG_DEFAULT, "SPINON_PRIORITY_PROBE status=%{public}d %{public}@",
           status, message ?: @"empty report");
  } else {
    os_log_error(OS_LOG_DEFAULT,
                 "SPINON_PRIORITY_PROBE status=%{public}d %{public}@",
                 status, message ?: @"empty report");
  }
  return [NSString stringWithFormat:@"status=%d %@", status,
                                    message ?: @"empty report"];
}

+ (NSString *)evalRuntimeSession:(uint64_t)handle source:(NSString *)source {
  const char *sourceUTF8 = source.UTF8String;
  if (handle == 0 || sourceUTF8 == nullptr) return @"status=-1 invalid session or source";
  std::array<char, 2048> output{};
  const int32_t status = spinon_runtime_session_eval(
      reinterpret_cast<SpinonRuntimeSession *>(static_cast<uintptr_t>(handle)),
      sourceUTF8, output.data(), output.size());
  NSString *message = [NSString stringWithUTF8String:output.data()];
  if (status == 0) {
    os_log(OS_LOG_DEFAULT, "SPINON_RUNTIME_EVAL status=%{public}d %{public}@",
           status, message ?: @"empty report");
  } else {
    os_log_error(OS_LOG_DEFAULT, "SPINON_RUNTIME_EVAL status=%{public}d %{public}@",
                 status, message ?: @"empty report");
  }
  return [NSString stringWithFormat:@"status=%d %@", status,
                                    message ?: @"empty report"];
}

+ (NSString *)dispatchRuntimeSession:(uint64_t)handle nodeID:(int32_t)nodeID {
  if (handle == 0) return @"status=-1 invalid session";
  std::array<char, 2048> output{};
  const int32_t status = spinon_runtime_session_dispatch(
      reinterpret_cast<SpinonRuntimeSession *>(static_cast<uintptr_t>(handle)),
      nodeID, output.data(), output.size());
  NSString *message = [NSString stringWithUTF8String:output.data()];
  if (status == 0) {
    os_log(OS_LOG_DEFAULT, "SPINON_RUNTIME_DISPATCH status=%{public}d %{public}@",
           status, message ?: @"empty report");
  } else {
    os_log_error(OS_LOG_DEFAULT, "SPINON_RUNTIME_DISPATCH status=%{public}d %{public}@",
                 status, message ?: @"empty report");
  }
  return [NSString stringWithFormat:@"status=%d %@", status,
                                    message ?: @"empty report"];
}

+ (int32_t)cancelRuntimeSession:(uint64_t)handle {
  if (handle == 0) return -1;
  const int32_t status = spinon_runtime_session_cancel(
      reinterpret_cast<SpinonRuntimeSession *>(static_cast<uintptr_t>(handle)));
  os_log(OS_LOG_DEFAULT, "SPINON_RUNTIME_CANCEL status=%{public}d", status);
  return status;
}

+ (void)freeRuntimeSession:(uint64_t)handle {
  if (handle == 0) return;
  os_log(OS_LOG_DEFAULT, "SPINON_RUNTIME_SESSION_FREE start");
  spinon_runtime_session_free(
      reinterpret_cast<SpinonRuntimeSession *>(static_cast<uintptr_t>(handle)));
  os_log(OS_LOG_DEFAULT, "SPINON_RUNTIME_SESSION_FREE done");
}

@end
