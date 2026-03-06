import React, { useRef, useCallback } from 'react';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { StyleSheet, View } from 'react-native';
import { useMapStore } from '../../stores/mapStore';
import { getTileServerBaseUrl } from '../../native/tileServer';

interface MapViewProps {
  routeGeometry?: string;
  onMapPress?: (lat: number, lng: number) => void;
}

export function MapView({ routeGeometry, onMapPress }: MapViewProps) {
  const mapRef = useRef<any>(null);
  const { viewport, setViewport, tileServerPort } = useMapStore();

  const styleUrl = tileServerPort ? `${getTileServerBaseUrl()}/style.json` : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePress = useCallback(
    (event: any) => {
      const [lng, lat] = event.geometry.coordinates as [number, number];
      onMapPress?.(lat, lng);
    },
    [onMapPress],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleRegionDidChange = useCallback(
    (event: any) => {
      const [lng, lat] = event.geometry.coordinates as [number, number];
      setViewport({
        lat,
        lng,
        zoom: event.properties.zoomLevel,
        bearing: event.properties.heading,
        pitch: event.properties.pitch,
      });
    },
    [setViewport],
  );

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={styleUrl}
        onPress={handlePress}
        onRegionDidChange={handleRegionDidChange}
      >
        <MapLibreGL.Camera
          zoomLevel={viewport.zoom}
          centerCoordinate={[viewport.lng, viewport.lat]}
          heading={viewport.bearing}
          pitch={viewport.pitch}
        />

        <MapLibreGL.UserLocation visible />

        {routeGeometry && (
          <MapLibreGL.ShapeSource
            id="route"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: decodePolyline(routeGeometry),
              },
            }}
          >
            <MapLibreGL.LineLayer
              id="routeLine"
              style={{
                lineColor: '#4A90D9',
                lineWidth: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>
        )}
      </MapLibreGL.MapView>
    </View>
  );
}

// Decode polyline with precision 6 (Valhalla default)
function decodePolyline(encoded: string, precision: number = 6): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / factor, lat / factor]);
  }

  return coords;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
