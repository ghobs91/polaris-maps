#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE (PolarisCarPlay, RCTEventEmitter)

RCT_EXTERN_METHOD(updateNavigation:(NSDictionary *)data)

RCT_EXTERN_METHOD(startNavigation:(NSDictionary *)data)

RCT_EXTERN_METHOD(endNavigation)

RCT_EXTERN_METHOD(showTripPreview:(NSDictionary *)data)

RCT_EXTERN_METHOD(hideTripPreview)

RCT_EXTERN_METHOD(showArrival:(NSDictionary *)data)

RCT_EXTERN_METHOD(showIncidentAlert:(NSDictionary *)data)

RCT_EXTERN_METHOD(updateIncidents:(NSArray *)incidents)

RCT_EXTERN_METHOD(updateMapStyle:(NSString *)json)

RCT_EXTERN_METHOD(updateRouteTraffic:(NSArray *)ranges)

RCT_EXTERN_METHOD(showReroutingAlert)

RCT_EXTERN_METHOD(hideNavigationAlert)

RCT_EXTERN_METHOD(pushSearchResults:(NSArray *)results
                  query : (NSString *)query
                  isFinal : (BOOL)isFinal)

RCT_EXTERN_METHOD(updateHomeSuggestions:(NSArray *)items)

RCT_EXTERN_METHOD(updateMapCenter:(double)lat
                  lng : (double)lng
                  heading : (double)heading)

RCT_EXTERN_METHOD(isConnected:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
