import Foundation

/// Client for the relay's local control socket.
///
/// Newline-delimited JSON over a Unix socket, matching `relay/src/control.mjs`.
/// No network, no Gun, no dependency on the iOS app: the dashboard and the daemon
/// are on the same machine, so the shortest path between them is the one that
/// needs no third party to be up.
enum RelaySocket {
    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// `~/Library/Application Support/Polaris Relay/control.sock`, or `POLARIS_RELAY_HOME`.
    static func socketPath() -> String {
        let environment = ProcessInfo.processInfo.environment
        if let override = environment["POLARIS_RELAY_HOME"], !override.isEmpty {
            return (override as NSString).appendingPathComponent("control.sock")
        }
        return (FileManager.default.homeDirectoryForCurrentUser.path as NSString)
            .appendingPathComponent("Library/Application Support/Polaris Relay/control.sock")
    }

    /// One command, one reply. Runs off the main thread; the caller awaits.
    static func request(
        _ payload: [String: Any],
        timeout: TimeInterval = 8
    ) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    continuation.resume(returning: try requestBlocking(payload, timeout: timeout))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func requestBlocking(
        _ payload: [String: Any],
        timeout: TimeInterval
    ) throws -> [String: Any] {
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw Failure(message: "could not create a socket") }
        defer { close(descriptor) }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let path = socketPath()
        let capacity = MemoryLayout.size(ofValue: address.sun_path)
        guard path.utf8.count < capacity else { throw Failure(message: "socket path is too long") }
        withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: capacity) { buffer in
                _ = strcpy(buffer, path)
            }
        }

        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                connect(descriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else {
            throw Failure(message: "the relay is not running")
        }

        var timeval = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeval, socklen_t(MemoryLayout<timeval>.size))

        var body = try JSONSerialization.data(withJSONObject: payload)
        body.append(0x0a)
        let written = body.withUnsafeBytes { raw -> Int in
            guard let base = raw.baseAddress else { return 0 }
            return write(descriptor, base, raw.count)
        }
        guard written == body.count else { throw Failure(message: "could not send the command") }

        var response = Data()
        var buffer = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let count = read(descriptor, &buffer, buffer.count)
            if count <= 0 { break }
            response.append(buffer, count: count)
            if response.contains(0x0a) { break }
        }

        guard !response.isEmpty else { throw Failure(message: "the relay closed the connection") }
        guard let object = try JSONSerialization.jsonObject(with: response) as? [String: Any] else {
            throw Failure(message: "the relay sent an unreadable reply")
        }
        if let ok = object["ok"] as? Bool, ok, let result = object["result"] as? [String: Any] {
            return result
        }
        throw Failure(message: object["error"] as? String ?? "the relay rejected the command")
    }

    /// Stop the relay synchronously, for the app's termination path.
    ///
    /// `applicationWillTerminate` cannot await, and every quit path has to stop
    /// seeding — not just the menu item. A Cmd-Q must not leave a daemon uploading
    /// after the window it belonged to is gone.
    static func shutdownRelayBlocking() {
        _ = try? requestBlocking(["cmd": "shutdown"], timeout: 3)
        LaunchControl.run(["bootout", LaunchControl.domain + "/" + LaunchControl.agentLabel])
        LaunchControl.run(["disable", LaunchControl.domain + "/" + LaunchControl.agentLabel])
    }

    /// `--selftest`: prove the socket client works without a GUI.
    ///
    /// With `--catalog` it exercises the catalog path instead (fetch, verify,
    /// decode every region), which is the code the map browser runs on.
    static func selfTest(catalog: Bool = false) -> Int32 {
        do {
            let status = try requestBlocking(
                catalog ? ["cmd": "catalog"] : ["cmd": "status"],
                timeout: catalog ? 30 : 8
            )
            let data = try JSONSerialization.data(
                withJSONObject: status,
                options: [.prettyPrinted, .sortedKeys]
            )
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
            return 0
        } catch {
            FileHandle.standardError.write(Data("selftest failed: \(error.localizedDescription)\n".utf8))
            return 1
        }
    }
}
