import type { TrafficHistoryBackend } from './trafficHistoryService';
import type { TimeBucket, TrafficAreaCondition } from '../../models/trafficHistory';

/**
 * In-memory backend used by unit tests and as a fallback when SQLite is
 * unavailable. Rows are keyed by `cell|dow|halfHour`.
 */
export class InMemoryTrafficHistoryBackend implements TrafficHistoryBackend {
  private rows = new Map<string, TrafficAreaCondition>();

  async init(): Promise<void> {
    /* nothing to do */
  }

  async insert(condition: TrafficAreaCondition): Promise<void> {
    this.rows.set(keyOf(condition.geohash5, condition.dayOfWeek, condition.halfHour), condition);
  }

  async update(condition: TrafficAreaCondition): Promise<void> {
    this.rows.set(keyOf(condition.geohash5, condition.dayOfWeek, condition.halfHour), condition);
  }

  async getByKey(cells: string[], bucket: TimeBucket): Promise<TrafficAreaCondition[]> {
    const out: TrafficAreaCondition[] = [];
    for (const cell of cells) {
      const row = this.rows.get(keyOf(cell, bucket.dayOfWeek, bucket.halfHour));
      if (row) out.push(row);
    }
    return out;
  }

  async getAll(): Promise<TrafficAreaCondition[]> {
    return Array.from(this.rows.values());
  }

  async remove(cell: string, bucket: TimeBucket): Promise<void> {
    this.rows.delete(keyOf(cell, bucket.dayOfWeek, bucket.halfHour));
  }

  async count(): Promise<number> {
    return this.rows.size;
  }

  async close(): Promise<void> {
    this.rows.clear();
  }
}

function keyOf(cell: string, dayOfWeek: number, halfHour: number): string {
  return `${cell}|${dayOfWeek}|${halfHour}`;
}
