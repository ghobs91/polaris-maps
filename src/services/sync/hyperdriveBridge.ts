import { NativeEventEmitter, NativeModules } from 'react-native';

interface HdEvent {
  type: string;
  requestId?: string;
  error?: string;
  key?: string;
  discoveryKey?: string;
  totalBytes?: number;
  file?: string;
  bytes?: number;
  drives?: Array<{
    regionId: string;
    key: string;
    discoveryKey: string;
    peers: number;
  }>;
  swarmConnections?: number;
}

const pendingRequests = new Map<
  string,
  { resolve: (value: HdEvent) => void; reject: (reason: Error) => void }
>();

let requestCounter = 0;
let emitterSub: ReturnType<NativeEventEmitter['addListener']> | null = null;
let progressHandlers: Array<(event: HdEvent) => void> = [];

function getRequestId(): string {
  return `hd_${++requestCounter}_${Date.now()}`;
}

function ensureListener(): void {
  if (emitterSub) return;
  const { NodeChannel } = NativeModules;
  if (!NodeChannel) return;
  const emitter = new NativeEventEmitter(NodeChannel);
  emitterSub = emitter.addListener('message', (raw: string) => {
    try {
      const event: HdEvent = JSON.parse(raw);
      if (!event.type?.startsWith('hd-')) return;

      // Progress events are broadcast, not request/response
      if (event.type === 'hd-download-progress') {
        for (const handler of progressHandlers) handler(event);
        return;
      }

      if (event.requestId && pendingRequests.has(event.requestId)) {
        const pending = pendingRequests.get(event.requestId)!;
        pendingRequests.delete(event.requestId);
        if (event.type === 'error') {
          pending.reject(new Error(event.error ?? 'Hyperdrive error'));
        } else {
          pending.resolve(event);
        }
      }
    } catch {
      // Not our message
    }
  });
}

function sendCommand(command: Record<string, unknown>): Promise<HdEvent> {
  const { NodeChannel } = NativeModules;
  if (!NodeChannel) return Promise.reject(new Error('NodeChannel not available'));

  ensureListener();
  const requestId = command.requestId as string;

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    NodeChannel.send(JSON.stringify(command));

    // Timeout after 120s (peer discovery + file transfer can be slow)
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Hyperdrive command timed out: ${command.type}`));
      }
    }, 120_000);
  });
}

/**
 * Seed a downloaded region's files into a Hyperdrive.
 * Returns the drive key that other peers can use to download.
 */
export async function seedRegion(
  regionId: string,
  filesDir: string,
): Promise<{ key: string; discoveryKey: string }> {
  const requestId = getRequestId();
  const result = await sendCommand({ type: 'hd-seed', regionId, filesDir, requestId });
  return { key: result.key!, discoveryKey: result.discoveryKey! };
}

/**
 * Download a region's files from a peer via Hyperdrive key.
 */
export async function downloadFromPeers(
  driveKey: string,
  destDir: string,
  onProgress?: (file: string, bytes: number, totalBytes: number) => void,
): Promise<{ totalBytes: number }> {
  const requestId = getRequestId();

  const removeProgress = onProgress
    ? onDownloadProgress((event) => {
        if (event.requestId === requestId) {
          onProgress(event.file ?? '', event.bytes ?? 0, event.totalBytes ?? 0);
        }
      })
    : undefined;

  try {
    const result = await sendCommand({ type: 'hd-download', driveKey, destDir, requestId });
    return { totalBytes: result.totalBytes ?? 0 };
  } finally {
    removeProgress?.();
  }
}

/** Stop seeding a region. */
export async function unseedRegion(regionId: string): Promise<void> {
  const requestId = getRequestId();
  await sendCommand({ type: 'hd-unseed', regionId, requestId });
}

/** Get status of all seeded drives. */
export async function getHyperdriveStatus(): Promise<{
  drives: Array<{ regionId: string; key: string; discoveryKey: string; peers: number }>;
  swarmConnections: number;
}> {
  const requestId = getRequestId();
  const result = await sendCommand({ type: 'hd-status', requestId });
  return {
    drives: result.drives ?? [],
    swarmConnections: result.swarmConnections ?? 0,
  };
}

/** Register a handler for download progress events. Returns unsubscribe function. */
function onDownloadProgress(handler: (event: HdEvent) => void): () => void {
  ensureListener();
  progressHandlers.push(handler);
  return () => {
    progressHandlers = progressHandlers.filter((h) => h !== handler);
  };
}

export function disposeHyperdriveBridge(): void {
  emitterSub?.remove();
  emitterSub = null;
  progressHandlers = [];
  pendingRequests.clear();
}
