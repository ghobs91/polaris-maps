#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PolarisLiveActivity, NSObject)

RCT_EXTERN_METHOD(isSupported:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(startActivity:(double)etaSeconds
                  remainingDistanceMeters:(double)remainingDistanceMeters
                  maneuverType:(NSString *)maneuverType
                  maneuverInstruction:(NSString *)maneuverInstruction
                  streetName:(NSString *)streetName
                  destinationName:(NSString *)destinationName
                  transportMode:(NSString *)transportMode)

RCT_EXTERN_METHOD(updateActivity:(double)etaSeconds
                  remainingDistanceMeters:(double)remainingDistanceMeters
                  maneuverType:(NSString *)maneuverType
                  maneuverInstruction:(NSString *)maneuverInstruction
                  streetName:(NSString *)streetName)

RCT_EXTERN_METHOD(endActivity)

@end
