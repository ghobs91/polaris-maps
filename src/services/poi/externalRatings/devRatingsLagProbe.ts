/**
 * Development-only runtime probe for place-card responsiveness while external
 * ratings resolve.
 *
 * The reported symptom ("the card locks up while ratings load, so tapping Get
 * Directions does nothing until they finish") is a *runtime* property: it
 * depends on the real WKWebView, the real provider pages and the real network.
 * Unit tests cannot observe it, and the two previous fixes for it were both
 * shipped on a theory. This probe makes the freeze measurable instead.
 *
 * It records, on a shared clock:
 *  - **stalls** — gaps in a 50 ms timer chain. A gap means the app's event loop
 *    (main thread and/or JS thread) was not servicing work, which is what
 *    swallows a tap.
 *  - **frame-gap** — gaps in a `requestAnimationFrame` chain, i.e. frames that
 *    were never presented.
 *  - **stage** — the ratings pipeline's transitions (provider + status).
 *  - **browser** — every hidden WKWebView mount/unmount (ratings browser and
 *    the in-sheet photos fallback): the expensive native events that would
 *    explain a freeze coinciding with a tap.
 *  - **mark** — user-visible interactions (e.g. "get directions tapped").
 *
 * Every event carries the ratings stage that was live when it was recorded, so
 * a stall is attributed without correlating by hand.
 *
 * Opt-in and dev-only. Nothing is sampled until `EXPO_PUBLIC_RATINGS_LAG_PROBE`
 * is set (`1` = sample, `scenario` = also run the scripted pass, `no-browser` =
 * A/B with the hidden ratings browser never mounted), or until `start()` is
 * called from the Hermes inspector. The report is written to
 * `Documents/external-ratings-lag-probe.json` when a ratings pass settles, and
 * on demand with `dump()`, readable with
 * `xcrun simctl get_app_container booted com.polarismaps.app data`.
 *
 * Nothing here runs in a release build.
 */

import { writeLedgerFile } from './ledgerFile';

const PROBE_FILE = 'lag-probe.json';

/**
 * Build-time switch. The freeze this exists to catch shows up in TestFlight,
 * i.e. in a release build (`__DEV__` false), so the probe must be compilable
 * into one: set `EXPO_PUBLIC_RATINGS_LAG_PROBE` before bundling (see
 * `installRatingsLagProbe`). Unset — the default for every shipping build —
 * inlines as empty and the probe never samples.
 */
const ENABLED = (process.env.EXPO_PUBLIC_RATINGS_LAG_PROBE ?? '') !== '';

/**
 * Whether the probe exists at all. A shipping build without the flag compiles
 * it out entirely — no global, no sampling, no store or search imports reached
 * at runtime.
 */
const AVAILABLE = ENABLED || __DEV__;

/** Sampling interval of the timer chain. */
const TICK_MS = 50;
/** A gap this much larger than the tick counts as a stall. */
const STALL_MIN_MS = 120;
/** Longest report we keep in memory (events are cheap; a long run is not). */
const MAX_EVENTS = 4000;

export interface LagEvent {
  /** ms since `start()`. */
  at: number;
  kind: 'stall' | 'frame-gap' | 'stage' | 'browser' | 'mark';
  /** Human-readable detail; for stalls/frame gaps this is the observed gap. */
  detail: string;
  /** Ratings stage that was live when the event was recorded. */
  stage: string | null;
}

interface ProbeState {
  running: boolean;
  startedAt: number;
  stage: string | null;
  events: LagEvent[];
  tickTimer: ReturnType<typeof setTimeout> | null;
  rafHandle: number | null;
  lastTickAt: number;
  lastFrameAt: number;
  /** A/B switch: when true the hidden ratings browser host renders nothing. */
  hiddenBrowserDisabled: boolean;
  /** Auto-dump once per pass, so a device run needs no tooling attached. */
  dumpedThisPass: boolean;
}

const state: ProbeState = {
  running: false,
  startedAt: 0,
  stage: null,
  events: [],
  tickTimer: null,
  rafHandle: null,
  lastTickAt: 0,
  lastFrameAt: 0,
  hiddenBrowserDisabled: false,
  dumpedThisPass: false,
};

