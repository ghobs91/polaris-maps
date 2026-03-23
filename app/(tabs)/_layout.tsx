import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { getRegionContainingPoint } from '@/services/regions/regionRepository';
import { RegionGate } from '@/components/regions';

type GateState = 'checking' | 'needed' | 'clear';

export default function TabLayout() {
  const [gate, setGate] = useState<GateState>('checking');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          // No location permission — we can't determine which region to suggest,
          // so let the user through without blocking.
          setGate('clear');
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { latitude: lat, longitude: lng } = loc.coords;
        setUserCoords({ lat, lng });
        const region = await getRegionContainingPoint(lat, lng);
        if (region?.downloadStatus === 'complete') {
          setGate('clear');
        } else {
          setGate('needed');
        }
      } catch {
        // Fail open — don't block the user if the check itself errors.
        setGate('clear');
      }
    })();
  }, []);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.hidden,
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Map' }} />
        <Tabs.Screen name="search" options={{ title: 'Search' }} />
        <Tabs.Screen name="navigation" options={{ title: 'Navigate' }} />
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

const styles = StyleSheet.create({
  hidden: { display: 'none' },
});
