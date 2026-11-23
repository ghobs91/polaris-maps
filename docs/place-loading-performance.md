# Place card: where ratings and photos loading actually costs the UI

Status: **partially fixed and measured; the reported freeze itself is not
reproducible on the simulator.** Read "What is verified" before claiming a fix.

This document exists because the same symptom — _"opening a place locks the UI
until the ratings and/or photos finish, and sometimes the app crashes"_ — came
back after several rounds of changes that each moved the cost around instead of
identifying it. Before changing anything here, read the cost table and the rules
at the bottom.

## The symptom, precisely

Two different complaints are bundled together and they have different causes:

1. **"The UI locks up until it's done."** Something on the main thread or the JS
   thread is busy for as long as the load runs, so touches queue and renders
   stop.
2. **"It crashes sometimes."** Memory. This app can hold two web-content
   processes, a MapLibre surface, and decoded gallery images at the same time.

A third, cheaper-to-observe variant shows up in the code: the row can spin for
**up to ~56 s** (`STAGE_TIMEOUT_MS` 15 s + `PROVIDER_BUDGET_MS` 28 s, twice when
a second provider is queued) before it settles. Even with no freeze, that reads
as "stuck".

## Cost inventory (before this change)

Opening one place card with a website tag could start all of the following at
once. "Thread" is where the work lands; only the first column can block the app.

| Work                                                                               | Thread                                                                                                                     | Worst case per card open                                                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Venue homepage fetch + regex parse (`fetchWebsitePhotosResult`)                    | **JS (Hermes)**                                                                                                            | 4 host candidates × (1 homepage + 3 gallery subpages) = **16 requests**; every body sliced to 500 KB and scanned several times |
| `findContainerEnd` gallery scan                                                    | **JS**                                                                                                                     | O(containers × document) — quadratic on gallery-heavy pages                                                                    |
| Ratings listing discovery (`fetchDiscoveryHtml` + anchor scan)                     | **JS**                                                                                                                     | 1 × 500 KB fetch + scan, **and the raw HTML was retained in a 100-entry cache = up to 50 MB of JS heap**                       |
| Website action pills / cuisine chip (`fetchWebsiteActions`, `fetchCuisineOrigins`) | **JS**                                                                                                                     | same homepage again, up to 4 about-pages, each parsed                                                                          |
| Ratings provider browsing (`HiddenRatingsBrowserHost`)                             | **Main thread** (view create/destroy, cookie-store sync) + a separate **web-content process** (rendering, images, scripts) | up to 2 providers × 2 stages = **4 WKWebView create/destroy cycles**, each with a full-window full-page render                 |
| Photo fallback browser (`WebsitePhotosWebView`)                                    | **Main thread** + **web-content process**, mounted **inside the sheet's ScrollView**                                       | 1 more WKWebView per card, loading an arbitrary venue page for up to 15 s                                                      |
| Photo image decodes                                                                | Main thread / decoder                                                                                                      | every strip item, full-resolution originals (website photos have no size-limited URL)                                          |

Every row is per card open. Re-opening the same place repeats most of it.

## Why the previous rounds did not fix it

Each change was locally reasonable and left the structure intact:

- **Delaying the start** (`HEAVY_SECTIONS_DELAY_MS`) avoids competing with the
  sheet's opening spring, but the work still runs while the card is open and
  interactive.
- **Moving the ratings browser out of the sheet** removed one interference path
  (an animated/clipped/glass subtree) but the WebView was still created and
  destroyed once per stage, on the main thread.
- **A hidden-browser remount per stage** fixed a real load-path bug
  (`html → uri` never loads) at the cost of more create/destroy cycles — the most
  expensive native operation in the feature.
- **Instrumentation** (`devRatingsLagProbe`) was added but no measurement was
  ever recorded in the repository, so the next round was a guess again.

The common mistake: treating "the freeze" as a scheduling bug. It is a
_resource_ bug. Nothing about the UI can be made fast while the same process is
asked to fetch and parse megabytes of third-party HTML on its only JS thread,
render third-party pages in embedded browsers, and decode full-size images.

## What is verified

Measured on the iOS 27 simulator, release build, real network, with the scripted
scenario in `devRatingsLagProbe` (`EXPO_PUBLIC_RATINGS_LAG_PROBE=scenario`):

- The JS thread is **not** stalled during the ratings pass: the probe's 50 ms
  timer chain reported one 340 ms stall, at app start, not during the card
  (`latency p50 = 0 ms`, worst 16 ms across the open).
- No main-thread hang longer than 250 ms occurred during the pass (Time Profiler
  `potential-hangs`: two hangs, both during launch at 3.4 s and 4.3 s).
- The baseline browser cost per card open: **4** browser lifecycle events
  (`mount tripadvisor`, `photos mount`, `photos unmount`, `unmount tripadvisor`).
- The photo parser on the device runtime (release, Hermes): a **300 KB** page
  takes **30 ms** synchronously vs **56 ms** sliced. So the parse is not a
  multi-second freeze — it is a ~30 ms dropped-frame per page, worth removing
  because it is easy to remove, not the whole story. Out-of-process work (the
  browsers) is where the seconds and the memory are.

