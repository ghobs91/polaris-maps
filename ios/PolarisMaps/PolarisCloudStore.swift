import Foundation
import UIKit
import UniformTypeIdentifiers

/// Native module for iCloud Documents sync of place lists.
/// Reads/writes JSON files to the app's iCloud ubiquity container,
/// and presents a UIDocumentPickerViewController to import place files.
@objc(PolarisCloudStore)
class PolarisCloudStore: RCTEventEmitter, UIDocumentPickerDelegate {

  // Pending import promise callbacks
  private var importResolve: RCTPromiseResolveBlock?
  private var importReject: RCTPromiseRejectBlock?

  private var ubiquityURL: URL? {
    FileManager.default.url(forUbiquityContainerIdentifier: nil)?.appendingPathComponent("Documents")
  }

  private var metadataQuery: NSMetadataQuery?

  override init() {
    super.init()
    ensureDirectory()
    startMonitoring()
  }

  deinit {
    metadataQuery?.stop()
    NotificationCenter.default.removeObserver(self)
  }

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    return ["onCloudStoreChange"]
  }

  // MARK: - Public API

  @objc
  func isAvailable(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(ubiquityURL != nil)
  }

  @objc
  func write(
    _ filename: String,
    data: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let dir = ubiquityURL else {
      reject("E_NO_ICLOUD", "iCloud is not available", nil)
      return
    }

    // Sanitize filename to prevent directory traversal
    let sanitized = (filename as NSString).lastPathComponent
    guard !sanitized.isEmpty, sanitized == filename else {
      reject("E_INVALID_FILENAME", "Invalid filename", nil)
      return
    }

    let fileURL = dir.appendingPathComponent(sanitized)

    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let coordinator = NSFileCoordinator(filePresenter: nil)
        var coordError: NSError?
        var writeError: Error?

        coordinator.coordinate(writingItemAt: fileURL, options: .forReplacing, error: &coordError) { url in
          do {
            try data.write(to: url, atomically: true, encoding: .utf8)
          } catch {
            writeError = error
          }
        }

        if let error = coordError ?? writeError {
          reject("E_WRITE", error.localizedDescription, error)
        } else {
          resolve(true)
        }
      }
    }
  }

  @objc
  func read(
    _ filename: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let dir = ubiquityURL else {
      reject("E_NO_ICLOUD", "iCloud is not available", nil)
      return
    }

    let sanitized = (filename as NSString).lastPathComponent
    guard !sanitized.isEmpty, sanitized == filename else {
      reject("E_INVALID_FILENAME", "Invalid filename", nil)
      return
    }

    let fileURL = dir.appendingPathComponent(sanitized)

    DispatchQueue.global(qos: .userInitiated).async {
      let coordinator = NSFileCoordinator(filePresenter: nil)
      var coordError: NSError?
      var result: String?
      var readError: Error?

      coordinator.coordinate(readingItemAt: fileURL, options: [], error: &coordError) { url in
        do {
          result = try String(contentsOf: url, encoding: .utf8)
        } catch {
          readError = error
        }
      }

      if let error = coordError ?? readError {
        // File doesn't exist yet — return null, not an error
        resolve(nil)
      } else {
        resolve(result)
      }
    }
  }

  @objc
  func remove(
    _ filename: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let dir = ubiquityURL else {
      reject("E_NO_ICLOUD", "iCloud is not available", nil)
      return
    }

    let sanitized = (filename as NSString).lastPathComponent
    guard !sanitized.isEmpty, sanitized == filename else {
      reject("E_INVALID_FILENAME", "Invalid filename", nil)
      return
    }

    let fileURL = dir.appendingPathComponent(sanitized)

    DispatchQueue.global(qos: .userInitiated).async {
      do {
        try FileManager.default.removeItem(at: fileURL)
        resolve(true)
      } catch {
        resolve(false)
      }
    }
  }

  // MARK: - Document Picker

  @objc
  func pickDocument(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // Only one picker at a time
    if importResolve != nil {
      reject("E_PICKER_BUSY", "A document picker is already open", nil)
      return
    }
    importResolve = resolve
    importReject = reject

    DispatchQueue.main.async {
      var types: [UTType] = [.text, .json, .xml, .data, .commaSeparatedText]
      if let kml = UTType("application/vnd.google-earth.kml+xml") { types.append(kml) }
      if let gpx = UTType("application/gpx+xml") { types.append(gpx) }
      if let geojson = UTType("public.geojson") { types.append(geojson) }

      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
      picker.delegate = self
      picker.allowsMultipleSelection = false
      picker.modalPresentationStyle = .formSheet

      guard let root = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .first?
        .keyWindow?
        .rootViewController else {
        self.importResolve = nil
        self.importReject = nil
        reject("E_NO_VC", "No root view controller", nil)
        return
      }
      // Present from the top-most presented VC
      var top = root
      while let presented = top.presentedViewController { top = presented }
      top.present(picker, animated: true)
    }
  }

  // MARK: - UIDocumentPickerDelegate

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let url = urls.first else {
      importResolve?(nil)
      importResolve = nil
      importReject = nil
      return
    }
    let resolve = importResolve
    let reject = importReject
    importResolve = nil
    importReject = nil

    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let content = try String(contentsOf: url, encoding: .utf8)
        resolve?(["content": content, "name": url.lastPathComponent])
      } catch {
        reject?("E_READ", error.localizedDescription, error)
      }
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    importResolve?(nil)
    importResolve = nil
    importReject = nil
  }

  // MARK: - Private

  private func ensureDirectory() {
    guard let dir = ubiquityURL else { return }
    if !FileManager.default.fileExists(atPath: dir.path) {
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
  }

  private func startMonitoring() {
    guard ubiquityURL != nil else { return }

    let query = NSMetadataQuery()
    query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(format: "%K LIKE '*.json'", NSMetadataItemFSNameKey)
    self.metadataQuery = query

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(queryDidUpdate(_:)),
      name: .NSMetadataQueryDidUpdate,
      object: query
    )

    DispatchQueue.main.async {
      query.start()
    }
  }

  @objc private func queryDidUpdate(_ notification: Notification) {
    sendEvent(withName: "onCloudStoreChange", body: ["updated": true])
  }
}
