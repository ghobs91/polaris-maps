import React, { useEffect } from 'react';
import { useLocalSearchParams, Redirect } from 'expo-router';
import { useMapStore } from '../../src/stores/mapStore';

/**
 * Inbound coordinate place link (`https://polarismaps.com/p?lat=..&lng=..`) —
 * center the map on the place and fall through to the map tab.
 */
export default function PlaceCoordsLinkScreen() {
  const { lat, lng, name } = useLocalSearchParams<{ lat?: string; lng?: string; name?: string }>();

  useEffect(() => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      useMapStore
        .getState()
        .setSelectedLocation({ lat: latitude, lng: longitude, name: name ?? undefined });
      useMapStore.getState().setViewport({ lat: latitude, lng: longitude, zoom: 16 });
    }
  }, [lat, lng, name]);

  return <Redirect href="/(tabs)" />;
}
