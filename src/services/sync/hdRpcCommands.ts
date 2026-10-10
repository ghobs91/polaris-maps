/**
 * Numeric RPC command IDs shared between the React Native Hyperdrive bridge
 * (`bareHyperdriveBridge` / `hyperdriveBridge`) and the Bare worklet
 * (`backend/hyperdrive.mjs`). Keep both sides in sync.
 */

export const CMD_HD_SEED = 0; // RN → worklet: author or join a region pack
export const CMD_HD_DOWNLOAD = 1; // RN → worklet: download a pack from peers
export const CMD_HD_STATUS = 2; // RN → worklet: seeded-drive status
export const CMD_HD_UNSEED = 3; // RN → worklet: release a seeded region
export const CMD_HD_GUNZIP = 4; // RN → worklet: gunzip a file in place
export const CMD_HD_EXTRACT_TAR = 5; // RN → worklet: extract a (gzipped) tar

export const CMD_HD_DOWNLOAD_PROGRESS = 20; // worklet → RN: byte progress
