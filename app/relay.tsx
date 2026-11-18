import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View, Share } from 'react-native';
import { Stack } from 'expo-router';

import { Button, SettingsChoiceRow, SettingsGroup, SettingsRow } from '../src/components/common';
import { useTheme } from '../src/contexts/ThemeContext';
import { spacing, typography } from '../src/constants/theme';
import { useRelayDashboard } from '../src/hooks/useRelayDashboard';
import { useMapStore } from '../src/stores/mapStore';
import { getRegionContainingPoint } from '../src/services/regions/regionRepository';
import { getRegionManifest } from '../src/services/regions/regionManifestResolver';

/**
 * Desktop relay dashboard.
 *
 * Everything here is either (a) a signed status record the relay published, or
 * (b) a signed command whose outcome is the relay's signed ack. Nothing is
 * optimistic: a budget change or a pin shows as pending until the relay says it
 * happened, because the channel is gossip and seconds of latency are normal.
 *
 * Deliberately honest about the control model — the relay is a separate machine,
 * so when those numbers are stale the screen says so instead of pretending the
 * last values are live.
 */

const GIB = 1024 ** 3;
const GB = 1000 ** 3;

function gib(bytes: number): string {
  const value = Number(bytes) || 0;
  if (value < GIB) return `${Math.round(value / (1024 * 1024))} MB`;
  return `${(value / GIB).toFixed(1)} GiB`;
}

function gb(bytes: number): string {
  return `${((Number(bytes) || 0) / GB).toFixed(1)} GB`;
}

