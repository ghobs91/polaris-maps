import Foundation
import Network

/// Native local HTTP tile server for Polaris Maps.
///
/// Serves files from registered source directories over loopback HTTP so
/// MapLibre's RasterSource/VectorSource can read locally cached tiles:
///
///   GET /{sourceId}/{path} → file at {sourceFile}/{path}
///
/// The traffic tile service registers the "traffic" source backed by the
/// app cache directory; tiles are seeded there by the JS trafficTileService
/// (disk → P2P → TomTom). No internet-facing listener: the server binds to
/// 127.0.0.1 only.
@objc(PolarisTileServer)
class PolarisTileServer: NSObject {
  /// A registered tile source: an unpacked `{z}/{x}/{y}.pbf` tree (packs
  /// downloaded before archives were served directly) or a PMTiles archive.
  private enum Source {
    case directory(String)
    case pmtiles(PolarisPmtilesArchive)

    var path: String {
      switch self {
      case .directory(let path): return path
      case .pmtiles(let archive): return archive.path
      }
    }
  }

  private let queue = DispatchQueue(label: "polaris.tile-server", qos: .utility)
  private let sourcesLock = NSLock()
  private var listener: NWListener?
  private var sources: [String: Source] = [:]
  private var port: UInt16 = 0
  private var isStarting = false
  private var pendingStartHandlers: [(RCTPromiseResolveBlock, RCTPromiseRejectBlock)] = []

