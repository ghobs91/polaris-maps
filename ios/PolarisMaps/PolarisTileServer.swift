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
  private var listener: NWListener?
  private var sources: [String: String] = [:] // id → directory path
  private var port: UInt16 = 0

  @objc
  func start(
    _ config: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    if listener != nil {
      resolve(Int(port))
      return
    }

    let requestedPort = (config["port"] as? NSNumber)?.uint16Value ?? 0

    let params = NWParameters.tcp
    params.allowLocalEndpointReuse = true
    if requestedPort > 0 {
      params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: requestedPort)
    } else {
      // Ephemeral port, loopback only
      params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
    }

    do {
      let listener = try NWListener(using: params)
      listener.newConnectionHandler = { [weak self] connection in
        self?.handleConnection(connection)
      }
      listener.start(queue: DispatchQueue(label: "polaris.tile-server", qos: .utility))
      self.listener = listener
      self.port = listener.port?.rawValue ?? requestedPort

      if self.port == 0 {
        // The listener failed to bind; report the error.
        self.listener?.cancel()
        self.listener = nil
        reject("tile_server_bind_failed", "Unable to bind the tile server to 127.0.0.1", nil)
        return
      }

      resolve(Int(self.port))
    } catch {
      reject("tile_server_start_failed", error.localizedDescription, error)
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
    sources[id] = filePath
    resolve(nil)
  }

  @objc
  func removeSource(
    _ sourceId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    sources.removeValue(forKey: sourceId)
    resolve(nil)
  }

  @objc
  func listSources(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(sources.map { ["id": $0.key, "filePath": $0.value] })
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

    let path = String(parts[1])
    let segments = path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
    guard let sourceId = segments.first else {
      respond(connection, status: "404 Not Found", contentType: "text/plain", body: Data("missing source".utf8))
      return
    }

    guard let root = sources[sourceId] else {
      respond(connection, status: "404 Not Found", contentType: "text/plain", body: Data("unknown source".utf8))
      return
    }

    let relativePath = segments.dropFirst().joined(separator: "/")
    let fileUrl = URL(fileURLWithPath: root).appendingPathComponent(relativePath)

    guard let data = try? Data(contentsOf: fileUrl) else {
      respond(connection, status: "404 Not Found", contentType: "text/plain", body: Data("tile not found".utf8))
      return
    }

    let contentType = Self.contentType(for: fileUrl.pathExtension)
    respond(connection, status: "200 OK", contentType: contentType, body: data, cacheMaxAge: 900)
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
    case "mvt": return "application/vnd.mapbox-vector-tile"
    case "json": return "application/json"
    default: return "application/octet-stream"
    }
  }
}
