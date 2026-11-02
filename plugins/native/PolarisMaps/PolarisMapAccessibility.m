/**
 * MapLibre accessibility-container patch.
 *
 * MLNMapView is a UIAccessibilityContainer whose two halves disagree:
 *
 *   -accessibilityElementCount      reports visiblePlaceFeatures.count +
 *                                   visibleRoadFeatures.count + annotations
 *   -accessibilityElementAtIndex:   re-queries those collections and indexes
 *                                   them without a bounds check
 *
 * Both calls hit a live map, so any content change between them (tile arrival,
 * a viewport POI refresh, a camera animation, a style swap) leaves a stale
 * index. The lookup then walks off the end of a std::vector / NSArray and the
 * process aborts with an uncaught C++ exception. Repro and analysis:
 * docs/map-accessibility-crash.md.
 *
 * That cannot be fixed upstream without rebuilding MapLibre (it ships as a
 * prebuilt SPM binary), so this category replaces the container with one that
 * never queries rendered features:
 *
 *   Map (zoom + hint) — stable text, no query
 *   Compass
 *   Attribution button
 *
 * VoiceOver therefore keeps a usable map element and the two map controls, and
 * loses the per-place / per-road labels that MapLibre derived from rendered
 * features. Those labels were also the crash path. Follow-up work to expose the
 * app's own POI names to VoiceOver belongs in JS (accessible overlay), not here.
 *
 * No MapLibre headers are imported: the class is resolved at runtime so this
 * file compiles in the app target even though MapLibre is only a transitive
 * SPM dependency of maplibre-react-native.
 */

#import <UIKit/UIKit.h>
#import <objc/runtime.h>

static NSString *const PMMapAccessibilityClassName = @"MLNMapView";

static UIAccessibilityElement *PMMakeMapElement(UIView *mapView) {
  UIAccessibilityElement *element =
      [[UIAccessibilityElement alloc] initWithAccessibilityContainer:mapView];
  element.accessibilityLabel = @"Map";
  element.accessibilityTraits = UIAccessibilityTraitNone;
  element.accessibilityFrameInContainerSpace = mapView.bounds;

  NSString *value = nil;
  @try {
    id zoom = [mapView valueForKey:@"zoomLevel"];
    if ([zoom isKindOfClass:[NSNumber class]]) {
      value = [NSString stringWithFormat:@"Zoom %ldx.", (long)llround([zoom doubleValue] + 1)];
    }
  } @catch (__unused NSException *exception) {
    // Property is absent in a future MapLibre release; the element still works.
  }
  element.accessibilityValue = value;
  element.accessibilityHint = @"Use the map controls to zoom and change layers.";
  return element;
}

static NSArray<id> *PMMapAccessibilityElements(UIView *mapView) {
  NSMutableArray<id> *elements = [NSMutableArray arrayWithCapacity:3];
  [elements addObject:PMMakeMapElement(mapView)];

  @try {
    id compass = [mapView valueForKey:@"compassView"];
    if ([compass isKindOfClass:[UIView class]] && ![(UIView *)compass isHidden]) {
      [elements addObject:compass];
    }
    id attribution = [mapView valueForKey:@"attributionButton"];
    if ([attribution isKindOfClass:[UIView class]] && ![(UIView *)attribution isHidden]) {
      [elements addObject:attribution];
    }
  } @catch (__unused NSException *exception) {
    // Keep whatever was collected; the map element alone is still valid.
  }
  return elements;
}

static NSInteger PMAccessibilityElementCount(id self, SEL _cmd) {
  return (NSInteger)PMMapAccessibilityElements((UIView *)self).count;
}

static id PMAccessibilityElementAtIndex(id self, SEL _cmd, NSInteger index) {
  NSArray<id> *elements = PMMapAccessibilityElements((UIView *)self);
  if (index < 0 || (NSUInteger)index >= elements.count) {
    return nil;
  }
  return elements[(NSUInteger)index];
}

static NSInteger PMIndexOfAccessibilityElement(id self, SEL _cmd, id element) {
  NSUInteger index = [PMMapAccessibilityElements((UIView *)self) indexOfObjectIdenticalTo:element];
  return index == NSNotFound ? NSNotFound : (NSInteger)index;
}

static NSString *PMAccessibilityValue(id self, SEL _cmd) {
  @try {
    id zoom = [self valueForKey:@"zoomLevel"];
    if ([zoom isKindOfClass:[NSNumber class]]) {
      return [NSString stringWithFormat:@"Zoom %ldx.", (long)llround([zoom doubleValue] + 1)];
    }
  } @catch (__unused NSException *exception) {
    // Fall through to nil.
  }
  return nil;
}

static void PMReplaceMethod(Class cls, SEL selector, IMP replacement, const char *types) {
  Method method = class_getInstanceMethod(cls, selector);
  if (method) {
    method_setImplementation(method, replacement);
  } else {
    // Not implemented anywhere in the chain (informal UIAccessibilityContainer
    // protocol); add it with an explicit signature.
    class_addMethod(cls, selector, replacement, types);
  }
}

static BOOL PMPatchInstalled = NO;

static void PMInstallMapAccessibilityPatch(void) {
  if (PMPatchInstalled) {
    return;
  }

  Class mapViewClass = NSClassFromString(PMMapAccessibilityClassName);
  if (!mapViewClass) {
    // MapLibre is not linked into this build (or not loaded yet); retry later.
    return;
  }

  PMReplaceMethod(mapViewClass, @selector(accessibilityElementCount),
                  (IMP)PMAccessibilityElementCount, "q@:");
  PMReplaceMethod(mapViewClass, @selector(accessibilityElementAtIndex:),
                  (IMP)PMAccessibilityElementAtIndex, "@@:q");
  PMReplaceMethod(mapViewClass, @selector(indexOfAccessibilityElement:),
                  (IMP)PMIndexOfAccessibilityElement, "q@:@");
  PMReplaceMethod(mapViewClass, @selector(accessibilityValue), (IMP)PMAccessibilityValue, "@@:");

  PMPatchInstalled = YES;

  // Kept outside #if DEBUG: one line at launch is the only way to confirm from
  // a release build that the container actually got replaced.
  NSLog(@"[PolarisMaps] MapLibre accessibility container replaced "
        @"(no rendered-feature queries).");
}

__attribute__((constructor)) static void PMMapAccessibilityInit(void) {
  PMInstallMapAccessibilityPatch();

  if (!PMPatchInstalled) {
    // MapLibre ships as a dynamic framework; if it is not loaded when this
    // image initialises, install once the app has finished launching.
    [[NSNotificationCenter defaultCenter]
        addObserverForName:UIApplicationDidFinishLaunchingNotification
                    object:nil
                     queue:[NSOperationQueue mainQueue]
                usingBlock:^(__unused NSNotification *note) {
                  PMInstallMapAccessibilityPatch();
                }];
  }
}
