export interface SavedPlace {
  id: string;
  name: string;
  note?: string;
  lat: number;
  lng: number;
  address?: string;
  category?: string;
  phone?: string;
  website?: string;
  googleMapsUrl?: string;
  poiUuid?: string;
  addedAt: number;
  /** Last-write timestamp used when merging shared lists (falls back to addedAt). */
  updatedAt?: number;
  /** Tombstone: when true, the place is deleted and must not be resurrected. */
  deleted?: boolean;
}

export interface PlaceList {
  id: string;
  name: string;
  emoji?: string;
  isPrivate: boolean;
  places: SavedPlace[];
  createdAt: number;
  updatedAt: number;
}
