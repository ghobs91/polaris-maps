/**
 * Tiny JSON-file persistence for the external-rating browse ledger.
 *
 * The browse policy must survive app restarts: a challenge cool-down, a hard
 * block, or a spent page-load budget that resets on every launch is not a
 * bound at all. These helpers keep that state in the app's documents
 * directory, and degrade to a no-op wherever a real filesystem is unavailable
 * (unit tests, web).
 */

const DIRECTORY = 'external-ratings';

async function fileSystem(): Promise<typeof import('expo-file-system/legacy') | null> {
  try {
    return await import('expo-file-system/legacy');
  } catch {
    return null;
  }
}

function pathFor(fs: typeof import('expo-file-system/legacy'), name: string): string | null {
  const root = fs.documentDirectory;
  if (!root) return null;
  return `${root}${DIRECTORY}-${name}`;
}

/** Read and parse a JSON ledger file. Never rejects; missing/unreadable → null. */
export async function readLedgerFile<T>(name: string): Promise<T | null> {
  const fs = await fileSystem();
  if (!fs) return null;
  const path = pathFor(fs, name);
  if (!path) return null;
  try {
    const info = await fs.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await fs.readAsStringAsync(path);
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Write a JSON ledger file. Fire-and-forget; failures are intentionally ignored. */
export function writeLedgerFile(name: string, value: unknown): void {
  void (async () => {
    const fs = await fileSystem();
    if (!fs) return;
    const path = pathFor(fs, name);
    if (!path) return;
    try {
      await fs.writeAsStringAsync(path, JSON.stringify(value));
    } catch {
      /* persistence is best-effort */
    }
  })();
}

/** Delete a ledger file. Fire-and-forget. */
export function deleteLedgerFile(name: string): void {
  void (async () => {
    const fs = await fileSystem();
    if (!fs) return;
    const path = pathFor(fs, name);
    if (!path) return;
    try {
      await fs.deleteAsync(path, { idempotent: true });
    } catch {
      /* persistence is best-effort */
    }
  })();
}