**So the reported freeze does not reproduce in this environment.** The simulator
runs on the host's CPU and GPU, while the web-content rendering, image decoding
and memory pressure that this design creates are device-bound. The remaining
unverified mechanisms are exactly the out-of-process ones: WebKit rendering
competing for GPU/CPU, and memory pressure ending in a jetsam kill.

After the changes below, the same scripted run (release build, real network)
shows:

- **One** browser mount and one unmount per pass (was four lifecycle events),
  and the rating still resolves through the reused view: TripAdvisor reported
  4.4 / 5,515 reviews for the live search hit, and the photo strip rendered the
  venue's own photos with no browser in the sheet.
- **A crash that this change introduced was found and fixed here**: parking the
  browser on `about:blank` aborted the app on the main thread
  (`-[WKWebView loadFileURL:]` via `-[RNCWebViewImpl visitSource]`). See the rule
  below. This is why a WebView lifecycle change needs a real run, not tests.

Two stalls remain in that run and are **not** explained by this change:

- **~10 s** during the scripted scenario's live search at map centre `0,0`
  (`unifiedSearch` → Overpass mirror fan-out), while no card is open and no
  browser is mounted. Search-path problem, needs its own investigation.
- **~1.1 s** at card open, immediately before the ratings browser mount, with the
  ratings stage still `idle`. The window is consistent with the WKWebView /
  web-content-process creation (the mount effect runs right after it), but that
  is not yet proven — attribute it with finer marks before changing anything.

## What changed here

1. **No browser inside the place card.** `WebsitePhotosWebView` is deleted. It
   was a second WKWebView (own web-content process) loading an arbitrary venue
   page inside the sheet's scroll view, for surfaces the plain scrape already
   covers in the common case.
2. **One bounded request for photos instead of up to sixteen.** No host-candidate
   fan-out loop, no gallery-subpage crawl. Two candidates maximum, one page each.
3. **HTML parsing no longer blocks the JS thread.**
   `extractPagePhotosAsync` walks the document in 48 KB slices with a 4 KB
   overlap and yields to the event loop after ~6 ms of work. The parsed document
   is capped at 300 KB. (The inserted `about:blank` / idle-park behaviour of the
   ratings browser and the parse timing are measured by the probe: look for
   `parse` events in the report.)
4. **One WKWebView per ratings pass, not per stage.**
   `HiddenRatingsBrowserHost` keeps a single view and navigates it between stage
   URIs (`uri → uri`, the load path that works). When no stage is live the view
   is unmounted after a 1.5 s grace window (which only exists to bridge a stage
   handoff between providers), so an idle app holds no web-content process.

   **Never navigate this (or any) WebView to a URL without a host.**
   react-native-webview routes a host-less `source` to
   `-[WKWebView loadFileURL:allowingReadAccessToURL:]`, which raises an ObjC
   exception on the main thread and aborts the process (SIGABRT). This was
   observed in a release build: an `about:blank` parking scheme crashed the app,
   with the crash log pointing at `-[RNCWebViewImpl visitSource]_block_invoke`.
   Release a page by unmounting the view, not by blanking it.

5. **Discovery cache bounded by bytes.** The ratings listing-discovery cache held
   up to 100 raw pages (≈50 MB of JS heap retained forever). It is now an 8-entry,
   2 MB budget with LRU eviction.
6. **Photo strip bounded** to eight decoded images, with recycling keys and
   clipped subviews.

## Rules for future changes in this area

These are the invariants the fixes above establish. Breaking one is what
re-introduces the freeze.

1. **Never parse HTML synchronously on the JS thread.** Use
   `extractPagePhotosAsync`, or a bounded slice loop with the same yield budget.
   A single synchronous pass over a 500 KB document on Hermes is hundreds of
   milliseconds.
2. **Never mount a WKWebView inside the place sheet or any animated/clipped/
   glass subtree.** One hidden browser, hosted as a sibling, reused across
   stages, unmounted when idle — never parked on a host-less URL (that aborts the
   app).
3. **Never create a WKWebView per stage.** Navigate it. The only reason to
   recreate one is a torn-down view.
4. **Never fan out network requests on card open.** One bounded request per
   source, with a hard timeout, and no cross-host retry loops.
5. **Bound every cache by bytes, not just entries.** A page is 500 KB.
6. **Bound the images you mount.** Decoded images are the other half of the
   memory story; never render an unbounded strip of full-resolution originals.

## Still open (needs a device run)

- **The freeze itself.** Not reproduced here. The measurement protocol is:
  build with `EXPO_PUBLIC_RATINGS_LAG_PROBE=scenario`, open a heavy place card,
  then read `Documents/external-ratings-lag-probe.json`: `stallsByStage`,
  `worstStallMs`, the `browser` events (should now be at most one `mount` per
  pass and no photos browser), and the `parse` events (sync vs sliced).
- **Out-of-process contention.** A web-content process rendering a provider page
  still runs on the device while the user is on the card. If a device run shows
  the app responsive but frames still suffering, the answer is to stop rendering
  third-party pages on the device entirely — move provider browsing to the relay
  or a background worklet — not another scheduling tweak inside the card.
- **Provider coverage.** Removing the photo WebView fallback loses JS-rendered
  galleries that the plain scrape cannot see. The plain scrape covers the
  gallery-heavy sites measured here (Squarespace 52 photos, Shopify 43, Wix 10
  from the homepage alone), but a venue whose gallery is rendered purely by JS
  will now show fewer photos.
