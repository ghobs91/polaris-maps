#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PolarisMapKit, NSObject)

RCT_EXTERN_METHOD(searchPOI:(NSString *)query
                  latitude:(double)latitude
                  longitude:(double)longitude
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(searchPlace:(NSString *)query
                  regionHint:(NSString *)regionHint
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(searchNearby:(NSString *)query
                  latitude:(double)latitude
                  longitude:(double)longitude
                  radiusMeters:(double)radiusMeters
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(searchPlaceAll:(NSString *)query
                  regionHint:(NSString *)regionHint
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
