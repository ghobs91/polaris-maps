import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { Button } from '../common';
import { spacing, typography } from '../../constants/theme';
import { parsePairingPayload, type PairingCode } from '../../services/relay/protocol';
import { pairRelayDevice } from '../../services/relay/relayClient';
import { addPairedRelay } from '../../services/relay/pairedRelays';
import { describeRefusal } from '../../services/relay/protocol';

/**
 * Scan the pairing QR code the Mac shows.
 *
 * The code carries the relay's key plus a short-lived single-use secret, so this
 * screen is the entire authorization step: nothing is authorized until somebody
 * points a camera at the Mac's window. Scanning something else is ignored rather
 * than reported as an error — a camera pointed at a room sees a lot of QR codes.
 */
export function ScanPairingCode({
  visible,
  onClose,
  onPaired,
}: {
  visible: boolean;
  onClose: () => void;
  onPaired: (relayPubkey: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [code, setCode] = useState<PairingCode | null>(null);

  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
    camera: { flex: 1 },
    overlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: spacing.lg,
      backgroundColor: 'rgba(0,0,0,0.72)',
      gap: spacing.sm,
    },
    title: { ...typography.h3, color: '#fff' },
    body: { color: '#C9CDD6', fontSize: 13, lineHeight: 19 },
    frame: {
      position: 'absolute',
      alignSelf: 'center',
      top: '26%',
      width: 240,
      height: 240,
      borderWidth: 2,
      borderColor: '#FFFFFFAA',
      borderRadius: 16,
    },
    close: { alignSelf: 'flex-start' },
  });

  const redeem = useCallback(
    async (pairing: PairingCode) => {
      setBusy(true);
      setStatus('Pairing with the Mac…');
      try {
        const { ack } = await pairRelayDevice(pairing);
        if (!ack) {
          setStatus(
            'The Mac did not answer. The code is still valid for two minutes — try scanning again.',
          );
          setBusy(false);
          setCode(null);
          return;
        }
        if (!ack.ok) {
          setStatus(describeRefusal(ack.error));
          setBusy(false);
          setCode(null);
          return;
        }
        // Trust this relay's signed manifests from now on: it publishes the
        // canonical keys for the packs it seeds, and that is what lets the phone
        // download from it peer-to-peer instead of the pack CDN.
        addPairedRelay(pairing.relayPubkey);
        setStatus('Linked. This phone can now control the relay and trust its pack manifests.');
        onPaired(pairing.relayPubkey);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
        setBusy(false);
        setCode(null);
      }
    },
    [onPaired],
  );

  const onScanned = useCallback(
    (result: { data?: string }) => {
      if (busy || !result.data) return;
      const pairing = parsePairingPayload(result.data);
      if (!pairing) return; // not our code; keep scanning
      setCode(pairing);
      void redeem(pairing);
    },
    [busy, redeem],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      <View style={styles.backdrop}>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={code ? undefined : onScanned}
          />
        ) : (
          <View style={[styles.overlay, { position: 'relative' }]}>
            <Text style={styles.title}>Camera access needed</Text>
            <Text style={styles.body}>
              Scanning the code on your Mac is how this phone is authorized to control the relay.
            </Text>
            <Button title="Allow camera" onPress={() => void requestPermission()} />
          </View>
        )}

        {permission?.granted ? <View style={styles.frame} pointerEvents="none" /> : null}

        <View style={styles.overlay}>
          <Text style={styles.title}>Point at the QR code on your Mac</Text>
          <Text style={styles.body}>
            On the Mac: Polaris Relay → Link a phone. The code works once, for two minutes.
          </Text>
          {status ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {busy ? <ActivityIndicator color="#fff" /> : null}
              <Text style={styles.body}>{status}</Text>
            </View>
          ) : null}
          <View style={styles.close}>
            <Button title="Close" variant="outline" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
