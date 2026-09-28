#import <Foundation/Foundation.h>

@interface SpinonRunner : NSObject
+ (NSString *)runSource:(NSString *)source;
+ (NSString *)runTaffyR10WithWidth:(float)width height:(float)height scale:(float)scale;
@end
