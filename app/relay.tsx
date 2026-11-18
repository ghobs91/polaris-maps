import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  Share,
} from 'react-native';
import { Stack } from 'expo-router';

import { Button, SettingsGroup, SettingsRow } from '../src/components/common';
import { useTheme } from '../src/contexts/ThemeContext';
import { spacing, typography } from '../src/constants/theme';
import { useRelayDashboard } from '../src/hooks/useRelayDashboard';
import { useMapStore } from '../src/stores/mapStore';
import { getRegionContainingPoint } from '../src/services/regions/regionRepository';
import { getRegionManifest } from '../src/services/regions/regionManifestResolver';

/**
 * Desktop relay, from the phone.
 *
 * This is a *remote control*, not the relay's own UI: the Mac app is the primary
 * surface, and this exists so the relay can be checked and steered from anywhere.
 * Two things follow from that and shape the screen:
 *
 *   1. **Everything is seconds old.** Commands travel over gossip and the answer
 *      comes back as a signed ack, so a tap is not instantaneous and the screen says
 *      so instead of pretending. The age of the record is always visible.
 *   2. **It may be unreachable for reasons that are not the relay's fault.** The
 *      control channel needs a Gun relay; when there is none the screen explains
 *      that the Mac may still be seeding fine, rather than claiming it is down.
 */

const GIB = 1024 ** 3;
const GB = 1_000_000_000;

function gib(bytes: number): string {
  const value = Number(bytes) || 0;
  if (value < GIB) return `${Math.round(value / (1024 * 1024))} MB`;
  return `${(value / GIB).toFixed(1)} GiB`;
}

function gb(bytes: number): string {
  return `${((Number(bytes) || 0) / GB).toFixed(1)} GB`;
}

