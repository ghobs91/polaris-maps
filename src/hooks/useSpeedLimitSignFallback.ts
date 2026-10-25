import { useEffect, useRef, useState } from 'react';
import { useNavigationTrackingStore } from '../stores/navigationTrackingStore';
import { countryCodeForPosition } from '../services/speedLimits/countryForPosition';
import {
  SpeedLimitSignCache,
  fetchSpeedLimitSigns,
  isMapillarySpeedSignsConfigured,
  speedUnitForCountry,
  type SpeedUnit,
} from '../services/speedLimits/mapillarySpeedSigns';

/**
 * Posted limit from Mapillary sign detections near the car.
 *
 * This is the fallback for roads the routing engine has no `maxspeed` for — the
 * normal case across most of the US. It stays silent unless it can be certain:
 *
 * - no `EXPO_PUBLIC_MAPILLARY_TOKEN` → off (it is opt-in, like street-level
 *   imagery);
 * - no downloaded region containing the car → no country → no unit, so no sign;
 * - no detection within 25 m → null.
 *
 * The country is resolved once per trip. Starting a trip outside every
 * downloaded extract therefore leaves this off until the next trip, which is the
 * conservative side of the same rule.
 */
export function useSpeedLimitSignFallback(enabled: boolean): number | null {
  const [limitMph, setLimitMph] = useState<number | null>(null);
  const navPosition = useNavigationTrackingStore((s) => s.navPosition);
  const cacheRef = useRef<SpeedLimitSignCache | null>(null);
  const unitRef = useRef<SpeedUnit | null>(null);
  const resolvedCountryRef = useRef(false);

  // One cache per trip: detections are cheap to re-fetch and carrying them
  // across trips would need a licence-tracked store.
  useEffect(() => {
    if (!enabled || !isMapillarySpeedSignsConfigured()) {
      cacheRef.current = null;
      unitRef.current = null;
      resolvedCountryRef.current = false;
      setLimitMph(null);
      return;
    }

    cacheRef.current = new SpeedLimitSignCache({ fetchSigns: fetchSpeedLimitSigns });
    unitRef.current = null;
    resolvedCountryRef.current = false;
    setLimitMph(null);

    return () => {
      cacheRef.current?.reset();
      cacheRef.current = null;
      unitRef.current = null;
      resolvedCountryRef.current = false;
    };
  }, [enabled]);

  useEffect(() => {
    const cache = cacheRef.current;
    if (!enabled || !cache || !navPosition) return;

    const [lng, lat] = navPosition;
    let cancelled = false;

    const run = async () => {
      if (!unitRef.current) {
        if (resolvedCountryRef.current) return;
        const country = await countryCodeForPosition(lat, lng);
        if (cancelled) return;
        resolvedCountryRef.current = true;
        if (!country) return;
        unitRef.current = speedUnitForCountry(country);
      }

      const activeUnit = unitRef.current;
      if (!activeUnit) return;

      // Read what the cache already has, then top it up. The cache throttles by
      // distance, so calling this on every fix is free.
      setLimitMph(cache.limitMphAt(lng, lat));
      await cache.refresh(lng, lat, activeUnit);
      if (cancelled) return;
      // The refresh may have just produced the first nearby sign; publish it
      // without waiting for the next GPS fix.
      setLimitMph(cache.limitMphAt(lng, lat));
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [enabled, navPosition]);

  return limitMph;
}
