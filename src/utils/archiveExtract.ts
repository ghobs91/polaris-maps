import { extractTar as extractTarViaWorklet } from '../services/sync/hyperdriveBridge';

/**
 * Extract a tar (or tar.gz) archive via the Bare worklet
 * (`backend/hyperdrive.mjs`), replacing the dead `NodeChannel` sidecar.
 * Resolves when extraction is complete.
 */
export function extractTar(srcPath: string, destDir: string): Promise<void> {
  return extractTarViaWorklet(srcPath, destDir);
}
