#pragma once
#import <CarPlay/CarPlay.h>

/// Plain C bridge so AppDelegate.mm never has to import PolarisMaps-Swift.h
/// (which drags in ExpoModulesProvider → ModulesProvider and causes build errors).
void PolarisCarPlayConnect(CPInterfaceController *interfaceController, CPWindow *window);
void PolarisCarPlayDisconnect(void);
