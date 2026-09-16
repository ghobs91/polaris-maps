import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getRouteCoords } from '../../services/navigation/trackingService';
import { findIncidentsAhead } from '../../services/traffic/incidentAhead';
import { INCIDENT_TYPE_ICONS, INCIDENT_TYPE_LABELS } from '../../services/traffic/incidentWire';
import { useNavigationTrackingStore } from '../../stores/navigationTrackingStore';
import { useTrafficStore } from '../../stores/trafficStore';
import type { TrafficIncident } from '../../models/traffic';

const CHECK_INTERVAL_MS = 10_000;
const VISIBLE_DURATION_MS = 6_000;

/**
 * Non-blocking banner that warns about the nearest crowd-reported incident
 * ahead on the active route. Each incident is announced at most once per
 * navigation session (component lifetime).
 */
export function IncidentAheadBanner() {
  const [warning, setWarning] = useState<TrafficIncident | null>(null);
  const warnedIdsRef = useRef<Set<string>>(new Set());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const check = () => {
      const position = useNavigationTrackingStore.getState().navPosition;
      if (!position) return;

      const ahead = findIncidentsAhead(
        getRouteCoords(),
        position,
        useTrafficStore.getState().incidents,
      );
      const next = ahead.find((incident) => !warnedIdsRef.current.has(incident.id));
      if (!next) return;

      warnedIdsRef.current.add(next.id);
      setWarning(next);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setWarning(null), VISIBLE_DURATION_MS);
    };

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!warning) return null;

  const label = INCIDENT_TYPE_LABELS[warning.type];

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLabel={`${label} ahead`}>
      <Ionicons name={INCIDENT_TYPE_ICONS[warning.type] as never} size={16} color="#FFFFFF" />
      <Text style={styles.text}>{label} ahead</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,59,48,0.92)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
