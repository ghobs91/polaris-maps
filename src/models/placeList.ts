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