function age(updatedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

export default function RelayScreen() {
  const { colors } = useTheme();
  const dashboard = useRelayDashboard();
  const { selected, status, pending, outcome, devicePubkey, authorized, run, relays, select } =
    dashboard;
  const viewport = useMapStore((s) => s.viewport);
  const [pinningHere, setPinningHere] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        content: { padding: spacing.md, paddingBottom: spacing.xxl },
        body: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
        mono: {
          color: colors.text,
          fontSize: 11,
          lineHeight: 16,
          fontFamily: 'Menlo',
        },
        notice: {
          borderRadius: 12,
          padding: spacing.md,
          marginBottom: spacing.md,
          backgroundColor: colors.textSecondary + '14',
        },
        noticeWarning: { backgroundColor: '#C08A2E22' },
        noticeError: { backgroundColor: '#C0392B22' },
        action: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
        spacer: { height: spacing.md },
      }),
    [colors],
  );

  /**
   * Pin the pack for wherever the map is looking.
   *
   * This is the "default pin is the region you're in" behaviour, wired to the one
   * place that actually knows your location. The relay is told a canonical key
   * from a signed manifest — it never invents one.
   */
  const pinCurrentRegion = useCallback(async () => {
    setPinningHere(true);
    try {
      const region = await getRegionContainingPoint(viewport.lat, viewport.lng);
      if (!region) {
        Alert.alert(
          'No region here',
          'The map position is not inside a region with a downloadable pack, so there is nothing to pin.',
        );
        return;
      }
      const manifest = getRegionManifest(region.id);
      if (!manifest?.driveKey) {
        Alert.alert(
          'No canonical key',
          `“${region.name}” has no signed manifest with a canonical pack key yet, so a relay cannot seed it.`,
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

  const copyDeviceKey = useCallback(() => {
    if (!devicePubkey) return;
    void Share.share({ message: `polaris-relay authorize ${devicePubkey} --label "iPhone"` });
  }, [devicePubkey]);

  const busy = pending != null;

  return (
    <>
      <Stack.Screen options={{ title: 'Desktop relay' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {relays.length === 0 ? (
          <View style={styles.notice}>
            <Text style={[typography.h3, { color: colors.text }]}>No relay found</Text>
            <Text style={[styles.body, { marginTop: spacing.sm }]}>
              A relay is a Mac that seeds map packs for this phone, so this one can skip the data
              and battery. Install it on your Mac with{'\n'}
              <Text style={styles.mono}>relay/launchd/install.sh</Text>
              {'\n'}and it will appear here within a few seconds of starting.
            </Text>
            <Text style={[styles.body, { marginTop: spacing.sm }]}>
              Nothing is seeded on your behalf until you pin a region on the relay.
            </Text>
          </View>
        ) : null}

        {relays.length > 1 ? (
          <SettingsGroup header="Relay">
            <SettingsChoiceRow
              title="Controlling"
              options={relays.map((relay) => ({
                label: relay.relayPubkey.slice(0, 6),
                value: relay.relayPubkey,
              }))}
              value={selected?.relayPubkey ?? ''}
              onChange={select}
            />
          </SettingsGroup>
        ) : null}

        {selected ? (
          <SettingsGroup
            header="Relay"
            footer={`Announced ${age(selected.updatedAt)}${status ? ` · up ${Math.round(status.uptimeSec / 60)} min` : ''}`}
          >
            <SettingsRow
              title={selected.paused ? 'Paused' : 'Serving'}
              value={selected.paused ? (selected.pausedReason ?? 'paused') : 'yes'}
            />
            <SettingsRow
              title="Power"
              value={
                status
                  ? `${status.power}${status.lowPowerMode ? ' · low power mode' : ''}`
                  : 'unknown'
              }
            />
            <SettingsRow
              title="Served today"
              value={status ? gib(status.usage.servedBytes24h) : '—'}
            />
            <View style={styles.action}>
              <Button
                title={selected.paused ? 'Resume seeding' : 'Pause seeding'}
                variant={selected.paused ? 'primary' : 'outline'}
                disabled={busy}
                onPress={() => void run(selected.paused ? 'resume' : 'pause')}
              />
            </View>
          </SettingsGroup>
        ) : null}

        {selected && !authorized ? (
          <View style={[styles.notice, styles.noticeWarning]}>
            <Text style={[typography.h3, { color: colors.text }]}>
              This phone is not authorized
            </Text>
            <Text style={[styles.body, { marginTop: spacing.sm }]}>
              Controls are signed, and your Mac only obeys devices you have authorized. Run this
              once on the Mac:
            </Text>
            <Text style={[styles.mono, { marginTop: spacing.sm }]}>
              polaris-relay authorize{' '}
              {devicePubkey ? `${devicePubkey.slice(0, 16)}…` : '<your key>'}
            </Text>
            <View style={styles.action}>
              <Button title="Copy authorize command" variant="secondary" onPress={copyDeviceKey} />
            </View>
            <Text style={[styles.body, { marginTop: spacing.sm }]}>
              Your relay can still seed without this — authorization only lets the phone control it.
            </Text>
          </View>
        ) : null}

        {outcome ? (
          <View
            style={[
              styles.notice,
              outcome.ok ? null : status ? styles.noticeWarning : styles.noticeError,
            ]}
          >
            <Text style={[styles.body, { color: colors.text }]}>{outcome.message}</Text>
          </View>
        ) : null}

        {pending ? (
          <View style={styles.notice}>
            <Text style={styles.body}>Sending “{pending.cmd.replace('-', ' ')}” to the relay…</Text>
          </View>
        ) : null}

        {status ? (
          <>
            <SettingsGroup
              header="Regions seeded"
              footer={
                status.drives.length === 0
                  ? 'Nothing pinned yet. A relay only seeds what you pin.'
                  : `${status.drives.length} region(s) · ${gib(status.budgets.usedBytes)} of ${gib(
                      status.budgets.packStoreBytes,
                    )} used`
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
                  title={pinningHere ? 'Pinning…' : 'Seed this region here'}
                  variant="secondary"
                  disabled={busy || pinningHere}
                  onPress={() => void pinCurrentRegion()}
                />
              </View>
            </SettingsGroup>

            <SettingsGroup
              header="Budgets"
              footer={`This month: ${gb(status.usage.usedBytes)} of ${
                status.usage.capBytes > 0 ? gb(status.usage.capBytes) : 'unlimited'
              } served`}
            >
              <SettingsRow
                title="Pack store limit"
                value={gib(status.budgets.packStoreBytes)}
                onPress={() =>
                  Alert.alert(
                    'Pack store limit',
                    'The relay evicts the least-requested regions to stay inside this. Pinned regions are never evicted.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: '10 GiB',
                        onPress: () => void run('set-budget', { packStoreGb: 10 }),
                      },
                      {
                        text: '25 GiB',
                        onPress: () => void run('set-budget', { packStoreGb: 25 }),
                      },
                      {
                        text: '100 GiB',
                        onPress: () => void run('set-budget', { packStoreGb: 100 }),
                      },
                    ],
                  )
                }
              />
              <SettingsRow
                title="Monthly upload cap"
                value={status.usage.capBytes > 0 ? gb(status.usage.capBytes) : 'unlimited'}
                onPress={() =>
                  Alert.alert(
                    'Monthly upload cap',
                    'The relay stops serving when it reaches this, until the next month.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: '50 GB',
                        onPress: () => void run('set-budget', { egressGb: 50 }),
                      },
                      {
                        text: '250 GB',
                        onPress: () => void run('set-budget', { egressGb: 250 }),
                      },
                      {
                        text: '500 GB',
                        onPress: () => void run('set-budget', { egressGb: 500 }),
                      },
                    ],
                  )
                }
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
              footer="Defaults protect the Mac: no seeding on battery, on a metered connection, or in Low Power Mode."
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
              <SettingsRow
                title="Drop idle regions now"
                value="no peer for 30 days"
                onPress={() => void run('evict-idle')}
              />
            </SettingsGroup>

            {status.errors.length > 0 || status.configWarnings.length > 0 ? (
              <SettingsGroup header="Diagnostics">
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

        <SettingsGroup header="This device">
          <SettingsRow
            title="Device key"
            value={devicePubkey ? `${devicePubkey.slice(0, 10)}…` : 'unavailable'}
            onPress={copyDeviceKey}
          />
          <SettingsRow
            title="Relay authorization"
            value={authorized ? 'authorized' : 'not authorized'}
          />
        </SettingsGroup>

        <Text style={[styles.body, { marginTop: spacing.md }]}>
          The relay is a separate machine. It keeps seeding while Polaris Maps is closed, and stops
          when you quit the relay app on the Mac.
        </Text>
      </ScrollView>
    </>
  );
}
