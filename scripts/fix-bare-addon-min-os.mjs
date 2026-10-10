#!/usr/bin/env node
/**
 * Align the `MinimumOSVersion` declared by the Bare addon frameworks with the
 * minimum OS their Mach-O binaries are actually built for.
 *
 * `bare-link` stamps a fixed `MinimumOSVersion` (currently 14.0) into every
 * addon framework's Info.plist, but some addons are compiled against a newer
 * SDK and carry a higher real minimum — `rocksdb-native` is built at 15.0.
 * App Store Connect rejects that inconsistency with:
 *
 *   ITMS-90208: Invalid Bundle - The bundle
 *   PolarisMaps.app/Frameworks/rocksdb-native.3.19.1.framework does not support
 *   the minimum OS Version specified in the Info.plist.
 *
 * Rewriting the plist to match the binary keeps the bundle honest and stays
 * within the app's own (higher) deployment target.
 *
 * Idempotent: a plist is only rewritten when its value is *lower* than the
 * binary minimum. Safe to run during `expo prebuild` and again from the
 * Podfile `post_install` (which runs after the podspec regenerates the addons).
 *
 * Usage: node scripts/fix-bare-addon-min-os.mjs [addonsDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function resolveAddonsDir() {
  const arg = process.argv[2];
  return arg
    ? path.resolve(arg)
    : path.join(repoRoot, 'node_modules', 'react-native-bare-kit', 'ios', 'addons');
}

/** Compare dotted version strings numerically. Returns -1 | 0 | 1. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function readPlistValue(plist, key) {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/** Highest `LC_BUILD_VERSION minos` across all slices of a Mach-O binary. */
function binaryMinOS(binPath) {
  let out;
  try {
    out = execFileSync('xcrun', ['vtool', '-show-build', binPath], { encoding: 'utf8' });
  } catch {
    return null;
  }
  const versions = [...out.matchAll(/minos\s+([0-9]+(?:\.[0-9]+)*)/g)].map((m) => m[1]);
  if (versions.length === 0) return null;
  return versions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
}

function main() {
  const addonsDir = resolveAddonsDir();
  if (!fs.existsSync(addonsDir)) {
    console.log(`[fix-bare-addon-min-os] no addons dir at ${addonsDir} — nothing to do`);
    return;
  }

  let scanned = 0;
  let fixed = 0;

  for (const xcfEntry of fs.readdirSync(addonsDir)) {
    if (!xcfEntry.endsWith('.xcframework')) continue;
    const xcf = path.join(addonsDir, xcfEntry);

    for (const slice of fs.readdirSync(xcf)) {
      const slicePath = path.join(xcf, slice);
      if (!fs.statSync(slicePath).isDirectory()) continue;

      for (const fwEntry of fs.readdirSync(slicePath)) {
        if (!fwEntry.endsWith('.framework')) continue;
        const fw = path.join(slicePath, fwEntry);
        const info = path.join(fw, 'Info.plist');
        if (!fs.existsSync(info)) continue;
        scanned++;

        const exe =
          readPlistValue(info, 'CFBundleExecutable') ?? fwEntry.replace(/\.framework$/, '');
        const bin = path.join(fw, exe);
        if (!fs.existsSync(bin)) continue;

        const minOS = binaryMinOS(bin);
        if (!minOS) continue;

        const declared = readPlistValue(info, 'MinimumOSVersion');
        if (declared && compareVersions(declared, minOS) >= 0) continue;

        const args = declared
          ? ['-replace', 'MinimumOSVersion', '-string', minOS, info]
          : ['-insert', 'MinimumOSVersion', '-string', minOS, info];
        execFileSync('/usr/bin/plutil', args);

        console.log(
          `[fix-bare-addon-min-os] ${path.relative(addonsDir, fw)}: ${declared ?? '(none)'} -> ${minOS}`,
        );
        fixed++;
      }
    }
  }

  console.log(`[fix-bare-addon-min-os] scanned ${scanned} framework slice(s), fixed ${fixed}`);
}

main();
