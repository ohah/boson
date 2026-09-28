#import <Foundation/Foundation.h>
#include <stddef.h>
#include <stdint.h>

@interface SpinonRunner : NSObject
+ (NSString *)runSource:(NSString *)source;
+ (NSString *)runTaffyR10WithWidth:(float)width height:(float)height scale:(float)scale;
+ (void *)createR08WgpuWithUIKitView:(void *)view width:(uint32_t)width height:(uint32_t)height;
+ (int32_t)drawR08Wgpu:(void *)renderer activationCount:(uint32_t)activationCount;
+ (int32_t)resizeR08Wgpu:(void *)renderer width:(uint32_t)width height:(uint32_t)height;
+ (void)destroyR08Wgpu:(void *)renderer;
@end
