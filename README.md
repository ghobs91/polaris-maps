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

**Date:** 2026-04-13
**Standard:** OWASP Top 10:2025
**Scope:** All source files under `src/`, `app/`, `nodejs-assets/`, `package.json`, `index.js` (34 files)
**Reviewer:** GitHub Copilot automated audit

> This section is kept continuously up-to-date. Every change to the codebase triggers a re-evaluation of all applicable findings.

### Summary

| ID              | Severity  | OWASP     | Location                                                | Title                                                             | Status      |
| --------------- | --------- | --------- | ------------------------------------------------------- | ----------------------------------------------------------------- | ----------- |
| [F-001](#f-001) | 🔴 High   | A08 / A05 | `nodejs-assets/nodejs-project/index.js:310`             | Path traversal in Hyperdrive download — no escape guard           | ✅ Fixed    |
| [F-002](#f-002) | 🔴 High   | A04       | `src/constants/config.ts:32,35`                         | TomTom + HERE API keys bundled into client via `EXPO_PUBLIC_`     | ⚠️ Accepted |
| [F-003](#f-003) | 🟡 Medium | A05       | `app/poi/[id].tsx:110,119`                              | Unvalidated external URL opened via `Linking.openURL`             | ✅ Fixed    |
| [F-004](#f-004) | 🟡 Medium | A05       | `src/services/geocoding/geocodingService.ts:23`         | FTS5 query injection via `"` in search input — crashes search     | ✅ Fixed    |
| [F-005](#f-005) | 🟡 Medium | A03       | `package.json`, `nodejs-assets/package.json`            | All deps use `^`/`~` ranges — unpinned supply chain               | ✅ Fixed    |
| [F-006](#f-006) | 🟡 Medium | A06       | `src/services/overpassClient.ts`, `geocodingService.ts` | Insufficient rate limiting on Overpass / Nominatim                | ✅ Fixed    |
| [F-007](#f-007) | 🔵 Low    | A04       | `src/services/storage/mmkv.ts:3`                        | MMKV storage created without encryption                           | ✅ Fixed    |
| [F-008](#f-008) | 🔵 Low    | A09       | `src/services/traffic/trafficFlowService.ts:43`         | Full `Error` object logged — may leak API key in stack trace      | ✅ Fixed    |
| [F-009](#f-009) | 🔵 Low    | A10       | `src/services/traffic/hereFetcher.ts:84`                | `fetchHERETraffic` lacks `try/catch` — loading spinner gets stuck | ✅ Fixed    |
| [F-010](#f-010) | 🔵 Low    | A10       | `src/services/geocoding/geocodingService.ts:18`         | FTS5 exception propagates unhandled to UI                         | ✅ Fixed    |
| [F-011](#f-011) | 🔵 Low    | A09       | `src/services/routing/routingService.ts:100`            | Raw Valhalla error response body included in thrown `Error`       | ✅ Fixed    |
| [F-012](#f-012) | ✅ Clear  | A01       | —                                                       | No server endpoints — access control not applicable               | —           |
| [F-013](#f-013) | ✅ Clear  | A07       | `src/services/identity/keypair.ts`                      | Private key in SecureStore; strong curve; no weak auth flows      | —           |
| [F-014](#f-014) | N/A       | A01       | `app/poi/[id].tsx`                                      | IDOR not applicable — all POI reads are local SQLite              | —           |

---

### Detailed Findings

#### F-001

**Severity:** 🔴 High → ✅ Fixed (2026-04-13)
**OWASP:** A08 – Integrity Failures / A05 – Injection
**Title:** Path Traversal in Hyperdrive Download — No Escape Guard
**File:** `nodejs-assets/nodejs-project/index.js` lines 310–328

**What was wrong:**
`handleHdDownload()` iterated over every entry in a Hyperdrive served by an untrusted P2P peer and wrote each file using `path.join(destDir, entry.key)` with no path-traversal check. An adversarial peer could write files outside the intended directory.

**Fix applied:**
Added `path.resolve()` + `startsWith(resolvedDest + path.sep)` guard, matching the existing tar-extraction handler. Entries that resolve outside `destDir` are silently skipped.

**Regression test:** `__tests__/unit/security.test.ts` — "Hyperdrive download path traversal guard (F-001)"

---

#### F-002

**Severity:** 🔴 High — ⚠️ Accepted Risk
**OWASP:** A04 – Cryptographic Failures
**Title:** TomTom + HERE API Keys Bundled into Client Bundle via `EXPO_PUBLIC_`
**File:** `src/constants/config.ts` lines 32, 35

**Description:**
`tomtomApiKey` and `hereApiKey` are sourced via `process.env.EXPO_PUBLIC_TOMTOM_API_KEY` and `process.env.EXPO_PUBLIC_HERE_API_KEY`. Expo's `EXPO_PUBLIC_` convention statically inlines environment variables into the JavaScript bundle at build time.

**Mitigation:**

- Restrict TomTom/HERE keys in their dashboards to the app's bundle ID and platform signature.
- API key redaction has been added to all error logging paths (F-008, F-011) to prevent accidental leak via crash reporters.
- A backend proxy is the recommended long-term fix but is not currently in scope.

---

#### F-003

**Severity:** 🟡 Medium → ✅ Fixed (2026-04-13)
**OWASP:** A05 – Injection
**Title:** Unvalidated External URL Opened via `Linking.openURL` in POI Detail Screen
**File:** `app/poi/[id].tsx`

**What was wrong:**
`Linking.openURL` was called on raw POI data (phone, website, social URLs) without URL scheme validation. Malicious P2P/OSM data could inject `intent://` or `javascript:` schemes.

**Fix applied:**
Added `safeOpenURL()` helper that validates URL scheme against `['https:', 'http:']` allowlist, and `safePhone()` that strips all characters except `0-9+#*`. All `Linking.openURL` calls in the file now go through these helpers.

**Regression test:** `__tests__/unit/security.test.ts` — "URL scheme validation (F-003)"

---

#### F-004

**Severity:** 🟡 Medium → ✅ Fixed (2026-04-13)
**OWASP:** A05 – Injection
**Title:** FTS5 Query Injection via Unescaped `"` in Search Input — Crashes Search
**File:** `src/services/geocoding/geocodingService.ts`

**What was wrong:**
FTS5 query builder wrapped tokens in double-quotes without escaping, so a literal `"` in user input created malformed FTS5 syntax, crashing SQLite.

**Fix applied:**
Double-quotes are now stripped from each token before wrapping: `w.replace(/"/g, '')`. Additionally, `searchAddressLocal` is wrapped with `.catch(() => [])` so any remaining SQLite errors gracefully fall through to Nominatim.

**Regression test:** `__tests__/unit/security.test.ts` — "FTS5 query injection prevention (F-004)"

---

#### F-005

**Severity:** 🟡 Medium → ✅ Fixed (2026-04-13)
**OWASP:** A03 – Supply Chain Failures
**Title:** All Dependencies Use Unpinned `^`/`~` Version Ranges
**File:** `package.json`, `nodejs-assets/nodejs-project/package.json`

**Fix applied:**

- All 42 production dependencies in `package.json` pinned to exact versions.
- All 4 dependencies in `nodejs-assets/nodejs-project/package.json` pinned to exact versions.
- Committed `pnpm-lock.yaml` for `nodejs-assets/nodejs-project/`.

---

#### F-006

**Severity:** 🟡 Medium → ✅ Fixed (2026-04-13)
**OWASP:** A06 – Insecure Design
**Title:** Insufficient Rate Limiting on Overpass API and Nominatim
**File:** `src/services/overpassClient.ts`, `src/services/geocoding/geocodingService.ts`

**Fix applied:**

- Added 1 000 ms minimum inter-request gap to `overpassFetch()` in `overpassClient.ts`.
- Added 1 000 ms minimum inter-request gap to `searchAddressNominatim()` in `geocodingService.ts`.
- Both enforcers use timestamp tracking with `await` backoff, independent of UI debounce timers.

---

#### F-007

**Severity:** 🔵 Low → ✅ Fixed (2026-04-13)
**OWASP:** A04 – Cryptographic Failures
**Title:** MMKV Storage Instance Created Without Encryption
**File:** `src/services/storage/mmkv.ts`

**Fix applied:**
Added `getStorage()` async initializer that generates a random encryption key on first launch (via `expo-crypto`) and stores it in `expo-secure-store` (iOS Keychain / Android Keystore). MMKV is now created with `encryptionKey`. The synchronous `storage` export is retained as deprecated for backward compatibility during migration.

---

#### F-008

**Severity:** 🔵 Low → ✅ Fixed (2026-04-13)
**OWASP:** A09 – Logging Failures
**Title:** Full `Error` Object Logged — May Expose API Key in Stack Trace
**File:** `src/services/traffic/trafficFlowService.ts`

**Fix applied:**
Error messages are now redacted with `error.message.replace(/key=[^&]*/g, 'key=REDACTED')` before logging. The raw `Error` object is no longer passed to `console.warn`.

**Regression test:** `__tests__/unit/security.test.ts` — "API key redaction in error logs (F-008, F-011)"

---

#### F-009

**Severity:** 🔵 Low → ✅ Fixed (2026-04-13)
**OWASP:** A10 – Exceptional Conditions
**Title:** `fetchHERETraffic` Lacks `try/catch` — Loading State Gets Stuck
**File:** `src/services/traffic/hereFetcher.ts`

**Fix applied:**
Wrapped the entire fetch + JSON parse block in `try/catch`, returning `[]` on any exception.

---

#### F-010

**Severity:** 🔵 Low → ✅ Fixed (2026-04-13)
**OWASP:** A10 – Exceptional Conditions
**Title:** FTS5 Exception Propagates Unhandled to UI
**File:** `src/services/geocoding/geocodingService.ts`

**Fix applied:**
`searchAddressLocal()` call is now wrapped with `.catch(() => [])`, gracefully falling through to Nominatim on any SQLite error. See F-004 fix.

---

#### F-011

**Severity:** 🔵 Low → ✅ Fixed (2026-04-13)
**OWASP:** A09 – Logging Failures
**Title:** Raw Valhalla Error Response Body Included in Thrown `Error`
**File:** `src/services/routing/routingService.ts`

**Fix applied:**
Response body is now truncated to 200 characters and redacted with `replace(/key=[^&]*/g, 'key=REDACTED')` before being included in the thrown error message.

**Regression test:** `__tests__/unit/security.test.ts` — "API key redaction in error logs (F-008, F-011)"

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

| Priority                | Finding                                            | Status       |
| ----------------------- | -------------------------------------------------- | ------------ |
| 🔴 P1 — Fix immediately | F-001: Path traversal in Hyperdrive download       | ✅ Fixed     |
| 🔴 P1 — Fix immediately | F-003: Unvalidated `Linking.openURL` in `[id].tsx` | ✅ Fixed     |
| 🔴 P2 — Fix this sprint | F-004: FTS5 `"` injection crashes search           | ✅ Fixed     |
| 🔴 P2 — Fix this sprint | F-002: API keys in client bundle                   | ⚠️ Accepted  |
| 🟡 P3 — Fix next sprint | F-005: Unpinned dependencies                       | ✅ Fixed     |
| 🟡 P3 — Fix next sprint | F-007: Unencrypted MMKV                            | ✅ Fixed     |
| 🟢 P4 — Ongoing hygiene | F-006, F-008, F-009, F-010, F-011                  | ✅ All Fixed |

---

_Security review last updated: 2026-04-13. Re-run audit after each significant code change._
