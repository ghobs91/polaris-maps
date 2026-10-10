/**
 * Region-pack transport bridge.
 *
 * IPC from React Native (Hermes) to the Bare worklet running Hyperdrive
 * (`backend/hyperdrive.mjs` → committed `backend/hyperdrive.bundle.mjs`), using
 * `react-native-bare-kit`'s Worklet + `bare-rpc`.
 *
 * Replaces the previous `nodejs-mobile` sidecar (`NativeModules.NodeChannel`),
 * which was never wired and always rejected. The public API is unchanged.
 */

import * as FileSystem from 'expo-file-system/legacy';
import {
  CMD_HD_SEED,
  CMD_HD_DOWNLOAD,
  CMD_HD_STATUS,
  CMD_HD_UNSEED,
  CMD_HD_DOWNLOAD_PROGRESS,
} from './hdRpcCommands';

// react-native-bare-kit's Worklet; bare-rpc's RPC. Lazily resolved so the module
// loads even before a native rebuild / in Jest.
let WorkletClass:
  | (new () => {
      start(entry: string, bundle: string, args: string[]): void;
      terminate(): void;
      IPC: unknown;
    })
  | null = null;

interface OutgoingRequest {
  send(data: Uint8Array): void;
  reply(): Promise<Uint8Array | string | null>;
}

interface RpcRequest {
  command: number;
  data: Uint8Array;
  send: (d: Uint8Array) => void;
}

let RPCClass:
  | (new (
      ipc: unknown,
      onrequest: (req: RpcRequest) => void,
    ) => {
      request(cmd: number): OutgoingRequest;
    })
  | null = null;

function resolveNativeDeps(): boolean {
  if (WorkletClass && RPCClass) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WorkletClass = (require('react-native-bare-kit') as { Worklet: typeof WorkletClass }).Worklet;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    RPCClass = require('bare-rpc') as typeof RPCClass;
    return true;
  } catch {
    return false;
  }
}

let worklet: {
  start(entry: string, bundle: string, args: string[]): void;
  terminate(): void;
  IPC: unknown;
} | null = null;
let rpc: { request(cmd: number): OutgoingRequest } | null = null;
let started = false;

interface DownloadProgress {
  file?: string;
  bytes?: number;
  totalBytes?: number;
}
let progressHandlers: Array<(event: DownloadProgress) => void> = [];

/** Root of the worklet's Corestore (one sub-store per region). */
function corestoreRoot(): string {
  return toFsPath(`${FileSystem.documentDirectory ?? ''}.polaris-corestore`);
}

/**
 * Convert an expo `file://` URI to a plain filesystem path. `bare-fs` and
 * RocksDB (via Corestore) expect OS paths, not URLs.
 */
function toFsPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  const withoutScheme = uri.slice('file://'.length);
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
}

function handleRequest(req: RpcRequest): void {
  if (req.command !== CMD_HD_DOWNLOAD_PROGRESS) return;
  try {
    const event = JSON.parse(new TextDecoder().decode(req.data)) as DownloadProgress;
    for (const handler of progressHandlers) handler(event);
  } catch {
    /* malformed */
  }
}

/** Start the Hyperdrive worklet if the runtime and bundle are available. */
export function initHyperdriveBridge(): void {
  if (started) return;
  if (!resolveNativeDeps() || !WorkletClass || !RPCClass) return;

  let bundle: string | null = null;
  try {
    // bare-pack emits `export default "<source>"`, so `require` yields the ESM
    // namespace object; unwrap it to the source string Worklet.start expects.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../../../backend/hyperdrive.bundle.mjs') as string | { default?: string };
    bundle = typeof mod === 'string' ? mod : (mod?.default ?? null);
  } catch {
    return; // Bundle not built — transport unavailable.
  }
  if (!bundle) return;

  worklet = new WorkletClass();
  worklet.start('/hyperdrive.bundle', bundle, []);
  started = true;

  rpc = new RPCClass(worklet.IPC, (req: RpcRequest) => handleRequest(req));
}

