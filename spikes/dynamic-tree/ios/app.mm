#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#include "boson_app.h"
#include <atomic>
#include <thread>
#include <vector>

@interface TreeController : UIViewController
- (void)upsertNode:(int)nodeId tag:(const char *)tag text:(const char *)text
                x:(int)x y:(int)y width:(int)width height:(int)height;
@end

static void OnFrame(void *user_data, int node_id, const char *tag, const char *text,
                    int x, int y, int width, int height) {
  TreeController *controller = (__bridge TreeController *)user_data;
  [controller upsertNode:node_id tag:tag text:text x:x y:y width:width height:height];
}

@implementation TreeController {
  UIView *_surface;
  NSMutableDictionary<NSNumber *, UIView *> *_views;
  NSMutableSet<NSNumber *> *_seen;
  void *_runtime;
  CGSize _lastSize;
  BOOL _failed;
  CADisplayLink *_frameProbe;
  CFTimeInterval _previousFrameTime;
  BOOL _contentionScenario;
  std::atomic<bool> _stopWorkers;
  std::atomic<uint64_t> _workerSink;
  std::vector<std::thread> _workers;
}

- (void)viewDidLoad {
  [super viewDidLoad];
  self.view.backgroundColor = [UIColor colorWithRed:0.969 green:0.976 blue:0.988 alpha:1];
  _surface = [[UIView alloc] init];
  _surface.translatesAutoresizingMaskIntoConstraints = NO;
  [self.view addSubview:_surface];
  UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
  [NSLayoutConstraint activateConstraints:@[
    [_surface.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor],
    [_surface.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor],
    [_surface.topAnchor constraintEqualToAnchor:safe.topAnchor],
    [_surface.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor],
  ]];
  _views = [[NSMutableDictionary alloc] init];
  _seen = [[NSMutableSet alloc] init];
  NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
  NSUInteger scenarioIndex = [args indexOfObject:@"--boson-scenario"];
  _contentionScenario = scenarioIndex != NSNotFound && scenarioIndex + 1 < args.count &&
      [args[scenarioIndex + 1] isEqualToString:@"contention"];
  NSString *script = _contentionScenario ? @"contention" : @"tree";
  NSString *path = [[NSBundle mainBundle] pathForResource:script ofType:@"js"];
  NSString *source = path ? [NSString stringWithContentsOfFile:path
                                                      encoding:NSUTF8StringEncoding
                                                         error:nil] : nil;
  if (_contentionScenario && source) {
    NSUInteger busyIndex = [args indexOfObject:@"--boson-busy-ms"];
    NSInteger busyMs = busyIndex != NSNotFound && busyIndex + 1 < args.count ?
        [args[busyIndex + 1] integerValue] : 40;
    busyMs = MAX(0, MIN(200, busyMs));
    source = [NSString stringWithFormat:@"const BOSON_BUSY_MS = %ld;\n%@", (long)busyMs, source];
    NSLog(@"BOSON_CONTENTION busy_ms=%ld max_refresh_hz=%ld", (long)busyMs,
          (long)UIScreen.mainScreen.maximumFramesPerSecond);
    NSUInteger workerIndex = [args indexOfObject:@"--boson-background-workers"];
    NSInteger workerCount = workerIndex != NSNotFound && workerIndex + 1 < args.count ?
        [args[workerIndex + 1] integerValue] : 0;
    workerCount = MAX(0, MIN(4, workerCount));
    _stopWorkers.store(false);
    for (NSInteger index = 0; index < workerCount; ++index) {
      _workers.emplace_back([stop = &_stopWorkers, sink = &_workerSink, index] {
        uint64_t value = (uint64_t)index + 1;
        while (!stop->load(std::memory_order_relaxed)) {
          for (int step = 0; step < 65536; ++step) {
            value ^= value << 13;
            value ^= value >> 7;
            value ^= value << 17;
          }
          sink->store(value, std::memory_order_relaxed);
        }
      });
    }
    NSLog(@"BOSON_BACKGROUND_WORKERS=%ld", (long)workerCount);
  }
  _runtime = source ? boson_app_new(source.UTF8String) : nullptr;
  if (_contentionScenario && _runtime) {
    _frameProbe = [CADisplayLink displayLinkWithTarget:self selector:@selector(probeFrame:)];
    [_frameProbe addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  }
  if (!_runtime) {
    UILabel *error = [[UILabel alloc] initWithFrame:CGRectMake(24, 24, 320, 60)];
    error.text = @"V8 or tree init failed";
    [_surface addSubview:error];
    NSLog(@"BOSON_IOS_INIT_FAILED");
  }
}

- (void)probeFrame:(CADisplayLink *)link {
  if (_previousFrameTime != 0) {
    NSLog(@"BOSON_FRAME_GAP_MS=%.3f", (link.timestamp - _previousFrameTime) * 1000.0);
  }
  _previousFrameTime = link.timestamp;
}

- (void)viewDidLayoutSubviews {
  [super viewDidLayoutSubviews];
  CGSize size = _surface.bounds.size;
  if (_runtime && size.width > 0 && size.height > 0 && !CGSizeEqualToSize(size, _lastSize)) {
    _lastSize = size;
    [self render];
    NSLog(@"BOSON_RESIZE width=%d height=%d", (int)round(size.width), (int)round(size.height));
  }
}

- (void)render {
  if (!_runtime) return;
  [_seen removeAllObjects];
  CGSize size = _surface.bounds.size;
  int result = boson_app_layout(_runtime, (int)round(size.width), (int)round(size.height),
                                OnFrame, (__bridge void *)self);
  for (NSNumber *nodeId in [_views.allKeys copy]) {
    if ([_seen containsObject:nodeId]) continue;
    [_views[nodeId] removeFromSuperview];
    [_views removeObjectForKey:nodeId];
    NSLog(@"BOSON_NODE_REMOVE id=%d", nodeId.intValue);
  }
  NSLog(@"BOSON_FRAME result=%d nodes=%lu", result, (unsigned long)_views.count);
}

- (void)upsertNode:(int)nodeId tag:(const char *)tag text:(const char *)text
                x:(int)x y:(int)y width:(int)width height:(int)height {
  NSString *kind = [NSString stringWithUTF8String:tag];
  if ([kind isEqualToString:@"column"] || [kind isEqualToString:@"row"]) return;
  NSNumber *key = @(nodeId);
  [_seen addObject:key];
  UIView *view = _views[key];
  if (!view) {
    if ([kind isEqualToString:@"button"]) {
      UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
      button.configuration = [UIButtonConfiguration filledButtonConfiguration];
      button.titleLabel.font = [UIFont systemFontOfSize:20 weight:UIFontWeightMedium];
      button.tag = nodeId;
      [button addTarget:self action:@selector(tap:) forControlEvents:UIControlEventTouchUpInside];
      view = button;
    } else {
      UILabel *label = [[UILabel alloc] init];
      label.font = [UIFont systemFontOfSize:nodeId == 2 ? 30 : 17];
      label.textColor = [UIColor colorWithRed:0.09 green:0.14 blue:0.23 alpha:1];
      view = label;
    }
    _views[key] = view;
    [_surface addSubview:view];
    NSLog(@"BOSON_NODE_CREATE id=%d tag=%@", nodeId, kind);
  }
  NSString *value = [NSString stringWithUTF8String:text];
  if ([view isKindOfClass:UIButton.class]) {
    [(UIButton *)view setTitle:value forState:UIControlStateNormal];
  } else {
    [(UILabel *)view setText:value];
  }
  view.accessibilityIdentifier = [NSString stringWithFormat:@"boson-node-%d", nodeId];
  view.accessibilityLabel = [NSString stringWithFormat:@"boson-node:%d:%@", nodeId, value];
  view.frame = CGRectMake(x, y, width, height);
  NSLog(@"BOSON_LAYOUT id=%d x=%d y=%d width=%d height=%d", nodeId, x, y, width, height);
}

- (void)tap:(UIButton *)button {
  if (_failed) return;
  CFTimeInterval started = CACurrentMediaTime();
  int result = boson_app_dispatch(_runtime, (int)button.tag);
  CFTimeInterval dispatched = CACurrentMediaTime();
  if (result == 0) [self render];
  else {
    _failed = YES;
    NSLog(@"BOSON_JS_ERROR=%s", boson_app_last_error(_runtime));
  }
  CFTimeInterval rendered = CACurrentMediaTime();
  if (_contentionScenario) NSLog(@"BOSON_METRIC dispatch_us=%.0f render_us=%.0f",
                                  (dispatched - started) * 1000000.0,
                                  (rendered - dispatched) * 1000000.0);
  NSLog(@"BOSON_TOUCH_RESULT=%d node=%ld", result, (long)button.tag);
}

- (void)dealloc {
  [_frameProbe invalidate];
  _stopWorkers.store(true);
  for (auto &worker : _workers) if (worker.joinable()) worker.join();
  boson_app_free(_runtime);
}
@end

@interface TreeDelegate : UIResponder <UIApplicationDelegate>
@property(strong, nonatomic) UIWindow *window;
@end

@implementation TreeDelegate
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)options {
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  self.window.rootViewController = [[TreeController alloc] init];
  [self.window makeKeyAndVisible];
  return YES;
}
@end

int main(int argc, char **argv) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass(TreeDelegate.class));
  }
}
