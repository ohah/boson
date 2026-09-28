#import "SpinonRunner.h"

#include "spinon_ffi.h"

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

@end
