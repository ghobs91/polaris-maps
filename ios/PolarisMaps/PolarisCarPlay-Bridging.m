//
//  PolarisCarPlay-Bridging.m
//  PolarisMaps
//
//  Obj-C bridge to expose the Swift PolarisCarPlay module to React Native.
//

#if !TARGET_OS_SIMULATOR
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(PolarisCarPlay, RCTEventEmitter)

RCT_EXTERN_METHOD(updateNavigation:(NSDictionary *)data)
RCT_EXTERN_METHOD(startNavigation:(NSDictionary *)data)
RCT_EXTERN_METHOD(endNavigation)
RCT_EXTERN_METHOD(pushSearchResults:(NSArray *)results)
RCT_EXTERN_METHOD(updateMapCenter:(double)lat lng:(double)lng heading:(double)heading)
RCT_EXTERN_METHOD(isConnected:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

@end
#endif