  @objc
  func start(
    _ config: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async { [weak self] in
      guard let self = self else { return }

      if self.listener != nil && self.port > 0 {
        resolve(Int(self.port))
        return
      }

      self.pendingStartHandlers.append((resolve, reject))
      if self.isStarting {
        return
      }
      self.isStarting = true

      let requestedPort = (config["port"] as? NSNumber)?.uint16Value ?? 0

      let params = NWParameters.tcp
      params.allowLocalEndpointReuse = true
      if requestedPort > 0, let endpointPort = NWEndpoint.Port(rawValue: requestedPort) {
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: endpointPort)
      } else {
        // Ephemeral port, loopback only
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
      }

      do {
        let listener = try NWListener(using: params)
        listener.newConnectionHandler = { [weak self] connection in
          self?.handleConnection(connection)
        }
        listener.stateUpdateHandler = { [weak self] state in
          guard let self = self else { return }
          switch state {
          case .ready:
            let boundPort = listener.port?.rawValue ?? requestedPort
            self.port = boundPort
            self.isStarting = false
            let handlers = self.pendingStartHandlers
            self.pendingStartHandlers.removeAll()
            if boundPort == 0 {
              self.listener?.cancel()
              self.listener = nil
              for (_, rej) in handlers {
                rej("tile_server_bind_failed", "Unable to bind the tile server to 127.0.0.1", nil)
              }
            } else {
              for (res, _) in handlers {
                res(Int(boundPort))
              }
            }
          case .failed(let error):
            self.listener?.cancel()
            self.listener = nil
            self.port = 0
            self.isStarting = false
            let handlers = self.pendingStartHandlers
            self.pendingStartHandlers.removeAll()
            for (_, rej) in handlers {
              rej("tile_server_bind_failed", error.localizedDescription, error)
            }
          case .cancelled:
            self.isStarting = false
            let handlers = self.pendingStartHandlers
            self.pendingStartHandlers.removeAll()
            for (_, rej) in handlers {
              rej("tile_server_cancelled", "Tile server listener was cancelled", nil)
            }
          default:
            break
          }
        }
        self.listener = listener
        listener.start(queue: self.queue)
      } catch {
        self.isStarting = false
        let handlers = self.pendingStartHandlers
        self.pendingStartHandlers.removeAll()
        for (_, rej) in handlers {
          rej("tile_server_start_failed", error.localizedDescription, error)
        }
      }
    }
  }

  @objc
  func addSource(
    _ source: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let id = source["id"] as? String, let filePath = source["filePath"] as? String else {
      reject("tile_server_invalid_source", "Source requires id and filePath", nil)
      return
    }
    sourcesLock.lock()
    sources[id] = .directory(filePath)
    sourcesLock.unlock()
    resolve(nil)
  }

  /// Register a PMTiles archive as a source.
  ///
  /// The archive is served tile-by-tile through range reads, so a pack costs
  /// its download size on disk instead of one file per tile.
  @objc
  func addPmtilesSource(
    _ source: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let id = source["id"] as? String, let filePath = source["filePath"] as? String else {
      reject("tile_server_invalid_source", "Source requires id and filePath", nil)
      return
    }
    do {
      let archive = try PolarisPmtilesArchive(path: filePath)
      sourcesLock.lock()
      sources[id] = .pmtiles(archive)
      sourcesLock.unlock()
      resolve(nil)
    } catch {
      reject("tile_server_bad_pmtiles", error.localizedDescription, error)
    }
  }

  @objc
  func removeSource(
    _ sourceId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    sourcesLock.lock()
    sources.removeValue(forKey: sourceId)
    sourcesLock.unlock()
    resolve(nil)
  }

  @objc
  func listSources(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    sourcesLock.lock()
    let snapshot = sources.map { ["id": $0.key, "filePath": $0.value.path] }
    sourcesLock.unlock()
    resolve(snapshot)
  }

  @objc
  func stop(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    listener?.cancel()
    listener = nil
    port = 0
    resolve(nil)
  }

  @objc
  func getBaseUrl() -> String {
    return "http://127.0.0.1:\(port)"
  }

  // ── HTTP handling ──────────────────────────────────────────────────

  private func handleConnection(_ connection: NWConnection) {
    connection.start(queue: DispatchQueue(label: "polaris.tile-server.conn", qos: .utility))
    receiveHeaders(connection, buffer: Data())
  }

  private func receiveHeaders(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
      guard let self = self else {
        connection.cancel()
        return
      }

      var buffer = buffer
      if let data = data {
        buffer.append(data)
      }

      if let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
        let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
        let headerText = String(data: headerData, encoding: .utf8) ?? ""
        self.serveRequest(connection, headerText: headerText)
        return
      }

      if error != nil || isComplete || buffer.count > 32 * 1024 {
        connection.cancel()
        return
      }

      self.receiveHeaders(connection, buffer: buffer)
    }
  }

  private func serveRequest(_ connection: NWConnection, headerText: String) {
    let lines = headerText.components(separatedBy: "\r\n")
    guard let requestLine = lines.first else {
      respond(connection, status: "400 Bad Request", contentType: "text/plain", body: Data("bad request".utf8))
      return
    }

    let parts = requestLine.split(separator: " ")
    guard parts.count >= 2, parts[0] == "GET" else {
      respond(connection, status: "405 Method Not Allowed", contentType: "text/plain", body: Data("only GET is supported".utf8))
      return
    }

    // Percent-decode so font paths with spaces (e.g. "Noto%20Sans%20Regular")
    // resolve to the real on-disk directory names.
    let path = String(parts[1]).removingPercentEncoding ?? String(parts[1])
    let segments = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
    // Loopback-only, but reject traversal so a decoded path can't escape root.
    guard !segments.contains("..") else {
      respond(connection, status: "404 Not Found", contentType: "text/plain", body: Data("invalid path".utf8))
      return
    }
    guard let sourceId = segments.first else {
      respond(connection, status: "404 Not Found", contentType: "text/plain", body: Data("missing source".utf8))
      return
    }

    sourcesLock.lock()
    let source = sources[sourceId]
    sourcesLock.unlock()

    guard let source = source else {
      respond(connection, status: "404 Not Found", contentType: "text/plain", body: Data("unknown source".utf8))
      return
    }

    let relativePath = segments.dropFirst().joined(separator: "/")

    switch source {
    case .directory(let root):
      let fileUrl = URL(fileURLWithPath: root).appendingPathComponent(relativePath)

      guard let data = try? Data(contentsOf: fileUrl) else {
        respond(connection, status: "404 Not Found", contentType: "text/plain", body: Data("tile not found".utf8))
        return
      }

      let contentType = Self.contentType(for: fileUrl.pathExtension)
      respond(connection, status: "200 OK", contentType: contentType, body: data, cacheMaxAge: 900)

    case .pmtiles(let archive):
      // Path shape is the same as the unpacked tree: {z}/{x}/{y}.pbf, so the
      // style rewrite and offline detection need no changes.
      let tileSegments = Array(segments.dropFirst())
      guard tileSegments.count == 3,
        let z = Int(tileSegments[0]),
        let x = Int(tileSegments[1]),
        let y = Int((tileSegments[2] as NSString).deletingPathExtension),
        tileSegments[2].hasSuffix(".pbf")
      else {
        respond(connection, status: "404 Not Found", contentType: "text/plain", body: Data("bad tile path".utf8))
        return
      }

      let tile: Data?
      do {
        tile = try archive.tile(z: z, x: x, y: y)
      } catch {
        respond(connection, status: "500 Internal Server Error", contentType: "text/plain", body: Data("pmtiles: \(error.localizedDescription)".utf8))
        return
      }

      guard let tile = tile, !tile.isEmpty else {
        // 204 is what MapLibre expects for "this tile has no data" — it renders
        // the parent instead of treating it as a failed request.
        respond(connection, status: "204 No Content", contentType: "application/vnd.mapbox-vector-tile", body: Data())
        return
      }

      respond(
        connection,
        status: "200 OK",
        contentType: "application/vnd.mapbox-vector-tile",
        body: tile,
        cacheMaxAge: 900
      )
    }
  }

  private func respond(
    _ connection: NWConnection,
    status: String,
    contentType: String,
    body: Data,
    cacheMaxAge: Int? = nil
  ) {
    var headers = [
      "HTTP/1.1 \(status)",
      "Content-Type: \(contentType)",
      "Content-Length: \(body.count)",
      "Connection: close",
      "Access-Control-Allow-Origin: *",
    ]
    if let maxAge = cacheMaxAge {
      headers.append("Cache-Control: max-age=\(maxAge)")
    }

    var response = Data()
    response.append(Data((headers.joined(separator: "\r\n") + "\r\n\r\n").utf8))
    response.append(body)

    connection.send(content: response, completion: .contentProcessed { _ in
      connection.cancel()
    })
  }

  private static func contentType(for ext: String) -> String {
    switch ext.lowercased() {
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    // Downloaded region packs store OpenMapTiles vector tiles as .pbf —
    // byte-identical to .mvt, so serve the Mapbox vector TILE MIME type.
    case "mvt", "pbf": return "application/vnd.mapbox-vector-tile"
    case "json": return "application/json"
    default: return "application/octet-stream"
    }
  }
}
