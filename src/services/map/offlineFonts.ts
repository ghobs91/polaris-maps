/**
 * Offline label fonts.
 *
 * MapLibre renders text labels from SDF glyph ranges fetched from the style's
 * `glyphs` URL. The online light/dark styles point at
 * `tiles.openfreemap.org`; offline that fetch fails and every label
 * disappears. We pre-download the ranges the styles actually use into a shared
 * directory and serve them over the same loopback tile server
 * (`{base}/offline-fonts/{fontstack}/{range}.pbf`) so downloaded regions keep
 * their labels with no connection.
 *
 * The directory lives outside `regions/{id}/` because the fontstacks are
 * shared by every region, not duplicated per pack. Existing packs with no
 * fonts simply stay label-less until the region is re-downloaded.
 */
import * as FileSystem from 'expo-file-system/legacy';

/** Fontstacks referenced by the light/dark style `text-font` lists. */
export const OFFLINE_FONTSTACKS = [
  'Noto Sans Regular',
  'Noto Sans Bold',
  'Noto Sans Italic',
] as const;

/**
 * 256-codepoint glyph blocks to bundle. Covers Latin-1 / Latin Extended,
 * Greek, Cyrillic and general punctuation — enough for place names in every
 * catalog region without pulling the full Unicode range set.
 */
export const OFFLINE_GLYPH_RANGES = [
  '0-255',
  '256-511',
  '768-1023',
  '1024-1279',
  '8192-8447',
] as const;

/** Tile-server source id the glyph ranges are registered under. */
export const OFFLINE_FONTS_SOURCE_ID = 'offline-fonts';

const FONTS_REMOTE_BASE = 'https://tiles.openfreemap.org/fonts';
const FONTS_DIR_NAME = 'offline-fonts';

/** Shared directory the glyph ranges are stored in. */
export function offlineFontsDir(): string {
  return `${FileSystem.documentDirectory ?? ''}${FONTS_DIR_NAME}/`;
}

/** Loopback glyphs template for a running tile server. */
export function offlineGlyphsUrl(baseUrl: string): string {
  return `${baseUrl}/${OFFLINE_FONTS_SOURCE_ID}/{fontstack}/{range}.pbf`;
}

/**
 * Remote URL for one fontstack range. The fontstack (e.g. `Noto Sans
 * Regular`) is path-encoded so the space survives the download client; the
 * loopback server percent-decodes it back on the way out.
 */
export function remoteGlyphUrl(fontstack: string, range: string): string {
  return `${FONTS_REMOTE_BASE}/${encodeURIComponent(fontstack)}/${range}.pbf`;
}

/** True when a fonts directory has been populated (best-effort existence check). */
export async function hasOfflineFonts(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(offlineFontsDir());
    return info.exists;
  } catch {
    return false;
  }
}

/**
 * Download the bundled font ranges from OpenFreeMap, skipping any already on
 * disk. Best-effort: a failed range only costs some glyphs, never the map.
 * Call while online (it runs as part of a region download).
 */
export async function downloadOfflineFonts(): Promise<void> {
  const dir = offlineFontsDir();
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  } catch {
    return;
  }

  for (const stack of OFFLINE_FONTSTACKS) {
    const stackDir = `${dir}${stack}/`;
    try {
      await FileSystem.makeDirectoryAsync(stackDir, { intermediates: true });
    } catch {
      continue;
    }
    for (const range of OFFLINE_GLYPH_RANGES) {
      const dest = `${stackDir}${range}.pbf`;
      try {
        if ((await FileSystem.getInfoAsync(dest)).exists) continue;
        await FileSystem.downloadAsync(remoteGlyphUrl(stack, range), dest);
      } catch {
        // Skip individual range failures.
      }
    }
  }
}
