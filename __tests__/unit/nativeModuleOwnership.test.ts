/**
 * Guards the native-module ownership rule: every native source file the iOS app
 * compiles must be owned by a config plugin, so `expo prebuild --clean` — which
 * deletes and regenerates `ios/` — cannot silently drop it.
 *
 * This is not hypothetical. `PolarisTileServer.swift` / `.m` and
 * `PolarisPmtiles.swift` lived only in `ios/` with no plugin copying them, while
 * every other native module had one. A prebuild would have removed the loopback
 * tile server with no build error to explain it: `src/native/tileServer` treats
 * a missing native module as "not available", so the traffic raster layer and
 * offline pack serving would have fallen back to their network paths.
 *
 * The check is deliberately structural rather than a list of filenames: it reads
 * the plugins and compares them with both sides of the copy, so adding a native
 * file the normal way (source in `plugins/native/`, copy in a `with*` plugin)
 * needs no test edit, and the broken way fails.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const NATIVE_SRC_DIR = path.join(PLUGINS_DIR, 'native', 'PolarisMaps');
const IOS_APP_DIR = path.join(REPO_ROOT, 'ios', 'PolarisMaps');

/**
 * Files the Expo iOS template generates or the app supplies as data, which no
 * plugin is expected to own. The bridging header is created by prebuild and then
 * patched in place by `withCloudStore` / `withLiveActivities` / `withValhalla`.
 */
const TEMPLATE_OWNED = new Set(['PolarisMaps-Bridging-Header.h']);

function configPluginFiles(): string[] {
  return fs
    .readdirSync(PLUGINS_DIR)
    .filter((f) => f.startsWith('with') && f.endsWith('.js'))
    .map((f) => path.join(PLUGINS_DIR, f));
}

/**
 * Every `path.join(NATIVE_SRC, 'PolarisMaps', 'X')` and
 * `path.join(IOS_DIR, 'PolarisMaps', 'X')` a plugin declares.
 */
function declaredFiles(): { sources: Set<string>; dests: Set<string> } {
  const sources = new Set<string>();
  const dests = new Set<string>();

  for (const file of configPluginFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(
      /path\.join\(\s*NATIVE_SRC,\s*'PolarisMaps',\s*'([^']+)'\s*\)/g,
    )) {
      sources.add(m[1]);
    }
    for (const m of text.matchAll(/path\.join\(\s*IOS_DIR,\s*'PolarisMaps',\s*'([^']+)'\s*\)/g)) {
      dests.add(m[1]);
    }
  }

  return { sources, dests };
}

function compiledNativeFiles(): string[] {
  return fs
    .readdirSync(IOS_APP_DIR)
    .filter((f) => f.endsWith('.swift') || f.endsWith('.m') || f.endsWith('.h'));
}

describe('native module ownership', () => {
  const { sources, dests } = declaredFiles();

  it('declares at least one native file per plugin that copies code', () => {
    // Sanity check on the parser: if the regexes stop matching, the guarantees
    // below become vacuous and the test would pass while proving nothing.
    expect(sources.size).toBeGreaterThan(10);
    expect(dests.size).toBeGreaterThan(10);
  });

  it('provides a source for every destination a plugin copies to', () => {
    // The bridging header is a destination only because plugins patch it in
    // place; prebuild creates it, so it has no source of ours.
    const missing = [...dests].filter((dest) => !TEMPLATE_OWNED.has(dest) && !sources.has(dest));
    expect(missing).toEqual([]);
  });

  it('has a source file on disk for every file a plugin copies', () => {
    const missing = [...sources].filter((src) => !fs.existsSync(path.join(NATIVE_SRC_DIR, src)));
    expect(missing).toEqual([]);
  });

  it('owns every native file the iOS target compiles', () => {
    const unowned = compiledNativeFiles().filter(
      (file) => !TEMPLATE_OWNED.has(file) && !dests.has(file),
    );
    // A file here exists only in `ios/` — the next `expo prebuild --clean`
    // deletes it. Move it to `plugins/native/PolarisMaps/` and add it to a
    // `with*` plugin.
    expect(unowned).toEqual([]);
  });

  it('registers every config plugin in app.json', () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'app.json'), 'utf8')) as {
      expo: { plugins: Array<string | [string, unknown]> };
    };
    const configured = new Set(
      appJson.expo.plugins
        .map((p) => (Array.isArray(p) ? p[0] : p))
        .filter((p) => p.startsWith('.')),
    );

    const missing = configPluginFiles()
      .map((f) => `./plugins/${path.basename(f, '.js')}`)
      .filter((p) => !configured.has(p));

    expect(missing).toEqual([]);
  });

  it('keeps the loopback tile server wired to a plugin', () => {
    // The specific regression: these three were the only native sources living
    // exclusively in `ios/`.
    for (const file of ['PolarisTileServer.swift', 'PolarisTileServer.m', 'PolarisPmtiles.swift']) {
      expect(sources.has(file)).toBe(true);
      expect(dests.has(file)).toBe(true);
      expect(fs.existsSync(path.join(NATIVE_SRC_DIR, file))).toBe(true);
    }
  });
});
