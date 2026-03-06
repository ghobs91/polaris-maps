export interface StreetImagery {
  id: string;
  authorPubkey: string;
  lat: number;
  lng: number;
  geohash8: string;
  bearing: number;
  capturedAt: number;
  imageHash: string;
  hypercoreFeedKey: string;
  feedSeq: number;
  width: number;
  height: number;
  blurred: boolean;
  signature: string;
}
