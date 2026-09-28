#import "SpinonRunner.h"

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

+ (void)destroyR08Wgpu:(void *)renderer {
  spinon_wgpu_destroy(renderer);
}

@end
