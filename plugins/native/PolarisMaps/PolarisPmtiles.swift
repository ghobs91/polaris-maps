import Foundation
import zlib

/// Range-read access to a pack's PMTiles archive.
///
/// Region packs ship a base-map `tiles.pmtiles`. The render path used to expand
/// that archive into one file per tile at install time — and a 15.8 MB archive
/// became 737,058 files / 2.8 GB, because every tile costs a filesystem block.
/// The archive is the right unit of storage: this reads the one tile the map
/// asks for, straight out of it.
///
/// Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
///
/// Kept dependency-free (Foundation + zlib) so it can be compiled standalone and
/// checked tile-for-tile against the JS reference in `backend/pmtiles.mjs`.
final class PolarisPmtilesArchive {
  enum PmtilesError: LocalizedError {
    case shortHeader
    case badMagic(String)
    case unsupportedVersion(UInt8)
    case unsupportedCompression(UInt8)
    case truncatedVarint
    case varintTooLong
    case tileIdOutOfRange
    case shortRead(offset: UInt64, got: Int, want: Int)
    case inflateFailed(Int32)

    var errorDescription: String? {
      switch self {
      case .shortHeader: return "pmtiles: file shorter than header"
      case .badMagic(let magic): return "pmtiles: bad magic \"\(magic)\""
      case .unsupportedVersion(let v): return "pmtiles: unsupported version \(v)"
      case .unsupportedCompression(let code): return "pmtiles: unsupported compression code \(code)"
      case .truncatedVarint: return "pmtiles: truncated varint"
      case .varintTooLong: return "pmtiles: varint too long"
      case .tileIdOutOfRange: return "pmtiles: tile id out of range"
      case .shortRead(let offset, let got, let want):
        return "pmtiles: short read at \(offset) (\(got)/\(want))"
      case .inflateFailed(let status): return "pmtiles: inflate failed (\(status))"
      }
    }
  }

  /// Fixed header size in bytes (v3).
  static let headerSize = 127
  /// Highest zoom the tile-id maths stays exact for.
  static let maxSupportedZoom = 26

  struct Header {
    var rootDirOffset: UInt64
    var rootDirLength: UInt64
    var leafDirsOffset: UInt64
    var leafDirsLength: UInt64
    var tileDataOffset: UInt64
    var tileDataLength: UInt64
    var internalCompression: UInt8
    var tileCompression: UInt8
    var minZoom: UInt8
    var maxZoom: UInt8
  }

  struct Entry {
    var tileId: UInt64
    var offset: UInt64
    var length: UInt64
    var runLength: UInt64
  }

  private static let compressionNone: UInt8 = 1
  private static let compressionGzip: UInt8 = 2

  let path: String
  private let handle: FileHandle
  private let header: Header
  private var rootEntries: [Entry]?
  /// Leaf directories are read once per archive and cached: a viewport touches
  /// the same handful of leaves repeatedly while panning.
  private var leafCache: [UInt64: [Entry]] = [:]
  private let lock = NSLock()

  init(path: String) throws {
    self.path = path
    guard let handle = FileHandle(forReadingAtPath: path) else {
      throw PmtilesError.shortRead(offset: 0, got: 0, want: Self.headerSize)
    }
    self.handle = handle
    let head = try Self.readExactly(handle, offset: 0, length: UInt64(Self.headerSize))
    self.header = try Self.parseHeader(head)
  }

  deinit {
    try? handle.close()
  }

  // ── Header ────────────────────────────────────────────────────────

  static func parseHeader(_ data: Data) throws -> Header {
    guard data.count >= headerSize else { throw PmtilesError.shortHeader }
    let magic = String(bytes: data[0..<7], encoding: .utf8) ?? ""
    guard magic == "PMTiles" else { throw PmtilesError.badMagic(magic) }
    let version = data[7]
    guard version == 3 else { throw PmtilesError.unsupportedVersion(version) }

    func u64(_ offset: Int) -> UInt64 {
      var value: UInt64 = 0
      // Little-endian, byte by byte: no alignment assumptions about `Data`.
      for i in (0..<8).reversed() {
        value = (value << 8) | UInt64(data[offset + i])
      }
      return value
    }

    return Header(
      rootDirOffset: u64(8),
      rootDirLength: u64(16),
      leafDirsOffset: u64(40),
      leafDirsLength: u64(48),
      tileDataOffset: u64(56),
      tileDataLength: u64(64),
      internalCompression: data[97],
      tileCompression: data[98],
      minZoom: data[100],
      maxZoom: data[101]
    )
  }

