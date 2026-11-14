/**
 * Local diagnostics ring buffer.
 *
 * Polaris has no telemetry backend. This keeps a small, redacted record of
 * network failures and mesh health on-device so a user (or the developer,
 * via the export sheet) can see *why* a feature degraded — for example, which
 * public endpoint started returning 403/429 during a launch spike.
 *
 * Nothing is uploaded automatically. Crash reports come from App Store
 * Connect, which already aggregates them without a third-party SDK.
 */

import type { MMKV } from 'react-native-mmkv';

/**
 * Resolve the encrypted MMKV instance lazily.
 *
 * Importing `storage/mmkv` eagerly pulls expo-crypto at module load, which
 * breaks Jest suites that only need the pure parsing/logging paths. Logging
 * degrades to memory-only if storage is unavailable.
 */
function getCache(): MMKV | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../storage/mmkv') as typeof import('../storage/mmkv');
    return mod.storage;
  } catch {
    return null;
  }
}

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface DiagnosticEntry {
  /** ISO timestamp. */
  t: string;
  /** Feature area, e.g. "geocoding" or "traffic-mesh". */
  scope: string;
  level: DiagnosticLevel;
  message: string;
  /** Small, already-redacted context object. */
  data?: Record<string, unknown>;
}

const CACHE_KEY = 'diagnostics:entries:v1';
const MAX_ENTRIES = 250;
const MAX_STRING_LENGTH = 300;
const PERSIST_DEBOUNCE_MS = 1_000;

let entries: DiagnosticEntry[] = [];
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Strip query strings (they can carry tokens) and bound length. */
function sanitizeText(value: string): string {
  const withoutQuery = value.replace(/(https?:\/\/[^\s?]+)\?\S*/g, '$1?<redacted>');
  return withoutQuery.slice(0, MAX_STRING_LENGTH);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return '[depth]';
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 20)) {
      out[key] = sanitizeValue(item, depth + 1);
    }
    return out;
  }
  return sanitizeText(String(value));
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = getCache()?.getString(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      entries = parsed.slice(-MAX_ENTRIES) as DiagnosticEntry[];
    }
  } catch {
    // Corrupt cache — start fresh.
  }
}

function persistNow(): void {
  try {
    getCache()?.set(CACHE_KEY, JSON.stringify(entries));
  } catch {
    // Storage must never break logging.
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

/** Append one entry. Safe to call from any failure path; never throws. */
export function logDiagnostic(
  scope: string,
  level: DiagnosticLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  try {
    hydrate();
    entries.push({
      t: new Date().toISOString(),
      scope: sanitizeText(scope),
      level,
      message: sanitizeText(message),
      data: data ? (sanitizeValue(data) as Record<string, unknown>) : undefined,
    });
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    schedulePersist();
  } catch {
    // Diagnostics must never affect app behavior.
  }
}

/** Snapshot for the export sheet or the on-device dashboard. */
export function getDiagnostics(): DiagnosticEntry[] {
  hydrate();
  return entries.map((entry) => ({ ...entry }));
}

/** Test-only: clear in-memory state. */
export function __resetDiagnosticsForTests(): void {
  entries = [];
  hydrated = false;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
