/** Convert a filesystem path to a `file://` URI (idempotent). */
export function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * Convert a `file://` URI to the filesystem path that native APIs expect.
 *
 * VisionCamera's `createRecorder({ filePath })` requires a path, not a URI: the
 * native recorder calls `URL(fileURLWithPath:)`, so a `file:///var/...` value
 * becomes a literal `file:` path component and the recording is never written
 * where the app looks for it.
 */
export function toFilePath(uriOrPath: string): string {
  if (!uriOrPath.startsWith('file://')) return uriOrPath;
  return decodeURIComponent(uriOrPath.slice('file://'.length));
}
