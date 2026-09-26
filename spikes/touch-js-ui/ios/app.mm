#import <UIKit/UIKit.h>

#include "boson_touch.h"

@interface TouchController : UIViewController
@property(strong, nonatomic) UILabel *counter;
@property(strong, nonatomic) UIButton *button;
- (void)applyText:(NSString *)text;
@end

static void OnText(void *user_data, const char *text) {
  TouchController *controller = (__bridge TouchController *)user_data;
  [controller applyText:[NSString stringWithUTF8String:text]];
}

@implementation TouchController {
  void *_runtime;
}

- (void)viewDidLoad {
  [super viewDidLoad];
  self.view.backgroundColor = UIColor.systemBackgroundColor;

  self.counter = [[UILabel alloc] init];
  self.counter.text = @"Starting...";
  self.counter.font = [UIFont systemFontOfSize:32 weight:UIFontWeightSemibold];
  self.counter.textAlignment = NSTextAlignmentCenter;
  self.counter.accessibilityIdentifier = @"boson-counter";

  self.button = [UIButton buttonWithType:UIButtonTypeSystem];
  [self.button setTitle:@"Tap" forState:UIControlStateNormal];
  self.button.titleLabel.font = [UIFont systemFontOfSize:26 weight:UIFontWeightMedium];
  self.button.accessibilityIdentifier = @"boson-touch-button";
  [self.button addTarget:self action:@selector(tap) forControlEvents:UIControlEventTouchUpInside];

  UIStackView *stack = [[UIStackView alloc] initWithArrangedSubviews:@[self.counter, self.button]];
  stack.axis = UILayoutConstraintAxisVertical;
  stack.spacing = 28;
  stack.alignment = UIStackViewAlignmentFill;
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  [self.view addSubview:stack];
  [NSLayoutConstraint activateConstraints:@[
    [stack.centerXAnchor constraintEqualToAnchor:self.view.centerXAnchor],
    [stack.centerYAnchor constraintEqualToAnchor:self.view.centerYAnchor],
    [stack.widthAnchor constraintEqualToConstant:260],
    [self.counter.heightAnchor constraintEqualToConstant:60],
    [self.button.heightAnchor constraintEqualToConstant:64],
  ]];

  NSString *path = [[NSBundle mainBundle] pathForResource:@"touch" ofType:@"js"];
  NSError *error = nil;
  NSString *source = path ? [NSString stringWithContentsOfFile:path
                                                      encoding:NSUTF8StringEncoding
                                                         error:&error] : nil;
  if (!source) {
    self.counter.text = @"JS load failed";
    NSLog(@"BOSON_JS_LOAD_ERROR=%@", error);
    return;
  }
  _runtime = boson_touch_new(source.UTF8String, OnText, (__bridge void *)self);
  if (!_runtime) {
    self.counter.text = @"V8 init failed";
    NSLog(@"BOSON_TOUCH_INIT_FAILED");
  }
}

- (void)applyText:(NSString *)text {
  self.counter.text = text;
  NSLog(@"BOSON_JS_TEXT=%@", text);
}

- (void)tap {
  if (!_runtime) return;
  int result = boson_touch_dispatch(_runtime, 1);
  NSLog(@"BOSON_TOUCH_RESULT=%d text=%@", result, self.counter.text);
  if (result != 0) {
    NSLog(@"BOSON_TOUCH_ERROR=%s", boson_touch_last_error(_runtime));
  }
}

- (void)dealloc {
  boson_touch_free(_runtime);
}
@end

@interface TouchDelegate : UIResponder <UIApplicationDelegate>
@property(strong, nonatomic) UIWindow *window;
@end

@implementation TouchDelegate
- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)options {
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  self.window.rootViewController = [[TouchController alloc] init];
  [self.window makeKeyAndVisible];
  return YES;
}
@end

int main(int argc, char **argv) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass(TouchDelegate.class));
  }
}
