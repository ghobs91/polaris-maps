import MapKit
import SwiftUI

/// The region map: every region the catalog advertises, as a rectangle.
///
/// An `MKMapView` rather than SwiftUI's `Map` because this has to work on macOS 13
/// and needs click-to-select on overlays, which the representable gives directly.
/// Grey means "the catalog knows this region but nobody has published a signed
/// manifest for it" — that distinction is the whole point of showing it at all.
struct RegionMapView: NSViewRepresentable {
    let regions: [CatalogRegion]
    let selectedId: String?
    let onSelect: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onSelect: onSelect)
    }

    func makeNSView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.pointOfInterestFilter = .excludingAll
        map.showsCompass = false
        map.isZoomEnabled = true
        map.isScrollEnabled = true

        let click = NSClickGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleClick(_:))
        )
        map.addGestureRecognizer(click)
        context.coordinator.mapView = map
        return map
    }

    func updateNSView(_ map: MKMapView, context: Context) {
        context.coordinator.onSelect = onSelect
        context.coordinator.apply(regions: regions, selectedId: selectedId, to: map)
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var onSelect: (String) -> Void
        weak var mapView: MKMapView?

        /// Signature of what is currently drawn, so a re-render does not rebuild
        /// every overlay (which would fight the user's panning).
        private var drawnSignature = ""
        private var overlaysById: [String: RegionOverlay] = [:]

        init(onSelect: @escaping (String) -> Void) {
            self.onSelect = onSelect
        }

        func apply(regions: [CatalogRegion], selectedId: String?, to map: MKMapView) {
            let withBounds = regions.filter { $0.bounds != nil }
            let signature = withBounds
                .map { "\($0.regionId):\($0.pinnable ? 1 : 0):\($0.pinned ? 1 : 0)" }
                .joined(separator: ",") + "|\(selectedId ?? "")"

            guard signature != drawnSignature else { return }
            let firstDraw = drawnSignature.isEmpty
            drawnSignature = signature

            map.removeOverlays(map.overlays)
            overlaysById.removeAll()

            for region in withBounds {
                guard let bounds = region.bounds else { continue }
                var coordinates = [
                    CLLocationCoordinate2D(latitude: bounds.minLat, longitude: bounds.minLng),
                    CLLocationCoordinate2D(latitude: bounds.maxLat, longitude: bounds.minLng),
                    CLLocationCoordinate2D(latitude: bounds.maxLat, longitude: bounds.maxLng),
                    CLLocationCoordinate2D(latitude: bounds.minLat, longitude: bounds.maxLng),
                ]
                let overlay = RegionOverlay(
                    coordinates: &coordinates,
                    count: coordinates.count
                )
                overlay.regionId = region.regionId
                overlay.pinnable = region.pinnable
                overlay.isSelected = region.regionId == selectedId
                overlaysById[region.regionId] = overlay
                map.addOverlay(overlay)
            }

            if firstDraw {
                let rect = map.overlays
                    .compactMap { $0 as? RegionOverlay }
                    .reduce(MKMapRect.null) { partial, overlay in
                        partial.union(overlay.boundingMapRect)
                    }
                if !rect.isNull {
                    map.setVisibleMapRect(
                        rect,
                        edgePadding: NSEdgeInsets(top: 24, left: 24, bottom: 24, right: 24),
                        animated: false
                    )
                }
            }
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let region = overlay as? RegionOverlay else {
                return MKOverlayRenderer(overlay: overlay)
            }
            let renderer = MKPolygonRenderer(polygon: region)
            let pinned = region.isSelected
            renderer.lineWidth = pinned ? 2.5 : 1.0
            if region.pinnable {
                renderer.fillColor = NSColor.systemTeal.withAlphaComponent(pinned ? 0.32 : 0.14)
                renderer.strokeColor = NSColor.systemTeal.withAlphaComponent(pinned ? 1 : 0.7)
            } else {
                renderer.fillColor = NSColor.secondaryLabelColor.withAlphaComponent(0.08)
                renderer.strokeColor = NSColor.secondaryLabelColor.withAlphaComponent(0.35)
            }
            return renderer
        }

        /// Click selects the smallest region containing the point, so overlapping
        /// metro/national rectangles do not make the big one win.
        @objc func handleClick(_ recognizer: NSClickGestureRecognizer) {
            guard let map = mapView else { return }
            let point = recognizer.location(in: map)
            let coordinate = map.convert(point, toCoordinateFrom: map)

            let candidates = overlaysById.values.filter { overlay in
                overlay.boundingMapRect.contains(MKMapPoint(coordinate))
            }
            guard
                let smallest = candidates.min(by: {
                    $0.boundingMapRect.size.width * $0.boundingMapRect.size.height
                        < $1.boundingMapRect.size.width * $1.boundingMapRect.size.height
                })
            else { return }

            onSelect(smallest.regionId)
        }
    }
}

/// `MKPolygon` cannot carry extra state, so it does here.
final class RegionOverlay: MKPolygon {
    var regionId = ""
    var pinnable = false
    var isSelected = false
}
