import { storage } from '../storage/mmkv';
import { isOnline } from '../regions/connectivityService';
import { publishProbe } from '../traffic/hyperswarmBridge';

interface QueueEntry {
  id: string;
  type: 'traffic_probe' | 'poi_edit' | 'review' | 'attestation';
  topic?: string;
  payload: string;
  createdAt: number;
}

const QUEUE_KEY = 'offline_queue';
const MAX_QUEUE_SIZE = 500;

function getQueue(): QueueEntry[] {
  const raw = storage.getString(QUEUE_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

function saveQueue(queue: QueueEntry[]): void {
  storage.set(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueue(entry: Omit<QueueEntry, 'id' | 'createdAt'>): void {
  const queue = getQueue();
  if (queue.length >= MAX_QUEUE_SIZE) {
    // Drop oldest entries to stay within budget
    queue.splice(0, queue.length - MAX_QUEUE_SIZE + 1);
  }

  queue.push({
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  });
  saveQueue(queue);
}

export function getQueueSize(): number {
  return getQueue().length;
}

export async function flushQueue(): Promise<{ flushed: number; failed: number }> {
  if (!isOnline()) return { flushed: 0, failed: 0 };

  const queue = getQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining: QueueEntry[] = [];

  for (const entry of queue) {
    try {
      if (entry.type === 'traffic_probe' && entry.payload) {
        publishProbe(entry.payload);
      }
      // POI edits, reviews, and attestations write to Gun.js which auto-syncs
      // when connectivity resumes, so those are implicitly flushed
      flushed++;
    } catch {
      failed++;
      remaining.push(entry);
    }
  }

  saveQueue(remaining);
  return { flushed, failed };
}

export function clearQueue(): void {
  storage.delete(QUEUE_KEY);
}
