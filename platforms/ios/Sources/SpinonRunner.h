#import <Foundation/Foundation.h>
#include <stddef.h>
#include <stdint.h>

@interface SpinonRunner : NSObject
+ (NSString *)runSource:(NSString *)source;
+ (NSString *)runTaffyR10WithWidth:(float)width height:(float)height scale:(float)scale;
+ (void *)createR08WgpuWithUIKitView:(void *)view width:(uint32_t)width height:(uint32_t)height;
+ (int32_t)drawR08Wgpu:(void *)renderer activationCount:(uint32_t)activationCount;
+ (int32_t)resizeR08Wgpu:(void *)renderer width:(uint32_t)width height:(uint32_t)height;
+ (int32_t)injectR13Failure:(void *)renderer kind:(uint32_t)failureKind;
+ (void)destroyR08Wgpu:(void *)renderer;
+ (uint64_t)createRuntimeSession;
+ (NSString *)evalRuntimeSession:(uint64_t)handle source:(NSString *)source;
+ (NSString *)dispatchRuntimeSession:(uint64_t)handle nodeID:(int32_t)nodeID;
+ (int32_t)cancelRuntimeSession:(uint64_t)handle;
+ (void)freeRuntimeSession:(uint64_t)handle;
@end
