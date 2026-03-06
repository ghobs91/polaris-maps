export interface Review {
  id: string; // {poi_uuid}:{author_pubkey}
  poiUuid: string;
  authorPubkey: string;
  rating: number; // 1-5
  text?: string; // max 2000 chars
  signature: string;
  createdAt: number;
  updatedAt: number;
}
