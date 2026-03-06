export interface MapTile {
  id: string; // {source}/{z}/{x}/{y}
  sourceId: string;
  z: number;
  x: number;
  y: number;
  byteOffset: number;
  byteLength: number;
  cachedAt: number;
  lastAccessed: number;
  filePath: string | null;
}
