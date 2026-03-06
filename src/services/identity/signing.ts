import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

const textEncoder = new TextEncoder();

export async function sign(message: string, privateKey: Uint8Array): Promise<string> {
  const msgHash = sha256(textEncoder.encode(message));
  const signature = schnorr.sign(msgHash, privateKey);
  return bytesToHex(signature);
}

export function verify(message: string, signature: string, publicKey: string): boolean {
  const msgHash = sha256(textEncoder.encode(message));
  return schnorr.verify(hexToBytes(signature), msgHash, publicKey);
}

export function createSigningPayload(...fields: (string | number)[]): string {
  return fields.map(String).join('');
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
