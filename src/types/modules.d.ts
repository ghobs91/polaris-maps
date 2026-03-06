declare module 'expo-file-system' {
  export const documentDirectory: string | null;
  export const cacheDirectory: string | null;
  export function readAsStringAsync(
    fileUri: string,
    options?: { encoding?: string },
  ): Promise<string>;
  export function writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: { encoding?: string },
  ): Promise<void>;
  export function deleteAsync(fileUri: string, options?: { idempotent?: boolean }): Promise<void>;
  export function getInfoAsync(
    fileUri: string,
    options?: { size?: boolean },
  ): Promise<{ exists: boolean; size?: number; uri: string; isDirectory?: boolean }>;
  export function makeDirectoryAsync(
    fileUri: string,
    options?: { intermediates?: boolean },
  ): Promise<void>;
  export function readDirectoryAsync(fileUri: string): Promise<string[]>;
  export function copyAsync(options: { from: string; to: string }): Promise<void>;
  export function moveAsync(options: { from: string; to: string }): Promise<void>;
  export function downloadAsync(
    uri: string,
    fileUri: string,
    options?: { headers?: Record<string, string> },
  ): Promise<{ uri: string; status: number; headers: Record<string, string> }>;

  export interface DownloadResumable {
    downloadAsync(): Promise<{ uri: string; status: number; headers: Record<string, string> }>;
    pauseAsync(): Promise<{ url: string; fileUri: string; resumeData: string }>;
    resumeAsync(): Promise<{ uri: string; status: number; headers: Record<string, string> }>;
    savable(): { url: string; fileUri: string; resumeData: string };
  }

  export type DownloadProgressCallback = (data: {
    totalBytesWritten: number;
    totalBytesExpectedToWrite: number;
  }) => void;

  export function createDownloadResumable(
    uri: string,
    fileUri: string,
    options?: { headers?: Record<string, string> },
    callback?: DownloadProgressCallback,
    resumeData?: string,
  ): DownloadResumable;
}

declare module 'expo-image-manipulator' {
  export interface ImageResult {
    uri: string;
    width: number;
    height: number;
    base64?: string;
  }

  export interface Action {
    resize?: { width?: number; height?: number };
    rotate?: number;
    flip?: { vertical?: boolean; horizontal?: boolean };
    crop?: { originX: number; originY: number; width: number; height: number };
  }

  export interface SaveOptions {
    compress?: number;
    format?: 'jpeg' | 'png';
    base64?: boolean;
  }

  export function manipulateAsync(
    uri: string,
    actions: Action[],
    saveOptions?: SaveOptions,
  ): Promise<ImageResult>;
}

declare module 'expo-crypto' {
  export function digestStringAsync(algorithm: string, data: string): Promise<string>;

  export function randomUUID(): string;

  export const CryptoDigestAlgorithm: {
    SHA256: string;
  };
}

declare module '@react-native-community/netinfo' {
  export type NetInfoStateType =
    | 'unknown'
    | 'none'
    | 'wifi'
    | 'cellular'
    | 'bluetooth'
    | 'ethernet'
    | 'wimax'
    | 'vpn'
    | 'other';

  export interface NetInfoState {
    type: NetInfoStateType;
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    details: Record<string, unknown> | null;
  }

  export function fetch(): Promise<NetInfoState>;
  export function addEventListener(listener: (state: NetInfoState) => void): () => void;
}

declare module '@noble/hashes/sha256' {
  export function sha256(data: Uint8Array): Uint8Array;
}

declare module '@react-native-community/slider' {
  import { Component } from 'react';
  import { ViewStyle } from 'react-native';

  interface SliderProps {
    style?: ViewStyle;
    minimumValue?: number;
    maximumValue?: number;
    step?: number;
    value?: number;
    onValueChange?: (value: number) => void;
    onSlidingComplete?: (value: number) => void;
    minimumTrackTintColor?: string;
    maximumTrackTintColor?: string;
    thumbTintColor?: string;
    disabled?: boolean;
  }

  export default class Slider extends Component<SliderProps> {}
}