  var zoomRange: ClosedRange<UInt8> { header.minZoom...header.maxZoom }

  // ── Tile lookup ───────────────────────────────────────────────────

  /// Decompressed tile bytes for `(z, x, y)`, or nil when the archive has none.
  func tile(z: Int, x: Int, y: Int) throws -> Data? {
    guard let target = Self.zxyToTileId(z: z, x: x, y: y) else { return nil }
    guard z >= Int(header.minZoom), z <= Int(header.maxZoom) else { return nil }

    lock.lock()
    defer { lock.unlock() }

    if rootEntries == nil {
      let raw = try Self.readExactly(handle, offset: header.rootDirOffset, length: header.rootDirLength)
      rootEntries = try Self.parseDirectory(try Self.decompress(raw, header.internalCompression))
    }

    var entries = rootEntries ?? []
    var depth = 0
    while depth < 4 {
      depth += 1
      guard let entry = Self.findEntry(entries, target) else { return nil }

      if entry.runLength == 0 {
        // Leaf-directory pointer: `offset` is relative to the leaf-dirs section.
        let leafEntries: [Entry]
        if let cached = leafCache[entry.offset] {
          leafEntries = cached
        } else {
          let raw = try Self.readExactly(
            handle,
            offset: header.leafDirsOffset + entry.offset,
            length: entry.length
          )
          leafEntries = try Self.parseDirectory(try Self.decompress(raw, header.internalCompression))
          leafCache[entry.offset] = leafEntries
        }
        entries = leafEntries
        continue
      }

      // A runLength > 0 entry shares one blob across consecutive tile ids.
      let raw = try Self.readExactly(
        handle,
        offset: header.tileDataOffset + entry.offset,
        length: entry.length
      )
      if entry.length == 0 { return Data() }  // explicit empty tile
      return try Self.decompress(raw, header.tileCompression)
    }
    return nil
  }

