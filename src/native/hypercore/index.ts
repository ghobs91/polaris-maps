import { NativeEventEmitter, NativeModules } from 'react-native';
import NativePolarisHypercore from './NativePolarisHypercore';
import * as Crypto from 'expo-crypto';

interface HypercoreCommand {
  type: 'join-feed' | 'leave-feed' | 'get-entry' | 'status' | 'list-feeds';
  feedKey?: string;
  seq?: number;
  requestId: string;
}

interface SyncProgress {
  downloaded: number;
  total: number;
  bytesDownloaded: number;
}

interface HypercoreEvent {
  type: 'entry' | 'sync-progress' | 'sync-complete' | 'error' | 'status' | 'feed-list';
  feedKey?: string;
  seq?: number;
  data?: string; // base64 encoded
  progress?: SyncProgress;
  peers?: number;
  requestId?: string;
  error?: string;
}

type EventHandler = (event: HypercoreEvent) => void;

const pendingRequests = new Map<
  string,
  { resolve: (event: HypercoreEvent) => void; reject: (err: Error) => void }
>();
const feedHandlers = new Map<string, EventHandler[]>();
let emitterSubscription: ReturnType<NativeEventEmitter['addListener']> | null = null;

function ensureListener(): void {
  if (emitterSubscription) return;
  const emitter = new NativeEventEmitter(NativeModules.PolarisHypercore);
  emitterSubscription = emitter.addListener('HypercoreEvent', (event: HypercoreEvent) => {
    // Resolve pending request
    if (event.requestId) {
      const pending = pendingRequests.get(event.requestId);
      if (pending) {
        pendingRequests.delete(event.requestId);
        if (event.type === 'error') {
          pending.reject(new Error(event.error ?? 'Unknown Hypercore error'));
        } else {
          pending.resolve(event);
        }
      }
    }

    // Dispatch to feed handlers
    if (event.feedKey) {
      const handlers = feedHandlers.get(event.feedKey);
      handlers?.forEach((h) => h(event));
    }
  });
}

function sendCommand(cmd: HypercoreCommand): Promise<HypercoreEvent> {
  ensureListener();
  return new Promise<HypercoreEvent>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(cmd.requestId);
      reject(new Error(`Hypercore command timed out: ${cmd.type}`));
    }, 15000);

    pendingRequests.set(cmd.requestId, {
      resolve: (event) => {
        clearTimeout(timeout);
        resolve(event);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    NativePolarisHypercore.sendMessage(JSON.stringify(cmd));
  });
}

export async function joinFeed(feedKey: string, onEvent?: EventHandler): Promise<void> {
  const requestId = Crypto.randomUUID();
  if (onEvent) {
    const handlers = feedHandlers.get(feedKey) ?? [];
    handlers.push(onEvent);
    feedHandlers.set(feedKey, handlers);
  }
  await sendCommand({ type: 'join-feed', feedKey, requestId });
}

export async function leaveFeed(feedKey: string): Promise<void> {
  const requestId = Crypto.randomUUID();
  feedHandlers.delete(feedKey);
  await sendCommand({ type: 'leave-feed', feedKey, requestId });
}

export async function getEntry(feedKey: string, seq: number): Promise<Uint8Array | null> {
  const requestId = Crypto.randomUUID();
  const event = await sendCommand({ type: 'get-entry', feedKey, seq, requestId });
  if (event.data) {
    // Decode base64
    const binary = atob(event.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return null;
}

export async function getStatus(): Promise<HypercoreEvent> {
  const requestId = Crypto.randomUUID();
  return sendCommand({ type: 'status', requestId });
}

export async function listFeeds(): Promise<HypercoreEvent> {
  const requestId = Crypto.randomUUID();
  return sendCommand({ type: 'list-feeds', requestId });
}
