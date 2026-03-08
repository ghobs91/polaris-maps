import { NativeModules, NativeEventEmitter } from 'react-native';

let requestCounter = 0;

/**
 * Extract a tar (or tar.gz) archive via the nodejs-mobile sidecar.
 * Resolves when extraction is complete.
 */
export function extractTar(srcPath: string, destDir: string): Promise<void> {
  const { NodeChannel } = NativeModules;
  if (!NodeChannel) {
    return Promise.reject(new Error('NodeChannel native module is not available'));
  }

  const requestId = `tar_${++requestCounter}_${Date.now()}`;

  return new Promise<void>((resolve, reject) => {
    const emitter = new NativeEventEmitter(NodeChannel);
    const sub = emitter.addListener('message', (raw: string) => {
      try {
        const event = JSON.parse(raw);
        if (event.requestId !== requestId) return;
        sub.remove();
        if (event.type === 'error') {
          reject(new Error(event.error));
        } else {
          resolve();
        }
      } catch {
        // Not our message
      }
    });

    NodeChannel.send(JSON.stringify({ type: 'extract-tar', srcPath, destDir, requestId }));

    // Timeout after 120s (large archives)
    setTimeout(() => {
      sub.remove();
      reject(new Error('Tar extraction timed out'));
    }, 120_000);
  });
}
