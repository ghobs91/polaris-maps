import Foundation
import React

/// Native bridge to the app's iCloud Drive ubiquity container.
///
/// Serialized place lists / favorites are stored as JSON files in the
/// container's `Documents` directory. Reads and writes go through
/// `NSFileCoordinator` so concurrent access is safe, and an `NSMetadataQuery`
/// observes remote changes and mirrors them to JS via the `onCloudStoreChange`
/// event.
///
/// This replaces the old `NSUbiquitousKeyValueStore` backing, which capped the
/// app at 1 MB of total key-value storage. Data already held in the key-value
/// store is migrated transparently on first read: when a file is missing, the
/// legacy key-value entry (if any) is written to the container and removed from
/// the key-value store.
@objc(PolarisCloudStore)
class PolarisCloudStore: RCTEventEmitter {

  /// Must match `com.apple.developer.ubiquity-container-identifiers`
  /// (see `plugins/withCloudStore.js`).
  private let containerID = "iCloud.\(Bundle.main.bundleIdentifier ?? "com.polarismaps.app")"

  /// Serial queue for the blocking iCloud / file-coordination work. Resolves
  /// promise callbacks from here; React Native marshals them back to JS.
  private let fileQueue = DispatchQueue(label: "com.polarismaps.cloudstore", qos: .utility)

  private var metadataQuery: NSMetadataQuery?
  private var observers: [NSObjectProtocol] = []

  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return ["onCloudStoreChange"]
  }

  // MARK: - Container helpers

  /// Resolves (and creates) the container's `Documents` directory.
  /// `url(forUbiquityContainerIdentifier:)` is blocking, so callers must be
  /// off the main thread.
  private func containerDocumentsURL() -> URL? {
    guard
      let container = FileManager.default.url(forUbiquityContainerIdentifier: containerID)
    else {
      return nil
    }
    let documents = container.appendingPathComponent("Documents", isDirectory: true)
    if !FileManager.default.fileExists(atPath: documents.path) {
      try? FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
    }
    return documents
  }

  private func fileURL(for filename: String, in documents: URL) -> URL {
    documents.appendingPathComponent((filename as NSString).lastPathComponent)
  }

  // MARK: - Observing

  override func startObserving() {
    DispatchQueue.main.async { [weak self] in
      self?.startMetadataQuery()
    }
  }

  override func stopObserving() {
    DispatchQueue.main.async { [weak self] in
      self?.stopMetadataQuery()
    }
  }

  private func startMetadataQuery() {
    guard metadataQuery == nil else { return }
    let query = NSMetadataQuery()
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(value: true)

    observers.append(
      NotificationCenter.default.addObserver(
        forName: .NSMetadataQueryDidFinishGathering, object: query, queue: .main
      ) { [weak self] _ in
        self?.sendEvent(withName: "onCloudStoreChange", body: [:])
      }
    )
    observers.append(
      NotificationCenter.default.addObserver(
        forName: .NSMetadataQueryDidUpdate, object: query, queue: .main
      ) { [weak self] _ in
        self?.sendEvent(withName: "onCloudStoreChange", body: [:])
      }
    )

    metadataQuery = query
    query.start()
  }

  private func stopMetadataQuery() {
    metadataQuery?.stop()
    metadataQuery = nil
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
  }

  // MARK: - Coordinated I/O

  private func coordinatedWrite(_ contents: String, to url: URL) -> Bool {
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordError: NSError?
    var success = false
    coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) {
      newURL in
      do {
        try contents.write(to: newURL, atomically: true, encoding: .utf8)
        success = true
      } catch {
        success = false
      }
    }
    return success && coordError == nil
  }

  private func coordinatedRead(_ url: URL) -> String? {
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordError: NSError?
    var contents: String?
    coordinator.coordinate(readingItemAt: url, options: [], error: &coordError) { readURL in
      contents = try? String(contentsOf: readURL, encoding: .utf8)
    }
    return coordError == nil ? contents : nil
  }

  // MARK: - Bridge methods

  /// Whether the iCloud Drive container is available for the signed-in account.
  @objc
  func isAvailable(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    fileQueue.async {
      resolve(self.containerDocumentsURL() != nil)
    }
  }

  @objc
  func write(
    _ filename: String,
    data: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    fileQueue.async {
      guard let documents = self.containerDocumentsURL() else {
        resolve(false)
        return
      }
      let url = self.fileURL(for: filename, in: documents)
      resolve(self.coordinatedWrite(data, to: url))
    }
  }

  @objc
  func read(
    _ filename: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    fileQueue.async {
      let legacyStore = NSUbiquitousKeyValueStore.default

      guard let documents = self.containerDocumentsURL() else {
        // iCloud Drive not resolvable right now — hand back any legacy value
        // (without mutating) so a transient outage doesn't look like data loss.
        resolve(legacyStore.string(forKey: filename))
        return
      }

      let url = self.fileURL(for: filename, in: documents)
      if let contents = self.coordinatedRead(url) {
        resolve(contents)
        return
      }

      // One-time migration from the legacy key-value store.
      if let legacy = legacyStore.string(forKey: filename) {
        if self.coordinatedWrite(legacy, to: url) {
          legacyStore.removeObject(forKey: filename)
          legacyStore.synchronize()
        }
        resolve(legacy)
        return
      }

      resolve(nil)
    }
  }

  @objc
  func remove(
    _ filename: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    fileQueue.async {
      let legacyStore = NSUbiquitousKeyValueStore.default
      legacyStore.removeObject(forKey: filename)
      legacyStore.synchronize()

      guard let documents = self.containerDocumentsURL() else {
        resolve(false)
        return
      }
      let url = self.fileURL(for: filename, in: documents)
      guard FileManager.default.fileExists(atPath: url.path) else {
        resolve(true)
        return
      }

      let coordinator = NSFileCoordinator(filePresenter: nil)
      var coordError: NSError?
      var success = false
      coordinator.coordinate(writingItemAt: url, options: .forDeleting, error: &coordError) { _ in
        do {
          try FileManager.default.removeItem(at: url)
          success = true
        } catch {
          success = false
        }
      }
      resolve(success && coordError == nil)
    }
  }
}
