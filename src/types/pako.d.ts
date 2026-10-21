declare module 'pako' {
  export function inflate(data: Uint8Array): Uint8Array;
  export function inflateRaw(data: Uint8Array): Uint8Array;
  export function deflate(data: Uint8Array): Uint8Array;
  export function deflateRaw(data: Uint8Array): Uint8Array;

  export interface InflateOptions {
    raw?: boolean;
    windowBits?: number;
    chunkSize?: number;
    dictionary?: Uint8Array;
    to?: 'string';
  }

  /** Streaming inflater — feed compressed slices with `push()`. */
  export class Inflate {
    constructor(options?: InflateOptions);
    /** Called with each chunk of decompressed output. */
    onData: (chunk: Uint8Array) => void;
    /** `true` on the final chunk. */
    push(data: Uint8Array, flushMode?: boolean | number): boolean;
    readonly result?: Uint8Array | string;
    readonly err: number;
    readonly msg: string;
    readonly ended: boolean;
  }
}
