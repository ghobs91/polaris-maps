import type {
  TimeBucket,
  TrafficAreaCondition,
  WireConditionEntry,
} from '../../models/trafficHistory';
import { HISTORICAL_MAX_AGE_DAYS, MAX_SAMPLE_COUNT } from '../../models/trafficHistory';
import { consumePublishBudget, qualifiesForPublish } from './publishBudget';
import type { NostrEvent } from './nostrFallback';
import { createSignedEvent, publishStoredEvent, verifyEvent } from './nostrFallback';
import { getActiveRelays } from './nostrRelayDirectory';

/**
 * P2P traffic-profile exchange over Nostr — "Polaris traffic flow segments".
 *
 * Historical weekly traffic profiles (geohash5 cell × day-of-week × 30-min
 * bucket EMA aggregates) are published as stored Nostr events so any device
 * can pull them from always-on public relays, even when no Hyperswarm peers
 * are online. Event shape:
 *
 *   kind: 30110 (custom, NIP-33 parameterized-replaceable range 30000–39999)
 *   d tag: "<geohash5>:<dayOfWeek>:<halfHour>"  (one profile per key)
 *   g tag: <geohash5>                           (REQ filter target)
 *   content: {"v":1,"p":<probeSamples>,"e":{g,d,h,s,r,f,n,u}}
 *
 * Redistribution gate: only probe-dominant rows are ever published. Rows
 * whose observations are predominantly licensed upstream seeds (TomTom) or
 * open-feed data must not be redistributed through shared relays —
 * `canPublishProfile` enforces the probe-sample threshold.
 *
 * Incoming events are fully verified (NIP-01 event id + Schnorr signature
 * over the traffic identity key) before their entries are returned; callers
 * merge them into the local history index, where sample-count weighting
 * bounds any single publisher's influence.
 */

// ── Constants ────────────────────────────────────────────────────────

/** Custom parameterized-replaceable event kind for traffic profiles. */
export const TRAFFIC_PROFILE_KIND = 30110;

/** Minimum interval between republications of the same cell+bucket profile. */
export const PROFILE_PUBLISH_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Cap on entries requested in a single profile query. */
export const PROFILE_QUERY_LIMIT = 100;

/** Default window to wait for relay answers. */
export const PROFILE_QUERY_TIMEOUT_MS = 3_500;

/**
 * Content version.
 *
 * v1: one bucket per event (`d` = `<cell>:<dow>:<hh>`).
 * v2: the whole week for one cell per event (`d` = `<cell>:week`). This is the
 *     scale-safe shape: stored relay events grow with (devices × cells)
 *     instead of (devices × cells × buckets), up to 48× fewer per cell.
 *     v1 events are still parsed, so old publishes keep working.
 */
const PROFILE_CONTENT_VERSION = 2;

// ── Pure helpers (unit tested) ───────────────────────────────────────

/**
 * Whether a historical row may be republished through shared transports:
 * enough total samples, a probe-sample share above the threshold, and still
 * inside the retention window.
 */
export function canPublishProfile(row: TrafficAreaCondition, nowSec: number): boolean {
  // Scale-safe gate: probe-dominant, well-sampled, observed on more than one
  // day (so a single drive is never broadcast as a weekly pattern), and still
  // inside the retention window.
  return qualifiesForPublish(row, nowSec, HISTORICAL_MAX_AGE_DAYS);
}

function wireEntryFor(row: TrafficAreaCondition): Record<string, number | string> {
  return {
    d: row.dayOfWeek,
    h: row.halfHour,
    s: row.avgSpeedMph,
    r: row.avgCongestionRatio,
    f: row.freeFlowSpeedMph,
    n: row.sampleCount,
    u: row.lastUpdated,
  };
}

/**
 * Serialize every publishable bucket of one cell into a single event body.
 * `p` carries the highest probe-sample count among the included rows.
 */
export function buildProfileContent(rows: readonly TrafficAreaCondition[]): string {
  const cell = rows[0]?.geohash5 ?? '';
  return JSON.stringify({
    v: PROFILE_CONTENT_VERSION,
    g: cell,
    p: rows.reduce((max, r) => Math.max(max, r.probeSamples), 0),
    e: rows.map(wireEntryFor),
  });
}

