import React from 'react';
import { useLocalSearchParams, Redirect } from 'expo-router';

/**
 * Inbound canonical place link (`https://polarismaps.com/p/<id>`) — resolve to
 * the place detail screen.
 */
export default function PlaceLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/(tabs)" />;
  return <Redirect href={`/poi/${id}`} />;
}
