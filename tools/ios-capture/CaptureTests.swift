import XCTest

/// Drives the installed Polaris Maps build with real taps.
///
/// The app target is not part of this project: `XCUIApplication(bundleIdentifier:)`
/// launches whatever build is installed on the simulator, so the harness never
/// touches `ios/PolarisMaps.xcodeproj`.
///
/// Screenshots are taken from the host (`xcrun simctl io … screenshot`) while a
/// scenario holds its final state, so each scenario ends in `hold()`.
final class CaptureTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.polarismaps.app")

    override func setUp() {
        continueAfterFailure = true
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "app did not come to foreground")
        sleep(8)
    }

    // MARK: - helpers

    /// Any descendant carrying this accessibility label (the app renders most
    /// controls as `Other`/`StaticText` rather than `Button`).
    private func element(_ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    @discardableResult
    /// Tap the first element whose label ends with `suffix`. Map-type chips and
    /// other icon+text rows glue the SF Symbol into the label ("  , Satellite"),
    /// so an exact match on the visible text misses them.
    private func tapSuffix(_ suffix: String, wait: TimeInterval = 10) -> Bool {
        let target = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label ENDSWITH %@", suffix))
            .firstMatch
        guard target.waitForExistence(timeout: wait) else {
            print("MISSING(suffix): \(suffix)")
            return false
        }
        let frame = target.frame
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.midX, dy: frame.midY))
            .tap()
        sleep(2)
        return true
    }

    private func tap(_ label: String, wait: TimeInterval = 15) -> Bool {
        let target = element(label)
        guard target.waitForExistence(timeout: wait) else {
            print("MISSING: \(label)")
            return false
        }
        // Always tap the element's frame centre in app coordinates: several rows
        // render their label inside a non-interactive static text, where
        // `element.tap()` lands on the wrong view (or nothing at all).
        let frame = target.frame
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.midX, dy: frame.midY))
            .tap()
        sleep(2)
        return true
    }

    private func walkOnboardingIfNeeded() {
        if element("Get started").waitForExistence(timeout: 8) {
            tap("Get started")
            // Consent step: keep the defaults (all on) and continue.
            for label in ["Continue", "Agree and continue", "Start exploring", "Done"] {
                if tap(label, wait: 5) { break }
            }
            sleep(4)
        }
    }

    private func dump(_ tag: String) {
        print("===HIERARCHY-START \(tag)===")
        print(app.debugDescription)
        print("===HIERARCHY-END \(tag)===")
    }

    private func hold(_ seconds: UInt32) {
        sleep(seconds)
    }

    /// Write a full-resolution PNG into the runner's Documents directory so the
    /// host can collect it deterministically (no timing race with `simctl io`).
    private func save(_ name: String) {
        let shot = XCUIScreen.main.screenshot()
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = dir.appendingPathComponent("capture-\(name).png")
        do {
            try shot.pngRepresentation.write(to: url)
            print("SAVED \(url.path)")
        } catch {
            print("SAVE-FAILED \(error)")
        }
    }

    /// Search for a place and open its card. Leaves the card on screen.
    private func openPlaceCard(_ query: String, rowLabel: String) {
        walkOnboardingIfNeeded()
        tap("Quick category search")
        sleep(2)
        let field = app.textFields.firstMatch
        guard field.waitForExistence(timeout: 10) else {
            print("MISSING: search field")
            return
        }
        field.tap()
        field.typeText(query)
        sleep(5)
        let searchKey = app.keyboards.buttons["search"]
        if searchKey.exists { searchKey.tap() } else { field.typeText("\n") }
        sleep(6)
        tap(rowLabel, wait: 15)
        // Photos, ratings and street-view actions stream in after the card opens.
        sleep(14)
    }

    // MARK: - scenarios

    /// Onboards, then prints the main hierarchy so the other scenarios can be
    /// written against real labels.
    func testOnboardAndDump() {
        walkOnboardingIfNeeded()
        hold(5)
        dump("main")
    }

    /// Search, open the place card, then open street view from its action row.
    /// This is the end-to-end check for the Mapillary query change: the viewer
    /// only reaches Mapillary if the panorama list it builds is non-empty.
    func testCaptureStreetView() {
        walkOnboardingIfNeeded()
        tap("Quick category search")
        sleep(2)
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no search field")
        field.tap()
        field.typeText("Buddakan New York")
        sleep(5)
        let searchKey = app.keyboards.buttons["search"]
        if searchKey.exists { searchKey.tap() } else { field.typeText("\n") }
        sleep(6)

        let rows = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Buddakan"))
            .allElementsBoundByIndex
        print("ROWS \(rows.count): \(rows.map(\.label))")
        guard let row = rows.last else {
            XCTFail("no Buddakan result row")
            return
        }
        let f = row.frame
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: f.midX, dy: f.midY))
            .tap()
        sleep(10)

        guard element("Open street view").waitForExistence(timeout: 15) else {
            print("MISSING: Open street view")
            return
        }
        tap("Open street view")
        // Panoramas load from three providers; Mapillary gets 20s of its own.
        sleep(25)
        save("04-street-level")
        hold(3)
    }

    /// Reproduces the reported "card locks up while ratings/photos load" flow and
    /// keeps tapping through it, so the app's lag probe records what a finger
    /// would feel: open a place card from a real search result, then send a tap
    /// every 250 ms for 25 s while ratings resolve, and leave the card on screen.
    ///
    /// Read the probe report afterwards (`Documents/external-ratings-lag-probe.json`
    /// in the app container): `stallsByStage`, the `browser create →` mark and the
    /// `browser` mount events attribute any stall, and the `stage` events say
    /// whether the ratings pass actually resolved.
    func testMeasureCardLockup() {
        walkOnboardingIfNeeded()
        tap("Quick category search")
        sleep(2)
        let field = app.textFields.firstMatch
        guard field.waitForExistence(timeout: 10) else {
            print("MISSING: search field")
            return
        }
        field.tap()
        field.typeText("Buddakan New York")
        sleep(5)
        let searchKey = app.keyboards.buttons["search"]
        if searchKey.exists { searchKey.tap() } else { field.typeText("\n") }
        sleep(6)

        // The distance suffix depends on the map viewport, so match on the name.
        let rows = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Buddakan,"))
            .allElementsBoundByIndex
        print("ROWS \(rows.count): \(rows.map(\.label))")
        guard let row = rows.last else {
            print("MISSING: Buddakan result row")
            return
        }
        let frame = row.frame
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: frame.midX, dy: frame.midY))
            .tap()
        print("TAPPED card at \(Date())")

        // Keep touching the card while the ratings/photos pipeline runs: a stall
        // that swallows these taps is exactly what the report is for.
        let cardTop = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.62))
        for i in 0..<100 {
            cardTop.tap()
            if i % 10 == 0 { print("TAP \(i) at \(Date())") }
            usleep(250_000)
        }

        dump("locked-card")
        save("12-card-lockup")
        hold(2)
    }

    /// Explore the search → place-card path so its labels can be captured.
    func testExploreSearch() {
        walkOnboardingIfNeeded()
        tap("Quick category search")
        sleep(3)
        dump("searchfield")
        let field = app.textFields.firstMatch
        if field.waitForExistence(timeout: 5) {
            field.tap()
            field.typeText("Buddakan New York")
            sleep(6)
            // Submit from the keyboard so the results are not behind it.
            let searchKey = app.keyboards.buttons["search"]
            if searchKey.exists { searchKey.tap() } else { field.typeText("\n") }
            sleep(6)
        } else {
            print("MISSING: text field")
        }
        dump("results")

        let row = element("Buddakan, New York, 0.2 mi away")
        if row.waitForExistence(timeout: 10) {
            row.tap()
            sleep(14)
            dump("place")
        } else {
            print("MISSING: result row")
        }
    }

    /// End-to-end check for the z17+ imagery latency fix: switch to satellite,
    /// move to Levittown NY (inside the NYS 2023 ortho coverage, which is the
    /// provider added for this), zoom to ~z19 with five double-taps and sample
    /// the imagery at +1 s / +3 s / +9 s per level.
    ///
    /// Sharp detail in `<prefix>-z3-1s` means the fast provider answered; the
    /// blocky overzoomed z16 cache there (and at +9 s) means the change had no
    /// effect for that viewport.
    func testCaptureSatelliteZoomLatency() {
        runSatelliteZoomScenario(query: "Levittown New York", rowPrefix: "Levittown", prefix: "sat")
    }

    /// Massachusetts serves `{z}/{y}/{x}` straight out of a cached MapServer.
    /// The search box only looks near the camera, so the scenario recentres the
    /// map on the simulated location instead of searching for a distant city.
    func testCaptureMassachusettsOrtho() {
        runLocateZoomScenario(prefix: "ma")
    }

    /// Indiana renders per request through an ImageServer `exportImage`.
    func testCaptureIndianaOrtho() {
        runLocateZoomScenario(prefix: "in")
    }

    /// Connecticut is a 3-inch cached ImageServer cache.
    func testCaptureConnecticutOrtho() {
        runLocateZoomScenario(prefix: "ct")
    }

    /// The remote search can take tens of seconds for a city that is not in the
    /// viewport yet ("Searching nearby..."), so poll instead of sleeping once.
    private func waitForRows(prefix: String, timeout: TimeInterval) -> [XCUIElement] {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let rows = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label BEGINSWITH %@", prefix))
                .allElementsBoundByIndex
            if !rows.isEmpty { return rows }
            sleep(2)
        } while Date() < deadline
        return []
    }

    /// Recentre on the simulated location, then zoom to z18+ and capture the
    /// sharp-arrival sequence. Used for states that are not in view at launch.
    private func runLocateZoomScenario(prefix: String) {
        walkOnboardingIfNeeded()
        if element("Close").exists { tap("Close", wait: 3) }
        if element("Close place details").exists { tap("Close place details", wait: 3) }

        tap("Map layers and type")
        tapSuffix("Satellite")
        tap("Map layers and type")
        sleep(2)
        save("\(prefix)-00-satellite-on")

        if !tap("Locate me", wait: 10) { XCTFail("no locate button"); return }
        sleep(8)
        save("\(prefix)-01-located")

        // Keep the taps high on the map: a double-tap that lands on a POI marker
        // opens its card, which dims the imagery being measured.
        let spot = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.22))
        for _ in 1...4 {
            spot.doubleTap()
            sleep(1)
        }
        if element("Close place details").exists { tap("Close place details", wait: 3) }
        save("\(prefix)-02-z1s")
        sleep(2)
        save("\(prefix)-03-z3s")
        sleep(6)
        save("\(prefix)-04-z9s")
        dump("\(prefix)-final")

        // Which imagery sources does the app believe it is drawing? The sheet is
        // fed by the same viewport eligibility as the mounted layers, so it is
        // the observable proof that a state service is actually in the style.
        if element("Close place details").exists { tap("Close place details", wait: 3) }
        // The search sheet sits over the attribution pill; collapse it first or
        // the tap lands on a Recents row instead.
        tap("Sheet handle", wait: 3)
        sleep(2)
        if tap("Map imagery attribution", wait: 8) {
            sleep(1)
            dump("\(prefix)-05-attribution")
            save("\(prefix)-05-attribution")
        }
    }

    private func runSatelliteZoomScenario(query: String, rowPrefix: String, prefix: String) {
        walkOnboardingIfNeeded()
        if element("Close").exists { tap("Close", wait: 3) }

        tap("Map layers and type")
        tapSuffix("Satellite")
        tap("Map layers and type")
        sleep(2)
        save("\(prefix)-00-satellite-on")

        // The panel's search box is a TextField with only a placeholder.
        let field = app.textFields.firstMatch
        guard field.waitForExistence(timeout: 10) else {
            XCTFail("no search field")
            return
        }
        field.tap()
        sleep(1)
        field.typeText(query)
        sleep(5)
        let searchKey = app.keyboards.buttons["search"]
        if searchKey.exists { searchKey.tap() } else { field.typeText("\n") }
        let rows = waitForRows(prefix: rowPrefix, timeout: 45)
        dump("\(prefix)-02-results")
        print("ROWS \(rows.count): \(rows.map(\.label))")
        guard let row = rows.last else {
            XCTFail("no \(rowPrefix) result row")
            return
        }
        let rowFrame = row.frame
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: rowFrame.midX, dy: rowFrame.midY))
            .tap()
        sleep(6)
        if tap("Close place details", wait: 10) { sleep(2) }
        save("\(prefix)-01-after-search")

        // Zoom with double-taps (MapLibre's default zoom-in gesture) at a point
        // clear of the search panel, the controls and the bottom cards. Each
        // double-tap is one zoom level; z17+ is where the overzoomed z16 cache
        // used to be all that was on screen.
        let spot = app.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.4))
        for step in 1...5 {
            spot.doubleTap()
            sleep(1)
            if step >= 3 {
                save("\(prefix)-z\(step)-1s")
                sleep(2)
                save("\(prefix)-z\(step)-3s")
                sleep(6)
                save("\(prefix)-z\(step)-9s")
            }
        }
        dump("\(prefix)-final")
    }
}