function ageLabel(updatedAt: number | undefined): string {
  if (!updatedAt) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

/** A label/value pair rendered as a bar, for budgets. */
function UsageBar({
  label,
  detail,
  fraction,
  color,
}: {
  label: string;
  detail: string;
  fraction: number;
  color: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontSize: 15 }}>{label}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{detail}</Text>
      </View>
      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.textSecondary + '22',
          marginTop: 6,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.max(2, Math.min(100, fraction * 100))}%`,
            height: 4,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

export default function RelayScreen() {
  const { colors } = useTheme();
  const { selected, status, pending, outcome, devicePubkey, authorized, run, relays, refresh } =
    useRelayDashboard();
  const viewport = useMapStore((s) => s.viewport);
  const [pinningHere, setPinningHere] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { padding: spacing.md, paddingBottom: spacing.xxl },
        body: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
        mono: { color: colors.text, fontSize: 11, lineHeight: 16, fontFamily: 'Menlo' },
        notice: {
          borderRadius: 12,
          padding: spacing.md,
          marginBottom: spacing.md,
          backgroundColor: colors.textSecondary + '14',
        },
        warning: { backgroundColor: '#C08A2E22' },
        error: { backgroundColor: '#C0392B22' },
        action: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
        row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
      }),
    [colors],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    refresh();
    setRefreshing(false);
  }, [refresh]);

  /**
   * Pin the pack for wherever the map is looking — the agreed default rule, wired to
   * the one component on the phone that knows where you are.
   */
  const pinCurrentRegion = useCallback(async () => {
    setPinningHere(true);
    try {
      const region = await getRegionContainingPoint(viewport.lat, viewport.lng);
      if (!region) {
        Alert.alert('No region here', 'The map position is not inside a region with a pack.');
        return;
      }
      const manifest = getRegionManifest(region.id);
      if (!manifest?.driveKey) {
        Alert.alert(
          'No canonical key',
          `“${region.name}” has no signed manifest yet, so a relay cannot seed it. ` +
            'Pin it from the Mac app once one is published.',
        );
        return;
      }
      await run('pin', {
        regionId: region.id,
        driveKey: manifest.driveKey,
        version: manifest.version,
        bytes: manifest.bytes,
      });
    } finally {
      setPinningHere(false);
    }
  }, [run, viewport.lat, viewport.lng]);

  const confirmUnpin = useCallback(
    (regionId: string) => {
      Alert.alert('Stop seeding this region?', regionId, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop seeding',
          style: 'destructive',
          onPress: () => void run('unpin', { regionId }),
        },
      ]);
    },
    [run],
  );

  const shareDeviceKey = useCallback(() => {
    if (!devicePubkey) return;
    void Share.share({
      message: `polaris-relay authorize ${devicePubkey} --label "iPhone"`,
    });
  }, [devicePubkey]);

  const busy = pending != null;
  const paused = selected?.paused ?? false;

  return (
    <>
      <Stack.Screen options={{ title: 'Desktop relay' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {selected ? (
          <SettingsGroup
            header="Relay"
            footer={
              `Status from ${ageLabel(selected.updatedAt)}` +
              (status ? ` · up ${Math.round(status.uptimeSec / 60)} min` : '')
            }
          >
            <SettingsRow
              title={paused ? 'Paused' : 'Seeding'}
              value={paused ? (selected.pausedReason ?? 'paused') : 'yes'}
            />
            <SettingsRow
              title="Power"
              value={
                status ? `${status.power}${status.lowPowerMode ? ' · low power' : ''}` : 'unknown'
              }
            />
            <SettingsRow
              title="Served today"
              value={status ? gib(status.usage.servedBytes24h) : '—'}
            />
            <View style={styles.action}>
              <Button
                title={paused ? 'Resume seeding' : 'Pause seeding'}
                variant={paused ? 'primary' : 'outline'}
                disabled={busy}
                onPress={() => void run(paused ? 'resume' : 'pause')}
              />
            </View>
          </SettingsGroup>
        ) : (
          <View style={styles.notice}>
            <Text style={[typography.h3, { color: colors.text }]}>No relay heard yet</Text>
            <Text style={[styles.body, { marginTop: spacing.sm }]}>
              The Mac keeps seeding whether or not this screen can reach it — controls travel over
              the Gun relay, so if that is unreachable the relay is invisible here.
            </Text>
            <Text style={[styles.body, { marginTop: spacing.sm }]}>
              Check the Mac: the antenna icon says whether it is serving. If it has never been
              installed, run{'\n'}
              <Text style={styles.mono}>relay/launchd/install.sh</Text>
            </Text>
            <View style={styles.action}>
              <Button title="Try again" variant="secondary" onPress={onRefresh} />
            </View>
          </View>
        )}

        {relays.length > 1 ? (
          <SettingsGroup header="Relays" footer="More than one Desktop relay is announcing.">
            {relays.map((relay) => (
              <SettingsRow
                key={relay.relayPubkey}
                title={relay.relayPubkey.slice(0, 12)}
                value={relay.paused ? 'paused' : `${relay.regions.length} region(s)`}
              />
            ))}
          </SettingsGroup>
        ) : null}

        {selected && !authorized ? (
          <View style={[styles.notice, styles.warning]}>
            <Text style={[typography.h3, { color: colors.text }]}>
              This phone cannot control the relay
            </Text>
            <Text style={[styles.body, { marginTop: spacing.sm }]}>
              Controls are signed and the Mac only obeys devices you authorize. Run this once on the
              Mac — or use the Mac app, which needs no authorization:
            </Text>
            <Text style={[styles.mono, { marginTop: spacing.sm }]}>
              polaris-relay authorize {devicePubkey ? `${devicePubkey.slice(0, 16)}…` : '<key>'}
            </Text>
            <View style={styles.action}>
              <Button
                title="Share authorize command"
                variant="secondary"
                onPress={shareDeviceKey}
              />
            </View>
          </View>
        ) : null}

        {outcome ? (
          <View style={[styles.notice, outcome.ok ? undefined : styles.warning]}>
            <Text style={[styles.body, { color: colors.text }]}>{outcome.message}</Text>
          </View>
        ) : null}

        {pending ? (
          <View style={[styles.notice, styles.row]}>
            <Text style={styles.body}>Sending “{pending.cmd.replace('-', ' ')}”…</Text>
            <ActivityIndicator />
          </View>
        ) : null}

        {status ? (
          <>
            <SettingsGroup
              header="Regions this Mac seeds"
              footer={
                status.drives.length === 0
                  ? 'Nothing pinned. Open the map catalog on the Mac to pick a region.'
                  : undefined
              }
            >
              {status.drives.map((drive) => (
                <SettingsRow
                  key={drive.regionId}
                  title={drive.regionId.replace(/-/g, ' ')}
                  value={`${drive.peers} peer${drive.peers === 1 ? '' : 's'} · ${gib(drive.bytes)}`}
                  onPress={() => confirmUnpin(drive.regionId)}
                />
              ))}
              <View style={styles.action}>
                <Button
                  title={pinningHere ? 'Pinning…' : 'Seed the region I am in'}
                  variant="secondary"
                  disabled={busy || pinningHere}
                  onPress={() => void pinCurrentRegion()}
                />
              </View>
            </SettingsGroup>

            <SettingsGroup header="Budgets">
              <UsageBar
                label="Pack store"
                detail={`${gib(status.budgets.usedBytes)} of ${gib(status.budgets.packStoreBytes)}`}
                fraction={
                  status.budgets.packStoreBytes > 0
                    ? status.budgets.usedBytes / status.budgets.packStoreBytes
                    : 0
                }
                color={colors.primary}
              />
              <UsageBar
                label="Uploaded this month"
                detail={`${gb(status.usage.usedBytes)} of ${
                  status.usage.capBytes > 0 ? gb(status.usage.capBytes) : 'unlimited'
                }`}
                fraction={
                  status.usage.capBytes > 0 ? status.usage.usedBytes / status.usage.capBytes : 0
                }
                color={colors.primary}
              />
              <SettingsRow
                title="Max peers"
                value={String(status.budgets.maxPeers)}
                onPress={() =>
                  void run('set-budget', { maxPeers: status.budgets.maxPeers === 32 ? 8 : 32 })
                }
              />
            </SettingsGroup>

            <SettingsGroup
              header="When it seeds"
              footer="Defaults protect the Mac. The Mac app can change these too."
            >
              <SettingsRow
                title="Seed on battery"
                rightAdornment={
                  <Switch
                    value={status.preferences.seedOnBattery}
                    disabled={busy}
                    onValueChange={(value) => void run('set-budget', { seedOnBattery: value })}
                  />
                }
              />
              <SettingsRow
                title="Seed on metered connection"
                rightAdornment={
                  <Switch
                    value={status.preferences.seedOnMetered}
                    disabled={busy}
                    onValueChange={(value) => void run('set-budget', { seedOnMetered: value })}
                  />
                }
              />
            </SettingsGroup>

            {status.configWarnings.length > 0 || status.errors.length > 0 ? (
              <SettingsGroup header="Problems reported by the Mac">
                {status.configWarnings.map((warning) => (
                  <SettingsRow key={warning} title={warning} />
                ))}
                {status.errors.map((error) => (
                  <SettingsRow key={error} title={error} />
                ))}
              </SettingsGroup>
            ) : null}
          </>
        ) : null}

        <SettingsGroup
          header="This phone"
          footer="Authorizing this key lets the phone change the relay. Revoke it on the Mac if you stop using this device."
        >
          <SettingsRow
            title="Device key"
            value={devicePubkey ? `${devicePubkey.slice(0, 10)}…` : 'unavailable'}
            onPress={shareDeviceKey}
          />
          <SettingsRow
            title="Relay authorization"
            value={authorized ? 'authorized' : selected ? 'not authorized' : 'unknown'}
          />
        </SettingsGroup>
      </ScrollView>
    </>
  );
}
