import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { getDownloadedRegions } from '@/services/regions/regionRepository';
import { RegionGate } from '@/components/regions';

type GateState = 'needed' | 'clear';

export default function TabLayout() {
  const [gate, setGate] = useState<GateState>('clear');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fast path: if any region has been downloaded, skip the gate entirely.
        // This avoids a slow GPS lookup on every app resume and prevents the
        // gate from flashing when returning from background.
        const downloaded = await Promise.race([
          getDownloadedRegions(),
          new Promise<[]>((resolve) => setTimeout(() => resolve([]), 2000)),
        ]);
        if (downloaded.length > 0) {
          if (!cancelled) setGate('clear');
          return;
        }

        // No downloaded regions. Show the gate immediately, then try to enrich
        // it with a suggested nearby region when location arrives.
        if (!cancelled) setGate('needed');

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          return;
        }

        const loc = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (!loc) return;

        if (cancelled) return;
        const { latitude: lat, longitude: lng } = loc.coords;
        setUserCoords({ lat, lng });
      } catch {
        // Fail open — don't block the user if the check itself errors.
        if (!cancelled) setGate('clear');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Tabs
        tabBar={() => null}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Map' }} />
        <Tabs.Screen name="search" options={{ title: 'Search' }} />
        <Tabs.Screen name="navigation" options={{ title: 'Navigate' }} />
        <Tabs.Screen name="places" options={{ title: 'My Places' }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      </Tabs>

      {gate !== 'clear' && (
        <RegionGate
          checking={false}
          userLat={userCoords?.lat}
          userLng={userCoords?.lng}
          onDismiss={() => setGate('clear')}
        />
      )}
    </>
  );
}
