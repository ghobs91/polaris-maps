import { NativeEventEmitter, NativeModules } from 'react-native';

type WakuMessageHandler = (topic: string, payload: Uint8Array) => void;
type WakuStatusHandler = (peerCount: number) => void;

interface WakuEvent {
  type: 'message' | 'response' | 'error' | 'status';
  topic?: string;
  payload?: number[];
  requestId?: string;
  error?: string;
  peerCount?: number;
  success?: boolean;
}

const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

let messageHandlers: WakuMessageHandler[] = [];
let statusHandlers: WakuStatusHandler[] = [];
let requestCounter = 0;
let emitterSubscription: ReturnType<NativeEventEmitter['addListener']> | null = null;

function getRequestId(): string {
  return `waku_${++requestCounter}_${Date.now()}`;
}

function sendCommand(command: {
  type: string;
  topic?: string;
  payload?: number[];
  requestId: string;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingRequests.set(command.requestId, { resolve, reject });
    // nodejs-mobile bridge send
    const { NodeChannel } = NativeModules;
    NodeChannel?.send(JSON.stringify(command));

    // Timeout after 10s
    setTimeout(() => {
      if (pendingRequests.has(command.requestId)) {
        pendingRequests.delete(command.requestId);
        reject(new Error(`Waku command timed out: ${command.type}`));
      }
    }, 10_000);
  });
}

export function initWakuBridge(): void {
  const { NodeChannel } = NativeModules;
  if (!NodeChannel) return;

  const emitter = new NativeEventEmitter(NodeChannel);
  emitterSubscription = emitter.addListener('message', (raw: string) => {
    try {
      const event: WakuEvent = JSON.parse(raw);
      handleEvent(event);
    } catch {
      // ignore malformed messages
    }
  });
}

function handleEvent(event: WakuEvent): void {
  if (event.requestId && pendingRequests.has(event.requestId)) {
    const pending = pendingRequests.get(event.requestId)!;
    pendingRequests.delete(event.requestId);
    if (event.type === 'error') {
      pending.reject(new Error(event.error ?? 'Unknown Waku error'));
    } else {
      pending.resolve(event);
    }
    return;
  }

  if (event.type === 'message' && event.topic && event.payload) {
    const payload = new Uint8Array(event.payload);
    for (const handler of messageHandlers) {
      handler(event.topic, payload);
    }
  }

  if (event.type === 'status' && event.peerCount != null) {
    for (const handler of statusHandlers) {
      handler(event.peerCount);
    }
  }
}

export async function subscribe(topic: string): Promise<void> {
  const requestId = getRequestId();
  await sendCommand({ type: 'subscribe', topic, requestId });
}

export async function unsubscribe(topic: string): Promise<void> {
  const requestId = getRequestId();
  await sendCommand({ type: 'unsubscribe', topic, requestId });
}

export async function publish(topic: string, payload: Uint8Array): Promise<void> {
  const requestId = getRequestId();
  await sendCommand({ type: 'publish', topic, payload: Array.from(payload), requestId });
}

export async function getStatus(): Promise<{ peerCount: number }> {
  const requestId = getRequestId();
  const result = (await sendCommand({ type: 'status', requestId })) as { peerCount: number };
  return { peerCount: result.peerCount ?? 0 };
}

export function onMessage(handler: WakuMessageHandler): () => void {
  messageHandlers.push(handler);
  return () => {
    messageHandlers = messageHandlers.filter((h) => h !== handler);
  };
}

export function onStatus(handler: WakuStatusHandler): () => void {
  statusHandlers.push(handler);
  return () => {
    statusHandlers = statusHandlers.filter((h) => h !== handler);
  };
}

export function disposeWakuBridge(): void {
  emitterSubscription?.remove();
  emitterSubscription = null;
  messageHandlers = [];
  statusHandlers = [];
  pendingRequests.clear();
}
