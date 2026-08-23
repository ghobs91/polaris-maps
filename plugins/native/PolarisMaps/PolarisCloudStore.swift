import Foundation
import React

/// Native bridge to iCloud Key-Value storage (NSUbiquitousKeyValueStore).
///
/// Stores the serialized place lists under a single key and mirrors remote
/// changes back to JS via the `onCloudStoreChange` event so the app can re-merge.
@objc(PolarisCloudStore)
class PolarisCloudStore: RCTEventEmitter {

  private let store = NSUbiquitousKeyValueStore.default

  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onCloudStoreChange"]
  }

  override func startObserving() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleStoreChange(_:)),
      name: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
      object: store
    )
  }

  override func stopObserving() {
    NotificationCenter.default.removeObserver(
      self,
      name: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
      object: store
    )
  }

  @objc func handleStoreChange(_ notification: Notification) {
    sendEvent(withName: "onCloudStoreChange", body: [:])
  }

  /// Whether an iCloud account is available for key-value sync.
  @objc
  func isAvailable(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(FileManager.default.ubiquityIdentityToken != nil)
  }

  @objc
  func write(
    _ filename: String,
    data: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    store.set(data, forKey: filename)
    resolve(store.synchronize())
  }

  @objc
  func read(
    _ filename: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(store.string(forKey: filename))
  }

  @objc
  func remove(
    _ filename: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    store.removeObject(forKey: filename)
    store.synchronize()
    resolve(true)
  }
}