function record(kind: LagEvent['kind'], detail: string): void {
  if (!state.running) return;
  if (state.events.length >= MAX_EVENTS) state.events.shift();
  state.events.push({ at: Date.now() - state.startedAt, kind, detail, stage: state.stage });
  // A TestFlight app's Documents directory cannot be pulled off the phone, so an
  // instrumented release build has to be readable from the system log:
  // `log stream --device --predicate 'subsystem == "com.facebook.react.log"'`.
  if (__DEV__ || ENABLED)
    console.log('[ratings-lag]', kind, detail, '| stage:', state.stage ?? 'none');
}

function tick(): void {
  if (!state.running) return;
  const now = Date.now();
  const gap = now - state.lastTickAt;
  state.lastTickAt = now;
  // The timer chain itself is the measurement: a late tick is a stall.
  if (gap > STALL_MIN_MS) record('stall', `${gap}ms`);
  state.tickTimer = setTimeout(tick, TICK_MS);
}

function frame(): void {
  if (!state.running) return;
  const now = Date.now();
  const gap = now - state.lastFrameAt;
  state.lastFrameAt = now;
  if (gap > STALL_MIN_MS) record('frame-gap', `${gap}ms`);
  state.rafHandle = requestAnimationFrame(frame);
}

/** Start sampling. Safe to call repeatedly. */
export function start(): void {
  if (!AVAILABLE) return;
  if (state.running) return;
  state.running = true;
  state.startedAt = Date.now();
  state.events = [];
  state.dumpedThisPass = false;
  state.lastTickAt = Date.now();
  state.lastFrameAt = Date.now();
  state.tickTimer = setTimeout(tick, TICK_MS);
  state.rafHandle = requestAnimationFrame(frame);
  record('mark', 'probe started');
}

/** Stop sampling. */
export function stop(): void {
  state.running = false;
  if (state.tickTimer) clearTimeout(state.tickTimer);
  if (state.rafHandle != null) cancelAnimationFrame(state.rafHandle);
  state.tickTimer = null;
  state.rafHandle = null;
}

/** True while a provider still has work queued. */
const UNSETTLED = /=(idle|searching|loading)/;

/**
 * Record a ratings pipeline transition (called from `useExternalRatings`) and
 * dump the report when the pass reaches a settled state, so a hand-driven
 * device run leaves evidence behind without anything attached.
 */
export function noteStage(detail: string): void {
  state.stage = detail;
  record('stage', detail);
  if (UNSETTLED.test(detail)) {
    state.dumpedThisPass = false;
    return;
  }
  if (state.running && !state.dumpedThisPass) {
    state.dumpedThisPass = true;
    setTimeout(() => void dump(), 1500);
  }
}

/** Record a hidden-browser lifecycle event (called from the hosts). */
export function noteBrowser(detail: string): void {
  record('browser', detail);
}

/** Record a user-visible interaction, so a freeze can be tied to a tap. */
export function mark(detail: string): void {
  record('mark', detail);
}

/** Turn the hidden ratings browser off (A/B) without touching the pipeline. */
export function setHiddenBrowserDisabled(disabled: boolean): void {
  state.hiddenBrowserDisabled = disabled;
  record('mark', `hidden browser ${disabled ? 'DISABLED' : 'enabled'}`);
}

export function isHiddenBrowserDisabled(): boolean {
  return state.hiddenBrowserDisabled;
}

export interface LagReport {
  running: boolean;
  durationMs: number;
  counts: Record<string, number>;
  /** Total time lost to stalls, and the worst single stall. */
  stalledMs: number;
  worstStallMs: number;
  /** Stalls grouped by the ratings stage that was live. */
  stallsByStage: Record<string, { count: number; totalMs: number; worstMs: number }>;
  events: LagEvent[];
}

