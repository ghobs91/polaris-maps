import NativePolarisTileServer, {
  type TileServerConfig,
  type TileSource,
} from './NativePolarisTileServer';

export type { TileServerConfig, TileSource };

let baseUrl: string | null = null;

export async function startTileServer(config: TileServerConfig): Promise<number> {
  const port = await NativePolarisTileServer.start(config);
  baseUrl = `http://localhost:${port}`;
  return port;
}

export async function addTileSource(source: TileSource): Promise<void> {
  return NativePolarisTileServer.addSource(source);
}

export async function removeTileSource(sourceId: string): Promise<void> {
  return NativePolarisTileServer.removeSource(sourceId);
}

export async function listTileSources(): Promise<TileSource[]> {
  return NativePolarisTileServer.listSources();
}

export async function stopTileServer(): Promise<void> {
  baseUrl = null;
  return NativePolarisTileServer.stop();
}

export function getTileServerBaseUrl(): string {
  if (!baseUrl) {
    baseUrl = NativePolarisTileServer.getBaseUrl();
  }
  return baseUrl;
}

export function getTileUrl(sourceId: string): string {
  return `${getTileServerBaseUrl()}/${sourceId}/{z}/{x}/{y}.mvt`;
}
