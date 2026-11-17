import type { TrafficHistoryBackend } from './trafficHistoryService';
import type { TimeBucket, TrafficAreaCondition } from '../../models/trafficHistory';

/**
 * In-memory backend used by unit tests and as a fallback when SQLite is
 * unavailable. Rows are keyed by `cell|dow|halfHour` for regular buckets and
 * `cell|dow|halfHour|holiday` for holiday ones (mirrors the SQLite split
 * into a regular and a holiday table).
 */
export class InMemoryTrafficHistoryBackend implements TrafficHistoryBackend {
  private rows = new Map<string, TrafficAreaCondition>();

  async init(): Promise<void> {
    /* nothing to do */
  }

  async insert(condition: TrafficAreaCondition): Promise<void> {
    this.rows.set(
      keyOf(condition.geohash5, condition.dayOfWeek, condition.halfHour, condition.holiday),
      condition,
    );
  }

  async update(condition: TrafficAreaCondition): Promise<void> {
    this.rows.set(
      keyOf(condition.geohash5, condition.dayOfWeek, condition.halfHour, condition.holiday),
      condition,
    );
  }

  async getByKey(cells: string[], bucket: TimeBucket): Promise<TrafficAreaCondition[]> {
    const out: TrafficAreaCondition[] = [];
    for (const cell of cells) {
      const row = this.rows.get(keyOf(cell, bucket.dayOfWeek, bucket.halfHour, bucket.holiday));
      if (row) out.push(row);
    }
    return out;
  }

  async getAll(): Promise<TrafficAreaCondition[]> {
    return Array.from(this.rows.values());
  }

  async remove(cell: string, bucket: TimeBucket): Promise<void> {
    this.rows.delete(keyOf(cell, bucket.dayOfWeek, bucket.halfHour, bucket.holiday));
  }

  async count(): Promise<number> {
    return this.rows.size;
  }

  async close(): Promise<void> {
    this.rows.clear();
  }
}

function keyOf(cell: string, dayOfWeek: number, halfHour: number, holiday?: boolean): string {
  return `${cell}|${dayOfWeek}|${halfHour}${holiday ? '|holiday' : ''}`;
}
