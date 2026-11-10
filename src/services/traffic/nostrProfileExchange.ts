import type {
  TimeBucket,
  TrafficAreaCondition,
  WireConditionEntry,
} from '../../models/trafficHistory';
import {
  HISTORICAL_MAX_AGE_DAYS,
  MAX_SAMPLE_COUNT,
  MIN_PROBE_SAMPLES_FOR_PUBLISH,
} from '../../models/trafficHistory';
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

const PROFILE_CONTENT_VERSION = 1;

// ── Pure helpers (unit tested) ───────────────────────────────────────

/**
 * Whether a historical row may be republished through shared transports:
 * enough total samples, a probe-sample share above the threshold, and still
 * inside the retention window.
 */
export function canPublishProfile(row: TrafficAreaCondition, nowSec: number): boolean {
  const cutoff = nowSec - HISTORICAL_MAX_AGE_DAYS * 86_400;
  return (
    row.probeSamples >= MIN_PROBE_SAMPLES_FOR_PUBLISH &&
    row.sampleCount >= MIN_PROBE_SAMPLES_FOR_PUBLISH &&
    row.lastUpdated >= cutoff
  );
}

/** Serialize a condition row into profile event content (compact JSON). */
export function buildProfileContent(row: TrafficAreaCondition): string {
  return JSON.stringify({
    v: PROFILE_CONTENT_VERSION,
    p: row.probeSamples,
    e: {
      g: row.geohash5,
      d: row.dayOfWeek,
      h: row.halfHour,
      s: row.avgSpeedMph,
      r: row.avgCongestionRatio,
      f: row.freeFlowSpeedMph,
      n: row.sampleCount,
      u: row.lastUpdated,
    },
  });
}

/** NIP-33 tags for a profile event: parameterized-replaceable `d` + `g` filter. */
export function buildProfileTags(
  row: Pick<TrafficAreaCondition, 'geohash5' | 'dayOfWeek' | 'halfHour'>,
): string[][] {
  return [
    ['d', `${row.geohash5}:${row.dayOfWeek}:${row.halfHour}`],
    ['g', row.geohash5],
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
 * Parse and validate a profile event. Verifies the NIP-01 id + Schnorr
 * signature and range-checks every field; returns null for anything that
 * fails any check.
 */
export function parseProfileEvent(event: NostrEvent): WireConditionEntry | null {
  if (event.kind !== TRAFFIC_PROFILE_KIND) return null;
  if (!verifyEvent(event)) return null;

  try {
    const content = JSON.parse(event.content) as {
      v?: number;
      p?: number;
      e?: {
        g?: string;
        d?: number;
        h?: number;
        s?: number;
        r?: number;
        f?: number;
        n?: number;
        u?: number;
      };
    };
    const e = content.e;
    if (!e || content.v !== PROFILE_CONTENT_VERSION) return null;
    if (typeof e.g !== 'string' || e.g.length < 4 || e.g.length > 12) return null;
    if (typeof e.d !== 'number' || e.d < 0 || e.d > 6) return null;
    if (typeof e.h !== 'number' || e.h < 0 || e.h > 47) return null;
    if (typeof e.s !== 'number' || !Number.isFinite(e.s) || e.s <= 0) return null;
    if (typeof e.r !== 'number' || !Number.isFinite(e.r) || e.r < 0 || e.r > 1) return null;
    if (typeof e.f !== 'number' || !Number.isFinite(e.f) || e.f <= 0) return null;
    if (typeof e.n !== 'number' || e.n < 0 || e.n > MAX_SAMPLE_COUNT) return null;
    if (typeof e.u !== 'number' || e.u <= 0) return null;

    return {
      g: e.g,
      d: e.d,
      h: e.h,
      s: e.s,
      r: e.r,
      f: e.f,
      n: e.n,
      u: e.u,
      fr: 0,
      p: typeof content.p === 'number' && content.p >= 0 ? content.p : 0,
    };
  } catch {
    return null;
  }
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

function throttleKey(row: TrafficAreaCondition): string {
  return `${row.geohash5}:${row.dayOfWeek}:${row.halfHour}`;
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

  let sent = 0;
  const events: NostrEvent[] = [];
  const signing: Promise<void>[] = [];

  for (const row of rows) {
    if (!canPublishProfile(row, nowSec)) continue;
    const key = throttleKey(row);
    const last = lastPublishAt.get(key) ?? 0;
    if (nowMs - last < minInterval) continue;
    lastPublishAt.set(key, nowMs);
    signing.push(
      createSignedEvent(
        TRAFFIC_PROFILE_KIND,
        buildProfileContent(row),
        buildProfileTags(row),
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
  const entries = Array.from(collected.values()).filter(
    (e) => e.d === bucket.dayOfWeek && e.h === bucket.halfHour,
  );
  return dedupeByCell(entries);
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
          const entry = parseProfileEvent(msg[2] as NostrEvent);
          if (entry) {
            const existing = collected.get(entry.g);
            if (!existing || entry.n > existing.n) collected.set(entry.g, entry);
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

function dedupeByCell(entries: WireConditionEntry[]): WireConditionEntry[] {
  const byCell = new Map<string, WireConditionEntry>();
  for (const entry of entries) {
    const existing = byCell.get(entry.g);
    if (!existing || entry.n > existing.n) byCell.set(entry.g, entry);
  }
  return Array.from(byCell.values());
}