  /// The entry covering `tileId`, by binary search over the sorted ids.
  ///
  /// A leaf pointer (runLength 0) covers everything from its own id up to the
  /// next entry, so the match is the *last* entry with `tileId <= target` —
  /// scanning for the first match returns the wrong leaf for every tile past
  /// the first one, which silently loses most of a large archive.
  static func findEntry(_ entries: [Entry], _ tileId: UInt64) -> Entry? {
    var low = 0
    var high = entries.count - 1
    var best = -1
    while low <= high {
      let mid = (low + high) / 2
      if entries[mid].tileId <= tileId {
        best = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    guard best >= 0 else { return nil }
    let entry = entries[best]
    if entry.runLength == 0 { return entry }
    return tileId < entry.tileId + entry.runLength ? entry : nil
  }

  // ── Varints ───────────────────────────────────────────────────────

  static func readVarint(_ bytes: [UInt8], _ start: Int) throws -> (UInt64, Int) {
    var value: UInt64 = 0
    var shift: UInt64 = 0
    var pos = start
    while true {
      guard pos < bytes.count else { throw PmtilesError.truncatedVarint }
      let byte = bytes[pos]
      pos += 1
      value |= UInt64(byte & 0x7f) << shift
      if byte & 0x80 == 0 { return (value, pos) }
      shift += 7
      if shift > 63 { throw PmtilesError.varintTooLong }
    }
  }

  // ── Directories ───────────────────────────────────────────────────

  /// Decode a directory: delta-encoded tile ids, then run lengths, lengths and
  /// offsets (offsets are 1-based, with 0 meaning "immediately after previous").
  static func parseDirectory(_ data: Data) throws -> [Entry] {
    let bytes = [UInt8](data)
    var (count, pos) = try readVarint(bytes, 0)
    var tileIds: [UInt64] = []
    tileIds.reserveCapacity(Int(count))
    var lastId: UInt64 = 0
    var i: UInt64 = 0
    while i < count {
      let (delta, next) = try readVarint(bytes, pos)
      pos = next
      lastId += delta
      tileIds.append(lastId)
      i += 1
    }

    var runLengths: [UInt64] = []
    runLengths.reserveCapacity(Int(count))
    i = 0
    while i < count {
      let (value, next) = try readVarint(bytes, pos)
      pos = next
      runLengths.append(value)
      i += 1
    }

    var lengths: [UInt64] = []
    lengths.reserveCapacity(Int(count))
    i = 0
    while i < count {
      let (value, next) = try readVarint(bytes, pos)
      pos = next
      lengths.append(value)
      i += 1
    }

    var entries: [Entry] = []
    entries.reserveCapacity(Int(count))
    var lastOffset: UInt64 = 0
    i = 0
    while i < count {
      let (value, next) = try readVarint(bytes, pos)
      pos = next
      let offset = value == 0 ? lastOffset + (i > 0 ? lengths[Int(i) - 1] : 0) : value - 1
      lastOffset = offset
      entries.append(
        Entry(tileId: tileIds[Int(i)], offset: offset, length: lengths[Int(i)], runLength: runLengths[Int(i)])
      )
      i += 1
    }
    return entries
  }

  // ── Tile ids (Hilbert curve) ──────────────────────────────────────

  /// Forward Hilbert mapping: (z, x, y) → global tile id.
  static func zxyToTileId(z: Int, x: Int, y: Int) -> UInt64? {
    guard z >= 0, z <= maxSupportedZoom else { return nil }
    let dimension = 1 << z
    guard x >= 0, y >= 0, x < dimension, y < dimension else { return nil }
    if z == 0 { return 0 }

    var acc: UInt64 = 0
    var tz = 0
    while tz < z {
      acc += UInt64(1) << UInt64(2 * tz)
      tz += 1
    }

    var xx = x
    var yy = y
    var distance: UInt64 = 0
    var size = dimension / 2
    while size > 0 {
      let rx = (xx & size) > 0 ? 1 : 0
      let ry = (yy & size) > 0 ? 1 : 0
      distance += UInt64(size) * UInt64(size) * UInt64((3 * rx) ^ ry)
      if ry == 0 {
        if rx == 1 {
          xx = size - 1 - xx
          yy = size - 1 - yy
        }
        swap(&xx, &yy)
      }
      size /= 2
    }
    return acc + distance
  }

  // ── Compression / IO ──────────────────────────────────────────────

  static func decompress(_ data: Data, _ compression: UInt8) throws -> Data {
    if compression == compressionNone { return data }
    if compression == compressionGzip { return try gunzip(data) }
    throw PmtilesError.unsupportedCompression(compression)
  }

  /// gzip inflate (zlib, 15 window bits + 32 to auto-detect the gzip header).
  static func gunzip(_ input: Data) throws -> Data {
    guard !input.isEmpty else { return input }
    var stream = z_stream()
    let initStatus = inflateInit2_(&stream, 15 + 32, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
    guard initStatus == Z_OK else { throw PmtilesError.inflateFailed(initStatus) }
    defer { inflateEnd(&stream) }

    let chunk = 64 * 1024
    var output = Data()
    var buffer = [UInt8](repeating: 0, count: chunk)
    var status: Int32 = Z_OK

    try input.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      guard let base = raw.bindMemory(to: Bytef.self).baseAddress else { return }
      stream.next_in = UnsafeMutablePointer(mutating: base)
      stream.avail_in = uInt(input.count)

      repeat {
        let produced: Int = buffer.withUnsafeMutableBufferPointer { out -> Int in
          stream.next_out = out.baseAddress
          stream.avail_out = uInt(chunk)
          status = inflate(&stream, Z_NO_FLUSH)
          return chunk - Int(stream.avail_out)
        }
        if produced > 0 {
          output.append(contentsOf: buffer[0..<produced])
        }
        if status == Z_STREAM_END { break }
        if status != Z_OK && status != Z_BUF_ERROR {
          throw PmtilesError.inflateFailed(status)
        }
        if produced == 0 && status == Z_BUF_ERROR { break }
      } while true
    }
    return output
  }

  static func readExactly(_ handle: FileHandle, offset: UInt64, length: UInt64) throws -> Data {
    if length == 0 { return Data() }
    do {
      try handle.seek(toOffset: offset)
    } catch {
      throw PmtilesError.shortRead(offset: offset, got: 0, want: Int(length))
    }
    let data = handle.readData(ofLength: Int(length))
    guard data.count == Int(length) else {
      throw PmtilesError.shortRead(offset: offset, got: data.count, want: Int(length))
    }
    return data
  }
}