/** NIP-33 tags: one replaceable event per cell per week. */
export function buildProfileTags(cell: string): string[][] {
  return [
    ['d', `${cell}:week`],
    ['g', cell],
  ];
}

/** NIP-01 filter for pulling profiles covering the given cells. */
export function buildProfileFilter(cells: string[], sinceSec: number): Record<string, unknown> {
  return {
    kinds: [TRAFFIC_PROFILE_KIND],
    '#g': cells,
    since: sinceSec,
    limit: PROFILE_QUERY_LIMIT,
  };
}

/**
 * Parse and validate a profile event, returning every entry it carries.
 *
 * Verifies the NIP-01 id + Schnorr signature and range-checks every field.
 * Handles both content versions: v2 (week-per-cell, `e` is an array) and v1
 * (single bucket, `e` is an object) so previously published profiles remain
 * readable. Returns [] for anything that fails a check.
 */
export function parseProfileEvent(event: NostrEvent): WireConditionEntry[] {
  if (event.kind !== TRAFFIC_PROFILE_KIND) return [];
  if (!verifyEvent(event)) return [];

  try {
    const content = JSON.parse(event.content) as {
      v?: number;
      g?: string;
      p?: number;
      e?: unknown;
    };
    const probeSamples =
      typeof content.p === 'number' && content.p >= 0 && content.p <= MAX_SAMPLE_COUNT
        ? content.p
        : 0;

    // v1: { v:1, p, e: { g, d, h, s, r, f, n, u } }
    if (content.v === 1) {
      const raw = content.e as Record<string, unknown> | undefined;
      const entry = raw ? entryFromWire(raw, raw.g, probeSamples) : null;
      return entry ? [entry] : [];
    }

    // v2: { v:2, g, p, e: [ { d, h, s, r, f, n, u }, ... ] }
    if (content.v === PROFILE_CONTENT_VERSION && Array.isArray(content.e)) {
      if (typeof content.g !== 'string' || content.g.length < 4 || content.g.length > 12) return [];
      const out: WireConditionEntry[] = [];
      for (const raw of content.e as Array<Record<string, unknown>>) {
        const entry = entryFromWire(raw, content.g, probeSamples);
        if (entry) out.push(entry);
      }
      return out;
    }

    return [];
  } catch {
    return [];
  }
}

/** Validate one wire entry and convert it, or null when any field is invalid. */
function entryFromWire(
  raw: Record<string, unknown>,
  cell: unknown,
  probeSamples: number,
): WireConditionEntry | null {
  if (typeof cell !== 'string' || cell.length < 4 || cell.length > 12) return null;
  const { d, h, s, r, f, n, u } = raw;
  if (typeof d !== 'number' || d < 0 || d > 6) return null;
  if (typeof h !== 'number' || h < 0 || h > 47) return null;
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return null;
  if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 1) return null;
  if (typeof f !== 'number' || !Number.isFinite(f) || f <= 0) return null;
  if (typeof n !== 'number' || n < 0 || n > MAX_SAMPLE_COUNT) return null;
  if (typeof u !== 'number' || u <= 0) return null;
  return { g: cell, d, h, s, r, f, n, u, fr: 0, p: probeSamples };
}

/**
 * Merge two entry lists, deduping per cell: the entry with the higher
 * sample count wins (ties keep the first list's entry). Pure.
 */
export function mergeConditionEntries(
  primary: WireConditionEntry[],
  secondary: WireConditionEntry[],
): WireConditionEntry[] {
  const byCell = new Map<string, WireConditionEntry>();
  for (const entry of [...primary, ...secondary]) {
    const existing = byCell.get(entry.g);
    if (!existing || entry.n > existing.n) byCell.set(entry.g, entry);
  }
  return Array.from(byCell.values());
}

// ── Publishing ───────────────────────────────────────────────────────

const lastPublishAt = new Map<string, number>();

/** Throttle is per cell: one replaceable event carries the cell's whole week. */
function throttleKey(cell: string): string {
  return `${cell}:week`;
}

/**
 * Publish probe-derived historical rows as traffic profile events to all
 * connected relays. Skips rows below the probe-share gate and cells
 * published within the throttle window. Returns the number of events sent.
 */
