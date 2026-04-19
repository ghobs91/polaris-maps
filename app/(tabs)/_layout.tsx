import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { getDownloadedRegions } from '@/services/regions/regionRepository';
import { RegionGate } from '@/components/regions';

type GateState = 'checking' | 'needed' | 'clear';

export default function TabLayout() {
  const [gate, setGate] = useState<GateState>('checking');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fast path: if any region has been downloaded, skip the gate entirely.
        // This avoids a slow GPS lookup on every app resume and prevents the
        // gate from flashing when returning from background.
        const downloaded = await getDownloadedRegions();
        if (downloaded.length > 0) {
          if (!cancelled) setGate('clear');
          return;
        }

        // No downloaded regions — fall through to the GPS-based check to
        // suggest a region for the user to download.
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) setGate('clear');
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const { latitude: lat, longitude: lng } = loc.coords;
        setUserCoords({ lat, lng });
        setGate('needed');
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
          checking={gate === 'checking'}
          userLat={userCoords?.lat}
          userLng={userCoords?.lng}
          onDismiss={() => setGate('clear')}
        />
      )}
    </>
  );
}
