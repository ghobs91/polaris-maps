import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Button, SettingsGroup, SettingsRow } from '../common';
import { getDownloadedRegions } from '../../services/regions/regionRepository';
import { useRegionDownloadStore } from '../../stores/regionDownloadStore';
import { spacing } from '../../constants/theme';
import type { Region } from '../../models/region';

interface OfflineMapsSectionProps {
  /** Opens the regions manager in-place (floating panel); falls back to the route. */
  onOpenRegions?: () => void;
  /** Section header icon, supplied by the parent so header styling stays shared. */
  icon?: ReactNode;
}

/**
 * Total bytes a region occupies on disk.
 *
 * Packs carry their size in `assets`; older tile-only regions only populate the
 * legacy per-part columns, so both shapes have to be read.
 */
function regionBytes(region: Region): number {
  const assetBytes = (region.assets ?? []).reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
  if (assetBytes > 0) return assetBytes;
  return (
    (region.tilesSizeBytes ?? 0) +
    (region.routingSizeBytes ?? 0) +
    (region.geocodingSizeBytes ?? 0) +
    (region.placesSizeBytes ?? 0)
  );
}

/** Human-readable size, matching how pack cards show theirs. */
function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb === 0) return '—';
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/**
 * Settings → Offline maps.
 *
 * Shows what is already stored offline and offers the jump to the catalogue,
 * instead of the previous single "Manage Regions" row that hid the downloaded
 * list one screen away.
 */
export function OfflineMapsSection({ onOpenRegions, icon }: OfflineMapsSectionProps) {
  const router = useRouter();
  const [regions, setRegions] = useState<Region[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Reload when a background download starts or finishes, so the list does not
  // show a stale set of maps while the user is looking at it.
  const activeDownloadCount = useRegionDownloadStore((s) => s.activeIds.length);

  const load = useCallback(() => {
    getDownloadedRegions()
      .then((data) => {
        setRegions(data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load, activeDownloadCount]);

  // Coming back from the regions screen must show maps downloaded there.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openRegions = useCallback(() => {
    if (onOpenRegions) {
      onOpenRegions();
      return;
    }
    router.push('/regions');
  }, [onOpenRegions, router]);

  const totalBytes = regions.reduce((sum, region) => sum + regionBytes(region), 0);

  return (
    <SettingsGroup
      header="Offline maps"
      icon={icon}
      footer={
        regions.length > 0
          ? `${regions.length} ${regions.length === 1 ? 'map' : 'maps'} stored · ${formatMb(totalBytes)}`
          : 'Download a region to use maps, routing and search without a connection.'
      }
    >
      {regions.length > 0 ? (
        regions.map((region) => (
          <SettingsRow
            key={region.id}
            title={region.name}
            value={formatMb(regionBytes(region))}
            onPress={openRegions}
          />
        ))
      ) : (
        <SettingsRow title={loaded ? 'No maps downloaded' : 'Loading…'} />
      )}
      <View style={styles.action}>
        <Button title="Download More Maps" variant="primary" onPress={openRegions} />
      </View>
    </SettingsGroup>
  );
}

const styles = StyleSheet.create({
  action: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
