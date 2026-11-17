/**
 * Local control plane.
 *
 * A Unix socket in the relay root, not a TCP port. Consequences that matter:
 *
 *   - **Nothing to firewall, scan, or authenticate remotely.** The swarm is the
 *     only network surface the relay has, so "who can tell this relay to stop
 *     seeding" is answered by filesystem permissions alone.
 *   - **Access control is the directory.** The socket is mode 0600 inside a 0700
 *     root owned by the user, so another uid cannot traverse to it. Node exposes
 *     no `LOCAL_PEERCRED`/`SO_PEERCRED` binding, so this is stated plainly rather
 *     than implied: the directory mode *is* the authentication.
 *   - **The menu-bar app and the CLI are the same kind of client.** Neither
 *     manages the process; both send a command and read a reply. That is what
 *     keeps quitting the app from affecting seeding.
 *
 * Wire format is newline-delimited JSON, one request per line, one reply per
 * line — `nc -U control.sock` is a usable debugger.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const MAX_REQUEST_BYTES = 64 * 1024;

/**
 * Start the control server.
 *
 * @param {object} options
 * @param {string} options.socketPath
 * @param {(request: { cmd: string, [key: string]: unknown }) => Promise<unknown> | unknown} options.handle
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export async function startControlServer({ socketPath, handle, log = () => {} }) {
  const dir = path.dirname(socketPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  // A socket left by a crashed daemon would make `listen` fail with EADDRINUSE;
  // nothing else can be listening on it because the path is ours.
  if (fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (err) {
      log(`could not remove stale socket: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const server = net.createServer((socket) => {
    let buffer = '';
    let closed = false;

    socket.setEncoding('utf8');

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      let newlineIndex;
      while (!closed && (newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        void respond(socket, line);
      }
    });

    socket.on('error', () => {
      closed = true;
    });

    async function respond(target, line) {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        target.write(`${JSON.stringify({ ok: false, error: 'invalid JSON request' })}\n`);
        return;
      }

      try {
        const result = await handle(request);
        target.write(`${JSON.stringify({ ok: true, result })}\n`);
      } catch (err) {
        target.write(
          `${JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })}\n`,
        );
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      try {
        fs.chmodSync(socketPath, 0o600);
      } catch {
        /* best effort; the directory is already 0700 */
      }
      resolve(undefined);
    });
  });

  log(`control socket listening at ${socketPath}`);

  return {
    async close() {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      try {
        fs.unlinkSync(socketPath);
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * Send one command to a running relay.
 *
 * @param {string} socketPath
 * @param {{ cmd: string, [key: string]: unknown }} request
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<unknown>} the `result` field, or throws with the daemon's error
 */
export function controlRequest(socketPath, request, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };

    const timer = setTimeout(
      () => finish(reject, new Error(`relay did not answer within ${timeoutMs} ms`)),
      timeoutMs,
    );

    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex);
      try {
        const reply = JSON.parse(line);
        if (reply.ok) finish(resolve, reply.result);
        else finish(reject, new Error(String(reply.error ?? 'relay rejected the command')));
      } catch {
        finish(reject, new Error('relay sent an unparseable reply'));
      }
    });
    socket.on('error', (err) => finish(reject, err));
    socket.on('close', () => {
      if (!settled) finish(reject, new Error('relay closed the connection without a reply'));
    });
  });
}
