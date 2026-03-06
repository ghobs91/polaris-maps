import { schnorr } from '@noble/curves/secp256k1';
import * as SecureStore from 'expo-secure-store';

const PRIVATE_KEY_STORAGE_KEY = 'polaris_nostr_privkey';
const PUBLIC_KEY_STORAGE_KEY = 'polaris_nostr_pubkey';

export async function getOrCreateKeypair(): Promise<{
  privateKey: Uint8Array;
  publicKey: string;
}> {
  const existingPrivHex = await SecureStore.getItemAsync(PRIVATE_KEY_STORAGE_KEY);

  if (existingPrivHex) {
    const privateKey = hexToBytes(existingPrivHex);
    const publicKey = bytesToHex(schnorr.getPublicKey(privateKey));
    return { privateKey, publicKey };
  }

  const privateKey = schnorr.utils.randomPrivateKey();
  const publicKey = bytesToHex(schnorr.getPublicKey(privateKey));

  await SecureStore.setItemAsync(PRIVATE_KEY_STORAGE_KEY, bytesToHex(privateKey));
  await SecureStore.setItemAsync(PUBLIC_KEY_STORAGE_KEY, publicKey);

  return { privateKey, publicKey };
}

export async function getPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(PUBLIC_KEY_STORAGE_KEY);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
