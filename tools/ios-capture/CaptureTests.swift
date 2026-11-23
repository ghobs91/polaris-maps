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
}
