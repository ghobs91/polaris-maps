/// Thin ObjC bridge that avoids importing PolarisMaps-Swift.h (which drags in
/// ExpoModulesProvider → ModulesProvider and breaks the build).  Instead we
/// forward-declare only the two CarPlayController methods we need — the actual
/// implementations come from the compiled Swift code via the @objc attribute.
#import "CarPlayBridge.h"

@interface CarPlayController : NSObject
+ (CarPlayController *)shared;
- (void)connectWithInterfaceController:(CPInterfaceController *)interfaceController
                                window:(CPWindow *)window;
- (void)disconnect;
@end

void PolarisCarPlayConnect(CPInterfaceController *interfaceController, CPWindow *window) {
  [[CarPlayController shared] connectWithInterfaceController:interfaceController window:window];
}

void PolarisCarPlayDisconnect(void) {
  [[CarPlayController shared] disconnect];
}
