export interface Review {
  id: string; // {poi_uuid}:{author_pubkey} for anonymous; at:// URI for ATProto
  poiUuid: string;
  authorPubkey: string; // Nostr hex pubkey (anonymous) OR ATProto DID (Bluesky)
  rating: number; // 1-5
  text?: string; // max 2000 chars
  signature: string; // Schnorr sig (anonymous) OR '' (ATProto — PDS-signed)
  createdAt: number;
  updatedAt: number;
  source: 'anonymous' | 'atproto';
  atprotoUri?: string; // at:// record URI, only set for ATProto reviews
  authorHandle?: string; // e.g. 'alice.bsky.social', only for ATProto reviews
}

export interface PlaceReviewContext {
  poiUuid: string;
  source: 'osm' | 'overture' | 'polaris';
  osmId?: string;
  overtureId?: string;
  name?: string;
  lat?: number;
  lng?: number;
}

export function normalizeReview(r: Omit<Review, 'source'> & { source?: Review['source'] }): Review {
  return {
    ...r,
    source: r.source ?? 'anonymous',
  };
}
