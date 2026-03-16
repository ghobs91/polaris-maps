# Polaris Maps

A decentralized, peer-to-peer mapping application built with React Native / Expo. Polaris Maps combines real-time traffic data, offline vector maps, point-of-interest contribution, and a DePIN (Decentralized Physical Infrastructure Network) incentive layer.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [🔐 Security Review](#-security-review)

---

## Features

| Feature                                         | Status |
| ----------------------------------------------- | ------ |
| P2P map tile sharing via Hypercore / Hyperdrive | ✅     |
| Real-time traffic overlay (TomTom + HERE)       | ✅     |
| Dynamic ETA calculation with traffic adjustment | ✅     |
| Offline region tile packs                       | ✅     |
| Point-of-interest browsing, editing & review    | ✅     |
| Street-level imagery capture & viewer           | ✅     |
| Decentralized identity (secp256k1 keypair)      | ✅     |
| Dark mode with custom Apple Maps–inspired style | ✅     |
| Navigation mode with heading-up camera          | ✅     |
| OSM-backed local geocoding + Nominatim fallback | ✅     |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Expo Router (app/)          React Native UI         │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────┐   │
│  │  (tabs)  │  │   poi/   │  │  regions/       │   │
│  └──────────┘  └──────────┘  └─────────────────┘   │
├─────────────────────────────────────────────────────┤
│  State Layer (Zustand stores)                        │
│  mapStore · trafficStore · osmPoiStore               │
├─────────────────────────────────────────────────────┤
│  Service Layer (src/services/)                       │
│  traffic/ · routing/ · geocoding/ · poi/ · sync/    │
├─────────────────────────────────────────────────────┤
│  Native / P2P Bridge                                 │
│  nodejs-assets/ ← Hyperswarm · Hyperdrive · Gun.js  │
├─────────────────────────────────────────────────────┤
│  External APIs                                       │
│  TomTom  HERE  Valhalla  Overpass  Nominatim         │
└─────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer      | Technology                                                 |
| ---------- | ---------------------------------------------------------- |
| Framework  | React Native 0.76.9 + Expo SDK 52 (bare workflow)          |
| Language   | TypeScript 5.6.3 (strict)                                  |
| Navigation | Expo Router 4 + React Navigation 7                         |
| Maps       | MapLibre React Native 10 (alpha) + OpenFreeMap tiles       |
| State      | Zustand 5                                                  |
| Storage    | expo-sqlite (FTS5) · react-native-mmkv · expo-secure-store |
| Identity   | @noble/curves secp256k1 · @noble/hashes SHA-256            |
| P2P        | Hyperswarm · Hyperdrive · Hypercore · GunDB                |
| Traffic    | TomTom Traffic Flow v4 · HERE Traffic Flow v7              |
| Routing    | Valhalla (online)                                          |
| Geocoding  | expo-sqlite FTS5 local · Nominatim fallback                |
| Testing    | Jest 29 · @testing-library/react-native 12                 |
| Linting    | ESLint 9 flat config · Prettier                            |
| Commits    | Commitlint + Husky                                         |

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- Xcode 16 (iOS) or Android Studio (Android)
- CocoaPods (iOS: `sudo gem install cocoapods`)

### Install

```bash
git clone https://github.com/your-org/polaris-maps.git
cd polaris-maps
pnpm install
# iOS only
cd ios && pod install && cd ..
```

### Run

```bash
# iOS Simulator
pnpm ios

# Android Emulator
pnpm android

# Metro bundler only
pnpm start
```

---

## Environment Variables

Create a `.env` file in the project root (never commit it):

```env
EXPO_PUBLIC_TOMTOM_API_KEY=your_tomtom_key
EXPO_PUBLIC_HERE_API_KEY=your_here_key
EXPO_PUBLIC_TOMTOM_PROXY_URL=https://your-proxy-server/tomtom   # optional — preferred over direct key
```

> ⚠️ **Security note**: `EXPO_PUBLIC_` variables are **statically inlined into the JS bundle** at build time. They are visible in release APK/IPA files. See [F-002](#f-002--high--a04--api-keys-bundled-into-client-bundle) in the Security Review below. Restrict your keys by bundle ID in the TomTom / HERE dashboards, or proxy all API calls through a backend server.

---

## Project Structure

```
src/
  components/map/       MapView, TrafficOverlay, TrafficRouteLayer, POILayer
  constants/            config.ts, theme.ts, darkMapStyle.ts
  contexts/             ThemeContext
  hooks/                useLocation, useNavigation, useTraffic
  models/               traffic.ts, poi.ts, user.ts
  services/
    geocoding/          FTS5 local search + Nominatim
    identity/           keypair generation (SecureStore)
    poi/                OSM Overpass fetcher
    routing/            Valhalla routing
    storage/            MMKV singleton, SQLite helpers
    traffic/            tomtomFetcher, hereFetcher, trafficMerger, routeTrafficService
  stores/               mapStore, trafficStore, osmPoiStore
  types/                modules.d.ts (ambient declarations)
  utils/                etaCalculator, polyline, geohash
app/
  (tabs)/               index, navigation, search, profile
  imagery/              capture, viewer
  onboarding/
  poi/                  [id], edit, reviews
  regions/              index, offline
  settings/
nodejs-assets/nodejs-project/   Hyperswarm / Hyperdrive P2P bridge (Node.js side-channel)
specs/                  Feature specs, plans & research docs
```

---

## Testing

```bash
pnpm test            # jest with --passWithNoTests
pnpm typecheck       # tsc --noEmit
pnpm lint            # eslint
```

---

## 🔐 Security Review

**Date:** 2026-03-16
**Standard:** OWASP Top 10:2025
**Scope:** All source files under `src/`, `app/`, `nodejs-assets/`, `package.json`, `index.js` (34 files)
**Reviewer:** GitHub Copilot automated audit

> This section is kept continuously up-to-date. Every change to the codebase triggers a re-evaluation of all applicable findings.

### Summary

| ID              | Severity  | OWASP     | Location                                        | Title                                                             |
| --------------- | --------- | --------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| [F-001](#f-001) | 🔴 High   | A08 / A05 | `nodejs-assets/nodejs-project/index.js:310`     | Path traversal in Hyperdrive download — no escape guard           |
| [F-002](#f-002) | 🔴 High   | A04       | `src/constants/config.ts:32,35`                 | TomTom + HERE API keys bundled into client via `EXPO_PUBLIC_`     |
| [F-003](#f-003) | 🟡 Medium | A05       | `app/poi/[id].tsx:110,119`                      | Unvalidated external URL opened via `Linking.openURL`             |
| [F-004](#f-004) | 🟡 Medium | A05       | `src/services/geocoding/geocodingService.ts:23` | FTS5 query injection via `"` in search input — crashes search     |
| [F-005](#f-005) | 🟡 Medium | A03       | `package.json`, `nodejs-assets/package.json`    | All deps use `^`/`~` ranges — unpinned supply chain               |
| [F-006](#f-006) | 🟡 Medium | A06       | `src/services/poi/osmFetcher.ts:28`             | Insufficient rate limiting on Overpass / Nominatim                |
| [F-007](#f-007) | 🔵 Low    | A04       | `src/services/storage/mmkv.ts:3`                | MMKV storage created without encryption                           |
| [F-008](#f-008) | 🔵 Low    | A09       | `src/services/traffic/trafficFlowService.ts:43` | Full `Error` object logged — may leak API key in stack trace      |
| [F-009](#f-009) | 🔵 Low    | A10       | `src/services/traffic/hereFetcher.ts:84`        | `fetchHERETraffic` lacks `try/catch` — loading spinner gets stuck |
| [F-010](#f-010) | 🔵 Low    | A10       | `src/services/geocoding/geocodingService.ts:18` | FTS5 exception propagates unhandled to UI                         |
| [F-011](#f-011) | 🔵 Low    | A09       | `src/services/routing/routingService.ts:100`    | Raw Valhalla error response body included in thrown `Error`       |
| [F-012](#f-012) | ✅ Clear  | A01       | —                                               | No server endpoints — access control not applicable               |
| [F-013](#f-013) | ✅ Clear  | A07       | `src/services/identity/keypair.ts`              | Private key in SecureStore; strong curve; no weak auth flows      |
| [F-014](#f-014) | N/A       | A01       | `app/poi/[id].tsx`                              | IDOR not applicable — all POI reads are local SQLite              |

---

### Detailed Findings

#### F-001

**Severity:** 🔴 High
**OWASP:** A08 – Integrity Failures / A05 – Injection
**Title:** Path Traversal in Hyperdrive Download — No Escape Guard
**File:** `nodejs-assets/nodejs-project/index.js` lines 310–328

**Description:**
`handleHdDownload()` iterates over every entry in a Hyperdrive served by an untrusted P2P peer and writes each file using `path.join(destDir, entry.key)` with no path-traversal check. An adversarial peer can advertise a drive whose entries include keys like `../../shared_prefs/database.sqlite` or `../../../Library/Cookies/evil.js`. `path.join` collapses these traversal components, so `fs.writeFileSync` writes outside the intended region directory. The tar-extraction handler (`handleExtractTar`, line 161) has an explicit `resolvedDestDir` prefix guard — `handleHdDownload` does not.

```js
// VULNERABLE — nodejs-assets/nodejs-project/index.js ~line 318
for await (const entry of drive.list('/')) {
  const filePath = path.join(destDir, entry.key); // ← untrusted peer-controlled key
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = await drive.get(entry.key);
  if (content) {
    fs.writeFileSync(filePath, content); // can write anywhere on the device filesystem
  }
}
```

**Reproduction Steps:**

1. Run a Hyperswarm node that serves a Hyperdrive with an entry key `../../AppFiles/MainBundle/main.jsbundle`.
2. Trigger `hd-download` from the React Native layer with that drive's public key.
3. Observe `fs.writeFileSync` writing outside `destDir`.

**Fix:**

```js
const resolvedDest = path.resolve(destDir);
for await (const entry of drive.list('/')) {
  const filePath = path.resolve(destDir, entry.key);
  if (!filePath.startsWith(resolvedDest + path.sep)) {
    continue; // skip path-traversal attempts
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = await drive.get(entry.key);
  if (content) fs.writeFileSync(filePath, content);
}
```

---

#### F-002

**Severity:** 🔴 High
**OWASP:** A04 – Cryptographic Failures
**Title:** TomTom + HERE API Keys Bundled into Client Bundle via `EXPO_PUBLIC_`
**File:** `src/constants/config.ts` lines 32, 35

**Description:**
`tomtomApiKey` and `hereApiKey` are sourced via `process.env.EXPO_PUBLIC_TOMTOM_API_KEY` and `process.env.EXPO_PUBLIC_HERE_API_KEY`. Expo's `EXPO_PUBLIC_` convention statically inlines environment variables into the JavaScript bundle at build time. These keys are therefore present in plaintext inside the APK/IPA and can be trivially extracted with tools like `apktool`, `jadx`, or `strings`. Both keys are also emitted unencoded into tile-URL templates used by MapLibre, making them visible in device HTTP logs and proxied traffic captures.

```ts
// src/constants/config.ts
export const tomtomApiKey: string = process.env.EXPO_PUBLIC_TOMTOM_API_KEY ?? '';
export const hereApiKey: string = process.env.EXPO_PUBLIC_HERE_API_KEY ?? '';

// src/components/map/TrafficOverlay.tsx — key in raster tile URL
`${TOMTOM_FLOW_TILES_BASE_URL}/{z}/{x}/{y}.png?key=${tomtomApiKey}&tileSize=256&thickness=3`;
```

**Reproduction Steps:**

1. Build a release APK: `pnpm android`.
2. Unpack: `apktool d app-release.apk -o unpacked`.
3. Run: `grep -r 'tomtom\|hereApiKey' unpacked/assets/` — observe keys in plaintext inside the Hermes bytecode bundle.
4. Proxy HTTPS traffic from a real device — the key appears in tile-request query strings.

**Fix:**

- Restrict TomTom/HERE keys in their dashboards to the app's bundle ID and platform signature.
- Proxy all third-party API calls through a thin backend so keys never ship in the client.
- Set `EXPO_PUBLIC_TOMTOM_PROXY_URL` and route tile/flow requests through it.
- Rotate any keys that have been shipped in a release build.

---

#### F-003

**Severity:** 🟡 Medium
**OWASP:** A05 – Injection
**Title:** Unvalidated External URL Opened via `Linking.openURL` in POI Detail Screen
**File:** `app/poi/[id].tsx` lines 110, 119

**Description:**
Two `Linking.openURL` calls use POI data sourced from external P2P peers or OSM without any URL scheme validation:

1. **Line 110 — `tel:` URI**: Only whitespace is stripped from the phone field. A phone value containing DTMF tones like `+9999;dtmf=*#0600` can trigger unintended dialler side-effects.
2. **Line 119 — website URL**: No scheme check is performed. An attacker who controls or poisons OSM/P2P place data could set `website` to `intent://some-path#Intent;scheme=some-scheme;package=com.attacker;end`, triggering unintended Android intents.

Note: `POIInfoCard.tsx` correctly uses a `startsWith('http')` guard before opening URLs — this guard is **absent** in `[id].tsx`.

**Reproduction Steps:**

1. In the P2P or local DB, set a `Place.website` to `intent://navigate#Intent;scheme=geo;package=com.google.android.apps.maps;end`.
2. Navigate to `/poi/<id>`.
3. Tap the Website pressable — `Linking.openURL('intent://...')` fires without any user confirmation.

**Fix:**

```ts
const SAFE_SCHEMES = ['https:', 'http:'];

function safeOpenURL(raw: string): void {
  try {
    const u = new URL(raw);
    if (SAFE_SCHEMES.includes(u.protocol)) Linking.openURL(raw);
  } catch {
    /* malformed — ignore */
  }
}

function safePhone(raw: string): void {
  const cleaned = raw.replace(/[^0-9+#*]/g, '');
  if (cleaned.length > 0) Linking.openURL(`tel:${cleaned}`);
}
```

---

#### F-004

**Severity:** 🟡 Medium
**OWASP:** A05 – Injection
**Title:** FTS5 Query Injection via Unescaped `"` in Search Input — Crashes Search
**File:** `src/services/geocoding/geocodingService.ts` lines 23–30

**Description:**
`searchAddressLocal()` constructs an FTS5 `MATCH` expression by wrapping each space-separated token in double-quotes:

```ts
const ftsQuery = query
  .trim()
  .split(/\s+/)
  .map((w) => `"${w}"*`)
  .join(' ');
```

If the user types a word containing a literal `"` (e.g. `coffee"shop`), the resulting FTS5 expression becomes `"coffee"shop"*` — an unclosed phrase that causes SQLite to throw `fts5: syntax error near`. Since `searchAddressLocal` is not wrapped in `try/catch` and neither is its caller, this exception propagates as an unhandled rejection that silently kills the async chain, leaving the results list blank with no error message shown.

**Reproduction Steps:**

1. Open the Search tab.
2. Type `coffee"shop` (with a literal double-quote character).
3. Wait 350 ms — observe an unhandled SQLite FTS5 syntax error in Metro/RN logs; results stay empty.

**Fix:**

```ts
// Escape double-quotes before wrapping in FTS5 phrase syntax
const ftsQuery = query
  .trim()
  .split(/\s+/)
  .map((w) => `"${w.replace(/"/g, '')}"*`)
  .join(' ');

// AND in searchAddress — gracefully fall through to Nominatim on any error:
const localResults = await searchAddressLocal(query, limit).catch(() => []);
```

---

#### F-005

**Severity:** 🟡 Medium
**OWASP:** A03 – Supply Chain Failures
**Title:** All Dependencies Use Unpinned `^`/`~` Version Ranges
**File:** `package.json`, `nodejs-assets/nodejs-project/package.json`

**Description:**
Every package in both `package.json` files uses caret (`^`) or tilde (`~`) ranges. A compromised package published within the allowed semver range would be silently pulled in on the next `pnpm install`. The risk is highest for:

- `gun: "^0.2020.1240"` — P2P database with limited security scrutiny; any `0.x.y` ≥ 0.2020.1240 is accepted.
- `hyperswarm / hyperdrive / hypercore / corestore` (nodejs-assets) — P2P networking stack that processes arbitrary untrusted peer data. A supply-chain compromise here could enable remote code execution.
- `@maplibre/maplibre-react-native: "^10.0.0-alpha.2"` — pre-release; may accept breaking or malicious later alpha versions.

The `pnpm-lock.yaml` partially mitigates this for reproducible CI builds, but `nodejs-assets/nodejs-project` has **no committed lockfile**.

**Fix:**

- Pin all production dependencies to exact versions (remove `^` / `~`).
- Add `pnpm install --frozen-lockfile` to CI to prevent unintended upgrades.
- Commit a `package-lock.json` or `pnpm-lock.yaml` for `nodejs-assets/nodejs-project`.
- Run `pnpm audit` in CI and block on Critical/High CVEs.

---

#### F-006

**Severity:** 🟡 Medium
**OWASP:** A06 – Insecure Design
**Title:** Insufficient Rate Limiting on Overpass API and Nominatim
**File:** `src/services/poi/osmFetcher.ts:28`; `src/services/geocoding/geocodingService.ts:63`

**Description:**
The Overpass and Nominatim APIs are public services with strict acceptable-use policies:

- **Nominatim**: max 1 request/second per IP.
- **Overpass**: community-funded service intended for light use only.

The app debounces the OSM POI fetch by 600 ms and the search by 350 ms. During active navigation with frequent panning this can exceed both providers' policies, risking IP bans that break functionality for all users sharing the same egress IP address (e.g., home routers, VPNs, cellular NAT).

Additionally, `fetchHERETraffic` (`hereFetcher.ts:84`) has no top-level `try/catch`. If re-enabled, any network failure will leave `isExternalFetchLoading` stuck at `true`.

**Fix:**

- Enforce a minimum 1 000 ms inter-request gap for Nominatim (beyond the debounce).
- Wrap `fetchHERETraffic` in `try/catch` returning `[]` on any exception.
- Honour `Retry-After` headers from both services.
- Cache geocoding results locally to reduce repeat queries for the same string.

---

#### F-007

**Severity:** 🔵 Low
**OWASP:** A04 – Cryptographic Failures
**Title:** MMKV Storage Instance Created Without Encryption
**File:** `src/services/storage/mmkv.ts` line 3

**Description:**

```ts
export const storage = new MMKV({ id: 'polaris-maps-default' });
```

MMKV without an `encryptionKey` writes data in an unencrypted binary format to the app's data directory. On rooted Android or jailbroken iOS devices this exposes: consent choices, onboarding completion flag, favorites, search history, and the offline sync queue.

The private key is **not** at risk — it is correctly stored in `expo-secure-store` (iOS Keychain / Android Keystore).

**Reproduction Steps:**
On a rooted Android device: `adb shell su -c 'strings /data/data/com.polarismaps/files/polaris-maps-default.mmkv'` — observe plaintext key-value data.

**Fix:**

```ts
import * as SecureStore from 'expo-secure-store';
import { MMKV } from 'react-native-mmkv';

let _storage: MMKV | null = null;

export async function getStorage(): Promise<MMKV> {
  if (_storage) return _storage;
  let encKey = await SecureStore.getItemAsync('mmkv_enc_key');
  if (!encKey) {
    encKey = randomHex(32); // generate once at first run
    await SecureStore.setItemAsync('mmkv_enc_key', encKey);
  }
  _storage = new MMKV({ id: 'polaris-maps-default', encryptionKey: encKey });
  return _storage;
}
```

---

#### F-008

**Severity:** 🔵 Low
**OWASP:** A09 – Logging Failures
**Title:** Full `Error` Object Logged — May Expose API Key in Stack Trace
**File:** `src/services/traffic/trafficFlowService.ts` line 43

**Description:**

```ts
console.warn('[TrafficFlowService] Fetch failed, keeping previous data:', error);
```

The raw `Error` object is passed to the logger. If the error originates from a `fetch()` failure and the error message includes the full URL (which contains the TomTom API key as a query parameter), that key would appear in any connected crash-reporting service (Sentry, Crashlytics, etc.).

**Fix:**

```ts
const msg =
  error instanceof Error ? error.message.replace(/key=[^&]*/g, 'key=REDACTED') : String(error);
console.warn('[TrafficFlowService] Fetch failed:', msg);
```

---

#### F-009

**Severity:** 🔵 Low
**OWASP:** A10 – Exceptional Conditions
**Title:** `fetchHERETraffic` Lacks `try/catch` — Loading State Gets Stuck
**File:** `src/services/traffic/hereFetcher.ts` lines 80–90

**Description:**
`fetchHERETraffic()` awaits `fetch(url)` and `response.json()` without a surrounding `try/catch`. Currently disabled in `trafficFlowService.ts`, but if re-enabled without adding error handling, any network hiccup will throw an unhandled exception through `fetchAndUpdateTraffic`, bypassing the `finally` block that clears `isExternalFetchLoading` and leaving the loading spinner stuck indefinitely.

**Fix:**

```ts
export async function fetchHERETraffic(
  viewport: ViewportBounds,
): Promise<NormalizedTrafficSegment[]> {
  if (!hereApiKey) return [];
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data: HEREFlowResponse = await response.json();
    // ...
  } catch {
    return [];
  }
}
```

---

#### F-010

**Severity:** 🔵 Low
**OWASP:** A10 – Exceptional Conditions
**Title:** FTS5 Exception Propagates Unhandled to UI
**File:** `src/services/geocoding/geocodingService.ts` line 18

**Description:**
`searchAddress()` calls `searchAddressLocal()` without a `try/catch`. If the FTS5 `MATCH` query throws (see [F-004](#f-004) for the trigger), the exception propagates through `searchAddress` to the debounced callback in `search.tsx`, which also lacks error handling. The async chain silently dies, leaving results blank with no user feedback. This is a secondary consequence of F-004; fixing F-004 will also address this.

**Fix:**

```ts
const localResults = await searchAddressLocal(query, limit).catch(() => []);
if (localResults.length > 0) return localResults;
return searchAddressNominatim(query, limit);
```

---

#### F-011

**Severity:** 🔵 Low
**OWASP:** A09 – Logging Failures
**Title:** Raw Valhalla Error Response Body Included in Thrown `Error`
**File:** `src/services/routing/routingService.ts` lines 100–102

**Description:**
When the Valhalla routing API returns a non-200 status, the full response body is embedded into the thrown `Error`:

```ts
const text = await res.text().catch(() => res.statusText);
throw new Error(`Online routing error ${res.status}: ${text}`);
```

Valhalla error responses can include internal routing engine details or query parameters. If these `Error` objects are captured by crash reporters, verbose internal details appear in production logs.

**Fix:**

```ts
const raw = await res.text().catch(() => '');
const safe = raw.slice(0, 200).replace(/key=[^&]*/g, 'key=REDACTED');
throw new Error(`Online routing error ${res.status}: ${safe}`);
```

---

#### F-012

**Severity:** ✅ Clear
**OWASP:** A01 – Broken Access Control

No server-side endpoints are defined in this codebase — it is a fully client-side mobile application. All data access is either local (SQLite, MMKV) or directed at third-party public APIs (TomTom, HERE, Valhalla, Nominatim, Overpass). The P2P Hyperdrive data sharing uses cryptographic Hypercore keys as access tokens. Access control at the server level is not applicable.

---

#### F-013

**Severity:** ✅ Clear
**OWASP:** A07 – Authentication Failures
**File:** `src/services/identity/keypair.ts`

User identity is based on a `secp256k1` keypair generated via `@noble/curves` (a well-audited, constant-time implementation). The private key is generated with `schnorr.utils.randomPrivateKey()` (CSPRNG-backed) and stored **exclusively** in `expo-secure-store`, which maps to the iOS Keychain and Android Keystore. It is never written to MMKV, AsyncStorage, or any less-secure storage. No password-based authentication is implemented. This is appropriate for a decentralized app with no central auth server.

---

#### F-014

**Severity:** N/A
**OWASP:** A01 – Broken Access Control (IDOR)
**File:** `app/poi/[id].tsx`

`app/poi/[id].tsx` reads a POI by ID from the local POI store (`getPlaceById`). The `id` path parameter comes from Expo Router's `useLocalSearchParams`. Since this is a local SQLite read on-device with no remote endpoint, there is no IDOR surface — the user can only read their own device's data.

---

### Priority Action Plan

| Priority                | Finding                                            | Effort                              |
| ----------------------- | -------------------------------------------------- | ----------------------------------- |
| 🔴 P1 — Fix immediately | F-001: Path traversal in Hyperdrive download       | Low — 5-line fix                    |
| 🔴 P1 — Fix immediately | F-003: Unvalidated `Linking.openURL` in `[id].tsx` | Low — extract `safeOpenURL` helper  |
| 🔴 P2 — Fix this sprint | F-004: FTS5 `"` injection crashes search           | Low — escape + `.catch(() => [])`   |
| 🔴 P2 — Fix this sprint | F-002: API keys in client bundle                   | Medium — add backend proxy          |
| 🟡 P3 — Fix next sprint | F-005: Unpinned dependencies                       | Low — pin versions, add lockfile    |
| 🟡 P3 — Fix next sprint | F-007: Unencrypted MMKV                            | Medium — add SecureStore-backed key |
| 🟢 P4 — Ongoing hygiene | F-006, F-008, F-009, F-010, F-011                  | Low each                            |

---

_Security review last updated: 2026-03-16. Re-run audit after each significant code change._
