import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface TileServerConfig {
  port?: number;
  cachePath: string;
}

export interface TileSource {
  id: string;
  filePath: string;
}

export interface Spec extends TurboModule {
  start(config: TileServerConfig): Promise<number>;
  addSource(source: TileSource): Promise<void>;
  removeSource(sourceId: string): Promise<void>;
  listSources(): Promise<TileSource[]>;
  stop(): Promise<void>;
  getBaseUrl(): string;
}

export default TurboModuleRegistry.get<Spec>('PolarisTileServer');
