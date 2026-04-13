import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

let _storage: MMKV | null = null;

/**
 * Returns an encrypted MMKV instance. On first launch, generates a random
 * encryption key and stores it in the device keychain via SecureStore.
 */
export async function getStorage(): Promise<MMKV> {
  if (_storage) return _storage;
  let encKey = await SecureStore.getItemAsync('mmkv_enc_key');
  if (!encKey) {
    encKey = Crypto.randomUUID().replace(/-/g, ''); // 32 hex chars
    await SecureStore.setItemAsync('mmkv_enc_key', encKey);
  }
  _storage = new MMKV({ id: 'polaris-maps-default', encryptionKey: encKey });
  return _storage;
}

/**
 * Synchronous MMKV access for callers that cannot await.
 * Throws if getStorage() has not been called yet.
 */
export function getStorageSync(): MMKV {
  if (!_storage) {
    throw new Error('MMKV not initialised — call getStorage() first');
  }
  return _storage;
}

/**
 * @deprecated Use getStorage() or getStorageSync() instead.
 * Kept temporarily for migration — falls back to unencrypted instance.
 */
export const storage = new MMKV({
  id: 'polaris-maps-default',
});
