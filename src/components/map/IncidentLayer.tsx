import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTrafficStore } from '../../stores/trafficStore';
import { INCIDENT_TYPE_ICONS, INCIDENT_TYPE_LABELS } from '../../services/traffic/incidentWire';
import type { IncidentType } from '../../models/traffic';

/** Center the badge on the incident coordinate. */
const ANCHOR = { x: 0.5, y: 0.5 } as const;

const TYPE_COLORS: Record<IncidentType, string> = {
  accident: '#FF3B30',
  road_closure: '#FF9500',
  hazard: '#FFCC00',
  construction: '#FF9500',
  police: '#0A84FF',
  other: '#8E8E93',
};

interface IncidentBadgeProps {
  type: IncidentType;
}

const IncidentBadge = memo(function IncidentBadge({ type }: IncidentBadgeProps) {
  return (
    <View
      style={[styles.badge, { backgroundColor: TYPE_COLORS[type] }]}
      accessibilityLabel={INCIDENT_TYPE_LABELS[type]}
      accessibilityRole="image"
    >
      <Ionicons name={INCIDENT_TYPE_ICONS[type] as never} size={13} color="#FFFFFF" />
    </View>
  );
});

/** Renders accepted, unexpired crowd-reported incidents on the map. */
export function IncidentLayer() {
  const incidents = useTrafficStore((s) => s.incidents);

  if (incidents.length === 0) return null;

  return (
    <>
      {incidents.map((incident) => (
        <MapLibreGL.MarkerView
          key={incident.id}
          coordinate={[incident.lng, incident.lat]}
          anchor={ANCHOR}
          allowOverlap
        >
          <IncidentBadge type={incident.type} />
        </MapLibreGL.MarkerView>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});
