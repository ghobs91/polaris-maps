/**
 * Expo config plugin: native loopback tile server.
 *
 * Copies the ObjC bridge module and its two Swift implementation files into the
 * iOS target and registers them:
 *
 *   - `PolarisTileServer.m`  — `RCT_EXTERN_MODULE` declaration (RN bridge)
 *   - `PolarisTileServer.swift` — 127.0.0.1-only HTTP server that serves
 *     `GET /{sourceId}/{path}` out of registered directories
 *   - `PolarisPmtiles.swift` — range-reader for a pack's `tiles.pmtiles`, used by
 *     the server's PMTiles source
 *
 * These files used to live only in `ios/`, which `expo prebuild --clean`
 * regenerates — so a prebuild silently deleted the native module and the
 * traffic raster layer plus offline pack serving both stopped working, with no
 * build error to explain it (`NativePolarisTileServer` is null, so
 * `src/native/tileServer` quietly returns 0 and every path falls back).
 *
 * No portal capability or entitlement is required — this is app code only, and
 * the listener binds to loopback.
 *
 * Background: `src/native/tileServer`, `src/services/traffic/trafficTileService.ts`.
 */
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.dirname(__filename);
const IOS_DIR = 'ios';
const NATIVE_SRC = path.join(PLUGIN_DIR, 'native');

const NATIVE_FILES = [
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisTileServer.m'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisTileServer.m'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisTileServer.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisTileServer.swift'),
  },
  {
    src: path.join(NATIVE_SRC, 'PolarisMaps', 'PolarisPmtiles.swift'),
    dest: path.join(IOS_DIR, 'PolarisMaps', 'PolarisPmtiles.swift'),
  },
];

function copyFiles() {
  for (const { src, dest } of NATIVE_FILES) {
    if (!fs.existsSync(src)) {
      console.warn('[withTileServer] Source file not found: ' + src);
      continue;
    }
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    console.log('[withTileServer] Copied ' + src + ' → ' + dest);
  }
}

function registerNativeFiles(project) {
  const groupUuid = project.findPBXGroupKey({ name: 'PolarisMaps' });
  const mainTarget = project.getFirstTarget();

  for (const { dest } of NATIVE_FILES) {
    const relativePath = dest.replace(/^ios\//, '');
    const fileName = path.basename(dest);

    if (project.hasFile(relativePath)) {
      continue;
    }

    const file = project.addSourceFile(relativePath, { target: mainTarget.uuid }, groupUuid);
    if (file) {
      console.log('[withTileServer] Registered ' + fileName + ' in Xcode project');
    } else {
      console.warn('[withTileServer] Failed to register ' + fileName);
    }
  }
}

function withTileServer(config) {
  config = withDangerousMod(config, [
    'ios',
    (cfg) => {
      copyFiles();
      return cfg;
    },
  ]);

  config = withXcodeProject(config, (cfg) => {
    registerNativeFiles(cfg.modResults);
    return cfg;
  });

  return config;
}

module.exports = withTileServer;
