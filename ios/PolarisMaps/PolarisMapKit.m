#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PolarisMapKit, NSObject)

RCT_EXTERN_METHOD(searchPOI:(NSString *)query
                  latitude:(double)latitude
                  longitude:(double)longitude
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