/** How long to wait for a seed/download reply (peer discovery can be slow). */
const TRANSFER_TIMEOUT_MS = 120_000;
/** How long to wait for a status reply. */
const STATUS_TIMEOUT_MS = 3_000;

async function sendRequest(
  command: number,
  payload: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  initHyperdriveBridge();
  if (!rpc) throw new Error('Hyperdrive worklet not available');

  const req = rpc.request(command);
  req.send(new TextEncoder().encode(JSON.stringify(payload)));

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const reply = await Promise.race([
      req.reply().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (reply == null) throw new Error('Hyperdrive request timed out');

    const text = typeof reply === 'string' ? reply : new TextDecoder().decode(reply);
    const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    if (typeof parsed.error === 'string') throw new Error(parsed.error);
    return parsed;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Seed a downloaded region's files into Hyperdrive.
 *
 * With `canonicalKey`, the pack is seeded as a read-only canonical replica so
 * every seeder advertises the same discovery key. Without it, this device
 * authors the canonical writable drive.
 */
export async function seedRegion(
  regionId: string,
  filesDir: string,
  canonicalKey?: string,
): Promise<{
  key: string;
  discoveryKey: string;
  readOnly: boolean;
  contentHash?: string;
  bytes?: number;
}> {
  const result = await sendRequest(
    CMD_HD_SEED,
    { regionId, filesDir: toFsPath(filesDir), key: canonicalKey, corestoreRoot: corestoreRoot() },
    TRANSFER_TIMEOUT_MS,
  );
  return {
    key: String(result.key),
    discoveryKey: String(result.discoveryKey),
    readOnly: canonicalKey != null,
    contentHash: typeof result.contentHash === 'string' ? result.contentHash : undefined,
    bytes: typeof result.bytes === 'number' ? result.bytes : undefined,
  };
}

/** Download a region's files from a peer via Hyperdrive key. */
export async function downloadFromPeers(
  driveKey: string,
  destDir: string,
  onProgress?: (file: string, bytes: number, totalBytes: number) => void,
): Promise<{ totalBytes: number }> {
  const handler = onProgress
    ? (event: DownloadProgress) =>
        onProgress(event.file ?? '', event.bytes ?? 0, event.totalBytes ?? 0)
    : undefined;
  if (handler) progressHandlers.push(handler);

  try {
    const result = await sendRequest(
      CMD_HD_DOWNLOAD,
      { driveKey, destDir: toFsPath(destDir), corestoreRoot: corestoreRoot() },
      TRANSFER_TIMEOUT_MS,
    );
    return { totalBytes: Number(result.totalBytes ?? 0) };
  } finally {
    if (handler) progressHandlers = progressHandlers.filter((h) => h !== handler);
  }
}

/** Stop seeding a region. */
export async function unseedRegion(regionId: string): Promise<void> {
  await sendRequest(CMD_HD_UNSEED, { regionId }, STATUS_TIMEOUT_MS);
}

/** Get status of all seeded drives. */
export async function getHyperdriveStatus(): Promise<{
  drives: Array<{ regionId: string; key: string; discoveryKey: string; peers: number }>;
  swarmConnections: number;
}> {
  try {
    const result = await sendRequest(CMD_HD_STATUS, {}, STATUS_TIMEOUT_MS);
    return {
      drives: Array.isArray(result.drives)
        ? (result.drives as Array<{
            regionId: string;
            key: string;
            discoveryKey: string;
            peers: number;
          }>)
        : [],
      swarmConnections: Number(result.swarmConnections ?? 0),
    };
  } catch {
    return { drives: [], swarmConnections: 0 };
  }
}

/** Terminate the worklet and clear handlers. */
export function disposeHyperdriveBridge(): void {
  rpc = null;
  if (worklet) {
    try {
      worklet.terminate();
    } catch {
      // Already gone.
    }
    worklet = null;
  }
  started = false;
  progressHandlers = [];
}
