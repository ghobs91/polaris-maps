# iOS capture harness (UI tests)

Drives the **installed** simulator build with real taps, so App Store screenshots
that need interaction (search → place card → directions → transit → navigation)
can be captured without a human.

It exists because this checkout has no other way to tap the simulator:

- `idb-companion` is not installable here (`brew install facebook/fb/idb-companion`
  stops on a Command Line Tools requirement),
- there is no Detox config or UI-test target in `ios/PolarisMaps.xcodeproj`,
- Apple Events to System Events are denied, so `osascript`/`cliclick` cannot
  click the Simulator window,
- iOS 27 prompts before honouring a custom-scheme `simctl openurl`, and a
  system alert cannot be dismissed without a tap.

The tests launch whatever build is installed on the simulator via
`XCUIApplication(bundleIdentifier: "com.polarismaps.app")`, so this never touches
`ios/` (a `expo prebuild` artifact) and does not need the app's sources.

## Usage

```bash
# 1. Generate the throwaway project (gitignored, under build/).
ruby tools/ios-capture/generate.rb

# 2. Install the build you want to shoot.
xcrun simctl install <udid> /path/to/PolarisMaps.app
xcrun simctl privacy <udid> grant location-always com.polarismaps.app
xcrun simctl ui <udid> appearance dark
xcrun simctl status_bar <udid> override --time "9:41" --batteryState charged --batteryLevel 100

# 3. Run a scenario.
xcodebuild test \
  -project tools/ios-capture/build/CaptureHarness.xcodeproj \
  -scheme CaptureHarness \
  -destination 'platform=iOS Simulator,id=<udid>' \
  -only-testing:CaptureHarnessUITests/CaptureTests/testCapturePlaceDetails

# 4. Collect the PNGs the scenario wrote (full resolution, 1320×2868).
xcrun simctl get_app_container <udid> com.polarismaps.capture-harness.xctrunner data
#   …/Documents/capture-*.png
```

Screenshots are written by the test into the runner's `Documents` directory and
the path is printed (`SAVED …`), so there is no race with `xcrun simctl io`.

## What is proven to work

- Onboarding walk (Get started → consent → map) and the persistent consent
  afterwards, so later runs start on the map.
- Search: taps the field, types, submits from the keyboard, and taps a result row
  **by frame centre** (`element.tap()` lands on the wrong view for these rows).
- The real place card opens from a search result: the hierarchy then carries
  `Buddakan`, `4.4`, `5,515 reviews`, `75 Ninth Ave, New York NY 10011`,
  `Open photo 1 … From the web · buddakannyc.com`, `Open Tripadvisor listing`,
  `Open street view`, `Directions`.
- Full-resolution PNG capture from inside the simulator.
- Map type switching: tap `Map layers and type`, then the chip by label suffix
  (the chips expose `", Satellite"` — the SF Symbol is glued into the label), and
  zoom-in with double-taps on a map coordinate.

## Imagery latency scenario (`testCaptureSatelliteZoomLatency`)

Reproduces the reported "blurry squares until the sharp imagery lands" flow:
satellite on → search `Levittown New York` → open the result → close
`Close place details` → five double-taps at 62%/40% of the screen, saving PNGs at
+1 s/+3 s/+9 s per level from the third tap on.

Read `sat-z3-1s` first. Blocky, upscaled pixels there (and still blocky in
`sat-z3-9s`) is the old behaviour: at z17+ the only nationwide layer is the
overzoomed z16 USGS cache while the NAIP ImageServer renders the real tile in
20–90 s. Crisp detail at +1 s is the NYS 2023 ortho provider (`ortho-us-ny` in
`src/constants/orthophotoSources.ts`) answering in ~0.3 s.

The app under test is whatever is installed. A Metro-connected debug build picks
up JS changes on relaunch; a release build runs the embedded `main.jsbundle`, so
to test a JS change against one, rebuild it with
`npx expo export:embed --entry-file index.js --platform ios --dev false --bytecode --bundle-output /tmp/after.hbc`
and swap the file inside the installed `.app`, then relaunch.

## Known gaps (why 02/05/06/07 are still not shot)

- Row taps are flaky across runs: the same scenario opened the card on one run
  and not the next. `element(label)` can match a stale or non-interactive node
  (map marker, recents row) before the list row exists; the fix is to scope the
  query to the results container and wait for its cells, not to match by label
  across the whole app.
- `Open street view` appeared in one place-card dump and was absent 15 s later in
  two others, so the action row needs a scroll and a longer availability wait
  before it can be tapped.
- Scenarios for transit (`Directions` → Transit tab) and navigation (`Navigate`
  → HUD) are written but not yet trustworthy, for the same hit-testing reason.

## Next step

Scope taps to a container (`app.scrollViews["…"].cells.element(boundBy: 0)`),
assert the destination element exists _before_ saving, and only then enable the
remaining scenarios. Each scenario already ends by saving a PNG, so a passing run
is the evidence that the state was right.
