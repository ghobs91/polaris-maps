import NativePolarisTileServer, {
  type TileServerConfig,
  type TileSource,
} from './NativePolarisTileServer';

export type { TileServerConfig, TileSource };

const isAvailable = NativePolarisTileServer != null;
let baseUrl: string | null = null;

export async function startTileServer(config: TileServerConfig): Promise<number> {
  if (!isAvailable) return 0;
  const port = await NativePolarisTileServer!.start(config);
  baseUrl = `http://localhost:${port}`;
  return port;
}

export async function addTileSource(source: TileSource): Promise<void> {
  if (!isAvailable) return;
  return NativePolarisTileServer!.addSource(source);
}

export async function removeTileSource(sourceId: string): Promise<void> {
  if (!isAvailable) return;
  return NativePolarisTileServer!.removeSource(sourceId);
}

export async function listTileSources(): Promise<TileSource[]> {
  if (!isAvailable) return [];
  return NativePolarisTileServer!.listSources();
}

export async function stopTileServer(): Promise<void> {
  baseUrl = null;
  if (!isAvailable) return;
  return NativePolarisTileServer!.stop();
}

export function getTileServerBaseUrl(): string {
  if (baseUrl) return baseUrl;
  if (isAvailable) {
    baseUrl = NativePolarisTileServer!.getBaseUrl();
    return baseUrl;
  }
  return '';
}

export function getTileUrl(sourceId: string): string {
  return `${getTileServerBaseUrl()}/${sourceId}/{z}/{x}/{y}.mvt`;
}