/** Build the report. Kept small enough to paste back from a device run. */
export function report(): LagReport {
  const counts: Record<string, number> = {};
  const stallsByStage: Record<string, { count: number; totalMs: number; worstMs: number }> = {};
  let stalledMs = 0;
  let worstStallMs = 0;
  for (const event of state.events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    if (event.kind !== 'stall') continue;
    const ms = parseInt(event.detail, 10) || 0;
    stalledMs += ms;
    worstStallMs = Math.max(worstStallMs, ms);
    const key = event.stage ?? 'none';
    const bucket = (stallsByStage[key] ??= { count: 0, totalMs: 0, worstMs: 0 });
    bucket.count += 1;
    bucket.totalMs += ms;
    bucket.worstMs = Math.max(bucket.worstMs, ms);
  }
  return {
    running: state.running,
    durationMs: state.startedAt ? Date.now() - state.startedAt : 0,
    counts,
    stalledMs,
    worstStallMs,
    stallsByStage,
    events: state.events,
  };
}

/** Write the report to the app's documents directory. */
export function dump(): LagReport {
  const built = report();
  writeLedgerFile(PROBE_FILE, built);
  // The log line a device run is read from when the file is out of reach.
  if (__DEV__ || ENABLED) {
    console.log(
      '[ratings-lag] SUMMARY',
      JSON.stringify({
        durationMs: built.durationMs,
        counts: built.counts,
        stalledMs: built.stalledMs,
        worstStallMs: built.worstStallMs,
        stallsByStage: built.stallsByStage,
      }),
    );
  }
  return built;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Measure how long the event loop takes to service a queued callback.
 *
 * This is the closest observable stand-in for tap delivery: a touch is queued
 * like any other main-thread task, so the delay measured here is the delay a
 * finger would feel between contact and the handler running.
 */
function sampleLatency(): Promise<number> {
  return new Promise((resolve) => {
    const queuedAt = Date.now();
    setTimeout(() => resolve(Date.now() - queuedAt), 0);
  });
}

/**
 * A real venue with a real website, used when the live search cannot produce a
 * place that has one (a simulator's map viewport is often unset, and Overpass
 * is frequently cooling down). The run is about the *behaviour* — the ratings
 * pass plus the in-sheet photos fallback — so the place only has to be a real
 * venue whose real site loads.
 */
const FIXTURE_PLACE = {
  id: 4_000_002,
  lat: 37.7749,
  lng: -122.4375,
  name: 'Nopa',
  type: 'amenity',
  subtype: 'restaurant',
  tags: {
    amenity: 'restaurant',
    name: 'Nopa',
    website: 'https://www.nopa.com/',
    'addr:housenumber': '560',
    'addr:street': 'Divisadero Street',
    'addr:city': 'San Francisco',
    'addr:postcode': '94117',
  } as Record<string, string>,
};

/**
 * Drive the reported flow on a real build.
 *
 * 1. Search the live map centre and select a place that has a website (or fall
 *    back to {@link FIXTURE_PLACE}), which mounts the place card exactly as a
 *    tap would.
 * 2. Hold the card open for the whole provider pass, sampling how long the
 *    event loop takes to service a queued callback once a second.
 * 3. Then perform the same store updates a "Get Directions" tap performs.
 *
 * Touch delivery itself cannot be synthesized here, so the measurable proxy is
 * the event-loop state at each moment: a stalled loop cannot deliver the touch
 * or run the handler until it recovers.
 */
export async function runScenario(query = 'restaurant'): Promise<LagReport> {
  // Loaded here, not at module scope: the probe is imported by the ratings
  // controller, and pulling the search stack (vector tiles, SQLite) into that
  // module graph would drag native/ESM deps into every unit test that imports
  // the controller.
  const [{ useMapStore }, { useOsmPoiStore }, { unifiedSearch }] = await Promise.all([
    import('@/stores/mapStore'),
    import('@/stores/osmPoiStore'),
    import('@/services/search/unifiedSearch'),
  ]);

  start();
  const { viewport } = useMapStore.getState();
  const { lat, lng, zoom } = viewport;
  record('mark', `scenario start at ${lat.toFixed(4)},${lng.toFixed(4)}`);

  let place: typeof FIXTURE_PLACE | null = null;
  let source = 'fixture';
  try {
    const results = await unifiedSearch(query, { lat, lng, zoom, limit: 20 });
    place =
      (results.find((r) => r.poi?.tags?.website || r.poi?.tags?.['contact:website'])?.poi as
        | typeof FIXTURE_PLACE
        | undefined) ?? null;
    if (place) source = 'live search';
  } catch {
    place = null;
  }
  const target = place ?? FIXTURE_PLACE;
  record(
    'mark',
    `selecting ${target.name} (${source}, website=${
      target.tags.website ?? target.tags['contact:website'] ?? 'none'
    })`,
  );
  useOsmPoiStore.getState().setSelectedPoi(target);

  const openedAt = Date.now();
  const latencies: number[] = [];

  /**
   * Wait until a provider page is actually loading in the hidden browser: the
   * reported interaction happens *during* the load, not after it settles.
   */
  const waitForLiveStage = async (budgetMs: number): Promise<string | null> => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (state.stage && /=(searching|loading)/.test(state.stage)) return state.stage;
      await sleep(100);
    }
    return null;
  };

  // Phase 1: hold the card open and sample responsiveness across the open and
  // the first page load.
  for (let elapsed = 0; elapsed <= 9_000; elapsed += 1_000) {
    if (elapsed > 0) await sleep(1_000);
    const latency = await sampleLatency();
    latencies.push(latency);
    record('mark', `interaction latency ${latency}ms @${Date.now() - openedAt}ms`);
  }

  // Phase 2: the reported action, taken while the ratings row is still loading.
  const stageWhileLoading = await waitForLiveStage(15_000);
  record('mark', `live stage at interaction: ${stageWhileLoading ?? 'never became live'}`);
  // Let the page get a few hundred ms into its load, then act.
  await sleep(600);

  const startedAt = Date.now();
  const stageAtTap = state.stage;
  useMapStore.getState().setPendingDirectionsTarget({
    lat: target.lat,
    lng: target.lng,
    name: target.name,
  });
  useOsmPoiStore.getState().setSelectedPoi(null);
  record(
    'mark',
    `directions handler took ${Date.now() - startedAt}ms at stage ${stageAtTap ?? 'none'}`,
  );

  // Phase 3: the cost of tearing a mid-load WKWebView down lands *after* the
  // handler returns, so sample through it.
  for (let i = 0; i < 30; i += 1) {
    await sleep(250);
    const latency = await sampleLatency();
    latencies.push(latency);
    record('mark', `teardown latency ${latency}ms @+${i * 250 + 250}ms after tap`);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  record(
    'mark',
    `latency p50=${sorted[Math.floor(sorted.length / 2)]}ms worst=${sorted[sorted.length - 1]}ms`,
  );
  record('mark', `scenario done, card was open for ${Date.now() - openedAt}ms`);
  return dump();
}

interface ProbeApi {
  start: () => void;
  stop: () => void;
  mark: (detail: string) => void;
  report: () => LagReport;
  dump: () => LagReport;
  setHiddenBrowserDisabled: (disabled: boolean) => void;
  runScenario: (query?: string) => Promise<LagReport>;
}

/**
 * Publish the probe on `globalThis` so a dev build can be driven from the
 * Hermes inspector, and honour the opt-in env flag. Never installed in a
 * release build.
 */
export function installRatingsLagProbe(): void {
  if (!AVAILABLE) return;
  const api: ProbeApi = {
    start,
    stop,
    mark,
    report,
    dump,
    setHiddenBrowserDisabled,
    runScenario,
  };
  (globalThis as unknown as { __polarisRatingsLag: ProbeApi }).__polarisRatingsLag = api;

  if ((process.env.JEST_WORKER_ID ?? process.env.NODE_ENV) === 'test') return;
  if (!ENABLED) return;
  const mode = process.env.EXPO_PUBLIC_RATINGS_LAG_PROBE;
  if (mode === 'no-browser') setHiddenBrowserDisabled(true);
  start();
  // Let the map, database and region packs load before scripting a card.
  if (mode === 'scenario') setTimeout(() => void runScenario(), 12_000);
}