export async function publishProfileConditions(
  rows: TrafficAreaCondition[],
  opts: { nowMs?: number; minIntervalMs?: number } = {},
): Promise<number> {
  if (rows.length === 0) return 0;
  const nowMs = opts.nowMs ?? Date.now();
  const minInterval = opts.minIntervalMs ?? PROFILE_PUBLISH_THROTTLE_MS;
  const nowSec = Math.floor(nowMs / 1000);

  // Group by cell: one replaceable event per cell carries the whole week, so
  // relay storage grows with (devices × cells), not (devices × cells × buckets).
  const byCell = new Map<string, TrafficAreaCondition[]>();
  for (const row of rows) {
    if (!canPublishProfile(row, nowSec)) continue;
    const group = byCell.get(row.geohash5);
    if (group) group.push(row);
    else byCell.set(row.geohash5, [row]);
  }

  let sent = 0;
  const events: NostrEvent[] = [];
  const signing: Promise<void>[] = [];

  for (const [cell, cellRows] of byCell) {
    const key = throttleKey(cell);
    const last = lastPublishAt.get(key) ?? 0;
    if (nowMs - last < minInterval) continue;
    // Hard per-device daily cap: one install cannot flood public relays.
    if (!consumePublishBudget('profile', nowMs)) break;
    lastPublishAt.set(key, nowMs);
    signing.push(
      createSignedEvent(
        TRAFFIC_PROFILE_KIND,
        buildProfileContent(cellRows),
        buildProfileTags(cell),
        nowSec,
      ).then((event) => {
        events.push(event);
      }),
    );
  }

  await Promise.all(signing);
  for (const event of events) {
    if (publishStoredEvent(event) > 0) sent++;
  }
  return sent;
}

// ── Querying ─────────────────────────────────────────────────────────

/**
 * Pull traffic profiles for the given cells + bucket from the active relay
 * set. Opens one-shot connections (REQ → collect → EOSE/timeout → close) so
 * queries are independent of the fallback relay sockets. Resolves with
 * verified, deduped entries — [] on any failure; never rejects.
 */
export async function queryNostrProfiles(
  cells: string[],
  bucket: TimeBucket,
  timeoutMs: number = PROFILE_QUERY_TIMEOUT_MS,
): Promise<WireConditionEntry[]> {
  if (cells.length === 0) return [];

  let relayUrls: string[];
  try {
    relayUrls = await getActiveRelays();
  } catch {
    return [];
  }
  if (relayUrls.length === 0) return [];

  const sinceSec = Math.floor(Date.now() / 1000) - HISTORICAL_MAX_AGE_DAYS * 86_400;
  const filter = buildProfileFilter(cells, sinceSec);

  const collected = new Map<string, WireConditionEntry>();
  await Promise.race([
    Promise.all(
      relayUrls.map((url) => collectFromRelay(url, filter, collected, timeoutMs).catch(() => {})),
    ),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  // Only entries matching the requested bucket are usable by the cascade.
  return Array.from(collected.values()).filter(
    (e) => e.d === bucket.dayOfWeek && e.h === bucket.halfHour,
  );
}

/** Dedupe key for a profile entry: one condition per cell + bucket. */
function entryKey(entry: WireConditionEntry): string {
  return `${entry.g}|${entry.d}|${entry.h}`;
}

function collectFromRelay(
  url: string,
  filter: Record<string, unknown>,
  collected: Map<string, WireConditionEntry>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Already closed
      }
      resolve();
    };

    const subId = `prof-${Math.random().toString(36).slice(2, 10)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      resolve();
      return;
    }

    const timer = setTimeout(done, timeoutMs);

    ws.onopen = () => {
      try {
        ws.send(JSON.stringify(['REQ', subId, filter]));
      } catch {
        done();
      }
    };
    ws.onmessage = (event: { data: string }) => {
      try {
        const msg = JSON.parse(event.data) as unknown[];
        if (msg[0] === 'EOSE') {
          done();
          return;
        }
        if (msg[0] === 'EVENT' && msg.length >= 3) {
          for (const entry of parseProfileEvent(msg[2] as NostrEvent)) {
            // Dedupe per (cell, bucket): several publishers may cover the same
            // cell, and a v2 event carries every bucket for its cell.
            const key = entryKey(entry);
            const existing = collected.get(key);
            if (!existing || entry.n > existing.n) collected.set(key, entry);
          }
        }
      } catch {
        // Malformed relay message — keep collecting until EOSE/timeout
      }
    };
    ws.onerror = () => done();
    ws.onclose = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}
